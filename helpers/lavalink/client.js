const { inspect } = require("util");
const { Poru } = require("poru");
const { reportActivityIssue } = require("../activity/feed");
const { hasActiveActivitySession } = require("../activity/sessions");
const { markActivityStateChanged } = require("../activity/sync");
const {
  restoreVoiceChannelStatus,
  updateTrackVoiceChannelStatus,
} = require("../discord/voiceChannelStatus");
const { errorEmbed } = require("../embeds");
const { getGuildState } = require("../guildState.js");
const Log = require("../logs/log");
const statsStore = require("../stats/store.js");
const { formatDuration } = require("../utils");
const { tryQueueFallbackTrack, describeTrack } = require("./fallbacks");
const { applyNormalizedVolume, refineTrackLoudness, resolveTrackLoudness } = require("./loudness");
const { fetchLyrics } = require("./lyricsClient");
const { clearRecoverySnapshot } = require("./recovery");
const { armTrackStartWatchdog, clearTrackStartWatchdog } = require("./startWatchdog");
const {
  ensurePlaybackState,
  cloneTrack,
  resolveEndedTrack,
  pushTrackHistory,
  playbackState,
  setLyricsState,
  clearLyricsState,
} = require("./state");
const { describeSocketClose, startStreamHealthMonitor } = require("./streamHealth");
const {
  clearInactivityTimer,
  scheduleInactivityDisconnect,
  clearProgressInterval,
  scheduleProgressUpdates,
} = require("./timers");
const {
  planTrackRetry,
  holdQueueForRecovery,
  releaseHeldQueue,
  consumeReplay,
  replayFailedTrack,
} = require("./trackRetry");

const stopLyricsSession = (...args) => require("./lyricsFormatter").stopLyricsSession(...args);
const TRACK_FAILURE_SETTLE_MS = 350;
const trackFailureRecoveries = new Map();
const lastActivityProgressSyncAt = new Map();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function getTrackKey(track) {
  return String(track?.track || track?.encoded || track?.info?.identifier || track?.info?.uri || "");
}

function isDifferentActiveTrack(player, failedTrack) {
  const activeKey = getTrackKey(player?.currentTrack);
  const failedKey = getTrackKey(failedTrack);
  return Boolean(activeKey && failedKey && activeKey !== failedKey && player?.isPlaying);
}

function isPlayerTransitionActive(player) {
  return Boolean(player?.currentTrack || player?.isPlaying || player?.queue?.length);
}

// Poru answers a TrackException with skip(), which stops the stream but leaves
// the dead track as currentTrack. Its queueEnd then reads as a transition still
// in flight and is ignored, so playback went silent instead of moving on. Only
// the player is released: the playback state keeps the failed track so queue
// end still has something to seed autoplay from.
function releaseFailedTrack(player, failedTrack) {
  const failedKey = getTrackKey(failedTrack);
  if (!player || !failedKey || getTrackKey(player.currentTrack) !== failedKey) return false;

  clearProgressInterval(player.guildId);
  player.currentTrack = null;
  player.isPlaying = false;
  player.isPaused = false;
  player.position = 0;
  return true;
}

function requestQueuedTrackStart(player, expectedTrack, recover) {
  if (!player || !expectedTrack) return;

  armTrackStartWatchdog(player, expectedTrack, recover);
  void player.play().catch((error) => {
    Log.warning(
      "Queued track start request failed",
      error?.message || String(error),
      `guild=${player.guildId}`,
      `track=${expectedTrack.info?.title || "unknown"}`
    );
  });
}

