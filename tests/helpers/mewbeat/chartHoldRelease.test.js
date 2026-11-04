const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { addGapHolds, clipHolds, settleHolds } = require("../../../helpers/mewbeat/charts/holds");
const { accentSections, sectionStarts } = require("../../../helpers/mewbeat/charts/sections");

const BEAT = 500;
// v26's Normal: its holds let go on the next moment. The free holds of the public Normal are in chartHoldsUnder.test.js.
const { easy, hard } = DIFFICULTIES;
const normal = levelOf("normalV26");

function gridOf(bars) {
  const beats = Array.from({ length: bars * 4 + 1 }, (_, i) => i * BEAT);
  return { snapped: true, beats, downbeats: beats.filter((_, i) => i % 4 === 0), beatMsAt: () => BEAT, gridPoints: () => [] };
}
const timing = gridOf(32);
const loud = { at: () => 1 };

describe("settleHolds", () => {
  it("lets a hold go on the next moment, whichever hand plays it", () => {
    const [hold] = settleHolds([{ t: 1000, lane: 0, len: 2000 }, { t: 1500, lane: 3 }], normal, timing);
    assert.equal(hold.len, 500);
  });

  it("moves a lone tap of the holding hand to the other hand", () => {
    const [hold, tap] = settleHolds([{ t: 1000, lane: 0, len: 500 }, { t: 1500, lane: 1 }], normal, timing);
    assert.equal(hold.len, 500);
    assert.equal(tap.lane, 2);
  });

  it("lets go a quarter of a beat early when the note cannot move", () => {
    const notes = [{ t: 1000, lane: 0, len: 1000 }, { t: 2000, lane: 1 }, { t: 2000, lane: 2 }, { t: 2000, lane: 3 }];
    const [hold, ...rest] = settleHolds(notes, normal, timing);
    assert.equal(hold.len, 875);
    assert.deepEqual(rest.map((n) => n.lane), [1, 2, 3]);
  });

  it("a next moment too near makes it a tap with no len key", () => {
    const [hold] = settleHolds([{ t: 1000, lane: 0, len: 2000 }, { t: 1250, lane: 3 }], normal, timing);
    assert.ok(!("len" in hold));
  });

  it("a long hold of Normal or Hard runs over a sparse other hand, Easy's never", () => {
    const notes = [{ t: 1000, lane: 0, len: 2000 }, { t: 1500, lane: 3 }, { t: 3000, lane: 3 }];
    assert.equal(settleHolds(notes, normal, timing)[0].len, 2000);
    assert.equal(settleHolds(notes, hard, timing)[0].len, 2000);
    assert.equal(settleHolds(notes, easy, timing)[0].len, 500);
  });

  it("a long hold over a dense other hand lets go on the next moment", () => {
    const dense = Array.from({ length: 8 }, (_, i) => ({ t: 1250 + i * 250, lane: 3 - (i % 2) }));
    assert.ok(!("len" in settleHolds([{ t: 1000, lane: 0, len: 2000 }, ...dense], normal, timing)[0]));
  });

  it("with no moment in reach a hold keeps its length, inside the song", () => {
    assert.equal(settleHolds([{ t: 1000, lane: 0, len: 1000 }], normal, timing)[0].len, 1000);
    assert.equal(settleHolds([{ t: 1000, lane: 0, len: 1000 }], normal, timing, 1650)[0].len, 500);
  });

  it("does not change its input", () => {
    const notes = [{ t: 1000, lane: 0, len: 500 }, { t: 1500, lane: 1 }];
    settleHolds(notes, normal, timing);
    assert.deepEqual(notes, [{ t: 1000, lane: 0, len: 500 }, { t: 1500, lane: 1 }]);
  });
});

describe("clipHolds", () => {
  it("shortens a hold that keeps its minimum, and makes the others taps", () => {
    assert.deepEqual(clipHolds([{ t: 1000, lane: 0, len: 1000 }], 1650, normal, timing), [{ t: 1000, lane: 0, len: 500 }]);
    assert.deepEqual(clipHolds([{ t: 1000, lane: 0, len: 1000 }], 1500, normal, timing), [{ t: 1000, lane: 0 }]);
  });
});

