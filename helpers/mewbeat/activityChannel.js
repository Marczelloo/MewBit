const { audioKeyOf } = require("./audioKey");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const MAX_ID_LENGTH = 40;

function errorReply(message) {
  return { type: "error", error: message };
}

// The mewbeat half of the Activity socket. It owns no state: playback and the
// chart store are injected, so the server decides where they come from.
// audioLatencyMs is how long the player position runs ahead of what Discord
// listeners hear (send queue plus voice transport); the anchor says the
// position is heard that much later.
function createMewbeatChannel({ readPlayback, chartStore, isUnlocked, now = Date.now, audioLatencyMs = 0 }) {
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

    const playback = readPlayback(guildId);
    if (!playback || !audioKey || audioKeyOf(playback.track) !== audioKey) {
      return { type: "mewbeat_chart", audioKey, difficulty, status: "stale" };
    }

    const result = await chartStore.getCharts(playback.track, playback.node);
    const reply = { type: "mewbeat_chart", audioKey, difficulty, status: result.status };
    if (result.reason !== undefined) reply.reason = result.reason;
    if (result.status === "ready") reply.chart = result.charts[difficulty];
    return reply;
  }

  return {
    async handle(guildId, userId, message) {
      switch (message?.type) {
        case "mewbeat_sync": return sync(guildId, message);
        case "mewbeat_chart": return chart(guildId, userId, message);
        default: return errorReply("Unknown mewbeat message.");
      }
    },
  };
}

module.exports = { createMewbeatChannel };
