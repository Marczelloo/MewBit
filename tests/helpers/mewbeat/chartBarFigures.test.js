const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS, withFlags } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { figureMoments } = require("../../../helpers/mewbeat/charts/rhythm");
const { plusFigures, plusMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const BEATS = Array.from({ length: 17 }, (_, i) => i * 500);
const timing = {
  snapped: true,
  beats: BEATS,
  downbeats: BEATS.filter((_, i) => i % 4 === 0),
  medianMs: 500,
  beatMsAt: () => 500,
  intervalOk: () => true,
  gridPoints: (div) => BEATS.flatMap((b) => Array.from({ length: div }, (_, k) => b + (500 * k) / div)),
};
const HARD_GAPS = { minNoteGapMs: 60, maxNps: 9 };
const SONGS = {
  "120 BPM": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "180 BPM": () => makeLayeredFeatures({ bpm: 180, durationMs: 64000 }),
};
const chartsOf = (song, flags) => Object.fromEntries(Object.entries(generateAll(SONGS[song](), "k", flags)).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes) => [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);

describe("Hard's extras follow the bars' figures (flag plusFigures)", () => {
  // bars 0 and 1 play the same rhythm in Normal; bar 2 another
  const occupied = [0, 1000, 2000, 3000, 4000, 4500, 5000];
  const scored = [
    { t: 500, s: 0.8, score: 2 },
    { t: 1500, s: 0.6, score: 1 },
    { t: 2500, s: 0.4, score: 0.5 },
    { t: 3500, s: 0.9, score: 3 },
    { t: 5500, s: 0.3, score: 0.1 },
  ];

  it("takes a place in every bar of the family, by the mean score there", () => {
    // the best moments alone: 3500 then 500, a different place in each bar
    assert.deepEqual(plusMoments(scored, occupied, 2, HARD_GAPS, timing).map((m) => m.t), [500, 3500]);
    assert.deepEqual(plusFigures(scored, occupied, 2, HARD_GAPS, timing, 0, 6000).map((m) => m.t), [1500, 3500]);
  });

  it("skips a family's place that would pass the room for a smaller one", () => {
    assert.deepEqual(plusFigures(scored, occupied, 1, HARD_GAPS, timing, 0, 6000).map((m) => m.t), [5500]);
    assert.deepEqual(plusFigures(scored, occupied, 0, HARD_GAPS, timing, 0, 6000), []);
  });

  it("gathers the extras in the figures that already took some, with plusFamilyBonus", () => {
    const flat = [
      { t: 500, s: 0.5, score: 1 }, { t: 2500, s: 0.5, score: 1 }, // the family of bars 0 and 1
      { t: 1500, s: 0.5, score: 0.9 }, { t: 3500, s: 0.5, score: 0.9 },
      { t: 5500, s: 0.5, score: 0.95 }, // bar 2 alone
    ];
    assert.deepEqual(plusFigures(flat, occupied, 4, HARD_GAPS, timing, 0, 6000).map((m) => m.t), [500, 2500, 5500]);
    assert.deepEqual(plusFigures(flat, occupied, 4, { ...HARD_GAPS, plusFamilyBonus: 0.3 }, timing, 0, 6000).map((m) => m.t), [500, 1500, 2500, 3500]);
  });

  it("copies a repeat's extras as plusMoments does, and without downbeats", () => {
    const copied = scored.map((c) => ({ ...c, score: Infinity }));
    assert.deepEqual(plusFigures(copied, occupied, 3, HARD_GAPS, timing, 0, 6000), plusMoments(copied, occupied, 3, HARD_GAPS, timing));
    const noBars = { ...timing, downbeats: [] };
    assert.deepEqual(plusFigures(scored, occupied, 2, HARD_GAPS, noBars, 0, 6000), plusMoments(scored, occupied, 2, HARD_GAPS, noBars));
  });

  it("is off by default, changes Hard alone and only on top of hardPlus", () => {
    assert.ok(FLAGS.plusFigures);
    assert.equal(DIFFICULTIES.hard.plusFigures, undefined);
    for (const level of ["easy", "normal", "hell"]) assert.equal(withFlags(levelOf(level), level, { plusFigures: true }), levelOf(level), level);
    // hardBase is the Hard that normalV26 and the old Easy are cut from: the flag names it, with nothing to change
    assert.deepEqual(FLAGS.plusFigures.levels.hardBase, {});
    assert.deepEqual(withFlags(INTERNAL_LEVELS.hardBase, "hardBase", { plusFigures: true }), INTERNAL_LEVELS.hardBase);
    for (const song of Object.keys(SONGS)) {
      assert.deepEqual(chartsOf(song, { plusFigures: true }), chartsOf(song, undefined), `${song} without hardPlus`);
      const plus = chartsOf(song, { hardPlus: true }), on = chartsOf(song, { hardPlus: true, plusFigures: true });
      for (const level of ["easy", "normal", "hell"]) assert.deepEqual(on[level], plus[level], `${song} ${level}`);
      const kept = new Set(momentsOf(on.hard));
      assert.deepEqual(momentsOf(on.normal).filter((t) => !kept.has(t)), [], `${song}: Normal moments missing from Hard`);
      const times = momentsOf(on.hard);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= DIFFICULTIES.hard.minNoteGapMs, `${song} ${times[i - 1]} to ${times[i]}`);
    }
  });
});

describe("Easy keeps the same moments in bars Normal plays alike (flag easyFigures)", () => {
  const upper = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
  const strength = { 0: 0.9, 500: 0.2, 1000: 0.6, 1500: 0.5, 2000: 0.9, 2500: 0.6, 3000: 0.2, 3500: 0.5 };
  const byMoment = new Map(upper.map((t) => [t, [{ t, s: strength[t], source: "drums" }]]));

  it("keeps a place in all the family's bars at once", () => {
    const kept = figureMoments(upper, 4, byMoment, timing, null, upper).sort((a, b) => a - b);
    assert.deepEqual(kept, [0, 1500, 2000, 3500]);
  });

  it("fills what is left of the count with the best single moments", () => {
    assert.equal(figureMoments(upper, 5, byMoment, timing, null, upper).length, 5);
    assert.deepEqual(figureMoments(upper, 0, byMoment, timing, null, upper), []);
  });

  it("changes Easy alone, and only on top of easyFromNormal", () => {
    assert.ok(FLAGS.easyFigures);
    for (const level of ["normal", "hard", "hell"]) assert.equal(withFlags(levelOf(level), level, { easyFigures: true }), levelOf(level), level);
    for (const song of Object.keys(SONGS)) {
      assert.deepEqual(chartsOf(song, { easyFigures: true }), chartsOf(song, undefined), `${song} without easyFromNormal`);
      const cut = chartsOf(song, { easyFromNormal: true }), on = chartsOf(song, { easyFromNormal: true, easyFigures: true });
      for (const level of ["normal", "hard", "hell"]) assert.deepEqual(on[level], cut[level], `${song} ${level}`);
      const normal = new Set(momentsOf(on.normal));
      assert.deepEqual(momentsOf(on.easy).filter((t) => !normal.has(t)), [], `${song}: Easy moments Normal does not play`);
    }
  });
});
