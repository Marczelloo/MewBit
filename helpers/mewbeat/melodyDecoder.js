const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const Log = require("../logs/log");
const { melodyFileOf } = require("../../scripts/mewbeat-melody/build");
const { audioKeyFile } = require("./audioKey");

const DECODER_DIR = path.join(__dirname, "..", "..", "scripts", "mewbeat-melody", "decoder");
const DEFAULT_IMAGE = "mewbeat-decoder";
// A few minutes of audio take seconds on one thread; this only stops a stuck container.
const RUN_TIMEOUT_MS = 300_000;
// Basic Pitch holds the posteriors of the whole song in memory: a mix or a long stream is not worth it.
const MAX_TRACK_MS = 20 * 60 * 1000;
const UNAVAILABLE = /unable to find image|no such image|pull access denied|cannot connect to the docker daemon|error during connect|failed to connect to the docker api|is the docker daemon running/i;

function failure(message, extra) {
  return Object.assign(new Error(message), extra);
}

// Runs scripts/mewbeat-melody/decoder/decode.py on one audio file in the mewbeat-decoder image and returns the JSON it writes
// ({ dur, notes, fg, short }). The image is never pulled, the container has no network, and a run past `timeoutMs` is killed by
// its name. Docker missing, the image missing or the daemon down throw an error with `unavailable: true`.
async function runDocker({ audioFile, timeoutMs = RUN_TIMEOUT_MS, image = process.env.MEWBEAT_DECODER_IMAGE || DEFAULT_IMAGE, threads = process.env.MEWBEAT_DECODER_THREADS || 1 }) {
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
      const child = spawn("docker", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      const timer = setTimeout(() => {
        timedOut = true;
        // Killing the client leaves the container running, so it is stopped by name.
        spawn("docker", ["kill", name], { stdio: "ignore", windowsHide: true }).on("error", () => {});
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
        if (timedOut) return reject(failure(`the decoder ran past ${timeoutMs} ms`));
        reject(failure(`the decoder exited with ${code}: ${text}`, { unavailable: code === 125 || UNAVAILABLE.test(text) }));
      });
    });
    return JSON.parse(await fsPromises.readFile(path.join(out, "decoded.json"), "utf8"));
  } finally {
    await fsPromises.rm(out, { recursive: true, force: true }).catch(() => {});
  }
}

// Decodes a song's melody as it is charted: audio from `audio` (an audio store: get(audioKey, track, node) -> file), the Docker
// step through `run`, the file written by scripts/mewbeat-melody/build.js to <dir>/melody/<audio key file>.json, which the chart
// store lays on the features (chartStore.js). ensure() never rejects; it answers "present" (a file was there), "decoded", "failed"
// or "off". One decode runs at a time, a key has one in flight, and a key that failed is not tried again until the process
// restarts. Without Docker or the image it warns once and stops trying, as does the switch MEWBEAT_MELODY_DECODER=off.
function createMelodyDecoder({ dir, audio, run = runDocker, log = Log, timeoutMs = RUN_TIMEOUT_MS, enabled = process.env.MEWBEAT_MELODY_DECODER !== "off" }) {
  const melodyDir = path.join(dir, "melody");
  const failedKeys = new Set();
  const pendingByKey = new Map();
  // Decodes run one at a time across keys; the chain never rejects.
  let queue = Promise.resolve();
  let unavailable = false;

  const fileOf = (key) => path.join(melodyDir, `${audioKeyFile(key)}.json`);
  const has = (key) => fs.existsSync(fileOf(key));

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

  async function decode(key, track, node, features) {
    const length = Number(track?.info?.length);
    if (length > MAX_TRACK_MS) throw failure(`the track is ${Math.round(length / 60000)} minutes long`);
    const audioFile = await audio.get(key, track, node);
    const job = queue.then(() => {
      if (unavailable) throw failure("the decoder is unavailable", { unavailable: true });
      return run({ audioFile, timeoutMs });
    });
    queue = job.catch(() => {});
    const decoded = await job;
    await write(key, melodyFileOf(decoded, features, decoded.short ?? null));
  }

  async function work(key, track, node, features) {
    try {
      await decode(key, track, node, features);
      return "decoded";
    } catch (error) {
      if (error?.unavailable) {
        if (!unavailable) log.warning("mewbeat melody decoder is unavailable, melodies will not be decoded", error.message);
        unavailable = true;
        return "off";
      }
      failedKeys.add(key);
      log.warning("mewbeat could not decode a melody", key, error?.message);
      return "failed";
    }
  }

  function ensure(key, track, node, features) {
    if (!enabled || unavailable) return Promise.resolve("off");
    if (has(key)) return Promise.resolve("present");
    if (failedKeys.has(key)) return Promise.resolve("failed");
    if (!features) return Promise.resolve("failed");
    const pending = pendingByKey.get(key);
    if (pending) return pending;

    const request = work(key, track, node, features).finally(() => pendingByKey.delete(key));
    pendingByKey.set(key, request);
    return request;
  }

  return { ensure, has, isEnabled: () => enabled && !unavailable };
}

module.exports = { createMelodyDecoder, runDocker };
