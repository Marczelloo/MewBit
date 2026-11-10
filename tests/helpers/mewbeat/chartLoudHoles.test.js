const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, LOUD_HOLES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { selectMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const BEAT = 500;
const timing = {
  snapped: true,
  beats: Array.from({ length: 60 }, (_, i) => i * BEAT),
  downbeats: Array.from({ length: 15 }, (_, i) => i * 4 * BEAT),
  beatMsAt: () => BEAT,
};
const phrase = { index: 0, startMs: 0, endMs: 16 * BEAT, pulse: 0 };
const metricOf = (t) => (t % BEAT === 0 ? 0 : t % (BEAT / 2) === 0 ? 1 : t % (BEAT / 4) === 0 ? 2 : 3);
const moment = (t, s, score = s) => ({ t, s, score, metric: metricOf(t), down: t % (4 * BEAT) === 0 ? 1 : 0, source: "lead" });
const times = (notes) => notes.map((n) => n.t);

describe("a hole with a loud sound in it (flag loudHoles)", () => {
  // A level with a flat gap of 200 ms whose foreground starts at a score of 1.
  const plainDiff = { minNoteGapMs: 200, gapBeats: 0, foreground: 1 };
  const diff = { ...plainDiff, loudHoles: LOUD_HOLES };
  const pick = (scored, budget, edges = {}, level = diff) => selectMoments(phrase, scored, budget, level, timing, edges);

  // Four strong moments, three at the phrase's start and one at its end, take the budget; between them the phrase holds sounds
  // under the foreground, none of them stronger than a chosen note, so the long stretches cannot swap one in.
  const front = [0, 500, 1000, 7500].map((t) => moment(t, 0.9, 3));
  const loudOnes = [3125, 5000].map((t) => moment(t, 0.8, 0.5));
  const quietOnes = [4000, 6500].map((t) => moment(t, 0.1, 0.4));
  const scored = [...front, ...loudOnes, ...quietOnes].sort((a, b) => a.t - b.t);
  const loud = new Set(times(loudOnes));

  it("is a flag of Normal, and no level has it without a flag", () => {
    assert.deepEqual(FLAGS.loudHoles.levels, { normal: { loudHoles: LOUD_HOLES } });
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.loudHoles, undefined);
  });

  it("leaves the stretch empty without the flag, with the budget spent", () => {
    assert.deepEqual(times(pick(scored, 4, { loud, holeRoom: 2 }, plainDiff)), [0, 500, 1000, 7500]);
  });

  it("plays the loud moments of the empty stretch on top of the budget, the best first, and no quiet one", () => {
    const chosen = pick(scored, 4, { loud, holeRoom: 2 });
    assert.deepEqual(times(chosen), [0, 500, 1000, 3125, 5000, 7500]);
    assert.deepEqual(chosen.filter((n) => n.reason === "dziura").map((n) => n.t), [3125, 5000]);
    assert.deepEqual(chosen.filter((n) => n.reason !== "dziura"), pick(scored, 4, {}, plainDiff));
  });

  it("plays at most the holes' room", () => {
    assert.deepEqual(times(pick(scored, 4, { loud, holeRoom: 1 })), [0, 500, 1000, 3125, 7500]);
    assert.deepEqual(times(pick(scored, 4, { loud, holeRoom: 0 })), [0, 500, 1000, 7500]);
    assert.deepEqual(times(pick(scored, 4, { loud })), [0, 500, 1000, 7500]);
  });

  it("leaves a stretch shorter than the rule's beats alone", () => {
    // notes every beat: no stretch reaches a beat and a half
    const beats = Array.from({ length: 16 }, (_, i) => moment(i * BEAT, 0.9, 3));
    const between = [1250, 3250].map((t) => moment(t, 0.8, 0.5));
    const all = [...beats, ...between].sort((a, b) => a.t - b.t);
    assert.deepEqual(times(pick(all, 16, { loud: new Set(times(between)), holeRoom: 4 })), times(beats));
  });

  it("keeps the level's gap to the notes already chosen", () => {
    // the only loud moment of the stretch lies 100 ms after a chosen note, inside the gap of 200 ms
    const close = [...front, moment(1100, 0.8, 0.5)].sort((a, b) => a.t - b.t);
    assert.deepEqual(times(pick(close, 4, { loud: new Set([1100]), holeRoom: 2 })), [0, 500, 1000, 7500]);
  });

  it("fills between two notes only: nothing after the phrase's last note or before its first", () => {
    const middle = [2000, 2500, 3000].map((t) => moment(t, 0.9, 3));
    const outside = [500, 6000].map((t) => moment(t, 0.8, 0.5));
    const all = [...middle, ...outside].sort((a, b) => a.t - b.t);
    assert.deepEqual(times(pick(all, 3, { loud: new Set(times(outside)), holeRoom: 2 })), [2000, 2500, 3000]);
  });

  it("counts the stretch from the last note of the phrase before, with the sounds carried over", () => {
    const later = { index: 1, startMs: 8000, endMs: 16000, pulse: 0 };
    const mine = [10000, 10500].map((t) => moment(t, 0.9, 3));
    const carried = moment(7000, 0.8, 0.5);
    const chosen = selectMoments(later, mine, 2, diff, timing, { before: 5000, carry: [carried], loud: new Set([7000]), holeRoom: 1 });
    assert.deepEqual(times(chosen), [7000, 10000, 10500]);
  });

  it("charts a whole song with the flag on, every level", () => {
    const flagged = generateAll(makeLayeredFeatures(), "loud-holes-test", ["loudHoles"]);
    for (const level of ["easy", "normal", "hard", "hell"]) assert.ok(flagged[level].notes.length > 0);
  });
});
