const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createAnalysisClient } = require("../../../helpers/mewbeat/analysisClient");
const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { GENERATOR_VERSION, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeFeatures } = require("./fixtures");

const silentLog = { warning() {}, error() {}, info() {}, debug() {} };
const SECOND = 1000;
const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000, isStream: false } };

function goodFeatures() {
  return {
    ...makeFeatures(),
    featuresVersion: 4,
    durationMs: track.info.length,
    audio: { sourceName: "youtube", identifier: track.info.identifier, length: track.info.length },
  };
}

// A node whose analyze route answers with `answer.current()`, so a test can change its mind.
function fakeNode(answer) {
  const node = {
    calls: 0,
    rest: {
      post: async () => {
        node.calls += 1;
        return answer.current();
      },
    },
  };
  return node;
}

describe("mewbeat explicit chart retry", () => {
  let dir;
  let clock;
  let analysis;
  let store;
  let answer;
  let node;
  const key = audioKeyOf(track);
  const featuresFile = () => path.join(dir, "features", `${audioKeyFile(key)}.json`);
  // No melody decoder here, so the charts are made without a melody and carry the nm marker.
  const chartsFile = () => path.join(dir, "charts", `${audioKeyFile(key)}.v${GENERATOR_VERSION}-nm.json`);

  function build(generate = generateAll) {
    analysis = createAnalysisClient({ dir, now: () => clock, log: silentLog, busyRetries: 0 });
    store = createChartStore({ dir, analysis, generate, log: silentLog, now: () => clock });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-retry-"));
    clock = 1_000_000;
    answer = { current: () => ({ error: "boom" }) };
    node = fakeNode(answer);
    build();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the block for an ordinary request and lifts it only for a retry", async () => {
    assert.strictEqual((await store.getCharts(track, node)).status, "failed");
    answer.current = () => goodFeatures();

    assert.strictEqual((await store.getCharts(track, node)).status, "failed");
    assert.strictEqual(node.calls, 1);

    clock += 31 * SECOND;
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "ready");
    assert.strictEqual(node.calls, 2);
  });

  it("holds a 30 s cooldown per song and allows the next retry after it", async () => {
    await store.getCharts(track, node); // fails: call 1
    clock += 31 * SECOND;
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "failed"); // call 2

    answer.current = () => goodFeatures();
    clock += 29 * SECOND;
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "failed");
    assert.strictEqual(node.calls, 2);

    clock += 2 * SECOND;
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "ready");
    assert.strictEqual(node.calls, 3);
  });

  it("answers pending, not failed, while the plugin is busy with the retry", async () => {
    await store.getCharts(track, node);
    answer.current = () => ({ error: "busy" });
    clock += 31 * SECOND;
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "pending");
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "pending");
    assert.strictEqual(node.calls, 2);
  });

  it("runs one analysis for repeated clicks made while it is going", async () => {
    await store.getCharts(track, node);
    let release;
    answer.current = () => new Promise((resolve) => {
      release = () => resolve(goodFeatures());
    });
    clock += 31 * SECOND;

    const clicks = [store.getCharts(track, node, { retry: true }), store.getCharts(track, node, { retry: true }), store.getCharts(track, node)];
    // The analysis starts only after the failure is forgotten on disk, which takes longer under load.
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    const results = await Promise.all(clicks);

    assert.deepStrictEqual(results.map((result) => result.status), ["ready", "ready", "ready"]);
    assert.strictEqual(node.calls, 2);
  });

  it("clears an uncharted verdict of the analysis, in memory and on disk, only for a retry", async () => {
    answer.current = () => ({ error: "uncharted", reason: "no_beats" });
    assert.deepStrictEqual(await store.getCharts(track, node), { status: "uncharted", reason: "no_beats" });
    assert.ok(fs.existsSync(featuresFile()));

    answer.current = () => goodFeatures();
    assert.strictEqual((await store.getCharts(track, node)).status, "uncharted");
    assert.strictEqual(node.calls, 1);

    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "ready");
    assert.strictEqual(node.calls, 2);
    assert.strictEqual(JSON.parse(fs.readFileSync(featuresFile(), "utf8")).featuresVersion, 4);
  });

  it("clears an uncharted marker left by the chart store, in memory and on disk", async () => {
    let tooFew = true;
    build((features, audioKey, flags) => (tooFew ? null : generateAll(features, audioKey, flags)));
    answer.current = () => goodFeatures();
    assert.strictEqual((await store.getCharts(track, node)).status, "uncharted");
    assert.strictEqual(JSON.parse(fs.readFileSync(chartsFile(), "utf8")).uncharted, true);

    tooFew = false;
    assert.strictEqual((await store.getCharts(track, node)).status, "uncharted");
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "ready");
    assert.ok(JSON.parse(fs.readFileSync(chartsFile(), "utf8")).easy.notes.length > 0);
  });

  it("never removes charts that exist, nor real features", async () => {
    answer.current = () => goodFeatures();
    assert.strictEqual((await store.getCharts(track, node)).status, "ready");
    const charts = fs.readFileSync(chartsFile(), "utf8");
    const features = fs.readFileSync(featuresFile(), "utf8");

    build();
    assert.strictEqual((await store.getCharts(track, node, { retry: true })).status, "ready");
    assert.strictEqual(node.calls, 1);
    assert.strictEqual(fs.readFileSync(chartsFile(), "utf8"), charts);
    assert.strictEqual(fs.readFileSync(featuresFile(), "utf8"), features);
  });

  it("does not reach the analysis for a track with no audio key", async () => {
    const stream = { track: "S", info: { sourceName: "youtube", identifier: "live", length: 0, isStream: true } };
    assert.strictEqual((await store.getCharts(stream, node, { retry: true })).status, "uncharted");
    assert.strictEqual(node.calls, 0);
  });
});
