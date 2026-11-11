// The song select's search. The music bot's search (helpers/lavalink/search*.js) answers "which song do you
// mean, play it now"; the game needs "which songs could this be, and can each one be charted", so it asks the
// providers in parallel, ranks with a few more signals, and says why a result cannot be played.
//
// What differs from the bot's search:
// - YouTube Music and YouTube are asked together (the bot asks YTM first and YouTube only when the first came
//   back thin, so a mix, a cover or a remix upload never showed up).
// - Deezer is a hint, not a result: the game cannot play a Deezer track, so a Deezer winner is looked up on
//   YouTube Music by artist and title instead of being dropped after ranking took its place.
// - Words that describe the kind of thing wanted ("mix", "ost", "soundtrack", "do", "na") are optional for
//   relevance, so they stop removing the song the user means.
// - A query that is an artist's name ranks that artist's songs, not songs that happen to have the same title.
// - The correction of a typo and the query as typed both count, so a wrong correction cannot hide a hit.
// - A track over the plugin's length limit is kept but labelled (`playIssue`) and sorted last.
// - A recording is one row, however many uploads and providers carry it: "TheFatRat - MAYDAY (Lyrics) feat. X"
//   on a lyric channel, the artist's own upload, the YouTube Music audio and a Deezer or Spotify row are the same
//   recording (`recordingKeyOf`), and the copy the game plays and charts best is the one shown (`pickCopy`).
//   Remixes, covers, live, nightcore and instrumental versions are other recordings and stay their own rows.
// - Rows are scored on a cleaned view of the metadata (the "Artist - " in front of a title and the feat. credit
//   removed), so an artist's own upload matches the title as exactly as a catalogue row does; what several
//   lanes agree on and what Deezer says is played adds to the score; and the one-word cut keeps what has such
//   evidence, because "mayday" must not leave TheFatRat's song behind an exact title nobody plays.

const { matchTokens } = require("../lavalink/searchMatching");
const { buildSearchQueries } = require("../lavalink/searchQueryVariants");
const { annotateSearchPopularity, isSearchPopularityEnabled, lookupSearchPopularity } = require("../lavalink/searchPopularity");
const { isRelevantSearchResult, normalizeText, rankSearchResults } = require("../lavalink/searchRanking");
const { searchWithCorrection } = require("../lavalink/searchSuggestions");
const { cleanArtistName, getCoreTitle, getVariantKinds } = require("../lavalink/trackNormalization");

// Mirrors `plugins.mewbeat.maxTrackMs` in helpers/lavalink/application.yml: the plugin refuses a longer track
// with 422 too_long when the chart is asked for.
const MAX_PLAY_MS = 1_200_000;
const MAX_RESULTS = 48;

const LANES = Object.freeze({
  ytm: "ytmsearch",
  yt: "ytsearch",
  dz: "dzsearch",
  sp: "spsearch",
  sc: "scsearch",
});
// The first pass; the others only join when it came back thin.
const FIRST_LANES = ["ytm", "yt", "dz"];
const EXTRA_LANES = ["sp", "sc"];
const LANE_TIMEOUT_MS = 2_500;
const MIN_RELEVANT_RESULTS = 3;
const ACCENT_VARIANTS = 2;
const LANE_CACHE_TTL_MS = 2 * 60_000;
const MAX_LANE_CACHE_ENTRIES = 300;
// A provider that keeps answering with an error (SoundCloud and Spotify without keys) rests, as in the bot.
const LANE_FAILURE_STREAK = 3;
const LANE_COOLDOWN_MS = 5 * 60_000;

// Words that say what kind of thing is wanted, or only glue the query together. They add to a match when the
// title has them and never remove a result that lacks them.
const OPTIONAL_WORDS = new Set([
  // Polish glue
  "do", "na", "i", "w", "z", "ze", "o", "od", "po", "dla", "oraz", "ale", "to", "jest",
  // what is wanted
  "mix", "mixy", "miks", "ost", "soundtrack", "opening", "ending", "theme", "song", "songs", "music", "muzyka",
  "piosenka", "piosenki", "utwor", "hity", "hit", "najlepsze", "playlista", "playlist", "full", "version",
]);

// Uploads that are about a song and not the song. These never lead the results.
const NOISE_PATTERNS = [
  /\b(?:be like|listening to|listened to|first time (?:hearing|listening)|reaction|reacts? to|reacting|tier list)\b/,
  /\b(?:rating|ranking) (?:every|all)\b/,
];
// Uploads that are the song but not a song someone plays one round of: kept, ranked low.
const BULK_PATTERNS = [/\b\d+\s*(?:hours?|hrs?|h)\b/, /\b(?:loop|looped|extended|full album|compilation)\b/, /\bshorts?\b/];
const BULK_PENALTY = 90;

