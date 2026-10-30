const GENERIC_SEARCH_WORDS = new Set([
  "a",
  "an",
  "and",
  "audio",
  "edition",
  "hd",
  "official",
  "original",
  "song",
  "the",
  "video",
  "lyrics",
  "music",
]);

const { matchTokens } = require("./searchMatching");
const {
  getBaseTitle,
  getVariantKinds,
  isUnrequestedAlternateVersion,
  cleanArtistName,
  normalizeComparableText,
  queryRequestsVariant,
} = require("./trackNormalization");

const VERSION_PENALTIES = Object.freeze({
  remix: 70,
  nightcore: 70,
  slowed: 70,
  spedup: 70,
  live: 55,
  instrumental: 65,
  karaoke: 80,
  cover: 70,
  acoustic: 55,
  mix: 50,
  edit: 35,
  clean: 65,
  single: 0,
  version: 0,
  original: 0,
  radio: 0,
  explicit: 0,
  remaster: 20,
  // Kinds trackNormalization reports. Nightcore and slowed uploads are
  // "tempo", which used to fall through to the 25-point default and so sat
  // next to the original as if they were a radio edit.
  tempo: 70,
  chopped: 70,
  demo: 45,
  // 8-bit covers, parodies, type beats and lullaby versions: never the song.
  novelty: 90,
  // 432 Hz, 8D and bass-boosted re-uploads of the recording.
  pitch: 70,
});

// "YouTube first" is the Activity's default search mode. Spotify remains the
// next strongest catalogue fallback, but neither provider can beat a clearly
// better Deezer or SoundCloud match. These are tie-break-sized bonuses;
// title/artist relevance remains the deciding signal.
const SEARCH_PROVIDER_BONUSES = Object.freeze({
  youtube: 30,
  spotify: 22,
});
const MIN_PREFERRED_PROVIDER_SCORE = 260;
// A provider's own first results carry its popularity knowledge, which the
// metadata does not: for "high forever" every upload is titled the same, and
// only the providers know the Edgerunners remix is the one people play. A
// recording that at least two providers list near the top rises above the
// same-titled uploads; one provider's order alone stays a mere tie-break.
const PROVIDER_TOP_PICK_BONUSES = Object.freeze([36, 24, 12]);
const MIN_TOP_PICK_PROVIDERS = 2;
// A version a provider lists this high for a base-title search is the one
// people play (YouTube Music puts the Edgerunners "High Forever" remix second),
// so it is not penalised as an unrequested remix. Its original still leads.
const VARIANT_TOP_PICK_POSITIONS = 2;
// Re-uploads that only process the recording (slowed, 432 Hz, 8-bit) are
// listed high for their views, not because they are the song.
const PROCESSED_VERSION_KINDS = new Set(["tempo", "chopped", "pitch", "novelty"]);
// Deezer's play-count rank (searchPopularity.js) separates the song everyone
// means from same-titled covers: The Weeknd's "Blinding Lights" ranks ~985k,
// a string quartet's ~430k. The bonus grows with the cube of the share of the
// pool's best rank, so only recordings close to the top gain much, and only
// strong matches get it: popularity breaks ties, it never makes a weak match
// relevant.
const POPULARITY_BONUS = 70;
// A song whose main artist the query names only as a guest ("Otwieram wino
// (feat. Pezet)" for "pezet") is that artist's second-hand result.
const FEATURED_ONLY_PENALTY = 80;

const NON_MUSIC_SEARCH_PATTERNS = [
  /\b(?:tutorial|how to|lesson|tips?|tricks?|review|reaction|reacts?|analysis|explained)\b/i,
  /\b(?:interview|podcast|gameplay|walkthrough|speedrun|stream(?:ed)?\s+sniped|livestream)\b/i,
  /\b(?:clip|highlights?|trailer|teaser|unboxing|school|class|contest|setup|testing)\b/i,
  /\b(?:royalty\s+free|shopping\s+spree|teaches?|dub|prank|challenge|asmr|mukbang)\b/i,
];

// Ranking normalises the same query, titles and artists several times per
// candidate, and cached searches hand back the same titles on every
// keystroke; keep the results so a 200-track pool costs one pass of regexes.
const MAX_MEMO_ENTRIES = 5_000;

