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
const { FLAGS_FILE_NAME, fileKey, flagsKey, noMelodyKey, normalFlags } = require("./charts/flags");
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
// Songs charted as background work (chartMap, the re-chart, the voice hook) at once; one more is refused with "full".
const BACKGROUND_CAP = 40;
// An explicit retry of a song that failed or came back uncharted runs the analysis again, but only once per this long.
const RETRY_COOLDOWN_MS = 30_000;
// A change to the flags file is seen by the first request after this long, so a request does not read the file each time.
const FLAGS_TTL_MS = 2000;

// The generator version is part of the file name, so a version bump simply
// stops finding the old files and regenerates from the cached features.
// Generator flags (charts/flags.js) add their names after it, so each
// combination of flags has its own file and no flags is the plain name; a long
// list of flags goes in as its hash (flags.js fileKey).
//
// A song charted without a decoded melody is another map: its charts carry the marker "nm" after the flags (flags.js
// noMelodyKey, `.v44-nm.json`, `.v44-holds-nm.json`), the ones made with a melody have the plain name. Lookups try the plain
// name first and then the marked one (variantsOf); a marked chart is replaced once a melody is there.
//
// The chart file is the source of truth for an audioKey + version: scores
// refer to it. Features are not bit-reproducible across machines (decoder
// length drift, JVM math), so wiping only the features cache must not
// regenerate a chart that already exists, and a deliberate regeneration needs
// a GENERATOR_VERSION bump.
const chartSuffix = (flagged = "") => `.v${GENERATOR_VERSION}${flagged && `-${fileKey(flagged)}`}.json`;

