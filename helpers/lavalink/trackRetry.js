const Log = require("../logs/log");

// YouTube streams fail mid-song for reasons that clear up seconds later: a read
// timeout on the TV client, a googlevideo 403 on one client while another still
// serves the same video. A mirror is a different upload and a skip loses the
// song, so the track that failed gets replayed first, from where it stopped.
// The budget resets whenever a retry made real progress, so a long song that
// stumbles twice gets to finish, while one that dies at the same spot does not
// loop forever.
const RETRY_DELAYS_MS = [1_000, 3_000];
const MAX_RETRIES_WITHOUT_PROGRESS = RETRY_DELAYS_MS.length;
const MAX_RETRIES_PER_TRACK = 6;
const PROGRESS_RESET_MS = 15_000;
const RESUME_TAIL_MS = 5_000;
// Poru answers TrackEnd(loadFailed) on a non-empty queue by calling play()
// 3 s later, which would swap the replay for the next queued song. The queue is
// held only until that TrackEnd has been processed.
const QUEUE_HOLD_MAX_MS = 2_000;

const heldQueues = new Map();

function planTrackRetry(track, position, error) {
  if (!track?.track) return null;
  // "common" is lavaplayer's word for an expected, permanent refusal: the video
  // is private, removed, or blocked. Replaying it only delays the mirror.
  if (error?.exception?.severity === "common") return null;

  track.userData = { ...(track.userData || {}) };
  const previous = track.userData.playbackRetry || { total: 0, sinceProgress: 0, lastFailureAt: 0 };
  const failedAt = Math.max(0, Number(position) || 0);
  const progressed = failedAt - previous.lastFailureAt >= PROGRESS_RESET_MS;
  const sinceProgress = progressed ? 0 : previous.sinceProgress;

  if (previous.total >= MAX_RETRIES_PER_TRACK || sinceProgress >= MAX_RETRIES_WITHOUT_PROGRESS) return null;

  track.userData.playbackRetry = {
    total: previous.total + 1,
    sinceProgress: sinceProgress + 1,
    lastFailureAt: Math.max(failedAt, previous.lastFailureAt),
  };

  const length = Number(track.info?.length) || 0;
  const canResume =
    failedAt > 0 &&
    track.info?.isSeekable !== false &&
    !track.info?.isStream &&
    (!length || failedAt < length - RESUME_TAIL_MS);

  return {
    attempt: previous.total + 1,
    delayMs: RETRY_DELAYS_MS[sinceProgress],
    resumeAt: canResume ? failedAt : 0,
  };
}

function holdQueueForRecovery(player) {
  const guildId = player?.guildId;
  if (!guildId || !player.queue?.length || heldQueues.has(guildId)) return;

  const tracks = player.queue.splice(0, player.queue.length);
  const timer = setTimeout(() => releaseHeldQueue(player), QUEUE_HOLD_MAX_MS);
  timer.unref?.();
  heldQueues.set(guildId, { tracks, timer });
}

// Held songs go back in front of anything queued during the hold; a mirror the
// recovery queued has already been taken by play() by then.
function releaseHeldQueue(player) {
  const held = heldQueues.get(player?.guildId);
  if (!held) return false;

  heldQueues.delete(player.guildId);
  clearTimeout(held.timer);
  player.queue.splice(0, 0, ...held.tracks);
  return true;
}

// The TrackStart of a replay continues a song already announced and counted;
// it is consumed once so a later loop of the same track counts again.
function consumeReplay(track) {
  const replay = track?.userData?.replay;
  if (!replay) return null;
  delete track.userData.replay;
  return replay;
}

async function replayFailedTrack(player, track, plan, { wait, isCurrent, beforeStart }) {
  await wait(plan.delayMs);
  // The listeners may have stopped, skipped or replaced it during the wait.
  if (!isCurrent()) return false;

  track.userData = { ...(track.userData || {}), replay: { resumeAt: plan.resumeAt } };
  player.currentTrack = track;
  // Armed before the request: TrackStart can arrive before it resolves.
  beforeStart?.();
  try {
    await player.node.rest.updatePlayer({
      guildId: player.guildId,
      data: { track: { encoded: track.track }, position: plan.resumeAt },
    });
  } catch (error) {
    Log.warning("Replaying the failed track was refused", error?.message || String(error), `guild=${player.guildId}`);
    delete track.userData.replay;
    return false;
  }

  player.isPlaying = true;
  player.isPaused = false;
  player.position = plan.resumeAt;
  return true;
}

module.exports = {
  planTrackRetry,
  holdQueueForRecovery,
  releaseHeldQueue,
  consumeReplay,
  replayFailedTrack,
};
