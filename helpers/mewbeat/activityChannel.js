const Log = require("../logs/log");
const { audioKeyOf } = require("./audioKey");
const { createSoloTracks } = require("./soloTracks");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const MAX_ID_LENGTH = 40;
const MAX_URI_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 40;

function errorReply(message) {
  return { type: "error", error: message };
}

// The mewbeat half of the Activity socket. It owns no state: playback and the
// chart store are injected, so the server decides where they come from.
// audioLatencyMs is how long the player position runs ahead of what Discord
// listeners hear (send queue plus voice transport); the anchor says the
// position is heard that much later.
//
// resolveTrack(guildId, { uri, source }) -> { track, node, info? } | null turns a
// search result into an encoded track; soloTracks remembers it by audioKey so
// charts and audio can be served for songs the bot is not playing. The score,
// history, scoring and broadcast dependencies belong to later features and are
// accepted here so the server wires them in one place.
function createMewbeatChannel({
  readPlayback,
  chartStore,
  isUnlocked,
  now = Date.now,
  audioLatencyMs = 0,
  resolveTrack,
  soloTracks = createSoloTracks(),
  // eslint-disable-next-line no-unused-vars
  scoreStore, historyStore, loadScoring, broadcast, sendToUser,
  log = Log,
}) {
  function sync(guildId, message) {
    const { id, clientSentAt } = message;
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH || !Number.isFinite(clientSentAt)) {
      return errorReply("Bad mewbeat sync.");
    }

    const playback = readPlayback(guildId);
    const serverNow = now();
    const audioKey = playback ? audioKeyOf(playback.track) : null;
    const anchor = audioKey
      ? {
        audioKey,
        positionMs: Math.round(playback.positionMs),
        at: serverNow + audioLatencyMs,
        paused: Boolean(playback.paused),
        durationMs: playback.durationMs,
      }
      : null;
    return { type: "mewbeat_sync", id, clientSentAt, serverNow, anchor };
  }

  async function chart(guildId, userId, message) {
    const { audioKey, difficulty } = message;
    if (!isUnlocked(userId)) return errorReply("Unlock mewbeat first.");
    if (!DIFFICULTIES.includes(difficulty)) return errorReply("Unknown mewbeat difficulty.");

    let source = typeof audioKey === "string" ? soloTracks.get(audioKey) : null;
    if (!source) {
      const playback = readPlayback(guildId);
      if (!playback || !audioKey || audioKeyOf(playback.track) !== audioKey) {
        return { type: "mewbeat_chart", audioKey, difficulty, status: "stale" };
      }
      source = playback;
    }

    const result = await chartStore.getCharts(source.track, source.node);
    const reply = { type: "mewbeat_chart", audioKey, difficulty, status: result.status };
    if (result.reason !== undefined) reply.reason = result.reason;
    if (result.status === "ready") reply.chart = result.charts[difficulty];
    return reply;
  }

  function trackInfoOf(track) {
    const info = track.info || {};
    return {
      title: info.title || "Unknown title",
      artist: info.author || "",
      durationMs: Number(info.length) || 0,
      artworkUrl: info.artworkUrl || null,
      uri: info.uri || null,
      source: String(info.sourceName || "").toLowerCase(),
    };
  }

  async function soloPrepare(guildId, userId, message) {
    const { id, uri, source } = message;
    const fail = (reason) => ({ type: "mewbeat_solo_prepare", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat prepare.");
    if (!isUnlocked(userId)) return errorReply("Unlock mewbeat first.");
    if (typeof uri !== "string" || !uri.trim() || uri.length > MAX_URI_LENGTH) return fail("bad_uri");
    if (source != null && (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH)) return fail("bad_source");

    let resolved;
    try {
      resolved = await resolveTrack(guildId, { uri: uri.trim(), source: source || "" });
    } catch (error) {
      log.warning("mewbeat solo resolve failed", error?.message);
      return fail("resolve_failed");
    }
    if (!resolved?.track) return fail("not_found");

    const audioKey = audioKeyOf(resolved.track);
    if (!audioKey) return fail("unsupported");

    const info = resolved.info ?? trackInfoOf(resolved.track);
    soloTracks.put(audioKey, { track: resolved.track, node: resolved.node, info });
    // Charting starts now so it is usually done by the time Play is pressed.
    Promise.resolve(chartStore.getCharts(resolved.track, resolved.node))
      .catch((error) => log.warning("mewbeat solo chart failed", error?.message));
    return { type: "mewbeat_solo_prepare", id, status: "ok", audioKey, track: info };
  }

  return {
    // The reply, or a promise of it; `profile` is { id, username, avatarUrl }.
    async handle(guildId, userId, message, profile) { // eslint-disable-line no-unused-vars
      switch (message?.type) {
        case "mewbeat_sync": return sync(guildId, message);
        case "mewbeat_chart": return chart(guildId, userId, message);
        case "mewbeat_solo_prepare": return soloPrepare(guildId, userId, message);
        default: return errorReply("Unknown mewbeat message.");
      }
    },
    // Called once the user's last socket in the guild is gone.
    disconnect(guildId, userId) {}, // eslint-disable-line no-unused-vars
  };
}

module.exports = { createMewbeatChannel };
