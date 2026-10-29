const { MAX_VARIANTS, buildSearchQueries } = require("./searchQueryVariants");
const { getSearchPrefix } = require("./searchSources");

const CACHE_TTL_MS = 15_000;
const MAX_SEARCH_CACHE_ENTRIES = Math.max(20, Number(process.env.SEARCH_CACHE_MAX_ENTRIES ?? 240));
const MAX_RESULTS_PER_SOURCE = 50;
const SOURCE_TIMEOUT_MS = 1_500;
const searchCache = new Map();
const inFlightSearches = new Map();

// YouTube Music is usually better for songs, while regular YouTube has a
// wider catalogue. Query both so a missing/blocked YTM result cannot hide a
// valid regular YouTube result.
const SEARCH_VARIANTS = Object.freeze({
  deezer: ["dzsearch"],
  youtube: ["ytmsearch", "ytsearch"],
  spotify: ["spsearch"],
  soundcloud: ["scsearch"],
});

function normalizeCacheQuery(query) {
  return String(query || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getTrackSearchKey(track) {
  const encoded = track?.encoded || track?.track;
  if (typeof encoded === "string" && encoded) return `encoded:${encoded}`;

  const uri = track?.info?.uri;
  if (typeof uri === "string" && uri) return `uri:${uri}`;

  return `text:${String(track?.info?.author || "").toLowerCase().trim()}|${String(track?.info?.title || "")
    .toLowerCase()
    .trim()}`;
}

function deduplicateTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = getTrackSearchKey(track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCachedTracks(cacheKey) {
  const cached = searchCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    searchCache.delete(cacheKey);
    return null;
  }
  // LRU refresh: frequently typed queries stay warm without unbounded growth.
  searchCache.delete(cacheKey);
  searchCache.set(cacheKey, cached);
  return cached.tracks;
}

function setCachedTracks(cacheKey, tracks) {
  searchCache.set(cacheKey, { timestamp: Date.now(), tracks });
  while (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value);
}

function runDeduplicatedSearch(cacheKey, search) {
  const existing = inFlightSearches.get(cacheKey);
  if (existing) return existing;
  const promise = Promise.resolve().then(search).finally(() => inFlightSearches.delete(cacheKey));
  inFlightSearches.set(cacheKey, promise);
  return promise;
}

// Every spelling variant costs one Lavalink load per provider prefix, so
// per-keystroke callers ask for fewer of them than a final search.
const AUTOCOMPLETE_VARIANT_LIMIT = 1;

function getVariantLimit(variantLimit) {
  return Number.isInteger(variantLimit) && variantLimit >= 0 ? variantLimit : MAX_VARIANTS;
}

async function searchSource(poru, query, source, { variantLimit } = {}) {
  const prefixes = SEARCH_VARIANTS[source] || [getSearchPrefix(source)];
  const queries = buildSearchQueries(query, { limit: getVariantLimit(variantLimit) });
  const settled = await Promise.allSettled(
    // Poru prepends its default platform when a source is not passed. Put
    // the Lavalink search prefix in `source`, otherwise `dzsearch:foo` turns
    // into a real request for `ytsearch:dzsearch:foo`.
    prefixes.flatMap((prefix) => queries.map((searchQuery) => poru.resolve({ query: searchQuery, source: prefix })))
  );

  return deduplicateTracks(
    settled.flatMap((result) =>
      result.status === "fulfilled" && Array.isArray(result.value?.tracks) ? result.value.tracks : []
    )
  )
    .slice(0, MAX_RESULTS_PER_SOURCE);
}

function searchSourceWithTimeout(poru, query, source, options) {
  return Promise.race([
    searchSource(poru, query, source, options),
    new Promise((resolve) => setTimeout(() => resolve([]), SOURCE_TIMEOUT_MS)),
  ]);
}

/**
 * Queries one provider only. Activity search uses this to avoid mixing a
 * loosely related result from another provider into an otherwise good list.
 */
async function searchSingleSource(poru, query, source, { variantLimit } = {}) {
  const normalizedQuery = normalizeCacheQuery(query);
  if (!poru || !normalizedQuery) return [];

  const normalizedSource = SEARCH_VARIANTS[source] ? source : "youtube";
  const limit = getVariantLimit(variantLimit);
  const cacheKey = `single:${normalizedSource}:v${limit}:${normalizedQuery}`;
  const cached = getCachedTracks(cacheKey);
  if (cached) return cached;

  const tracks = await runDeduplicatedSearch(cacheKey, () =>
    searchSourceWithTimeout(poru, query, normalizedSource, { variantLimit: limit })
  );
  setCachedTracks(cacheKey, tracks);
  return tracks;
}

/**
 * Searches every free provider in parallel. The selected source remains the
 * playback preference, but autocomplete ranks the combined result pool by
 * artist/title accuracy and popularity instead of hiding good matches from
 * another provider.
 */
async function searchAcrossSources(poru, query, { preferredSource = "deezer", variantLimit } = {}) {
  const normalizedQuery = normalizeCacheQuery(query);
  if (!poru || !normalizedQuery) return [];

  const limit = getVariantLimit(variantLimit);
  const cacheKey = `${preferredSource}:v${limit}:${normalizedQuery}`;
  const cached = getCachedTracks(cacheKey);
  if (cached) return cached;

  const allSources = ["deezer", "youtube", "spotify", "soundcloud"];
  const sources = [preferredSource, ...allSources.filter((source) => source !== preferredSource)];
  const tracks = await runDeduplicatedSearch(cacheKey, async () => {
    const settled = await Promise.allSettled(
      sources.map((source) => searchSourceWithTimeout(poru, query, source, { variantLimit: limit }))
    );
    return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  });
  setCachedTracks(cacheKey, tracks);
  return tracks;
}

function clearSearchCache() {
  searchCache.clear();
  inFlightSearches.clear();
}

module.exports = {
  AUTOCOMPLETE_VARIANT_LIMIT,
  CACHE_TTL_MS,
  MAX_SEARCH_CACHE_ENTRIES,
  MAX_RESULTS_PER_SOURCE,
  SEARCH_VARIANTS,
  clearSearchCache,
  getSearchCacheSize: () => searchCache.size,
  searchSingleSource,
  searchAcrossSources,
};
