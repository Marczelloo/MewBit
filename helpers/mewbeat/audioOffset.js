const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const Log = require("../logs/log");
const { audioKeyFile } = require("./audioKey");
const { createPriorityGate } = require("./priorityGate");

// The offset between the audio a player hears and the features the chart was made from (docs/mewbeat/audio-offset-2026-11-11.md).
//
// The Lavalink plugin fetches a track twice: once for the analysis (the features, so the chart) and once to render the stored
// .ogg. The two fetches differ by whole 20 ms chunks of leading content, so chart and audio are a constant per-song amount apart.
// The decoder service (scripts/mewbeat-melody/decoder/offset.py, POST /offset) measures it from the stored audio and the stored
// onsets; this module asks it, keeps the answer on disk, and tells the chart reply.
//
// SIGN: offsetMs > 0 means the features (so the chart) lie LATER than the same sounds in the stored audio; < 0 means the audio has
// extra lead and the chart is earlier than the music. A note at chart time T is heard at audio time T - offsetMs, so
//   chart time = audio position + offsetMs.
//
// Files: <dir>/offset/<audio key file>.json next to <dir>/audio/<same>.ogg and <dir>/features/<same>.json. The record is tied to
// the two files it was measured from (a fingerprint of each): a re-rendered audio file or new features make it stale, and it is
// measured again. The audio store touches a file's mtime on every use, so the audio fingerprint is its size plus a hash of its
// first and last 64 KB, never its mtime.
//
// Nothing here ever fails a song: every method resolves (never rejects), a service that is not configured (no
// MEWBEAT_DECODER_URL, the case on the Pi today) or not reachable gives null offsets without a line in the log past the first
// warning, and the only waiting a caller does is the bounded `waitMs` of lookup().
const RECORD_VERSION = 1;
// Below this confidence the offset is unknown (null). The record keeps the raw estimate, so the threshold can move without
// measuring again. Chosen with the validation in the doc (matched audio/features pairs against mismatched ones).
const MIN_CONFIDENCE = 0.6;
const FINGERPRINT_EDGE_BYTES = 64 * 1024;
// A features file this small is an "uncharted" marker (analysisClient.js), not a document.
const FEATURES_MIN_BYTES = 4096;
const MIN_AUDIO_BYTES = 4096;
const RUN_TIMEOUT_MS = 120_000;
// lookup() waits this long for a measurement it started; after that the player gets null and the measurement still finishes.
const LOOKUP_WAIT_MS = 1200;
const MAX_BACKGROUND = 50;
const REPROBE_MS = 5 * 60_000;
const RETRY_AFTER_MS = [10 * 60_000, 30 * 60_000];
const MAX_TRIES = 3;
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const BAND_NAMES = ["low", "lowmid", "highmid", "high"];

function failure(message, extra) {
  return Object.assign(new Error(message), extra);
}

// The onsets of a features document as the service takes them: { low: [[t, s], ...], lowmid, highmid, high }.
function bandsOf(features) {
  const byName = new Map((features?.bands ?? []).map((band) => [band?.name, band?.onsets]));
  const bands = {};
  for (const name of BAND_NAMES) {
    const onsets = byName.get(name);
    bands[name] = Array.isArray(onsets) ? onsets.map((onset) => [onset.t, onset.s]) : [];
  }
  return bands;
}

// POST /offset: 4 bytes (big endian) N, N bytes of JSON { bands, minConfidence }, then the bytes of the audio file. node:http for
// the same reason as melodyDecoder.runService. Throws `unavailable: true` when nobody answers at the address and `permanent: true`
// for a 400 or 413 (the same bytes fail again).
function runOffsetService({ audio, bands, minConfidence = MIN_CONFIDENCE, timeoutMs = RUN_TIMEOUT_MS, url = process.env.MEWBEAT_DECODER_URL }) {
  const head = Buffer.from(JSON.stringify({ bands, minConfidence }));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(head.length, 0);
  const length = prefix.length + head.length + audio.length;
  const target = new URL("/offset", url);
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": length, "X-Timeout-Ms": String(timeoutMs) },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", (error) => { clearTimeout(timer); reject(failure(`the decoder service dropped the answer: ${error.message}`)); });
      response.on("end", () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {
          // not JSON: reported below with its status
        }
        if (response.statusCode === 200 && payload) return resolve(payload);
        // A service from before /offset existed answers 404: not a verdict on the song, just nothing to ask yet.
        if (response.statusCode === 404) return reject(failure("the decoder service has no /offset yet (an older build)", { unavailable: true }));
        const reason = payload?.error ?? text.slice(0, 200);
        reject(failure(`the decoder service answered ${response.statusCode}: ${reason}`, { permanent: payload?.permanent === true }));
      });
    });
    const timer = setTimeout(() => request.destroy(failure(`the decoder service did not answer within ${timeoutMs} ms`)), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      if (UNREACHABLE_CODES.has(error.code)) return reject(failure(`the decoder service is unreachable: ${error.code}`, { unavailable: true }));
      reject(error.code ? failure(`the decoder service failed: ${error.code}`) : error);
    });
    request.write(prefix);
    request.write(head);
    request.end(audio);
  });
}

