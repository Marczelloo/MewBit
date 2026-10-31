const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const Log = require("../logs/log");
const { writeJsonAtomic } = require("../data/atomicJson");
const { audioKeyFile, audioKeyOf } = require("./audioKey");

const ANALYZE_ROUTE = "/v4/mewbeat/analyze";
const FAILURE_TTL_MS = 10 * 60 * 1000;
const BUSY_TTL_MS = 30 * 1000;
const FEATURES_VERSION = 1; // must match the plugin
const MEMORY_CAPACITY = 32;

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

function createAnalysisClient({ dir, now = Date.now, log = Log }) {
  const featuresByKey = new Map();
  const unchartedKeys = new Set();
  const retryAfterByKey = new Map();
  const pendingByKey = new Map();

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
    else unchartedKeys.add(key);
  }

  function isBlocked(key) {
    const retryAfter = retryAfterByKey.get(key);
    if (retryAfter === undefined) return false;
    if (now() <= retryAfter) return true;
    retryAfterByKey.delete(key);
    return false;
  }

  function failFor(key, ttlMs) {
    retryAfterByKey.set(key, now() + ttlMs);
    return null;
  }

  // poru's rest.post drops the HTTP status and returns the parsed body, or
  // null on a network error, so the outcome is classified by the body alone.
  async function analyse(track, key, node) {
    let body;
    try {
      body = await node.rest.post(ANALYZE_ROUTE, { encodedTrack: track.track });
    } catch (error) {
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
      writeMemory(key, body);
      try {
        await writeJsonAtomic(featuresPathOf(dir, key), body);
      } catch (error) {
        log.warning("mewbeat could not persist features", error?.message);
      }
      return body;
    }

    if (body?.error === "uncharted") {
      unchartedKeys.add(key);
      try {
        await writeJsonAtomic(featuresPathOf(dir, key), { uncharted: true, reason: body.reason });
      } catch (error) {
        log.warning("mewbeat could not persist uncharted marker", error?.message);
      }
      return null;
    }

    if (body?.error === "busy") return failFor(key, BUSY_TTL_MS);

    log.warning("mewbeat analysis failed", body?.error ?? "no response", body?.message);
    return failFor(key, FAILURE_TTL_MS);
  }

  async function resolve(track, key, node) {
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
    return analyse(track, key, node);
  }

  function getFeatures(track, node) {
    const key = audioKeyOf(track);
    if (!key || unchartedKeys.has(key)) return Promise.resolve(null);
    const cached = readMemory(key);
    if (cached) return Promise.resolve(cached);
    if (isBlocked(key)) return Promise.resolve(null);
    const pending = pendingByKey.get(key);
    if (pending) return pending;

    const request = resolve(track, key, node).finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, request);
    return request;
  }

  // Memory, then disk. Never reaches Lavalink.
  function peek(track) {
    const key = audioKeyOf(track);
    if (!key || unchartedKeys.has(key)) return null;
    const cached = readMemory(key);
    if (cached) return cached;
    if (isBlocked(key)) return null;
    try {
      const entry = parseCacheFile(fs.readFileSync(featuresPathOf(dir, key), "utf8"));
      if (!entry) return null;
      remember(key, entry);
      return entry.features ?? null;
    } catch {
      return null;
    }
  }

  return { getFeatures, peek };
}

module.exports = {
  analysisClient: createAnalysisClient({ dir: path.join(__dirname, "..", "data", "mewbeat") }),
  createAnalysisClient,
};
