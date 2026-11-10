const assert = require("node:assert");
const { describe, it } = require("node:test");

const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { PITCH_LANES, RUN_LANES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { normalViolations, pitchCost, pitchRoom, pitchTrack, recallLane, runCost, runStartCost } = require("../../../helpers/mewbeat/charts/laneRules");
const { makeLayeredFeatures } = require("./fixtures");

const BEAT = 500;
const beatOf = () => BEAT;
// A lead line of the given pitches, one every `gap` ms from 1000 ms, and the times of the moments that play them.
const lineOf = (pitches, gap = 250) => pitches.map((pitch, i) => ({ t: 1000 + i * gap, pitch, conf: 0.9 }));
const track = (pitches, { gap = 250, times, pitch = PITCH_LANES, run = RUN_LANES } = {}) => {
  const lead = lineOf(pitches, gap);
  return pitchTrack({ features: { lead, bass: [], bands: [] } }, times || lead.map((n) => n.t), beatOf, pitch, run);
};

describe("mewbeat pitch lanes", () => {
  describe("the flags", () => {
    it("are off by default and touch Normal only", () => {
      for (const name of ["pitchLanes", "runLanes"]) {
        assert.ok(FLAGS[name], name);
        assert.deepStrictEqual(Object.keys(FLAGS[name].levels), ["normal"], name);
      }
      assert.deepStrictEqual(Object.keys(FLAGS.pitchLanes.levels.normal), ["pitchLanes"]);
      assert.deepStrictEqual(Object.keys(FLAGS.runLanes.levels.normal), ["runLanes"]);
    });
  });

  describe("pitchTrack", () => {
    it("reads the semitone step into each moment and the lanes it asks for", () => {
      const t = track([60, 62, 62, 55, 67], { gap: 500, run: null });
      assert.strictEqual(t[0].delta, null);
      assert.deepStrictEqual(t.slice(1).map((e) => e.delta), [2, 0, -7, 12]);
      // a step of the scale is a lane, from 4 semitones two, from 8 semitones three (a beat is there at this gap), a repeat none
      assert.deepStrictEqual(t.slice(1).map((e) => e.steps), [1, 0, -2, 3]);
    });

    it("asks for no leap across the keys without a beat to make it in", () => {
      const t = track([60, 72], { gap: 250, run: null });
      assert.strictEqual(t[1].steps, 2);
    });

    it("has nothing for a chord or a moment the line does not play, and no step across a long gap", () => {
      const lead = lineOf([60, 62, 64], 250);
      const times = [lead[0].t, null, lead[2].t + 5000];
      const t = pitchTrack({ features: { lead, bass: [], bands: [] } }, times, beatOf, PITCH_LANES, null);
      assert.strictEqual(t[1], null);
      assert.strictEqual(t[2], null);
      const far = track([60, 62], { gap: 4000, run: null });
      assert.strictEqual(far[1].delta, null);
    });

    it("counts the climb and fall that come next, for the room", () => {
      const t = track([60, 61, 62, 63, 64, 70], { gap: 500, run: null });
      assert.strictEqual(t[0].up, 4);
      assert.strictEqual(t[0].down, 0);
      const down = track([70, 69, 68], { gap: 500, run: null });
      assert.strictEqual(down[0].down, 2);
      assert.strictEqual(down[0].up, 0);
    });

    it("marks the notes of a fast one-way run, and the note before it", () => {
      const t = track([60, 62, 64, 65, 67, 60], { gap: 250 });
      assert.deepStrictEqual(t.map((e) => e.run), [0, 1, 1, 1, 1, 0]);
      assert.deepStrictEqual(t[0].start, { direction: 1, steps: 4 });
      assert.strictEqual(t[1].start, null);
    });

    it("marks no run of two notes, a slow one or one that turns back", () => {
      assert.ok(track([60, 62, 64], { gap: 250 }).some((e) => e.run === 1));
      assert.ok(track([60, 62], { gap: 250 }).every((e) => e.run === 0));
      assert.ok(track([60, 62, 64, 65], { gap: 500 }).every((e) => e.run === 0));
      assert.ok(track([60, 62, 60, 62, 60], { gap: 250 }).every((e) => e.run === 0));
    });

    it("gives nothing without the rules, nor without a line", () => {
      assert.ok(track([60, 62, 64], { pitch: null, run: null }).every((e) => e === null));
      assert.ok(pitchTrack({ features: {} }, [1000], beatOf, PITCH_LANES, RUN_LANES).every((e) => e === null));
    });
  });

  describe("pitchCost", () => {
    const rule = { ...PITCH_LANES };
    const here = (delta, steps) => ({ delta, steps, pitch: 60, up: 0, down: 0 });
    const cost = (h, lane, prev, gapMs = 500, recall = null) => pitchCost(rule, h, lane, prev, recall, gapMs, BEAT);

    it("is free on the lane a rise asks for and dearer the further away and the wrong way round", () => {
      const h = here(2, 1);
      assert.strictEqual(cost(h, 2, 1), 0);
      assert.ok(cost(h, 3, 1) > 0);
      assert.ok(cost(h, 0, 1) > cost(h, 3, 1));
      assert.ok(cost(h, 1, 1) > cost(h, 3, 1));
    });

    it("mirrors a fall", () => {
      assert.strictEqual(cost(here(-2, -1), 1, 2), 0);
      assert.ok(cost(here(-2, -1), 3, 2) > cost(here(-2, -1), 0, 2));
    });

    it("asks for a larger lane step for a larger jump", () => {
      assert.strictEqual(cost(here(5, 2), 3, 1), 0);
      assert.ok(cost(here(5, 2), 2, 1) > 0);
      assert.strictEqual(cost(here(10, 3), 3, 0), 0);
    });

    it("takes the room that is left near the edge, and starts over at it", () => {
      assert.strictEqual(cost(here(10, 3), 3, 2), 0);
      // rising at the right edge: the near restart (lane 1) with no beat, the far one (lane 0) with one
      assert.strictEqual(cost(here(2, 1), 1, 3, 250), 0);
      assert.strictEqual(cost(here(2, 1), 0, 3, 500), 0);
      assert.ok(cost(here(2, 1), 3, 3) > cost(here(2, 1), 1, 3, 250));
      assert.strictEqual(cost(here(-2, -1), 2, 0, 250), 0);
      assert.strictEqual(cost(here(-2, -1), 3, 0, 500), 0);
    });

    it("keeps the lane of a repeat when slow enough for a jack, else goes back to the recalled one", () => {
      const same = here(0, 0);
      assert.strictEqual(cost(same, 2, 2, 500), 0);
      assert.ok(cost(same, 1, 2, 500) > 0);
      assert.strictEqual(cost(same, 1, 2, 125, 1), 0);
      assert.ok(cost(same, 2, 2, 125, 1) > 0);
      assert.strictEqual(cost(same, 0, 2, 125, null), 0);
    });

    it("has no opinion on a step too small to be a move and too large to be a repeat", () => {
      assert.strictEqual(cost(here(0.7, 0), 0, 3), 0);
    });

    it("costs room for a lane that the next steps will climb out of, and none where there is room", () => {
      const rising = { ...here(0, 0), up: 3, down: 0 };
      assert.strictEqual(pitchRoom(rule, rising, 0), 0);
      assert.ok(pitchRoom(rule, rising, 2) > 0);
      assert.ok(pitchRoom(rule, rising, 3) > pitchRoom(rule, rising, 2));
      const falling = { ...here(0, 0), up: 0, down: 3 };
      assert.strictEqual(pitchRoom(rule, falling, 3), 0);
      assert.ok(pitchRoom(rule, falling, 1) > 0);
    });
  });

  describe("recallLane", () => {
    const rule = PITCH_LANES;
    const tracked = [60, 62, 60].map((pitch, m) => ({ pitch, delta: m === 0 ? null : pitch - [60, 62, 60][m - 1] }));
    it("finds the lane the same pitch had a few moments back, on another lane than the last", () => {
      const tail = [{ m: 0, lanes: [1], t: 0 }, { m: 1, lanes: [2], t: 1 }];
      assert.strictEqual(recallLane(rule, [{ ...tracked[0] }, { ...tracked[1] }, { ...tracked[2], delta: 0, pitch: 60 }], tail, 2, 2), 1);
    });
    it("finds nothing across a break in the track, or for a pitch that moved", () => {
      const tail = [{ m: 0, lanes: [1], t: 0 }, { m: 1, lanes: [2], t: 1 }];
      assert.strictEqual(recallLane(rule, [tracked[0], null, { pitch: 60, delta: 0 }], tail, 2, 2), null);
      assert.strictEqual(recallLane(rule, tracked, tail, 2, 2), null);
    });
  });

  describe("runCost", () => {
    const rule = RUN_LANES;
    it("is free on the neighbouring lane the run goes to, and dearer for other lanes", () => {
      assert.strictEqual(runCost(rule, 1, 2, 1), 0);
      assert.ok(runCost(rule, 1, 3, 1) > 0);
      assert.ok(runCost(rule, 1, 0, 1) > runCost(rule, 1, 3, 1));
      assert.strictEqual(runCost(rule, -1, 0, 1), 0);
    });
    it("wraps to the far end at the edge, so the run keeps its direction", () => {
      assert.strictEqual(runCost(rule, 1, 0, 3), 0);
      assert.strictEqual(runCost(rule, -1, 3, 0), 0);
      assert.ok(runCost(rule, 1, 2, 3) > 0);
    });
    it("costs the first note of a run the room it lacks", () => {
      const start = { direction: 1, steps: 3 };
      assert.strictEqual(runStartCost(rule, start, 0), 0);
      assert.strictEqual(runStartCost(rule, start, 3), 3 * rule.startRoom);
      assert.strictEqual(runStartCost(rule, { direction: -1, steps: 2 }, 1), rule.startRoom);
      assert.strictEqual(runStartCost(rule, { direction: 1, steps: 9 }, 2), 2 * rule.startRoom);
    });
  });

  describe("in the charts", () => {
    const features = () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 });
    const base = generateAll(features(), "k", []);
    const timesOf = (notes) => JSON.stringify([...new Set(notes.map((n) => n.t))]);

    it("leave every chart as it was while the flags are off", () => {
      assert.deepStrictEqual(generateAll(features(), "k", []), base);
    });

    for (const name of ["pitchLanes", "runLanes", "pitchLanes,runLanes"]) {
      it(`${name} moves lanes alone, never a note or a length`, () => {
        const on = generateAll(features(), "k", name.split(","));
        assert.strictEqual(timesOf(on.normal.notes), timesOf(base.normal.notes));
        assert.strictEqual(on.normal.notes.length, base.normal.notes.length);
        assert.deepStrictEqual(on.normal.notes.map((n) => n.len ?? 0), base.normal.notes.map((n) => n.len ?? 0));
      });

      it(`${name} leaves the moments of every level where they were`, () => {
        // Easy is cut from Normal and Hard and Hell are built on it, so their lanes can follow Normal's (Easy through the upper
        // bonus, Hard through the notes it starts from) and a hold can end earlier at the next note of its lane; no note moves
        const on = generateAll(features(), "k", name.split(","));
        for (const level of ["easy", "hard", "hell"]) {
          assert.strictEqual(timesOf(on[level].notes), timesOf(base[level].notes), level);
          assert.strictEqual(on[level].notes.length, base[level].notes.length, level);
        }
      });

      it(`${name} breaks no rule of Normal's lanes`, () => {
        const on = generateAll(features(), "k", name.split(","));
        const { timing } = analyse(features());
        assert.deepStrictEqual(normalViolations(on.normal.notes, timing, { durationMs: 64000 }), []);
      });
    }

    it("pitchLanes changes lanes where the lead moves", () => {
      const on = generateAll(features(), "k", ["pitchLanes"]);
      assert.ok(on.normal.notes.some((n, i) => n.lane !== base.normal.notes[i].lane));
    });
  });
});