async function recoverStalledTrackStart(player, stalledTrack) {
  if (!player || player.isPaused) return;

  const failedTrack = player.currentTrack || stalledTrack;
  if (!failedTrack) return;

  clearProgressInterval(player.guildId);
  player.currentTrack = null;
  player.isPlaying = false;
  player.isPaused = false;
  player.position = 0;

  const state = ensurePlaybackState(player.guildId);
  state.currentTrack = null;
  state.paused = false;
  playbackState.set(player.guildId, state);
  markActivityStateChanged(player.guildId, "trackStartTimeout");

  Log.warning(
    "Retrying stalled queue item through verified fallbacks",
    "",
    `guild=${player.guildId}`,
    `track=${failedTrack.info?.author || "Unknown"} - ${failedTrack.info?.title || "Unknown"}`
  );

  const fallbackTrack = await tryQueueFallbackTrack(player, failedTrack);
  if (fallbackTrack) {
    requestQueuedTrackStart(player, fallbackTrack, recoverStalledTrackStart);
    return;
  }

  const nextQueuedTrack = player.queue?.[0] || null;
  if (nextQueuedTrack) {
    Log.warning("Skipping stalled item and continuing the queue", "", `guild=${player.guildId}`);
    requestQueuedTrackStart(player, nextQueuedTrack, recoverStalledTrackStart);
    return;
  }

  const guildSettings = getGuildState(player.guildId);
  const referenceTrack = state.lastEndedTrack || state.history?.[state.history.length - 1] || null;
  if (guildSettings?.autoplay && referenceTrack) {
    const { queueAutoplayTrack } = require("./autoplay");
    const added = await queueAutoplayTrack(player, referenceTrack, player.textChannel);
    const expectedTrack = player.currentTrack || player.queue?.[0] || null;
    if (added && expectedTrack) {
      armTrackStartWatchdog(player, expectedTrack, recoverStalledTrackStart);
      return;
    }
  }

  scheduleInactivityDisconnect(player, "trackStartTimeout");
}

const buildPlaybackErrorMessage = (err, fallback = "Unable to play this track") => {
  if (!err) return fallback;

  const summary = typeof err === "string" ? err : err?.exception?.message ?? err?.message ?? fallback;

  const lower = summary.toLowerCase();
  if (lower.includes("age") && lower.includes("restrict")) return "YouTube blocked this track (age-restricted).";
  if (lower.includes("region") && (lower.includes("block") || lower.includes("restrict")))
    return "YouTube blocked this track (region-locked).";
  if (lower.includes("copyright") && lower.includes("claim")) return "This track is blocked due to a copyright claim.";
  if (lower.includes("copyright") && lower.includes("content"))
    return "This track is blocked due to a copyright content.";
  if (lower.includes("private video")) return "This track is a private YouTube video.";
  if (lower.includes("video unavailable")) return "This track is unavailable on YouTube.";
  if (lower.includes("429")) return "Too many requests to YouTube. Please try again later.";
  if (lower.includes("status code 5")) return "YouTube is currently experiencing issues. Please try again later.";

  return summary || fallback;
};

let poru = null;