function memoizeText(transform) {
  const memo = new Map();
  return (value) => {
    const text = String(value || "");
    const cached = memo.get(text);
    if (cached !== undefined) return cached;
    if (memo.size >= MAX_MEMO_ENTRIES) memo.clear();
    const result = transform(text);
    memo.set(text, result);
    return result;
  };
}

const normalizeText = memoizeText(normalizeComparableText);

function getTokens(value, { keepGeneric = false } = {}) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => keepGeneric || !GENERIC_SEARCH_WORDS.has(token));
}

function getUniqueTokens(value, options) {
  return [...new Set(getTokens(value, options))];
}

// Shorter joins ("a b" → "ab") are too likely to be a different word.
const MIN_RESPACED_WORD_LENGTH = 4;

function splitLikeQuery(word, queryWords) {
  if (word.length < MIN_RESPACED_WORD_LENGTH) return [word];
  for (let start = 0; start < queryWords.length; start += 1) {
    for (const count of [3, 2]) {
      const parts = queryWords.slice(start, start + count);
      if (parts.length === count && parts.join("") === word) return parts;
    }
  }
  return [word];
}

/**
 * "kickback" and "KICK BACK" are the same song. Re-spaces candidate words to
 * the query's spelling: joins neighbours the query writes as one word and
 * splits a word the query writes as several, so word matching sees them equal.
 */
function alignWordSpacing(words, queryWords) {
  if (!queryWords.length) return words;
  const joined = new Set(queryWords.filter((word) => word.length >= MIN_RESPACED_WORD_LENGTH));
  const aligned = [];
  for (let index = 0; index < words.length; index += 1) {
    const count = [3, 2].find((size) => index + size <= words.length && joined.has(words.slice(index, index + size).join("")));
    if (count) {
      aligned.push(words.slice(index, index + count).join(""));
      index += count - 1;
    } else {
      aligned.push(...splitLikeQuery(words[index], queryWords));
    }
  }
  return aligned;
}

function alignTextSpacing(text, queryWords) {
  return alignWordSpacing(String(text || "").split(" ").filter(Boolean), queryWords).join(" ");
}

function getCoverage(needleTokens, candidateTokens) {
  if (!needleTokens.length) return 0;

  const candidateSet = new Set(candidateTokens);
  const matches = needleTokens.filter((token) => candidateSet.has(token)).length;
  return matches / needleTokens.length;
}

function getFuzzyCoverage(needleTokens, candidateTokens, options) {
  return matchTokens(needleTokens, candidateTokens, options).credit;
}

// The word the user is probably still typing. Only that one may match as a
// prefix; earlier words are complete and must match as words.
function getPrefixToken(query) {
  const text = String(query || "");
  if (/\s$/.test(text)) return null;
  const tokens = getTokens(text, { keepGeneric: true });
  const last = tokens[tokens.length - 1];
  return last && !GENERIC_SEARCH_WORDS.has(last) ? last : null;
}

function getPopularity(track) {
  const popularityCandidates = [
    [track?.popularity, false],
    [track?.info?.popularity, false],
    [track?.pluginInfo?.popularity, false],
    [track?.userData?.popularity, false],
    [track?.info?.viewCount, true],
    [track?.info?.views, true],
    [track?.pluginInfo?.viewCount, true],
    [track?.pluginInfo?.views, true],
    [track?.userData?.viewCount, true],
    [track?.userData?.views, true],
  ];

  const candidate = popularityCandidates.find(([value]) => Number.isFinite(Number(value)));
  if (!candidate) return 0;

  const [value, isViewCount] = candidate;
  const numeric = Number(value);
  if (isViewCount) {
    // YouTube/Lavalink often exposes views instead of a 0-100 popularity.
    // Logarithmic scaling prevents a viral track from overpowering exact
    // artist/title matches while still making popularity useful as a tie-break.
    return Math.max(0, Math.min(100, Math.log10(Math.max(1, numeric)) * 10));
  }

  return Math.max(0, Math.min(numeric <= 1 ? numeric * 100 : numeric, 100));
}

function splitExplicitQuery(query) {
  const match = String(query || "")
    .trim()
    .match(/^(.+?)\s[-–—|]\s(.+)$/);

  if (!match) return null;

  return {
    artist: getUniqueTokens(match[1]),
    title: getUniqueTokens(match[2]),
  };
}

