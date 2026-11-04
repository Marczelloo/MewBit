const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { addGapHolds, addSustainHolds, settleHolds, underHoldFlagged } = require("../../../helpers/mewbeat/charts/holds");
const { assignLanes } = require("../../../helpers/mewbeat/charts/lanes");
const { normalViolations } = require("../../../helpers/mewbeat/charts/laneRules");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

// Normal's holds let go with the sound, not automatically on the next moment, and carry the notes of the other hand
// (holdRelease "free", underHold). The rules of the Ranking Criteria for what may sit under a hold are the checker's
// (normalViolations); holds.js shares them with the generator.
const BEAT = 500;
const normal = levelOf("normal");
const v26 = levelOf("normalV26");
const beats = Array.from({ length: 33 * 4 + 1 }, (_, i) => i * BEAT);
const grid = { snapped: true, beats, downbeats: beats.filter((_, i) => i % 4 === 0), beatMsAt: () => BEAT, gridPoints: () => [] };
const handOf = (lane) => lane >> 1;
const tap = (t, lane = 0) => ({ t, lane });

const ctxFor = (more = {}) => {
  const features = { ...makeFeatures({ durationMs: 64000 }), lead: [], bass: [], bands: [] };
  return { features, timing: buildTiming(features, 64000), phrases: [], sections: [], durationMs: 64000, energy: { at: () => 0.6 }, onsets: [], eventTimes: [], ...more };
};
const violations = (notes) => normalViolations(notes, grid, { durationMs: 64000 }).map((v) => v.rule);

describe("Normal's holds", () => {
  it("are free: they let go with the sound and carry notes under them", () => {
    assert.equal(normal.holdRelease, "free");
    assert.equal(normal.underHold, true);
    for (const level of [v26, levelOf("easy"), levelOf("hard"), levelOf("hell")]) {
      assert.equal(level.holdRelease, undefined);
      assert.equal(level.underHold, undefined);
    }
  });

  it("a hold can outlast the next moment", () => {
    const dense = Array.from({ length: 5 }, (_, i) => tap(1250 + i * 250, 3 - (i % 2)));
    const notes = [{ t: 1000, lane: 0, len: 1750 }, ...dense];
    assert.equal(settleHolds(notes, normal, grid)[0].len, 1750, "the sound lasts 3.5 beats: the hold lets go with it");
    assert.ok(!("len" in settleHolds(notes, v26, grid)[0]), "v26 let go on the next moment, which was too near: a tap");
  });

  it("lets go on a moment when the sound ends near one", () => {
    const notes = [{ t: 1000, lane: 0, len: 1800 }, tap(1750, 3), tap(2250, 2), tap(2900, 3)];
    assert.equal(settleHolds(notes, normal, grid)[0].len, 1900, "2900 is 0.2 beat past the sound's end: the hold lets go on it");
    assert.equal(settleHolds(notes.slice(0, 3), normal, grid)[0].len, 1800, "no moment near: the hold keeps the sound's length");
  });

  it("a hold ending past the song end is clipped", () => {
    const notes = [{ t: 1000, lane: 0, len: 3000 }, tap(1500, 3)];
    const [hold] = settleHolds(notes, normal, grid, 2200);
    assert.equal(hold.len, 2200 - normal.minLaneGapMs - 1000, "the hold runs over the moment up to the song's end, less the lane gap");
    assert.ok(!violations([hold, tap(1500, 3)]).includes("holdBounds"));
    assert.deepEqual(normalViolations([{ ...hold }, tap(1500, 3)], grid, { durationMs: 2200 }), []);
  });

  it("a hold too short for its place becomes a tap", () => {
    const [hold] = settleHolds([{ t: 1000, lane: 0, len: 300 }, tap(1100, 3)], normal, grid);
    assert.ok(!("len" in hold));
  });
});