function chartsPathOf(dir, key, flagged = "") {
  return path.join(dir, "charts", `${audioKeyFile(key)}${chartSuffix(flagged)}`);
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
function generateOnWorker(features, audioKey, flags, options) {
  chartRunner ??= createChartRunner();
  return chartRunner.run(features, audioKey, flags, options);
}
generateOnWorker.promote = (audioKey, flags) => chartRunner?.promote(audioKey, flags) ?? false;

const READY = (charts) => ({ status: "ready", charts });
const UNCHARTED = (reason) => ({ status: "uncharted", reason });

// `melodyDecoder` (melodyDecoder.js) decodes the melody of a song that has no melody file: a new song waits for it (up to
// `melodyWaitMs`), a song with stored charts keeps them until the decode is done and then has them generated again. Without one
// a melody file is only read when it is there.
function createChartStore({ dir, analysis, generate = generateOnWorker, log = Log, melodyDecoder = null, melodyWaitMs = MELODY_WAIT_MS, now = Date.now, flagsTtlMs = FLAGS_TTL_MS, backgroundCap = BACKGROUND_CAP }) {
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
  const backgroundIds = new Set(); // ids in pendingByKey that were asked for as background work
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
  // The chart variants of one set of flags, in the order they are looked for: made with a melody, then made without.
  const variantsOf = (flagged) => [flagged, noMelodyKey(flagged)];
  const melodyPathOf = (key) => path.join(dir, "melody", `${audioKeyFile(key)}.json`);
  const warnedMelodyFiles = new Set(); // melody files that were warned about, once each
  const unreadableMelodyFiles = new Set(); // melody files that exist but could not be read

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
    for (const variant of variantsOf(flagged)) {
      const id = memoryKey(key, variant);
      const cached = readMemory(id);
      if (cached) return READY(cached);
      if (unchartedByKey.has(id)) return UNCHARTED(unchartedByKey.get(id));
      const stored = readDisk(key, variant, true);
      if (!stored) continue;
      if (stored.uncharted) {
        unchartedByKey.set(id, stored.reason);
        return UNCHARTED(stored.reason);
      }
      return remember(id, stored);
    }
    return null;
  }

  // The charts of a song in memory under either variant of the flags: { variant, charts }, or null.
  function cachedCharts(key, flagged) {
    for (const variant of variantsOf(flagged)) {
      const charts = readMemory(memoryKey(key, variant));
      if (charts) return { variant, charts };
    }
    return null;
  }

  function unchartedReason(key, flagged) {
    for (const variant of variantsOf(flagged)) {
      const id = memoryKey(key, variant);
      if (unchartedByKey.has(id)) return unchartedByKey.get(id);
    }
    return undefined;
  }

  // A melody file that cannot be used is warned about once and put aside (`.corrupt-` name), so it counts as missing: the
  // decoder (melodyDecoder.has looks for the file) makes it again.
  async function setAsideMelody(file, why) {
    if (!warnedMelodyFiles.has(file)) {
      warnedMelodyFiles.add(file);
      log.warning("mewbeat melody file is unusable and will be decoded again", path.basename(file), why);
    }
    await backupCorruptFile(file).catch(() => {});
  }

  // A melody from a second detector, where one was decoded offline for this audio (melody/<audio key file>.json): the
  // Normal lays its lanes on it and leans its choice of moments on it (generate.js). Returns the features and whether a
  // melody was laid on them; a file that is not there, cannot be read or is not a melody counts as missing.
  async function withDecodedMelody(features, key) {
    if (!features) return { features, melody: false };
    const file = melodyPathOf(key);
    let text;
    try {
      text = await fsPromises.readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        unreadableMelodyFiles.add(file); // not a reason to chart the song again (resolve)
        if (!warnedMelodyFiles.has(file)) {
          warnedMelodyFiles.add(file);
          log.warning("mewbeat could not read a melody file", path.basename(file), error?.message);
        }
      }
      return { features, melody: false };
    }
    let melody;
    try {
      melody = JSON.parse(text);
    } catch (error) {
      await setAsideMelody(file, `not JSON: ${error?.message}`);
      return { features, melody: false };
    }
    if (!Array.isArray(melody?.notes)) {
      await setAsideMelody(file, "no notes");
      return { features, melody: false };
    }
    return { features: withMelodyFile(features, melody), melody: true };
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
  // Background work has no player waiting, so it waits for the decode however long it takes (and queues behind play decodes).
  async function waitForMelody(track, key, node, features, priority) {
    const decoding = melodyDecoder.ensure(key, track, node, features, { priority });
    if (priority === "background") {
      await decoding;
      return;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve("late"), melodyWaitMs);
    });
    const result = await Promise.race([decoding, late]).finally(() => clearTimeout(timer));
    if (result === "late") replaceWhenDecoded(decoding, key);
  }

  // priority: "play" or "background" (priorityGate.js). offline: no Lavalink node is used, so only cached features are charted
  // and no melody is decoded (the pass over old songs, chartStore.rechart).
  async function resolve(track, key, node, { flags, key: flagged }, { priority = "play", offline = false } = {}) {
    await sweepOldVersions();
    let stored = null;
    let storedAs = flagged;
    for (const variant of variantsOf(flagged)) {
      const found = readDisk(key, variant);
      if (found === false) {
        await backupCorruptFile(chartsPathOf(dir, key, variant)).catch((error) => {
          log.warning("mewbeat could not back up corrupt charts", error?.message);
        });
      } else if (found) {
        stored = found;
        storedAs = variant;
        break;
      }
    }
    // Charts made without a melody are stale once a melody file is there (decoded since, or put there by hand).
    if (stored && storedAs !== flagged && fs.existsSync(melodyPathOf(key)) && !unreadableMelodyFiles.has(melodyPathOf(key))) {
      await dropCharts(key);
      stored = null;
    }
    if (stored) {
      const id = memoryKey(key, storedAs);
      if (stored.uncharted) {
        unchartedByKey.set(id, stored.reason);
        return UNCHARTED(stored.reason);
      }
      // Not bound to the request: the charts on disk are served as they are.
      if (melodyDecoder && !offline && !melodyDecoder.has(key)) decodeLater(track, key, node, priority);
      return remember(id, stored);
    }

    const analysed = await analysis.getFeatures(track, node, { priority });
    if (!analysed) return statusWithoutFeatures(track);
    let laid = await withDecodedMelody(analysed, key);
    if (!laid.melody && melodyDecoder && !offline && !melodyDecoder.has(key)) {
      await waitForMelody(track, key, node, analysed, priority);
      laid = await withDecodedMelody(analysed, key);
    }
    // Without a melody the charts are the marked variant (generate.js reads features.noMelody for the chart's version).
    const variant = laid.melody ? flagged : noMelodyKey(flagged);
    const id = memoryKey(key, variant);
    const features = laid.melody ? laid.features : { ...laid.features, noMelody: true };

    const charts = await generate(features, key, flags, { priority });
    if (!charts) {
      // Remembered like any chart so a spoken-word track is not regenerated per request.
      unchartedByKey.set(id, TOO_FEW_NOTES);
      await persist(key, variant, { uncharted: true, reason: TOO_FEW_NOTES }, "uncharted marker");
      return UNCHARTED(TOO_FEW_NOTES);
    }

    const ready = remember(id, charts);
    await persist(key, variant, charts, "charts");
    return ready;
  }

  // Asks the decoder for the melody of a song whose charts are served as they are, without waiting for it; the charts are
  // replaced when it is there. Looks for the song's cached features itself and does nothing without them.
  function decodeLater(track, key, node, priority) {
    Promise.resolve()
      .then(() => analysis.peek?.(track))
      .then((features) => features && replaceWhenDecoded(melodyDecoder.ensure(key, track, node, features, { priority }), key))
      .catch((error) => log.warning("mewbeat could not look for features to decode the melody", error?.message));
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
  //
  // `priority` is "play" (the default: a player waits) or "background" (a song chosen from a list, the re-chart, a track the bot
  // plays in voice): background work queues behind play work in every step (analysis, melody decode, generation), is
  // not queued twice, and is refused with { status: "full" } while backgroundCap songs are already being charted that way.
  // A play request for a song that is charted as background takes over its place in the lines. `offline` charts from cached
  // features only, with no node (see resolve).
  function getCharts(track, node, { retry = false, priority = "play", offline = false } = {}) {
    const key = audioKeyOf(track);
    if (!key) return Promise.resolve(UNCHARTED(NO_AUDIO_KEY));
    // The calibration clicks are charted from their identifier, never analysed.
    if (isCalibrationTrack(track)) return Promise.resolve(READY(withPace(calibrationCharts(track))));
    const state = currentFlags();
    const id = memoryKey(key, state.key);
    const cached = cachedCharts(key, state.key);
    if (cached) {
      // Charts made without the melody stay until it is decoded; each request is a chance for a decode that is due again
      // (a failed one is retried later, melodyDecoder.js), which does nothing while one is pending or the decoder gives up.
      if (cached.variant !== state.key && !offline && melodyDecoder?.wants?.(key)) decodeLater(track, key, node, priority);
      return Promise.resolve(READY(cached.charts));
    }
    if (retry && !pendingByKey.has(id) && claimRetry(key)) {
      const forced = forgetUncharted(track, key).then(() => resolve(track, key, node, state)).finally(() => pendingByKey.delete(id));
      pendingByKey.set(id, forced);
      return forced;
    }
    const uncharted = unchartedReason(key, state.key);
    if (uncharted !== undefined) return Promise.resolve(UNCHARTED(uncharted));
    const pending = pendingByKey.get(id);
    if (pending) {
      if (priority === "play" && backgroundIds.delete(id)) {
        analysis.promote?.(track);
        melodyDecoder?.promote?.(key);
        generate.promote?.(key, state.flags);
      }
      return pending;
    }
    if (priority === "background" && backgroundIds.size >= backgroundCap) return Promise.resolve({ status: "full" });

    const request = resolve(track, key, node, state, { priority, offline }).finally(() => {
      pendingByKey.delete(id);
      backgroundIds.delete(id);
    });
    pendingByKey.set(id, request);
    if (priority === "background") backgroundIds.add(id);
    return request;
  }

  // Why a song cannot be charted offline now, or null when it can (the re-chart pass, chartStore.rechart): "has_charts" and
  // "uncharted" are known verdicts, "no_melody" means its melody was never decoded (offline charts would be made without it
  // and kept, so the song waits for a real play instead), "no_features" means the analysis is not cached. Sync, reads at
  // most a chart file.
  function rechartBlock(track) {
    const key = audioKeyOf(track);
    if (!key) return "no_key";
    const verdict = known(key, currentFlags().key);
    if (verdict) return verdict.status === "ready" ? "has_charts" : "uncharted";
    if (melodyDecoder && !melodyDecoder.has(key)) return "no_melody";
    return analysis.hasFeatures?.(track) ? null : "no_features";
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
      for (const variant of variantsOf(flagged)) {
        const summary = summaryByKey.get(memoryKey(key, variant));
        if (summary) return summary;
        const warm = warmByFile.get(chartFileOf(key, variant));
        if (warm) return warm.audioKey === key ? warm.summary ?? null : null;
      }
      if (known(key, flagged)?.status !== "ready") return null;
      for (const variant of variantsOf(flagged)) {
        const summary = summaryByKey.get(memoryKey(key, variant));
        if (summary) return summary;
      }
      return null;
    };
  }

  // Reads the chart files of the flags in force now into the summaries, one at a time with the event loop free between
  // files, so the first song list and ranking after a start find them warm instead of parsing every file in one go.
  // The sync readers take what is warm and fall back to reading the file for a song that is not yet.
  function warmSummaries() {
    warming ??= (async () => {
      const flagged = currentFlags().key;
      const suffixes = variantsOf(flagged).map(chartSuffix);
      const chartsDir = path.join(dir, "charts");
      let names;
      try {
        names = await fsPromises.readdir(chartsDir);
      } catch {
        return; // no charts directory yet
      }
      for (const name of names) {
        if (!suffixes.some((suffix) => name.endsWith(suffix)) || warmByFile.has(name) || missingFiles.has(name)) continue;
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

  return { getCharts, peekCharts, rechartBlock, summaryReader, warmSummaries };
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
