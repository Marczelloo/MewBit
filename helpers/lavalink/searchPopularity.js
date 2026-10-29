const { cleanArtistName, getBaseTitle, getVariantKinds, normalizeComparableText } = require("./trackNormalization");

// Lavalink search results carry no popularity, so a cover with the exact title
// looks as good as the song everyone means. Deezer's public search ranks every
// recording by how much it is played (The Weeknd's "Blinding Lights" ~985k, its
// covers ~480–650k) and answers without a key in a few hundred milliseconds,
// alongside the provider lanes rather than after them.
const DEEZER_SEARCH_URL = "https://api.deezer.com/search/track";
const REQUEST_TIMEOUT_MS = 1_200;
const RESULT_LIMIT = 50;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 300;
const cache = new Map();
const inFlight = new Map();

function isEnabled() {
  return String(process.env.SEARCH_POPULARITY ?? "true").trim().toLowerCase() !== "false";
}

function normalizeQuery(query) {
  return normalizeComparableText(query);
}

const FEATURE_SEGMENT_PATTERN = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with|from)\s[^)\]]*[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s.*$/gi;

// "The Weeknd - Blinding Lights (Official Video)" by TheWeekndVEVO names the
// artist twice; Deezer's "Blinding Lights" does not. Guests and soundtrack
// credits differ between catalogues too, so neither is part of the key.
function getComparableTitle(artist, title) {
  const text = String(title || "");
  const dash = text.match(/^(.+?)\s[-–—]\s(.+)$/);
  const withoutArtist =
    dash && normalizeComparableText(cleanArtistName(dash[1])) === normalizeComparableText(cleanArtistName(artist))
      ? dash[2]
      : text;
  return withoutArtist.replace(FEATURE_SEGMENT_PATTERN, "").trim() || withoutArtist;
}

// The same key for a Deezer row and a provider track of the same recording:
// cleaned artist, base title and the versions that make it a different
// recording, so a remix keeps its own popularity rather than its original's.
function getRecordingKey(artist, rawTitle, { stripBrackets = false } = {}) {
  const title = getComparableTitle(artist, rawTitle);
  const author = normalizeComparableText(cleanArtistName(artist));
  const base = normalizeComparableText(getBaseTitle(stripBrackets ? title.replace(/\s*\[[^\]]*\]/g, "") : title));
  if (!author || !base) return null;
  const versions = getVariantKinds(title).filter((kind) => kind !== "remaster" && kind !== "edit" && kind !== "clean");
  return versions.length ? `${author}|${base}|${versions.sort().join(",")}` : `${author}|${base}`;
}

// "Sidney Polak, Pezet" or "Kendrick Lamar & SZA" on Spotify/YouTube; Deezer
// names the main artist only.
function getPrimaryArtist(artist) {
  return String(artist || "").split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0];
}

function getTrackKeys(track) {
  const title = track?.info?.title || "";
  const author = track?.info?.author || "";
  const primary = getPrimaryArtist(author);
  // YouTube uploads add their own square brackets ("[Cyberpunk Edgerunners
  // 2]") that no catalogue title has. Parentheses stay: "(November 1987,
  // Writing in Progress)" is a different recording than "One".
  return [
    ...new Set(
      [
        getRecordingKey(author, title),
        getRecordingKey(primary, title),
        getRecordingKey(author, title, { stripBrackets: true }),
        getRecordingKey(primary, title, { stripBrackets: true }),
      ].filter(Boolean)
    ),
  ];
}

function toPopularity(payload) {
  const byKey = new Map();
  const byDeezerId = new Map();
  let maxRank = 0;
  for (const row of Array.isArray(payload?.data) ? payload.data : []) {
    const rank = Number(row?.rank);
    if (!Number.isFinite(rank) || rank <= 0 || !row?.title || !row?.artist?.name) continue;
    if (row.id) byDeezerId.set(String(row.id), rank);
    const key = getRecordingKey(row.artist.name, row.title);
    if (key && rank > (byKey.get(key) || 0)) byKey.set(key, rank);
    maxRank = Math.max(maxRank, rank);
  }
  return { byKey, byDeezerId, maxRank };
}

async function fetchPopularity(query, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${DEEZER_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${RESULT_LIMIT}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response?.ok) return null;
    return toPopularity(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Deezer's play-count rank for the recordings matching `query`, or null when
 * the lookup is disabled, failed or timed out. Search must never wait on it
 * or fail because of it.
 */
async function lookupSearchPopularity(query, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const key = normalizeQuery(query);
  if (!key || typeof fetchImpl !== "function") return null;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = fetchPopularity(String(query).trim(), fetchImpl, timeoutMs)
    .then((value) => {
      // A failed lookup is not cached: the next keystroke may well succeed.
      if (value) {
        cache.delete(key);
        cache.set(key, { timestamp: Date.now(), value });
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      }
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function getTrackRank(track, popularity) {
  if (track?.info?.sourceName === "deezer" && track.info.identifier) {
    const rank = popularity.byDeezerId.get(String(track.info.identifier));
    if (rank) return rank;
  }
  return Math.max(0, ...getTrackKeys(track).map((key) => popularity.byKey.get(key) || 0));
}

/**
 * Stores the rank on each matching track as `searchPopularity`. Poru tracks
 * are class instances with methods, so they are annotated in place, never
 * copied. Returns how many tracks matched.
 */
function annotateSearchPopularity(tracks, popularity) {
  if (!popularity?.maxRank || !Array.isArray(tracks)) return 0;
  let matched = 0;
  for (const track of tracks) {
    const rank = getTrackRank(track, popularity);
    if (!rank) continue;
    track.searchPopularity = rank;
    matched += 1;
  }
  return matched;
}

function clearSearchPopularityCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  annotateSearchPopularity,
  clearSearchPopularityCache,
  getRecordingKey,
  getTrackKeys,
  isSearchPopularityEnabled: isEnabled,
  lookupSearchPopularity,
  toPopularity,
};