const ARTIST_BONUS = 140;
const TITLE_ONLY_PENALTY = 140;
// The artist alone in the author field ("sanah"), not a duet or a remixer credited next to her.
const SOLE_ARTIST_BONUS = 60;
// "quebo bubbletea": the first word is (the start of) the artist and the rest is the title.
const SPLIT_BONUS = 80;
const PREFIX_MIN_LENGTH = 4;
const ARTIST_MIN_SONGS = 3;
const ARTIST_MAX_WORDS = 4;
// The provider's own first results for a query carry what the metadata does not; a few of them stay when
// the strict filter left little.
const LOOSE_POSITIONS = 6;
const LOOSE_WHEN_FEWER_THAN = 8;
const MAX_HINTS = 2;
const MAX_WEAK_HINTS = 1;
const MAX_ARTIST_HINTS = 4; // an artist's best-known songs may be on Deezer's list only
const HINT_TOP_RANKS = 6;
const HINT_TIMEOUT_MS = 1_200;

const laneHealth = new Map();
const laneCache = new Map();

function words(text) {
  return normalizeText(text).split(" ").filter(Boolean);
}

/** The query split into the words a result must have and the words that only describe it. */
function splitQueryWords(query) {
  const all = words(query);
  const required = all.filter((word) => !OPTIONAL_WORDS.has(word));
  // A query made only of such words ("mix") has nothing else to hold on to.
  return required.length ? { required, optional: all.filter((word) => OPTIONAL_WORDS.has(word)) } : { required: all, optional: [] };
}

function requiredText(query) {
  return splitQueryWords(query).required.join(" ");
}

function laneOf(track) {
  if (track?.searchLane) return track.searchLane;
  return /deezer/i.test(track?.info?.sourceName || "") ? "dz" : "yt";
}

function isPlayableLane(track) {
  return laneOf(track) !== "dz";
}

/** Why the plugin would refuse this track, or null. */
function playIssueOf(track) {
  if (track?.info?.isStream) return "stream";
  if (Number(track?.info?.length) > MAX_PLAY_MS) return "too_long";
  return null;
}

function queryHasAny(queries, patterns) {
  const text = queries.map((query) => normalizeText(query)).join(" ");
  return patterns.some((pattern) => pattern.test(text));
}

function isNoiseUpload(track, queries) {
  const text = normalizeText(`${track?.info?.title || ""} ${track?.info?.author || ""}`);
  return NOISE_PATTERNS.some((pattern) => pattern.test(text) && !queryHasAny(queries, [pattern]));
}

function bulkPenalty(track, queries) {
  const title = normalizeText(track?.info?.title || "");
  return BULK_PATTERNS.some((pattern) => pattern.test(title) && !queryHasAny(queries, [pattern])) ? BULK_PENALTY : 0;
}

function authorTokens(track) {
  return words(cleanArtistName(track?.info?.author || ""));
}

function matchesAuthor(track, needles) {
  if (!needles.length) return false;
  const match = matchTokens(needles, authorTokens(track));
  return match.matched === needles.length && match.credit >= 0.9;
}

function matchesTitle(track, needles) {
  if (!needles.length) return false;
  const match = matchTokens(needles, words(track?.info?.title || ""));
  return match.matched === needles.length && match.credit >= 0.9;
}

// "Quebonafide - Zorza (prod. X)" on a fan's channel: a song by the artist the query names, not a song that merely
// has the name in its title ("Camellia (Extended Mix)" by someone else has no dash).
function titleCredits(track, needles) {
  const title = String(track?.info?.title || "");
  if (!needles.length || !/\s[-–—|]\s/.test(title)) return false;
  return words(title).slice(0, needles.length).join(" ") === needles.join(" ");
}

/**
 * Whether the query is an artist's name: at least ARTIST_MIN_SONGS different recordings carry every query word
 * in the artist field (or lead a "name - song" title), and not fewer than carry them in the title only ("Camellia"
 * is an artist with many songs and a title of one song by someone else).
 */
function detectArtistQuery(tracks, query) {
  const needles = splitQueryWords(query).required;
  if (!needles.length || needles.length > ARTIST_MAX_WORDS || /\s[-–—|]\s/.test(query)) return false;
  const byArtist = new Set();
  const byTitle = new Set();
  for (const track of tracks) {
    const key = recordingKeyOf(track) || track?.info?.identifier;
    if (!key) continue;
    if (matchesAuthor(track, needles) || titleCredits(track, needles)) byArtist.add(key);
    else if (matchesTitle(track, needles)) byTitle.add(key);
  }
  return byArtist.size >= ARTIST_MIN_SONGS && byArtist.size >= byTitle.size;
}

function inAuthor(needle, author) {
  return author.includes(needle) || (needle.length >= PREFIX_MIN_LENGTH && author.some((token) => token.length > needle.length && token.startsWith(needle)));
}

