const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, MAX_SNAP_DISTANCE_MS, MELODY_SNAP } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { withMelodySnap } = require("../../../helpers/mewbeat/charts/melodyPick");
const { farMoments, snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const notesOf = (features, flags) => generateAll(features, "k", flags).normal.notes;
const timesOf = (notes) => [...new Set(notes.map((n) => n.t))];
const withLine = (features, line) => ({ ...features, decodedMelody: line, decodedMelodyTuned: line });

const noLevelHas = (param) => {
  for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level[param], undefined, param);
};

// 100 BPM, a sixteenth is 150 ms. The sounds on sixteenths 1 and 2 of each beat come `late` ms after the grid point, the ones on
// sixteenth 3 `later` ms after it; the ones on the beat stay on the grid.
const SIXTEENTH = 150;
const offGrid = (late, later) => {
  const base = makeLayeredFeatures({ bpm: 100 });
  const move = (e) => {
    const by = [0, late, late, later][Math.floor(e.t / SIXTEENTH) % 4];
    return by ? { ...e, t: e.t + by } : e;
  };
  return { ...base, bands: base.bands.map((b) => ({ ...b, onsets: b.onsets.map(move) })), drums: base.drums.map(move), bass: base.bass.map(move), lead: base.lead.map(move) };
};

describe("a sound on a melody note may reach the grid from further away (flag melodySnap)", () => {
  it("is a flag of Normal, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.melodySnap.levels, { normal: { melodySnap: MELODY_SNAP } });
    noLevelHas("melodySnap");
  });

  it("farMoments gives the sounds snappedMoments drops for their distance, at their grid point with raw kept", () => {
    const ctx = analyse(offGrid(45, 70));
    const snapped = snappedMoments(ctx, "normal");
    const far = farMoments(ctx, "normal", null, MELODY_SNAP.maxMs);
    assert.ok(far.length > 100);
    for (const m of far) {
      assert.equal(m.t % SIXTEENTH, 0);
      assert.equal(m.raw - m.t, 45); // the ones 70 ms off are over maxMs
      assert.ok(Math.abs(m.raw - m.t) > MAX_SNAP_DISTANCE_MS);
      assert.ok(["metric", "down", "score", "s"].every((k) => k in m));
    }
    // the sounds on the beat are all snappedMoments keeps, and calling farMoments leaves what it returns alone
    assert.ok(snapped.every((m) => Math.abs((m.raw ?? m.t) - m.t) <= MAX_SNAP_DISTANCE_MS));
    assert.equal(snappedMoments(ctx, "normal"), snapped);
    assert.equal(farMoments(ctx, "normal", null, MELODY_SNAP.maxMs), far);
    assert.deepEqual(farMoments(ctx, "normal", null, 40), []); // 45 ms is over a 40 ms reach
    assert.equal(farMoments(ctx, "normal", null, 80).length, far.length + 106); // and 70 ms is within an 80 ms one
    assert.deepEqual(farMoments({ timing: { snapped: false } }, "normal", null, 60), []);
  });

  it("withMelodySnap offers one on a melody note, leaves one that is not, one over a held grid point, and the weaker of two", () => {
    const scored = [{ t: 0, score: 1 }, { t: 300, score: 1 }, { t: 900, score: 1 }];
    const far = [
      { t: 150, raw: 195, score: -1 }, // on a melody note
      { t: 450, raw: 495, score: -1 }, // no melody note there
      { t: 600, raw: 555, score: -1 }, // a melody note 3 ms away, and
      { t: 600, raw: 645, score: 0.5 }, // another that scores more
      { t: 900, raw: 945, score: 2 }, // its grid point holds a moment already
    ];
    const melody = [{ t: 198 }, { t: 560 }, { t: 640 }, { t: 940 }];
    const offered = withMelodySnap(scored, far, melody);
    assert.deepEqual(offered.map((m) => m.t), [0, 150, 300, 600, 900]);
    assert.deepEqual(offered.filter((m) => m.raw).map((m) => [m.t, m.raw]), [[150, 195], [600, 645]]);
    assert.equal(withMelodySnap(scored, far, []), scored);
    assert.equal(withMelodySnap(scored, [], melody), scored);
    assert.equal(withMelodySnap(scored, far, [{ t: 3000 }]), scored);
  });

  it("plays the sounds of a fast melody that lie 45 ms off the grid, and none of them without the melody on them", () => {
    const features = offGrid(45, 70);
    const far = farMoments(analyse(features), "normal", null, MELODY_SNAP.maxMs);
    const farPoints = new Set(far.map((m) => m.t));
    const played = (notes) => timesOf(notes).filter((t) => farPoints.has(t)).length;
    const on = withLine(features, far.map((m) => ({ t: m.raw, pitch: 60 + (m.t % 5) })));
    const without = notesOf(on), snapped = notesOf(on, ["melodySnap"]);
    assert.equal(played(without), 0);
    assert.ok(played(snapped) > 20, `${played(snapped)} moments`);
    // a melody on other sounds, or none, takes nothing in
    const elsewhere = withLine(features, far.map((m) => ({ t: m.raw + 75, pitch: 60 })));
    assert.deepEqual(notesOf(elsewhere, ["melodySnap"]), notesOf(elsewhere));
    assert.deepEqual(notesOf(features, ["melodySnap"]), notesOf(features));
    const onGrid = withLine(features, snappedMoments(analyse(features), "normal").map((m) => ({ t: m.t, pitch: 60 })));
    assert.deepEqual(notesOf(onGrid, ["melodySnap"]), notesOf(onGrid));
  });
});
