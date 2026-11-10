const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeFeatures } = require("./fixtures");

const quietLog = { warning() {} };

const trackOf = (identifier) => ({ track: "ENCODED", info: { sourceName: "youtube", identifier, length: 180000, isStream: false } });

// The store reads files before it asks the analysis, so tests wait for the call instead of a tick.
async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "timed out waiting");
}

// An analysis client whose getFeatures waits until `release(identifier)` is called.
function heldAnalysis({ cached = new Set() } = {}) {
  const waiting = new Map();
  const calls = [];
  const promoted = [];
  return {
    calls,
    promoted,
    // Resolves once the store has asked for the song, then lets the analysis answer.
    release: async (identifier) => { await until(() => waiting.has(identifier)); waiting.get(identifier)(makeFeatures()); },
    asked: (count) => until(() => calls.length >= count),
    getFeatures: (track, node, options) => {
      calls.push({ identifier: track.info.identifier, node, options });
      return new Promise((resolve) => waiting.set(track.info.identifier, resolve));
    },
    statusOf: () => null,
    hasFeatures: (track) => cached.has(track.info.identifier),
    promote: (track) => { promoted.push(track.info.identifier); return true; },
  };
}

describe("mewbeat chart store: background charting", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-bg-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const makeStore = (analysis, options) => createChartStore({ dir, analysis, generate: generateAll, log: quietLog, ...options });

  it("asks the analysis for a background request with the background priority", async () => {
    const analysis = heldAnalysis();
    const store = makeStore(analysis);
    const request = store.getCharts(trackOf("a"), "node", { priority: "background" });
    await analysis.asked(1);
    assert.deepStrictEqual(analysis.calls[0].options, { priority: "background" });
    await analysis.release("a");
    assert.strictEqual((await request).status, "ready");
  });

  it("does not chart a background song twice", async () => {
    const analysis = heldAnalysis();
    const store = makeStore(analysis);
    const first = store.getCharts(trackOf("a"), "node", { priority: "background" });
    const second = store.getCharts(trackOf("a"), "node", { priority: "background" });
    assert.strictEqual(first, second);
    await analysis.asked(1);
    assert.strictEqual(analysis.calls.length, 1);
    await analysis.release("a");
    await first;
  });

  it("refuses background songs beyond the cap with status full, and takes play requests", async () => {
    const analysis = heldAnalysis();
    const store = makeStore(analysis, { backgroundCap: 2 });
    const one = store.getCharts(trackOf("a"), "node", { priority: "background" });
    const two = store.getCharts(trackOf("b"), "node", { priority: "background" });
    assert.deepStrictEqual(await store.getCharts(trackOf("c"), "node", { priority: "background" }), { status: "full" });
    const play = store.getCharts(trackOf("c"), "node");
    await analysis.asked(3);
    assert.deepStrictEqual(analysis.calls.map((call) => call.identifier).sort(), ["a", "b", "c"], "the refused song was not asked for as background; the play request was");
    for (const identifier of ["a", "b", "c"]) await analysis.release(identifier);
    await Promise.all([one, two, play]);
    // The cap counts songs being charted: a finished one frees its place.
    const again = store.getCharts(trackOf("d"), "node", { priority: "background" });
    await analysis.asked(1);
    await analysis.release("d");
    assert.strictEqual((await again).status, "ready");
  });

  it("moves a background song to the play line when a player asks for it", async () => {
    const analysis = heldAnalysis();
    const store = makeStore(analysis);
    const background = store.getCharts(trackOf("a"), "node", { priority: "background" });
    const play = store.getCharts(trackOf("a"), "node");
    assert.strictEqual(background, play);
    assert.deepStrictEqual(analysis.promoted, ["a"]);
    // Once promoted it is play work and no longer counts against the background cap.
    store.getCharts(trackOf("a"), "node");
    assert.deepStrictEqual(analysis.promoted, ["a"], "promoted once");
    await analysis.release("a");
    await play;
  });

  it("charts from cached features only when offline, with no melody decode", async () => {
    const decodes = [];
    const analysis = heldAnalysis({ cached: new Set(["a"]) });
    const melodyDecoder = { has: () => false, ensure: async (...args) => { decodes.push(args); return "decoded"; }, promote() {} };
    const store = makeStore(analysis, { melodyDecoder });
    const request = store.getCharts(trackOf("a"), null, { priority: "background", offline: true });
    await analysis.asked(1);
    assert.strictEqual(analysis.calls[0].node, null);
    await analysis.release("a");
    assert.strictEqual((await request).status, "ready");
    assert.strictEqual(decodes.length, 0);
  });

  describe("rechartBlock", () => {
    it("says why a song is not charted offline", async () => {
      const analysis = heldAnalysis({ cached: new Set(["with"]) });
      const store = makeStore(analysis);
      assert.strictEqual(store.rechartBlock({ info: { isStream: true } }), "no_key");
      assert.strictEqual(store.rechartBlock(trackOf("without")), "no_features");
      assert.strictEqual(store.rechartBlock(trackOf("with")), null);

      const request = store.getCharts(trackOf("with"), null, { priority: "background", offline: true });
      await analysis.asked(1);
      await analysis.release("with");
      await request;
      assert.strictEqual(store.rechartBlock(trackOf("with")), "has_charts");
    });

    it("leaves a song whose melody was never decoded for a real play", () => {
      const analysis = heldAnalysis({ cached: new Set(["with", "decoded"]) });
      const melodyDecoder = { has: (key) => key.includes(":decoded:"), ensure: async () => "decoded", promote() {} };
      const store = makeStore(analysis, { melodyDecoder });
      assert.strictEqual(store.rechartBlock(trackOf("with")), "no_melody");
      assert.strictEqual(store.rechartBlock(trackOf("decoded")), null);
    });
  });
});
