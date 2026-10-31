const { markActivityStateChanged } = require("../activity/sync");
const { getGuildState } = require("../guildState");
const Log = require("../logs/log");
const { getAIDJTimeoutBudget } = require("./aiDj");
const { recordAutoplayExposure } = require("./autoplayExposure");
const { fetchAutoplayV3Track } = require("./autoplayV3");
const { isAutoplayTrack } = require("./queueOrdering");
const { recordSkip } = require("./skipLearning");
const { cloneTrack, rememberAutoplayTrack } = require("./state");

const AUTOPLAY_PREFETCH_QUEUE_THRESHOLD = 1;
// Queue edits often come in bursts (a playlist, a few quick adds); one
// re-pick after they settle sees the final queue.
const AUTOPLAY_REFRESH_DEBOUNCE_MS = Number(process.env.AUTOPLAY_REFRESH_DEBOUNCE_MS ?? 1500);
// A re-pick needs a provider lookup and often an AI plan. With less than
// this left before the pick plays, the old pick stays rather than racing it.
const AUTOPLAY_REFRESH_MIN_REMAINING_MS = 20_000;
// guildId -> { owner, task }. The owner is the Poru player the task queues
// into: after /stop and a fresh start the guild has a new player, and a task
// still finishing for the destroyed one must not stand in for its prefetch.
const autoplayInFlight = new Map();
const refreshTimers = new Map();

function getPendingManualTracks(player) {
  return Array.from(player?.queue || [])
    .filter((track) => !isAutoplayTrack(track))
    .slice(0, 4);
}

// The playing track and the queue, which a pick must not repeat. `except` is
// the pick being re-chosen: picking it again is a valid answer.
function getLiveTracks(player, except = null) {
  return [player?.currentTrack, ...Array.from(player?.queue || [])]
    .filter((track) => track && track !== except);
}

function runSharedAutoplayTask(guildId, createTask, owner = null) {
  const existing = getAutoplayInFlight(guildId, owner);
  if (existing) return existing;

  const task = Promise.resolve().then(createTask);
  autoplayInFlight.set(guildId, { owner, task });

  task.finally(() => {
    if (autoplayInFlight.get(guildId)?.task === task) autoplayInFlight.delete(guildId);
  }).catch(() => undefined);

  return task;
}

/**
 * Whether the player is still the guild's live one. /stop destroys the
 * player; anything a lookup started for it must not land in a queue nobody
 * plays. Players without a Poru registry (tests) count as live.
 */
function isLivePlayer(player) {
  const players = player?.poru?.players;
  if (!players || typeof players.get !== "function") return true;
  return players.get(player.guildId) === player;
}

