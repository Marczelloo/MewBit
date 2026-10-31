const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { GENERATOR_VERSION, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeFeatures } = require("./fixtures");

const quietLog = { warning() {} };

function makeTrack(info) {
  return {
    track: "ENCODED",
    info: { sourceName: "youtube", identifier: "abc123", length: 180000, isStream: false, ...info },
  };
}

function fakeAnalysis(features = makeFeatures()) {
  const calls = [];
  return {
    calls,
    getFeatures: async (track, node) => {
      calls.push({ track, node });
      return features;
    },
  };
}

function spiedGenerate() {
  const spy = (features, audioKey) => {
    spy.calls += 1;
    return generateAll(features, audioKey);
  };
  spy.calls = 0;
  return spy;
}

describe("mewbeat chart store", () => {
  let dir;
  const track = makeTrack();
  const chartsDir = () => path.join(dir, "charts");
  const chartsPath = (version = GENERATOR_VERSION) =>
    path.join(chartsDir(), `${audioKeyFile(audioKeyOf(track))}.v${version}.json`);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-charts-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("generatesAndCaches", async () => {
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

    const first = await store.getCharts(track, "node");
    const second = await store.getCharts(track, "node");

    assert.ok(first.easy.notes.length > 0);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(generate.calls, 1);
    assert.ok(fs.existsSync(chartsPath()));
  });

  it("serves charts from disk to a fresh store without analysing", async () => {
    await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
    const analysis = fakeAnalysis();
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis, generate, log: quietLog });

    assert.ok(store.peekCharts(track));
    assert.ok(await store.getCharts(track, "node"));
    assert.strictEqual(analysis.calls.length, 0);
    assert.strictEqual(generate.calls, 0);
  });

  it("regeneratesOnVersionBump", async () => {
    fs.mkdirSync(chartsDir(), { recursive: true });
    fs.writeFileSync(chartsPath(0), JSON.stringify({ easy: { notes: [] }, normal: { notes: [] }, hard: { notes: [] } }));
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

    assert.strictEqual(store.peekCharts(track), null);
    const charts = await store.getCharts(track, "node");

    assert.ok(charts.hard.notes.length > 0);
    assert.strictEqual(generate.calls, 1);
  });

  it("corruptFileIsAMiss", async () => {
    fs.mkdirSync(chartsDir(), { recursive: true });
    fs.writeFileSync(chartsPath(), "{not json");
    const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

    const charts = await store.getCharts(track, "node");

    assert.ok(charts.normal.notes.length > 0);
    const backups = fs.readdirSync(chartsDir()).filter((name) => name.includes(".corrupt-"));
    assert.strictEqual(backups.length, 1);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(chartsPath(), "utf8")), charts);
  });

  it("treats charts for other audio as corrupt", async () => {
    const other = generateAll(makeFeatures(), "youtube:other:180000");
    fs.mkdirSync(chartsDir(), { recursive: true });
    fs.writeFileSync(chartsPath(), JSON.stringify(other));
    const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

    const charts = await store.getCharts(track, "node");

    assert.strictEqual(charts.easy.audioKey, audioKeyOf(track));
  });

  it("nullFeaturesGiveNull", async () => {
    const store = createChartStore({ dir, analysis: fakeAnalysis(null), log: quietLog });

    assert.strictEqual(await store.getCharts(track, "node"), null);
    assert.strictEqual(fs.existsSync(chartsPath()), false);
  });

  it("returns null for tracks without an audio key", async () => {
    const analysis = fakeAnalysis();
    const store = createChartStore({ dir, analysis, log: quietLog });

    assert.strictEqual(await store.getCharts(makeTrack({ isStream: true }), "node"), null);
    assert.strictEqual(store.peekCharts(makeTrack({ isStream: true })), null);
    assert.strictEqual(analysis.calls.length, 0);
  });

  it("generates once for concurrent requests", async () => {
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

    const [a, b] = await Promise.all([store.getCharts(track, "node"), store.getCharts(track, "node")]);

    assert.strictEqual(a, b);
    assert.strictEqual(generate.calls, 1);
  });

  it("still returns charts when the disk write fails", async () => {
    fs.writeFileSync(chartsDir(), "a file where the charts directory should be");
    const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

    const charts = await store.getCharts(track, "node");

    assert.ok(charts.easy.notes.length > 0);
    assert.strictEqual(store.peekCharts(track), charts);
  });
});
