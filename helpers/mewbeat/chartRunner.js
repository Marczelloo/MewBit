const path = require("node:path");
const { Worker } = require("node:worker_threads");

// Idle this long, the worker ends so it holds no memory; the next job starts a new one.
const IDLE_MS = 60_000;

// Makes charts (charts/generate.js generateAll) on a worker thread, so a song being charted does not block the event loop
// that plays a round. One job at a time, in the order they came; the worker is reused between jobs and never keeps the
// process alive. A crashed worker fails the job it was running (as a throw in generateAll does) and the next job starts afresh.
function createChartRunner({ workerFile = path.join(__dirname, "chartWorker.js"), idleMs = IDLE_MS } = {}) {
  const queue = [];
  let worker = null;
  let current = null;
  let idleTimer = null;
  let nextId = 0;

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
    if (queue.length) return pump();
    worker?.unref();
    idleTimer = setTimeout(retire, idleMs);
    idleTimer.unref();
  }

  // The worker that failed is gone with its job; whatever is queued runs on a new one.
  function lost(failing, error) {
    if (worker !== failing) return;
    worker = null;
    if (current) settle(current, { error });
    else if (queue.length) pump();
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

  function pump() {
    if (current || !queue.length) return;
    clearTimeout(idleTimer);
    const job = queue.shift();
    current = job;
    try {
      worker ??= spawn();
      worker.ref();
      worker.postMessage({ id: job.id, features: job.features, audioKey: job.audioKey, flags: job.flags });
    } catch (error) {
      retire();
      settle(job, { error });
    }
  }

  function run(features, audioKey, flags) {
    return new Promise((resolve, reject) => {
      queue.push({ id: nextId++, features, audioKey, flags, resolve, reject });
      pump();
    });
  }

  return { run };
}

module.exports = { createChartRunner };
