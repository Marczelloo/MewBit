const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { settleHolds, underHoldFlagged } = require("../../../helpers/mewbeat/charts/holds");
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
    assert.deepEqual(underHoldFlagged(250, [100], beat), [0], "half beat: nothing under");
    assert.deepEqual(underHoldFlagged(500, [125], beat), [0], "one beat: nothing faster than a half beat");
    assert.deepEqual(underHoldFlagged(500, [250], beat), []);
    assert.deepEqual(underHoldFlagged(550, [250, 300], beat), [0, 1], "...also between two notes under it");
    assert.deepEqual(underHoldFlagged(1000, [100, 150, 200], beat), [], "a longer hold: free");
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

  for (const [name, make] of Object.entries(songs)) {
    it(`${name}: every moment with holds is one the chart has without them`, () => {
      const features = make();
      const without = chartWith(features, { gapHoldShare: 0, maxHoldShare: 0, sustainMinBeats: Infinity });
      const free = chartWith(features, {});
      assert.ok(free.notes.some((n) => n.len > 0), "the fixture has holds");
      const bare = moments(without.notes);
      const extra = [...moments(free.notes)].filter((t) => !bare.has(t));
      assert.deepEqual(extra, [], "a moment under a hold was added");
      assert.ok(free.notes.length <= without.notes.length + free.notes.filter((n) => n.len > 0).length * 0, "no more notes than without holds");
      assert.deepEqual(normalViolations(free.notes, buildTiming(features, features.durationMs), { durationMs: free.durationMs }), []);
    });
  }
});
