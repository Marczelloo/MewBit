const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { holdQuietLone, planChords } = require("../../../helpers/mewbeat/charts/chords");
const { DIFFICULTIES, QUIET_LONE } = require("../../../helpers/mewbeat/charts/difficulty");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

const BEAT_MS = 500; // the fixtures play at 120 BPM
const timing = buildTiming(makeFeatures({ durationMs: 64000 }), 64000);
const context = (level) => ({ features: {}, timing, phrases: [], sections: [], durationMs: 64000, energy: { at: () => level }, eventTimes: [], onsets: [] });
const every = (fromMs, toMs) => Array.from({ length: (toMs - fromMs) / BEAT_MS }, (_, i) => ({ t: fromMs + i * BEAT_MS, lane: 0 }));
// Beats, then one moment 8 beats after them, then beats again 4 beats later.
const notes = () => [...every(2000, 10000), { t: 14000, lane: 0 }, ...every(16000, 24000)];
// Normal that wants a chord on every moment it can.
const chordy = (rule) => ({ ...DIFFICULTIES.normal, chordRates: [10, 10, 10, 10], maxChordShare: undefined, maxChordsPer8Beats: 0, quietLone: rule });
const sizes = (out) => {
  const at = new Map();
  for (const n of out) at.set(n.t, (at.get(n.t) ?? 0) + 1);
  return at;
};

const { hold, ...LONE } = QUIET_LONE; // the rule without its hold
const HOLD = QUIET_LONE;

describe("a lone moment in quiet music (Normal's quietLone)", () => {
  it("plays one note where it would be a chord, and leaves the other moments as they were", () => {
    const plain = sizes(planChords(notes(), context(0.1), chordy(undefined)));
    const lone = sizes(planChords(notes(), context(0.1), chordy(LONE)));
    // 16000 comes 4 beats after the lone tap at 14000, so it is lone as well.
    for (const t of [14000, 16000]) {
      assert.ok(plain.get(t) > 1);
      assert.equal(lone.get(t), 1);
    }
    for (const [t, size] of plain) if (t !== 14000 && t !== 16000) assert.equal(lone.get(t), size, `${t}`);
  });

  it("keeps the chord when the music is loud", () => {
    assert.deepEqual(planChords(notes(), context(0.6), chordy(LONE)), planChords(notes(), context(0.6), chordy(undefined)));
  });

  it("holds the lone note until half a beat before the next moment only with the hold", () => {
    const one = planChords(notes(), context(0.1), chordy(LONE));
    assert.deepEqual(holdQuietLone(one, context(0.1), LONE), one);
    const held = holdQuietLone(one, context(0.1), HOLD).filter((n) => n.len > 0);
    assert.deepEqual(held.map((n) => [n.t, n.len]), [[14000, 16000 - BEAT_MS / 2 - 14000]]);
  });

  it("is Normal's alone", () => {
    assert.deepEqual(DIFFICULTIES.normal.quietLone, QUIET_LONE);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].quietLone, undefined, level);
  });
});
