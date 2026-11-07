const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { melodyFileOf } = require("../../../scripts/mewbeat-melody/build");
const { audioKeyFile } = require("../../../helpers/mewbeat/audioKey");
const { createMelodyDecoder } = require("../../../helpers/mewbeat/melodyDecoder");
const fixture = require("./fixtures/melody-export.json");

const KEY = "youtube:abc123:180000";
const OTHER = "youtube:other:90000";
const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000 } };
const decoded = { ...fixture.decoded, short: fixture.short };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeLog() {
  const warnings = [];
  return { warnings, warning: (...args) => warnings.push(args) };
}

// An audio store that never touches the disk; `calls` are the keys it was asked for.
function fakeAudio() {
  const calls = [];
  return { calls, get: async (key) => { calls.push(key); return `/audio/${audioKeyFile(key)}.ogg`; } };
}

function fakeRun(result = decoded) {
  const run = async (args) => {
    run.calls.push(args);
    run.active += 1;
    run.peak = Math.max(run.peak, run.active);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return typeof result === "function" ? await result(args) : result;
    } finally {
      run.active -= 1;
    }
  };
  Object.assign(run, { calls: [], active: 0, peak: 0 });
  return run;
}

describe("mewbeat melody decoder", () => {
  let dir;
  const melodyPath = (key = KEY) => path.join(dir, "melody", `${audioKeyFile(key)}.json`);
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-melody-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("decodes the audio and writes the melody file the export gives", async () => {
    const audio = fakeAudio();
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog(), timeoutMs: 1234 });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");

    assert.deepStrictEqual(audio.calls, [KEY]);
    assert.deepStrictEqual(run.calls, [{ audioFile: `/audio/${audioKeyFile(KEY)}.ogg`, timeoutMs: 1234 }]);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(melodyPath(), "utf8")), melodyFileOf(decoded, fixture.features, fixture.short));
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, "melody")), [`${audioKeyFile(KEY)}.json`]);
    assert.ok(decoder.has(KEY));
  });

  it("leaves a song that has a melody file alone", async () => {
    fs.mkdirSync(path.join(dir, "melody"));
    fs.writeFileSync(melodyPath(), "{}");
    const audio = fakeAudio();
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog() });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "present");
    assert.strictEqual(run.calls.length, 0);
    assert.strictEqual(audio.calls.length, 0);
  });

  it("does nothing when it is switched off", async () => {
    const audio = fakeAudio();
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog(), enabled: false });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
    assert.strictEqual(run.calls.length, 0);
    assert.strictEqual(audio.calls.length, 0);
    assert.ok(!fs.existsSync(path.join(dir, "melody")));
  });

  it("decodes a key once however many ask, and one key at a time", async () => {
    const gate = deferred();
    const run = fakeRun(() => gate.promise.then(() => decoded));
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog() });

    const first = [decoder.ensure(KEY, track, "node", fixture.features), decoder.ensure(KEY, track, "node", fixture.features)];
    const second = decoder.ensure(OTHER, track, "node", fixture.features);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(run.calls.length, 1);
    gate.resolve();

    assert.deepStrictEqual(await Promise.all([...first, second]), ["decoded", "decoded", "decoded"]);
    assert.strictEqual(run.calls.length, 2);
    assert.strictEqual(run.peak, 1);
  });

  it("remembers a failure and does not try the key again", async () => {
    const log = fakeLog();
    const run = fakeRun(() => { throw new Error("exit 1"); });
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(log.warnings.length, 1);
    assert.ok(!decoder.has(KEY));

    run.calls.length = 0;
    assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 1);
  });

  it("fails a key whose audio cannot be fetched, without running the decoder", async () => {
    const run = fakeRun();
    const audio = { get: async () => { throw new Error("no audio"); } };
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog() });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 0);
  });

  it("warns once and stops trying when Docker or the image is missing", async () => {
    const log = fakeLog();
    const run = fakeRun(() => { throw Object.assign(new Error("no image"), { unavailable: true }); });
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
    assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "off");
    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(log.warnings.length, 1);
    assert.strictEqual(decoder.isEnabled(), false);
  });

  it("does not decode a track that is too long", async () => {
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog() });
    const long = { ...track, info: { ...track.info, length: 3 * 3600 * 1000 } };

    assert.strictEqual(await decoder.ensure(KEY, long, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 0);
  });
});
