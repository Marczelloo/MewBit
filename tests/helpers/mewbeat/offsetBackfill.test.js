const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createOffsetBackfill } = require("../../../helpers/mewbeat/offsetBackfill");

const STEMS = ["aaaaaaaa11", "bbbbbbbb22", "cccccccc33", "dddddddd44", "eeeeeeee55"];

function setup({ stems = STEMS, configured = true, statuses = {}, perStart = 100 } = {}) {
  const calls = [];
  const lines = [];
  const timers = [];
  const audioOffset = {
    configured: () => configured,
    stemsOnDisk: async () => stems,
    ensureStem: async (stem, options) => {
      calls.push({ stem, options });
      const status = statuses[stem] ?? "measured";
      return { status, offsetMs: status === "measured" || status === "present" ? 20 : null, confidence: 0.9 };
    },
  };
  const backfill = createOffsetBackfill({
    audioOffset,
    perStart,
    startDelayMs: 1000,
    setTimer: (run, ms) => { const timer = { run, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
    log: { info: (...args) => lines.push(args.join(" ")), warning: () => {} },
  });
  return { backfill, calls, lines, timers };
}

describe("audio offset backfill", () => {
  it("starts nothing before start() and waits for the delay after it", async () => {
    const { backfill, calls, timers } = setup();
    assert.strictEqual(timers.length, 0);
    const done = backfill.start();
    assert.strictEqual(timers.length, 1);
    assert.strictEqual(timers[0].ms, 1000);
    assert.strictEqual(calls.length, 0);
    timers[0].run();
    const counts = await done;
    assert.strictEqual(counts.measured, 5);
  });

  it("asks for every audio file one at a time at background priority", async () => {
    const { backfill, calls, timers, lines } = setup();
    const done = backfill.start();
    timers[0].run();
    await done;
    assert.deepStrictEqual(calls.map((call) => call.stem), STEMS);
    assert.ok(calls.every((call) => call.options.priority === "background"));
    assert.strictEqual(lines.length, 1);
  });

  it("counts present, unknown, missing features and failures", async () => {
    const { backfill, timers } = setup({ statuses: { aaaaaaaa11: "present", bbbbbbbb22: "no_features", cccccccc33: "failed", dddddddd44: "no_audio" } });
    const done = backfill.start();
    timers[0].run();
    const counts = await done;
    assert.strictEqual(counts.present, 1);
    assert.strictEqual(counts.measured, 1);
    assert.strictEqual(counts.noFeatures, 2);
    assert.strictEqual(counts.failed, 1);
  });

  it("does nothing, and logs nothing, when no decoder service is configured", async () => {
    const { backfill, calls, timers, lines } = setup({ configured: false });
    const done = backfill.start();
    timers[0].run();
    assert.strictEqual(await done, null);
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(lines, []);
  });

  it("ends the pass at the first answer from a service that is down", async () => {
    const { backfill, calls, timers } = setup({ statuses: { bbbbbbbb22: "off" } });
    const done = backfill.start();
    timers[0].run();
    const counts = await done;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(counts.stoppedEarly, true);
    assert.strictEqual(counts.left, 4);
  });

  it("measures at most perStart songs per start", async () => {
    const { backfill, calls, timers } = setup({ perStart: 2 });
    const done = backfill.start();
    timers[0].run();
    const counts = await done;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(counts.left, 3);
  });

  it("stop() before the delay cancels the timer; calling start() twice starts one pass", async () => {
    const { backfill, timers } = setup();
    const first = backfill.start();
    assert.strictEqual(backfill.start(), first);
    assert.strictEqual(timers.length, 1);
    backfill.stop();
    assert.strictEqual(timers[0].cleared, true);
  });
});
