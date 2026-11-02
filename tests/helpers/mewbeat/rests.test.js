const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { fillRests } = require("../../../helpers/mewbeat/charts/rests");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

// 120 bpm: a beat is 500 ms, band onsets every quarter beat. The chart rests for 8 beats (4000-8000 ms).
const features = makeFeatures({ durationMs: 20000 });
const timing = buildTiming(features, features.durationMs);
const notes = [
  { t: 2000, lane: 0 },
  { t: 3000, lane: 1 },
  { t: 4000, lane: 2 },
  { t: 8000, lane: 3 },
  { t: 9000, lane: 0 },
];
const ctxOf = (energy) => ({ features, timing, energy: { at: () => energy }, phrases: [], leaders: [], durationMs: 9500 });
const longestRest = (out) => Math.max(...out.slice(1).map((n, k) => n.t - out[k].t - (out[k].len ?? 0)));

describe("fillRests", () => {
  it("fills a long rest with the music's sounds, on the difficulty's grid", () => {
    const easy = fillRests(notes, ctxOf(0.5), DIFFICULTIES.easy);
    const added = easy.filter((n) => n.t > 4000 && n.t < 8000);
    assert.ok(added.length > 0, easy.map((n) => n.t).join());
    assert.ok(added.every((n) => n.t % 250 === 0), added.map((n) => n.t).join()); // Easy: beats and half beats
    assert.ok(longestRest(easy) < DIFFICULTIES.easy.fillRestBeats * 500, easy.map((n) => n.t).join());
  });

  it("puts no fill note on a neighbour's lane", () => {
    const easy = fillRests(notes, ctxOf(0.5), DIFFICULTIES.easy);
    for (let k = 1; k < easy.length; k++) assert.notEqual(easy[k].lane, easy[k - 1].lane, easy.map((n) => `${n.t}:${n.lane}`).join());
  });

  it("lets a quiet passage rest", () => {
    assert.deepEqual(fillRests(notes, ctxOf(0.1), DIFFICULTIES.easy), notes);
  });

  it("leaves a difficulty without fillRestBeats as it is", () => {
    assert.deepEqual(fillRests(notes, ctxOf(0.5), DIFFICULTIES.hard), notes);
  });
});
