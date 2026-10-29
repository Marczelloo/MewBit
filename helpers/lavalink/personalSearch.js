const searchHistory = require("../history/searchHistory");
const playlistStore = require("../playlists/store");
const { filterPlayableSearchResults, rankSearchResults } = require("./searchRanking");

// The user's own library answers a search before any provider does: liked
// songs, their playlists and what they searched and played before. It is
// local, so it can be matched on every keystroke and shown instantly while
// the provider search is still running.
const LIBRARY_TTL_MS = 30_000;
const MAX_CACHED_LIBRARIES = 200;
const MAX_HISTORY_ENTRIES = 100;
const DEFAULT_LIMIT = 5;
// Earlier origins win ties and duplicates: a liked song is a stronger signal
// than a playlist entry, and both outrank a one-off search.
const ORIGINS = ["liked", "playlist", "history"];

const libraries = new Map();

function toLibraryTrack(stored, origin) {
  const uri = String(stored?.uri || "").trim();
  const title = String(stored?.title || "").trim();
  if (!/^https?:\/\//i.test(uri) || !title) return null;
  return {
    info: {
      title,
      author: String(stored.author || "").trim(),
      uri,
      identifier: stored.identifier || null,
      length: Number(stored.length) || 0,
      artworkUrl: stored.artworkUrl || null,
      sourceName: stored.sourceName || stored.source || null,
    },
    personal: origin,
  };
}

/**
 * One deduplicated list of the user's tracks, strongest origin first.
 */
function buildLibrary({ history = [], playlists = [] } = {}) {
  const byOrigin = { liked: [], playlist: [], history: [] };
  for (const playlist of playlists) {
    const origin = playlist?.name === "Liked Songs" ? "liked" : "playlist";
    for (const track of Array.isArray(playlist?.tracks) ? playlist.tracks : []) byOrigin[origin].push(track);
  }
  for (const entry of history) byOrigin.history.push(entry?.track);

  const seen = new Set();
  const tracks = [];
  for (const origin of ORIGINS) {
    for (const stored of byOrigin[origin]) {
      const track = toLibraryTrack(stored, origin);
      if (!track || seen.has(track.info.uri)) continue;
      seen.add(track.info.uri);
      tracks.push(track);
    }
  }
  return tracks;
}

function readLibrary(userId, guildId) {
  return buildLibrary({
    history: searchHistory.getHistory(userId, null, MAX_HISTORY_ENTRIES),
    playlists: [
      ...playlistStore.listPlaylists(userId, guildId, "user"),
      ...playlistStore.listPlaylists(userId, guildId, "server"),
    ],
  });
}

// The stores read JSON from disk on every call; a short cache keeps that to
// one read per user while they type.
function getLibrary(userId, guildId, read) {
  const key = `${userId}:${guildId || ""}`;
  const cached = libraries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;

  const tracks = read(userId, guildId);
  libraries.delete(key);
  libraries.set(key, { expiresAt: Date.now() + LIBRARY_TTL_MS, tracks });
  while (libraries.size > MAX_CACHED_LIBRARIES) libraries.delete(libraries.keys().next().value);
  return tracks;
}

/**
 * The user's library tracks that match the query, ranked with the same
 * typo-tolerant relevance as provider results.
 */
function findLibraryMatches(library, query, { limit = DEFAULT_LIMIT } = {}) {
  const text = String(query || "").trim();
  if (text.length < 2 || !library.length) return [];
  return rankSearchResults(filterPlayableSearchResults(library, text), text, { limit });
}

function getPersonalSearchTracks(userId, guildId, query, { limit = DEFAULT_LIMIT, read = readLibrary } = {}) {
  if (!userId) return [];
  return findLibraryMatches(getLibrary(userId, guildId, read), query, { limit });
}

function clearLibraryCache() {
  libraries.clear();
}

module.exports = {
  buildLibrary,
  clearLibraryCache,
  findLibraryMatches,
  getPersonalSearchTracks,
};
