const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { BAR_SIMILARITY, repeatBarLanes } = require("../../../helpers/mewbeat/charts/barRepeats");

// 120 bpm, 4/4: a bar is 2000 ms, a beat 500 ms.
const BEAT = 500;
const BAR = 4 * BEAT;
const timing = { downbeats: [0, 1, 2, 3, 4].map((b) => b * BAR), beatMsAt: () => BEAT };
const at = (bar, beats, lanes) => beats.map((beat, i) => ({ t: bar * BAR + beat * BEAT, lane: lanes[i] }));
const lanesOf = (notes, bar) => notes.filter((n) => n.t >= bar * BAR && n.t < (bar + 1) * BAR).map((n) => `${n.t - bar * BAR}:${n.lane}`);
const all = { fromMs: 0, toMs: 4 * BAR };

describe("repeatBarLanes", () => {
  it("exports its threshold", () => {
    assert.equal(BAR_SIMILARITY, 0.65);
  });

  it("plays a bar with the rhythm of one before it on that bar's lanes (A B A B)", () => {
    const a = [0, 1, 1.5, 2, 3];
    const b = [0.5, 1.5, 2.5, 3.5];
    const notes = [...at(0, a, [0, 1, 2, 3, 1]), ...at(1, b, [3, 2, 1, 0]), ...at(2, a, [2, 0, 3, 1, 0]), ...at(3, b, [0, 0, 2, 2])];
    const out = repeatBarLanes(notes, timing, all);
    assert.deepEqual(lanesOf(out, 0), lanesOf(notes, 0));
    assert.deepEqual(lanesOf(out, 1), lanesOf(notes, 1));
    assert.deepEqual(lanesOf(out, 2).map((x) => x.split(":")[1]), lanesOf(out, 0).map((x) => x.split(":")[1]), "bar 2 plays bar 0's lanes");
    assert.deepEqual(lanesOf(out, 3).map((x) => x.split(":")[1]), lanesOf(out, 1).map((x) => x.split(":")[1]), "bar 3 plays bar 1's lanes");
    assert.equal(out.length, notes.length);
  });

  it("leaves bars with different rhythms as charted", () => {
    const notes = [...at(0, [0, 2], [0, 3]), ...at(1, [0.5, 1.5, 2.5, 3.5], [1, 2, 1, 2]), ...at(2, [1, 3], [2, 0])];
    assert.deepEqual(repeatBarLanes(notes, timing, all), notes);
  });

  it("keeps a drum hit's lane role: a kick takes a kick's lane, and a moment whose roles differ stays", () => {
    const notes = [...at(0, [0, 1, 2, 3], [0, 1, 3, 2]), ...at(1, [0, 1, 2, 3], [3, 0, 0, 1])];
    const out = repeatBarLanes(notes, timing, { ...all, fixed: () => true });
    assert.deepEqual(lanesOf(out, 1), ["0:0", "500:0", "1000:3", "1500:2"]);
  });

  it("takes as many of the source's lanes as a moment has notes, the rest keep theirs", () => {
    const notes = [...at(0, [0, 1, 2, 3], [1, 2, 1, 2]), { t: BAR, lane: 0 }, ...at(1, [0, 1, 2, 3], [3, 3, 0, 3])];
    const out = repeatBarLanes(notes, timing, all);
    assert.deepEqual(lanesOf(out, 1), ["0:1", "0:3", "500:2", "1000:1", "1500:2"]);
  });

  it("keeps each note's own length", () => {
    const notes = [...at(0, [0, 2], [1, 3]), { t: BAR, lane: 2, len: 600 }, { t: BAR + 2 * BEAT, lane: 0 }];
    const out = repeatBarLanes(notes, timing, all);
    assert.deepEqual(out.filter((n) => n.t >= BAR), [{ t: BAR, lane: 1, len: 600 }, { t: BAR + 2 * BEAT, lane: 3 }]);
  });
});
