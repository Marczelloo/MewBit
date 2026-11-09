const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const Log = require("../logs/log");
const { backupCorruptFile, writeJsonAtomic } = require("../data/atomicJson");
const { audioKeyFile, audioKeyOf } = require("./audioKey");
const { analysisClient } = require("./analysisClient");
const { calibrationCharts, isCalibrationTrack } = require("./calibrationTrack");
const { summarizeCharts } = require("./chartSummary");
const { GENERATOR_VERSION } = require("./charts/generate");
const { FLAGS_FILE_NAME, flagsKey, normalFlags } = require("./charts/flags");
const { withMelodyFile } = require("./charts/melodyFile");
const { createChartRunner } = require("./chartRunner");
const { createMelodyDecoder } = require("./melodyDecoder");
const { audioStore } = require("./sharedAudio");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const MEMORY_CAPACITY = 16;
const NO_AUDIO_KEY = "no_audio_key";
const TOO_FEW_NOTES = "too_few_notes";
// How long a request for a new song waits for its melody to be decoded before the charts are made without it.
const MELODY_WAIT_MS = 120_000;
// An explicit retry of a song that failed or came back uncharted runs the analysis again, but only once per this long.
const RETRY_COOLDOWN_MS = 30_000;
// A change to the flags file is seen by the first request after this long, so a request does not read the file each time.
const FLAGS_TTL_MS = 2000;

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

// How busy a song plays: Normal's moments a second in its busier 4 s windows (the 75th percentile), one number for every
// level, so the activity's fall speed follows it and a live change of level does not change the speed. The tempo alone
// undersold a dense song at a middling tempo: Rude Buster (Camellia, 132 BPM) plays 6 moments a second there like GHOST
// (220 BPM), yet fell 14% slower. Added as the charts enter the memory cache, not stored: charts on disk stay as generated.
const PACE_WINDOW_MS = 4000;
function paceOf(notes) {
  const times = [...new Set((notes ?? []).map((n) => n.t))].sort((a, b) => a - b);
  if (times.length < 2) return null;
  const counts = [];
  for (let from = times[0], i = 0; from <= times[times.length - 1]; from += PACE_WINDOW_MS) {
    let n = 0;
    while (i < times.length && times[i] < from + PACE_WINDOW_MS) i++, n++;
    counts.push(n / (PACE_WINDOW_MS / 1000));
  }
  return counts.sort((a, b) => a - b)[Math.floor(counts.length * 0.75)];
}

function withPace(charts) {
  const pace = charts?.normal?.notes ? paceOf(charts.normal.notes) : null;
  if (pace === null) return charts;
  return Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart && typeof chart === "object" ? { ...chart, pace } : chart]));
}

// Charts are made on a worker thread, one song at a time (chartRunner.js); the store's `generate` option replaces it in tests.
let chartRunner = null;
function generateOnWorker(features, audioKey, flags) {
  chartRunner ??= createChartRunner();
  return chartRunner.run(features, audioKey, flags);
}

const READY = (charts) => ({ status: "ready", charts });
const UNCHARTED = (reason) => ({ status: "uncharted", reason });

