const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, PACE_HOLES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { selectMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const BEAT = 500;
const HALF = BEAT / 2;
const timing = {
  snapped: true,
  beats: Array.from({ length: 60 }, (_, i) => i * BEAT),
  downbeats: Array.from({ length: 15 }, (_, i) => i * 4 * BEAT),
  beatMsAt: () => BEAT,
};
const phrase = { index: 0, startMs: 0, endMs: 16 * BEAT, pulse: 0 };
const metricOf = (t) => (t % BEAT === 0 ? 0 : t % HALF === 0 ? 1 : t % (BEAT / 4) === 0 ? 2 : 3);
const moment = (t, s, score = s) => ({ t, s, score, metric: metricOf(t), down: t % (4 * BEAT) === 0 ? 1 : 0, source: "lead" });
const times = (notes) => notes.map((n) => n.t);
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const byTime = (a, b) => a.t - b.t;

describe("a stretch longer than the pace of the notes round it (flag paceHoles)", () => {
  // A level with a flat gap of 200 ms whose foreground starts at a score of 1, with and without the rule.
  const plainDiff = { minNoteGapMs: 200, gapBeats: 0, foreground: 1 };
  const diff = { ...plainDiff, paceHoles: PACE_HOLES };
  const pick = (scored, budget, edges = {}, level = diff) => selectMoments(phrase, scored, budget, level, timing, edges);

  // A stream of strong notes every half beat from 0 to 3750, with the stretch from 1500 to 2250 empty of them.
  const stream = [...range(0, 1500, HALF), ...range(2250, 3750, HALF)].map((t) => moment(t, 0.9, 3));
  const streamTimes = times(stream);
  // One moment of the foreground in the hole, which the budget (the strong notes) leaves out.
  const inHole = moment(1875, 0.5, 1.5);
  const withHole = [...stream, inHole].sort(byTime);

  it("is a flag of Normal, and no level has it without a flag", () => {
    assert.deepEqual(FLAGS.paceHoles.levels, { normal: { paceHoles: PACE_HOLES } });
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.paceHoles, undefined);
  });

  it("leaves the hole empty without the flag, with the budget spent", () => {
    assert.deepEqual(times(pick(withHole, stream.length, {}, plainDiff)), streamTimes);
  });

  it("plays the moment of the foreground in the hole, on top of the budget, for the reason tempo", () => {
    const chosen = pick(withHole, stream.length);
    assert.deepEqual(times(chosen), [...streamTimes, 1875].sort((a, b) => a - b));
    assert.deepEqual(chosen.filter((n) => n.reason === "tempo").map((n) => n.t), [1875]);
    assert.deepEqual(chosen.filter((n) => n.reason !== "tempo"), pick(withHole, stream.length, {}, plainDiff));
  });

  it("leaves the hole alone when the only moment in it is under the foreground", () => {
    const quiet = [...stream, moment(1875, 0.2, 0.5)].sort(byTime);
    assert.deepEqual(times(pick(quiet, stream.length)), streamTimes);
  });

  it("leaves a stretch as long as the notes round it alone: a slower rhythm is no hole", () => {
    // notes every 750 ms, a moment of the foreground halfway between two of them
    const slow = range(0, 6000, 750).map((t) => moment(t, 0.9, 3));
    const all = [...slow, moment(1125, 0.5, 1.5)].sort(byTime);
    assert.deepEqual(times(pick(all, slow.length)), times(slow));
  });

  it("leaves a stretch shorter than the rule's beats alone", () => {
    // notes every 100 ms with a stretch of 400 ms empty: four times the pace, under a beat
    const fast = { minNoteGapMs: 50, gapBeats: 0, foreground: 1 };
    const notes = [...range(0, 1000, 100), ...range(1400, 2400, 100)].map((t) => moment(t, 0.9, 3));
    const all = [...notes, moment(1200, 0.5, 1.5)].sort(byTime);
    assert.deepEqual(times(pick(all, notes.length, {}, { ...fast, paceHoles: PACE_HOLES })), times(notes));
    // with the rule's beats under the stretch it is filled
    assert.deepEqual(times(pick(all, notes.length, {}, { ...fast, paceHoles: { ...PACE_HOLES, beats: 0.5 } })), times(all));
  });

  it("keeps the level's gap to the notes already chosen", () => {
    // the only moment of the hole lies 100 ms after a chosen note, inside the gap of 200 ms
    const close = [...stream, moment(1600, 0.5, 1.5)].sort(byTime);
    assert.deepEqual(times(pick(close, stream.length)), streamTimes);
  });

  it("takes the moment of the lower metric in the hole before one that scores higher", () => {
    // a half beat of 1750 (metric 1) scoring 2 and a beat of 2000 (metric 0) scoring 1.2, off the downbeats; room for one note only
    const both = [...stream, { ...moment(1750, 0.5, 2), down: 0 }, { ...moment(2000, 0.5, 1.2), down: 0 }].sort(byTime);
    const one = { ...diff, paceHoles: { ...PACE_HOLES, room: 0.01 } };
    const chosen = pick(both, stream.length, {}, one);
    assert.deepEqual(chosen.filter((n) => n.reason === "tempo").map((n) => n.t), [2000]);
    assert.equal(chosen.length, stream.length + 1);
  });

  it("takes the higher score between two moments of the same metric", () => {
    const both = [...stream, moment(1800, 0.5, 1.2), moment(1900, 0.5, 2)].sort(byTime);
    const one = { ...diff, paceHoles: { ...PACE_HOLES, room: 0.01 } };
    assert.deepEqual(pick(both, stream.length, {}, one).filter((n) => n.reason === "tempo").map((n) => n.t), [1900]);
  });

  it("plays at most the rule's room of the budget on top of it, ceiled", () => {
    // two holes, one moment of the foreground in each
    const notes = [...range(0, 1500, HALF), ...range(2250, 3750, HALF), ...range(4500, 6000, HALF)].map((t) => moment(t, 0.9, 3));
    const all = [...notes, moment(1875, 0.5, 1.5), moment(4125, 0.5, 1.5)].sort(byTime);
    const room = (share) => pick(all, notes.length, {}, { ...diff, paceHoles: { ...PACE_HOLES, room: share } });
    assert.equal(room(0.5).length, notes.length + 2);
    assert.equal(room(0.01).length, notes.length + 1);
    assert.equal(room(0).length, notes.length);
    assert.equal(room(1 / notes.length).length, notes.length + 1);
  });

  it("counts the stretch from the last note of the phrase before, with the notes before the phrase and the sounds carried over", () => {
    const later = { index: 1, startMs: 8000, endMs: 16000, pulse: 0 };
    const mine = range(9250, 10000, HALF).map((t) => moment(t, 0.9, 3));
    const carried = moment(8500, 0.5, 1.5);
    const earlier = [6750, 7000, 7250, 7500];
    const there = (edges) => selectMoments(later, mine, mine.length, diff, timing, { before: 7500, carry: [carried], ...edges });
    const chosen = there({ earlier });
    assert.deepEqual(times(chosen), [8500, ...times(mine)]);
    assert.equal(chosen[0].reason, "tempo");
    // with only the last note known too few gaps lie round the stretch to say it is a hole
    assert.deepEqual(times(there({})), times(mine));
    assert.deepEqual(times(there({ earlier: [7500] })), times(mine));
    // without the rule it stays empty
    assert.deepEqual(times(selectMoments(later, mine, mine.length, plainDiff, timing, { before: 7500, carry: [carried], earlier })), times(mine));
  });

  it("charts a whole song with the flag on, every level", () => {
    const flagged = generateAll(makeLayeredFeatures(), "pace-holes-test", ["paceHoles"]);
    for (const level of ["easy", "normal", "hard", "hell"]) assert.ok(flagged[level].notes.length > 0);
  });
});
