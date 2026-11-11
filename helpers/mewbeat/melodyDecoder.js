const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const Log = require("../logs/log");
const { melodyFileOf } = require("../../scripts/mewbeat-melody/build");
const { audioKeyFile } = require("./audioKey");
const { createPriorityGate } = require("./priorityGate");

const DECODER_DIR = path.join(__dirname, "..", "..", "scripts", "mewbeat-melody", "decoder");
const DEFAULT_IMAGE = "mewbeat-decoder";
// A few minutes of audio take seconds on one thread; this only stops a stuck container.
const RUN_TIMEOUT_MS = 300_000;
// Basic Pitch holds the posteriors of the whole song in memory: a mix or a long stream is not worth it.
const MAX_TRACK_MS = 20 * 60 * 1000;
// Audio below these is a stub (the store holds a 185 byte file): nothing to decode, and not the decoder's failure.
const MIN_TRACK_MS = 2000;
const MIN_AUDIO_BYTES = 4096;
// A song whose decode failed for a reason that may pass is tried again no sooner than this after its 1st and its 2nd failure;
// the 3rd is final until the process restarts. A failure that comes from the audio itself is final at once.
const RETRY_AFTER_MS = [10 * 60_000, 30 * 60_000];
const MAX_TRIES = 3;
// A decoder that could not be reached (no Docker, no image, the service down) is asked again after this long.
const REPROBE_MS = 5 * 60_000;
const UNAVAILABLE = /unable to find image|no such image|pull access denied|cannot connect to the docker daemon|error during connect|failed to connect to the docker api|is the docker daemon running/i;
// Socket errors that mean nobody answers at the service's address (a reset or a timeout mid-decode is not among them).
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function failure(message, extra) {
  return Object.assign(new Error(message), extra);
}

// `docker rm -f` by name: stops the container if it still runs and removes it. Never rejects; a container that is already
// gone ("No such container") is the good outcome.
function removeContainer(name, spawnFn = spawn) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn("docker", ["rm", "-f", name], { stdio: "ignore", windowsHide: true });
    } catch {
      return resolve();
    }
    const timer = setTimeout(resolve, 15_000);
    timer.unref?.();
    const done = () => { clearTimeout(timer); resolve(); };
    child.on("error", done);
    child.on("close", done);
  });
}

// Runs scripts/mewbeat-melody/decoder/decode.py on one audio file in the mewbeat-decoder image and returns the JSON it writes
// ({ dur, notes, fg, short }). The image is never pulled, the container has no network, and a run past `timeoutMs` has its
// container removed by name (docker rm -f). Docker missing, the image missing or the daemon down throw an error with
// `unavailable: true`.
async function runDocker({ audioFile, timeoutMs = RUN_TIMEOUT_MS, image = process.env.MEWBEAT_DECODER_IMAGE || DEFAULT_IMAGE, threads = process.env.MEWBEAT_DECODER_THREADS || 1, spawnFn = spawn }) {
  const out = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mewbeat-decode-"));
  const name = `mewbeat-decode-${randomUUID()}`;
  const mount = (source, target, readonly) => ["--mount", `type=bind,source=${source},target=${target}${readonly ? ",readonly" : ""}`];
  const args = [
    "run", "--rm", "--pull=never", "--network", "none", "--name", name,
    ...mount(DECODER_DIR, "/rs", true), ...mount(path.dirname(audioFile), "/in", true), ...mount(out, "/out", false),
    image, "python", "-I", "/rs/decode.py", "--threads", String(threads), `/in/${path.basename(audioFile)}`, "/out/decoded.json",
  ];
  try {
    await new Promise((resolve, reject) => {
      let stderr = "";
      let timedOut = false;
      const child = spawnFn("docker", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      const timer = setTimeout(() => {
        timedOut = true;
        // Killing the client leaves the container running, so it is removed by name, now and again once the client is gone.
        removeContainer(name, spawnFn);
        child.kill();
      }, timeoutMs);
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(failure(`docker could not start: ${error.message}`, { unavailable: error.code === "ENOENT" }));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        const text = stderr.trim();
        if (timedOut) return removeContainer(name, spawnFn).then(() => reject(failure(`the decoder ran past ${timeoutMs} ms`)));
        reject(failure(`the decoder exited with ${code}: ${text}`, { unavailable: code === 125 || UNAVAILABLE.test(text) }));
      });
    });
    return JSON.parse(await fsPromises.readFile(path.join(out, "decoded.json"), "utf8"));
  } finally {
    await fsPromises.rm(out, { recursive: true, force: true }).catch(() => {});
  }
}

