const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS, withFlags } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { keptHolds, longHolds } = require("../../../helpers/mewbeat/charts/holds");
const { makeLayeredFeatures } = require("./fixtures");

const timing = { beatMsAt: () => 500, gridPoints: () => [] };
const diff = { keepNormalHolds: { minBeats: 2 }, holdMinBeats: 1, minNoteGapMs: 60, minLaneGapMs: 100 };
// Normal holds 1000 for 2 s over nothing of its own, then plays 3500; a short hold at 4000 is not long enough to keep
const source = [{ t: 1000, lane: 0, len: 2000 }, { t: 3500, lane: 1 }, { t: 4000, lane: 2, len: 600 }];

describe("Easy and Hard keep Normal's long holds (flag normalHolds)", () => {
  it("finds the holds of at least minBeats", () => {
    assert.deepEqual(longHolds(source, 2, timing).map((n) => n.t), [1000]);
  });

  it("holds the moment as Normal does, without the moments Normal does not play under it", () => {
    const notes = [{ t: 1000, lane: 2 }, { t: 1500, lane: 1 }, { t: 2250, lane: 3 }, { t: 3500, lane: 0 }];
    assert.deepEqual(keptHolds(notes, source, diff, timing), [{ t: 1000, lane: 2, len: 2000 }, { t: 3500, lane: 0 }]);
  });

  it("lets go before the next moment Normal plays under the hold", () => {
    const under = [...source, { t: 2000, lane: 3 }];
    const notes = [{ t: 1000, lane: 0 }, { t: 2000, lane: 3 }, { t: 3500, lane: 1 }];
    // the gap: a quarter beat (125 ms) over the 100 ms lane gap
    assert.deepEqual(keptHolds(notes, under, diff, timing)[0], { t: 1000, lane: 0, len: 875 });
  });

  it("gives a level that dropped the hold's moment the hold, unless a note of its own is too close before it", () => {
    assert.deepEqual(keptHolds([{ t: 500, lane: 1 }, { t: 3500, lane: 1 }], source, diff, timing), [{ t: 500, lane: 1 }, { t: 1000, lane: 0, len: 2000 }, { t: 3500, lane: 1 }]);
    assert.deepEqual(keptHolds([{ t: 950, lane: 1 }, { t: 3500, lane: 1 }], source, diff, timing), [{ t: 950, lane: 1 }, { t: 3500, lane: 1 }]);
  });

  it("keeps a longer hold of the level's own and never runs past the song", () => {
    assert.equal(keptHolds([{ t: 1000, lane: 0, len: 2400 }], source, diff, timing)[0].len, 2400);
    assert.equal(keptHolds([{ t: 1000, lane: 0 }], source, diff, timing, 2600).find((n) => n.t === 1000).len, 1500);
  });

  it("is off by default and changes Easy and Hard alone", () => {
    assert.ok(FLAGS.normalHolds);
    for (const level of ["easy", "hard"]) assert.equal(DIFFICULTIES[level].keepNormalHolds, undefined);
    for (const level of ["normal", "hell"]) assert.equal(withFlags(levelOf(level), level, { normalHolds: true }), levelOf(level), level);
    for (const bpm of [120, 180]) {
      const features = () => makeLayeredFeatures({ bpm, durationMs: 64000 });
      const base = { hardPlus: true, easyFromNormal: true };
      const off = generateAll(features(), "k", base), on = generateAll(features(), "k", { ...base, normalHolds: true });
      for (const level of ["normal", "hell"]) assert.deepEqual(on[level].notes, off[level].notes, `${bpm} ${level}`);
      const kept = new Set(on.hard.notes.map((n) => n.t));
      assert.deepEqual(on.normal.notes.filter((n) => !kept.has(n.t)), [], `${bpm}: Normal moments missing from Hard`);
    }
  });
});
