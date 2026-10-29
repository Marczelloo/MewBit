const Log = require("../logs/log");
const { matchTokens } = require("./searchMatching");
const { normalizeComparableText } = require("./trackNormalization");

// YouTube's public query suggestions: the same list its own search box shows.
// It already knows that "metalica nothing els" means "metallica nothing else
// matters", which no amount of fuzzy ranking can recover when the providers
// never returned that song for the misspelt query.
const SUGGEST_URL = "https://suggestqueries.google.com/complete/search";
const SUGGEST_TIMEOUT_MS = 700;
const SUGGEST_CACHE_TTL_MS = 10 * 60_000;
const FAILED_SUGGEST_CACHE_TTL_MS = 30_000;
const MAX_SUGGEST_CACHE_ENTRIES = 500;
const MAX_SUGGESTIONS = 8;
// Every typed word must still be recognisable in a suggestion for it to count
// as a correction rather than a different search.
const MIN_WORD_CREDIT = 0.75;

const suggestionCache = new Map();
const inFlightSuggestions = new Map();

function isSuggestionsEnabled() {
  return String(process.env.SEARCH_SUGGESTIONS ?? "true").trim().toLowerCase() !== "false";
}

function normalizeQuery(query) {
  return String(query || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

async function requestYouTubeSuggestions(query) {
  // `client=firefox` answers with plain JSON: [query, [suggestion, ...], ...].
  const params = new URLSearchParams({ client: "firefox", ds: "yt", ie: "utf-8", oe: "utf-8", q: query });
  const response = await fetch(`${SUGGEST_URL}?${params}`, { signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.[1]) ? body[1] : [];
}

function setCachedSuggestions(key, suggestions, ttlMs) {
  suggestionCache.set(key, { expiresAt: Date.now() + ttlMs, suggestions });
  while (suggestionCache.size > MAX_SUGGEST_CACHE_ENTRIES) suggestionCache.delete(suggestionCache.keys().next().value);
}

/**
 * Query suggestions for what the user typed, most popular first. Failures and
 * timeouts return an empty list: search works without them, just less forgiving.
 */
async function getSearchSuggestions(query, { request = requestYouTubeSuggestions } = {}) {
  const text = normalizeQuery(query);
  if (text.length < 2 || !isSuggestionsEnabled()) return [];

  const key = text.toLowerCase();
  const cached = suggestionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.suggestions;
  if (inFlightSuggestions.has(key)) return inFlightSuggestions.get(key);

  const pending = Promise.resolve()
    .then(() => request(text))
    .then((suggestions) => {
      const cleaned = [...new Set((Array.isArray(suggestions) ? suggestions : []).map(normalizeQuery).filter(Boolean))].slice(
        0,
        MAX_SUGGESTIONS
      );
      setCachedSuggestions(key, cleaned, SUGGEST_CACHE_TTL_MS);
      return cleaned;
    })
    .catch((error) => {
      Log.debug("Search suggestion lookup failed", error.message);
      // Remember the failure briefly so a dead endpoint costs one timeout per
      // query, not one per keystroke.
      setCachedSuggestions(key, [], FAILED_SUGGEST_CACHE_TTL_MS);
      return [];
    })
    .finally(() => inFlightSuggestions.delete(key));

  inFlightSuggestions.set(key, pending);
  return pending;
}

function getWords(text) {
  return normalizeComparableText(text).split(" ").filter(Boolean);
}

/**
 * Picks the suggestion that fixes a misspelt word, or null when the query
 * needs no fixing. A suggestion that keeps every typed word as written (the
 * last one may still be half typed) means the query is already right, so a
 * fuzzier alternative is never forced on it.
 */
function findSearchCorrection(query, suggestions) {
  const words = getWords(query);
  if (!words.length) return null;
  // Callers trim the query, so the last word may always still be half typed.
  const prefixWord = words[words.length - 1];

  let correction = null;
  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const suggestionWords = getWords(suggestion);
    const match = matchTokens(words, suggestionWords, { prefixToken: prefixWord });
    if (match.credits.some((credit) => credit < MIN_WORD_CREDIT)) continue;

    const keepsEveryWord = words.every(
      (word) => suggestionWords.includes(word) || (word === prefixWord && suggestionWords.some((candidate) => candidate.startsWith(word)))
    );
    if (keepsEveryWord) return null;
    correction ??= suggestion;
  }
  return correction;
}

/**
 * Runs `search` for the query and, in parallel, looks up suggestions. When a
 * suggestion corrects the query, the corrected search starts as soon as the
 * suggestions arrive and its tracks lead the pool. Callers rank the pool
 * against `rankQuery`. `exact` keeps the query as typed ("search instead for").
 */
async function searchWithCorrection(query, search, { exact = false, getSuggestions = getSearchSuggestions } = {}) {
  const text = normalizeQuery(query);
  const [originalTracks, corrected] = await Promise.all([
    search(text),
    getSuggestions(text).then(async (suggestions) => {
      const correction = exact ? null : findSearchCorrection(query, suggestions);
      return { suggestions, correction, tracks: correction ? await search(correction) : [] };
    }),
  ]);

  const shown = new Set([text.toLowerCase(), corrected.correction?.toLowerCase()]);
  return {
    tracks: [...corrected.tracks, ...(Array.isArray(originalTracks) ? originalTracks : [])],
    rankQuery: corrected.correction || text,
    correction: corrected.correction,
    suggestions: corrected.suggestions.filter((suggestion) => !shown.has(suggestion.toLowerCase())),
  };
}

function clearSuggestionCache() {
  suggestionCache.clear();
  inFlightSuggestions.clear();
}

module.exports = {
  MAX_SUGGESTIONS,
  clearSuggestionCache,
  findSearchCorrection,
  getSearchSuggestions,
  searchWithCorrection,
};
