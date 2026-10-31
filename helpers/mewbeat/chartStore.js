const fs = require("node:fs");
const path = require("node:path");

const Log = require("../logs/log");
const { backupCorruptFile, writeJsonAtomic } = require("../data/atomicJson");
const { audioKeyFile, audioKeyOf } = require("./audioKey");
const { analysisClient } = require("./analysisClient");
const { GENERATOR_VERSION, generateAll } = require("./charts/generate");

const DIFFICULTIES = ["easy", "normal", "hard"];
const MEMORY_CAPACITY = 16;

// The generator version is part of the file name, so a version bump simply
// stops finding the old files and regenerates from the cached features.
function chartsPathOf(dir, key) {
  return path.join(dir, "charts", `${audioKeyFile(key)}.v${GENERATOR_VERSION}.json`);
}

function isChartSet(value, key) {
  return DIFFICULTIES.every((difficulty) =>
    value?.[difficulty]?.audioKey === key && Array.isArray(value[difficulty].notes));
}

// Returns the charts, null for a miss, or false for a file that exists but is
// unusable (unparseable, or charts for some other audio).
function parseChartsFile(text, key) {
  try {
    const value = JSON.parse(text);
    return isChartSet(value, key) ? value : false;
  } catch {
    return false;
  }
}

function createChartStore({ dir, analysis, generate = generateAll, log = Log }) {
  const chartsByKey = new Map();
  const pendingByKey = new Map();

  function readMemory(key) {
    const charts = chartsByKey.get(key);
    if (charts) {
      chartsByKey.delete(key);
      chartsByKey.set(key, charts);
    }
    return charts;
  }

  function writeMemory(key, charts) {
    chartsByKey.delete(key);
    chartsByKey.set(key, charts);
    if (chartsByKey.size > MEMORY_CAPACITY) chartsByKey.delete(chartsByKey.keys().next().value);
  }

  function readDisk(key) {
    let text;
    try {
      text = fs.readFileSync(chartsPathOf(dir, key), "utf8");
    } catch {
      return null;
    }
    return parseChartsFile(text, key);
  }

  async function resolve(track, key, node) {
    const stored = readDisk(key);
    if (stored) {
      writeMemory(key, stored);
      return stored;
    }
    if (stored === false) {
      await backupCorruptFile(chartsPathOf(dir, key)).catch((error) => {
        log.warning("mewbeat could not back up corrupt charts", error?.message);
      });
    }

    const features = await analysis.getFeatures(track, node);
    if (!features) return null;
    const charts = generate(features, key);
    if (!charts) return null;

    writeMemory(key, charts);
    await writeJsonAtomic(chartsPathOf(dir, key), charts).catch((error) => {
      log.warning("mewbeat could not persist charts", error?.message);
    });
    return charts;
  }

  function getCharts(track, node) {
    const key = audioKeyOf(track);
    if (!key) return Promise.resolve(null);
    const cached = readMemory(key);
    if (cached) return Promise.resolve(cached);
    const pending = pendingByKey.get(key);
    if (pending) return pending;

    const request = resolve(track, key, node).finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, request);
    return request;
  }

  // Synchronous lookup for UI hints; never analyses or generates.
  function peekCharts(track) {
    const key = audioKeyOf(track);
    if (!key) return null;
    const cached = readMemory(key);
    if (cached) return cached;
    const stored = readDisk(key);
    if (!stored) return null;
    writeMemory(key, stored);
    return stored;
  }

  return { getCharts, peekCharts };
}

module.exports = {
  chartStore: createChartStore({
    analysis: analysisClient,
    dir: path.join(__dirname, "..", "data", "mewbeat"),
  }),
  createChartStore,
};
