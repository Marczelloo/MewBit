const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FAST_RUNS, INTERNAL_LEVELS, MAX_SNAP_DISTANCE_MS, MELODY_RUNS, MELODY_SNAP } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { withMelodySnap } = require("../../../helpers/mewbeat/charts/melodyPick");
const { farMoments, snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const notesOf = (features, flags) => generateAll(features, "k", flags).normal.notes;
const timesOf = (notes) => [...new Set(notes.map((n) => n.t))];
const gapsOf = (notes) => timesOf(notes).map((t, i, all) => t - all[i - 1]).slice(1);
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

describe("the bursts of a fast melody where a quarter beat is under 100 ms (flag fastRuns)", () => {
  // A melody on every sixteenth of the song, which is fast at any tempo: every moment on it may start a burst.
  const fastLine = (bpm) => {
    const sixteenth = 60000 / bpm / 4;
    return Array.from({ length: Math.floor(120000 / sixteenth) }, (_, i) => ({ t: Math.round(i * sixteenth), pitch: 60 + ((i * 7) % 9) }));
  };
  const song = (bpm) => withLine(makeLayeredFeatures({ bpm, durationMs: 128000 }), fastLine(bpm));
  const chains = (notes) => {
    const times = timesOf(notes);
    const out = [];
    for (let i = 0, start = 0; i < times.length; i++) {
      if (i > 0 && times[i] - times[i - 1] >= MELODY_RUNS.minGapMs) start = i;
      (out[start] ??= []).push(times[i]);
    }
    return out.filter(Boolean);
  };

  it("is a flag of Normal, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.fastRuns.levels, { normal: { fastRuns: FAST_RUNS } });
    noLevelHas("fastRuns");
  });

  it("puts bursts at 180 BPM (a quarter beat is 83 ms) that the plain generator cannot", () => {
    const features = song(180);
    const plain = notesOf(features), fast = notesOf(features, ["fastRuns"]);
    assert.ok(gapsOf(plain).every((g) => g >= MELODY_RUNS.minGapMs));
    const short = gapsOf(fast).filter((g) => g < MELODY_RUNS.minGapMs);
    assert.ok(short.length > 20, `${short.length} short gaps`);
    assert.ok(Math.min(...gapsOf(fast)) >= FAST_RUNS.minGapMs);
    // a burst is at most maxRun short gaps (maxRun + 1 moments); its notes sit on different lanes, a lane coming back only
    // after the lane gap (a burst of four notes spans 250 ms)
    const laneGap = DIFFICULTIES.normal.minLaneGapMs;
    for (const chain of chains(fast)) {
      assert.ok(chain.length <= MELODY_RUNS.maxRun + 1, `${chain.length} moments in a row`);
      const inChain = fast.filter((n) => chain.includes(n.t));
      for (const a of inChain) {
        for (const b of inChain) if (a !== b && a.lane === b.lane) assert.ok(Math.abs(a.t - b.t) >= laneGap, `lane ${a.lane} at ${a.t} and ${b.t}`);
      }
      for (let i = 1; i < chain.length; i++) {
        const before = new Set(fast.filter((n) => n.t === chain[i - 1]).map((n) => n.lane));
        assert.ok(fast.filter((n) => n.t === chain[i]).every((n) => !before.has(n.lane)), `a lane repeated at ${chain[i]}`);
      }
    }
    assert.ok(chains(fast).some((chain) => chain.length >= 3), "no burst of three moments");
    // everything the plain chart plays is still there but for what the bursts displace
    const kept = new Set(timesOf(fast));
    assert.ok(timesOf(plain).filter((t) => kept.has(t)).length > 0.9 * timesOf(plain).length);
  });

  it("changes nothing where a quarter beat is over 100 ms (120 BPM)", () => {
    const features = song(120);
    assert.deepEqual(notesOf(features, ["fastRuns"]), notesOf(features));
    assert.ok(timesOf(notesOf(features)).length > 100);
  });

  it("changes nothing without a decoded melody, for either flag", () => {
    for (const bpm of [180, 120]) {
      const features = makeLayeredFeatures({ bpm, durationMs: 128000 });
      for (const flag of ["fastRuns", "melodySnap"]) assert.deepEqual(notesOf(features, [flag]), notesOf(features), `${flag} at ${bpm}`);
    }
  });

  it("is a no-op for the floors without melodyRuns", () => {
    const saved = DIFFICULTIES.normal.melodyRuns;
    DIFFICULTIES.normal.melodyRuns = undefined;
    try {
      const features = song(180);
      assert.deepEqual(notesOf(features, ["fastRuns"]), notesOf(features));
    } finally { DIFFICULTIES.normal.melodyRuns = saved; }
  });
});
