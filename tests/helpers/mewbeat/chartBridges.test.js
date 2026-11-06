const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { bridgeRests } = require("../../../helpers/mewbeat/charts/bridges");
const { DIFFICULTIES, MINI_RESTS } = require("../../../helpers/mewbeat/charts/difficulty");

// A steady 120 BPM grid: beats every 500 ms.
const BEATS = Array.from({ length: 100 }, (_, i) => i * 500);
const timing = { snapped: true, beats: BEATS, medianMs: 500, beatMsAt: () => 500, gridPoints: (div) => BEATS.flatMap((b) => Array.from({ length: div }, (_, k) => b + (500 * k) / div)) };
const playing = { at: () => 0.5 };
const RULE = MINI_RESTS;
const moment = (t, score, metric = 0) => ({ t, score, metric });
const times = (notes) => notes.map((n) => n.t);

describe("mini rests (Normal's restBridge)", () => {
  it("a rest under music keeps its best moment on a beat or half beat", () => {
    const notes = [{ t: 1000, lane: 0 }, { t: 2500, lane: 1 }]; // 3 beats of nothing
    const scored = [moment(1750, 1.2, 1), moment(1625, 2, 2)];
    assert.deepEqual(times(bridgeRests(notes, scored, playing, timing, RULE)), [1000, 1750, 2500]);
  });

  it("a long rest takes another moment where it is still a rest", () => {
    const notes = [{ t: 1000, lane: 0 }, { t: 5000, lane: 1 }];
    const scored = [moment(3000, 1), moment(2000, 0.5), moment(4000, 0.2)];
    assert.deepEqual(times(bridgeRests(notes, scored, playing, timing, RULE)), [1000, 2000, 3000, 4000, 5000]);
  });

  it("a full rest stays empty: no moment strong enough, the music quiet, or the rest short", () => {
    const notes = [{ t: 1000, lane: 0 }, { t: 3000, lane: 1 }];
    assert.deepEqual(times(bridgeRests(notes, [moment(2000, -0.5)], playing, timing, RULE)), [1000, 3000]);
    assert.deepEqual(times(bridgeRests(notes, [moment(2000, 1)], { at: () => 0.1 }, timing, RULE)), [1000, 3000]);
    const short = [{ t: 1000, lane: 0 }, { t: 1700, lane: 1 }];
    assert.deepEqual(times(bridgeRests(short, [moment(1250, 1, 1)], playing, timing, RULE)), [1000, 1700]);
  });

  it("a hold fills the rest until it lets go, and a moment keeps half a beat from either side", () => {
    const held = [{ t: 1000, lane: 0, len: 1500 }, { t: 3200, lane: 1 }]; // let go at 2500: 1.4 beats left
    assert.deepEqual(times(bridgeRests(held, [moment(2750, 1)], playing, timing, RULE)), [1000, 3200]);
    assert.deepEqual(times(bridgeRests([{ t: 1000, lane: 0 }, { t: 3200, lane: 1 }], [moment(2750, 1)], playing, timing, RULE)), [1000, 2750, 3200]);
    const notes = [{ t: 1000, lane: 0 }, { t: 3000, lane: 1 }];
    assert.deepEqual(times(bridgeRests(notes, [moment(1200, 3, 1), moment(2800, 3, 1)], playing, timing, RULE)), [1000, 3000]);
  });

  it("is Normal's alone, and a level without the rule keeps its rests", () => {
    assert.deepEqual(DIFFICULTIES.normal.restBridge, MINI_RESTS);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].restBridge, undefined, level);
    const notes = [{ t: 1000, lane: 0 }, { t: 2500, lane: 1 }];
    assert.equal(bridgeRests(notes, [moment(1750, 9)], playing, timing, undefined), notes);
  });
});