// The same decode through the decoder service (scripts/mewbeat-melody/decoder/service.py, compose service mewbeat-decoder):
// the bytes of the audio file are POSTed to `url` and the JSON it answers is returned. node:http rather than fetch, whose
// client gives up on a slow answer after five minutes of its own. A service nobody answers for throws `unavailable: true`; a
// 400 or 413 from it is the audio's own fault and throws `permanent: true`; a busy service, a reset connection (the service out
// of memory) and a timeout are failures that may pass.
async function runService({ audioFile, timeoutMs = RUN_TIMEOUT_MS, url = process.env.MEWBEAT_DECODER_URL }) {
  const body = await fsPromises.readFile(audioFile);
  const target = new URL("/decode", url);
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": body.length, "X-Timeout-Ms": String(timeoutMs) },
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
        const reason = payload?.error ?? text.slice(0, 200);
        reject(failure(`the decoder service answered ${response.statusCode}: ${reason}`, { permanent: payload?.permanent === true }));
      });
    });
    const timer = setTimeout(() => request.destroy(failure(`the decoder service did not answer within ${timeoutMs} ms`)), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      if (UNREACHABLE_CODES.has(error.code)) return reject(failure(`the decoder service is unreachable: ${error.code}`, { unavailable: true }));
      reject(error.code ? failure(`the decoder service failed: ${error.code}`) : error); // our own timeout has no code
    });
    request.end(body);
  });
}

// The service when MEWBEAT_DECODER_URL is set (compose sets it), else a throwaway container per decode.
const runDefault = (args) => (process.env.MEWBEAT_DECODER_URL ? runService(args) : runDocker(args));

