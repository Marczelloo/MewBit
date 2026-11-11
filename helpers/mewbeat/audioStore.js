const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const Log = require("../logs/log");
const { audioKeyFile } = require("./audioKey");
const { createPriorityGate } = require("./priorityGate");

const AUDIO_ROUTE = "/v4/mewbeat/audio";
// The plugin holds one request for its own job timeout plus queue wait.
const REQUEST_TIMEOUT_MS = 150_000;

// Asks the Lavalink node's mewbeat plugin for the Ogg Opus rendition of a
// track. Poru's rest helper parses JSON, so the bytes are fetched directly
// with the node's own url and password.
async function fetchPluginAudio(track, node, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const base = node?.restURL ?? node?.rest?.url;
  if (!base) throw Object.assign(new Error("No Lavalink node to render audio."), { statusCode: 503 });
  const response = await fetch(`${base}${AUDIO_ROUTE}`, {
    method: "POST",
    headers: { Authorization: node.password, "Content-Type": "application/json" },
    body: JSON.stringify({ encodedTrack: track.track }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) {
    throw Object.assign(new Error(`The mewbeat audio route answered ${response.status}.`), { statusCode: response.status });
  }
  return Buffer.from(await response.arrayBuffer());
}

// Warm-ups and decodes that wait for the plugin's audio worker; one more is refused (the song is rendered when a player asks).
const MAX_BACKGROUND = 30;

function createAudioStore({ dir, fetchAudio = fetchPluginAudio, maxFiles = 40, maxBackground = MAX_BACKGROUND, log = Log }) {
  const pendingByKey = new Map();
  // Plugin jobs run one at a time across keys (the plugin's audio worker keeps two waiting and refuses the rest).
  const gate = createPriorityGate({ concurrency: 1, backgroundCap: maxBackground });
  let nextEntry = 0;

  const fileOf = (audioKey) => path.join(dir, `${audioKeyFile(audioKey)}.ogg`);

  async function evict() {
    const names = (await fsPromises.readdir(dir)).filter((name) => name.endsWith(".ogg"));
    if (names.length <= maxFiles) return;
    const stats = await Promise.all(names.map(async (name) => {
      const file = path.join(dir, name);
      try {
        return { file, mtimeMs: (await fsPromises.stat(file)).mtimeMs };
      } catch {
        return null;
      }
    }));
    const oldestFirst = stats.filter(Boolean).sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const { file } of oldestFirst.slice(0, Math.max(0, oldestFirst.length - maxFiles))) {
      await fsPromises.rm(file, { force: true }).catch(() => {});
    }
  }

  async function fetchAndStore(audioKey, track, node, file) {
    const bytes = await fetchAudio(track, node);
    await fsPromises.mkdir(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fsPromises.writeFile(temp, bytes);
      await fsPromises.rename(temp, file);
    } finally {
      await fsPromises.rm(temp, { force: true }).catch(() => {});
    }
    try {
      await evict();
    } catch (error) {
      log.warning("mewbeat audio eviction failed", error?.message);
    }
  }

  // `state` is the pending entry: a job still waiting in the queue is dropped when every waiter has left (state.cancelled),
  // one that is already rendering runs on and its file stays for the next request.
  async function load(audioKey, track, node, state) {
    const file = fileOf(audioKey);
    try {
      const now = new Date();
      await fsPromises.utimes(file, now, now);
      return file;
    } catch {
      // not cached yet
    }

    await gate.run(async () => {
      if (state.cancelled) throw Object.assign(new Error("The audio request was cancelled."), { cancelled: true });
      // A job queued behind another one for the same key may find it written.
      try {
        await fsPromises.access(file);
        return;
      } catch {
        // still missing
      }
      state.started = true;
      await fetchAndStore(audioKey, track, node, file);
    }, { priority: state.priority, key: state.gateKey });
    return file;
  }

  // get(audioKey, track, node, { signal, priority }): the file of the song's rendition, rendering it when it is missing.
  // Callers share one job per key. A caller whose signal aborts stops waiting (the promise rejects with the signal's
  // reason); when none is left waiting and the job has not started, the job is cancelled. A caller without a signal never
  // leaves (warm-ups), so its job always runs.
  //
  // priority "play" is a player who waits for the file; "background" is work nobody waits for (a warm-up, a decode). It
  // defaults to play for a caller with a signal (the audio route) and to background for one without. Play jobs go first in
  // the order they came; a play request for a job that waits as background takes over its place. A background job is
  // refused with code "QUEUE_FULL" while maxBackground of them wait.
  function get(audioKey, track, node, { signal, priority = signal ? "play" : "background" } = {}) {
    let entry = pendingByKey.get(audioKey);
    if (entry?.cancelled) {
      pendingByKey.delete(audioKey);
      entry = null;
    }
    if (!entry) {
      // The gate's key is per entry: a cancelled job still waits in the gate and must not be taken for the new one.
      entry = { waiters: 0, started: false, cancelled: false, priority, gateKey: `${audioKey}\n${nextEntry++}`, promise: null };
      const created = entry;
      created.promise = load(audioKey, track, node, created).finally(() => {
        if (pendingByKey.get(audioKey) === created) pendingByKey.delete(audioKey);
      });
      created.promise.catch(() => {}); // a cancelled job has no one left to hear its rejection
      pendingByKey.set(audioKey, created);
    } else if (priority === "play" && entry.priority !== "play") {
      entry.priority = "play";
      gate.promote(entry.gateKey);
    }
    const joined = entry;
    joined.waiters += 1;
    if (!signal) return joined.promise;

    return new Promise((resolve, reject) => {
      let left = false;
      const leave = () => {
        if (left) return;
        left = true;
        signal.removeEventListener("abort", onAbort);
        joined.waiters -= 1;
        if (joined.waiters <= 0 && !joined.started) joined.cancelled = true;
      };
      const onAbort = () => {
        leave();
        reject(signal.reason ?? Object.assign(new Error("The audio request was cancelled."), { cancelled: true }));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      joined.promise.then(
        (file) => { if (!left) { left = true; signal.removeEventListener("abort", onAbort); resolve(file); } },
        (error) => { if (!left) { left = true; signal.removeEventListener("abort", onAbort); reject(error); } },
      );
    });
  }

  // How many renders run and wait: { running, play, background } (for the status lines and the tests).
  function size() {
    return gate.size();
  }

  return { get, size };
}

module.exports = { createAudioStore, fetchPluginAudio };