/** Whether the query reads as "artist title" or "title artist": one part in the author, the other in the title. */
function matchesArtistThenTitle(track, needles) {
  if (needles.length < 2) return false;
  const author = authorTokens(track);
  const title = words(track?.info?.title || "");
  for (let cut = 1; cut < needles.length; cut += 1) {
    const head = needles.slice(0, cut);
    const tail = needles.slice(cut);
    for (const [byAuthor, byTitle] of [[head, tail], [tail, head]]) {
      if (byAuthor.every((needle) => inAuthor(needle, author)) && matchTokens(byTitle, title).exact === 1) return true;
    }
  }
  return false;
}

function wordsOfTrack(track) {
  return words(`${cleanArtistName(track?.info?.author || "")} ${track?.info?.title || ""}`);
}

// Every required word of one of the queries is in the artist or title letter for letter (no fuzzy near-miss).
function matchesExactly(track, texts) {
  const candidate = wordsOfTrack(track);
  return texts.some((text) => {
    const needles = splitQueryWords(text).required;
    return needles.length > 0 && matchTokens(needles, candidate).exact === 1;
  });
}

// Half of the query's words, at least, are in the artist or title: enough for the provider's own ordering to count.
function matchesPartly(track, texts) {
  const candidate = wordsOfTrack(track);
  return texts.some((text) => {
    const needles = splitQueryWords(text).required;
    return needles.length >= 2 && matchTokens(needles, candidate).strong >= Math.ceil(needles.length / 2);
  });
}

function identityOf(track) {
  return track?.info?.identifier || track?.info?.uri || null;
}

// --- Recordings: one row per song, whatever uploaded or listed it ---------------------------------------------

// The guest credit on a title: "MAYDAY (feat. X)", "MAYDAY feat. X" (up to the next bracket).
const FEATURE_CREDIT_PATTERN = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s+[^()[\]]*/gi;
// What the title starts with after the dash when that is a version label and not the song ("Song - Live at ...").
const VERSION_LABEL_START = /^(?:live|remix|remaster(?:ed)?|acoustic|instrumental|demo|official|lyrics?|audio|video|version|edit|extended|radio|slowed|sped|nightcore|cover|\d{4}\b)/i;
const CREDIT_MAX_WORDS = 5;
// Versions the same recording keeps through (a remaster, a radio edit, a clean copy): everything else is its own row.
const SAME_RECORDING_KINDS = new Set(["remaster", "edit", "clean"]);

function squash(text) {
  return normalizeText(text).replace(/\s+/g, "");
}

// "Sidney Polak, Pezet" and "Kendrick Lamar & SZA" are listed under the first artist by the catalogues.
function primaryArtist(author) {
  return cleanArtistName(String(author || "").split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0]);
}

// "TheFatRat", "The Fat Rat" and "thefatrat" are one name; a shortened name ("Quebo") is not.
function sameName(left, right) {
  const a = squash(cleanArtistName(left));
  const b = squash(cleanArtistName(right));
  if (!a || !b) return false;
  return a === b;
}

/**
 * Who a title credits and what the song is called, from "Artist - Song" and "Song - Artist" uploads. `credit` is
 * "author" when the uploader is that artist, "title" when a fan or lyric channel carries the artist's name in the
 * title, and null when the title has no credit.
 */
function splitArtistCredit(rawTitle, author) {
  const text = String(rawTitle || "").trim();
  const artist = primaryArtist(author);
  const first = text.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (first && !VERSION_LABEL_START.test(first[2].trim()) && !getVariantKinds(first[1]).length) {
    if (sameName(first[1], artist)) return { artist: String(author || ""), title: first[2].trim(), credit: "author" };
    if (first[1].trim().split(/\s+/).length <= CREDIT_MAX_WORDS) return { artist: first[1].trim(), title: first[2].trim(), credit: "title" };
  }
  const last = text.match(/^(.+)\s[-–—]\s(.+?)$/);
  if (last && sameName(last[2], artist)) return { artist: String(author || ""), title: last[1].trim(), credit: "author" };
  return { artist: String(author || ""), title: text, credit: null };
}

function withoutFeatureCredit(title) {
  const text = String(title || "");
  return text.replace(FEATURE_CREDIT_PATTERN, " ").replace(/\s{2,}/g, " ").trim() || text;
}

/**
 * The key two copies of one recording share, across uploads and providers: the artist's name written without
 * spaces, the song with its decoration, credit and guests removed, and the versions that make it another
 * recording (remix, live, cover, instrumental, nightcore...). Null when the metadata has no artist or title.
 */
