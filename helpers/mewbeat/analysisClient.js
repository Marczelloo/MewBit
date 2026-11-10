const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const Log = require("../logs/log");
const { writeJsonAtomic } = require("../data/atomicJson");
const { audioKeyFile, audioKeyOf } = require("./audioKey");
const { createPriorityGate } = require("./priorityGate");

const ANALYZE_ROUTE = "/v4/mewbeat/analyze";
const FAILURE_TTL_MS = 10 * 60 * 1000;
const BUSY_TTL_MS = 30 * 1000;
const FEATURES_VERSION = 4; // must match the plugin
const MEMORY_CAPACITY = 32;
// Poru's post is a bare fetch (about 5 minutes before it gives up) while the
// plugin holds a request for at most ~2 minutes of its own job timeout plus
// queue wait, so this is the longest we are willing to wait for one track.
const REQUEST_TIMEOUT_MS = 150_000;
const DURATION_SLACK_MIN_MS = 2000;
const DURATION_SLACK_RATIO = 0.05;
// An uncharted marker is a few dozen bytes; a features document is hundreds of kilobytes. statusOf, which is sync, only
// ever answers from a marker, so it does not read a file larger than this.
const MARKER_MAX_BYTES = 4096;

function featuresPathOf(dir, key) {
  return path.join(dir, "features", `${audioKeyFile(key)}.json`);
}

// A cache file is either a features document or an uncharted marker.
// Anything unreadable counts as a miss and is simply analysed again.
function parseCacheFile(text) {
  try {
    const value = JSON.parse(text);
    if (value?.uncharted === true) return { uncharted: true, reason: value.reason };
    if (value?.featuresVersion === FEATURES_VERSION) return { features: value };
  } catch {
    // corrupt file: treated as a miss
  }
  return null;
}

function audioMatchesTrack(features, track) {
  const audio = features.audio;
  return Boolean(audio)
    && String(audio.identifier) === String(track.info.identifier)
    && Number(audio.length) === Number(track.info.length);
}

// A decoder that stops early (dropped connection, a 30 s mirrored preview)
// still answers 200 with features for the part it got; the length must agree
// with the track, with slack for the decoder's observed +-0.1 s drift.
function durationMatchesTrack(features, track) {
  const expected = Number(track.info.length);
  return Math.abs(Number(features.durationMs) - expected) <= Math.max(DURATION_SLACK_MIN_MS, DURATION_SLACK_RATIO * expected);
}

class RequestTimeout extends Error {}

