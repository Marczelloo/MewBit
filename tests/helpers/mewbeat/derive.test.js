const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { deriveNotes } = require("../../../helpers/mewbeat/charts/derive");
const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

// 120 bpm: a beat is 500 ms. A calm phrase (below Normal's quarter-note energy) whose Hard notes between two beats
// and a later one are all on quarter beats: thinned to its beats and halves, Normal would rest for 7 beats.
const base = makeFeatures({ durationMs: 20000 });
const timing = buildTiming(base, base.durationMs);
const BEAT_MS = 500;
const quarters = [1125, 1625, 2125, 2625, 3125]; // beat 2.25, 3.25, ...: quarter beats
const hard = [
  { t: 0, lane: 0 },
  { t: 500, lane: 1 },
  ...quarters.map((t, k) => ({ t, lane: [2, 3, 1, 0, 2][k] })),
  { t: 4000, lane: 2 },
];
const ctxOf = (energy, leaders = ["drums"]) => ({ phrases: [{ startMs: 0, endMs: 8000, energy }], leaders, timing, energy: { at: () => energy } });
const options = (more = {}) => ({ copyRepeat: () => null, steadyPulse: () => false, ...more });
const longestRest = (notes) => Math.max(...notes.slice(1).map((n, k) => n.t - notes[k].t - (notes[k].len ?? 0)));

describe("deriveNotes", () => {
  it("gives a long rest Hard's notes back where the music plays on", () => {
    const normal = deriveNotes(ctxOf(0.4), hard, DIFFICULTIES.normal, options());
    const hardTimes = new Set(hard.map((n) => n.t));
    assert.ok(normal.every((n) => hardTimes.has(n.t)), normal.map((n) => n.t).join());
    assert.ok(normal.some((n) => quarters.includes(n.t)));
    assert.ok(longestRest(normal) < DIFFICULTIES.normal.fillRestBeats * BEAT_MS, normal.map((n) => n.t).join());
  });

  it("lets a quiet passage rest", () => {
    const normal = deriveNotes(ctxOf(0.1), hard, DIFFICULTIES.normal, options());
    assert.ok(!normal.some((n) => quarters.includes(n.t)), normal.map((n) => n.t).join());
  });

  it("keeps the quarter notes of the leading sung line in a calm phrase", () => {
    const noFill = { ...DIFFICULTIES.normal, fillRestBeats: null };
    const layerOf = (t) => (quarters.includes(t) ? "lead" : null);
    const sung = deriveNotes(ctxOf(0.4, ["lead"]), hard, noFill, options({ layerOf }));
    assert.ok(quarters.filter((t) => sung.some((n) => n.t === t)).length >= 3, sung.map((n) => n.t).join());
    const plain = deriveNotes(ctxOf(0.4, ["lead"]), hard, noFill, options());
    assert.ok(!plain.some((n) => quarters.includes(n.t)), plain.map((n) => n.t).join());
  });
});