function getVersionTokens(title) {
  return getVariantKinds(title);
}

const FEATURED_CREDIT_PATTERN = /[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\s(?:feat\.?|ft\.?|featuring)\s+(.+)$/gi;

function getFeaturedCredits(title) {
  const text = String(title || "");
  const credits = [...text.matchAll(FEATURED_CREDIT_PATTERN)].map((match) => match[1] || match[2]);
  return {
    featuredTokens: getUniqueTokens(credits.join(" ")),
    mainTitleTokens: getUniqueTokens(text.replace(FEATURED_CREDIT_PATTERN, " ")),
  };
}

function getPopularityShare(track, maxRank) {
  const rank = Number(track?.searchPopularity);
  return maxRank > 0 && rank > 0 ? Math.min(1, rank / maxRank) : 0;
}

function getPopularityBonus(entry) {
  if (!entry?.popularityShare || entry.score < MIN_PREFERRED_PROVIDER_SCORE) return 0;
  return Math.round(POPULARITY_BONUS * entry.popularityShare ** 3);
}

const getCanonicalTitle = memoizeText(getBaseTitle);

function getProviderIdentity(track) {
  const source = normalizeText(track?.info?.sourceName || track?.info?.source || "");
  return source || "unknown";
}

// Versions that sound different enough to be their own recording. A remaster
// or radio edit is still the song people meant, so it shares the original's key.
const MIN_DISTINCT_VERSION_PENALTY = 50;

function getConsensusKey(track) {
  const rawTitle = track?.info?.title || "";
  const title = getCanonicalTitle(rawTitle);
  const author = normalizeText(cleanArtistName(track?.info?.author || ""));
  if (!title || !author) return null;
  const versions = getVersionTokens(rawTitle).filter((kind) => (VERSION_PENALTIES[kind] ?? 25) >= MIN_DISTINCT_VERSION_PENALTY);
  return versions.length ? `${author}|||${title}|||${versions.sort().join(",")}` : `${author}|||${title}`;
}

function getCatalogSourceBonus(track, consensusSources) {
  if (consensusSources < 2) return 0;
  const source = getProviderIdentity(track);
  if (source === "spotify") return 8;
  if (source === "deezer") return 6;
  if (source === "soundcloud") return 2;
  return 0;
}

function getProviderConsensus(track, consensusMap) {
  const key = getConsensusKey(track);
  if (!key || !consensusMap) return 0;
  return consensusMap.get(key)?.size ?? 0;
}

function getRecordingKey(track) {
  return getConsensusKey(track) || track?.info?.uri || track?.info?.identifier || null;
}

/**
 * Sums, per recording, the bonus for its position in each provider's list,
 * keeping only recordings that MIN_TOP_PICK_PROVIDERS providers agree on.
 */
function getProviderTopPicks(tracks) {
  const positions = new Map();
  const picks = new Map();
  for (const track of tracks) {
    const provider = getProviderIdentity(track);
    const position = positions.get(provider) ?? 0;
    positions.set(provider, position + 1);
    const key = getRecordingKey(track);
    if (!key || position >= PROVIDER_TOP_PICK_BONUSES.length) continue;
    const pick = picks.get(key) || new Map();
    if (!pick.has(provider)) pick.set(provider, PROVIDER_TOP_PICK_BONUSES[position]);
    picks.set(key, pick);
  }
  const bonuses = new Map();
  for (const [key, pick] of picks) {
    if (pick.size >= MIN_TOP_PICK_PROVIDERS) bonuses.set(key, [...pick.values()].reduce((sum, bonus) => sum + bonus, 0));
  }
  return bonuses;
}

/** Each track's position in its own provider's list, in pool order. */
function getProviderPositions(tracks) {
  const counts = new Map();
  return tracks.map((track) => {
    const provider = getProviderIdentity(track);
    const position = counts.get(provider) ?? 0;
    counts.set(provider, position + 1);
    return position;
  });
}

function getRecordingBaseKey(track) {
  const title = getCanonicalTitle(track?.info?.title || "");
  const author = normalizeText(cleanArtistName(track?.info?.author || ""));
  return title && author ? `${author}|||${title}` : null;
}

/**
 * Moves an artist's original recording directly above the first of its
 * versions that outranked it, so a remix lifted as a provider top pick sits
 * second rather than replacing the song that was searched for.
 */
function keepOriginalsAboveVariants(entries) {
  const result = [...entries];
  for (let index = 0; index < result.length; index += 1) {
    const entry = result[index];
    if (!entry.reasons.some((reason) => reason.startsWith("provider top pick"))) continue;
    const baseKey = getRecordingBaseKey(entry.track);
    if (!baseKey) continue;
    const originalIndex = result.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        !getVersionTokens(candidate.track?.info?.title).length &&
        getRecordingBaseKey(candidate.track) === baseKey
    );
    if (originalIndex === -1) continue;
    const [original] = result.splice(originalIndex, 1);
    result.splice(index, 0, original);
  }
  return result;
}

