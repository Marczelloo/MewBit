const { randomUUID } = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");

const { getDashboardConfig } = require("../dashboard/oauth");
const { createDashboardRouter } = require("../dashboard/routes");
const djStore = require("../dj/store");
const { getUserPresets } = require("../equalizer/customPresets");
const EQ_PRESET_NAMES = require("../equalizer/presets");
const guildState = require("../guildState");
const { getHistory } = require("../history/searchHistory");
const { getRoomHistory } = require("../history/roomHistory");
const { replaceQueuedAutoplayTrack, scheduleAutoplayRefresh } = require("../lavalink/autoplay");
const { fetchAutoplayV3Track } = require("../lavalink/autoplayV3");
const { EQUALIZER_PRESETS } = require("../lavalink/constants");
const { getEqualizerState } = require("../lavalink/equalizerStore");
const { getFilterPreset, FILTER_PRESET_NAMES } = require("../lavalink/filterPresets");
const {
  getPlayer,
  lavalinkClearQueue,
  lavalinkPause,
  lavalinkPlay,
  lavalinkPrevious,
  lavalinkRemoveFromQueue,
  lavalinkResume,
  lavalinkSeekTo,
  lavalinkSetEqualizer,
  lavalinkResetEffects,
  lavalinkSetFilterPreset,
  lavalinkSetVolume,
  lavalinkToggleMute,
  lavalinkShuffle,
  lavalinkSkip,
  lavalinkStop,
  lavalinkToggleLoop,
} = require("../lavalink/index");
const { getUserVolume } = require("../lavalink/loudness");
const { fetchLyrics } = require("../lavalink/lyricsClient");
const { LYRICS_SYNC_OFFSET_MS, stopLyricsSession } = require("../lavalink/lyricsFormatter");
const { getPersonalSearchTracks } = require("../lavalink/personalSearch");
const { getPoru } = require("../lavalink/players");
const { markManualTrack, moveQueueTrackWithinOrigin, normalizeQueueAutoplayPartition } = require("../lavalink/queueOrdering");
const { withTimeout } = require("../lavalink/resolveTimeout");
const { searchAcrossSources, searchSingleSource } = require("../lavalink/searchAggregator");
const { filterRelevantSearchResults, rankSearchResults } = require("../lavalink/searchRanking");
const { searchWithCorrection } = require("../lavalink/searchSuggestions");
const { getSimilarSearchTracks } = require("../lavalink/similarSearch");
const { skipWithLearning } = require("../lavalink/skipLearning");
const { isSourcePlaybackFailing } = require("../lavalink/sourceHealth");
const { cloneTrack, getLyricsState, isAwaitingAudio, playbackState, setLyricsState } = require("../lavalink/state");
const { fetchFreestyleSurpriseTrack, selectSurpriseSeed } = require("../lavalink/surpriseMe");
const { hasTrackIdentity } = require("../lavalink/trackIdentity");
const { cleanTrackMetadata, getVariantKinds } = require("../lavalink/trackNormalization");
const Log = require("../logs/log");
const health = require("../monitoring/health");
const { importPlaylistFromUrl } = require("../playlists/import");
const playlistStore = require("../playlists/store");
const { consumeRateLimit } = require("../security/rateLimit");
const statsStore = require("../stats/store");
const userPreferences = require("../users/preferences");
const { getActivityEvents, recordActivityAction, reportActivityIssue } = require("./feed");
const {
  registerActivitySession,
  unregisterActivitySession,
  touchActivitySession,
  beginActivityAction,
  hasActiveActivitySession,
} = require("./sessions");
const { serializeFilters, serializeLyrics, serializePlaylist, serializePlaylistDetails, serializeTrack, normalizeSource } = require("./state");
const { activityStateEvents, getActivityStateRevision, markActivityStateChanged } = require("./sync");

const DEFAULT_PORT = 8787;
const MAX_BODY_SIZE = 64 * 1024;
const MAX_BULK_TRACKS = 50;
const MAX_ARTWORK_SIZE = 8 * 1024 * 1024;
const CLIENT_CACHE_TTL = 5 * 60 * 1000;
const MAX_IDENTITY_CACHE_ENTRIES = 1_000;
const MAX_ACTIVITY_SOCKETS = 200;
const QUEUE_UNDO_TTL_MS = 15_000;
// Player events are emitted at most once a second, so this is only a
// safety-net for iframe/proxy connections which stayed open but stopped
// delivering events. It must not become the primary state transport. Keep
// the fallback short enough that a missed transition cannot leave Activity
// stale for several seconds, while still avoiding a tight polling loop.
const ACTIVITY_STATE_HEARTBEAT_MS = Math.max(1_000, Number(process.env.ACTIVITY_STATE_HEARTBEAT_MS) || 1_500);
const MIN_LYRICS_SYNC_OFFSET_MS = -2_000;
const MAX_LYRICS_SYNC_OFFSET_MS = 2_000;
const ARTWORK_FAILURE_TTL_MS = 5 * 60_000;
const ARTWORK_HOSTS = Object.freeze([
  "dzcdn.net",
  "sndcdn.com",
  "scdn.co",
  "spotifycdn.com",
  "ytimg.com",
  "ggpht.com",
  "googleusercontent.com",
  "img.youtube.com",
  "discordapp.com",
  "discordapp.net",
  "imgur.com",
  "picsum.photos",
]);
const identityCache = new Map();
const sockets = new Set();
const queueUndoSnapshots = new Map();
const artworkFailureCache = new Map();