// `melodyDecoder` (melodyDecoder.js) decodes the melody of a song that has no melody file: a new song waits for it (up to
// `melodyWaitMs`), a song with stored charts keeps them until the decode is done and then has them generated again. Without one
// a melody file is only read when it is there.
function createChartStore({ dir, analysis, generate = generateOnWorker, log = Log, melodyDecoder = null, melodyWaitMs = MELODY_WAIT_MS, now = Date.now, flagsTtlMs = FLAGS_TTL_MS }) {
  const chartsByKey = new Map(); // keyed by memoryKey: the audio key and the flags
  const unchartedByKey = new Map(); // memoryKey -> reason
  // memoryKey -> summarizeCharts(charts). Kept after the charts leave memory, so the song lists and the rating
  // need not parse the chart file again; dropped with the charts.
  const summaryByKey = new Map();
  // chart file name -> what warmSummaries read of it, for songs whose charts are not in memory: { audioKey, summary } or
  // { uncharted: true }. Dropped with the file's charts (dropCharts, forgetUncharted) and replaced when they are written.
  const warmByFile = new Map();
  const missingFiles = new Set(); // chart file names that were not there when the sync readers last looked
  let filesEpoch = 0; // counts the changes to what is known of the chart files
  let warming = null;
  const pendingByKey = new Map();
  const retriedAt = new Map(); // audio key -> when a forced retry last started
  const flagsFile = path.join(dir, FLAGS_FILE_NAME);
  let seenFlags = { text: null, state: { flags: {}, key: "" } };
  let flagsReadAt = null;
  let sweep = null;

  // The generator flags in force now, read from the flags file at most once per flagsTtlMs so a change applies to
  // the first request after that. A missing or broken file means no flags;
  // the file is only parsed again (and a failure only logged) when its text changes.
  function currentFlags() {
    const t = now();
    if (flagsReadAt !== null && t >= flagsReadAt && t - flagsReadAt < flagsTtlMs) return seenFlags.state;
    flagsReadAt = t;
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

  // Charts held in memory carry their pace, so a cache hit returns the very object the first request got.
  function remember(id, charts) {
    const paced = withPace(charts);
    writeMemory(id, paced);
    summaryByKey.set(id, summarizeCharts(paced));
    return READY(paced);
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

  const chartFileOf = (key, flagged) => path.basename(chartsPathOf(dir, key, flagged));

  // Returns charts, an uncharted marker, null (no file) or false (unusable file). A file that is not there is not looked
  // for again by the sync readers (`remembered`) until charts are written for it (persist) or dropped (dropCharts).
  function readDisk(key, flagged, remembered = false) {
    const file = chartFileOf(key, flagged);
    if (remembered && missingFiles.has(file)) return null;
    let text;
    try {
      text = fs.readFileSync(chartsPathOf(dir, key, flagged), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") missingFiles.add(file);
      return null;
    }
    missingFiles.delete(file);
    return parseChartsFile(text, key);
  }

  // Forgets what is known of the chart files of an audio key (every combination of flags); a warm-up in flight is void.
  function forgetFiles(key, { missing = true } = {}) {
    const prefix = `${audioKeyFile(key)}.v`;
    filesEpoch++;
    for (const file of [...warmByFile.keys()]) if (file.startsWith(prefix)) warmByFile.delete(file);
    if (missing) for (const file of [...missingFiles]) if (file.startsWith(prefix)) missingFiles.delete(file);
  }

  // Memory, then disk, for a verdict that needs no analysis: ready or uncharted.
  function known(key, flagged) {
    const id = memoryKey(key, flagged);
    const cached = readMemory(id);
    if (cached) return READY(cached);
    if (unchartedByKey.has(id)) return UNCHARTED(unchartedByKey.get(id));
    const stored = readDisk(key, flagged, true);
    if (!stored) return null;
    if (stored.uncharted) {
      unchartedByKey.set(id, stored.reason);
      return UNCHARTED(stored.reason);
    }
    return remember(id, stored);
  }

  // A melody from a second detector, where one was decoded offline for this audio (melody/<audio key file>.json): the
  // Normal lays its lanes on it and leans its choice of moments on it (generate.js). Without the file nothing changes.
  async function withDecodedMelody(features, key) {
    if (!features) return features;
    try {
      const melody = JSON.parse(await fsPromises.readFile(path.join(dir, "melody", `${audioKeyFile(key)}.json`), "utf8"));
      return withMelodyFile(features, melody);
    } catch {
      return features;
    }
  }

  // Charts made without a melody are dropped once it is decoded: the files of every combination of flags for this audio, the
  // uncharted markers too, and what is in memory, so the next request generates them again with the melody.
  async function dropCharts(key) {
    for (const map of [chartsByKey, unchartedByKey, summaryByKey]) {
      for (const id of [...map.keys()]) if (id === key || id.startsWith(`${key}|`)) map.delete(id);
    }
    forgetFiles(key);
    const chartsDir = path.join(dir, "charts");
    const prefix = `${audioKeyFile(key)}.v`;
    let names;
    try {
      names = await fsPromises.readdir(chartsDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.startsWith(prefix) || !VERSIONED_CHART_FILE.test(name)) continue;
      await fsPromises.unlink(path.join(chartsDir, name)).catch((error) => {
        log.warning("mewbeat could not remove charts made without the melody", name, error?.message);
      });
    }
  }

  // Forgets what stops a song from being charted again: the uncharted verdicts (memory, and the markers on disk for every
  // combination of flags) and the analysis client's failure. Charts that exist are never removed.
  async function forgetUncharted(track, key) {
    for (const id of [...unchartedByKey.keys()]) if (id === key || id.startsWith(`${key}|`)) unchartedByKey.delete(id);
    forgetFiles(key, { missing: false });
    const chartsDir = path.join(dir, "charts");
    const prefix = `${audioKeyFile(key)}.v`;
    let names = [];
    try {
      names = await fsPromises.readdir(chartsDir);
    } catch {
      // no charts directory yet
    }
    for (const name of names) {
      if (!name.startsWith(prefix) || !VERSIONED_CHART_FILE.test(name)) continue;
      const file = path.join(chartsDir, name);
      try {
        if (parseChartsFile(await fsPromises.readFile(file, "utf8"), key)?.uncharted) await fsPromises.unlink(file);
      } catch (error) {
        log.warning("mewbeat could not remove an uncharted marker", name, error?.message);
      }
    }
    await analysis.forget?.(track);
  }

  // One forced retry per song per RETRY_COOLDOWN_MS; a click inside it is an ordinary request.
  function claimRetry(key) {
    const t = now();
    for (const [other, at] of retriedAt) if (t - at >= RETRY_COOLDOWN_MS) retriedAt.delete(other);
    if (retriedAt.has(key)) return false;
    retriedAt.set(key, t);
    return true;
  }

  // A melody that comes after the charts were made replaces them.
  function replaceWhenDecoded(decoding, key) {
    decoding.then((result) => (result === "decoded" ? dropCharts(key) : undefined)).catch((error) => {
      log.warning("mewbeat could not replace charts after decoding the melody", error?.message);
    });
  }

  // A new song waits for its melody, for `melodyWaitMs` at most; the decode then goes on and replaces the charts made without it.
  async function waitForMelody(track, key, node, features) {
    const decoding = melodyDecoder.ensure(key, track, node, features);
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve("late"), melodyWaitMs);
    });
    const result = await Promise.race([decoding, late]).finally(() => clearTimeout(timer));
    if (result === "late") replaceWhenDecoded(decoding, key);
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
      // Not bound to the request: the charts on disk are served as they are.
      if (melodyDecoder && !melodyDecoder.has(key)) {
        Promise.resolve()
          .then(() => analysis.peek?.(track))
          .then((features) => features && replaceWhenDecoded(melodyDecoder.ensure(key, track, node, features), key))
          .catch((error) => log.warning("mewbeat could not look for features to decode the melody", error?.message));
      }
      return remember(id, stored);
    }
    if (stored === false) {
      await backupCorruptFile(chartsPathOf(dir, key, flagged)).catch((error) => {
        log.warning("mewbeat could not back up corrupt charts", error?.message);
      });
    }

    const analysed = await analysis.getFeatures(track, node);
    if (!analysed) return statusWithoutFeatures(track);
    if (melodyDecoder && !melodyDecoder.has(key)) await waitForMelody(track, key, node, analysed);
    const features = await withDecodedMelody(analysed, key);

    const charts = await generate(features, key, flags);
    if (!charts) {
      // Remembered like any chart so a spoken-word track is not regenerated per request.
      unchartedByKey.set(id, TOO_FEW_NOTES);
      await persist(key, flagged, { uncharted: true, reason: TOO_FEW_NOTES }, "uncharted marker");
      return UNCHARTED(TOO_FEW_NOTES);
    }

    const ready = remember(id, charts);
    await persist(key, flagged, charts, "charts");
    return ready;
  }

  async function persist(key, flagged, value, what) {
    const file = chartFileOf(key, flagged);
    await writeJsonAtomic(chartsPathOf(dir, key, flagged), value).catch((error) => {
      log.warning(`mewbeat could not persist ${what}`, error?.message);
    });
    filesEpoch++;
    missingFiles.delete(file);
    warmByFile.delete(file);
  }

  // Why the analysis client had no features: busy means try again soon, an
  // uncharted verdict is final, anything else (or nothing known) is a failure.
  function statusWithoutFeatures(track) {
    const status = analysis.statusOf(track);
    if (status?.status === "busy") return { status: "pending" };
    if (status?.status === "uncharted") return UNCHARTED(status.reason);
    return { status: "failed" };
  }

  // `retry` is an explicit "try again" from a player: for a song that is not charted and not being charted it forgets the
  // failure and the uncharted verdicts first (forgetUncharted) and runs the whole thing again, once per RETRY_COOLDOWN_MS.
  // The forced attempt is the pending request at once, so repeated calls share it; every other request keeps the blocks.
  function getCharts(track, node, { retry = false } = {}) {
    const key = audioKeyOf(track);
    if (!key) return Promise.resolve(UNCHARTED(NO_AUDIO_KEY));
    // The calibration clicks are charted from their identifier, never analysed.
    if (isCalibrationTrack(track)) return Promise.resolve(READY(withPace(calibrationCharts(track))));
    const state = currentFlags();
    const id = memoryKey(key, state.key);
    const cached = readMemory(id);
    if (cached) return Promise.resolve(READY(cached));
    if (retry && !pendingByKey.has(id) && claimRetry(key)) {
      const forced = forgetUncharted(track, key).then(() => resolve(track, key, node, state)).finally(() => pendingByKey.delete(id));
      pendingByKey.set(id, forced);
      return forced;
    }
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
    if (isCalibrationTrack(track)) return READY(withPace(calibrationCharts(track)));
    const verdict = known(key, currentFlags().key);
    if (verdict) return verdict;
    const status = analysis.statusOf(track);
    return status?.status === "uncharted" ? UNCHARTED(status.reason) : null;
  }

  // A lookup of song summaries (chartSummary.js) for a caller that needs many in one go: the flags file is read once
  // for the reader, not once per song. Null: no charts known for the song (nothing is generated or analysed).
  function summaryReader() {
    const flagged = currentFlags().key;
    return (track) => {
      const key = audioKeyOf(track);
      if (!key) return null;
      if (isCalibrationTrack(track)) return summarizeCharts(calibrationCharts(track));
      const id = memoryKey(key, flagged);
      const summary = summaryByKey.get(id);
      if (summary) return summary;
      const warm = warmByFile.get(chartFileOf(key, flagged));
      if (warm) return warm.audioKey === key ? warm.summary ?? null : null;
      return known(key, flagged)?.status === "ready" ? summaryByKey.get(id) : null;
    };
  }

  // Reads the chart files of the flags in force now into the summaries, one at a time with the event loop free between
  // files, so the first song list and ranking after a start find them warm instead of parsing every file in one go.
  // The sync readers take what is warm and fall back to reading the file for a song that is not yet.
  function warmSummaries() {
    warming ??= (async () => {
      const flagged = currentFlags().key;
      const suffix = `.v${GENERATOR_VERSION}${flagged && `-${flagged}`}.json`;
      const chartsDir = path.join(dir, "charts");
      let names;
      try {
        names = await fsPromises.readdir(chartsDir);
      } catch {
        return; // no charts directory yet
      }
      for (const name of names) {
        if (!name.endsWith(suffix) || warmByFile.has(name) || missingFiles.has(name)) continue;
        const epoch = filesEpoch;
        let entry;
        try {
          const value = JSON.parse(await fsPromises.readFile(path.join(chartsDir, name), "utf8"));
          const audioKey = value?.easy?.audioKey;
          if (value?.uncharted === true) entry = { uncharted: true };
          else if (typeof audioKey === "string" && isChartSet(value, audioKey)) entry = { audioKey, summary: summarizeCharts(value) };
        } catch {
          // gone or unreadable: the sync readers find out for themselves
        }
        if (entry && epoch === filesEpoch) warmByFile.set(name, entry);
        await new Promise((resolve) => setImmediate(resolve));
      }
    })().catch((error) => {
      log.warning("mewbeat could not warm the chart summaries", error?.message);
    });
    return warming;
  }

  return { getCharts, peekCharts, summaryReader, warmSummaries };
}

const DATA_DIR = path.join(__dirname, "..", "data", "mewbeat");

module.exports = {
  chartStore: createChartStore({
    analysis: analysisClient,
    dir: DATA_DIR,
    // MEWBEAT_MELODY_DECODER=off leaves melodies to files made by hand.
    melodyDecoder: createMelodyDecoder({ dir: DATA_DIR, audio: audioStore }),
  }),
  createChartStore,
};
