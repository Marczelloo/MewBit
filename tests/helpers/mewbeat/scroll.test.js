const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { scrollMap } = require("../../../helpers/mewbeat/charts/scroll");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

// 120 bpm: a beat is 500 ms. Three 8-second phrases: calm (a note a beat), busy (four a beat), calm again.
const features = makeFeatures({ durationMs: 24000 });
const timing = buildTiming(features, features.durationMs);
const phrases = [
  { startMs: 0, endMs: 8000 },
  { startMs: 8000, endMs: 16000 },
  { startMs: 16000, endMs: 24000 },
];
const every = (from, to, step) => Array.from({ length: (to - from) / step }, (_, k) => ({ t: from + k * step, lane: k % 4 }));
const notes = [...every(0, 8000, 500), ...every(8000, 16000, 125), ...every(16000, 24000, 500)];
const ctx = { timing, phrases };
const at = (points, t) => {
  if (t <= points[0].t) return points[0].x;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    if (t <= b.t) return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t || 1);
  }
  return points[points.length - 1].x;
};

describe("scrollMap", () => {
  it("scrolls a busy phrase faster than a calm one, within the difficulty's bounds", () => {
    const points = scrollMap(notes, ctx, DIFFICULTIES.hard);
    assert.ok(points, "a scroll map");
    assert.ok(at(points, 12000) > at(points, 4000), JSON.stringify(points));
    assert.ok(at(points, 12000) > at(points, 20000), JSON.stringify(points));
    for (const p of points) assert.ok(p.x >= 0.8 && p.x <= 1.1, JSON.stringify(points));
  });

  it("starts a change on the phrase's beat and ramps over one beat", () => {
    const points = scrollMap(notes, ctx, DIFFICULTIES.hard);
    assert.equal(points[0].t, 0);
    const change = points.findIndex((p) => p.t === 8000);
    assert.ok(change > 0, JSON.stringify(points));
    assert.equal(points[change + 1].t, 8500);
  });

  it("keeps one speed on Easy, for a single phrase and for an even chart", () => {
    assert.equal(scrollMap(notes, ctx, DIFFICULTIES.easy), null);
    assert.equal(scrollMap(notes, { timing, phrases: [phrases[0]] }, DIFFICULTIES.hard), null);
    assert.equal(scrollMap(every(0, 24000, 500), ctx, DIFFICULTIES.hard), null);
  });

  it("lets a phrase with no note keep the speed before it", () => {
    const gap = [...every(0, 8000, 500), ...every(16000, 24000, 125)];
    const points = scrollMap(gap, ctx, DIFFICULTIES.hard);
    assert.ok(points.every((p) => p.t < 8000 || p.t >= 16000), JSON.stringify(points));
  });
});
