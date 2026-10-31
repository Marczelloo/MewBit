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

// `status` is what the analysis client would say about a track it has no features for.
function fakeAnalysis(features = makeFeatures(), status = null) {
  const calls = [];
  return {
    calls,
    getFeatures: async (track, node) => {
      calls.push({ track, node });
      return features;
    },
    statusOf: () => status,
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

    assert.strictEqual(first.status, "ready");
    assert.ok(first.charts.easy.notes.length > 0);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(generate.calls, 1);
    assert.ok(fs.existsSync(chartsPath()));
  });

  it("serves charts from disk to a fresh store without analysing", async () => {
    await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
    const analysis = fakeAnalysis();
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis, generate, log: quietLog });

    assert.strictEqual(store.peekCharts(track).status, "ready");
    assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    assert.strictEqual(analysis.calls.length, 0);
    assert.strictEqual(generate.calls, 0);
  });

  it("regeneratesOnVersionBump", async () => {
    fs.mkdirSync(chartsDir(), { recursive: true });
    fs.writeFileSync(chartsPath(0), JSON.stringify({ easy: { notes: [] }, normal: { notes: [] }, hard: { notes: [] } }));
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

    assert.strictEqual(store.peekCharts(track), null);
    const { charts } = await store.getCharts(track, "node");

    assert.ok(charts.hard.notes.length > 0);
    assert.strictEqual(generate.calls, 1);
  });

  it("corruptFileIsAMiss", async () => {
    fs.mkdirSync(chartsDir(), { recursive: true });
    fs.writeFileSync(chartsPath(), "{not json");
    const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

    const { charts } = await store.getCharts(track, "node");

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

    const { charts } = await store.getCharts(track, "node");

    assert.strictEqual(charts.easy.audioKey, audioKeyOf(track));
  });

  it("reports pending while the plugin is busy, without persisting anything", async () => {
    const store = createChartStore({ dir, analysis: fakeAnalysis(null, { status: "busy" }), log: quietLog });

    assert.deepStrictEqual(await store.getCharts(track, "node"), { status: "pending" });
    assert.strictEqual(fs.existsSync(chartsPath()), false);
    assert.strictEqual(store.peekCharts(track), null);
  });

  it("reports failed when analysis failed or knows nothing", async () => {
    const failed = createChartStore({ dir, analysis: fakeAnalysis(null, { status: "failed" }), log: quietLog });
    assert.deepStrictEqual(await failed.getCharts(track, "node"), { status: "failed" });

    const unknown = createChartStore({ dir, analysis: fakeAnalysis(null, null), log: quietLog });
    assert.deepStrictEqual(await unknown.getCharts(track, "node"), { status: "failed" });
  });

  it("passes the analysis client uncharted reason through", async () => {
    const analysis = fakeAnalysis(null, { status: "uncharted", reason: "too_long" });
    const store = createChartStore({ dir, analysis, log: quietLog });

    assert.deepStrictEqual(await store.getCharts(track, "node"), { status: "uncharted", reason: "too_long" });
    assert.strictEqual(fs.existsSync(chartsPath()), false);
  });

  it("reports tracks without an audio key as uncharted without analysing", async () => {
    const analysis = fakeAnalysis();
    const store = createChartStore({ dir, analysis, log: quietLog });
    const stream = makeTrack({ isStream: true });

    assert.deepStrictEqual(await store.getCharts(stream, "node"), { status: "uncharted", reason: "no_audio_key" });
    assert.strictEqual(store.peekCharts(stream), null);
    assert.strictEqual(analysis.calls.length, 0);
  });

  describe("too few notes", () => {
    const sparse = () => makeFeatures({ durationMs: 8000, onsetEveryBeats: 4 });
    const expected = { status: "uncharted", reason: "too_few_notes" };

    it("persists an uncharted marker and neither analyses nor generates again", async () => {
      const analysis = fakeAnalysis(sparse());
      const generate = spiedGenerate();
      const store = createChartStore({ dir, analysis, generate, log: quietLog });

      assert.deepStrictEqual(await store.getCharts(track, "node"), expected);
      assert.deepStrictEqual(await store.getCharts(track, "node"), expected);
      assert.strictEqual(analysis.calls.length, 1);
      assert.strictEqual(generate.calls, 1);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(chartsPath(), "utf8")), { uncharted: true, reason: "too_few_notes" });
      assert.deepStrictEqual(store.peekCharts(track), expected);
    });

    it("is served from disk to a fresh store without analysing", async () => {
      await createChartStore({ dir, analysis: fakeAnalysis(sparse()), log: quietLog }).getCharts(track, "node");
      const analysis = fakeAnalysis();
      const generate = spiedGenerate();
      const store = createChartStore({ dir, analysis, generate, log: quietLog });

      assert.deepStrictEqual(store.peekCharts(track), expected);
      assert.deepStrictEqual(await store.getCharts(track, "node"), expected);
      assert.strictEqual(analysis.calls.length, 0);
      assert.strictEqual(generate.calls, 0);
    });
  });

  describe("old generator versions", () => {
    it("removes charts of other generator versions on the first getCharts only", async () => {
      fs.mkdirSync(chartsDir(), { recursive: true });
      const stale = chartsPath(GENERATOR_VERSION - 1);
      const newer = chartsPath(GENERATOR_VERSION + 1);
      const corrupt = `${chartsPath()}.corrupt-123`;
      const unrelated = path.join(chartsDir(), "notes.txt");
      for (const file of [stale, newer, corrupt, unrelated]) fs.writeFileSync(file, "{}");
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

      await store.getCharts(track, "node");

      assert.strictEqual(fs.existsSync(stale), false);
      assert.strictEqual(fs.existsSync(newer), false);
      assert.ok(fs.existsSync(chartsPath()), "current version stays");
      assert.ok(fs.existsSync(corrupt), "corrupt backups stay");
      assert.ok(fs.existsSync(unrelated), "unrelated files stay");

      fs.writeFileSync(stale, "{}");
      await store.getCharts(makeTrack({ identifier: "second" }), "node");
      assert.ok(fs.existsSync(stale), "swept once per store");
    });

    it("works when the charts directory does not exist yet", async () => {
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

      assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
    });

    it("logs and carries on when a file cannot be removed", async () => {
      const warnings = [];
      fs.mkdirSync(path.join(chartsDir(), `x.v${GENERATOR_VERSION + 1}.json`), { recursive: true });
      const store = createChartStore({
        dir,
        analysis: fakeAnalysis(),
        log: { warning: (...args) => warnings.push(args) },
      });

      assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
      assert.ok(warnings.some(([message]) => /old charts/.test(message)));
    });
  });

  describe("peekCharts", () => {
    it("is null when nothing is known and never analyses", () => {
      const analysis = fakeAnalysis();
      const store = createChartStore({ dir, analysis, log: quietLog });

      assert.strictEqual(store.peekCharts(track), null);
      assert.strictEqual(analysis.calls.length, 0);
    });

    it("reports an uncharted verdict the analysis client already holds", () => {
      const analysis = fakeAnalysis(null, { status: "uncharted", reason: "too_short" });
      const store = createChartStore({ dir, analysis, log: quietLog });

      assert.deepStrictEqual(store.peekCharts(track), { status: "uncharted", reason: "too_short" });
    });

    it("does not report busy or failed", () => {
      for (const status of ["busy", "failed"]) {
        const store = createChartStore({ dir, analysis: fakeAnalysis(null, { status }), log: quietLog });
        assert.strictEqual(store.peekCharts(track), null);
      }
    });
  });

  it("generates once for concurrent requests", async () => {
    const generate = spiedGenerate();
    const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

    const [a, b] = await Promise.all([store.getCharts(track, "node"), store.getCharts(track, "node")]);

    assert.strictEqual(a, b);
    assert.strictEqual(a.status, "ready");
    assert.strictEqual(generate.calls, 1);
  });

  it("still returns charts when the disk write fails", async () => {
    fs.writeFileSync(chartsDir(), "a file where the charts directory should be");
    const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

    const { charts } = await store.getCharts(track, "node");

    assert.ok(charts.easy.notes.length > 0);
    assert.strictEqual(store.peekCharts(track).charts, charts);
  });
});