function isTrue(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function getActivityConfig() {
  return {
    enabled: !["0", "false", "off", "no"].includes(String(process.env.ACTIVITY_ENABLED ?? "true").toLowerCase()),
    host: process.env.ACTIVITY_HOST || "127.0.0.1",
    port: Number(process.env.ACTIVITY_PORT || DEFAULT_PORT),
    allowDev: isTrue(process.env.ACTIVITY_ALLOW_DEV) && process.env.NODE_ENV !== "production",
    devGuildId: process.env.ACTIVITY_DEV_GUILD_ID || "demo",
    devUserId: process.env.ACTIVITY_DEV_USER_ID || "local-user",
    clientSecret: process.env.ACTIVITY_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.ACTIVITY_REDIRECT_URI || "https://127.0.0.1",
    allowedOrigins: String(process.env.ACTIVITY_ALLOWED_ORIGINS || (process.env.NODE_ENV === "production" ? "" : "*"))
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

function stringifyJson(payload) {
  const seen = new WeakSet();
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value;
  });
}

function sendJson(response, statusCode, payload, config) {
  const serializedPayload = stringifyJson(payload);
  const requestedOrigin = response.req?.headers?.origin;
  const allowOrigin = config.allowedOrigins.includes("*")
    ? "*"
    : config.allowedOrigins.includes(requestedOrigin)
      ? requestedOrigin
      : "null";

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(serializedPayload);
}

function isAllowedArtworkUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    const configuredHosts = String(process.env.ACTIVITY_ARTWORK_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return [...ARTWORK_HOSTS, ...configuredHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

async function sendArtwork(response, sourceUrl) {
  if (!isAllowedArtworkUrl(sourceUrl)) {
    throw Object.assign(new Error("That artwork host is not allowed."), { statusCode: 400 });
  }

  const cachedFailure = artworkFailureCache.get(sourceUrl);
  if (cachedFailure && cachedFailure.expiresAt > Date.now()) {
    response.writeHead(204, { "Cache-Control": "public, max-age=60" });
    response.end();
    return;
  }
  artworkFailureCache.delete(sourceUrl);

  let currentUrl = sourceUrl;
  let artworkResponse = null;

  try {
    for (let redirect = 0; redirect < 4; redirect += 1) {
      artworkResponse = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          "User-Agent": "MewBit-Activity/1.1",
        },
      });

      if (artworkResponse.status < 300 || artworkResponse.status >= 400) break;
      const location = artworkResponse.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      if (!isAllowedArtworkUrl(currentUrl)) {
        throw Object.assign(new Error("Artwork redirect host is not allowed."), { statusCode: 400 });
      }
    }
  } catch (error) {
    if (Number(error?.statusCode) === 400) throw error;
    return cacheArtworkFailure(response, sourceUrl);
  }

  if (!artworkResponse?.ok) return cacheArtworkFailure(response, sourceUrl);

  const contentType = String(artworkResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const contentLength = Number(artworkResponse.headers.get("content-length") || 0);
  if (!contentType.startsWith("image/") || contentLength > MAX_ARTWORK_SIZE) return cacheArtworkFailure(response, sourceUrl);

  const body = Buffer.from(await artworkResponse.arrayBuffer());
  if (body.length > MAX_ARTWORK_SIZE) return cacheArtworkFailure(response, sourceUrl);

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function cacheArtworkFailure(response, sourceUrl) {
  artworkFailureCache.set(sourceUrl, { expiresAt: Date.now() + ARTWORK_FAILURE_TTL_MS });
  while (artworkFailureCache.size > 1_000) artworkFailureCache.delete(artworkFailureCache.keys().next().value);
  // An unavailable provider image is a normal media fallback, not a gateway
  // fault. Returning an empty successful response lets the client advance to
  // its original/placeholder artwork without generating noisy 502 logs.
  response.writeHead(204, { "Cache-Control": "public, max-age=60" });
  response.end();
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function getBearerToken(request) {
  const header = String(request.headers.authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

function getIdentityFromDev(config, guildId, token) {
  if (!config.allowDev) return null;
  if (guildId !== config.devGuildId) return null;
  if (process.env.ACTIVITY_DEV_TOKEN && token !== process.env.ACTIVITY_DEV_TOKEN) return null;

  return {
    id: config.devUserId,
    username: "Local Listener",
    tag: "Local Listener",
    member: null,
    dev: true,
  };
}

async function fetchDiscordUser(token) {
  const cached = identityCache.get(token);
  if (cached && Date.now() - cached.timestamp < CLIENT_CACHE_TTL) return cached.identity;

  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error("Discord authentication expired. Reopen the Activity.");

  const user = await response.json();
  const identity = {
    id: user.id,
    username: user.global_name || user.username || "Discord user",
    tag: user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username,
    avatar: user.avatar || null,
    member: null,
    dev: false,
  };
  identityCache.delete(token);
  identityCache.set(token, { timestamp: Date.now(), identity });
  while (identityCache.size > MAX_IDENTITY_CACHE_ENTRIES) identityCache.delete(identityCache.keys().next().value);
  return identity;
}

async function authenticateRequest(client, request, guildId, config) {
  const token = getBearerToken(request);
  const devIdentity = getIdentityFromDev(config, guildId, token);
  if (devIdentity) return devIdentity;
  if (!token) throw Object.assign(new Error("Activity authentication is required."), { statusCode: 401 });

  const identity = await fetchDiscordUser(token);
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw Object.assign(new Error("The bot is not connected to this Discord server."), { statusCode: 404 });

  try {
    identity.member = await guild.members.fetch(identity.id);
  } catch {
    throw Object.assign(new Error("You are not a member of this Discord server."), { statusCode: 403 });
  }

  return identity;
}

function assertControlPermission(guildId, identity, action) {
  if (identity.dev) return;

  const config = djStore.getGuildConfig(guildId);
  if (!config.enabled) return;
  if (djStore.hasDjPermissions(identity.member, config)) return;

  const guardedActions = new Set([
    "pause",
    "resume",
    "toggle",
    "skip",
    "previous",
    "stop",
    "remove_queue",
    "replace_autoplay",
    "play_next",
    "move_queue",
    "clear_queue",
    "undo_queue",
    "shuffle",
    "volume",
    "toggle_mute",
    "seek",
    "filter",
    "equalizer",
    "equalizer_preset",
    "loop",
    "autoplay",
    "play",
    "surprise_me",
    "change_source",
    "play_playlist",
    "queue_tracks",
  ]);

  if (guardedActions.has(action)) {
    throw Object.assign(new Error("DJ mode is enabled. This control is limited to DJs."), { statusCode: 403 });
  }
}

function getVoiceChannelName(client, player) {
  if (!player) return null;
  return client.guilds.cache.get(player.guildId)?.channels.cache.get(player.voiceChannel)?.name || null;
}

function withAutoplayRequesterLabel(track, client) {
  if (!track || !(track.userData?.autoplay || track.info?.autoplayed)) return track;

  const info = track.info || {};
  const botUsername = client?.user?.username || "MewBit";
  return { ...track, info: { ...info, requesterTag: botUsername } };
}

function getRequestAddress(request) {
  return String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function enforceRateLimit(request, scope, limit, windowMs) {
  const result = consumeRateLimit(`${scope}:${getRequestAddress(request)}`, { limit, windowMs });
  if (result.allowed) return;
  throw Object.assign(new Error("Too many requests. Try again shortly."), {
    statusCode: 429,
    retryAfterMs: result.retryAfterMs,
  });
}

function isAllowedOrigin(origin, config) {
  return !origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
}

function assertPlayerVoiceAccess(player, identity, action) {
  if (identity.dev || !player?.voiceChannel) return;
  const guardedActions = new Set([
    "pause", "resume", "toggle", "skip", "previous", "stop", "remove_queue", "replace_autoplay", "play_next",
    "move_queue", "clear_queue", "undo_queue", "shuffle", "volume", "toggle_mute", "seek", "filter",
    "equalizer", "equalizer_preset", "loop", "autoplay", "play", "surprise_me", "play_playlist",
    "queue_tracks", "change_source",
  ]);
  if (!guardedActions.has(action)) return;
  if (identity.member?.voice?.channelId !== player.voiceChannel) {
    throw Object.assign(new Error("Join the active voice channel to control playback."), { statusCode: 403 });
  }
}

function getQueueItemId(track) {
  if (!track) return null;
  track.userData = track.userData || {};
  if (!track.userData.activityQueueId) track.userData.activityQueueId = randomUUID();
  return track.userData.activityQueueId;
}

function getSerializedQueue(player, client) {
  return Array.from(player?.queue || []).map((track, index) => ({
    ...serializeTrack(withAutoplayRequesterLabel(track, client), index),
    queueItemId: getQueueItemId(track),
  }));
}

function findQueueItemIndex(queue, expectedQueueItemId, fallbackPosition) {
  const tracks = Array.from(queue || []);
  const expected = String(expectedQueueItemId || "").trim();
  if (expected) return tracks.findIndex((track) => String(getQueueItemId(track)) === expected);
  const position = Number(fallbackPosition);
  return Number.isInteger(position) ? position : -1;
}

function assertCurrentQueueItem(queue, expectedQueueItemId, fallbackPosition) {
  const index = findQueueItemIndex(queue, expectedQueueItemId, fallbackPosition);
  if (index < 0) {
    throw Object.assign(new Error("That queue item changed before MewBit could update it. Synced the latest queue."), { statusCode: 409, stale: true });
  }
  return index;
}

function assertActivePlayback(player, action) {
  if (!player?.currentTrack) {
    throw Object.assign(new Error(`Start a track before changing ${action === "filter" ? "effects" : "the equalizer"}.`), { statusCode: 409 });
  }
}

// Room history can hold hundreds of tracks and state is pushed every 1.5s, so
// the serialized list is cached per guild and only sent when it changes.
const serializedHistoryCache = new Map();

function getRoomHistoryKey(entries) {
  const last = entries[entries.length - 1];
  return `${entries.length}:${Number(last?.userData?.autoplayPlayedAt) || 0}`;
}

function getSerializedRoomHistory(guildId, client) {
  const entries = getRoomHistory(guildId);
  const key = getRoomHistoryKey(entries);
  const cached = serializedHistoryCache.get(guildId);
  if (cached?.key === key) return cached;
  const next = { key, history: getSerializedPlaybackHistory(entries, client) };
  serializedHistoryCache.set(guildId, next);
  return next;
}

// The client keeps its previous history when a state arrives without one.
function withoutHistory(state) {
  if (!state?.player) return state;
  const { history, ...player } = state.player;
  return { ...state, player };
}

function getSerializedPlaybackHistory(history, client) {
  return Array.from(history || [])
    .slice()
    .reverse()
    .map((track, index) => ({
      ...serializeTrack(withAutoplayRequesterLabel(track, client), index),
      playedAt: Number(track?.userData?.autoplayPlayedAt) || null,
    }));
}

function createQueueUndoSnapshot(guildId, player) {
  const queue = Array.from(player?.queue || []).map(cloneTrack).filter(Boolean);
  if (!queue.length) return null;

  const token = randomUUID();
  queueUndoSnapshots.set(token, { guildId, queue, expiresAt: Date.now() + QUEUE_UNDO_TTL_MS });
  for (const [key, snapshot] of queueUndoSnapshots) {
    if (snapshot.expiresAt <= Date.now()) queueUndoSnapshots.delete(key);
  }
  return token;
}

async function restoreQueueUndoSnapshot(guildId, token) {
  const key = String(token || "");
  const snapshot = queueUndoSnapshots.get(key);
  if (!snapshot || snapshot.guildId !== guildId || snapshot.expiresAt <= Date.now()) {
    queueUndoSnapshots.delete(key);
    return { success: false, error: "That queue change can no longer be undone." };
  }

  const player = getPlayer(guildId);
  if (!player?.queue) return { success: false, error: "The player is no longer connected." };
  player.queue.clear();
  for (const track of snapshot.queue) await player.queue.add(cloneTrack(track));
  normalizeQueueAutoplayPartition(player.queue);
  scheduleAutoplayRefresh(player);
  queueUndoSnapshots.delete(key);
  return { success: true, restored: snapshot.queue.length };
}

function getSerializedPlaylists(userId, guildId) {
  if (!userId) return [];
  return playlistStore.listPlaylists(userId, guildId).map(serializePlaylist);
}

function getSerializedEqualizerPresets(userId) {
  const builtIn = EQ_PRESET_NAMES.map((name) => ({
    name,
    custom: false,
    bands: EQUALIZER_PRESETS[name] || [],
  }));
  const custom = Object.values(getUserPresets(userId) || {}).map((preset) => ({
    name: preset.name,
    custom: true,
    bands: Array.isArray(preset.bands) ? preset.bands : [],
  }));
  return [...builtIn, ...custom];
}

function buildActivityState(client, guildId, userId) {
  const player = getPlayer(guildId);
  const roomHistory = getSerializedRoomHistory(guildId, client);
  const likedSongs = playlistStore.getLikedSongs(userId);
  const livePlaybackState = playbackState.get(guildId);
  const generatedAt = Date.now();
  const playback = resolveActivityPlayback(livePlaybackState?.currentTrack, player?.currentTrack);
  const handoff = playback.track ? null : getActivityHandoff(player, livePlaybackState, generatedAt);
  const shownTrack = playback.track || handoff?.track || null;
  const currentTrack = shownTrack ? serializeTrack(withAutoplayRequesterLabel(shownTrack, client)) : null;
  const filters = getEqualizerState(guildId) || player?.filters || {};
  const guild = client.guilds.cache.get(guildId);
  const settings = guildState.getGuildState(guildId);
  const lyrics = serializeLyrics(getLyricsState(guildId));
  const paused = Boolean(livePlaybackState?.paused || player?.isPaused);
  // A track enters playbackState only on Lavalink TrackStart. Using that
  // event-backed state avoids displaying Poru's transient queued/cleared
  // currentTrack during an error or queue transition.
  const playing = Boolean(handoff) || Boolean(playback.track && !paused && (livePlaybackState?.currentTrack || player?.isPlaying));
  // Started but not heard yet: the clock waits for the first audio frame.
  // Between two tracks the clock holds where the previous one stopped.
  const buffering = Boolean(handoff) || Boolean(playing && isAwaitingAudio(livePlaybackState));
  const position = handoff ? handoff.positionMs : getActivityPosition(player, livePlaybackState, playback.durationMs, generatedAt);
  const botStatus = client?.user?.presence?.activities?.find((activity) => activity.type === 2)?.name || null;
  const lavalinkMetrics = health.getMetrics?.()?.lavalink || {};

  const userLyricsOffset = userPreferences.getUserPreferences(userId)?.lyricsSyncOffsetMs;
  const lyricsSyncOffsetMs = clampLyricsSyncOffset(userLyricsOffset ?? LYRICS_SYNC_OFFSET_MS);

  return {
    revision: getActivityStateRevision(guildId),
    generatedAt,
    botStatus,
    activity: {
      active: hasActiveActivitySession(guildId),
      events: getActivityEvents(guildId),
    },
    guild: {
      id: guildId,
      name: guild?.name || "Local MewBit preview",
      iconUrl: guild?.iconURL?.({ size: 128 }) || null,
      voiceChannelName: getVoiceChannelName(client, player),
    },
    player: {
      connected: Boolean(player),
      paused,
      playing,
      buffering,
      positionMs: Math.max(0, Math.round(position)),
      lyricsSyncOffsetMs,
      lyricsDefaultSyncOffsetMs: LYRICS_SYNC_OFFSET_MS,
      durationMs: playback.durationMs || currentTrack?.durationMs || 0,
      handoff: Boolean(handoff),
      volume: getUserVolume(player),
      muted: Boolean(player?.isMuted) || getUserVolume(player) === 0,
      loop: player?.loop || "NONE",
      shuffleActive: Boolean(player?.shuffleActive),
      autoplay: Boolean(settings?.autoplay),
      currentTrack,
      queue: getSerializedQueue(player, client),
      history: roomHistory.history,
      historyKey: roomHistory.key,
      sessionStartedAt: Number(livePlaybackState?.sessionStartedAt) || null,
      filters: serializeFilters(filters),
      lyrics,
      updatedAt: generatedAt,
    },
    /* Every note this surface can play goes through Lavalink. With the node
       down the Activity still renders a full transport and still looks able to
       play, so the state has to say otherwise. */
    lavalink: {
      connected: Boolean(lavalinkMetrics.connected),
      latencyMs: Number.isFinite(lavalinkMetrics.latency) ? Math.round(lavalinkMetrics.latency) : null,
    },
    playlists: getSerializedPlaylists(userId, guildId),
    likedTrackIds: [...new Set((likedSongs.tracks || []).flatMap((track) => playlistStore.getTrackIdentityKeys(track)))],
    filterPresets: FILTER_PRESET_NAMES,
    equalizerPresets: getSerializedEqualizerPresets(userId),
  };
}

// Longest wait between two tracks the Activity covers with the previous one:
// an autoplay plan (12 s AI DJ timeout) plus resolving the pick.
const HANDOFF_HOLD_MS = 20_000;

function getActivityHandoff(player, state, now = Date.now()) {
  const handoff = state?.handoffTrack;
  if (!player || state?.currentTrack || !handoff?.track) return null;
  return now - (Number(handoff.since) || 0) <= HANDOFF_HOLD_MS ? handoff : null;
}

function resolveActivityPlayback(stateTrack, playerTrack) {
  // playbackState is updated synchronously by TrackStart/TrackEnd. Prefer it
  // for Activity metadata: Poru mutates currentTrack while it dequeues and
  // retries providers, which previously left title/artwork one transition
  // behind even though the audio had already changed.
  // `null` is meaningful here: TrackEnd writes an explicit null before Poru
  // advances the queue. Falling back to Poru in that case briefly resurrects
  // the previous track (or exposes the next track before TrackStart).
  const hasAuthoritativeState = stateTrack !== undefined;
  const track = hasAuthoritativeState ? stateTrack : playerTrack || null;
  const usesPlayerTrack = !hasAuthoritativeState && Boolean(playerTrack);
  return {
    track,
    usesPlayerTrack,
    durationMs: Number(track?.info?.length) || 0,
  };
}

function getActivityPosition(player, state, durationMs, now = Date.now()) {
  const anchoredPosition = Number(state?.lastPosition ?? player?.position ?? 0) || 0;
  const anchoredAt = Number(state?.lastTimestamp) || now;
  const estimated = state?.paused || player?.isPaused || isAwaitingAudio(state, now)
    ? anchoredPosition
    : anchoredPosition + Math.max(0, now - anchoredAt);
  const duration = Number(durationMs) || Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(estimated, duration));
}

function limitText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function activityTrackFeedbackKey(track) {
  const title = limitText(track?.title || track?.info?.title, 180).normalize("NFKC").toLowerCase();
  const author = limitText(track?.author || track?.info?.author, 180).normalize("NFKC").toLowerCase();
  return title && author ? `${author} - ${title}` : "";
}

function saveActivityTrackFeedback(userId, track, sentiment) {
  const key = activityTrackFeedbackKey(track);
  if (!key) throw Object.assign(new Error("MewBit needs a valid track before saving feedback."), { statusCode: 400 });
  const value = sentiment === "more" ? "more" : sentiment === "less" ? "less" : null;
  if (!value) throw Object.assign(new Error("Unknown listening feedback."), { statusCode: 400 });

  const preferences = userPreferences.getUserPreferences(userId);
  const entries = Array.isArray(preferences.activityTrackFeedback) ? preferences.activityTrackFeedback : [];
  const next = [
    ...entries.filter((entry) => entry?.key !== key),
    {
      key,
      sentiment: value,
      updatedAt: Date.now(),
      track: {
        title: limitText(track?.title || track?.info?.title, 180),
        author: limitText(track?.author || track?.info?.author, 180),
        source: toSource(track?.source || track?.info?.sourceName),
        uri: limitText(track?.uri || track?.info?.uri, 500) || null,
        durationMs: Math.max(0, Number(track?.durationMs || track?.info?.length) || 0),
      },
    },
  ].slice(-80);
  userPreferences.setUserPreference(userId, "activityTrackFeedback", next);
  return { success: true, sentiment: value, key };
}

function clampLyricsSyncOffset(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return LYRICS_SYNC_OFFSET_MS;
  return Math.round(Math.max(MIN_LYRICS_SYNC_OFFSET_MS, Math.min(MAX_LYRICS_SYNC_OFFSET_MS, offset)));
}

function toSource(value) {
  return ["auto", "deezer", "youtube", "spotify", "soundcloud"].includes(value) ? value : "auto";
}

// The user picks from this list, so a remix or live version stays in it,
// ranked below the original, instead of being hidden as implicit playback does.
function serializeActivitySearchResults(tracks, query) {
  return rankSearchResults(filterRelevantSearchResults(tracks, query), query, { limit: 48 }).map((track) => {
    const serialized = serializeTrack(track);
    return {
      ...serialized,
      playQuery: serialized.uri || `${serialized.title} ${serialized.author}`,
    };
  });
}

// Matches from the user's own library, answered without Lavalink so the
// panel can show them while the provider search is still running.
function searchActivityLibrary(identityId, guildId, query) {
  return getPersonalSearchTracks(identityId, guildId, limitText(query, 200)).map((track) => {
    const serialized = serializeTrack(track);
    return { ...serialized, playQuery: serialized.uri, origin: track.personal };
  });
}

function serializeActivityActionResult(action, result) {
  if (action === "play" || action === "surprise_me" || action === "replace_autoplay") {
    return {
      success: result?.success !== false,
      track: result?.track ? serializeTrack(result.track) : null,
      isPlaylist: Boolean(result?.isPlaylist),
      playlistTrackCount: Number(result?.playlistTrackCount) || 0,
      ...(action === "surprise_me" ? { surpriseIntent: result?.surpriseIntent || null } : {}),
      ...(action === "replace_autoplay" ? { error: result?.error || null, stale: Boolean(result?.stale), busy: Boolean(result?.busy) } : {}),
    };
  }
  if (action === "refresh_lyrics") return result ? serializeLyrics(result) : null;
  return result;
}

// Bulk actions take plain track records from the client; keep only what a
// playlist row or a play query needs.
function readTrackList(list, max) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max).map((track) => ({
    title: limitText(track?.title, 180),
    author: limitText(track?.author, 180),
    uri: limitText(track?.uri, 500) || null,
    source: toSource(track?.source),
    length: Number.isFinite(Number(track?.durationMs)) ? Number(track.durationMs) : undefined,
    artworkUrl: limitText(track?.artworkUrl, 500) || null,
  })).filter((track) => track.uri || track.title);
}

async function queueTrackList({ guildId, identity, player, tracks, what }) {
  const voiceId = player?.voiceChannel || identity.member?.voice?.channelId;
  const settings = guildState.getGuildState(guildId);
  const textId = settings?.playerChannel || player?.textChannel || null;
  if (!voiceId) throw Object.assign(new Error(`Join a voice channel before playing ${what}.`), { statusCode: 400 });
  if (!textId) throw Object.assign(new Error("Set the player channel first with /setup player channel."), { statusCode: 400 });
  if (player && player.textChannel !== textId) player.textChannel = textId;
  if (settings?.playerChannel) guildState.updateGuildState(guildId, { nowPlayingChannel: textId });

  for (const track of tracks) {
    await lavalinkPlay({
      guildId,
      voiceId,
      textId,
      query: track.uri || `${track.title} ${track.author}`,
      source: normalizeSource(track.source || track.uri),
      requester: { id: identity.id, tag: identity.tag || identity.username, avatar: identity.avatar },
    });
  }
}

async function runActivityAction({ guildId, identity, action, payload = {} }) {
  assertControlPermission(guildId, identity, action);
  const player = getPlayer(guildId);
  assertPlayerVoiceAccess(player, identity, action);

  switch (action) {
    case "play": {
      const query = limitText(payload.query, 500);
      if (!query) throw Object.assign(new Error("Choose a track or enter a search query."), { statusCode: 400 });
      const settings = guildState.getGuildState(guildId);
      const memberVoice = identity.member?.voice?.channelId;
      const voiceId = player?.voiceChannel || memberVoice;
      const textId = settings?.playerChannel || player?.textChannel || null;
      if (!voiceId) throw Object.assign(new Error("Join a voice channel before starting playback."), { statusCode: 400 });
      if (!textId) throw Object.assign(new Error("Set the player channel first with /setup player channel."), { statusCode: 400 });
      if (player && player.textChannel !== textId) player.textChannel = textId;
      if (settings?.playerChannel) guildState.updateGuildState(guildId, { nowPlayingChannel: textId });

      return lavalinkPlay({
        guildId,
        voiceId,
        textId,
        query,
        source: toSource(payload.source),
        prepend: Boolean(payload.prepend),
        playNow: Boolean(payload.playNow),
        requester: {
          id: identity.id,
          tag: identity.tag || identity.username,
          avatar: identity.avatar,
        },
      });
    }
    case "surprise_me": {
      const settings = guildState.getGuildState(guildId);
      const memberVoice = identity.member?.voice?.channelId;
      const voiceId = player?.voiceChannel || memberVoice;
      const textId = settings?.playerChannel || player?.textChannel || null;
      if (!voiceId) throw Object.assign(new Error("Join a voice channel before asking MewBit to choose."), { statusCode: 400 });
      if (!textId) throw Object.assign(new Error("Set the player channel first with /setup player channel."), { statusCode: 400 });

      const liveState = playbackState.get(guildId) || {};
      const preferences = userPreferences.getUserPreferences(identity.id);
      const feedbackEntries = Array.isArray(preferences.activityTrackFeedback) ? preferences.activityTrackFeedback : [];
      const surpriseTaste = {
        currentTrack: liveState.currentTrack || player?.currentTrack || null,
        roomHistory: liveState.history || [],
        userHistory: getHistory(identity.id, null, 50),
        likedTracks: playlistStore.getLikedSongs(identity.id)?.tracks || [],
        topTracks: statsStore.getTopTracks(identity.id, 25),
        feedbackTracks: feedbackEntries.filter((entry) => entry?.sentiment === "more").map((entry) => entry.track),
        avoidTracks: feedbackEntries.filter((entry) => entry?.sentiment === "less").map((entry) => entry.track),
      };
      const surpriseMemoryKey = `${guildId}:${identity.id}`;
      let selection = null;
      let recommendation = null;
      const attemptedSeeds = new Set();

      const hasTasteSignal = Boolean(
        surpriseTaste.currentTrack
        || surpriseTaste.roomHistory.length
        || surpriseTaste.userHistory.length
        || surpriseTaste.likedTracks.length
        || surpriseTaste.topTracks.length
      );

      if (!hasTasteSignal) {
        selection = {
          seed: null,
          intent: { mode: "freestyle", goal: "Start a fresh room with a current, broadly loved, verified track.", preferredLanes: ["continuation", "bridge"] },
        };
        recommendation = await fetchFreestyleSurpriseTrack(guildId, { memoryKey: surpriseMemoryKey });
      } else {
        // A single obscure/current recording can legitimately have no usable
        // catalogue. Surprise me should then pivot to another recent, liked,
        // or frequently played taste anchor instead of reporting a false dead end.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const candidateSelection = selectSurpriseSeed(surpriseTaste, { memoryKey: surpriseMemoryKey });
          if (!candidateSelection || attemptedSeeds.has(candidateSelection.seedKey)) break;
          attemptedSeeds.add(candidateSelection.seedKey);
          selection = candidateSelection;

          recommendation = await fetchAutoplayV3Track(selection.seed, guildId, {
            pendingManualTracks: Array.from(player?.queue || []).slice(0, 4),
            allowWhenAutoplayDisabled: true,
            selectionIntent: selection.intent,
            mode: "surprise",
          });
          if (recommendation) break;

          Log.info(
            "Surprise me retrying with another taste anchor",
            "",
            `guild=${guildId}`,
            `attempt=${attempt + 1}`,
            `seed=${selection.seed.info?.author || "Unknown"} - ${selection.seed.info?.title || "Unknown"}`
          );
        }

        // A room can have history without having a useful musical anchor:
        // novelty uploads, malformed provider metadata, and an AI timeout are
        // not a reason for the primary Surprise me CTA to fail. Fall back to
        // the same short, verified chart path used by a fresh room.
        if (!recommendation) {
          Log.info(
            "Surprise me falling back to the current chart",
            "",
            `guild=${guildId}`,
            `attempts=${attemptedSeeds.size}`
          );
          recommendation = await fetchFreestyleSurpriseTrack(guildId, { memoryKey: surpriseMemoryKey });
          if (recommendation) {
            selection = {
              seed: null,
              intent: { mode: "freestyle", goal: "Recover Surprise me with a current, broadly loved, verified track.", preferredLanes: ["continuation", "bridge"] },
            };
          }
        }
      }

      if (!selection) {
        throw Object.assign(new Error("MewBit needs one taste signal first. Play or like a track, then try Surprise me again."), { statusCode: 400 });
      }
      if (!recommendation) {
        throw Object.assign(new Error("MewBit could not find a verified surprise right now. Try again in a moment."), { statusCode: 503 });
      }

      if (player && player.textChannel !== textId) player.textChannel = textId;
      if (settings?.playerChannel) guildState.updateGuildState(guildId, { nowPlayingChannel: textId });
      const query = recommendation.info?.uri || `${recommendation.info?.title || ""} ${recommendation.info?.author || ""}`.trim();
      const result = await lavalinkPlay({
        guildId,
        voiceId,
        textId,
        query,
        source: toSource(recommendation.info?.sourceName),
        playNow: true,
        requester: {
          id: identity.id,
          tag: identity.tag || identity.username,
          avatar: identity.avatar,
        },
      });
      return { ...result, surpriseIntent: selection.intent.mode };
    }
    case "change_source": {
      const liveTrack = resolveActivityPlayback(playbackState.get(guildId)?.currentTrack, player?.currentTrack).track;
      const expectedTrackId = limitText(payload.expectedTrackId, 300);
      if (!liveTrack || !expectedTrackId || serializeTrack(liveTrack).id !== expectedTrackId) {
        return { success: false, stale: true, error: "The player changed before the source could be switched. Synced the latest track instead." };
      }
      const source = toSource(payload.source);
      if (source === "auto") throw Object.assign(new Error("Choose a music source to switch this track."), { statusCode: 400 });
      const settings = guildState.getGuildState(guildId);
      const voiceId = player?.voiceChannel || identity.member?.voice?.channelId;
      const textId = settings?.playerChannel || player?.textChannel || null;
      if (!voiceId || !textId) throw Object.assign(new Error("Join the active room before switching sources."), { statusCode: 400 });
      const query = `${liveTrack.info?.title || ""} ${liveTrack.info?.author || ""}`.trim();
      if (!query) throw Object.assign(new Error("This track has no usable title for another source."), { statusCode: 409 });
      return lavalinkPlay({
        guildId,
        voiceId,
        textId,
        query,
        source,
        playNow: true,
        requester: { id: identity.id, tag: identity.tag || identity.username, avatar: identity.avatar },
      });
    }
    case "track_feedback": {
      const track = payload.track || resolveActivityPlayback(playbackState.get(guildId)?.currentTrack, player?.currentTrack).track;
      return saveActivityTrackFeedback(identity.id, track, payload.sentiment);
    }
    case "pause":
      return lavalinkPause(guildId);
    case "resume":
      return lavalinkResume(guildId);
    case "toggle":
      return player?.isPaused ? lavalinkResume(guildId) : lavalinkPause(guildId);
    case "skip":
      if (payload.expectedTrackId) {
        const liveTrack = playbackState.get(guildId)?.currentTrack || player?.currentTrack || null;
        const liveTrackId = liveTrack ? serializeTrack(liveTrack)?.id : null;
        if (!liveTrackId || String(payload.expectedTrackId) !== String(liveTrackId)) {
          return {
            success: false,
            stale: true,
            error: "The player already moved to the next track. Synced the latest state instead.",
          };
        }
      }
      return skipWithLearning(guildId, player, lavalinkSkip, "activity_skip");
    case "previous":
      return lavalinkPrevious(guildId);
    case "stop":
      return lavalinkStop(guildId);
    case "seek":
      return lavalinkSeekTo(guildId, Math.max(0, Number(payload.positionMs) || 0));
    case "volume":
      return lavalinkSetVolume(guildId, Math.max(0, Math.min(100, Number(payload.volume) || 0)));
    case "toggle_mute":
      return lavalinkToggleMute(guildId);
    case "loop":
      return lavalinkToggleLoop(guildId, payload.mode);
    case "shuffle":
      return lavalinkShuffle(guildId);
    case "clear_queue": {
      const undoToken = createQueueUndoSnapshot(guildId, player);
      const cleared = await lavalinkClearQueue(guildId);
      return { success: Boolean(cleared), undoToken };
    }
    case "remove_queue": {
      if (!player?.queue) return { success: false, error: "The queue is unavailable." };
      const position = assertCurrentQueueItem(player.queue, payload.queueItemId, payload.position);
      const undoToken = createQueueUndoSnapshot(guildId, player);
      const removed = await lavalinkRemoveFromQueue(guildId, { position: position + 1 });
      normalizeQueueAutoplayPartition(player?.queue);
      scheduleAutoplayRefresh(player);
      return { success: removed?.status === "removed", undoToken: removed?.status === "removed" ? undoToken : null, ...removed };
    }
    case "replace_autoplay": {
      if (!player?.queue || !player?.currentTrack) return { success: false, error: "Start playback before replacing an autoplay pick." };
      if (!guildState.getGuildState(guildId)?.autoplay) return { success: false, error: "Turn autoplay on before replacing its next pick." };
      const position = assertCurrentQueueItem(player.queue, payload.queueItemId, payload.position);
      const rejectedTrack = Array.from(player.queue)[position];
      if (!rejectedTrack?.userData?.autoplay && !rejectedTrack?.info?.autoplayed) {
        return { success: false, error: "Only an autoplay pick can be replaced." };
      }
      return replaceQueuedAutoplayTrack(player, {
        rejectedTrack,
        referenceTrack: resolveActivityPlayback(playbackState.get(guildId)?.currentTrack, player.currentTrack).track || player.currentTrack,
        textChannelId: player.textChannel,
        expectedQueueItemId: payload.queueItemId,
      });
    }
    case "play_next": {
      if (!player?.queue) return { success: false, error: "The queue is unavailable." };
      const position = assertCurrentQueueItem(player.queue, payload.queueItemId, payload.position);
      const [track] = player.queue.splice(position, 1);
      markManualTrack(track);
      player.queue.unshift(track);
      normalizeQueueAutoplayPartition(player.queue);
      scheduleAutoplayRefresh(player);
      return { success: true };
    }
    case "undo_queue":
      return restoreQueueUndoSnapshot(guildId, payload.token);
    case "move_queue": {
      if (!player?.queue) return false;
      const from = assertCurrentQueueItem(player.queue, payload.fromQueueItemId, payload.from);
      const to = assertCurrentQueueItem(player.queue, payload.toQueueItemId, payload.to);
      const moved = moveQueueTrackWithinOrigin(player.queue, from, to);
      scheduleAutoplayRefresh(player);
      return moved;
    }
    case "filter":
      assertActivePlayback(player, "filter");
      if (String(payload.preset || "").toLowerCase() === "off") return lavalinkResetEffects(guildId);
      if (!getFilterPreset(payload.preset)) throw Object.assign(new Error("Unknown filter preset."), { statusCode: 400 });
      return lavalinkSetFilterPreset(guildId, payload.preset);
    case "equalizer":
      assertActivePlayback(player, "equalizer");
      return lavalinkSetEqualizer(guildId, Array.isArray(payload.bands) ? payload.bands : []);
    case "equalizer_preset": {
      assertActivePlayback(player, "equalizer");
      const presetName = limitText(payload.preset, 80).toLowerCase();
      const customPresets = getUserPresets(identity.id) || {};
      const customKey = Object.keys(customPresets).find((key) => key.toLowerCase() === presetName);
      const customPreset = customKey ? customPresets[customKey] : null;
      if (customPreset) return lavalinkSetEqualizer(guildId, customPreset.bands);
      if (!EQ_PRESET_NAMES.includes(presetName)) throw Object.assign(new Error("Unknown equalizer preset."), { statusCode: 400 });
      return lavalinkSetEqualizer(guildId, presetName);
    }
    case "autoplay":
      return guildState.updateGuildState(guildId, { autoplay: Boolean(payload.enabled) });
    case "refresh_lyrics": {
      if (!player?.currentTrack) return null;
      await stopLyricsSession(guildId, { deleteMessage: false });
      const lyrics = await fetchLyrics(player, player.currentTrack.info).catch(() => null);
      setLyricsState(guildId, lyrics);
      return lyrics;
    }
    case "set_lyrics_offset": {
      const offset = clampLyricsSyncOffset(payload.offsetMs);
      userPreferences.setUserPreference(identity.id, "lyricsSyncOffsetMs", offset);
      return { lyricsSyncOffsetMs: offset };
    }
    case "get_playlist": {
      const playlist = playlistStore.getPlaylist(identity.id, guildId, limitText(payload.name, 80));
      if (!playlist) throw Object.assign(new Error("Playlist not found."), { statusCode: 404 });
      return { playlist: serializePlaylistDetails(playlist) };
    }
    case "create_playlist":
      return playlistStore.createPlaylist(identity.id, guildId, limitText(payload.name, 80), {
        description: limitText(payload.description, 180),
        public: Boolean(payload.public),
        collaborative: Boolean(payload.collaborative),
        type: payload.type === "server" ? "server" : "user",
      });
    case "add_to_playlist": {
      const track = payload.track || player?.currentTrack;
      if (!track) throw Object.assign(new Error("Choose a track to save."), { statusCode: 400 });
      return playlistStore.addTrack(identity.id, guildId, limitText(payload.name, 80), track);
    }
    case "toggle_like": {
      const track = payload.track || player?.currentTrack;
      if (!track) throw Object.assign(new Error("Choose a track to like."), { statusCode: 400 });
      const liked = playlistStore.getLikedSongs(identity.id);
      const existing = playlistStore.isTrackInPlaylist(identity.id, guildId, liked.name, track);
      if (existing.exists) {
        return { ...playlistStore.removeTrack(identity.id, guildId, liked.name, existing.position), liked: false };
      }
      return { ...playlistStore.addTrack(identity.id, guildId, liked.name, track), liked: true };
    }
    case "delete_playlist":
      return playlistStore.deletePlaylist(identity.id, guildId, limitText(payload.name, 80));
    case "rename_playlist":
      return playlistStore.renamePlaylist(identity.id, guildId, limitText(payload.name, 80), limitText(payload.newName, 80));
    case "edit_playlist":
      return playlistStore.editPlaylist(identity.id, guildId, limitText(payload.name, 80), {
        description: payload.description === undefined ? undefined : limitText(payload.description, 240),
        thumbnail: payload.thumbnail === undefined ? undefined : limitText(payload.thumbnail, 500),
        public: payload.public === undefined ? undefined : Boolean(payload.public),
        collaborative: payload.collaborative === undefined ? undefined : Boolean(payload.collaborative),
      });
    case "update_playlist": {
      const oldName = limitText(payload.name, 80);
      const newName = limitText(payload.newName, 80);
      if (newName && newName.toLowerCase() !== oldName.toLowerCase()) {
        const renamed = playlistStore.renamePlaylist(identity.id, guildId, oldName, newName);
        if (!renamed.success) return renamed;
      }
      const result = playlistStore.editPlaylist(identity.id, guildId, newName || oldName, {
        description: payload.description === undefined ? undefined : limitText(payload.description, 240),
        thumbnail: payload.thumbnail === undefined ? undefined : limitText(payload.thumbnail, 500),
        public: payload.public === undefined ? undefined : Boolean(payload.public),
        collaborative: payload.collaborative === undefined ? undefined : Boolean(payload.collaborative),
      });
      if (result.success) {
        const playlist = playlistStore.getPlaylist(identity.id, guildId, newName || oldName);
        return { ...result, playlist: playlist ? serializePlaylistDetails(playlist) : null };
      }
      return result;
    }
    case "remove_playlist_track":
      return playlistStore.removeTrack(identity.id, guildId, limitText(payload.name, 80), Number(payload.position) + 1);
    case "move_playlist_track":
      return playlistStore.moveTrack(identity.id, guildId, limitText(payload.name, 80), Number(payload.from) + 1, Number(payload.to) + 1);
    case "import_playlist": {
      const url = limitText(payload.url, 1000);
      if (!url) throw Object.assign(new Error("Paste a playlist URL first."), { statusCode: 400 });
      return importPlaylistFromUrl(null, identity.id, guildId, url, {
        name: limitText(payload.name, 80) || undefined,
        description: limitText(payload.description, 240) || undefined,
        type: payload.type === "server" ? "server" : "user",
        public: Boolean(payload.public),
        collaborative: Boolean(payload.collaborative),
      });
    }
    case "play_playlist": {
      const playlist = playlistStore.getPlaylist(identity.id, guildId, limitText(payload.name, 80));
      if (!playlist?.tracks?.length) throw Object.assign(new Error("That playlist is empty or unavailable."), { statusCode: 404 });
      const tracks = [...playlist.tracks.slice(0, 100)];
      if (payload.shuffle) tracks.sort(() => Math.random() - 0.5);
      await queueTrackList({ guildId, identity, player, tracks, what: "a playlist" });
      return { count: tracks.length, shuffled: Boolean(payload.shuffle) };
    }
    case "queue_tracks": {
      const tracks = readTrackList(payload.tracks, MAX_BULK_TRACKS);
      if (!tracks.length) throw Object.assign(new Error("Choose some tracks to queue."), { statusCode: 400 });
      await queueTrackList({ guildId, identity, player, tracks, what: "these tracks" });
      return { count: tracks.length };
    }
    case "save_tracks_as_playlist": {
      const name = limitText(payload.name, 80);
      const tracks = readTrackList(payload.tracks, MAX_BULK_TRACKS);
      if (!tracks.length) throw Object.assign(new Error("Choose some tracks to save."), { statusCode: 400 });
      const created = playlistStore.createPlaylist(identity.id, guildId, name, {
        description: limitText(payload.description, 180),
        type: "user",
      });
      if (!created.success) return created;
      const playlistName = created.playlist.name;
      let added = 0;
      for (const track of tracks) {
        const result = playlistStore.addTrack(identity.id, guildId, playlistName, track);
        if (result.success && !result.duplicate) added += 1;
      }
      return { success: true, playlistName, count: added };
    }
    default:
      throw Object.assign(new Error(`Unknown Activity action: ${action}`), { statusCode: 400 });
  }
}

async function runTrackedActivityAction({ guildId, identity, action, payload = {} }) {
  // A long-running Activity request can resolve a track after the ordinary
  // socket handoff grace. Hold the Activity ownership through that work so
  // trackStartUI never falls back to the legacy command-channel player.
  const releaseActivityAction = beginActivityAction(guildId);
  try {
    const player = getPlayer(guildId);
    // Read before the action runs: the lease is already held, so nothing
    // between here and the release can escape the `finally` and strand it.
    const beforeTrack = resolveActivityPlayback(playbackState.get(guildId)?.currentTrack, player?.currentTrack).track;
    const result = await runActivityAction({ guildId, identity, action, payload });
    if (result !== false && result?.success !== false) {
      recordActivityAction(guildId, identity, action, payload, serializeTrack(beforeTrack), result);
    }
    markActivityStateChanged(guildId, `activity:${action}`);
    return result;
  } catch (error) {
    if ((Number(error.statusCode) || 500) >= 500) {
      reportActivityIssue(guildId, "Activity action failed", error.message || "MewBit could not complete that action.");
      markActivityStateChanged(guildId, `activity:${action}:error`);
    }
    throw error;
  } finally {
    releaseActivityAction();
  }
}

/**
 * Searches like a search box should: a misspelt query also searches the
 * correction YouTube suggests and ranks against it, and the response says so
 * ("showing results for ..."). `exact` searches the query as typed.
 */
// "Similar to" the top search result. It runs after the main search so it
// never slows the results the user asked for.
async function searchActivitySimilar(title, author) {
  const poru = getPoru();
  if (!poru) throw Object.assign(new Error("Lavalink is still connecting."), { statusCode: 503 });
  const tracks = await getSimilarSearchTracks(
    { title: limitText(title, 200), author: limitText(author, 200) },
    { search: (text) => searchSingleSource(poru, text, "youtube") }
  );
  return tracks.map((track) => {
    const serialized = serializeTrack(track);
    return { ...serialized, playQuery: serialized.uri || `${serialized.title} ${serialized.author}` };
  });
}

async function searchActivityTracks(query, preferredSource, { exact = false } = {}) {
  const poru = getPoru();
  if (!poru) throw Object.assign(new Error("Lavalink is still connecting."), { statusCode: 503 });

  const selectedSource = toSource(preferredSource);
  const normalizedQuery = limitText(query, 200);

  // Keep YouTube as the first source in auto mode, but rank the complete
  // provider pool. Stopping at the first loose YouTube result hid verified
  // Spotify/Deezer recordings and made a short typing result disappear for a
  // full query.
  const search = (text) =>
    selectedSource === "auto"
      ? searchAcrossSources(poru, text, { preferredSource: "youtube" })
      : searchSingleSource(poru, text, selectedSource);

  const result = await searchWithCorrection(normalizedQuery, search, { exact });
  // serializeActivitySearchResults filters for playability itself.
  return {
    tracks: serializeActivitySearchResults(result.tracks, result.rankQuery),
    correction: result.correction ? { query: result.correction, original: normalizedQuery } : null,
    suggestions: result.suggestions,
  };
}

const PLAY_FROM_SOURCES = ["youtube", "spotify", "deezer", "soundcloud"];
const PLAY_FROM_SEARCH_TIMEOUT_MS = 4_000;
const PLAY_FROM_RESOLVE_TIMEOUT_MS = 3_000;
const PREVIEW_MAX_MS = 31_000;

function isSameRecordingLength(referenceMs, candidateMs) {
  if (!referenceMs || !candidateMs) return true;
  if (candidateMs <= PREVIEW_MAX_MS && referenceMs > 60_000) return false;
  return Math.abs(referenceMs - candidateMs) <= Math.max(20_000, referenceMs * 0.15);
}

function hasSameVersion(referenceTitle, candidateTitle) {
  const reference = getVariantKinds(referenceTitle).sort().join(",");
  return getVariantKinds(candidateTitle).sort().join(",") === reference;
}

/**
 * The same recording on every provider, for "Play from…". A provider is
 * offered only when its match loads again from its own link and its streams
 * have not been failing lately, so picking one does not end in an error.
 */
async function findActivityTrackSources({ title, author, uri, source, durationMs }) {
  const poru = getPoru();
  if (!poru) throw Object.assign(new Error("Lavalink is still connecting."), { statusCode: 503 });
  const reference = {
    info: { title: limitText(title, 200), author: limitText(author, 200), uri: limitText(uri, 500) || null, length: Number(durationMs) || 0 },
  };
  if (!reference.info.title) throw Object.assign(new Error("Choose a track first."), { statusCode: 400 });

  const { cleanTitle, searchArtist } = cleanTrackMetadata(reference.info.title, reference.info.author);
  const searchTitle = getVariantKinds(reference.info.title).length ? reference.info.title : cleanTitle;
  const query = `${searchArtist} ${searchTitle}`.trim();
  const ownSource = toSource(source);

  const findMatch = async (provider) => {
    if (provider === ownSource && reference.info.uri) return { ...reference, info: { ...reference.info, sourceName: provider } };
    const tracks = await withTimeout(
      searchSingleSource(poru, query, provider, { variantLimit: 0, popularity: false }),
      PLAY_FROM_SEARCH_TIMEOUT_MS,
      `Play from ${provider}`
    );
    return rankSearchResults(filterRelevantSearchResults(tracks, query), query).find((track) =>
      track?.info?.uri &&
      hasSameVersion(reference.info.title, track.info.title) &&
      isSameRecordingLength(reference.info.length, Number(track.info.length) || 0) &&
      hasTrackIdentity([reference], track, { includeIdentifier: false })
    ) || null;
  };

  const sources = await Promise.all(PLAY_FROM_SOURCES.map(async (provider) => {
    const unavailable = (reason) => ({ source: provider, available: false, reason, track: null });
    try {
      const match = await findMatch(provider);
      if (!match) return unavailable("not_found");
      if (isSourcePlaybackFailing(provider)) return unavailable("failing");
      if (provider !== ownSource) {
        const loaded = await withTimeout(poru.resolve({ query: match.info.uri }), PLAY_FROM_RESOLVE_TIMEOUT_MS, `Play from ${provider} link`);
        if (!["track", "search"].includes(loaded?.loadType) || !loaded.tracks?.length) return unavailable("not_loadable");
      }
      const serialized = serializeTrack(match);
      return {
        source: provider,
        available: true,
        current: provider === ownSource,
        reason: null,
        track: { ...serialized, source: provider, playQuery: match.info.uri },
      };
    } catch {
      return unavailable("unreachable");
    }
  }));
  return sources;
}

function sendSocket(socket, payload) {
  if (socket.readyState === 1) socket.send(stringifyJson(payload));
}

function sendSocketState(socket, state) {
  const historyKey = state?.player?.historyKey;
  const unchanged = historyKey != null && socket.historyKey === historyKey;
  sendSocket(socket, { type: "state", state: unchanged ? withoutHistory(state) : state });
  socket.historyKey = historyKey;
}

function broadcastGuildState(client, guildId) {
  const statesByIdentity = new Map();
  for (const socket of sockets) {
    if (socket.readyState !== 1 || !socket.authorized || socket.guildId !== guildId) continue;
    const identityId = socket.identity.id;
    if (!statesByIdentity.has(identityId)) statesByIdentity.set(identityId, buildActivityState(client, guildId, identityId));
    sendSocketState(socket, statesByIdentity.get(identityId));
  }
}

function createActivityServer(client) {
  const config = getActivityConfig();
  const dashboardRouter = createDashboardRouter(client);
  let server = null;
  let interval = null;
  let listeningForPlayerChanges = false;

  const handlePlayerStateChange = ({ guildId }) => broadcastGuildState(client, guildId);

  async function handleRequest(request, response) {
    response.req = request;
    if (request.method === "OPTIONS") return sendJson(response, 204, null, config);

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/dashboard/")) {
      const handled = await dashboardRouter.handle(request, response, url);
      if (handled) return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/token") {
        enforceRateLimit(request, "token", 12, 60_000);
        if (!config.clientSecret) throw Object.assign(new Error("DISCORD_CLIENT_SECRET is not configured on the Activity gateway."), { statusCode: 503 });
        const body = await readJson(request);
        if (!body.code) throw Object.assign(new Error("Missing Discord authorization code."), { statusCode: 400 });
        const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: config.clientSecret,
            grant_type: "authorization_code",
            code: body.code,
            redirect_uri: config.redirectUri,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const tokenPayload = await tokenResponse.json();
        if (!tokenResponse.ok) {
          const detail = [tokenPayload.error, tokenPayload.error_description].filter(Boolean).join(": ") || "Discord token exchange failed.";
          Log.error("Discord OAuth token exchange rejected", `status=${tokenResponse.status} ${detail}`);
          throw Object.assign(new Error("Discord token exchange failed. Reopen the Activity and try again."), { statusCode: 502 });
        }
        return sendJson(response, 200, tokenPayload, config);
      }

      if (request.method === "GET" && url.pathname === "/api/activity/health") {
        return sendJson(response, 200, { ok: true, activity: "mewbit", time: Date.now() }, config);
      }

      if (request.method === "GET" && url.pathname === "/api/activity/artwork") {
        return await sendArtwork(response, url.searchParams.get("url") || "");
      }

      if (url.pathname === "/api/activity/state" && request.method === "GET") {
        enforceRateLimit(request, "state", 120, 60_000);
        const guildId = url.searchParams.get("guildId") || config.devGuildId;
        const identity = await authenticateRequest(client, request, guildId, config);
        return sendJson(response, 200, { ok: true, state: buildActivityState(client, guildId, identity.id), identity: { id: identity.id, username: identity.username } }, config);
      }

      if (url.pathname === "/api/activity/search/library" && request.method === "POST") {
        enforceRateLimit(request, "search-library", 120, 60_000);
        const body = await readJson(request);
        const guildId = limitText(body.guildId || config.devGuildId, 80);
        const identity = await authenticateRequest(client, request, guildId, config);
        return sendJson(response, 200, { ok: true, tracks: searchActivityLibrary(identity.id, guildId, body.query) }, config);
      }

      if (url.pathname === "/api/activity/search/similar" && request.method === "POST") {
        enforceRateLimit(request, "search-similar", 30, 60_000);
        const body = await readJson(request);
        const guildId = limitText(body.guildId || config.devGuildId, 80);
        await authenticateRequest(client, request, guildId, config);
        return sendJson(response, 200, { ok: true, tracks: await searchActivitySimilar(body.title, body.author) }, config);
      }

      if (url.pathname === "/api/activity/search/sources" && request.method === "POST") {
        enforceRateLimit(request, "search-sources", 20, 60_000);
        const body = await readJson(request);
        const guildId = limitText(body.guildId || config.devGuildId, 80);
        await authenticateRequest(client, request, guildId, config);
        return sendJson(response, 200, { ok: true, sources: await findActivityTrackSources(body) }, config);
      }

      if (url.pathname === "/api/activity/search" && request.method === "POST") {
        enforceRateLimit(request, "search", 30, 60_000);
        const body = await readJson(request);
        const guildId = limitText(body.guildId || config.devGuildId, 80);
        await authenticateRequest(client, request, guildId, config);
        const result = await searchActivityTracks(body.query, body.source, { exact: body.exact === true });
        return sendJson(response, 200, { ok: true, ...result }, config);
      }

      if (url.pathname === "/api/activity/action" && request.method === "POST") {
        enforceRateLimit(request, "action", 90, 60_000);
        const body = await readJson(request);
        const guildId = limitText(body.guildId || config.devGuildId, 80);
        const identity = await authenticateRequest(client, request, guildId, config);
        touchActivitySession(guildId);
        let result = await runTrackedActivityAction({ guildId, identity, action: body.action, payload: body.payload || {} });
        const actionPayload = body.payload || {};
        const detailName = actionPayload.newName || actionPayload.name || result?.playlistName;
        const detailActions = new Set([
          "create_playlist",
          "add_to_playlist",
          "get_playlist",
          "edit_playlist",
          "update_playlist",
          "remove_playlist_track",
          "move_playlist_track",
          "import_playlist",
          "save_tracks_as_playlist",
        ]);
        if (detailActions.has(body.action) && detailName) {
          const playlist = playlistStore.getPlaylist(identity.id, guildId, detailName);
          if (playlist) result = { ...result, playlist: serializePlaylistDetails(playlist) };
        }
        return sendJson(response, 200, { ok: true, result: serializeActivityActionResult(body.action, result), state: withoutHistory(buildActivityState(client, guildId, identity.id)) }, config);
      }

      return sendJson(response, 404, { ok: false, error: "Not found" }, config);
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      if (status >= 500) Log.error("Activity gateway request failed", error, `path=${url.pathname}`);
      return sendJson(response, status, { ok: false, error: error.message || "Activity gateway error" }, config);
    }
  }

  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== "/api/activity/ws") return socket.destroy();
    if (!isAllowedOrigin(request.headers.origin, config) || !consumeRateLimit(`ws:${getRequestAddress(request)}`, { limit: 20, windowMs: 60_000 }).allowed) {
      return socket.destroy();
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => webSocketServer.emit("connection", webSocket, request));
  }

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  webSocketServer.on("connection", (socket) => {
    if (sockets.size >= MAX_ACTIVITY_SOCKETS) return socket.close(1013, "Activity is busy. Try again shortly.");
    socket.authorized = false;
    sockets.add(socket);

    socket.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "auth") {
          const fakeRequest = { headers: { authorization: message.token ? `Bearer ${message.token}` : "" } };
          const guildId = limitText(message.guildId || config.devGuildId, 80);
          socket.identity = await authenticateRequest(client, fakeRequest, guildId, config);
          if (socket.guildId) unregisterActivitySession(socket.guildId, socket);
          socket.guildId = guildId;
          socket.authorized = true;
          registerActivitySession(guildId, socket);
          touchActivitySession(guildId);
          sendSocket(socket, { type: "ready", identity: { id: socket.identity.id, username: socket.identity.username } });
          socket.historyKey = null;
          sendSocketState(socket, buildActivityState(client, guildId, socket.identity.id));
          return;
        }
        if (!socket.authorized) return sendSocket(socket, { type: "error", error: "Authenticate the Activity socket first." });
        if (message.type === "heartbeat") {
          touchActivitySession(socket.guildId);
          return sendSocket(socket, { type: "heartbeat", time: Date.now() });
        }
        if (message.type === "action") {
          const actionLimit = consumeRateLimit(`ws-action:${socket.identity.id}`, { limit: 120, windowMs: 60_000 });
          if (!actionLimit.allowed) throw Object.assign(new Error("Too many actions. Try again shortly."), { statusCode: 429 });
          await runTrackedActivityAction({ guildId: socket.guildId, identity: socket.identity, action: message.action, payload: message.payload || {} });
        }
      } catch (error) {
        sendSocket(socket, { type: "error", error: error.message || "Activity socket error" });
      }
    });

    socket.on("close", () => { unregisterActivitySession(socket.guildId, socket); sockets.delete(socket); });
    socket.on("error", () => { unregisterActivitySession(socket.guildId, socket); sockets.delete(socket); });
  });

  return {
    start() {
      if (!config.enabled) {
        Log.info("MewBit Activity gateway disabled", "set ACTIVITY_ENABLED=true to enable");
        return null;
      }

      server = http.createServer(handleRequest);
      server.on("upgrade", handleUpgrade);
      server.on("error", (error) => Log.error("MewBit Activity gateway error", error));
      server.listen(config.port, config.host, () => {
        const actualPort = server.address()?.port || config.port;
        Log.success("MewBit Activity gateway ready", `http://${config.host}:${actualPort}`);

        // Discord rejects a sign-in with nothing but "invalid redirect_uri",
        // and never says which value it expected. Print the exact string this
        // deployment will send, so registering it in the Developer Portal is
        // a copy rather than a reconstruction.
        const dashboard = getDashboardConfig();
        if (dashboard.enabled) {
          Log.info(
            "MewBit dashboard ready",
            dashboard.publicUrl,
            `redirect_uri=${dashboard.redirectUri}`,
            "register this exact URI under OAuth2 in the Discord Developer Portal"
          );
          if (!dashboard.clientId || !dashboard.clientSecret) {
            Log.warning("Dashboard OAuth credentials are missing", "set CLIENT_ID and DISCORD_CLIENT_SECRET");
          }
          // The session cookie takes its Secure flag from this scheme. Terminating
          // TLS at a proxy while leaving the public URL on http:// therefore ships
          // the session id over plaintext, and nothing else would say so.
          if (!dashboard.secure && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(dashboard.publicUrl)) {
            Log.warning(
              "Dashboard session cookies are being sent without the Secure flag",
              `DASHBOARD_PUBLIC_URL is ${dashboard.publicUrl}`,
              "set it to the https:// origin browsers actually use, even when TLS ends at a proxy"
            );
          }
          if (!Number(process.env.DASHBOARD_TRUST_PROXY) && dashboard.secure) {
            Log.warning(
              "Dashboard rate limits will bucket every visitor together",
              "this deployment looks proxied — set DASHBOARD_TRUST_PROXY to the number of proxies in front"
            );
          }
        }
      });
      if (!listeningForPlayerChanges) {
        activityStateEvents.on("change", handlePlayerStateChange);
        listeningForPlayerChanges = true;
      }
      interval = setInterval(() => {
        const guilds = new Set([...sockets].filter((socket) => socket.authorized).map((socket) => socket.guildId));
        for (const guildId of guilds) broadcastGuildState(client, guildId);
      }, ACTIVITY_STATE_HEARTBEAT_MS);
      interval.unref?.();
      return server;
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      if (listeningForPlayerChanges) {
        activityStateEvents.off("change", handlePlayerStateChange);
        listeningForPlayerChanges = false;
      }
      for (const socket of sockets) socket.close();
      sockets.clear();
      if (server) server.close();
      server = null;
    },
  };
}

module.exports = {
  createActivityServer,
  findActivityTrackSources,
  buildActivityState,
  clampLyricsSyncOffset,
  getActivityPosition,
  getActivityHandoff,
  resolveActivityPlayback,
  withAutoplayRequesterLabel,
  getSerializedPlaybackHistory,
  getSerializedQueue,
  getQueueItemId,
  findQueueItemIndex,
  isAllowedArtworkUrl,
  runActivityAction,
  searchActivityLibrary,
  searchActivitySimilar,
  searchActivityTracks,
  serializeActivityActionResult,
  stringifyJson,
};
