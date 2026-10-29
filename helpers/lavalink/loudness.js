const { cleanTrackMetadata } = require("./trackNormalization");

const DEFAULT_SOURCE_GAIN_DB = Object.freeze({
  deezer: 0,
  spotify: -1,
  youtube: -1.5,
  soundcloud: -2.5,
});

// Deezer measures each master's loudness as `gain` (dB, louder is higher:
// a brickwalled EDM single sits near -5, solo piano near -20). Tracks are
// pulled towards a typical modern pop master. Boosts stay small because
// Lavalink volume above the user's setting can clip.
const DEFAULT_TARGET_GAIN_DB = -9;
const MAX_TRACK_CUT_DB = -6;
const MAX_TRACK_BOOST_DB = 3;
const TRACK_LOUDNESS_LOOKUP_TIMEOUT_MS = 1500;

function normalizeSource(sourceOrTrack) {
  const source = typeof sourceOrTrack === "string" ? sourceOrTrack : sourceOrTrack?.info?.sourceName;
  return String(source || "unknown").toLowerCase();
}

function isLoudnessNormalizationEnabled() {
  return !["0", "false", "off", "no"].includes(String(process.env.LOUDNESS_NORMALIZATION || "true").toLowerCase());
}

function getSourceGainDb(sourceOrTrack) {
  const source = normalizeSource(sourceOrTrack);
  const envKey = `LOUDNESS_${source.toUpperCase()}_DB`;
  const configured = Number(process.env[envKey]);
  if (Number.isFinite(configured)) return Math.max(-12, Math.min(6, configured));
  return DEFAULT_SOURCE_GAIN_DB[source] ?? 0;
}

function getSourceVolumeMultiplier(sourceOrTrack) {
  return 10 ** (getSourceGainDb(sourceOrTrack) / 20);
}

function getTargetGainDb() {
  const configured = Number(process.env.LOUDNESS_TARGET_GAIN);
  return Number.isFinite(configured) ? Math.max(-20, Math.min(0, configured)) : DEFAULT_TARGET_GAIN_DB;
}

function getMeasuredTrackGain(track) {
  const measured = track?.userData?.features?.loudness;
  if (measured === null || measured === undefined || measured === "") return null;
  return Number.isFinite(Number(measured)) ? Number(measured) : null;
}

/**
 * Volume correction for a measured master. Null when the master is unknown,
 * so the caller falls back to the provider estimate.
 */
function getTrackGainAdjustmentDb(measuredGain) {
  if (measuredGain === null || measuredGain === undefined || !Number.isFinite(Number(measuredGain))) return null;
  const adjustment = getTargetGainDb() - Number(measuredGain);
  return Number(Math.max(MAX_TRACK_CUT_DB, Math.min(MAX_TRACK_BOOST_DB, adjustment)).toFixed(2));
}

function getPlaybackGainDb(sourceOrTrack) {
  if (typeof sourceOrTrack !== "string") {
    const trackAdjustment = getTrackGainAdjustmentDb(getMeasuredTrackGain(sourceOrTrack));
    if (trackAdjustment !== null) return trackAdjustment;
  }
  return getSourceGainDb(sourceOrTrack);
}

function getUserVolume(player) {
  const configured = Number(player?.userVolume);
  if (Number.isFinite(configured)) return Math.max(0, Math.min(1000, configured));

  const current = Number(player?.volume);
  if (Number.isFinite(current)) return Math.max(0, Math.min(1000, current));

  const fallback = Number(process.env.DEFAULT_VOLUME ?? 50);
  return Number.isFinite(fallback) ? Math.max(0, Math.min(1000, fallback)) : 50;
}

function getNormalizedVolume(userVolume, sourceOrTrack) {
  const base = Math.max(0, Math.min(1000, Number(userVolume) || 0));
  if (!isLoudnessNormalizationEnabled()) return Math.round(base);
  return Math.max(0, Math.min(1000, Math.round(base * 10 ** (getPlaybackGainDb(sourceOrTrack) / 20))));
}

async function applyNormalizedVolume(player, track = player?.currentTrack) {
  if (!player?.setVolume) return null;

  const userVolume = getUserVolume(player);
  const normalizedVolume = getNormalizedVolume(userVolume, track);
  player.userVolume = userVolume;

  if (Number(player.volume) !== normalizedVolume) {
    await player.setVolume(normalizedVolume);
  }

  player.volume = normalizedVolume;
  player.volumeSource = normalizeSource(track);
  return normalizedVolume;
}

function setMeasuredTrackGain(track, gain) {
  track.userData = track.userData || {};
  track.userData.features = { ...(track.userData.features || {}), loudness: gain };
}

/**
 * Finds the Deezer loudness of a track that arrived without it (a manual
 * YouTube or Spotify pick). Cached lookups return at once; misses are kept
 * as null so a track without a Deezer match is not looked up again.
 */
async function resolveTrackLoudness(track, { lookup } = {}) {
  if (!track?.info || track.isStream || track.info.isStream) return null;
  const known = getMeasuredTrackGain(track);
  if (known !== null) return known;
  if (track.userData?.loudnessChecked) return null;

  const canonical = track.userData?.autoplayReference;
  const cleaned = cleanTrackMetadata(canonical?.title || track.info.title, canonical?.artist || track.info.author);
  const getMetadata = lookup || require("./autoplayMetadata").getDeezerMetadata;
  const metadata = await getMetadata({
    artist: cleaned.searchArtist || track.info.author,
    title: cleaned.cleanTitle || track.info.title,
    deezerId: track.userData?.deezerId,
    track,
  }).catch(() => null);

  track.userData = track.userData || {};
  track.userData.loudnessChecked = true;
  const gain = metadata?.features?.loudness;
  if (!Number.isFinite(Number(gain))) return null;
  setMeasuredTrackGain(track, Number(gain));
  return Number(gain);
}

/**
 * Applies the measured loudness of the track that just started once it is
 * known. A lookup that misses the short deadline is left for the next play
 * rather than changing the volume audibly in the middle of the song.
 */
async function refineTrackLoudness(player, track, { timeoutMs = TRACK_LOUDNESS_LOOKUP_TIMEOUT_MS, lookup } = {}) {
  if (!isLoudnessNormalizationEnabled() || !track?.info || getMeasuredTrackGain(track) !== null) return null;
  const startedAt = Date.now();
  const gain = await resolveTrackLoudness(track, { lookup });
  if (gain === null || Date.now() - startedAt > timeoutMs) return null;
  const current = player?.currentTrack;
  if (current && current !== track && current.info?.identifier !== track.info.identifier) return null;
  return applyNormalizedVolume(player, track);
}

module.exports = {
  DEFAULT_SOURCE_GAIN_DB,
  applyNormalizedVolume,
  getNormalizedVolume,
  getPlaybackGainDb,
  getSourceGainDb,
  getSourceVolumeMultiplier,
  getTrackGainAdjustmentDb,
  getUserVolume,
  isLoudnessNormalizationEnabled,
  normalizeSource,
  refineTrackLoudness,
  resolveTrackLoudness,
};