describe("addGapHolds", () => {
  const taps = Array.from({ length: 10 }, (_, i) => ({ t: 1000 + i * 1000, lane: i % 4 }));
  const held = (notes) => notes.filter((n) => n.len > 0);

  it("holds a tap until the next moment, where a long bass note starts first", () => {
    const features = { bass: [{ t: 5000, len: 800 }] };
    const holds = held(addGapHolds(taps, features, normal, timing, loud));
    assert.deepEqual(holds.map((n) => [n.t, n.len]), [[5000, 1000]]);
  });

  it("stays a tap where the music is quiet", () => {
    assert.deepEqual(held(addGapHolds(taps, {}, normal, timing, { at: () => 0.1 })), []);
  });

  it("the notes before fromMs are context: they get no hold and count for no budget", () => {
    const holds = held(addGapHolds(taps, {}, { ...normal, gapHoldShare: 0.5 }, timing, loud, Infinity, 8000));
    assert.ok(holds.length > 0);
    assert.ok(holds.every((n) => n.t >= 8000));
  });

  it("a rest of more than two beats is a pause, not a held note", () => {
    const apart = Array.from({ length: 10 }, (_, i) => ({ t: 1000 + i * 1500, lane: i % 4 }));
    assert.deepEqual(held(addGapHolds(apart, {}, normal, timing, loud)), []);
  });

  it("no hold in a chord on Easy", () => {
    const chord = [{ t: 1000, lane: 0 }, { t: 1000, lane: 3 }, ...taps.slice(1)];
    assert.ok(held(addGapHolds(chord, {}, { ...easy, gapHoldShare: 1 }, timing, loud)).every((n) => n.t !== 1000));
  });
});

describe("sectionStarts", () => {
  const change = 16 * 4 * BEAT; // bar 16
  const energy = { at: (t) => (t < change ? 0.3 : 0.9) };
  const features = { bands: [] };

  it("finds the downbeat where the music changes and how much louder it got", () => {
    const sections = sectionStarts(features, timing, energy);
    const found = sections.find((s) => s.t === change);
    assert.ok(found, JSON.stringify(sections));
    assert.ok(found.rise > 2, String(found.rise));
    assert.equal(sections.filter((s) => Math.abs(s.t - change) < 4 * 4 * BEAT).length, 1);
  });

  it("finds nothing without a grid, or in a song too short to compare bars", () => {
    assert.deepEqual(sectionStarts(features, { ...timing, snapped: false }, energy), []);
    assert.deepEqual(sectionStarts(features, gridOf(10), energy), []);
  });

  it("finds nothing in music that does not change", () => {
    assert.deepEqual(sectionStarts(features, timing, { at: () => 0.5 }), []);
  });
});

describe("accentSections", () => {
  const sections = [{ t: 4000, rise: 2 }];
  const notes = [{ t: 3000, lane: 0 }, { t: 3950, lane: 1 }, { t: 5000, lane: 2 }];
  const at = (out, t) => out.filter((n) => n.t === t);

  it("opens a louder section on a moment; what stands too near gives way", () => {
    const out = accentSections(notes, sections, normal, timing, loud);
    assert.equal(at(out, 4000).length, 1);
    assert.equal(at(out, 3950).length, 0);
    assert.equal(at(out, 3000).length, 1);
  });

  it("a section no louder than the last opens on one note", () => {
    const out = accentSections(notes, [{ t: 4000, rise: 0.5 }], normal, timing, loud);
    assert.equal(at(out, 4000).length, 1);
  });

  it("a note already there is kept", () => {
    const out = accentSections([{ t: 4000, lane: 1 }], sections, normal, timing, loud);
    assert.deepEqual(at(out, 4000).map((n) => n.lane), [1]);
  });

  it("Easy adds no chord to the head of a hold", () => {
    const out = accentSections([{ t: 4000, lane: 1, len: 500 }], sections, easy, timing, loud);
    assert.equal(at(out, 4000).length, 1);
  });

  it("skips the lead-in and silence", () => {
    assert.deepEqual(accentSections([], [{ t: 500, rise: 2 }], normal, timing, loud), []);
    assert.deepEqual(accentSections([], sections, normal, timing, { at: () => 0 }), []);
  });

  it("keeps the density cap: no chord where it is full", () => {
    const full = Array.from({ length: 8 }, (_, i) => ({ t: 2600 + i * 300, lane: i % 4 }));
    const diff = { ...easy, maxNps: 3, sectionChordRise: 1 };
    const out = accentSections(full, sections, diff, timing, loud);
    assert.equal(at(out, 4000).length, 1);
    for (const from of out.map((n) => n.t)) assert.ok(out.filter((n) => n.t >= from && n.t < from + 2000).length <= 6);
  });
});
