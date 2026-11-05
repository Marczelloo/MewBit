const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { openWithFirstSound } = require("../../../helpers/mewbeat/charts/sections");

// A steady 170 BPM grid as in Hopes And Dreams: beats every 352 ms from 150, quarter points every 88 ms.
const BEATS = Array.from({ length: 40 }, (_, i) => 150 + i * 352);
const timing = {
  snapped: true,
  beats: BEATS,
  medianMs: 352,
  beatMsAt: () => 352,
  gridPoints: (div) => BEATS.flatMap((b) => Array.from({ length: div }, (_, k) => b + (352 * k) / div)),
};
const loud = { at: () => 0.4 };
const diff = { minNoteGapMs: 100, gapBeats: 0.25, firstSound: { strong: 0.8, nearBeats: 1 / 8 } };
const later = [{ t: 678, lane: 3 }, { t: 853, lane: 1 }];

describe("the song opens on its first strong sound (v33)", () => {
  it("is on every level and on normalV26, which Easy is cut from", () => {
    for (const level of [...Object.keys(DIFFICULTIES), "normalV26"]) assert.deepEqual(levelOf(level).firstSound, { strong: 0.8, nearBeats: 1 / 8 }, level);
  });

  it("plays a strong sound a little before the first beat on that beat (Hopes And Dreams 0:00.117)", () => {
    const onsets = [{ t: 117, s: 0.835 }, { t: 331, s: 0.569 }];
    assert.deepEqual(openWithFirstSound(later, onsets, diff, timing, loud).map((n) => n.t), [150, 678, 853]);
  });

  it("skips weak sounds and finds the first strong one", () => {
    const onsets = [{ t: 120, s: 0.3 }, { t: 500, s: 0.9 }];
    assert.deepEqual(openWithFirstSound(later, onsets, diff, timing, loud).map((n) => n.t), [502, 678, 853]);
  });

  it("changes nothing when the chart already plays there or before, the sound is off the grid, or the flag is off", () => {
    const onsets = [{ t: 117, s: 0.9 }];
    assert.equal(openWithFirstSound([{ t: 150, lane: 0 }, ...later], onsets, diff, timing, loud).length, 3);
    assert.equal(openWithFirstSound([{ t: 100, lane: 0 }, ...later], onsets, diff, timing, loud).length, 3);
    assert.equal(openWithFirstSound(later, [{ t: 220, s: 0.9 }], diff, timing, loud), later); // 70 ms after the beat at 150
    assert.equal(openWithFirstSound(later, onsets, { ...diff, firstSound: undefined }, timing, loud), later);
    assert.equal(openWithFirstSound(later, onsets, diff, timing, { at: () => 0.01 }), later);
  });
});
