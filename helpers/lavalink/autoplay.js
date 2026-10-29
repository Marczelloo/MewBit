const { markActivityStateChanged } = require("../activity/sync");
const Log = require("../logs/log");
const { recordAutoplayExposure } = require("./autoplayExposure");
const { fetchAutoplayV3Track } = require("./autoplayV3");
const { isAutoplayTrack } = require("./queueOrdering");
const { recordSkip } = require("./skipLearning");
const { cloneTrack, rememberAutoplayTrack } = require("./state");

const AUTOPLAY_PREFETCH_QUEUE_THRESHOLD = 1;
const autoplayInFlight = new Map();

function getPendingManualTracks(player) {
  return Array.from(player?.queue || [])
    .filter((track) => !isAutoplayTrack(track))
    .slice(0, 4);
}

function runSharedAutoplayTask(guildId, createTask) {
  const existing = autoplayInFlight.get(guildId);
  if (existing) return existing;

  const task = Promise.resolve().then(createTask);
  autoplayInFlight.set(guildId, task);

  task.finally(() => {
    if (autoplayInFlight.get(guildId) === task) autoplayInFlight.delete(guildId);
  }).catch(() => undefined);

  return task;
}

function decorateAutoplayTrack(track, player, textChannelId, userData = {}) {
  const cloned = cloneTrack(track);
  const botUser = player.poru?.client?.user;

  cloned.info = {
    ...(cloned.info || {}),
    requester: botUser?.id ?? textChannelId,
    requesterTag: botUser?.username || "MewBit",
    autoplayed: true,
  };

  cloned.userData = {
    ...(cloned.userData || {}),
    fallbackAttempts: 0,
    autoplay: true,
    ...userData,
  };

  return cloned;
}

function queueAutoplayTrack(player, lastTrack, textChannelId) {
  if (!player || !lastTrack) {
    Log.warning("Autoplay called without player or lastTrack");
    return Promise.resolve(false);
  }

  if (autoplayInFlight.has(player.guildId)) {
    Log.debug("Autoplay fetch already in progress", "", `guild=${player.guildId}`);
    return autoplayInFlight.get(player.guildId);
  }

  return runSharedAutoplayTask(player.guildId, async () => {
    try {
      const relatedTrack = await fetchAutoplayV3Track(lastTrack, player.guildId, {
        // A queued reference is already the selection's starting point.
        pendingManualTracks: getPendingManualTracks(player).filter((track) => track !== lastTrack),
      });

      if (!relatedTrack) {
        Log.warning("Smart autoplay could not find a related track", "", `guild=${player.guildId}`);
        return false;
      }

      const voiceChannel = player.poru.client.guilds.cache.get(player.guildId)?.channels.cache.get(player.voiceChannel);

      const botIsInChannel = voiceChannel?.members?.has(player.poru.client.user.id);

      if (!botIsInChannel) {
        Log.debug(
          "Aborting autoplay - bot left voice channel during fetch",
          "",
          `guild=${player.guildId}`,
          `track=${relatedTrack.info?.title}`
        );
        return false;
      }

      const cloned = decorateAutoplayTrack(relatedTrack, player, textChannelId);

      await player.queue.add(cloned);
      rememberAutoplayTrack(player.guildId, cloned);
      // Prefetching changes the visible queue even when the current track is
      // still playing. Notify Activity immediately instead of leaving it to
      // its low-frequency heartbeat or the next view change.
      markActivityStateChanged(player.guildId, "autoplayQueued");
      await recordAutoplayExposure(player.guildId, cloned, lastTrack).catch((error) => {
        Log.warning("Autoplay exposure memory update failed", "", `guild=${player.guildId}`, `error=${error.message}`);
      });

      Log.info(
        "➕ Autoplay queued",
        `${cloned.info?.title || "Unknown"}`,
        `artist=${cloned.info?.author || "Unknown"}`,
        `source=${cloned.info?.sourceName || "unknown"}`,
        `queue=${player.queue.length}`,
        `guild=${player.guildId}`
      );

      if (!player.currentTrack && player.queue.length > 0) {
        // Do not await Poru's lazy resolver here. A metadata-only candidate
        // can otherwise keep the shared autoplay task pending forever; the
        // client-level start watchdog will recover a missing TrackStart.
        void player.play().catch((error) => {
          Log.warning("Autoplay playback request failed", error?.message || String(error), `guild=${player.guildId}`);
        });
      }

      return true;
    } catch (err) {
      Log.error("❌ Autoplay failed", err, `guild=${player.guildId}`);
      return false;
    }
  });
}

/**
 * Replaces a prefetched autoplay track without touching live playback. The
 * rejected candidate becomes short-lived room feedback, not a permanent
 * personal dislike, and is blocked from the immediately refreshed pick.
 */
