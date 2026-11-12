const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { FLAGS, fileKey, flagsKey, noMelodyKey } = require("../../../helpers/mewbeat/charts/flags");
const { GENERATOR_VERSION, generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { createMelodyDecoder } = require("../../../helpers/mewbeat/melodyDecoder");
const { makeFeatures } = require("./fixtures");
const fixture = require("./fixtures/melody-export.json");

const KEY = "test-key";
const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000, isStream: false } };
const key = audioKeyOf(track);
const decoded = { ...fixture.decoded, short: fixture.short };
const features = { ...makeFeatures(), ...fixture.features };
const LEVELS = ["easy", "normal", "hard", "hell"];
// FLAGS is empty from v45, so the key machinery is exercised with two flags registered here (they change no note).
FLAGS.markerA = { label: "markerA", levels: {} };
FLAGS.markerB = { label: "markerB", levels: {} };

function collectingLog() {
  const log = { lines: [], warning: (...args) => log.lines.push(args) };
  return log;
}

function fakeAnalysis() {
  return { getFeatures: async () => features, peek: () => features, statusOf: () => null };
}

describe("a chart made without a melody", () => {
  describe("the marker", () => {
    it("is nm, after the flags", () => {
      assert.strictEqual(noMelodyKey(""), "nm");
      assert.strictEqual(noMelodyKey("markerA-markerB"), "markerA-markerB-nm");
      assert.strictEqual(noMelodyKey(flagsKey(["markerB", "markerA"])), "markerA-markerB-nm");
      assert.strictEqual(noMelodyKey(flagsKey(["pitchLanes", "heardChords"])), "nm"); // the flags of before v45 are no flags now
    });

    it("goes into a file name past the length limit as a hash, like any key", () => {
      const long = Array.from({ length: 30 }, (_, index) => `flag${index}`).join("-");
      assert.ok(fileKey(noMelodyKey(long)).startsWith("flags-"));
      assert.ok(fileKey(noMelodyKey(long)).length < 40);
      assert.notStrictEqual(fileKey(noMelodyKey(long)), fileKey(long));
    });

    it("is in the version of every level, and the version made with a melody is what it was", () => {
      for (const level of LEVELS) {
        assert.strictEqual(generateChart(features, level, KEY).version, GENERATOR_VERSION, level);
        assert.strictEqual(generateChart({ ...features, noMelody: true }, level, KEY).version, `${GENERATOR_VERSION}-nm`, level);
        assert.strictEqual(
          generateChart({ ...features, noMelody: true }, level, KEY, ["markerB", "markerA"]).version,
          `${GENERATOR_VERSION}-markerA-markerB-nm`,
          level,
        );
        assert.strictEqual(generateChart(features, level, KEY, ["markerA"]).version, `${GENERATOR_VERSION}-markerA`, level);
        assert.strictEqual(generateChart(features, level, KEY, ["pitchLanes"]).version, GENERATOR_VERSION, level);
      }
    });

    it("changes no note", () => {
      const plain = generateAll(features, KEY);
      const marked = generateAll({ ...features, noMelody: true }, KEY);
      for (const level of LEVELS) assert.deepStrictEqual(marked[level].notes, plain[level].notes, level);
    });
  });

  describe("in the chart store", () => {
    let dir;
    const chartFiles = () => (fs.existsSync(path.join(dir, "charts")) ? fs.readdirSync(path.join(dir, "charts")).sort() : []);
    const melodyFile = () => path.join(dir, "melody", `${audioKeyFile(key)}.json`);
    const plainName = `${audioKeyFile(key)}.v${GENERATOR_VERSION}.json`;
    const markedName = `${audioKeyFile(key)}.v${GENERATOR_VERSION}-nm.json`;
    const decoderOf = (run, extra = {}) => createMelodyDecoder({
      dir, run, log: collectingLog(), audio: { get: async () => "/audio/x.ogg" }, ...extra,
    });
    const writeMelody = (text = JSON.stringify(decoded)) => {
      fs.mkdirSync(path.dirname(melodyFile()), { recursive: true });
      fs.writeFileSync(melodyFile(), text);
    };

    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-nm-")); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it("is stored under its own file name, and the chart made with a melody keeps the plain one", async () => {
      const without = createChartStore({ dir, analysis: fakeAnalysis(), generate: generateAll, log: collectingLog() });
      const first = await without.getCharts(track, "node");
      assert.strictEqual(first.charts.easy.version, `${GENERATOR_VERSION}-nm`);
      assert.deepStrictEqual(chartFiles(), [markedName]);

      fs.rmSync(path.join(dir, "charts"), { recursive: true });
      const withMelody = createChartStore({
        dir, analysis: fakeAnalysis(), generate: generateAll, log: collectingLog(), melodyDecoder: decoderOf(async () => decoded),
      });
      const second = await withMelody.getCharts(track, "node");
      assert.strictEqual(second.charts.easy.version, GENERATOR_VERSION);
      assert.deepStrictEqual(chartFiles(), [plainName]);
    });

    it("is replaced, file and all, once a melody file is there", async () => {
      const earlier = createChartStore({ dir, analysis: fakeAnalysis(), generate: generateAll, log: collectingLog() });
      await earlier.getCharts(track, "node");
      assert.deepStrictEqual(chartFiles(), [markedName]);

      writeMelody();
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate: generateAll, log: collectingLog() });
      const result = await store.getCharts(track, "node");
      assert.strictEqual(result.charts.easy.version, GENERATOR_VERSION);
      assert.deepStrictEqual(chartFiles(), [plainName]);
    });

    it("is found by the summary reader, from memory and from disk", async () => {
      const earlier = createChartStore({ dir, analysis: fakeAnalysis(), generate: generateAll, log: collectingLog() });
      await earlier.getCharts(track, "node");
      assert.ok(earlier.summaryReader()(track));

      const cold = createChartStore({ dir, analysis: fakeAnalysis(), log: collectingLog() });
      assert.deepStrictEqual(Object.keys(cold.summaryReader()(track)), LEVELS);
      assert.strictEqual(cold.peekCharts(track).status, "ready");
      assert.strictEqual(cold.peekCharts(track).charts.easy.version, `${GENERATOR_VERSION}-nm`);
    });

    it("is decoded again after a failure, once the backoff has passed, and then replaced", async () => {
      let clock = 1_000_000;
      let calls = 0;
      let works = false;
      const run = async () => {
        calls += 1;
        if (!works) throw new Error("exit 1");
        return decoded;
      };
      const store = createChartStore({
        dir, analysis: fakeAnalysis(), generate: generateAll, log: collectingLog(), melodyDecoder: decoderOf(run, { now: () => clock }),
      });
      const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, `${GENERATOR_VERSION}-nm`);
      assert.strictEqual(calls, 1);

      // Served from memory, and too soon for a retry: no decode is started.
      assert.strictEqual((await store.getCharts(track, "node")).status, "ready");
      await wait();
      assert.strictEqual(calls, 1);

      works = true;
      clock += 11 * 60 * 1000;
      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, `${GENERATOR_VERSION}-nm`);
      const deadline = Date.now() + 2000;
      while (chartFiles().length > 0 && Date.now() < deadline) await wait(5);
      assert.strictEqual(calls, 2);
      assert.deepStrictEqual(chartFiles(), []);

      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, GENERATOR_VERSION);
      assert.deepStrictEqual(chartFiles(), [plainName]);
    });

    it("sets a melody file that is not JSON aside, warns once and decodes it again", async () => {
      writeMelody("{not json");
      const log = collectingLog();
      let calls = 0;
      const run = async () => { calls += 1; return decoded; };
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate: generateAll, log, melodyDecoder: decoderOf(run) });

      const result = await store.getCharts(track, "node");

      assert.strictEqual(calls, 1);
      assert.strictEqual(result.charts.easy.version, GENERATOR_VERSION);
      assert.strictEqual(log.lines.filter((line) => /unusable/.test(line[0])).length, 1);
      assert.ok(fs.readdirSync(path.dirname(melodyFile())).some((name) => name.includes(".corrupt-")));
      assert.ok(Array.isArray(JSON.parse(fs.readFileSync(melodyFile(), "utf8")).notes));
    });

    it("sets a melody file without notes aside too", async () => {
      writeMelody(JSON.stringify({ version: 1 }));
      const log = collectingLog();
      const run = async () => decoded;
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate: generateAll, log, melodyDecoder: decoderOf(run) });

      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, GENERATOR_VERSION);
      assert.strictEqual(log.lines.filter((line) => /unusable/.test(line[0])).length, 1);
    });

    it("charts without the melody, warns once and does not loop when the melody file cannot be read", async () => {
      // A directory where the file should be: a read error that is not "missing".
      fs.mkdirSync(melodyFile(), { recursive: true });
      const log = collectingLog();
      let generated = 0;
      const generate = (...args) => { generated += 1; return generateAll(...args); };
      const store = createChartStore({ dir, analysis: fakeAnalysis(), generate, log });

      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, `${GENERATOR_VERSION}-nm`);
      assert.strictEqual((await store.getCharts(track, "node")).charts.easy.version, `${GENERATOR_VERSION}-nm`);
      assert.strictEqual(generated, 1);
      assert.strictEqual(log.lines.filter((line) => /could not read a melody file/.test(line[0])).length, 1);
      assert.deepStrictEqual(chartFiles(), [markedName]);
    });
  });
});
