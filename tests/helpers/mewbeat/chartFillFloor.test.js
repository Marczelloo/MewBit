const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FILL_FLOOR, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
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

describe("fills keep to audible sounds (flag fillFloor)", () => {
  // A level with a flat gap of 200 ms whose foreground starts at a score of 1.
  const plainDiff = { minNoteGapMs: 200, gapBeats: 0, foreground: 1 };
  const diff = { ...plainDiff, fillFloor: FILL_FLOOR };
  const pick = (scored, budget, level = diff, edges = {}) => selectMoments(phrase, scored, budget, level, timing, edges);

  // Two strong notes open the phrase; after them a barely audible sound (the tail of a long note) and a soft but audible one.
  const strong = [0, 500].map((t) => moment(t, 0.9, 3));
  const tail = moment(2000, 0.15, -0.5);
  const soft = moment(4000, 0.3, -0.6);
  const scored = [...strong, tail, soft];

  it("is a flag of Normal, and no level has it without a flag", () => {
    assert.deepEqual(FLAGS.fillFloor.levels, { normal: { fillFloor: FILL_FLOOR } });
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.fillFloor, undefined);
  });

  it("fills a long stretch with the barely audible sound without the flag", () => {
    const chosen = pick(scored, 4, plainDiff);
    assert.deepEqual(times(chosen), [0, 500, 2000, 4000]);
    assert.equal(chosen.find((n) => n.t === 2000).reason, "dopełnienie");
  });

  it("fills neither a long stretch nor a rest with a sound under the floor, and keeps the audible one", () => {
    assert.deepEqual(times(pick(scored, 4)), [0, 500, 4000]);
    // with the budget to spare and only the tail left to fill a rest on a beat
    assert.deepEqual(times(pick([...strong, tail], 4)), [0, 500]);
  });

  it("leaves the foreground alone: a quiet sound the music puts there is still played", () => {
    const quietLead = moment(2000, 0.15, 3);
    assert.deepEqual(times(pick([...strong, quietLead], 4)), [0, 500, 2000]);
  });

  it("charts a whole song with the flag on, every level", () => {
    const flagged = generateAll(makeLayeredFeatures(), "fill-floor-test", ["fillFloor"]);
    for (const level of ["easy", "normal", "hard", "hell"]) assert.ok(flagged[level].notes.length > 0);
  });
});
