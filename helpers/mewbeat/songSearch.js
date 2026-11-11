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

const { matchTokens } = require("../lavalink/searchMatching");
const { buildSearchQueries } = require("../lavalink/searchQueryVariants");
const { annotateSearchPopularity, isSearchPopularityEnabled, lookupSearchPopularity } = require("../lavalink/searchPopularity");
const { getConsensusKey, isRelevantSearchResult, normalizeText, rankSearchResults } = require("../lavalink/searchRanking");
const { searchWithCorrection } = require("../lavalink/searchSuggestions");
const { cleanArtistName } = require("../lavalink/trackNormalization");

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
    const key = getConsensusKey(track) || track?.info?.identifier;
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

/**
 * Orders a pool of tracks for the song select. `queries` is the query as typed first, then the corrected
 * one when there is one. Returns `items` ({ track, score, tier }; tier is "main", "loose" or "blocked", in the
 * order to show) and `hints`, Deezer recordings that rank well and have no playable copy in the pool.
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
      const key = getConsensusKey(track);
      if (key && !deezerOrder.has(key)) deezerOrder.set(key, position);
    });

  // Score each query over the whole strict pool and keep a track's best score among the queries it matches.
  const best = new Map();
  for (const text of texts) {
    const relevant = strict.filter((track) => isRelevantSearchResult(track, requiredText(text)));
    for (const entry of rankSearchResults(relevant, text, { withScores: true, dedupe: false })) {
      const known = best.get(entry.track);
      if (!known || entry.effectiveScore > known.score) best.set(entry.track, { track: entry.track, score: entry.effectiveScore });
    }
  }

  for (const entry of best.values()) {
    entry.score -= bulkPenalty(entry.track, texts);
    if (texts.some((text) => matchesArtistThenTitle(entry.track, splitQueryWords(text).required))) entry.score += SPLIT_BONUS;
    if (!artistQuery) continue;
    if (matchesAuthor(entry.track, artistNeedles)) {
      entry.score += ARTIST_BONUS;
      if (authorTokens(entry.track).length === artistNeedles.length) entry.score += SOLE_ARTIST_BONUS;
      // Deezer lists an artist's songs by how much they are played.
      const position = deezerOrder.get(getConsensusKey(entry.track));
      if (position !== undefined) entry.score += Math.max(0, 90 - position * 9);
    } else if (matchesTitle(entry.track, artistNeedles) && !titleCredits(entry.track, artistNeedles)) {
      entry.score -= TITLE_ONLY_PENALTY;
    }
  }

  // One entry per recording: the best playable copy, or none (then the Deezer copy is a hint).
  const groups = new Map();
  for (const entry of [...best.values()].sort((left, right) => right.score - left.score)) {
    const key = getConsensusKey(entry.track) || `id:${identityOf(entry.track)}`;
    const group = groups.get(key) || { playable: null, deezer: null };
    if (isPlayableLane(entry.track)) group.playable ??= entry;
    else group.deezer ??= entry;
    groups.set(key, group);
  }
  const ordered = [...groups.values()]
    .map((group) => group.playable || group.deezer)
    .sort((left, right) => right.score - left.score);
  const hints = ordered
    .map((entry, rank) => ({ entry, rank }))
    .filter(({ entry, rank }) => !isPlayableLane(entry.track) && rank < HINT_TOP_RANKS && !playIssueOf(entry.track) && matchesExactly(entry.track, texts))
    .slice(0, artistQuery ? MAX_ARTIST_HINTS : MAX_HINTS)
    .map(({ entry }) => entry);

  const items = ordered
    .filter((entry) => isPlayableLane(entry.track))
    .map((entry) => ({ ...entry, tier: playIssueOf(entry.track) ? "blocked" : "main" }));

  // Few matches: the provider's own first results, which the strict words may have missed.
  const mainCount = items.filter((item) => item.tier === "main").length;
  if (mainCount < LOOSE_WHEN_FEWER_THAN) {
    const known = new Set(items.map((item) => item.track));
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
  const keys = new Set(items.map((item) => getConsensusKey(item.track)).filter(Boolean));
  const result = [...items];
  for (const { hint, track } of resolved) {
    const key = getConsensusKey(track);
    if (!track || known.has(identityOf(track)) || (key && keys.has(key))) continue;
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

/**
 * The pool for one query text: the first pass asks YouTube Music, YouTube and Deezer together. A thin pool
 * adds the other providers and the accent variants ("cieple" -> "ciepłe"), as the bot's search does.
 */
async function searchPool(poru, text, { popularity = true } = {}) {
  const [original, ...variants] = buildSearchQueries(text, { limit: ACCENT_VARIANTS });
  if (!original) return [];
  const popularityLookup = popularity && isSearchPopularityEnabled() ? lookupSearchPopularity(original).catch(() => null) : null;

  const pool = await askLanes(poru, FIRST_LANES.map((lane) => ({ lane, query: original })));
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
  searchGameSongs,
  searchSongLink,
  splitQueryWords,
};