function getTopPickBonus(entry, topPicks) {
  if (!entry || entry.score < MIN_PREFERRED_PROVIDER_SCORE) return 0;
  return topPicks.get(getRecordingKey(entry.track)) || 0;
}

function getSearchProviderBonus(entry) {
  if (!entry || entry.score < MIN_PREFERRED_PROVIDER_SCORE) return 0;
  return SEARCH_PROVIDER_BONUSES[getProviderIdentity(entry.track)] || 0;
}

function compareRankedSearchResults(left, right) {
  if (right.effectiveScore !== left.effectiveScore) return right.effectiveScore - left.effectiveScore;
  if (right.score !== left.score) return right.score - left.score;
  if (right.popularity !== left.popularity) return right.popularity - left.popularity;
  return left.index - right.index;
}

function deduplicateRankedSearchResults(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    // `getConsensusKey` is source-independent (normalised artist + base
    // title), unlike a Lavalink encoded track/URI. Keep only the best result
    // for the same recording instead of showing Spotify, YouTube, Deezer and
    // SoundCloud copies side by side.
    const key = getConsensusKey(entry.track);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimWeakSingleWordMatches(entries, query) {
  const queryTokens = getUniqueTokens(query);
  if (queryTokens.length !== 1 || entries.length < 2) return entries;

  const bestScore = entries[0]?.score || 0;
  // A one-word query is often a song title. Once an exact, high-confidence
  // result exists, do not fill the top results with uploads whose only link
  // is an uploader name or a single word buried in a much longer title.
  if (bestScore < MIN_PREFERRED_PROVIDER_SCORE) return entries;

  const minimumScore = bestScore - 120;
  return entries.filter((entry) => entry.score >= minimumScore);
}

function scoreSearchResult(
  track,
  query,
  index = 0,
  { consensusMap, providerPosition = Infinity, popularityShare = 0 } = {}
) {
  const title = track?.info?.title || "";
  const author = track?.info?.author || "";
  const queryWords = getTokens(query, { keepGeneric: true });
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = alignTextSpacing(normalizeText(title), queryWords);
  const canonicalTitle = alignTextSpacing(getCanonicalTitle(title), queryWords);
  const normalizedAuthor = alignTextSpacing(normalizeText(author), queryWords);
  const candidateText = `${normalizedAuthor} ${normalizedTitle}`.trim();
  const queryTokens = getUniqueTokens(query);
  const titleTokens = getUniqueTokens(normalizedTitle);
  const authorTokens = getUniqueTokens(normalizedAuthor);
  const explicitQuery = splitExplicitQuery(query);
  const isSingleWordQuery = queryTokens.length === 1;
  const prefixToken = getPrefixToken(query);
  const popularity = getPopularity(track);

  let score = 0;
  const reasons = [];

  if (normalizedTitle === normalizedQuery || normalizedAuthor === normalizedQuery) {
    score += 180;
    reasons.push("exact field");
  }

  if (canonicalTitle && canonicalTitle === normalizedQuery && normalizedTitle !== normalizedQuery) {
    // Prefer the official single/radio/remaster variant of a well-known song
    // over an unrelated cover with the same bare title.
    score += 185;
    reasons.push("canonical title");
  }

  if (
    queryTokens.length >= 2 &&
    normalizedAuthor &&
    normalizedTitle &&
    normalizedQuery !== normalizedTitle &&
    normalizedQuery !== normalizedAuthor &&
    (candidateText === normalizedQuery || `${normalizedTitle} ${normalizedAuthor}` === normalizedQuery)
  ) {
    score += 180;
    reasons.push("exact artist/title");
  }

  if (
    getProviderIdentity(track) === "youtube" &&
    queryTokens.length >= 2 &&
    normalizeText(`${cleanArtistName(author)} ${canonicalTitle}`).replace(/(\d)\s+(\p{L})/gu, "$1$2") === normalizedQuery &&
    (canonicalTitle !== normalizedTitle || cleanArtistName(author) !== author)
  ) {
    // Topic/VEVO uploader suffixes and "Official Audio" are decoration, not
    // a weaker recording match. Without this, an exact YouTube result loses
    // to Spotify merely because its metadata is more verbose.
    score += 245;
    reasons.push("canonical artist/title");
  }

  if (normalizedQuery && candidateText.includes(normalizedQuery)) {
    score += 65;
    reasons.push("query phrase");
  }

  if (explicitQuery) {
    // A typo in "artist - title" earns most of the credit an exact word does,
    // but never all of it.
    const artistCoverage = Math.max(
      getCoverage(explicitQuery.artist, authorTokens),
      getFuzzyCoverage(explicitQuery.artist, authorTokens) * 0.9
    );
    const titleCoverage = Math.max(
      getCoverage(explicitQuery.title, titleTokens),
      getFuzzyCoverage(explicitQuery.title, titleTokens, { prefixToken }) * 0.9
    );

    score += artistCoverage * 105;
    score += titleCoverage * 145;

    if (artistCoverage === 1 && explicitQuery.artist.length) reasons.push("artist match");
    if (titleCoverage === 1 && explicitQuery.title.length) reasons.push("title match");
  } else {
    const titleCoverage = getCoverage(queryTokens, titleTokens);
    const authorCoverage = getCoverage(queryTokens, authorTokens);
    const combinedCoverage = getCoverage(queryTokens, [...authorTokens, ...titleTokens]);
    const fuzzyTitleCoverage = getFuzzyCoverage(queryTokens, titleTokens, { prefixToken });
    const fuzzyAuthorCoverage = getFuzzyCoverage(queryTokens, authorTokens, { prefixToken });
    const fuzzyCombinedCoverage = getFuzzyCoverage(queryTokens, [...authorTokens, ...titleTokens], { prefixToken });
    // Query words that name the artist, typos included, so the rest can be
    // checked against the title alone.
    const authorMatch = matchTokens(queryTokens, authorTokens);
    const titleTokensAfterArtist = queryTokens.filter((_, index) => authorMatch.credits[index] < 0.75);
    const artistTokenCount = queryTokens.length - titleTokensAfterArtist.length;
    const titleAfterArtistCoverage = getCoverage(titleTokensAfterArtist, titleTokens);
    const fuzzyTitleAfterArtistCoverage = getFuzzyCoverage(titleTokensAfterArtist, titleTokens, { prefixToken });

    score += titleCoverage * 135;
    score += authorCoverage * 80;
    score += combinedCoverage * 95;

    // Exact token coverage remains the primary signal. Fuzzy coverage only
    // fills the gap introduced by a small typo, so it cannot outrank a
    // precise artist/title match.
    const fuzzyTitleBonus = Math.max(0, fuzzyTitleCoverage - titleCoverage);
    const fuzzyAuthorBonus = Math.max(0, fuzzyAuthorCoverage - authorCoverage);
    const fuzzyCombinedBonus = Math.max(0, fuzzyCombinedCoverage - combinedCoverage);
    score += fuzzyTitleBonus * 82;
    score += fuzzyAuthorBonus * 48;
    score += fuzzyCombinedBonus * 58;
    if (fuzzyTitleBonus > 0 || fuzzyAuthorBonus > 0 || fuzzyCombinedBonus > 0) reasons.push("fuzzy match");

    // For a query such as "kuki cieple dranie", prefer the candidate whose
    // metadata splits into artist=Kuki and title=Ciepłe Dranie. This prevents
    // a SoundCloud upload titled "KUKI CIEPŁE DRANIE" by another uploader from
    // outranking the actual Deezer/Spotify recording.
    if (authorCoverage > 0 && titleTokensAfterArtist.length > 0 && titleAfterArtistCoverage === 1) {
      score += 180 + authorCoverage * 40;
      reasons.push("artist/title split");
    } else if (artistTokenCount > 0 && titleTokensAfterArtist.length > 0 && fuzzyTitleAfterArtistCoverage >= 0.8) {
      // The same split with a misspelt artist or title word ("metalica
      // nothing else matters", "queen bohemian rapsody"). Scaled down so an
      // exact split of a different recording still wins.
      const artistCredits = authorMatch.credits.filter((credit) => credit >= 0.75);
      const artistQuality = artistCredits.reduce((sum, credit) => sum + credit, 0) / artistCredits.length;
      score += (180 + (artistTokenCount / queryTokens.length) * 40) * fuzzyTitleAfterArtistCoverage * artistQuality * 0.9;
      reasons.push("fuzzy artist/title split");
    }

    // A multi-word query represented only by the title is ambiguous. Keep it
    // available, but let an artist/title split or trusted provider order win.
    if (queryTokens.length >= 3 && titleCoverage === 1 && authorCoverage === 0) {
      score -= 45;
      reasons.push("title-only ambiguity");
    }

    if (titleCoverage > 0) reasons.push("title tokens");
    if (authorCoverage > 0) reasons.push("artist tokens");

    if (authorCoverage === 0 && titleCoverage === 1) {
      const { featuredTokens, mainTitleTokens } = getFeaturedCredits(title);
      if (featuredTokens.length && getCoverage(queryTokens, featuredTokens) === 1 && getCoverage(queryTokens, mainTitleTokens) < 1) {
        score -= FEATURED_ONLY_PENALTY;
        reasons.push("featured artist only");
      }
    }
  }

  const unwantedVersions = getVersionTokens(title).filter((kind) => !queryRequestsVariant(query, title) || !getVersionTokens(query).includes(kind));
  const waivable = unwantedVersions.every((kind) => !PROCESSED_VERSION_KINDS.has(kind));
  if (unwantedVersions.length && waivable && providerPosition < VARIANT_TOP_PICK_POSITIONS) {
    reasons.push(`provider top pick:${unwantedVersions.join(",")}`);
  } else if (unwantedVersions.length) {
    const penalty = unwantedVersions.reduce((sum, token) => sum + (VERSION_PENALTIES[token] ?? 25), 0);
    score -= penalty;
    reasons.push(`version penalty:${unwantedVersions.join(",")}`);
  }

  if (!normalizedAuthor && queryTokens.length > 0) {
    score -= 45;
    reasons.push("unknown uploader");
  }

  if (
    isSingleWordQuery &&
    normalizedAuthor === normalizedQuery &&
    normalizedTitle !== normalizedQuery &&
    canonicalTitle !== normalizedQuery
  ) {
    // Uploaders are frequently named after a song, album or label. Their
    // arbitrary uploads must not compete with the actual track title. A
    // recording Deezer itself lists for the query is by an artist of that
    // name ("pezet", "sanah"), not by a channel that borrowed it.
    if (popularityShare > 0) {
      reasons.push("catalogued artist");
    } else {
      score -= 220;
      reasons.push("uploader-only single-word penalty");
    }
  }

  if (popularityShare > 0) reasons.push(`catalog popularity:${popularityShare.toFixed(2)}`);

  const consensusSources = getProviderConsensus(track, consensusMap);
  if (consensusSources > 1) {
    score += (consensusSources - 1) * 32;
    reasons.push(`provider consensus:${consensusSources}`);
  }

  const catalogSourceBonus = getCatalogSourceBonus(track, consensusSources);
  if (catalogSourceBonus) {
    score += catalogSourceBonus;
    reasons.push("catalog recording");
  }

  // Lavalink does not expose popularity consistently across all sources. When it does,
  // use it as a small tie-breaker; otherwise the provider's result order remains useful.
  score += popularity * 0.12;
  score -= index * 0.08;

  return {
    track,
    index,
    popularity,
    popularityShare,
    score,
    reasons,
  };
}

function isLikelyNonMusicSearchResult(track) {
  const haystack = normalizeText(`${track?.info?.title || ""} ${track?.info?.author || ""}`);
  return NON_MUSIC_SEARCH_PATTERNS.some((pattern) => pattern.test(haystack));
}

function isRelevantSearchResult(track, query) {
  if (!track?.info || isLikelyNonMusicSearchResult(track)) return false;

  const queryTokens = getUniqueTokens(query);
  // Queries made entirely from generic words (for example just "the") do
  // not have enough signal to filter safely. A real one-word query still
  // needs to occur in the candidate metadata.
  if (!queryTokens.length) return true;

  // A single letter the user has only started typing ("queen b") says
  // nothing yet; judge the words before it.
  const prefixToken = getPrefixToken(query);
  const needles =
    prefixToken && prefixToken.length < 2 && queryTokens.length > 1
      ? queryTokens.filter((token) => token !== prefixToken)
      : queryTokens;

  const candidateTokens = [
    ...new Set(alignWordSpacing(getTokens(`${track.info.author || ""} ${track.info.title || ""}`), queryTokens)),
  ];
  const match = matchTokens(needles, candidateTokens, { prefixToken });

  // A requested version ("clean", "acoustic") is never the tolerated extra
  // word: the candidate has to be that version.
  if (needles.some((token, index) => match.credits[index] === 0 && getVersionTokens(token).length)) return false;

  return match.credit >= getRequiredRelevance(needles.length) && (needles.length < 2 || match.strong >= 1);
}

// Average per-word credit a candidate needs to stay in the results. A typo
// costs a fraction of a word, so it survives; a missing word costs a whole
// one, which still removes YouTube clips that merely contain "hit". From four
// words on, one unrelated extra word ("8 mile") is tolerated.
function getRequiredRelevance(queryTokenCount) {
  if (queryTokenCount <= 1) return 0.75;
  if (queryTokenCount <= 3) return 0.72;
  return 0.7;
}

function filterRelevantSearchResults(tracks, query) {
  return (Array.isArray(tracks) ? tracks : []).filter((track) => isRelevantSearchResult(track, query));
}

// Relevance is deliberately separate from playability: callers that are about
// to start playback must never use an acoustic/live/remix upload as the
// implicit substitute for a base-version search.
function filterPlayableSearchResults(tracks, query) {
  return filterRelevantSearchResults(tracks, query).filter(
    (track) => !isUnrequestedAlternateVersion(track?.info?.title, query)
  );
}

function rankSearchResults(tracks, query, { limit, withScores = false, dedupe = true } = {}) {
  const pool = Array.isArray(tracks) ? tracks : [];
  const sourceConsensus = new Map();
  for (const track of pool) {
    const key = getConsensusKey(track);
    if (!key) continue;

    if (!sourceConsensus.has(key)) sourceConsensus.set(key, new Set());
    sourceConsensus.get(key).add(getProviderIdentity(track));
  }

  const topPicks = getProviderTopPicks(pool);
  const providerPositions = getProviderPositions(pool);
  const maxRank = Math.max(0, ...pool.map((track) => Number(track?.searchPopularity) || 0));
  const ranked = pool
    .map((track, index) =>
      scoreSearchResult(track, query, index, {
        consensusMap: sourceConsensus,
        providerPosition: providerPositions[index],
        popularityShare: getPopularityShare(track, maxRank),
      })
    )
    .map((entry) => ({
      ...entry,
      providerBonus: getSearchProviderBonus(entry) + getTopPickBonus(entry, topPicks) + getPopularityBonus(entry),
    }))
    .map((entry) => ({ ...entry, effectiveScore: entry.score + entry.providerBonus }))
    .sort(compareRankedSearchResults);

  const focusedRanked = trimWeakSingleWordMatches(keepOriginalsAboveVariants(ranked), query);
  const uniqueRanked = dedupe ? deduplicateRankedSearchResults(focusedRanked) : focusedRanked;

  const selected = Number.isInteger(limit) ? uniqueRanked.slice(0, Math.max(0, limit)) : uniqueRanked;
  return withScores ? selected : selected.map((entry) => entry.track);
}

module.exports = {
  getCanonicalTitle,
  getCatalogSourceBonus,
  getConsensusKey,
  filterRelevantSearchResults,
  filterPlayableSearchResults,
  getFuzzyCoverage,
  getFeaturedCredits,
  getPopularity,
  getPopularityBonus,
  getPopularityShare,
  getProviderConsensus,
  getProviderIdentity,
  getSearchProviderBonus,
  trimWeakSingleWordMatches,
  isLikelyNonMusicSearchResult,
  isRelevantSearchResult,
  normalizeText,
  rankSearchResults,
  scoreSearchResult,
};