function replaceQueuedAutoplayTrack(player, {
  rejectedTrack,
  referenceTrack = player?.currentTrack,
  textChannelId = player?.textChannel,
  expectedQueueItemId = null,
} = {}) {
  if (!player || !referenceTrack?.info || !rejectedTrack || !isAutoplayTrack(rejectedTrack)) {
    return Promise.resolve({ success: false, error: "That autoplay pick is no longer available to replace." });
  }

  if (autoplayInFlight.has(player.guildId)) {
    return Promise.resolve({ success: false, busy: true, error: "MewBit is already choosing an autoplay track." });
  }

  const rejectedIdentity = expectedQueueItemId || rejectedTrack?.userData?.activityQueueId || null;
  const rejectedSummary = {
    title: rejectedTrack.info?.title || "Unknown",
    author: rejectedTrack.info?.author || "Unknown",
  };

  return runSharedAutoplayTask(player.guildId, async () => {
    try {
      recordSkip(player.guildId, rejectedTrack, "autoplay_replace");
      const relatedTrack = await fetchAutoplayV3Track(referenceTrack, player.guildId, {
        pendingManualTracks: getPendingManualTracks(player),
        blockedTracks: [rejectedTrack],
        selectionIntent: {
          mode: "replace",
          goal: "Replace the queued autoplay pick with a different, equally natural transition that moves away from the rejected direction.",
          preferredLanes: ["bridge", "continuation"],
        },
      });

      if (!relatedTrack) {
        return { success: false, error: "MewBit could not find a stronger replacement yet. The current autoplay pick was kept." };
      }

      const queue = Array.from(player.queue || []);
      const position = rejectedIdentity
        ? queue.findIndex((track) => String(track?.userData?.activityQueueId || "") === String(rejectedIdentity))
        : queue.indexOf(rejectedTrack);
      const liveRejectedTrack = queue[position];
      if (position < 0 || !isAutoplayTrack(liveRejectedTrack)) {
        return { success: false, stale: true, error: "The autoplay queue changed before a replacement was ready." };
      }

      const cloned = decorateAutoplayTrack(relatedTrack, player, textChannelId, {
        autoplayReplacementOf: rejectedSummary,
      });
      player.queue.splice(position, 1, cloned);
      rememberAutoplayTrack(player.guildId, cloned);
      markActivityStateChanged(player.guildId, "autoplayReplaced");
      await recordAutoplayExposure(player.guildId, cloned, referenceTrack).catch((error) => {
        Log.warning("Autoplay replacement exposure update failed", "", `guild=${player.guildId}`, `error=${error.message}`);
      });

      Log.info(
        "🔄 Autoplay pick replaced",
        `${rejectedSummary.author} - ${rejectedSummary.title} => ${cloned.info?.author || "Unknown"} - ${cloned.info?.title || "Unknown"}`,
        `guild=${player.guildId}`
      );

      return { success: true, track: cloned, replaced: rejectedSummary };
    } catch (error) {
      Log.error("❌ Autoplay replacement failed", error, `guild=${player.guildId}`);
      return { success: false, error: "MewBit could not replace that autoplay pick. Try again in a moment." };
    }
  });
}

/**
 * Starts autoplay before the queue is empty so Lavalink has a next track ready
 * when the current one finishes. The queue-end handler remains as a fallback.
 */
async function prefetchAutoplayTrack(player, currentTrack, textChannelId) {
  if (!player || !currentTrack || player.queue.length > AUTOPLAY_PREFETCH_QUEUE_THRESHOLD) return false;

  // The pick is appended after whatever is already queued, so it has to
  // follow that track, not the one playing now.
  const referenceTrack = Array.from(player.queue || []).at(-1) || currentTrack;

  Log.debug(
    "⏩ Starting autoplay prefetch",
    "",
    `guild=${player.guildId}`,
    `queue=${player.queue.length}`,
    `current=${currentTrack.info?.title || "unknown"}`,
    `reference=${referenceTrack.info?.title || "unknown"}`
  );

  return queueAutoplayTrack(player, referenceTrack, textChannelId);
}

function isAutoplayInFlight(guildId) {
  return autoplayInFlight.has(guildId);
}

function getAutoplayInFlight(guildId) {
  return autoplayInFlight.get(guildId) || null;
}

module.exports = {
  queueAutoplayTrack,
  replaceQueuedAutoplayTrack,
  prefetchAutoplayTrack,
  isAutoplayInFlight,
  getAutoplayInFlight,
  runSharedAutoplayTask,
  AUTOPLAY_PREFETCH_QUEUE_THRESHOLD,
};
