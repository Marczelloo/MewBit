const SOURCE_LABELS = Object.freeze({
  deezer: "Deezer",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  youtube: "YouTube",
});
const { getArtworkUrls, getTrackArtworkSource } = require("../artwork");
const { getDisplayTrackMetadata } = require("../lavalink/displayMetadata");

function normalizeSource(source) {
  const value = String(source || "unknown").toLowerCase();
  if (value.includes("soundcloud") || value === "scsearch") return "soundcloud";
  if (value.includes("spotify") || value === "spsearch") return "spotify";
  if (value.includes("deezer") || value === "dzsearch") return "deezer";
  if (value.includes("youtube") || value === "ytsearch" || value === "ytmsearch") return "youtube";
  return value;
}

function getTrackId(track) {
  const info = track?.info || {};
  return String(info.identifier || info.uri || `${info.title || "track"}:${info.author || "artist"}`);
}

const AVATAR_HOSTS = Object.freeze(["cdn.discordapp.com", "discordapp.com", "discordapp.net"]);

// Requester avatars arrive as a full CDN URL (slash commands) or a bare avatar
// hash (Activity identity). Only Discord CDN URLs are passed on to the client.
function resolveRequesterAvatarUrl(info, isAutoplay) {
  if (isAutoplay) return null;
  const avatar = String(info?.requesterAvatar || "").trim();
  if (!avatar) return null;

  if (avatar.toLowerCase().startsWith("https://")) {
    try {
      const url = new URL(avatar);
      const host = url.hostname.toLowerCase();
      const allowed = url.protocol === "https:" && !url.username && !url.password
        && AVATAR_HOSTS.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
      return allowed ? url.toString() : null;
    } catch {
      return null;
    }
  }

  const id = String(info?.requesterId || "").trim();
  if (!/^\d{5,25}$/.test(id) || !/^[A-Za-z0-9_]{1,64}$/.test(avatar)) return null;
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}?size=64`;
}

function serializeTrack(track, index = null) {
  if (!track) return null;

  const info = track.info || {};
  const display = getDisplayTrackMetadata(track);
  const source = normalizeSource(info.sourceName || info.source || info.uri);
  const artwork = getArtworkUrls(getTrackArtworkSource(track));

  const isAutoplay = Boolean(track.userData?.autoplay || info.autoplayed);
  const aiDJ = track?.userData?.aiDJ || null;
  const recommendation = aiDJ
    ? {
      source: "ai_dj",
      lane: aiDJ.lane || null,
      fit: Number.isFinite(Number(aiDJ.fit)) ? Number(aiDJ.fit) : null,
      mood: aiDJ.mood || null,
      energy: aiDJ.energy || null,
      reason: String(aiDJ.proposalReason || aiDJ.reasons?.[0] || "").trim().slice(0, 180) || null,
      anchor: track?.userData?.autoplayAnchor || null,
    }
    : track?.userData?.surpriseMe
      ? { source: "surprise", reason: track.userData.surpriseMe === "freestyle" ? "A verified pick from the current chart." : "Chosen from your recent listening." }
      : null;

  return {
    id: getTrackId(track),
    index,
    title: display.title,
    author: display.author,
    durationMs: Number(info.length) || 0,
    artworkUrl: artwork.primary,
    artworkFallbackUrl: artwork.fallback,
    uri: info.uri || null,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    isStream: Boolean(info.isStream),
    explicit: Boolean(info.isExplicit ?? info.explicit ?? track.pluginInfo?.isExplicit ?? track.pluginInfo?.explicit),
    requester: info.requesterTag || info.requester || null,
    requesterAvatarUrl: resolveRequesterAvatarUrl(info, isAutoplay),
    autoplay: isAutoplay,
    // The queue changed in front of this pick and MewBit is re-choosing it.
    autoplayRefreshing: isAutoplay && Boolean(track.userData?.autoplayRefreshing),
    recommendation,
  };
}

function serializeLyrics(payload) {
  if (!payload) return null;

  const lines = Array.isArray(payload.lines)
    ? payload.lines
        .map((line) => ({
          timestamp: Number(line.timestamp) || 0,
          line: String(line.line || "").trim(),
        }))
        .filter((line) => line.line)
    : [];

  return {
    provider: payload.source || payload.provider || "unknown",
    synced: Boolean(payload.synced || lines.length),
    text: String(payload.lyrics || payload.text || ""),
    lines,
  };
}

function serializeFilters(filters = {}) {
  const equalizer = Array.isArray(filters.equalizer)
    ? filters.equalizer.map((band) => ({ band: Number(band.band), gain: Number(band.gain) }))
    : [];

  return {
    preset: filters.preset || "flat",
    effectPreset: filters.filterPreset || "off",
    equalizer,
  };
}

function serializePlaylistTrack(track, index = null) {
  const serialized = serializeTrack({
    info: {
      identifier: track.identifier,
      title: track.title,
      author: track.author,
      length: track.length,
      sourceName: track.source,
      uri: track.uri,
      artworkUrl: track.artworkUrl || track.thumbnail || track.image,
    },
  }, index);

  return { ...serialized, addedAt: Number(track.addedAt) || 0 };
}

function serializePlaylist(playlist, { includeTracks = false } = {}) {
  const serialized = {
    id: playlist.id,
    name: playlist.name,
    type: playlist.type,
    description: playlist.description || "",
    trackCount: Array.isArray(playlist.tracks) ? playlist.tracks.length : 0,
    thumbnail: playlist.thumbnail || null,
    public: Boolean(playlist.public),
    collaborative: Boolean(playlist.collaborative),
    isDefault: Boolean(playlist.isDefault),
    // Up to four covers for the Home library mosaic.
    artworks: (playlist.tracks || [])
      .map((track) => track?.artworkUrl || track?.thumbnail || null)
      .filter((url) => typeof url === "string" && /^https?:\/\//.test(url))
      .filter((url, index, list) => list.indexOf(url) === index)
      .slice(0, 4),
  };

  if (includeTracks) serialized.tracks = (playlist.tracks || []).map(serializePlaylistTrack);
  return serialized;
}

function serializePlaylistDetails(playlist) {
  return serializePlaylist(playlist, { includeTracks: true });
}

module.exports = {
  SOURCE_LABELS,
  normalizeSource,
  serializeFilters,
  serializeLyrics,
  serializePlaylist,
  serializePlaylistDetails,
  serializePlaylistTrack,
  serializeTrack,
};