// Rejects with RequestTimeout when the promise has not settled in time; the
// late result of the original promise is simply ignored.
function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new RequestTimeout()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createAnalysisClient({ dir, now = Date.now, log = Log, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
  const featuresByKey = new Map();
  const unchartedKeys = new Map(); // key -> reason
  const blockedByKey = new Map(); // key -> { retryAfter, kind: "busy" | "failed" }
  const pendingByKey = new Map();
  // Where analyses wait for the plugin: a play analysis goes at once (the plugin queues those itself), a background one only
  // starts while nothing else runs, one at a time, and a play request takes over a background one that still waits.
  const gate = createPriorityGate({ concurrency: 1, playBypass: true });

  // Small LRU over full feature documents; disk is the backing store.
  function readMemory(key) {
    const features = featuresByKey.get(key);
    if (features) {
      featuresByKey.delete(key);
      featuresByKey.set(key, features);
    }
    return features;
  }

  function writeMemory(key, features) {
    featuresByKey.delete(key);
    featuresByKey.set(key, features);
    if (featuresByKey.size > MEMORY_CAPACITY) featuresByKey.delete(featuresByKey.keys().next().value);
  }

  function remember(key, entry) {
    if (entry.features) writeMemory(key, entry.features);
    else unchartedKeys.set(key, entry.reason);
  }

  // The live (unexpired) negative-cache entry for a key, if any.
  function blockOf(key) {
    const block = blockedByKey.get(key);
    if (!block) return null;
    if (now() <= block.retryAfter) return block;
    blockedByKey.delete(key);
    return null;
  }

  function failFor(key, ttlMs, kind = "failed") {
    blockedByKey.set(key, { retryAfter: now() + ttlMs, kind });
    return null;
  }

  // poru's rest.post drops the HTTP status and returns the parsed body, or
  // null on a network error, so the outcome is classified by the body alone.
  async function analyse(track, key, node) {
    // No Lavalink node (an offline pass over cached features): nothing to ask, and nothing to remember as a failure.
    if (!node?.rest) return null;
    let body;
    try {
      body = await withTimeout(node.rest.post(ANALYZE_ROUTE, { encodedTrack: track.track }), requestTimeoutMs);
    } catch (error) {
      if (error instanceof RequestTimeout) {
        // The plugin may still be working on it, so retry soon rather than in 10 minutes.
        log.warning("mewbeat analysis request timed out", key);
        return failFor(key, BUSY_TTL_MS, "busy");
      }
      log.warning("mewbeat analysis request failed", error?.message);
      return failFor(key, FAILURE_TTL_MS);
    }

    if (body?.featuresVersion != null) {
      if (body.featuresVersion !== FEATURES_VERSION) {
        log.warning("mewbeat features version mismatch", body.featuresVersion);
        return failFor(key, FAILURE_TTL_MS);
      }
      if (!audioMatchesTrack(body, track)) {
        log.warning("mewbeat analysed audio does not match the track", key);
        return failFor(key, FAILURE_TTL_MS);
      }
      if (!durationMatchesTrack(body, track)) {
        log.warning("mewbeat decoded duration does not match the track", key, body.durationMs);
        return failFor(key, FAILURE_TTL_MS);
      }
      writeMemory(key, body);
      try {
        await writeJsonAtomic(featuresPathOf(dir, key), body);
      } catch (error) {
        log.warning("mewbeat could not persist features", error?.message);
      }
      return body;
    }

    if (body?.error === "uncharted") {
      unchartedKeys.set(key, body.reason);
      try {
        await writeJsonAtomic(featuresPathOf(dir, key), { uncharted: true, reason: body.reason });
      } catch (error) {
        log.warning("mewbeat could not persist uncharted marker", error?.message);
      }
      return null;
    }

    if (body?.error === "busy") return failFor(key, BUSY_TTL_MS, "busy");

    log.warning("mewbeat analysis failed", body?.error ?? "no response", body?.message);
    return failFor(key, FAILURE_TTL_MS);
  }

  async function resolve(track, key, node, priority) {
    try {
      const text = await fsPromises.readFile(featuresPathOf(dir, key), "utf8");
      const entry = parseCacheFile(text);
      if (entry) {
        remember(key, entry);
        return entry.features ?? null;
      }
    } catch {
      // no file yet
    }
    return gate.run(() => analyse(track, key, node), { priority, key });
  }

  // priority: "play" (default; a player waits) or "background" (see priorityGate.js). A play request for a song that is
  // analysed as background takes over its place in the line.
  function getFeatures(track, node, { priority = "play" } = {}) {
    const key = audioKeyOf(track);
    if (!key || unchartedKeys.has(key)) return Promise.resolve(null);
    const cached = readMemory(key);
    if (cached) return Promise.resolve(cached);
    if (blockOf(key)) return Promise.resolve(null);
    const pending = pendingByKey.get(key);
    if (pending) {
      if (priority === "play") gate.promote(key);
      return pending;
    }

    const request = resolve(track, key, node, priority).finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, request);
    return request;
  }

  // Memory, then disk (read without blocking, features files are large). Never reaches Lavalink.
  async function peek(track) {
    const key = audioKeyOf(track);
    if (!key || unchartedKeys.has(key)) return null;
    const cached = readMemory(key);
    if (cached) return cached;
    if (blockOf(key)) return null;
    try {
      const entry = parseCacheFile(await fsPromises.readFile(featuresPathOf(dir, key), "utf8"));
      if (!entry) return null;
      remember(key, entry);
      return entry.features ?? null;
    } catch {
      return null;
    }
  }

  // Whether a features document is cached for the track: in memory, or a file on disk too large to be a marker. Sync, reads
  // nothing; the file may still turn out unusable (another features version), which getFeatures finds out.
  function hasFeatures(track) {
    const key = audioKeyOf(track);
    if (!key || unchartedKeys.has(key)) return false;
    if (featuresByKey.has(key)) return true;
    try {
      return fs.statSync(featuresPathOf(dir, key)).size > MARKER_MAX_BYTES;
    } catch {
      return false;
    }
  }

  // Why getFeatures/peek came back empty, or null when there is no negative
  // information (not asked yet, or the entry expired). Memory, then the
  // on-disk uncharted marker (a features file is not read); never reaches Lavalink.
  function statusOf(track) {
    const key = audioKeyOf(track);
    if (!key) return null;
    if (unchartedKeys.has(key)) return { status: "uncharted", reason: unchartedKeys.get(key) };
    const block = blockOf(key);
    if (block) return { status: block.kind };
    try {
      const file = featuresPathOf(dir, key);
      if (fs.statSync(file).size > MARKER_MAX_BYTES) return null;
      const entry = parseCacheFile(fs.readFileSync(file, "utf8"));
      if (entry?.uncharted) {
        remember(key, entry);
        return { status: "uncharted", reason: entry.reason };
      }
    } catch {
      // no file: nothing known
    }
    return null;
  }

  // An explicit retry: forgets why the track had no features (a failure or busy block, an uncharted verdict in memory and
  // the uncharted marker on disk) so the next getFeatures asks the plugin again. Real features are never touched. False,
  // with nothing forgotten, while an analysis of the track is still running (it is the one attempt that counts).
  async function forget(track) {
    const key = audioKeyOf(track);
    if (!key || pendingByKey.has(key)) return false;
    blockedByKey.delete(key);
    unchartedKeys.delete(key);
    const file = featuresPathOf(dir, key);
    try {
      if (parseCacheFile(await fsPromises.readFile(file, "utf8"))?.uncharted) await fsPromises.unlink(file);
    } catch {
      // no file, or one that vanished meanwhile: nothing to forget
    }
    return true;
  }

  // A play request for a song whose analysis waits as background: it takes the place of a play analysis in the line.
  function promote(track) {
    const key = audioKeyOf(track);
    return key ? gate.promote(key) : false;
  }

  return { getFeatures, peek, hasFeatures, promote, statusOf, forget };
}

module.exports = {
  analysisClient: createAnalysisClient({ dir: path.join(__dirname, "..", "data", "mewbeat") }),
  createAnalysisClient,
};
