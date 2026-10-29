const { MAX_VARIANTS, buildSearchQueries } = require("./searchQueryVariants");
const { filterRelevantSearchResults } = require("./searchRanking");
const { getSearchPrefix } = require("./searchSources");

// Provider catalogues barely change within minutes, and Activity users retype
// and revisit the same queries, so a cached pool saves whole Lavalink rounds.
const CACHE_TTL_MS = 2 * 60_000;
const MAX_SEARCH_CACHE_ENTRIES = Math.max(20, Number(process.env.SEARCH_CACHE_MAX_ENTRIES ?? 240));
const MAX_RESULTS_PER_SOURCE = 50;
const SOURCE_TIMEOUT_MS = 1_500;
// A lane that already found this many relevant tracks is good enough; the
// remaining lanes and accent variants only run when it came back weak.
const MIN_RELEVANT_RESULTS = 3;
const searchCache = new Map();
const inFlightSearches = new Map();

// YouTube Music is usually better for songs, while regular YouTube has a
// wider catalogue. Regular YouTube is the fallback lane, so a missing/blocked
// YTM result cannot hide a valid regular YouTube result.
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

/**
 * The first pass asks the primary lane with the query as typed. Only when that
 * finds fewer than MIN_RELEVANT_RESULTS relevant tracks does the second pass
 * ask the other lanes and the Polish accent variants ("cieple" → "ciepłe"),
 * which turns the usual 2–8 requests per provider into one.
 */
function getSearchPlan(query, source, { variantLimit } = {}) {
  const prefixes = SEARCH_VARIANTS[source] || [getSearchPrefix(source)];
  const [original, ...variants] = buildSearchQueries(query, { limit: getVariantLimit(variantLimit) });
  const [primaryPrefix, ...otherPrefixes] = prefixes;
  return {
    first: [{ prefix: primaryPrefix, query: original }],
    second: [
      ...otherPrefixes.map((prefix) => ({ prefix, query: original })),
      ...prefixes.flatMap((prefix) => variants.map((variant) => ({ prefix, query: variant }))),
    ],
  };
}

function waitUntil(promise, deadline) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function searchSource(poru, query, source, options = {}) {
  const deadline = Date.now() + SOURCE_TIMEOUT_MS;
  const { first, second } = getSearchPlan(query, source, options);
  // One slot per request keeps results in plan order however they arrive, and
  // a slow request no longer throws away the tracks its faster siblings found.
  const slots = [];
  const collect = () => deduplicateTracks(slots.flat());
  const run = (requests) =>
    waitUntil(
      Promise.allSettled(
        requests.map((request) => {
          const slot = [];
          slots.push(slot);
          // Poru prepends its default platform when a source is not passed.
          // Put the Lavalink search prefix in `source`, otherwise
          // `dzsearch:foo` turns into a real request for `ytsearch:dzsearch:foo`.
          return Promise.resolve()
            .then(() => poru.resolve({ query: request.query, source: request.prefix }))
            .then((result) => {
              if (Array.isArray(result?.tracks)) slot.push(...result.tracks);
            });
        })
      ),
      deadline
    );

  await run(first);
  if (second.length && Date.now() < deadline && filterRelevantSearchResults(collect(), query).length < MIN_RELEVANT_RESULTS) {
    await run(second);
  }

  return collect().slice(0, MAX_RESULTS_PER_SOURCE);
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
    searchSource(poru, query, normalizedSource, { variantLimit: limit })
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
      sources.map((source) => searchSource(poru, query, source, { variantLimit: limit }))
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
  MIN_RELEVANT_RESULTS,
  MAX_SEARCH_CACHE_ENTRIES,
  MAX_RESULTS_PER_SOURCE,
  SEARCH_VARIANTS,
  clearSearchCache,
  getSearchCacheSize: () => searchCache.size,
  searchSingleSource,
  searchAcrossSources,
};
