const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const Log = require("../logs/log");
const { audioKeyFile } = require("./audioKey");

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

function createAudioStore({ dir, fetchAudio = fetchPluginAudio, maxFiles = 40, log = Log }) {
  const pendingByKey = new Map();
  // Plugin jobs run one at a time across keys; the chain never rejects.
  let queue = Promise.resolve();

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

  async function load(audioKey, track, node) {
    const file = fileOf(audioKey);
    try {
      const now = new Date();
      await fsPromises.utimes(file, now, now);
      return file;
    } catch {
      // not cached yet
    }

    const job = queue.then(async () => {
      // A job queued behind another one for the same key may find it written.
      try {
        await fsPromises.access(file);
        return;
      } catch {
        // still missing
      }
      await fetchAndStore(audioKey, track, node, file);
    });
    queue = job.catch(() => {});
    await job;
    return file;
  }

  function get(audioKey, track, node) {
    const pending = pendingByKey.get(audioKey);
    if (pending) return pending;
    const request = load(audioKey, track, node).finally(() => pendingByKey.delete(audioKey));
    pendingByKey.set(audioKey, request);
    return request;
  }

  return { get };
}

module.exports = { createAudioStore, fetchPluginAudio };
