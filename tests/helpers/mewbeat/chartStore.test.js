const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore: createStoreOn } = require("../../../helpers/mewbeat/chartStore");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { GENERATOR_VERSION, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeFeatures } = require("./fixtures");

const quietLog = { warning() {} };

// The store reads the flags file at most once per FLAGS_TTL_MS of its clock, which a change to the file moves past (setFlags).
// These tests generate in-process: the flags they register above exist in this thread only, not in the store's worker.
const FLAGS_TTL_MS = 2000;
let clock = 1_000_000;
const createChartStore = (options) => createStoreOn({ now: () => clock, generate: generateAll, ...options });

// The registry is empty between experiments, so these tests bring their own flags.
for (const name of ["density", "holds", "lead", "transitions"]) FLAGS[name] = { label: name, levels: {} };

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
  const spy = (features, audioKey, flags) => {
    spy.calls += 1;
    spy.flags.push(flags);
    return generateAll(features, audioKey, flags);
  };
  spy.calls = 0;
  spy.flags = [];
  return spy;
}

describe("mewbeat chart store", () => {
  let dir;
  const track = makeTrack();
  const chartsDir = () => path.join(dir, "charts");
  // These stores have no melody decoder, so what they chart is made without a melody and carries the nm marker.
  const chartsPath = (version = GENERATOR_VERSION, flagged = "") =>
    path.join(chartsDir(), `${audioKeyFile(audioKeyOf(track))}.v${version}${flagged && `-${flagged}`}-nm.json`);
  const setFlags = (value) => {
    fs.writeFileSync(path.join(dir, "generator-flags.json"), typeof value === "string" ? value : JSON.stringify(value));
    clock += FLAGS_TTL_MS;
  };

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

  it("gives every level the pace of Normal's busier windows, and keeps it off the file", async () => {
    const { charts } = await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
    const times = [...new Set(charts.normal.notes.map((n) => n.t))].sort((a, b) => a - b);
    const counts = [];
    for (let from = times[0]; from <= times[times.length - 1]; from += 4000) counts.push(times.filter((t) => t >= from && t < from + 4000).length / 4);
    const pace = counts.sort((a, b) => a - b)[Math.floor(counts.length * 0.75)];
    for (const level of ["easy", "normal", "hard", "hell"]) assert.strictEqual(charts[level].pace, pace, level);
    assert.strictEqual(JSON.parse(fs.readFileSync(chartsPath(), "utf8")).normal.pace, undefined);
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
    const unpaced = Object.fromEntries(Object.entries(charts).map(([level, { pace: _pace, ...chart }]) => [level, chart]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(chartsPath(), "utf8")), unpaced);
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

  describe("summaryReader", () => {
    it("summarises each level of a stored song without keeping the chart file in play", async () => {
      await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      const read = store.summaryReader();

      const summary = read(track);
      assert.deepStrictEqual(Object.keys(summary), ["easy", "normal", "hard", "hell"]);
      const charts = JSON.parse(fs.readFileSync(chartsPath(), "utf8"));
      assert.deepStrictEqual(summary.hard, {
        version: charts.hard.version, stars: charts.hard.stars, bpm: charts.hard.bpm, highlightMs: charts.hard.highlightMs, notes: charts.hard.notes.length,
      });

      // A second look at the song does not read its chart file again.
      fs.unlinkSync(chartsPath());
      assert.deepStrictEqual(store.summaryReader()(track), summary);
    });

    it("is null for a song with no charts and for one without an audio key", () => {
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      assert.strictEqual(store.summaryReader()(track), null);
      assert.strictEqual(store.summaryReader()(makeTrack({ isStream: true })), null);
    });

    it("reads the flags file once for a reader, however many songs it looks up", async () => {
      await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      const flagsReads = mock.method(fs, "readFileSync", fs.readFileSync);
      try {
        const read = store.summaryReader();
        read(track);
        read(track);
        read(makeTrack({ identifier: "other" }));
        const reads = flagsReads.mock.calls.filter((call) => String(call.arguments[0]).endsWith("generator-flags.json"));
        assert.strictEqual(reads.length, 1);
      } finally {
        flagsReads.mock.restore();
      }
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

  describe("generator flags", () => {
    it("reads the flags file on every call and keeps a file per combination", async () => {
      const generate = spiedGenerate();
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

      const plain = await store.getCharts(track, "node");
      setFlags({ flags: ["holds", "density"] });
      const flagged = await store.getCharts(track, "node");

      assert.deepStrictEqual(generate.flags, [{}, { density: true, holds: true }]);
      assert.strictEqual(plain.charts.easy.version, `${GENERATOR_VERSION}-nm`);
      assert.strictEqual(flagged.charts.easy.version, `${GENERATOR_VERSION}-density-holds-nm`);
      assert.ok(fs.existsSync(chartsPath()));
      assert.ok(fs.existsSync(chartsPath(GENERATOR_VERSION, "density-holds")));
      assert.ok(!fs.existsSync(chartsPath(GENERATOR_VERSION, "holds-density")));
    });

    it("turning a flag on and off again reuses the cache of each combination", async () => {
      const generate = spiedGenerate();
      const analysis = fakeAnalysis();
      const store = createChartStore({ dir, analysis, generate, log: quietLog });

      const plain = await store.getCharts(track, "node");
      setFlags({ flags: ["holds"] });
      const flagged = await store.getCharts(track, "node");
      setFlags({ flags: [] });
      assert.strictEqual((await store.getCharts(track, "node")).charts, plain.charts);
      assert.strictEqual(store.peekCharts(track).charts, plain.charts);
      setFlags({ flags: ["holds"] });
      assert.strictEqual((await store.getCharts(track, "node")).charts, flagged.charts);
      fs.rmSync(path.join(dir, "generator-flags.json"));
      clock += FLAGS_TTL_MS;
      assert.strictEqual((await store.getCharts(track, "node")).charts, plain.charts);

      assert.strictEqual(generate.calls, 2);
      assert.strictEqual(analysis.calls.length, 2);
    });

    it("serves a flagged combination from disk to a fresh store", async () => {
      setFlags({ flags: ["lead"] });
      await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
      const generate = spiedGenerate();
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: quietLog });

      assert.strictEqual(store.peekCharts(track).charts.easy.version, `${GENERATOR_VERSION}-lead-nm`);
      setFlags({ flags: [] });
      assert.strictEqual(store.peekCharts(track), null);
      assert.strictEqual(generate.calls, 0);
    });

    it("peeks nothing for a combination that has no charts yet", async () => {
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      await store.getCharts(track, "node");
      assert.strictEqual(store.peekCharts(track).status, "ready");

      setFlags({ flags: ["transitions"] });
      assert.strictEqual(store.peekCharts(track), null);
      await store.getCharts(track, "node");
      assert.strictEqual(store.peekCharts(track).charts.hard.version, `${GENERATOR_VERSION}-transitions-nm`);
    });

    it("keeps uncharted verdicts per combination", async () => {
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate: () => null, log: quietLog });
      assert.strictEqual((await store.getCharts(track, "node")).status, "uncharted");
      setFlags({ flags: ["holds"] });
      assert.strictEqual(store.peekCharts(track), null);
      assert.strictEqual((await store.getCharts(track, "node")).status, "uncharted");
      assert.ok(fs.existsSync(chartsPath(GENERATOR_VERSION, "holds")));
    });

    it("sweeps charts of other versions, flagged or not, and keeps the current ones with any flags", async () => {
      fs.mkdirSync(chartsDir(), { recursive: true });
      const old = [chartsPath(0), chartsPath(GENERATOR_VERSION - 1, "holds"), chartsPath(GENERATOR_VERSION + 1, "density-holds")];
      const current = [chartsPath(GENERATOR_VERSION, "lead"), chartsPath(GENERATOR_VERSION, "density-holds")];
      const backup = `${chartsPath()}.corrupt-1`;
      for (const file of [...old, ...current, backup]) fs.writeFileSync(file, "{}");
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });

      await store.getCharts(track, "node");

      for (const file of old) assert.ok(!fs.existsSync(file), file);
      for (const file of [...current, backup]) assert.ok(fs.existsSync(file), file);
    });

    it("treats a missing, broken or oddly shaped flags file as no flags, logging a failure once", async () => {
      const warnings = [];
      const generate = spiedGenerate();
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log: { warning: (...args) => warnings.push(args) } });

      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, `${GENERATOR_VERSION}-nm`);
      setFlags("{not json");
      for (let i = 0; i < 3; i += 1) {
        assert.strictEqual(store.peekCharts(track).charts.easy.version, `${GENERATOR_VERSION}-nm`);
        assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
      }
      assert.strictEqual(warnings.length, 1);
      for (const text of ["null", "[]", '{"flags":"holds"}', '{"flags":["nope"]}']) {
        setFlags(text);
        assert.strictEqual(store.peekCharts(track).charts.easy.version, `${GENERATOR_VERSION}-nm`, text);
      }
      setFlags("{still not json");
      store.peekCharts(track);
      assert.strictEqual(warnings.length, 2);
      assert.strictEqual(generate.calls, 1);
    });
  });

  describe("flags file cache", () => {
    const flagsReads = (spy) => spy.mock.calls.filter((call) => String(call.arguments[0]).endsWith("generator-flags.json")).length;

    it("reads the flags file once per TTL and sees a change at the first request after it", async () => {
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      await store.getCharts(track, "node");
      clock += FLAGS_TTL_MS;
      const spy = mock.method(fs, "readFileSync", fs.readFileSync);
      try {
        store.peekCharts(track);
        store.peekCharts(track);
        assert.strictEqual(flagsReads(spy), 1);

        fs.writeFileSync(path.join(dir, "generator-flags.json"), JSON.stringify({ flags: ["holds"] }));
        clock += FLAGS_TTL_MS - 1;
        assert.strictEqual(store.peekCharts(track).charts.easy.version, `${GENERATOR_VERSION}-nm`);
        assert.strictEqual(flagsReads(spy), 1);
        assert.ok(!fs.existsSync(chartsPath(GENERATOR_VERSION, "holds")));

        clock += 1;
        assert.strictEqual(store.peekCharts(track), null); // the flagged charts are not made yet
        assert.strictEqual(flagsReads(spy), 2);
      } finally {
        spy.mock.restore();
      }
    });
  });

  describe("warmSummaries", () => {
    const chartReads = (spy) => spy.mock.calls.filter((call) => /charts[\\/][^\\/]*\.json$/.test(String(call.arguments[0]))).length;

    it("has the summaries of the stored songs ready without parsing a chart file on the lookup", async () => {
      await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      await store.warmSummaries();
      const spy = mock.method(fs, "readFileSync", fs.readFileSync);
      try {
        const summary = store.summaryReader()(track);
        assert.deepStrictEqual(Object.keys(summary), ["easy", "normal", "hard", "hell"]);
        assert.strictEqual(chartReads(spy), 0);
      } finally {
        spy.mock.restore();
      }
    });

    it("gives what the file gives without warming, and warms without a charts directory", async () => {
      await createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog }).getCharts(track, "node");
      const cold = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      const warm = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      await warm.warmSummaries();
      assert.deepStrictEqual(warm.summaryReader()(track), cold.summaryReader()(track));

      const empty = createChartStore({ dir: path.join(dir, "nowhere"), analysis: fakeAnalysis(), log: quietLog });
      await empty.warmSummaries();
      assert.strictEqual(empty.summaryReader()(track), null);
    });

    it("does not read a missing chart file again until charts are written for it", async () => {
      const store = createChartStore({ dir, analysis: fakeAnalysis(), log: quietLog });
      const spy = mock.method(fs, "readFileSync", fs.readFileSync);
      try {
        assert.strictEqual(store.peekCharts(track), null);
        assert.strictEqual(store.peekCharts(track), null);
        assert.strictEqual(store.summaryReader()(track), null);
        // One read for each variant (made with a melody, made without): none is read twice.
        assert.strictEqual(chartReads(spy), 2);
      } finally {
        spy.mock.restore();
      }
      assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
      assert.strictEqual(store.peekCharts(track).status, "ready");
      assert.ok(store.summaryReader()(track));
    });
  });
});
