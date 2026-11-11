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
// A task is called with the priority it runs under (a background job that was promoted runs as "play").
// `place(key)` says where a keyed job stands: { running: true } or { ahead } jobs that start before it.
// `onIdle` is called when the last job ends and nothing waits.
function createPriorityGate({ concurrency = 1, playBypass = false, backgroundCap = Infinity, onIdle = () => {} } = {}) {
  const queues = { [PLAY]: [], [BACKGROUND]: [] };
  const keyed = new Map(); // key -> the entry of a job that has a key, while it waits or runs
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
      entry.resolve(await entry.task(entry.priority));
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
    // A key that waits or runs is one job, whoever asks again; a play request moves a waiting background one up.
    const promoted = priority === PLAY ? promoteEntry(key) : null;
    if (promoted) return promoted.promise;
    const known = key === null ? null : keyed.get(key);
    if (known) return known.promise;
    if (priority === BACKGROUND && queues[BACKGROUND].length >= backgroundCap) {
      return Promise.reject(Object.assign(new Error("the background queue is full"), { code: "QUEUE_FULL" }));
    }
    const entry = { task, key, priority, started: false };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    if (key !== null) keyed.set(key, entry);
    queues[priority === BACKGROUND ? BACKGROUND : PLAY].push(entry);
    dispatch();
    return entry.promise;
  }

  // Where the job of a key stands: { running: true }, { ahead: n } with n jobs starting before it, or null when there is none.
  function place(key) {
    const entry = key === null ? null : keyed.get(key);
    if (!entry) return null;
    if (entry.started) return { running: true };
    if (entry.priority === PLAY) return { ahead: running + queues[PLAY].indexOf(entry) };
    return { ahead: running + queues[PLAY].length + queues[BACKGROUND].indexOf(entry) };
  }

  return {
    run,
    place,
    promote: (key) => promoteEntry(key) !== null,
    size: () => ({ running, play: queues[PLAY].length, background: queues[BACKGROUND].length }),
  };
}

module.exports = { BACKGROUND, PLAY, createPriorityGate };