function createPoru(client) {
  if (poru) return poru;
  if (!process.env.LAVALINK_PASSWORD) {
    throw new Error("LAVALINK_PASSWORD must be configured before starting the bot.");
  }
  const nodes = [
    {
      name: process.env.LAVALINK_NAME || "local",
      host: process.env.LAVALINK_HOST || "127.0.0.1",
      port: Number(process.env.LAVALINK_PORT || 2333),
      password: process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE === "1",
    },
  ];

  poru = new Poru(client, nodes, {
    library: "discord.js",
    defaultPlatform: "ytsearch",
    reconnectTries: 5,
    resumeKey: process.env.LAVALINK_RESUME_KEY || undefined,
    resumeTimeout: 60,
  });

  poru.on("nodeConnect", (node) => Log.success(`Lavalink node connected ${node.name}`));

  // Voice gateway drops show up as audible gaps; Poru rejoins on 4015/4009.
  poru.on("socketClose", (player, _track, data) => {
    const close = describeSocketClose(player, data);
    Log.warning(
      "Discord voice connection closed",
      "",
      `guild=${close.guildId}`,
      `code=${close.code}`,
      `byRemote=${close.byRemote}`
    );
  });

  startStreamHealthMonitor(poru);

  poru.on("trackError", async (player, track, err) => {
    // Read before Poru's skip() zeroes it; this is where a replay resumes.
    const failedAt = player.position || 0;
    const errorSummary = err instanceof Error ? err.message : inspect(err, { depth: 1 });
    const trackInfo = track?.info || {};
    const trackTitle = trackInfo.title || "Unknown";
    const source = trackInfo.sourceName || "unknown";
    const activityActive = hasActiveActivitySession(player.guildId);

    Log.error(
      "❌ Track error",
      `${trackTitle}`,
      `source=${source}`,
      `queue=${player.queue.length}`,
      `guild=${player.guildId}`,
      `error=${errorSummary}`
    );
    // Poru emits TrackException and immediately calls skip without awaiting
    // this listener. Keep a recovery lock so its following queueEnd cannot
    // start a competing autoplay request while we resolve a verified mirror.
    holdQueueForRecovery(player);
    const recovery = (async () => {
      const retryPlan = planTrackRetry(track, failedAt, err);
      if (retryPlan) {
        Log.warning(
          "Replaying the failed track",
          `attempt=${retryPlan.attempt}`,
          `resumeAt=${formatDuration(retryPlan.resumeAt)}`,
          `guild=${player.guildId}`,
          `track=${trackTitle}`
        );
        const failedKey = getTrackKey(track);
        const replayed = await replayFailedTrack(player, track, retryPlan, {
          wait,
          isCurrent: () =>
            poru.players.get(player.guildId) === player &&
            (!player.currentTrack || getTrackKey(player.currentTrack) === failedKey),
          beforeStart: () => armTrackStartWatchdog(player, track, recoverStalledTrackStart),
        });
        if (replayed) {
          releaseHeldQueue(player);
          markActivityStateChanged(player.guildId, "trackErrorRetry");
          return true;
        }
        clearTrackStartWatchdog(player.guildId, "trackErrorRetry");
        if (isDifferentActiveTrack(player, track) || poru.players.get(player.guildId) !== player) {
          releaseHeldQueue(player);
          return true;
        }
      }

      const fallbackTrack = await tryQueueFallbackTrack(player, track);

      if (fallbackTrack) {
        const title = fallbackTrack.info?.title || fallbackTrack.info?.identifier || "this track";
        if (activityActive) {
          reportActivityIssue(player.guildId, "Trying an alternate source", `Retrying a verified mirror for ${title}.`, "warning");
          markActivityStateChanged(player.guildId, "trackErrorFallback");
        }
        // A late exception for a previous provider must not replace a stream
        // that already recovered on its own.
        if (isDifferentActiveTrack(player, track)) {
          Log.info("Ignoring stale provider error after playback recovered", "", `guild=${player.guildId}`, `track=${trackTitle}`);
          return true;
        }

        clearProgressInterval(player.guildId);
        player.currentTrack = null;
        player.isPlaying = false;
        player.isPaused = false;
        player.position = 0;
        const state = ensurePlaybackState(player.guildId);
        state.currentTrack = null;
        state.paused = false;
        playbackState.set(player.guildId, state);
        markActivityStateChanged(player.guildId, "trackErrorRecovery");
        requestQueuedTrackStart(player, fallbackTrack, recoverStalledTrackStart);
        releaseHeldQueue(player);

        // Discord text-channel delivery is non-critical.  Do it after the
        // replacement request and do not await it: Poru can emit queueEnd
        // directly after TrackException, so the recovery lock needs to settle
        // as soon as playback has been requested.
        if (!activityActive) {
          void poru.client.channels
            .fetch(player.textChannel)
            .then((channel) => {
              if (!channel) return null;
              return channel.send({
                embeds: [errorEmbed("Trying alternate source", `Retrying a verified mirror for **${title}**.`)],
              });
            })
            .catch(() => null);
        }
        return true;
      }

      if (releaseFailedTrack(player, track)) {
        Log.warning("No verified mirror; moving past the failed track", "", `guild=${player.guildId}`, `track=${trackTitle}`);
      }
      // Poru never advances past a failure on its own here (the held queue saw
      // to that), and the queue-end handler reads queued songs as a transition
      // already under way. Songs queued meanwhile have to be started here.
      releaseHeldQueue(player);
      if (!player.currentTrack && player.queue.length) {
        requestQueuedTrackStart(player, player.queue[0], recoverStalledTrackStart);
      }

      if (activityActive) {
        reportActivityIssue(player.guildId, "Playback error", buildPlaybackErrorMessage(err));
        markActivityStateChanged(player.guildId, "trackError");
        return false;
      }
      const channel = await poru.client.channels.fetch(player.textChannel).catch(() => null);
      if (channel) await channel.send({ embeds: [errorEmbed("Playback error", buildPlaybackErrorMessage(err))] }).catch(() => null);
      return false;
    })();

    trackFailureRecoveries.set(player.guildId, recovery);
    try {
      await recovery;
    } finally {
      if (trackFailureRecoveries.get(player.guildId) === recovery) trackFailureRecoveries.delete(player.guildId);
    }
  });

  poru.on("trackStart", async (player, track) => {
    if (!track) {
      Log.warning("Lavalink trackStart event without track", "", `guild=${player.guildId}`);
      return;
    }

    clearTrackStartWatchdog(player.guildId, "trackStart");
    clearInactivityTimer(player.guildId, "trackStart");
    const replay = consumeReplay(track);
    player.isPlaying = true;
    player.isPaused = false;
    // Poru zeroes the position on every TrackStart; a replay resumed mid-song.
    if (replay) player.position = replay.resumeAt;
    void stopLyricsSession(player.guildId);
    scheduleProgressUpdates(player);

    // Keep Activity state authoritative from the first tick of the new track.
    // Artwork, lyrics and Discord UI updates below may involve network waits.
    const state = ensurePlaybackState(player.guildId);
    state.currentTrack = cloneTrack(track);
    state.lastPosition = replay?.resumeAt || 0;
    state.lastTimestamp = Date.now();
    state.paused = Boolean(player.isPaused);
    playbackState.set(player.guildId, state);
    markActivityStateChanged(player.guildId, "trackStart");

    try {
      await applyNormalizedVolume(player, track);
    } catch (err) {
      Log.warning("Failed to normalize provider volume", err?.message || String(err), `guild=${player.guildId}`);
    }
    // Unmeasured tracks get a quick Deezer loudness lookup; the next queued
    // track is measured now so it starts at the right level.
    void refineTrackLoudness(player, track).catch((err) => {
      Log.debug("Track loudness lookup failed", err?.message || String(err), `guild=${player.guildId}`);
    });
    if (player.queue[0]) void resolveTrackLoudness(player.queue[0]).catch(() => null);

    try {
      await updateTrackVoiceChannelStatus(poru.client, player, track);
    } catch (err) {
      Log.warning("Failed to update voice channel status", err?.message || String(err), `guild=${player.guildId}`);
    }

    const lyricsPayload = await fetchLyrics(player, track.info).catch(() => null);
    setLyricsState(player.guildId, lyricsPayload);
    markActivityStateChanged(player.guildId, "lyricsReady");

    // Enhanced logging with more readable track info
    const trackInfo = track.info || {};
    const source = trackInfo.sourceName || "unknown";
    const duration = trackInfo.isStream ? "🔴 LIVE" : formatDuration(trackInfo.length || 0);
    const quality = track.pluginInfo?.quality || (source === "deezer" ? "FLAC" : "default");

    Log.info(
      "▶️  Track started",
      `${trackInfo.title || "Unknown"}`,
      `artist=${trackInfo.author || "Unknown"}`,
      `source=${source}`,
      `quality=${quality}`,
      `duration=${duration}`,
      `queue=${player.queue.length}`,
      `guild=${player.guildId}`
    );

    // Start fetching the next autoplay track while the current one is still
    // playing. Waiting for queueEnd makes every recommendation fetch audible.
    const guildSettings = getGuildState(player.guildId);
    if (guildSettings?.autoplay && player.queue.length <= 1) {
      const { prefetchAutoplayTrack } = require("./autoplay");
      void prefetchAutoplayTrack(player, track, player.textChannel);
    }

    // A replay continues a song whose session and play count already exist.
    if (!replay) {
      try {
        const voiceChannel = player.poru.client.guilds.cache.get(player.guildId)?.channels.cache.get(player.voiceChannel);

        const listenerCount = voiceChannel?.members?.filter((m) => !m.user.bot).size || 0;

        statsStore.beginTrackSession(player.guildId, track, listenerCount);

        // Record track played in health monitoring
        const health = require("../monitoring/health");
        health.recordTrackPlayed();
      } catch (err) {
        Log.error(`Failed to begin track session for guild ${player.guildId}`, err);
      }
    }

    poru.emit("trackStartUI", player, track);
  });

  poru.on("trackEnd", (player, track, reason) => {
    const nextTrack = player.currentTrack ? describeTrack(player.currentTrack) : "none";

    clearProgressInterval(player.guildId);
    void stopLyricsSession(player.guildId);

    if (!player.currentTrack && player.queue.length === 0) {
      scheduleInactivityDisconnect(player, "trackEnd");
      void clearRecoverySnapshot(player.guildId);
    }

    const state = ensurePlaybackState(player.guildId);
    const endedTrack = resolveEndedTrack(track, state.currentTrack);
    const reasonCode = typeof reason === "string" ? reason : reason?.reason ?? null;
    const isLoadFailure = reasonCode === "loadFailed" || reasonCode === "load_failed";

    if (endedTrack?.track && reasonCode !== "replaced" && !isLoadFailure) {
      pushTrackHistory(player.guildId, endedTrack);

      const updatedState = playbackState.get(player.guildId);
      Log.debug(
        "Track added to history (trackEnd)",
        "",
        `guild=${player.guildId}`,
        `track=${describeTrack(endedTrack)}`,
        `historyLength=${updatedState?.history?.length || 0}`,
        `recentHistory=${(updatedState?.history || [])
          .slice(-3)
          .map((t) => t.info?.title || "unknown")
          .join(" → ")}`
      );
    }

    // Clean reason logging - only log the reason string, not the entire object
    const cleanReason = typeof reason === "string" ? reason : reason?.reason || "unknown";
    const trackInfo = endedTrack?.info || {};
    const trackTitle = trackInfo.title || "Unknown";

    // Determine reason emoji and label
    let reasonLabel = cleanReason;
    let reasonEmoji = "⏹️";
    if (cleanReason === "finished") {
      reasonEmoji = "✅";
      reasonLabel = "completed";
    } else if (cleanReason === "stopped") {
      reasonEmoji = "⏹️";
      reasonLabel = "stopped";
    } else if (cleanReason === "replaced") {
      reasonEmoji = "🔄";
      reasonLabel = "replaced";
    } else if (cleanReason === "load_failed") {
      reasonEmoji = "❌";
      reasonLabel = "failed to load";
    }

    Log.info(
      `${reasonEmoji} Track ended`,
      `${trackTitle}`,
      `reason=${reasonLabel}`,
      `queue=${player.queue.length}`,
      `next=${nextTrack}`,
      `guild=${player.guildId}`
    );

    state.currentTrack = null;
    state.lastEndedTrack = endedTrack ? cloneTrack(endedTrack) : state.lastEndedTrack || null;
    state.paused = false;
    playbackState.set(player.guildId, state);
    clearLyricsState(player.guildId);
    markActivityStateChanged(player.guildId, "trackEnd");

    if (player.queue.length === 0) {
      void restoreVoiceChannelStatus(poru.client, player.voiceChannel).catch((err) =>
        Log.warning("Failed to restore voice channel status", err?.message || String(err), `guild=${player.guildId}`)
      );
    }

    if (player.queue.length === 0) {
      player.currentTrack = null;
      player.isPlaying = false;
      player.position = 0;
    }

    if (!player.currentTrack && player.queue.length === 0) {
      scheduleInactivityDisconnect(player, "trackEndEmpty");
    }

    // Poru advances the queue after emitting this event. Arm a bounded
    // watchdog now so an unresolved next track cannot leave the player silent
    // forever without a TrackException or queueEnd event.
    if (player.queue.length > 0) {
      armTrackStartWatchdog(player, player.queue[0], recoverStalledTrackStart);
    }

    try {
      statsStore.finishTrackSession(player.guildId, endedTrack, reasonCode);

      // Record track failure in health monitoring
      if (isLoadFailure) {
        const health = require("../monitoring/health");
        health.recordTrackFailed();
      }
    } catch (err) {
      Log.error(`Failed to finish track session for guild ${player.guildId}`, err);
    }
  });

  poru.on("queueEnd", async (player) => {
    // This queueEnd is Poru's answer to the held queue; the hold has done its job.
    releaseHeldQueue(player);
    const recovery = trackFailureRecoveries.get(player.guildId);
    if (recovery) {
      Log.info("⏳ Waiting for provider-error recovery before queue end", "", `guild=${player.guildId}`);
      await recovery.catch(() => false);
    }

    // Lavalink can emit queueEnd immediately after a provider exception while
    // the fallback's TrackStart is already in flight. Give that event a short
    // settle window before clearing the authoritative Activity state.
    await wait(TRACK_FAILURE_SETTLE_MS);
    if (isPlayerTransitionActive(player)) {
      markActivityStateChanged(player.guildId, "queueEndRecovered");
      Log.info("Ignoring stale queue end during active transition", "", `guild=${player.guildId}`);
      return;
    }

    clearTrackStartWatchdog(player.guildId, "queueEnd");
    markActivityStateChanged(player.guildId, "queueEnd");
    Log.info("🏁 Queue ended", `guild=${player.guildId}`);

    const state = ensurePlaybackState(player.guildId);
    const lastTrack = state.currentTrack || state.lastEndedTrack || null;

    Log.debug(
      "Queue end state",
      "",
      `guild=${player.guildId}`,
      `lastTrack=${lastTrack?.info?.title || "none"}`,
      `historyLength=${state.history?.length || 0}`,
      `lastHistoryTrack=${state.history?.[state.history.length - 1]?.info?.title || "none"}`
    );

    if (lastTrack?.track) {
      const alreadyInHistory = state.history?.some((t) => t.track === lastTrack.track);

      if (!alreadyInHistory) {
        pushTrackHistory(player.guildId, lastTrack);

        const updatedState = playbackState.get(player.guildId);
        Log.debug(
          "Track added to history (queueEnd)",
          "",
          `guild=${player.guildId}`,
          `track=${describeTrack(lastTrack)}`,
          `historyLength=${updatedState?.history?.length || 0}`,
          `recentHistory=${(updatedState?.history || [])
            .slice(-3)
            .map((t) => t.info?.title || "unknown")
            .join(" → ")}`
        );
      } else {
        Log.debug(
          "Track already in history, skipping",
          "",
          `guild=${player.guildId}`,
          `track=${describeTrack(lastTrack)}`
        );
      }
    }

    state.currentTrack = null;
    state.lastEndedTrack = null;
    state.paused = false;
    playbackState.set(player.guildId, state);

    player.currentTrack = null;
    player.isPlaying = false;
    player.isPaused = false;
    player.position = 0;

    clearProgressInterval(player.guildId);
    clearLyricsState(player.guildId);

    try {
      statsStore.abortSession(player.guildId);
    } catch (err) {
      Log.error(`Failed to abort track session for guild ${player.guildId}`, err);
    }

    const guildSettings = getGuildState(player.guildId);

    if (guildSettings?.autoplay && lastTrack) {
      const lastTitle = lastTrack?.info?.title || "Unknown";
      Log.info("🔁 Autoplay fetching", `basedOn=${lastTitle}`, `guild=${player.guildId}`);

      const { queueAutoplayTrack, getAutoplayInFlight } = require("./autoplay");
      const pendingPrefetch = getAutoplayInFlight(player.guildId);
      if (pendingPrefetch) {
        Log.info("⏳ Awaiting autoplay prefetch after queue end", `guild=${player.guildId}`);
        const prefetchAdded = await pendingPrefetch.catch(() => false);
        if (prefetchAdded || player.currentTrack || player.queue.length) return;
        Log.warning("Autoplay prefetch ended without a playable track; retrying", "", `guild=${player.guildId}`);
      }
      const added = await queueAutoplayTrack(player, lastTrack, player.textChannel);

      if (added || player.currentTrack || player.queue.length) {
        const expectedTrack = player.currentTrack || player.queue?.[0] || null;
        if (expectedTrack) armTrackStartWatchdog(player, expectedTrack, recoverStalledTrackStart);
        return;
      }
    }

    scheduleInactivityDisconnect(player, "queueEnd");
  });

  poru.on("playerUpdate", (player) => {
    const state = playbackState.get(player.guildId) ?? {};
    state.lastPosition = player.position ?? 0;
    state.lastTimestamp = Date.now();
    state.paused = Boolean(player.isPaused);
    playbackState.set(player.guildId, state);

    const now = Date.now();
    if (now - (lastActivityProgressSyncAt.get(player.guildId) || 0) >= 1_000) {
      lastActivityProgressSyncAt.set(player.guildId, now);
      markActivityStateChanged(player.guildId, "playerUpdate");
    }

    try {
      statsStore.updateProgress(player.guildId, player.position);
    } catch (err) {
      Log.error(`Failed to update track session for guild ${player.guildId}`, err);
    }
  });

  return poru;
}

module.exports = {
  createPoru,
  releaseFailedTrack,
  get poru() {
    return poru;
  },
};