function getTrackKey(track) {
  const info = track?.info || {};
  return info.identifier || info.uri || `${info.author || ""}|${info.title || ""}`;
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

/**
 * Time until the queue slot at `index` starts playing: what is left of the
 * current track plus every queued track ahead of it. Null when that is
 * unknown (nothing playing), so callers keep the short default budget.
 */
function getPlaybackRunwayMs(player, index = Array.from(player?.queue || []).length) {
  if (!player?.currentTrack) return null;
  const ahead = Array.from(player.queue || []).slice(0, Math.max(0, index));
  return ahead.reduce((total, track) => {
    const info = track?.info || {};
    return total + (info.isStream ? Infinity : Number(info.length) || 0);
  }, getRemainingMs(player));
}

function queueAutoplayTrack(player, lastTrack, textChannelId, { aiTimeoutMs = null } = {}) {
  if (!player || !lastTrack) {
    Log.warning("Autoplay called without player or lastTrack");
    return Promise.resolve(false);
  }

  const existing = getAutoplayInFlight(player.guildId, player);
  if (existing) {
    Log.debug("Autoplay fetch already in progress", "", `guild=${player.guildId}`);
    return existing;
  }

  return runSharedAutoplayTask(player.guildId, async () => {
    try {
      const relatedTrack = await fetchAutoplayV3Track(lastTrack, player.guildId, {
        // A queued reference is already the selection's starting point.
        pendingManualTracks: getPendingManualTracks(player).filter((track) => track !== lastTrack),
        liveTracks: getLiveTracks(player),
        aiTimeoutMs,
      });

      if (!relatedTrack) {
        Log.warning("Smart autoplay could not find a related track", "", `guild=${player.guildId}`);
        return false;
      }

      if (!isLivePlayer(player)) {
        Log.info("Autoplay pick dropped - the player was stopped during the lookup", "", `guild=${player.guildId}`);
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

      const cloned = decorateAutoplayTrack(relatedTrack, player, textChannelId, {
        autoplayAfterKey: getTrackKey(lastTrack),
      });

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
  }, player);
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

  if (getAutoplayInFlight(player.guildId, player)) {
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
        liveTracks: getLiveTracks(player, rejectedTrack),
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
      if (!isLivePlayer(player)) {
        return { success: false, stale: true, error: "Playback stopped before a replacement was ready." };
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
        autoplayAfterKey: getTrackKey(position > 0 ? queue[position - 1] : player.currentTrack),
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
  }, player);
}

function getRefreshTarget(player) {
  const queue = Array.from(player?.queue || []);
  const index = queue.findIndex((track) => isAutoplayTrack(track));
  if (index < 0) return null;
  const pick = queue[index];
  const referenceTrack = index > 0 ? queue[index - 1] : player.currentTrack;
  const afterKey = pick?.userData?.autoplayAfterKey;
  // Picks queued before the key existed cannot tell what they followed.
  if (!referenceTrack || !afterKey || afterKey === getTrackKey(referenceTrack)) return null;
  return { pick, index, referenceTrack };
}

function getRemainingMs(player) {
  const info = player?.currentTrack?.info || {};
  const length = Number(info.length) || 0;
  if (!length || info.isStream) return Infinity;
  return Math.max(0, length - (Number(player.position) || 0));
}

/**
 * Flags the autoplay pick Activity shows as "picking a fresh one". The flag
 * lives on the queued track, so a replaced or removed pick takes it along.
 */
function setAutoplayRefreshing(player, pick, refreshing) {
  if (!pick?.userData || Boolean(pick.userData.autoplayRefreshing) === refreshing) return;
  if (refreshing) pick.userData.autoplayRefreshing = true;
  else delete pick.userData.autoplayRefreshing;
  markActivityStateChanged(player.guildId, "autoplayRefreshing");
}

function clearAutoplayRefreshing(player) {
  for (const track of Array.from(player?.queue || [])) {
    if (track?.userData?.autoplayRefreshing) setAutoplayRefreshing(player, track, false);
  }
}

function findQueuedPick(player, pick) {
  const queue = Array.from(player.queue || []);
  const pickQueueId = pick.userData?.activityQueueId;
  let position = queue.indexOf(pick);
  if (position < 0 && pickQueueId) {
    position = queue.findIndex((track) => track?.userData?.activityQueueId === pickQueueId);
  }
  return position >= 0 && isAutoplayTrack(queue[position]) ? position : -1;
}

// Drops the pick and the chain that followed it.
function removeAutoplayChain(player, position) {
  for (let index = player.queue.length - 1; index >= position; index -= 1) {
    if (isAutoplayTrack(player.queue[index])) player.queue.splice(index, 1);
  }
}

/**
 * Re-picks the queued autoplay track when the track it was chosen to follow
 * is no longer the one before it: a listener queued something, removed or
 * moved a track, or playback reached a song the pick was not chosen for.
 * The old pick stays visible (flagged as refreshing) until a new one is
 * ready. If no new one is found, a pick that is not up next is dropped and
 * the prefetch for the track before it chooses again; a pick that is up next
 * gets one quick retry and is kept only if that fails too, because dropping
 * it would leave the room in silence.
 */
async function refreshQueuedAutoplayTrack(player, textChannelId = player?.textChannel) {
  if (!player || !isLivePlayer(player)) return false;
  if (!getGuildState(player.guildId)?.autoplay) {
    clearAutoplayRefreshing(player);
    return false;
  }

  // A pick still being chosen lands first; judge the queue it lands in.
  const pending = getAutoplayInFlight(player.guildId, player);
  if (pending) await pending.catch(() => false);

  const target = getRefreshTarget(player);
  if (!target) {
    clearAutoplayRefreshing(player);
    return false;
  }
  if (target.index === 0 && getRemainingMs(player) < AUTOPLAY_REFRESH_MIN_REMAINING_MS) {
    clearAutoplayRefreshing(player);
    Log.debug("Autoplay refresh skipped - the pick plays too soon", "", `guild=${player.guildId}`);
    return false;
  }

  const { pick, referenceTrack } = target;
  const staleSummary = `${pick.info?.author || "Unknown"} - ${pick.info?.title || "Unknown"}`;
  setAutoplayRefreshing(player, pick, true);

  const pickFresh = (aiTimeoutMs) => fetchAutoplayV3Track(referenceTrack, player.guildId, {
    pendingManualTracks: getPendingManualTracks(player).filter((track) => track !== referenceTrack),
    liveTracks: getLiveTracks(player, pick),
    aiTimeoutMs,
    selectionIntent: {
      mode: "refresh",
      goal: "The listener changed the queue. Choose what should follow the track before the autoplay slot, fitting the queued tracks too.",
    },
  });

  return runSharedAutoplayTask(player.guildId, async () => {
    try {
      let relatedTrack = null;
      try {
        relatedTrack = await pickFresh(getAIDJTimeoutBudget(getPlaybackRunwayMs(player, target.index)));
      } catch (error) {
        Log.error("❌ Autoplay refresh failed", error, `guild=${player.guildId}`);
      }
      if (!isLivePlayer(player)) return false;

      let position = findQueuedPick(player, pick);
      if (position < 0) return false;

      if (!relatedTrack && position > 0) {
        removeAutoplayChain(player, position);
        markActivityStateChanged(player.guildId, "autoplayRefreshDropped");
        Log.info(
          "Autoplay pick dropped - no fresh pick for the new queue",
          staleSummary,
          `after=${referenceTrack.info?.title || "Unknown"}`,
          `guild=${player.guildId}`
        );
        return false;
      }

      if (!relatedTrack) {
        // Up next: one quick retry with the short interactive budget.
        try {
          relatedTrack = await pickFresh(null);
        } catch (error) {
          Log.error("❌ Autoplay refresh retry failed", error, `guild=${player.guildId}`);
        }
        if (!isLivePlayer(player)) return false;
        position = findQueuedPick(player, pick);
        if (position < 0) return false;
        if (!relatedTrack) {
          Log.warning("Autoplay refresh kept the old pick - it plays next and no fresh one was found", staleSummary, `guild=${player.guildId}`);
          return false;
        }
      }

      const queue = Array.from(player.queue || []);

      const cloned = decorateAutoplayTrack(relatedTrack, player, textChannelId, {
        autoplayAfterKey: getTrackKey(position > 0 ? queue[position - 1] : player.currentTrack),
      });
      player.queue.splice(position, 1, cloned);
      // A chain of picks followed the old one; the next prefetch rebuilds it.
      for (let index = player.queue.length - 1; index > position; index -= 1) {
        if (isAutoplayTrack(player.queue[index])) player.queue.splice(index, 1);
      }
      rememberAutoplayTrack(player.guildId, cloned);
      markActivityStateChanged(player.guildId, "autoplayRefreshed");
      await recordAutoplayExposure(player.guildId, cloned, referenceTrack).catch((error) => {
        Log.warning("Autoplay refresh exposure update failed", "", `guild=${player.guildId}`, `error=${error.message}`);
      });

      Log.info(
        "🔄 Autoplay pick refreshed for the new queue",
        `${staleSummary} => ${cloned.info?.author || "Unknown"} - ${cloned.info?.title || "Unknown"}`,
        `after=${referenceTrack.info?.title || "Unknown"}`,
        `guild=${player.guildId}`
      );
      return true;
    } catch (error) {
      Log.error("❌ Autoplay refresh failed", error, `guild=${player.guildId}`);
      return false;
    } finally {
      setAutoplayRefreshing(player, pick, false);
    }
  }, player);
}

/**
 * Debounced refreshQueuedAutoplayTrack, for every place the queue in front
 * of the autoplay pick can change.
 */
function scheduleAutoplayRefresh(player, textChannelId = player?.textChannel) {
  if (!player?.guildId) return;
  clearTimeout(refreshTimers.get(player.guildId));
  // Show the stale pick as being re-chosen now, not after the debounce.
  if (getGuildState(player.guildId)?.autoplay) {
    const target = getRefreshTarget(player);
    if (target) setAutoplayRefreshing(player, target.pick, true);
  }
  const timer = setTimeout(() => {
    if (refreshTimers.get(player.guildId) === timer) refreshTimers.delete(player.guildId);
    void refreshQueuedAutoplayTrack(player, textChannelId).catch((error) => {
      Log.warning("Autoplay refresh crashed", error?.message || String(error), `guild=${player.guildId}`);
    });
  }, AUTOPLAY_REFRESH_DEBOUNCE_MS);
  timer.unref?.();
  refreshTimers.set(player.guildId, timer);
}

/**
 * Starts autoplay before the queue is empty so Lavalink has a next track ready
 * when the current one finishes. The queue-end handler remains as a fallback.
 */
async function prefetchAutoplayTrack(player, currentTrack, textChannelId) {
  if (!player || !currentTrack) return false;
  // One pick waits at a time. Queuing a second pick behind an earlier one is
  // what turned a manual add into two autoplay tracks; a pick that no longer
  // follows the right track is re-picked instead.
  if (Array.from(player.queue || []).some((track) => isAutoplayTrack(track))) {
    scheduleAutoplayRefresh(player, textChannelId);
    return false;
  }
  if (player.queue.length > AUTOPLAY_PREFETCH_QUEUE_THRESHOLD) return false;

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

  // A prefetch has the rest of the queue to think; give the AI DJ that time
  // instead of the short budget queue-end and replace picks need.
  return queueAutoplayTrack(player, referenceTrack, textChannelId, {
    aiTimeoutMs: getAIDJTimeoutBudget(getPlaybackRunwayMs(player)),
  });
}

function isAutoplayInFlight(guildId, player = null) {
  return Boolean(getAutoplayInFlight(guildId, player));
}

/**
 * The guild's running lookup. With a player, only one queuing into that
 * player: a lookup left over from a destroyed player does not count.
 */
function getAutoplayInFlight(guildId, player = null) {
  const entry = autoplayInFlight.get(guildId);
  if (!entry) return null;
  if (player && entry.owner && entry.owner !== player) return null;
  return entry.task;
}

module.exports = {
  queueAutoplayTrack,
  replaceQueuedAutoplayTrack,
  prefetchAutoplayTrack,
  isAutoplayInFlight,
  getAutoplayInFlight,
  refreshQueuedAutoplayTrack,
  runSharedAutoplayTask,
  scheduleAutoplayRefresh,
  AUTOPLAY_PREFETCH_QUEUE_THRESHOLD,
};
