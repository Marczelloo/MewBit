const { inspect } = require("util");
const { markActivityStateChanged } = require("../activity/sync");
const Log = require("../logs/log");
const { INACTIVITY_TIMEOUT_MS, PROGRESS_UPDATE_INTERVAL_MS } = require("./constants");
const { clearRecoverySnapshot } = require("./recovery");
const { playbackState, inactivityTimers, endActivePlayback, isAwaitingAudio } = require("./state");

let refreshNowPlayingMessageCached = null;

const getRefreshHelper = () => {
  if (!refreshNowPlayingMessageCached) {
    ({ refreshNowPlayingMessage: refreshNowPlayingMessageCached } = require("../buttons"));
  }
  return refreshNowPlayingMessageCached;
};

const clearInactivityTimer = (guildId, reason = "unspecified") => {
  const timer = inactivityTimers.get(guildId);
  if (!timer) return;

  clearTimeout(timer);
  inactivityTimers.delete(guildId);
  Log.info("Cleared inactivity timer", "", `guild=${guildId}`, `reason=${reason}`);
};

const scheduleInactivityDisconnect = (player, reason = "queueEnd") => {
  const poru = player?.poru || poru;
  if (!player || !poru) return;

  if (!INACTIVITY_TIMEOUT_MS || INACTIVITY_TIMEOUT_MS <= 0) return;

  // Check for 24/7 mode - don't schedule disconnect if enabled
const { getGuildState } = require("../guildState");
const { restoreVoiceChannelStatus } = require("../discord/voiceChannelStatus");
  const state = getGuildState(player.guildId);
  if (state?.radio247) {
    Log.info("Skipped inactivity disconnect (24/7 mode active)", "", `guild=${player.guildId}`);
    return;
  }

  clearInactivityTimer(player.guildId);
  const timeout = setTimeout(async () => {
    inactivityTimers.delete(player.guildId);
    try {
      const current = poru?.players.get(player.guildId);

      if (!current) return;
      if (current.isPlaying || current.queue.length > 0) {
        Log.info("Skipped inactivity disconnect (player active", "", `guild=${player.guildId}`);
        return;
      }

      Log.info("Disconnecting due to inactivity", "", `guild=${player.guildId}`, `reason=${reason}`);
      await restoreVoiceChannelStatus(poru.client, current.voiceChannel).catch(() => null);
      const channel = await poru.client.channels.fetch(current.textChannel).catch(() => null);

      if (channel) {
        await channel
          .send("Disconnecting due to inactivity. Start playing a new track to bring me back.")
          .catch(() => null);
      }

      await current.destroy();
      // An idle disconnect is a transport cleanup, not a request to erase the
      // room's playback history.
      endActivePlayback(player.guildId);
      markActivityStateChanged(player.guildId, "inactivityDisconnect");
      await clearRecoverySnapshot(player.guildId);
    } catch (error) {
      const summary = error instanceof Error ? error.message : inspect(error, { depth: 1 });
      Log.error("Failed to disconnect after inactivity", "", `guild=${player.guildId}`, `error=${summary}`);
    }
  }, INACTIVITY_TIMEOUT_MS);

  timeout.unref?.();
  inactivityTimers.set(player.guildId, timeout);
  Log.info(
    "Scheduled inactivity disconnect",
    "",
    `guild=${player.guildId}`,
    `timeoutMs=${INACTIVITY_TIMEOUT_MS}`,
    `reason=${reason}`
  );
};

const clearProgressInterval = (guildId) => {
  const state = playbackState.get(guildId);
  if (!state?.interval) return;
  clearInterval(state.interval);
  state.interval = null;
  playbackState.set(guildId, state);
};

const scheduleProgressUpdates = (player) => {
  if (!PROGRESS_UPDATE_INTERVAL_MS || PROGRESS_UPDATE_INTERVAL_MS <= 0) return;

  clearProgressInterval(player.guildId);

  const interval = setInterval(async () => {
    const state = playbackState.get(player.guildId);
    if (!state || !player.isPlaying || !player.currentTrack) return;

    const info = player.currentTrack.info || {};
    const length = info.length ?? Infinity;

    const now = Date.now();
    const lastPos = state.lastPosition ?? 0;
    const lastTs = state.lastTimestamp ?? now;
    const elapsed = Math.max(0, now - lastTs);
    const estimated = Math.min(length, lastPos + (player.isPaused || isAwaitingAudio(state, now) ? 0 : elapsed));

    state.lastPosition = estimated;
    state.lastTimestamp = now;
    playbackState.set(player.guildId, state);

    try {
      const refresh = getRefreshHelper();
      if (!refresh) return;

      await refresh(player.poru.client, player.guildId, player, undefined, estimated);
    } catch (err) {
      const summary = err instanceof Error ? err.message : inspect(err, { depth: 1 });
      Log.error("Failed to refresh now playing message", "", `guild=${player.guildId}`, `error=${summary}`);
      clearProgressInterval(player.guildId);
    }
  }, PROGRESS_UPDATE_INTERVAL_MS);

  interval.unref?.();
  const state = playbackState.get(player.guildId) ?? {};
  state.interval = interval;
  playbackState.set(player.guildId, state);
};

module.exports = {
  clearInactivityTimer,
  scheduleInactivityDisconnect,
  clearProgressInterval,
  scheduleProgressUpdates,
};