// Size and a hash of the first and last 64 KB (the whole file when it is that small). Null when the file cannot be read.
async function audioFingerprint(file) {
  let handle;
  try {
    handle = await fsPromises.open(file, "r");
    const { size } = await handle.stat();
    const hash = createHash("sha1");
    const edge = Math.min(size, FINGERPRINT_EDGE_BYTES);
    const head = Buffer.alloc(edge);
    await handle.read(head, 0, edge, 0);
    hash.update(head);
    if (size > FINGERPRINT_EDGE_BYTES) {
      const tailLength = Math.min(FINGERPRINT_EDGE_BYTES, size - FINGERPRINT_EDGE_BYTES);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);
      hash.update(tail);
    }
    return `${size}:${hash.digest("hex").slice(0, 16)}`;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// Features files are written once and replaced whole, so size and mtime say whether they are the ones a record was made from.
async function featuresFingerprint(file) {
  try {
    const stat = await fsPromises.stat(file);
    return stat.size > FEATURES_MIN_BYTES ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null;
  } catch {
    return null;
  }
}

// `dir` is the mewbeat data directory (audio/, features/ and offset/ live in it). `run` is the service call (a test replaces
// it). The service is used when `url` (MEWBEAT_DECODER_URL) is set; with none, enabled() is false and nothing here does anything.
function createAudioOffset({
  dir,
  offsetDir = path.join(dir, "offset"),
  run = runOffsetService,
  url = process.env.MEWBEAT_DECODER_URL,
  enabled = Boolean(url) && process.env.MEWBEAT_AUDIO_OFFSET !== "off",
  minConfidence = MIN_CONFIDENCE,
  timeoutMs = RUN_TIMEOUT_MS,
  log = Log,
  now = Date.now,
}) {
  const audioDir = path.join(dir, "audio");
  const featuresDir = path.join(dir, "features");
  const failed = new Map(); // stem -> { tries, permanent, retryAt }
  const gate = createPriorityGate({ concurrency: 1, backgroundCap: MAX_BACKGROUND });
  let unavailableUntil = 0;
  let warnedUnavailable = false;

  const stemOf = (audioKey) => audioKeyFile(audioKey);
  const audioFileOf = (stem) => path.join(audioDir, `${stem}.ogg`);
  const featuresFileOf = (stem) => path.join(featuresDir, `${stem}.json`);
  const recordFileOf = (stem) => path.join(offsetDir, `${stem}.json`);
  const isUnavailable = () => now() < unavailableUntil;

  function mayTry(stem) {
    const last = failed.get(stem);
    return !last || (!last.permanent && last.tries < MAX_TRIES && now() >= last.retryAt);
  }

  // The offset a record gives: its raw estimate when confident enough, else null (unknown).
  const offsetOf = (record) => (
    Number.isFinite(record.rawOffsetMs) && Number.isFinite(record.confidence) && record.confidence >= minConfidence
      ? record.rawOffsetMs
      : null
  );

  // The stored record when it is of this version and was measured from the files that are on disk now; otherwise null.
  async function readRecord(stem) {
    let record;
    try {
      record = JSON.parse(await fsPromises.readFile(recordFileOf(stem), "utf8"));
    } catch {
      return null;
    }
    if (record?.version !== RECORD_VERSION) return null;
    const [audio, features] = await Promise.all([audioFingerprint(audioFileOf(stem)), featuresFingerprint(featuresFileOf(stem))]);
    if (audio === null || features === null || record.audio !== audio || record.features !== features) return null;
    return record;
  }

  async function writeRecord(stem, record) {
    await fsPromises.mkdir(offsetDir, { recursive: true });
    const file = recordFileOf(stem);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fsPromises.writeFile(temp, JSON.stringify(record));
      await fsPromises.rename(temp, file);
    } finally {
      await fsPromises.rm(temp, { force: true }).catch(() => {});
    }
  }

  // Reads the two files, asks the service, stores the answer. Throws what the service throws; a `skip` error says why there is
  // nothing to measure (not a failure).
  async function measure(stem) {
    if (isUnavailable()) throw failure("the decoder is unavailable", { unavailable: true });
    const audioFile = audioFileOf(stem);
    let audio;
    try {
      audio = await fsPromises.readFile(audioFile);
    } catch {
      throw failure("no audio", { skip: "no_audio" });
    }
    if (audio.length < MIN_AUDIO_BYTES) throw failure("the audio is a stub", { skip: "no_audio" });
    let features;
    try {
      features = JSON.parse(await fsPromises.readFile(featuresFileOf(stem), "utf8"));
    } catch {
      throw failure("no features", { skip: "no_features" });
    }
    // Fingerprints of what was read, taken before the call so a file replaced during it makes the record stale, not wrong.
    const [audioPrint, featuresPrint] = await Promise.all([audioFingerprint(audioFile), featuresFingerprint(featuresFileOf(stem))]);
    if (audioPrint === null) throw failure("the audio vanished", { skip: "no_audio" });
    if (featuresPrint === null) throw failure("no features (a marker or a vanished file)", { skip: "no_features" });
    if (!Array.isArray(features?.bands)) throw failure("no features", { skip: "no_features" });
    const answer = await run({ audio, bands: bandsOf(features), minConfidence, timeoutMs, url });
    const record = {
      version: RECORD_VERSION,
      rawOffsetMs: Number.isFinite(answer?.offsetMs) ? answer.offsetMs : null,
      confidence: Number.isFinite(answer?.confidence) ? answer.confidence : null,
      peak: Number.isFinite(answer?.peak) ? answer.peak : null,
      margin: Number.isFinite(answer?.margin) ? answer.margin : null,
      onsets: Number.isFinite(answer?.onsets) ? answer.onsets : null,
      windowS: Number.isFinite(answer?.windowS) ? answer.windowS : null,
      audio: audioPrint,
      features: featuresPrint,
      measuredAt: now(),
    };
    await writeRecord(stem, record);
    // The service answers again: forget an outage and this song's earlier failures.
    unavailableUntil = 0;
    warnedUnavailable = false;
    failed.delete(stem);
    return record;
  }

  // One measurement for a stem: resolves { status, offsetMs, confidence }. status is "present" (a valid record was there),
  // "measured", "off" (no service, or it is down for now), "no_audio", "no_features", or "failed". offsetMs is null when the
  // song's offset is unknown (low confidence, too few onsets, or no measurement).
  async function ensureStem(stem, priority, force = false) {
    const none = (status) => ({ status, offsetMs: null, confidence: null });
    if (!enabled || isUnavailable()) return none("off");
    const stored = force ? null : await readRecord(stem);
    const resultOf = (status, record) => ({
      status,
      offsetMs: offsetOf(record),
      confidence: record.confidence,
      rawOffsetMs: record.rawOffsetMs,
      peak: record.peak,
      margin: record.margin,
      onsets: record.onsets,
      windowS: record.windowS,
    });
    if (stored) return resultOf("present", stored);
    if (!mayTry(stem)) return none("failed");
    try {
      const record = await gate.run(() => measure(stem), { priority, key: stem });
      return resultOf("measured", record);
    } catch (error) {
      if (error?.skip) return none(error.skip);
      if (error?.unavailable) {
        if (!warnedUnavailable) log.warning("mewbeat audio-offset: the decoder service is unavailable, offsets are not measured for now", error.message);
        warnedUnavailable = true;
        unavailableUntil = now() + REPROBE_MS;
        return none("off");
      }
      if (error?.code === "QUEUE_FULL") return none("failed");
      const tries = (failed.get(stem)?.tries ?? 0) + 1;
      const permanent = error?.permanent === true;
      failed.set(stem, { tries, permanent, retryAt: now() + (RETRY_AFTER_MS[tries - 1] ?? Infinity) });
      const next = permanent || tries >= MAX_TRIES ? "final" : `retry in ${RETRY_AFTER_MS[tries - 1] / 60_000} min at the earliest`;
      log.warning("mewbeat audio-offset: a song could not be measured", stem.slice(0, 8), `${error?.message} (try ${tries}, ${next})`);
      return none("failed");
    }
  }

  // priority "background" (default) for work nobody waits for; "play" for a player's song. Never rejects.
  function ensure(audioKey, { priority = "background" } = {}) {
    return ensureStem(stemOf(audioKey), priority).catch(() => ({ status: "failed", offsetMs: null, confidence: null }));
  }

  // The offset for a song a player is about to play: number, or null when unknown. A stored record answers at once; otherwise,
  // when the song has audio and features on disk and the service is there, a measurement starts and is waited for at most
  // `waitMs` (a measurement still running then finishes in the background, and the next play has it). Never rejects.
  async function lookup(audioKey, { waitMs = LOOKUP_WAIT_MS } = {}) {
    if (!enabled || isUnavailable()) return null;
    let timer;
    try {
      const work = ensure(audioKey, { priority: "play" });
      const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), waitMs);
        timer.unref?.();
      });
      const result = await Promise.race([work, late]);
      return result?.offsetMs ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // The stored value only, nothing measured and nothing waited for: { offsetMs, confidence } or null.
  async function peek(audioKey) {
    if (!enabled) return null;
    const record = await readRecord(stemOf(audioKey)).catch(() => null);
    return record ? { offsetMs: offsetOf(record), confidence: record.confidence } : null;
  }

  // The stems of the audio files on disk, for the backfill and the one-shot script.
  async function stemsOnDisk() {
    try {
      return (await fsPromises.readdir(audioDir)).filter((name) => name.endsWith(".ogg")).map((name) => name.slice(0, -4));
    } catch {
      return [];
    }
  }

  return {
    ensure,
    ensureStem: (stem, { priority = "background", force = false } = {}) => ensureStem(stem, priority, force).catch(() => ({ status: "failed", offsetMs: null, confidence: null })),
    lookup,
    peek,
    stemsOnDisk,
    isEnabled: () => enabled && !isUnavailable(),
    configured: () => enabled,
  };
}

module.exports = { MIN_CONFIDENCE, audioFingerprint, bandsOf, createAudioOffset, featuresFingerprint, runOffsetService };
