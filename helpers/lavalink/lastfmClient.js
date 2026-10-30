const Log = require("../logs/log");
const { normalizeGenreTags } = require("./genreUtils");

const tagCache = new Map();
const TAG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function getCacheKey(artist, title, limit) {
  return `${String(artist || "").trim().toLowerCase()}|${String(title || "").trim().toLowerCase()}|${Number(limit) || 0}`;
}

function getArtistCacheKey(artist, limit) {
  return `artist:${String(artist || "").trim().toLowerCase()}|${Number(limit) || 0}`;
}

function getAlbumCacheKey(artist, album, limit) {
  return `album:${String(artist || "").trim().toLowerCase()}|${String(album || "").trim().toLowerCase()}|${Number(limit) || 0}`;
}

async function callLastFm(params) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return null;

  const query = new URLSearchParams({ ...params, api_key: apiKey, format: "json", autocorrect: "1" });
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`);
  if (!response.ok) return null;
  return response.json();
}

async function getLastFmSimilarTracks({ artist, title, limit = 10 } = {}) {
  if (!process.env.LASTFM_API_KEY || !artist || !title) return [];

  try {
    const data = await callLastFm({
      method: "track.getsimilar",
      artist,
      track: title,
      limit: String(limit),
    });
    return (data?.similartracks?.track || [])
      .filter((track) => track?.name && track?.artist?.name)
      .map((track) => ({
        title: track.name,
        artist: track.artist.name,
        match: Number(track.match) || 0,
      }));
  } catch (error) {
    Log.debug("Last.fm similar-track lookup failed", error.message);
    return [];
  }
}

/**
 * Gets the community tags attached to one exact recording. Tags are cached
 * because autoplay asks for the same reference tracks repeatedly while it
 * prefetches the next entry in a room.
 */
async function getLastFmTrackTags({ artist, title, limit = 8 } = {}) {
  if (!process.env.LASTFM_API_KEY || !artist || !title) return [];

  const cacheKey = getCacheKey(artist, title, limit);
  const cached = tagCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TAG_CACHE_TTL_MS) return cached.tags;

  try {
    const data = await callLastFm({
      method: "track.gettoptags",
      artist,
      track: title,
      // Pull a wider raw pool before dropping non-musical community labels;
      // otherwise a top-eight response full of "seen live" style tags can
      // erase every usable genre signal.
      limit: String(Math.max(Number(limit) * 3, 24)),
    });
    const tags = (data?.toptags?.tag || [])
      .filter((tag) => tag?.name)
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0))
      .map((tag) => String(tag.name).trim())
      .filter(Boolean);

    const normalizedTags = normalizeGenreTags(tags, { artist, title }).slice(0, limit);

    tagCache.set(cacheKey, { timestamp: Date.now(), tags: normalizedTags });
    return normalizedTags;
  } catch (error) {
    Log.debug("Last.fm tag lookup failed", error.message);
    return [];
  }
}

async function getLastFmArtistTags({ artist, limit = 8 } = {}) {
  if (!process.env.LASTFM_API_KEY || !artist) return [];

  const cacheKey = getArtistCacheKey(artist, limit);
  const cached = tagCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TAG_CACHE_TTL_MS) return cached.tags;

  try {
    const data = await callLastFm({
      method: "artist.gettoptags",
      artist,
      limit: String(Math.max(Number(limit) * 3, 24)),
    });
    const tags = (data?.toptags?.tag || [])
      .filter((tag) => tag?.name)
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0))
      .map((tag) => String(tag.name).trim())
      .filter(Boolean);
    const normalizedTags = normalizeGenreTags(tags, { artist }).slice(0, limit);
    tagCache.set(cacheKey, { timestamp: Date.now(), tags: normalizedTags });
    return normalizedTags;
  } catch (error) {
    Log.debug("Last.fm artist-tag lookup failed", error.message);
    return [];
  }
}

async function getLastFmAlbumTags({ artist, album, limit = 8 } = {}) {
  if (!process.env.LASTFM_API_KEY || !artist || !album) return [];

  const cacheKey = getAlbumCacheKey(artist, album, limit);
  const cached = tagCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TAG_CACHE_TTL_MS) return cached.tags;

  try {
    const data = await callLastFm({
      method: "album.gettoptags",
      artist,
      album,
      limit: String(Math.max(Number(limit) * 3, 24)),
    });
    const tags = (data?.toptags?.tag || [])
      .filter((tag) => tag?.name)
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0))
      .map((tag) => String(tag.name).trim())
      .filter(Boolean);
    const normalizedTags = normalizeGenreTags(tags, { artist, title: album }).slice(0, limit);
    tagCache.set(cacheKey, { timestamp: Date.now(), tags: normalizedTags });
    return normalizedTags;
  } catch (error) {
    Log.debug("Last.fm album-tag lookup failed", error.message);
    return [];
  }
}

/**
 * Returns the strongest compact tag profile available for a recording. Track
 * tags are preferred; album/artist tags only backfill sparse catalog entries.
 * This prevents a broad artist tag from overwriting a recording-specific lane.
 */
async function getLastFmTagProfile({ artist, title, album = "", limit = 8 } = {}) {
  const trackTags = await getLastFmTrackTags({ artist, title, limit });
  if (trackTags.length >= 2) return { tags: trackTags, source: "lastfm-track", confidence: 0.68 };

  const albumTags = album ? await getLastFmAlbumTags({ artist, album, limit }) : [];
  const combined = normalizeGenreTags([...trackTags, ...albumTags], { artist, title }).slice(0, limit);
  if (combined.length >= 2) return { tags: combined, source: "lastfm-album", confidence: 0.56 };

  const artistTags = await getLastFmArtistTags({ artist, limit });
  const fallback = normalizeGenreTags([...combined, ...artistTags], { artist, title }).slice(0, limit);
  if (fallback.length) {
    return { tags: fallback, source: trackTags.length ? "lastfm-track+artist" : "lastfm-artist", confidence: trackTags.length ? 0.58 : 0.42 };
  }
  return { tags: [], source: null, confidence: 0 };
}

function clearLastFmTagCache() {
  tagCache.clear();
}

/**
 * Gets the most-tagged recordings for one community tag (e.g. "chill"). Used
 * to seed a mood request in a room that has no taste history yet.
 */
async function getLastFmTagTopTracks({ tag, limit = 50 } = {}) {
  if (!process.env.LASTFM_API_KEY || !tag) return [];

  const cacheKey = `tagtop:${String(tag).trim().toLowerCase()}|${Number(limit) || 0}`;
  const cached = tagCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TAG_CACHE_TTL_MS) return cached.tracks;

  try {
    const data = await callLastFm({ method: "tag.gettoptracks", tag, limit: String(limit) });
    const tracks = (data?.tracks?.track || [])
      .filter((track) => track?.name && track?.artist?.name)
      .map((track) => ({
        title: track.name,
        artist: track.artist.name,
        durationMs: Number(track.duration) > 0 ? Number(track.duration) * 1000 : null,
      }));
    if (tracks.length) tagCache.set(cacheKey, { timestamp: Date.now(), tracks });
    return tracks;
  } catch (error) {
    Log.debug("Last.fm tag top-tracks lookup failed", error.message);
    return [];
  }
}

module.exports = {
  getLastFmSimilarTracks,
  getLastFmTagTopTracks,
  getLastFmTrackTags,
  getLastFmArtistTags,
  getLastFmAlbumTags,
  getLastFmTagProfile,
  clearLastFmTagCache,
};
