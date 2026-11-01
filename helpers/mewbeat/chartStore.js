const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const Log = require("../logs/log");
const { backupCorruptFile, writeJsonAtomic } = require("../data/atomicJson");
const { audioKeyFile, audioKeyOf } = require("./audioKey");
const { analysisClient } = require("./analysisClient");
const { calibrationCharts, isCalibrationTrack } = require("./calibrationTrack");
const { GENERATOR_VERSION, generateAll } = require("./charts/generate");

const DIFFICULTIES = ["easy", "normal", "hard"];
const MEMORY_CAPACITY = 16;
const NO_AUDIO_KEY = "no_audio_key";
const TOO_FEW_NOTES = "too_few_notes";

// The generator version is part of the file name, so a version bump simply
// stops finding the old files and regenerates from the cached features.
//
// The chart file is the source of truth for an audioKey + version: scores
// refer to it. Features are not bit-reproducible across machines (decoder
// length drift, JVM math), so wiping only the features cache must not
// regenerate a chart that already exists, and a deliberate regeneration needs
// a GENERATOR_VERSION bump.
function chartsPathOf(dir, key) {
  return path.join(dir, "charts", `${audioKeyFile(key)}.v${GENERATOR_VERSION}.json`);
}

function isChartSet(value, key) {
  return DIFFICULTIES.every((difficulty) =>
    value?.[difficulty]?.audioKey === key && Array.isArray(value[difficulty].notes));
}

// Returns the charts, an `{ uncharted: true, reason }` marker, or false for a
// file that is unusable (unparseable, or charts for some other audio).
function parseChartsFile(text, key) {
  try {
    const value = JSON.parse(text);
    if (value?.uncharted === true) return { uncharted: true, reason: value.reason };
    return isChartSet(value, key) ? value : false;
  } catch {
    return false;
  }
}

const VERSIONED_CHART_FILE = /\.v(\d+)\.json$/; // `.corrupt-` backups end differently and never match

const READY = (charts) => ({ status: "ready", charts });
const UNCHARTED = (reason) => ({ status: "uncharted", reason });

function createChartStore({ dir, analysis, generate = generateAll, log = Log }) {
  const chartsByKey = new Map();
  const unchartedByKey = new Map(); // key -> reason
  const pendingByKey = new Map();
  let sweep = null;

  // Charts of other generator versions are never read again; drop them once
  // per store so each version bump does not leave the old files behind.
  function sweepOldVersions() {
    sweep ??= (async () => {
      const chartsDir = path.join(dir, "charts");
      let names;
      try {
        names = await fsPromises.readdir(chartsDir);
      } catch {
        return; // no charts directory yet
      }
      for (const name of names) {
        const match = VERSIONED_CHART_FILE.exec(name);
        if (!match || Number(match[1]) === GENERATOR_VERSION) continue;
        await fsPromises.unlink(path.join(chartsDir, name)).catch((error) => {
          log.warning("mewbeat could not remove old charts", name, error?.message);
        });
      }
    })().catch((error) => {
      log.warning("mewbeat could not sweep old charts", error?.message);
    });
    return sweep;
  }

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

  // Returns charts, an uncharted marker, null (no file) or false (unusable file).
  function readDisk(key) {
    let text;
    try {
      text = fs.readFileSync(chartsPathOf(dir, key), "utf8");
    } catch {
      return null;
    }
    return parseChartsFile(text, key);
  }

  // Memory, then disk, for a verdict that needs no analysis: ready or uncharted.
  function known(key) {
    const cached = readMemory(key);
    if (cached) return READY(cached);
    if (unchartedByKey.has(key)) return UNCHARTED(unchartedByKey.get(key));
    const stored = readDisk(key);
    if (!stored) return null;
    if (stored.uncharted) {
      unchartedByKey.set(key, stored.reason);
      return UNCHARTED(stored.reason);
    }
    writeMemory(key, stored);
    return READY(stored);
  }

  async function resolve(track, key, node) {
    await sweepOldVersions();
    const stored = readDisk(key);
    if (stored) {
      if (stored.uncharted) {
        unchartedByKey.set(key, stored.reason);
        return UNCHARTED(stored.reason);
      }
      writeMemory(key, stored);
      return READY(stored);
    }
    if (stored === false) {
      await backupCorruptFile(chartsPathOf(dir, key)).catch((error) => {
        log.warning("mewbeat could not back up corrupt charts", error?.message);
      });
    }

    const features = await analysis.getFeatures(track, node);
    if (!features) return statusWithoutFeatures(track);

    const charts = generate(features, key);
    if (!charts) {
      // Remembered like any chart so a spoken-word track is not regenerated per request.
      unchartedByKey.set(key, TOO_FEW_NOTES);
      await persist(key, { uncharted: true, reason: TOO_FEW_NOTES }, "uncharted marker");
      return UNCHARTED(TOO_FEW_NOTES);
    }

    writeMemory(key, charts);
    await persist(key, charts, "charts");
    return READY(charts);
  }

  async function persist(key, value, what) {
    await writeJsonAtomic(chartsPathOf(dir, key), value).catch((error) => {
      log.warning(`mewbeat could not persist ${what}`, error?.message);
    });
  }

  // Why the analysis client had no features: busy means try again soon, an
  // uncharted verdict is final, anything else (or nothing known) is a failure.
  function statusWithoutFeatures(track) {
    const status = analysis.statusOf(track);
    if (status?.status === "busy") return { status: "pending" };
    if (status?.status === "uncharted") return UNCHARTED(status.reason);
    return { status: "failed" };
  }

  function getCharts(track, node) {
    const key = audioKeyOf(track);
    if (!key) return Promise.resolve(UNCHARTED(NO_AUDIO_KEY));
    // The calibration clicks are charted from their identifier, never analysed.
    if (isCalibrationTrack(track)) return Promise.resolve(READY(calibrationCharts(track)));
    const cached = readMemory(key);
    if (cached) return Promise.resolve(READY(cached));
    if (unchartedByKey.has(key)) return Promise.resolve(UNCHARTED(unchartedByKey.get(key)));
    const pending = pendingByKey.get(key);
    if (pending) return pending;

    const request = resolve(track, key, node).finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, request);
    return request;
  }

  // Synchronous lookup for UI hints; never analyses or generates. Null means
  // nothing is known yet (busy and failed are not reported here).
  function peekCharts(track) {
    const key = audioKeyOf(track);
    if (!key) return null;
    if (isCalibrationTrack(track)) return READY(calibrationCharts(track));
    const verdict = known(key);
    if (verdict) return verdict;
    const status = analysis.statusOf(track);
    return status?.status === "uncharted" ? UNCHARTED(status.reason) : null;
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
