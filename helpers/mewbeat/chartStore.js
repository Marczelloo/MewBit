const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const Log = require("../logs/log");
const { backupCorruptFile, writeJsonAtomic } = require("../data/atomicJson");
const { audioKeyFile, audioKeyOf } = require("./audioKey");
const { analysisClient } = require("./analysisClient");
const { calibrationCharts, isCalibrationTrack } = require("./calibrationTrack");
const { GENERATOR_VERSION, generateAll } = require("./charts/generate");
const { FLAGS_FILE_NAME, flagsKey, normalFlags } = require("./charts/flags");
const { withMelodyFile } = require("./charts/melodyFile");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const MEMORY_CAPACITY = 16;
const NO_AUDIO_KEY = "no_audio_key";
const TOO_FEW_NOTES = "too_few_notes";

// The generator version is part of the file name, so a version bump simply
// stops finding the old files and regenerates from the cached features.
// Generator flags (charts/flags.js) add their names after it, so each
// combination of flags has its own file and no flags is the plain name.
//
// The chart file is the source of truth for an audioKey + version: scores
// refer to it. Features are not bit-reproducible across machines (decoder
// length drift, JVM math), so wiping only the features cache must not
// regenerate a chart that already exists, and a deliberate regeneration needs
// a GENERATOR_VERSION bump.
function chartsPathOf(dir, key, flagged = "") {
  return path.join(dir, "charts", `${audioKeyFile(key)}.v${GENERATOR_VERSION}${flagged && `-${flagged}`}.json`);
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

// Group 1 is the generator version, whatever flags follow it. `.corrupt-` backups end differently and never match.
const VERSIONED_CHART_FILE = /\.v(\d+)(?:-[\w-]+)?\.json$/;

const READY = (charts) => ({ status: "ready", charts });
const UNCHARTED = (reason) => ({ status: "uncharted", reason });

function createChartStore({ dir, analysis, generate = generateAll, log = Log }) {
  const chartsByKey = new Map(); // keyed by memoryKey: the audio key and the flags
  const unchartedByKey = new Map(); // memoryKey -> reason
  const pendingByKey = new Map();
  const flagsFile = path.join(dir, FLAGS_FILE_NAME);
  let seenFlags = { text: null, state: { flags: {}, key: "" } };
  let sweep = null;

  // The generator flags in force now, read from the flags file on every call so a
  // change applies to the next request. A missing or broken file means no flags;
  // the file is only parsed again (and a failure only logged) when its text changes.
  function currentFlags() {
    let text;
    try {
      text = fs.readFileSync(flagsFile, "utf8");
    } catch {
      text = null;
    }
    if (text === seenFlags.text) return seenFlags.state;
    let flags = {};
    if (text !== null) {
      try {
        flags = normalFlags(JSON.parse(text)?.flags);
      } catch (error) {
        log.warning("mewbeat could not read generator flags", error?.message);
      }
    }
    seenFlags = { text, state: { flags, key: flagsKey(flags) } };
    return seenFlags.state;
  }

  const memoryKey = (key, flagged) => (flagged ? `${key}|${flagged}` : key);

  // Charts of other generator versions are never read again; drop them once
  // per store so each version bump does not leave the old files behind. Files
  // of this version stay, with any flags.
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

  function readMemory(id) {
    const charts = chartsByKey.get(id);
    if (charts) {
      chartsByKey.delete(id);
      chartsByKey.set(id, charts);
    }
    return charts;
  }

  function writeMemory(id, charts) {
    chartsByKey.delete(id);
    chartsByKey.set(id, charts);
    if (chartsByKey.size > MEMORY_CAPACITY) chartsByKey.delete(chartsByKey.keys().next().value);
  }

  // Returns charts, an uncharted marker, null (no file) or false (unusable file).
  function readDisk(key, flagged) {
    let text;
    try {
      text = fs.readFileSync(chartsPathOf(dir, key, flagged), "utf8");
    } catch {
      return null;
    }
    return parseChartsFile(text, key);
  }

  // Memory, then disk, for a verdict that needs no analysis: ready or uncharted.
  function known(key, flagged) {
    const id = memoryKey(key, flagged);
    const cached = readMemory(id);
    if (cached) return READY(cached);
    if (unchartedByKey.has(id)) return UNCHARTED(unchartedByKey.get(id));
    const stored = readDisk(key, flagged);
    if (!stored) return null;
    if (stored.uncharted) {
      unchartedByKey.set(id, stored.reason);
      return UNCHARTED(stored.reason);
    }
    writeMemory(id, stored);
    return READY(stored);
  }

  // A melody from a second detector, where one was decoded offline for this audio (melody/<audio key file>.json): the
  // Normal lays its lanes on it and leans its choice of moments on it (generate.js). Without the file nothing changes.
  function withDecodedMelody(features, key) {
    if (!features) return features;
    try {
      const melody = JSON.parse(fs.readFileSync(path.join(dir, "melody", `${audioKeyFile(key)}.json`), "utf8"));
      return withMelodyFile(features, melody);
    } catch {
      return features;
    }
  }

  async function resolve(track, key, node, { flags, key: flagged }) {
    const id = memoryKey(key, flagged);
    await sweepOldVersions();
    const stored = readDisk(key, flagged);
    if (stored) {
      if (stored.uncharted) {
        unchartedByKey.set(id, stored.reason);
        return UNCHARTED(stored.reason);
      }
      writeMemory(id, stored);
      return READY(stored);
    }
    if (stored === false) {
      await backupCorruptFile(chartsPathOf(dir, key, flagged)).catch((error) => {
        log.warning("mewbeat could not back up corrupt charts", error?.message);
      });
    }

    const features = withDecodedMelody(await analysis.getFeatures(track, node), key);
    if (!features) return statusWithoutFeatures(track);

    const charts = generate(features, key, flags);
    if (!charts) {
      // Remembered like any chart so a spoken-word track is not regenerated per request.
      unchartedByKey.set(id, TOO_FEW_NOTES);
      await persist(key, flagged, { uncharted: true, reason: TOO_FEW_NOTES }, "uncharted marker");
      return UNCHARTED(TOO_FEW_NOTES);
    }

    writeMemory(id, charts);
    await persist(key, flagged, charts, "charts");
    return READY(charts);
  }

  async function persist(key, flagged, value, what) {
    await writeJsonAtomic(chartsPathOf(dir, key, flagged), value).catch((error) => {
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
    const state = currentFlags();
    const id = memoryKey(key, state.key);
    const cached = readMemory(id);
    if (cached) return Promise.resolve(READY(cached));
    if (unchartedByKey.has(id)) return Promise.resolve(UNCHARTED(unchartedByKey.get(id)));
    const pending = pendingByKey.get(id);
    if (pending) return pending;

    const request = resolve(track, key, node, state).finally(() => pendingByKey.delete(id));
    pendingByKey.set(id, request);
    return request;
  }

  // Synchronous lookup for UI hints; never analyses or generates. Null means
  // nothing is known yet (busy and failed are not reported here).
  function peekCharts(track) {
    const key = audioKeyOf(track);
    if (!key) return null;
    if (isCalibrationTrack(track)) return READY(calibrationCharts(track));
    const verdict = known(key, currentFlags().key);
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
