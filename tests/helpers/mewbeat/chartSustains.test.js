const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { addGapHolds, addSustainHolds, settleHolds } = require("../../../helpers/mewbeat/charts/holds");
const { assignLanes } = require("../../../helpers/mewbeat/charts/lanes");
const { normalViolations } = require("../../../helpers/mewbeat/charts/laneRules");
const { sustainsOf } = require("../../../helpers/mewbeat/charts/sustains");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

// Normal's long holds follow the dragged notes of the lead and the bass (sustains.js): a hint, so a false one costs a
// hold on a rest and breaks no rule.
const BEAT = 500;
const normal = levelOf("normal");
const beats = Array.from({ length: 33 * 4 + 1 }, (_, i) => i * BEAT);
const grid = { snapped: true, beats, downbeats: beats.filter((_, i) => i % 4 === 0), beatMsAt: () => BEAT, gridPoints: () => [] };
const tap = (t, lane = 0) => ({ t, lane });
const note = (t, len, pitch = 60, conf = 0.5) => ({ t, len, pitch, conf, s: 0.5 });
const loud = { at: () => 0.6 };

describe("sustainsOf", () => {
  it("sustains merge a dragged note", () => {
    // a bowed note the tracker cut in three: two pieces touching, a third after a dropout of 0.6 of a beat
    const lead = [note(1000, 200), note(1200, 100), note(1600, 400)];
    assert.deepEqual(sustainsOf({ lead }, grid), [{ t: 1000, len: 1000, source: "lead", conf: 0.5 }]);
    const different = [note(1000, 200), note(1200, 100), note(1600, 400, 64)];
    assert.deepEqual(sustainsOf({ lead: different }, grid), [], "a different pitch is a new note, and neither piece lasts a beat");
    const far = [note(1000, 200), note(1200, 100), note(2000, 400)];
    assert.deepEqual(sustainsOf({ lead: far }, grid), [], "a dropout of more than 0.7 of a beat ends the note");
  });

  it("a short note is not dragged, and a dragged bass note is reported as the bass's", () => {
    assert.deepEqual(sustainsOf({ lead: [note(0, 400)], bass: [note(2000, 700, 40, 0.3)] }, grid), [{ t: 2000, len: 700, source: "bass", conf: 0.3 }]);
  });

  it("a note never goes on across the start of a phrase", () => {
    const lead = [note(1000, 200), note(1200, 100), note(1600, 400)];
    const phrases = { list: [{ startMs: 0 }, { startMs: 1500 }] };
    assert.equal(sustainsOf({ lead }, grid).length, 1, "control: without the phrase start the pieces are one note");
    assert.deepEqual(sustainsOf({ lead, phrases }, grid), [], "a repeated phrase charts like its source: what comes before it does not count");
  });

  it("a half-written note in a layer is skipped and the rest still glues", () => {
    const lead = [null, note(1000, 200), { t: 1100 }, note(1200, 100), { t: Number.NaN, pitch: 60, len: 900 }, undefined, note(1600, 400)];
    assert.deepEqual(sustainsOf({ lead, bass: [null, { len: 900 }], phrases: { list: [null, { startMs: 5000 }] } }, grid), [{ t: 1000, len: 1000, source: "lead", conf: 0.5 }]);
  });

  it("no melodic layers means no sustains", () => {
    assert.deepEqual(sustainsOf({ lead: [], bass: [] }, grid), []);
    assert.deepEqual(sustainsOf({}, grid), []);
    assert.deepEqual(sustainsOf(null, grid), []);
    assert.deepEqual(sustainsOf({ lead: "none", bass: null }, grid), []);
    assert.deepEqual(sustainsOf({ drums: [{ t: 0, len: 4000 }] }, grid), [], "drums are never dragged notes");
  });
});

describe("a long hold follows a dragged sound", () => {
  const gapNotes = [tap(1000, 0), tap(2000, 3), tap(4000, 1), tap(5000, 2)];
  const holdsOf = (notes) => notes.filter((n) => n.len > 0).map((n) => [n.t, n.len]);

  it("a long hold prefers a sustained sound", () => {
    // two equal rests, room for one hold: the one a lead note is dragged through wins, even if the tracker dates it late
    const dragged = (t, len) => ({ lead: [note(t, len)] });
    assert.deepEqual(holdsOf(addGapHolds(gapNotes, dragged(4100, 900), normal, grid, loud)).map(([t]) => t), [4000]);
    assert.deepEqual(holdsOf(addGapHolds(gapNotes, dragged(1100, 900), normal, grid, loud)).map(([t]) => t), [1000]);
    assert.deepEqual(holdsOf(addGapHolds(gapNotes, {}, normal, grid, loud)).map(([t]) => t), [1000], "nothing dragged: the first");
    const moved = addSustainHolds([tap(1000), tap(2500, 3), tap(4000)], { lead: [note(4120, 1500)] }, normal, grid);
    assert.deepEqual(holdsOf(moved), [[4000, 1620]], "a dragged note turns the tap near its start into a hold");
  });

  it("a hold ends with the sound it follows", () => {
    const [lead] = holdsOf(addGapHolds(gapNotes, { lead: [note(1000, 800)] }, normal, grid, loud));
    assert.deepEqual(lead, [1000, 800], "the lead note lasts 800 ms, the rest is 1000");
    const [late] = holdsOf(addSustainHolds([tap(1000), tap(4000)], { lead: [note(900, 1500)] }, normal, grid));
    assert.deepEqual(late, [1000, 1400], "the sound began 100 ms before the tap: the hold ends where it does");
    const [unheard] = holdsOf(addGapHolds(gapNotes, {}, normal, grid, loud));
    assert.deepEqual(unheard, [1000, 1000], "no dragged note under the tap: the rest, as before");
    const [bass] = holdsOf(addGapHolds(gapNotes, { bass: [note(1000, 950, 40)] }, normal, grid, loud));
    assert.deepEqual(bass, [1000, BEAT], "a bass note is dragged less often than it looks: a beat of it");
    const [both] = holdsOf(addGapHolds(gapNotes, { bass: [note(1000, 950, 40)], lead: [note(1100, 800)] }, normal, grid, loud));
    assert.deepEqual(both, [1000, 900], "a lead note near the tap wins over a bass note that starts on it");
  });

  it("a false sustain still respects the rules", () => {
    // A guard, not a behaviour test: the old code passes it too. It fails if the sustains ever drop a moment or break a rule.
    // a sustain 3 beats long over a quarter-beat stream: nothing is dropped and the chart passes the checker
    const stream = Array.from({ length: 8 }, (_, i) => tap(1250 + i * 250, 3 - (i % 2)));
    const notes = [tap(1000, 0), ...stream, tap(4000, 1)];
    const held = addSustainHolds(notes, { lead: [note(1000, 1500)] }, normal, grid);
    assert.equal(held.length, notes.length, "nothing is dropped");
    const features = { ...makeFeatures({ durationMs: 64000 }), lead: [], bass: [], bands: [] };
    const ctx = { features, timing: buildTiming(features, 64000), phrases: [], sections: [], durationMs: 64000, energy: { at: () => 0.6 }, onsets: [], eventTimes: [] };
    const out = assignLanes(settleHolds(held, normal, grid), ctx, normal);
    assert.deepEqual(normalViolations(out, grid, { durationMs: 64000 }), []);
    assert.equal(out.length, notes.length, "no moment lost");
  });
});
