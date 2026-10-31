const Log = require("../logs/log");
const { getLastFmSimilarTracks } = require("./lastfmClient");
const { filterPlayableSearchResults, rankSearchResults } = require("./searchRanking");
const { cleanTrackMetadata } = require("./trackNormalization");

// "Similar to" under the top search result: Last.fm neighbours of that
// recording, each resolved to one playable track. The answer barely changes,
// so it is cached long enough to survive a user refining the same search.
const SIMILAR_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_REFERENCES = 200;
const DEFAULT_LIMIT = 6;
// Ask Last.fm for more than we show: some neighbours fail to resolve and a
// few artists would otherwise fill the whole row.
const FETCH_MULTIPLIER = 2;
const MAX_PER_ARTIST = 2;
const RESOLVE_CONCURRENCY = 3;

const cache = new Map();
const inFlight = new Map();

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function pickNeighbours(similar, reference, limit) {
  const perArtist = new Map();
  const picked = [];
  for (const track of similar) {
    const artist = String(track.artist || "").toLowerCase();
    // Last.fm sometimes lists the reference recording itself.
    if (artist === reference.searchArtist.toLowerCase() && String(track.title).toLowerCase() === reference.cleanTitle.toLowerCase()) continue;
    const count = perArtist.get(artist) || 0;
    if (count >= MAX_PER_ARTIST) continue;
    perArtist.set(artist, count + 1);
    picked.push(track);
    if (picked.length >= limit * FETCH_MULTIPLIER) break;
  }
  return picked;
}

async function resolveNeighbour(neighbour, search) {
  const query = `${neighbour.artist} ${neighbour.title}`;
  try {
    const tracks = await search(query);
    return rankSearchResults(filterPlayableSearchResults(tracks, query), query, { limit: 1 })[0] || null;
  } catch (error) {
    Log.debug("Similar track resolution failed", error.message);
    return null;
  }
}

async function loadSimilar(reference, { limit, lookup, search }) {
  const similar = await lookup({ artist: reference.searchArtist, title: reference.cleanTitle, limit: limit * FETCH_MULTIPLIER * 2 });
  const neighbours = pickNeighbours(similar, reference, limit);
  const resolved = await mapWithConcurrency(neighbours, RESOLVE_CONCURRENCY, (neighbour) => resolveNeighbour(neighbour, search));

  const seen = new Set();
  const tracks = [];
  for (const track of resolved) {
    const uri = track?.info?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    tracks.push(track);
    if (tracks.length >= limit) break;
  }
  return tracks;
}

/**
 * Playable tracks similar to one search result. `search(query)` resolves a
 * text query to provider tracks; `lookup` defaults to Last.fm and returns
 * nothing without an API key.
 */
async function getSimilarSearchTracks({ title, author } = {}, { search, limit = DEFAULT_LIMIT, lookup = getLastFmSimilarTracks } = {}) {
  const reference = cleanTrackMetadata(title, author);
  if (!reference.cleanTitle || !reference.searchArtist || typeof search !== "function") return [];

  const key = `${reference.searchArtist.toLowerCase()}|${reference.cleanTitle.toLowerCase()}|${limit}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = loadSimilar(reference, { limit, lookup, search })
    .catch((error) => {
      Log.debug("Similar track lookup failed", error.message);
      return [];
    })
    .then((tracks) => {
      cache.delete(key);
      cache.set(key, { expiresAt: Date.now() + SIMILAR_TTL_MS, tracks });
      while (cache.size > MAX_CACHED_REFERENCES) cache.delete(cache.keys().next().value);
      return tracks;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

function clearSimilarCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = {
  clearSimilarCache,
  getSimilarSearchTracks,
};
