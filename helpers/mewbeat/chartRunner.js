const path = require("node:path");
const { Worker } = require("node:worker_threads");

const { createPriorityGate } = require("./priorityGate");

// Idle this long, the worker ends so it holds no memory; the next job starts a new one.
const IDLE_MS = 60_000;

// Makes charts (charts/generate.js generateAll) on a worker thread, so a song being charted does not block the event loop
// that plays a round. One job at a time; a play job goes ahead of queued background jobs and the rest keep the order they
// came in (priorityGate.js, where the jobs wait). The worker is reused between jobs and never keeps the
// process alive. A crashed worker fails the job it was running (as a throw in generateAll does) and the next job starts afresh.
function createChartRunner({ workerFile = path.join(__dirname, "chartWorker.js"), idleMs = IDLE_MS } = {}) {
  let worker = null;
  let current = null;
  let idleTimer = null;
  let nextId = 0;
  const gate = createPriorityGate({
    concurrency: 1,
    backgroundCap: Infinity,
    onIdle: () => {
      if (!worker) return;
      worker.unref();
      idleTimer = setTimeout(retire, idleMs);
      idleTimer.unref();
    },
  });

  function retire() {
    const ending = worker;
    worker = null;
    ending?.terminate().catch(() => {});
  }

  function settle(job, outcome) {
    if (current !== job) return;
    current = null;
    if (outcome.error) job.reject(outcome.error);
    else job.resolve(outcome.charts);
  }

  // The worker that failed is gone with its job; whatever is queued runs on a new one.
  function lost(failing, error) {
    if (worker !== failing) return;
    worker = null;
    if (current) settle(current, { error });
  }

  function spawn() {
    const spawned = new Worker(workerFile);
    spawned.on("message", ({ id, charts, error }) => {
      if (current?.id !== id) return;
      if (!error) return settle(current, { charts });
      const failure = new Error(error.message);
      failure.stack = error.stack ?? failure.stack;
      settle(current, { error: failure });
    });
    spawned.on("error", (error) => lost(spawned, error));
    spawned.on("exit", (code) => lost(spawned, new Error(`mewbeat chart worker exited with code ${code}`)));
    return spawned;
  }

  // The job the gate lets go now; settled by the worker's answer or its loss.
  function execute(job) {
    return new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
      clearTimeout(idleTimer);
      current = job;
      try {
        worker ??= spawn();
        worker.ref();
        worker.postMessage({ id: job.id, features: job.features, audioKey: job.audioKey, flags: job.flags });
      } catch (error) {
        retire();
        settle(job, { error });
      }
    });
  }

  // priority: "play" (default) or "background". A background job with the same audio key and flags as one that waits or
  // runs is the same job. promote(audioKey) makes a waiting background job a play job.
  function run(features, audioKey, flags, { priority = "play" } = {}) {
    const job = { id: nextId++, features, audioKey, flags };
    return gate.run(() => execute(job), { priority, key: keyOf(audioKey, flags) });
  }

  // The gate's key for a job: the same audio charted under other flags is another job.
  function keyOf(audioKey, flags) {
    return `${audioKey}|${JSON.stringify(flags ?? {})}`;
  }

  function promote(audioKey, flags) {
    return gate.promote(keyOf(audioKey, flags));
  }

  // Where the job for this audio and flags stands (priorityGate.js place), or null.
  const place = (audioKey, flags) => gate.place(keyOf(audioKey, flags));

  return { run, promote, place, size: gate.size };
}

module.exports = { createChartRunner };