// Decodes a song's melody as it is charted: audio from `audio` (an audio store: get(audioKey, track, node) -> file), the decode
// step through `run`, the file written by scripts/mewbeat-melody/build.js to <dir>/melody/<audio key file>.json, which the chart
// store lays on the features (chartStore.js). ensure() never rejects; it answers "present" (a file was there), "decoded",
// "failed", "short" (audio too short to decode, not a failure) or "off". One decode runs at a time (a play decode goes ahead of
// queued background ones, priorityGate.js) and a key has one in flight. A key that failed is tried again later, at most
// MAX_TRIES times in all and no sooner than RETRY_AFTER_MS after a failure, when something asks for it again (a failure that
// comes from the audio is final at once). A decoder that cannot be reached warns once, is not asked for REPROBE_MS, and is then
// probed by the next decode. The switch MEWBEAT_MELODY_DECODER=off turns it all off.
function createMelodyDecoder({ dir, audio, run = runDefault, log = Log, timeoutMs = RUN_TIMEOUT_MS, enabled = process.env.MEWBEAT_MELODY_DECODER !== "off", now = Date.now }) {
  const melodyDir = path.join(dir, "melody");
  const failedKeys = new Map(); // key -> { tries, retryAt, permanent }
  const shortKeys = new Set(); // keys whose audio is too short to decode
  const pendingByKey = new Map();
  // Decodes (the audio render and the decode step) run one at a time across keys.
  const gate = createPriorityGate({ concurrency: 1 });
  let unavailableUntil = 0;
  let warnedUnavailable = false;

  const fileOf = (key) => path.join(melodyDir, `${audioKeyFile(key)}.json`);
  const has = (key) => fs.existsSync(fileOf(key));
  const isUnavailable = () => now() < unavailableUntil;

  // False while the key's failure is final or still inside its backoff.
  function mayTry(key) {
    const failed = failedKeys.get(key);
    return !failed || (!failed.permanent && failed.tries < MAX_TRIES && now() >= failed.retryAt);
  }

  async function write(key, melody) {
    await fsPromises.mkdir(melodyDir, { recursive: true });
    const file = fileOf(key);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fsPromises.writeFile(temp, JSON.stringify(melody));
      await fsPromises.rename(temp, file);
    } finally {
      await fsPromises.rm(temp, { force: true }).catch(() => {});
    }
  }

  async function decode(key, track, node, features, priority) {
    const length = Number(track?.info?.length);
    if (length > MAX_TRACK_MS) throw failure(`the track is ${Math.round(length / 60000)} minutes long`, { permanent: true });
    if (length > 0 && length < MIN_TRACK_MS) throw failure(`the track is ${length} ms long`, { short: true });
    const decoded = await gate.run(async () => {
      if (isUnavailable()) throw failure("the decoder is unavailable", { unavailable: true });
      const audioFile = await audio.get(key, track, node);
      // A file that cannot be measured is left to the decoder to complain about.
      const size = await fsPromises.stat(audioFile).then((stat) => stat.size, () => null);
      if (size !== null && size < MIN_AUDIO_BYTES) throw failure(`the audio is ${size} bytes`, { short: true });
      return run({ audioFile, timeoutMs });
    }, { priority, key });
    await write(key, melodyFileOf(decoded, features, decoded.short ?? null));
    // The decoder answers again: forget an outage and the key's earlier failures.
    unavailableUntil = 0;
    warnedUnavailable = false;
    failedKeys.delete(key);
  }

  async function work(key, track, node, features, priority) {
    try {
      await decode(key, track, node, features, priority);
      return "decoded";
    } catch (error) {
      if (error?.unavailable) {
        if (!warnedUnavailable) log.warning("mewbeat melody decoder is unavailable, melodies will not be decoded for now", error.message);
        warnedUnavailable = true;
        unavailableUntil = now() + REPROBE_MS;
        return "off";
      }
      if (error?.short) {
        shortKeys.add(key);
        return "short";
      }
      const tries = (failedKeys.get(key)?.tries ?? 0) + 1;
      const permanent = error?.permanent === true;
      failedKeys.set(key, { tries, permanent, retryAt: now() + (RETRY_AFTER_MS[tries - 1] ?? Infinity) });
      const next = permanent || tries >= MAX_TRIES ? "final" : `retry in ${RETRY_AFTER_MS[tries - 1] / 60_000} min at the earliest`;
      log.warning("mewbeat could not decode a melody", key, `${error?.message} (try ${tries}, ${next})`);
      return "failed";
    }
  }

  // priority: "play" (default) or "background"; a play request for a decode that waits as background takes over its place.
  function ensure(key, track, node, features, { priority = "play" } = {}) {
    if (!enabled || isUnavailable()) return Promise.resolve("off");
    if (has(key)) return Promise.resolve("present");
    if (shortKeys.has(key)) return Promise.resolve("short");
    if (!mayTry(key)) return Promise.resolve("failed");
    if (!features) return Promise.resolve("failed");
    const pending = pendingByKey.get(key);
    if (pending) {
      if (priority === "play") gate.promote(key);
      return pending;
    }

    const request = work(key, track, node, features, priority).finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, request);
    return request;
  }

  // Whether asking for this key's melody now would start a decode: nothing pending, no file, the decoder switched on and
  // reachable, the audio decodable, and no failure that is final or still inside its backoff. Sync and cheap.
  const wants = (key) => enabled && !isUnavailable() && !pendingByKey.has(key) && !shortKeys.has(key) && mayTry(key) && !has(key);

  const promote = (key) => gate.promote(key);

  return { ensure, has, promote, wants, isEnabled: () => enabled && !isUnavailable() };
}

module.exports = { createMelodyDecoder, runDocker, runService };