describe("notes under a hold", () => {
  it("go to the other hand, and nothing is left out", () => {
    // a hold of 4 beats; under it, moments a quarter beat apart, which the half-beat spacing of v26 forbade
    const notes = [{ t: 1000, lane: 0, len: 2000 }, tap(1250), tap(1375), tap(1750), tap(2000), tap(2500)];
    const out = assignLanes(notes, ctxFor(), normal);
    const held = out.find((n) => n.len > 0);
    assert.equal(out.length, notes.length, "no moment lost");
    assert.equal(held.len, 2000);
    for (const n of out.filter((o) => o !== held)) {
      if (n.t < held.t + held.len) assert.notEqual(handOf(n.lane), handOf(held.lane), `${n.t} on lane ${n.lane} under a hold on ${held.lane}`);
    }
    assert.deepEqual(violations(out), []);
  });

  it("a stream of quarter beats under a long hold stays playable", () => {
    const notes = [{ t: 1000, lane: 0, len: 2000 }, ...Array.from({ length: 6 }, (_, i) => tap(1500 + i * 125))];
    const out = assignLanes(notes, ctxFor(), normal);
    assert.equal(out.length, notes.length, "every moment is played");
    assert.deepEqual(violations(out), []);
  });

  it("a half beat hold has nothing under it", () => {
    const out = assignLanes([{ t: 1000, lane: 0, len: 250 }, tap(1100), tap(3000)], ctxFor(), normal);
    assert.deepEqual(violations(out), []);
    assert.equal(out.filter((n) => n.t === 1100).length, 1, "the moment under it is still played");
    assert.ok(out.length === 3);
  });

  it("a one beat hold has nothing faster than a half beat under it", () => {
    const tooNear = assignLanes([{ t: 1000, lane: 0, len: 500 }, tap(1125), tap(3000)], ctxFor(), normal);
    assert.deepEqual(violations(tooNear), []);
    assert.equal(tooNear.length, 3, "the moment under it is still played");
    const halfBeat = assignLanes([{ t: 1000, lane: 0, len: 500 }, tap(1250), tap(3000)], ctxFor(), normal);
    assert.deepEqual(violations(halfBeat), []);
    const held = halfBeat.find((n) => n.len > 0);
    assert.equal(held?.len, 500, "a note a half beat from both ends is what a mapper puts under a one beat hold");
    assert.notEqual(handOf(halfBeat.find((n) => n.t === 1250).lane), handOf(held.lane));
  });

  it("a hold of v26 keeps its old spacing", () => {
    const out = assignLanes([{ t: 1000, lane: 0, len: 2000 }, tap(1250), tap(1375), tap(2500)], ctxFor(), v26);
    assert.ok(out.length < 4, "v26 has no lane for the second of two notes a quarter beat apart under a hold");
  });
});

describe("the rule the generator and the checker share", () => {
  it("flags what sits under a hold by its length", () => {
    const beat = 500;
    const flagged = (len, under, at = () => beat) => underHoldFlagged(0, len, under, at);
    assert.deepEqual(flagged(250, [100]), [0], "half beat: nothing under");
    assert.deepEqual(flagged(500, [125]), [0], "one beat: nothing faster than a half beat");
    assert.deepEqual(flagged(500, [250]), []);
    assert.deepEqual(flagged(550, [250, 300]), [0, 1], "...also between two notes under it");
    assert.deepEqual(flagged(1000, [100, 150, 200]), [], "a longer hold: free");
  });

  it("measures a gap against the larger beat of its two ends", () => {
    // the tempo slows from a 500 ms beat to a 600 ms beat at 300 ms; a note at 275 splits a 550 ms hold in two gaps of 275
    const slowing = (at) => (at < 300 ? 500 : 600);
    assert.deepEqual(underHoldFlagged(0, 550, [275], slowing), [0], "275 ms is under half of the 600 ms beat at the hold's end");
    assert.deepEqual(underHoldFlagged(0, 550, [275], () => 500), [], "...but a half of the 500 ms beat all along");
  });
});

describe("running holds", () => {
  const settled = (notes) => settleHolds(notes, normal, grid).map((n) => ("len" in n ? n.len : 0));

  it("at most two run at once: a third starting with them becomes a tap", () => {
    // the second hold's start is a moment under the first, so a third can only join at the second's own time
    const three = [{ t: 1000, lane: 0, len: 2000 }, { t: 1250, lane: 2, len: 1000 }, { t: 1250, lane: 3, len: 1000 }];
    assert.deepEqual(settled(three), [2000, 1000, 0]);
    assert.deepEqual(settled(three.slice(0, 2)), [2000, 1000], "two are fine");
    assert.deepEqual(settled([...three.slice(0, 2), { t: 2750, lane: 3, len: 1000 }]), [2000, 1000, 1000], "...and one that starts after the second let go");
  });

  it("no moment sits under two holds at once", () => {
    const two = [{ t: 1000, lane: 0, len: 2000 }, { t: 1250, lane: 3, len: 1000 }];
    assert.deepEqual(settled(two), [2000, 1000], "nothing under the second hold: it stays");
    assert.deepEqual(settled([...two, tap(1750, 2)]), [2000, 0, 0], "a moment under both would have no hand to play it: the second is a tap");
    assert.deepEqual(settled([...two, tap(2500, 2)]), [2000, 1000, 0], "a moment under only the first is the second hand's");
  });
});

