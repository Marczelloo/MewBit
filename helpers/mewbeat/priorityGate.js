const PLAY = "play";
const BACKGROUND = "background";

// Charting work has two priorities: "play" (a player is waiting: a Solo Play, a room queue add, the tour) and "background"
// (everything else: a song chosen from the list, the re-chart after a version bump, a track the bot plays in voice).
// A gate is the place where such work is actually queued, so it cannot be bypassed by a second queue in front of it:
//   - play work always starts before queued background work (a job that is running is never interrupted);
//   - background work with a key that is already queued or running is not queued twice, the caller gets the same result;
//     a play request for a key that waits as background takes over that job's place in the play line (promote);
//   - at most `backgroundCap` background jobs wait; one more is refused with an error whose `code` is "QUEUE_FULL".
// `concurrency` jobs run at once. With `playBypass` a play job starts at once whatever else runs (background work then
// only starts while nothing at all runs), for a resource that queues by itself, like the analysis in the Lavalink plugin.
// `onIdle` is called when the last job ends and nothing waits.
function createPriorityGate({ concurrency = 1, playBypass = false, backgroundCap = Infinity, onIdle = () => {} } = {}) {
  const queues = { [PLAY]: [], [BACKGROUND]: [] };
  const keyed = new Map(); // key -> the entry of a job that was queued as background, while it waits or runs
  let running = 0;

  function finish(entry) {
    running -= 1;
    if (entry.key !== null && keyed.get(entry.key) === entry) keyed.delete(entry.key);
    dispatch();
    if (running === 0 && !queues[PLAY].length && !queues[BACKGROUND].length) onIdle();
  }

  async function start(entry) {
    running += 1;
    entry.started = true;
    try {
      entry.resolve(await entry.task());
    } catch (error) {
      entry.reject(error);
    } finally {
      finish(entry);
    }
  }

  function dispatch() {
    for (;;) {
      if (queues[PLAY].length && (playBypass || running < concurrency)) start(queues[PLAY].shift());
      else if (!queues[PLAY].length && queues[BACKGROUND].length && running < concurrency) start(queues[BACKGROUND].shift());
      else return;
    }
  }

  // The background job of a key that still waits, moved to the end of the play line. Null when there is none.
  function promoteEntry(key) {
    const entry = key === null ? null : keyed.get(key);
    if (!entry || entry.started || entry.priority !== BACKGROUND) return null;
    queues[BACKGROUND].splice(queues[BACKGROUND].indexOf(entry), 1);
    entry.priority = PLAY;
    queues[PLAY].push(entry);
    dispatch();
    return entry;
  }

  // Resolves with the task's result. A job promoted from background keeps its original task.
  function run(task, { priority = PLAY, key = null } = {}) {
    if (priority === PLAY) {
      const promoted = promoteEntry(key);
      if (promoted) return promoted.promise;
    } else {
      const known = key === null ? null : keyed.get(key);
      if (known) return known.promise;
      if (queues[BACKGROUND].length >= backgroundCap) {
        return Promise.reject(Object.assign(new Error("the background queue is full"), { code: "QUEUE_FULL" }));
      }
    }
    const entry = { task, key, priority, started: false };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    if (priority === BACKGROUND) {
      if (key !== null) keyed.set(key, entry);
      queues[BACKGROUND].push(entry);
    } else {
      queues[PLAY].push(entry);
    }
    dispatch();
    return entry.promise;
  }

  return {
    run,
    promote: (key) => promoteEntry(key) !== null,
    size: () => ({ running, play: queues[PLAY].length, background: queues[BACKGROUND].length }),
  };
}

module.exports = { BACKGROUND, PLAY, createPriorityGate };