function recordingKeyOf(track) {
  const credit = splitArtistCredit(track?.info?.title, track?.info?.author);
  const artist = squash(primaryArtist(credit.artist));
  const base = getCoreTitle(withoutFeatureCredit(credit.title));
  if (!artist || !base) return null;
  const versions = getVariantKinds(track.info.title).filter((kind) => !SAME_RECORDING_KINDS.has(kind));
  return versions.length ? `${artist}|${base}|${versions.sort().join(",")}` : `${artist}|${base}`;
}

function groupKeyOf(track) {
  return recordingKeyOf(track) || `id:${identityOf(track) || track?.info?.uri || ""}`;
}

// The track as the scorer should read it: the song's own title and the artist it credits. Plain data, keyed
// back to the real track by the caller (a Poru track is a class instance and is never copied).
function scoringView(track) {
  const credit = splitArtistCredit(track.info.title, track.info.author);
  return {
    searchLane: laneOf(track),
    searchRank: track.searchRank,
    searchPopularity: track.searchPopularity,
    info: { ...track.info, title: withoutFeatureCredit(credit.title), author: credit.credit === "title" ? credit.artist : track.info.author },
  };
}

function withoutRepeats(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const identity = identityOf(track);
    if (!identity) return true;
    // The same video found by two lanes is one candidate; the first (YouTube Music) stays.
    const key = `${isPlayableLane(track) ? "yt" : "dz"}:${identity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Which copy of a recording the game should play and chart: the audio the platform made for it, from the artist's
// own channel, at the recording's length; a lyric video or a fan upload only when nothing better lists it.
const COPY_LANE_BONUS = { ytm: 30, yt: 10, sp: 4, sc: 0 };
const OWN_CHANNEL_BONUS = 25;
const TOPIC_BONUS = 10;
const LYRIC_COPY_PENALTY = 30;
const VIDEO_COPY_PENALTY = 8;
const AUDIO_COPY_BONUS = 10;
const LENGTH_MATCH_BONUS = 20;
const LENGTH_NEAR_BONUS = 8;
const LENGTH_OFF_PENALTY = 25;
const UNPLAYABLE_COPY_PENALTY = 200;
const BULK_COPY_PENALTY = 40;

function medianOf(values) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function copyScore(entry, { referenceMs, texts }) {
  const { track } = entry;
  const info = track.info;
  const title = normalizeText(info.title || "");
  let score = (COPY_LANE_BONUS[laneOf(track)] || 0) + entry.score * 0.01 - (Number(track.searchRank) || 0) * 0.1;
  if (splitArtistCredit(info.title, info.author).credit !== "title") score += OWN_CHANNEL_BONUS;
  if (/-\s*topic\s*$/i.test(info.author || "")) score += TOPIC_BONUS;
  if (/\b(?:lyrics?|lyric video|visuali[sz]er)\b/.test(title) && !queryHasAny(texts, [/\blyrics?\b/])) score -= LYRIC_COPY_PENALTY;
  else if (/\b(?:official (?:music )?video|music video|mv)\b/.test(title)) score -= VIDEO_COPY_PENALTY;
  else if (/\b(?:official audio|audio)\b/.test(title)) score += AUDIO_COPY_BONUS;
  const length = Number(info.length) || 0;
  if (referenceMs && length) {
    const gap = Math.abs(length - referenceMs);
    if (gap <= 8_000) score += LENGTH_MATCH_BONUS;
    else if (gap <= Math.max(20_000, referenceMs * 0.15)) score += LENGTH_NEAR_BONUS;
    else score -= LENGTH_OFF_PENALTY;
  }
  if (playIssueOf(track)) score -= UNPLAYABLE_COPY_PENALTY;
  if (bulkPenalty(track, texts)) score -= BULK_COPY_PENALTY;
  return score;
}

/** The best playable copy among the entries of one recording (the Deezer copy only tells its length), or null. */
function pickCopy(entries, texts) {
  const playable = entries.filter((entry) => isPlayableLane(entry.track));
  if (!playable.length) return null;
  const deezer = entries.find((entry) => !isPlayableLane(entry.track));
  const referenceMs = Number(deezer?.track.info.length) || (playable.length >= 3 ? medianOf(playable.map((entry) => Number(entry.track.info.length) || 0)) : 0);
  let best = null;
  let bestScore = -Infinity;
  for (const entry of playable) {
    const score = copyScore(entry, { referenceMs, texts });
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

// Whether the cleaned title and artist keep every query word the raw metadata had (a guest credit the query
// names is the case where they do not, and the raw score then stands).
function viewKeepsQuery(track, view, text) {
  const needles = splitQueryWords(text).required;
  if (!needles.length) return true;
  return matchTokens(needles, wordsOfTrack(view)).credit >= matchTokens(needles, wordsOfTrack(track)).credit - 1e-9;
}

// What a recording's several copies and Deezer's play counts say beyond its metadata.
const POPULARITY_WEIGHT = 60;
// A fan or lyric channel's "Artist - Song" reads as the song once cleaned, but the artist's own rows come first on a tie.
const FAN_UPLOAD_PENALTY = 40;
const LANE_AGREEMENT_BONUS = 14;
// One-word queries are cut to what scores near the best result, unless something backs the result up.
const ONE_WORD_WINDOW = 120;

/**
 * Orders a pool of tracks for the song select. `queries` is the query as typed first, then the corrected
 * one when there is one. Returns `items` ({ track, score, tier }; tier is "main", "loose" or "blocked", in the
 * order to show) and `hints`, Deezer recordings that rank well and have no playable copy in the pool.
 * One item is one recording: its uploads and providers are grouped by `recordingKeyOf` and the best copy shown.
 */
function rankGameResults(pool, { queries, limit = MAX_RESULTS } = {}) {
  const texts = [...new Set((queries || []).map((query) => String(query || "").trim()).filter(Boolean))];
  if (!texts.length) return { items: [], hints: [] };
  const candidates = withoutRepeats(
    (Array.isArray(pool) ? pool : []).filter((track) => track?.info && !track.info.isStream && !isNoiseUpload(track, texts))
  );

  const strict = candidates.filter((track) => texts.some((text) => isRelevantSearchResult(track, requiredText(text))));
  const artistQuery = detectArtistQuery(strict, texts[0]);
  const artistNeedles = splitQueryWords(texts[0]).required;
  const deezerOrder = new Map(); // recording key -> position in Deezer's own list
  candidates
    .filter((track) => !isPlayableLane(track))
    .forEach((track, position) => {
      const key = recordingKeyOf(track);
      if (key && !deezerOrder.has(key)) deezerOrder.set(key, position);
    });

  // Score each query over the whole strict pool and keep a track's best score among the queries it matches. The
  // scorer reads the cleaned view of a track ("Artist - Song feat. X" is the song's own title), the raw track
  // only when the cleaning took away a word the query holds.
  const best = new Map();
  for (const text of texts) {
    const relevant = strict.filter((track) => isRelevantSearchResult(track, requiredText(text)));
    const views = new Map(relevant.map((track) => [track, scoringView(track)]));
    const options = { withScores: true, dedupe: false, trimSingleWord: false };
    const viewed = new Map(rankSearchResults([...views.values()], text, options).map((entry) => [entry.track, entry]));
    const raw = new Map(rankSearchResults(relevant, text, options).map((entry) => [entry.track, entry]));
    for (const track of relevant) {
      const view = views.get(track);
      const entry = viewKeepsQuery(track, view, text) ? viewed.get(view) : raw.get(track);
      const known = best.get(track);
      if (entry && (!known || entry.effectiveScore > known.score)) best.set(track, { track, score: entry.effectiveScore, plain: entry.score });
    }
  }

  for (const entry of best.values()) {
    entry.score -= bulkPenalty(entry.track, texts);
    if (splitArtistCredit(entry.track.info.title, entry.track.info.author).credit === "title") entry.score -= FAN_UPLOAD_PENALTY;
    if (texts.some((text) => matchesArtistThenTitle(entry.track, splitQueryWords(text).required))) entry.score += SPLIT_BONUS;
    if (!artistQuery) continue;
    if (matchesAuthor(entry.track, artistNeedles)) {
      entry.score += ARTIST_BONUS;
      if (authorTokens(entry.track).length === artistNeedles.length) entry.score += SOLE_ARTIST_BONUS;
      // Deezer lists an artist's songs by how much they are played.
      const position = deezerOrder.get(recordingKeyOf(entry.track));
      if (position !== undefined) entry.score += Math.max(0, 90 - position * 9);
    } else if (matchesTitle(entry.track, artistNeedles) && !titleCredits(entry.track, artistNeedles)) {
      entry.score -= TITLE_ONLY_PENALTY;
    }
  }

  // One entry per recording: its best playable copy, or none (then the Deezer copy is a hint). The recording
  // scores what its best copy scored, plus what its copies say together.
  const maxPopularity = Math.max(0, ...[...best.keys()].map((track) => Number(track.searchPopularity) || 0));
  const byRecording = new Map();
  for (const entry of best.values()) {
    const key = groupKeyOf(entry.track);
    if (!byRecording.has(key)) byRecording.set(key, []);
    byRecording.get(key).push(entry);
  }
  const recordings = [...byRecording.values()].map((entries) => {
    const lanes = new Set(entries.map((entry) => laneOf(entry.track)));
    const share = maxPopularity ? Math.max(...entries.map((entry) => Number(entry.track.searchPopularity) || 0)) / maxPopularity : 0;
    const agreement = lanes.has("ytm") && lanes.has("yt") ? LANE_AGREEMENT_BONUS : 0;
    const copy = pickCopy(entries, texts) || entries.find((entry) => !isPlayableLane(entry.track)) || entries[0];
    const base = Math.max(...entries.map((entry) => entry.plain));
    const top = Math.max(...entries.map((entry) => entry.score));
    const deezer = entries.find((entry) => !isPlayableLane(entry.track))?.track || null;
    // Only a fan or lyric channel carries it, and a catalogue knows it: the provider's own copy is worth a look.
    const weak = Boolean(deezer) && isPlayableLane(copy.track) && laneOf(copy.track) === "yt" && splitArtistCredit(copy.track.info.title, copy.track.info.author).credit === "title";
    return { track: copy.track, deezer, weak, base, byArtist: artistQuery && entries.some((entry) => matchesAuthor(entry.track, artistNeedles)), score: top + share * POPULARITY_WEIGHT + agreement, backed: share > 0 || lanes.size > 1 };
  });
  recordings.sort((left, right) => right.score - left.score);
  const oneWord = artistNeedles.length === 1;
  // The window is measured on the match score alone (the bot's cut does the same), so the evidence a result gets
  // cannot push its rivals out. The songs of the artist an artist query names are not cut: a long title scores low.
  const bestBase = Math.max(...recordings.map((entry) => entry.base));
  const kept = oneWord ? recordings.filter((entry) => entry.backed || entry.byArtist || entry.base >= bestBase - ONE_WORD_WINDOW) : recordings;

  const ordered = kept.map(({ track, score, deezer, weak }) => ({ track, score, deezer, weak }));
  // A hint is a Deezer recording with no playable copy, or (`replaces`) one whose only copy is a fan upload.
  // Swapping a fan copy for the catalogue's is a nicety, so it gets a smaller share of the lookups.
  let weakLeft = artistQuery ? 2 : MAX_WEAK_HINTS;
  const hints = ordered
    .map((entry, rank) => ({ entry, rank }))
    .filter(({ entry, rank }) => rank < HINT_TOP_RANKS && !playIssueOf(entry.track) && (!isPlayableLane(entry.track) || entry.weak) && matchesExactly(entry.weak ? entry.deezer : entry.track, texts))
    .filter(({ entry }) => !entry.weak || weakLeft-- > 0)
    .slice(0, artistQuery ? MAX_ARTIST_HINTS : MAX_HINTS)
    .map(({ entry }) => (entry.weak ? { track: entry.deezer, score: entry.score, replaces: entry.track } : { track: entry.track, score: entry.score }));

  const items = ordered
    .filter((entry) => isPlayableLane(entry.track))
    .map(({ track, score }) => ({ track, score, tier: playIssueOf(track) ? "blocked" : "main" }));

  // Few matches: the provider's own first results, which the strict words may have missed.
  const mainCount = items.filter((item) => item.tier === "main").length;
  if (mainCount < LOOSE_WHEN_FEWER_THAN) {
    const known = new Set([...best.keys(), ...items.map((item) => item.track)]);
    const floor = Math.min(0, ...items.map((item) => item.score)) - 50;
    candidates
      .filter((track) => laneOf(track) === "ytm" && !known.has(track) && Number(track.searchRank) < LOOSE_POSITIONS && !playIssueOf(track) && matchesPartly(track, texts))
      .forEach((track, index) => items.push({ track, score: floor - index, tier: "loose" }));
  }

  const rankOfTier = { main: 0, loose: 1, blocked: 2 };
  items.sort((left, right) => rankOfTier[left.tier] - rankOfTier[right.tier] || right.score - left.score);
  return { items: items.slice(0, limit), hints };
}

// A Deezer hint's YouTube Music copy has to be the same recording: close in length to the Deezer track.
function isSameLength(referenceMs, candidateMs) {
  if (!referenceMs || !candidateMs) return true;
  return Math.abs(referenceMs - candidateMs) <= Math.max(20_000, referenceMs * 0.15);
}

/** The first YouTube Music result that is the Deezer hint's recording, or null. */
function pickHintCopy(hint, tracks) {
  const text = `${hint.track.info.author || ""} ${hint.track.info.title || ""}`;
  return (
    (Array.isArray(tracks) ? tracks : []).find(
      (track) =>
        track?.info &&
        !track.info.isStream &&
        isPlayableLane(track) &&
        !playIssueOf(track) &&
        !isNoiseUpload(track, [text]) &&
        isSameLength(hint.track.info.length, track.info.length) &&
        isRelevantSearchResult(track, text)
    ) || null
  );
}

/** Puts the resolved copies of Deezer hints into the ranked items, at the rank the hint had. */
function placeResolvedHints(items, resolved, limit = MAX_RESULTS) {
  const known = new Set(items.map((item) => identityOf(item.track)));
  const keys = new Set(items.map((item) => recordingKeyOf(item.track)).filter(Boolean));
  const result = [...items];
  for (const { hint, track } of resolved) {
    if (!track || known.has(identityOf(track))) continue;
    if (hint.replaces) {
      // The catalogue's own copy takes the place of the fan upload that stood for the recording.
      const at = result.findIndex((item) => item.track === hint.replaces);
      if (at < 0) continue;
      known.add(identityOf(track));
      result[at] = { track, score: result[at].score, tier: result[at].tier, via: "deezer" };
      continue;
    }
    const key = recordingKeyOf(track);
    if (key && keys.has(key)) continue;
    known.add(identityOf(track));
    result.push({ track, score: hint.score, tier: "main", via: "deezer" });
  }
  const rankOfTier = { main: 0, loose: 1, blocked: 2 };
  return result.sort((left, right) => rankOfTier[left.tier] - rankOfTier[right.tier] || right.score - left.score).slice(0, limit);
}

function isLaneResting(lane, now = Date.now()) {
  const health = laneHealth.get(lane);
  return Boolean(health && health.failures >= LANE_FAILURE_STREAK && now < health.restUntil);
}

function recordLane(lane, failed) {
  if (!failed) {
    laneHealth.delete(lane);
    return;
  }
  const failures = (laneHealth.get(lane)?.failures || 0) + 1;
  laneHealth.set(lane, { failures, restUntil: failures >= LANE_FAILURE_STREAK ? Date.now() + LANE_COOLDOWN_MS : 0 });
}

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// One provider request, remembered for two minutes (retyped queries, the same query from two players) and
// shared while it is still running. The tracks carry the lane and their position in it.
function askLane(poru, lane, query) {
  const key = `${lane}\u0000${normalizeText(query)}`;
  const cached = laneCache.get(key);
  if (cached && Date.now() - cached.at < LANE_CACHE_TTL_MS) return cached.promise;

  const promise = Promise.resolve()
    .then(() => poru.resolve({ query, source: LANES[lane] }))
    .then((result) => {
      const failed = result?.loadType === "error";
      recordLane(lane, failed);
      if (failed) laneCache.delete(key);
      const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
      tracks.forEach((track, position) => {
        track.searchLane = lane;
        track.searchRank = position;
      });
      return tracks;
    })
    .catch(() => {
      recordLane(lane, true);
      laneCache.delete(key);
      return [];
    });
  laneCache.set(key, { at: Date.now(), promise });
  while (laneCache.size > MAX_LANE_CACHE_ENTRIES) laneCache.delete(laneCache.keys().next().value);
  return promise;
}

async function askLanes(poru, requests) {
  const settled = await Promise.all(requests.map(({ lane, query }) => withDeadline(askLane(poru, lane, query), LANE_TIMEOUT_MS)));
  return settled.flatMap((tracks) => tracks || []);
}

// YouTube answers a bare word ("mayday", "blue") with events, shows and kids' videos; the same words with "song"
// after them list the songs people play, best known first. A second YouTube request asks it for short titles.
const SONG_LANE_MAX_WORDS = 2;

function isShortTitleQuery(text) {
  const { required, optional } = splitQueryWords(text);
  return !optional.length && required.length <= SONG_LANE_MAX_WORDS;
}

/**
 * The pool for one query text: the first pass asks YouTube Music, YouTube and Deezer together. A thin pool
 * adds the other providers and the accent variants ("cieple" -> "ciepłe"), as the bot's search does.
 */
async function searchPool(poru, text, { popularity = true } = {}) {
  const [original, ...variants] = buildSearchQueries(text, { limit: ACCENT_VARIANTS });
  if (!original) return [];
  const popularityLookup = popularity && isSearchPopularityEnabled() ? lookupSearchPopularity(original).catch(() => null) : null;

  const requests = FIRST_LANES.map((lane) => ({ lane, query: original }));
  if (isShortTitleQuery(original)) requests.push({ lane: "yt", query: `${original} song` });
  const pool = await askLanes(poru, requests);
  const relevant = pool.filter((track) => isPlayableLane(track) && isRelevantSearchResult(track, requiredText(original)));
  if (relevant.length < MIN_RELEVANT_RESULTS) {
    const now = Date.now();
    const more = [
      ...EXTRA_LANES.filter((lane) => !isLaneResting(lane, now)).map((lane) => ({ lane, query: original })),
      ...variants.flatMap((query) => FIRST_LANES.map((lane) => ({ lane, query }))),
    ];
    pool.push(...(await askLanes(poru, more)));
  }
  if (popularityLookup) annotateSearchPopularity(pool, await popularityLookup);
  return pool;
}

async function resolveHints(poru, hints) {
  const settled = await Promise.all(
    hints.map(async (hint) => {
      const text = `${hint.track.info.author || ""} ${hint.track.info.title || ""}`.trim();
      const tracks = await withDeadline(askLane(poru, "ytm", text), HINT_TIMEOUT_MS);
      return { hint, track: pickHintCopy(hint, tracks) };
    })
  );
  return settled.filter(({ track }) => track);
}

/**
 * Searches for the song select. Returns { tracks, correction, suggestions } like the bot's
 * searchActivityTracks; each track may carry `searchVia: "deezer"` (found through a Deezer hint) and
 * `playIssue` ("too_long").
 */
async function searchGameSongs(poru, query, { exact = false, getSuggestions } = {}) {
  const result = await searchWithCorrection(query, (text) => searchPool(poru, text), { exact, ...(getSuggestions ? { getSuggestions } : null) });
  const typed = String(query || "").trim();
  const { items, hints } = rankGameResults(result.tracks, { queries: [typed, result.rankQuery] });
  const resolved = hints.length ? await resolveHints(poru, hints) : [];
  const placed = resolved.length ? placeResolvedHints(items, resolved) : items;
  return {
    tracks: placed.map((item) => {
      item.track.playIssue = playIssueOf(item.track);
      if (item.via) item.track.searchVia = item.via;
      return item.track;
    }),
    correction: result.correction,
    suggestions: result.suggestions,
  };
}

// A pasted link is loaded as it is. The load can take a while on a cold provider, so it has its own deadline.
const LINK_TIMEOUT_MS = 8_000;
const MAX_LINK_TRACKS = 48;

function linkFailure(link, error) {
  return { tracks: [], link: { provider: link?.provider ?? null, kind: null, name: null, total: 0, error } };
}

// The Deezer track's YouTube Music copy (the game plays from YouTube), or null.
async function deezerCopyOf(poru, track) {
  const text = `${track.info.author || ""} ${track.info.title || ""}`.trim();
  const found = await withDeadline(askLane(poru, "ytm", text), LANE_TIMEOUT_MS * 2);
  return pickHintCopy({ track }, found);
}

/**
 * Loads what a pasted link points at. `link` is parseSongLink's answer. Returns { tracks, link } where
 * `link` is { provider, kind: "track" | "playlist" | null, name, total, error }; `error` is one of
 * "unsupported_host", "profile", "playlist_unsupported", "not_found", "failed", "no_copy" or null. A single song is
 * the only track; a playlist or an album lists its songs (never just its first one). Tracks carry `playIssue`:
 * a live stream or a song over the length limit is listed and marked, not hidden.
 */
async function searchSongLink(poru, link) {
  if (!link?.supported) return linkFailure(link, "unsupported_host");
  if (link.pageKind === "profile") return linkFailure(link, "profile");
  if (link.pageKind === "list" && link.provider === "deezer") return linkFailure(link, "playlist_unsupported");

  let result;
  try {
    result = await withDeadline(Promise.resolve().then(() => poru.resolve({ query: link.url })), LINK_TIMEOUT_MS);
  } catch {
    return linkFailure(link, "failed");
  }
  if (!result || result.loadType === "error") return linkFailure(link, "failed");
  const tracks = (Array.isArray(result.tracks) ? result.tracks : []).filter((track) => track?.info?.uri);
  if (result.loadType === "empty" || !tracks.length) return linkFailure(link, "not_found");

  if (result.loadType === "playlist") {
    if (link.provider === "deezer") return linkFailure(link, "playlist_unsupported");
    const listed = tracks.slice(0, MAX_LINK_TRACKS);
    listed.forEach((track) => {
      track.playIssue = playIssueOf(track);
    });
    return { tracks: listed, link: { provider: link.provider, kind: "playlist", name: result.playlistInfo?.name || null, total: tracks.length, error: null } };
  }

  // "track" (a search result is not what a link answers with, but only its first song could be meant).
  let track = tracks[0];
  if (!isPlayableLane(track)) {
    const copy = await deezerCopyOf(poru, track).catch(() => null);
    if (!copy) return linkFailure(link, "no_copy");
    copy.searchVia = "deezer";
    track = copy;
  }
  track.playIssue = playIssueOf(track);
  return { tracks: [track], link: { provider: link.provider, kind: "track", name: null, total: 1, error: null } };
}

function clearSongSearchCache() {
  laneCache.clear();
  laneHealth.clear();
}

module.exports = {
  MAX_PLAY_MS,
  clearSongSearchCache,
  detectArtistQuery,
  isNoiseUpload,
  pickHintCopy,
  placeResolvedHints,
  playIssueOf,
  rankGameResults,
  recordingKeyOf,
  searchGameSongs,
  searchSongLink,
  splitArtistCredit,
  splitQueryWords,
};
