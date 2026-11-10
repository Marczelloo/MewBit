const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createRechart } = require("../../../helpers/mewbeat/rechart");

const KEYS = ["youtube:a:1000", "youtube:b:2000", "youtube:c:3000", "youtube:d:4000", "youtube:e:5000"];

function setup({ blocks = {}, perStart = 100, songs = KEYS, failing = new Set() } = {}) {
  const calls = [];
  const lines = [];
  const timers = [];
  const chartStore = {
    rechartBlock: (track) => blocks[`${track.info.sourceName}:${track.info.identifier}:${track.info.length}`] ?? null,
    getCharts: async (track, node, options) => {
      const key = `${track.info.sourceName}:${track.info.identifier}:${track.info.length}`;
      calls.push({ key, node, options });
      if (failing.has(key)) throw new Error("boom");
      return { status: "ready" };
    },
  };
  const state = { songs };
  const historyStore = { played: () => state.songs.map((audioKey) => ({ audioKey })) };
  const rechart = createRechart({
    historyStore,
    chartStore,
    perStart,
    startDelayMs: 1000,
    setTimer: (run, ms) => { const timer = { run, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
    log: { info: (...args) => lines.push(args.join(" ")), warning: () => {} },
  });
  return { rechart, calls, lines, timers, state };
}

describe("background re-chart", () => {
  it("starts nothing before start() and waits for the delay after it", async () => {
    const { rechart, calls, timers } = setup();
    assert.strictEqual(timers.length, 0, "no timer before start");
    const done = rechart.start();
    assert.strictEqual(timers.length, 1);
    assert.strictEqual(timers[0].ms, 1000);
    assert.strictEqual(calls.length, 0, "nothing is charted before the delay is over");
    timers[0].run();
    await done;
    assert.strictEqual(calls.length, KEYS.length);
  });

  it("charts missing songs offline at background priority, one after the other, and skips the rest", async () => {
    const { rechart, calls, lines, timers } = setup({
      blocks: { [KEYS[0]]: "has_charts", [KEYS[1]]: "no_features", [KEYS[2]]: "uncharted" },
    });
    const done = rechart.start();
    timers[0].run();
    const counts = await done;
    assert.deepStrictEqual(calls.map((call) => call.key), [KEYS[3], KEYS[4]], "songs without cached features and charted ones are skipped");
    for (const call of calls) {
      assert.strictEqual(call.node, null, "no node: nothing reaches Lavalink");
      assert.deepStrictEqual(call.options, { priority: "background", offline: true });
    }
    assert.deepStrictEqual(counts, { songs: 5, charted: 2, hadCharts: 1, noFeatures: 1, noMelody: 0, other: 1, failed: 0, left: 0 });
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /mewbeat re-chart/);
    assert.match(lines[0], /no cached analysis 1/);
  });

  it("respects the cap per start and reports what is left", async () => {
    const { rechart, calls, timers } = setup({ perStart: 2 });
    const done = rechart.start();
    timers[0].run();
    const counts = await done;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(counts.charted, 2);
    assert.strictEqual(counts.left, 3);
  });

  it("counts a song that throws as failed and goes on", async () => {
    const { rechart, calls, timers } = setup({ failing: new Set([KEYS[0]]) });
    const done = rechart.start();
    timers[0].run();
    const counts = await done;
    assert.strictEqual(calls.length, KEYS.length);
    assert.strictEqual(counts.failed, 1);
    assert.strictEqual(counts.charted, KEYS.length - 1);
  });

  it("looks at an empty history again later, then charts what has arrived", async () => {
    const { rechart, calls, timers, state } = setup({ songs: [] });
    const done = rechart.start();
    timers[0].run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(timers.length, 2, "an empty history waits for another look");
    state.songs = [KEYS[0]];
    timers[1].run();
    const counts = await done;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(counts.charted, 1);
  });

  it("does nothing after stop()", async () => {
    const { rechart, calls, timers } = setup();
    const done = rechart.start();
    rechart.stop();
    assert.strictEqual(timers[0].cleared, true);
    timers[0].run();
    await done;
    assert.strictEqual(calls.length, 0);
  });
});
