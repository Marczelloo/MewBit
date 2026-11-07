const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { createMelodyDecoder } = require("../../../helpers/mewbeat/melodyDecoder");
const { makeFeatures } = require("./fixtures");
const fixture = require("./fixtures/melody-export.json");

const quietLog = { warning() {} };
const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000, isStream: false } };
const key = audioKeyOf(track);
const decoded = { ...fixture.decoded, short: fixture.short };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Records whether each generation saw a decoded melody.
function spiedGenerate() {
  const spy = (features, audioKey, flags) => {
    spy.withMelody.push(Array.isArray(features.decodedMelody));
    return generateAll(features, audioKey, flags);
  };
  spy.withMelody = [];
  return spy;
}

function fakeAnalysis(features) {
  return { getFeatures: async () => features, peek: () => features, statusOf: () => null };
}

describe("mewbeat chart store with a melody decoder", () => {
  let dir;
  const features = { ...makeFeatures(), ...fixture.features };
  const chartFiles = () => (fs.existsSync(path.join(dir, "charts")) ? fs.readdirSync(path.join(dir, "charts")) : []);
  const melodyFile = () => path.join(dir, "melody", `${audioKeyFile(key)}.json`);
  const decoderOf = (run, enabled = true) => createMelodyDecoder({
    dir, run, enabled, log: quietLog, audio: { get: async () => "/audio/x.ogg" },
  });

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-charts-melody-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("makes the charts of a new song after its melody is decoded", async () => {
    const generate = spiedGenerate();
    const gate = deferred();
    const run = async () => { await gate.promise; return decoded; };
    const store = createChartStore({ dir, analysis: fakeAnalysis(features), generate, log: quietLog, melodyDecoder: decoderOf(run) });

    const request = store.getCharts(track, "node");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepStrictEqual(generate.withMelody, []);
    gate.resolve();

    assert.strictEqual((await request).status, "ready");
    assert.deepStrictEqual(generate.withMelody, [true]);
    assert.ok(fs.existsSync(melodyFile()));
  });

  it("makes the charts without the melody when the decode fails", async () => {
    const generate = spiedGenerate();
    let calls = 0;
    const run = async () => { calls += 1; throw new Error("exit 1"); };
    const store = createChartStore({ dir, analysis: fakeAnalysis(features), generate, log: quietLog, melodyDecoder: decoderOf(run) });

    const result = await store.getCharts(track, "node");

    assert.strictEqual(result.status, "ready");
    assert.deepStrictEqual(generate.withMelody, [false]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(chartFiles().length, 1);
  });

  it("stops waiting for the melody after the time given, then replaces the charts when it arrives", async () => {
    const generate = spiedGenerate();
    const gate = deferred();
    const run = async () => { await gate.promise; return decoded; };
    const store = createChartStore({ dir, analysis: fakeAnalysis(features), generate, log: quietLog, melodyDecoder: decoderOf(run), melodyWaitMs: 30 });

    assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    assert.deepStrictEqual(generate.withMelody, [false]);
    assert.strictEqual(chartFiles().length, 1);

    gate.resolve();
    await waitFor(() => chartFiles().length === 0);
    assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    assert.deepStrictEqual(generate.withMelody, [false, true]);
  });

  it("serves stored charts that have no melody, decodes in the background and drops them", async () => {
    // charts stored by an earlier run, for two combinations of flags
    const earlier = createChartStore({ dir, analysis: fakeAnalysis(features), log: quietLog });
    await earlier.getCharts(track, "node");
    const [stored] = chartFiles();
    fs.copyFileSync(path.join(dir, "charts", stored), path.join(dir, "charts", stored.replace(".json", "-holds.json")));
    assert.strictEqual(chartFiles().length, 2);

    const generate = spiedGenerate();
    const gate = deferred();
    const run = async () => { await gate.promise; return decoded; };
    const store = createChartStore({ dir, analysis: fakeAnalysis(features), generate, log: quietLog, melodyDecoder: decoderOf(run) });

    const first = await store.getCharts(track, "node");
    assert.strictEqual(first.status, "ready");
    assert.deepStrictEqual(generate.withMelody, []);
    assert.strictEqual(chartFiles().length, 2);

    gate.resolve();
    await waitFor(() => chartFiles().length === 0);
    assert.ok(fs.existsSync(melodyFile()));

    assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    assert.deepStrictEqual(generate.withMelody, [true]);
  });

  it("keeps stored charts when the background decode fails", async () => {
    const earlier = createChartStore({ dir, analysis: fakeAnalysis(features), log: quietLog });
    await earlier.getCharts(track, "node");
    let calls = 0;
    const run = async () => { calls += 1; throw new Error("exit 1"); };
    const store = createChartStore({ dir, analysis: fakeAnalysis(features), log: quietLog, melodyDecoder: decoderOf(run) });

    assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    await waitFor(() => calls === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(chartFiles().length, 1);
  });

  it("does nothing about melodies when the decoder is off", async () => {
    const generate = spiedGenerate();
    let calls = 0;
    const run = async () => { calls += 1; return decoded; };
    const store = createChartStore({ dir, analysis: fakeAnalysis(features), generate, log: quietLog, melodyDecoder: decoderOf(run, false) });

    assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    assert.deepStrictEqual(generate.withMelody, [false]);
    assert.strictEqual(calls, 0);
    assert.ok(!fs.existsSync(path.join(dir, "melody")));
  });
});