describe("holds follow the sound", () => {
  it("a sustain makes a hold of its own length, and the taps under it stay", () => {
    const notes = [tap(1000, 0), tap(1500, 1), tap(1750, 3), tap(4000, 2)];
    const sustain = [{ t: 1000, len: 1200, conf: 0.9 }];
    const free = addSustainHolds(notes, { lead: sustain }, normal, grid);
    assert.equal(free.length, notes.length, "nothing is dropped");
    assert.equal(free[0].len, 1200, "the hold has the sustain's length, not the distance to the next note");
    const old = addSustainHolds(notes, { lead: sustain }, v26, grid);
    assert.ok(old.length < notes.length || old[0].len < 1200, "v26 drops the taps under it or shortens it");
  });

  it("a sustain shorter than the hold minimum stays a tap", () => {
    const [first] = addSustainHolds([tap(1000), tap(4000)], { lead: [{ t: 1000, len: 450, conf: 0.9 }] }, normal, grid);
    assert.ok(!("len" in first));
  });

  const gapNotes = [tap(1000, 0), tap(2000, 3), tap(4000, 1), tap(5000, 2)];
  const gapHolds = (features, energy) => addGapHolds(gapNotes, features, normal, grid, energy).filter((n) => n.len > 0);

  it("a gap hold follows the sound that starts it, else a beat of the rest", () => {
    const loud = { at: () => 0.6 };
    const [held] = gapHolds({ lead: [{ t: 1000, len: 800, pitch: 60, conf: 0.9, s: 0.5 }] }, loud);
    assert.equal(held.t, 1000);
    assert.equal(held.len, 800, "the lead note lasts 800 ms, the rest is 1000");
    assert.equal(gapHolds({ bass: [{ t: 1000, len: 800, pitch: 40, conf: 0.9, s: 0.5 }] }, loud)[0].len, BEAT, "a bass note is followed for a beat: the tracker's drawn-out bass is mostly its own");
    assert.equal(gapHolds({}, loud)[0].len, BEAT, "no sound to follow: a beat, not the whole rest");
  });

  it("a gap hold needs the music to sound all through it", () => {
    const hole = { at: (t) => (t >= 1400 && t <= 1600 ? 0.1 : 0.6) };
    const held = gapHolds({}, hole);
    assert.ok(!held.some((n) => n.t === 1000), "the middle of the rest at 1000 is quiet: no hold");
    assert.ok(held.some((n) => n.t === 4000), "the rest at 4000 is loud");
  });
});

describe("under holds adds no moments", () => {
  const moments = (notes) => new Set(notes.map((n) => n.t));
  function chartWith(features, over) {
    const saved = {};
    for (const key of Object.keys(over)) saved[key] = normal[key];
    Object.assign(normal, over);
    try {
      return generateChart(features, "normal", "k");
    } finally {
      Object.assign(normal, saved);
    }
  }
  const songs = {
    layeredHolds: () => makeLayeredFeatures({ bpm: 100, durationMs: 96000, structure: "ABAC", holdsEveryBeats: 4 }),
    layeredSustain: () => makeLayeredFeatures({ bpm: 140, durationMs: 80000, structure: "AABB", sustainAtBeats: [4, 10] }),
  };

  // What is checked: holds on Normal bring no moment the chart lacks without them, lose at most 1% of the moments it has
  // without them (lanes.js may give one up when no lane is playable), and the chart still passes the checker.
  for (const [name, make] of Object.entries(songs)) {
    it(`${name}: holds add no moment and lose at most 1% of them`, () => {
      const features = make();
      const without = chartWith(features, { gapHoldShare: 0, maxHoldShare: 0, sustainMinBeats: Infinity });
      const free = chartWith(features, {});
      assert.ok(free.notes.some((n) => n.len > 0), "the fixture has holds");
      const bare = moments(without.notes);
      const withHolds = moments(free.notes);
      const extra = [...withHolds].filter((t) => !bare.has(t));
      assert.deepEqual(extra, [], "a moment under a hold was added");
      const lost = [...bare].filter((t) => !withHolds.has(t));
      assert.ok(lost.length <= Math.ceil(bare.size / 100), `holds cost ${lost.length} of ${bare.size} moments`);
      assert.deepEqual(normalViolations(free.notes, buildTiming(features, features.durationMs), { durationMs: free.durationMs }), []);
    });
  }
});
