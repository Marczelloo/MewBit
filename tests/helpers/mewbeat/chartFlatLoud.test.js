const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FLAT_LOUD } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { isFlatLoud } = require("../../../helpers/mewbeat/charts/selection");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const RULE = FLAT_LOUD;
const WITHOUT = flagWithout("withoutflatloud", "flatLoud");
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const featuresOf = (bpm, energy) => makeLayeredFeatures({ bpm, durationMs: 64000, energy: () => energy });
const chartsOf = (bpm, energy, flags) => notesOf(generateAll(featuresOf(bpm, energy), "k", flags));
// Since v44 Easy, Hard and Hell are cut from or built on Normal and move with it; hardBase and easyV26 stay as they were.
const unmovedOf = (bpm, energy, flags) => Object.fromEntries(["hardBase", "easyV26"].map((level) => [level, generateChart(featuresOf(bpm, energy), level, "k", flags).notes]));
const moments = (notes) => new Set(notes.map((n) => n.t)).size;
const ctxOf = (bpm, energy, snapped = true) => ({ timing: { snapped, medianMs: 60000 / bpm }, features: { energy: { hopMs: 500, values: Array(100).fill(energy) } } });

describe("fast songs loud all through (Normal's flatLoud, v43)", () => {
  it("is Normal's alone", () => {
    assert.equal(DIFFICULTIES.normal.flatLoud, RULE);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].flatLoud, undefined, level);
  });

  it("isFlatLoud wants the flag, the tempo and a song mean over ref", () => {
    const diff = { flatLoud: RULE };
    assert.equal(isFlatLoud(ctxOf(180, 0.85), diff), true);
    assert.equal(isFlatLoud(ctxOf(180, 0.85), {}), false);
    assert.equal(isFlatLoud(ctxOf(120, 0.85), diff), false);
    assert.equal(isFlatLoud(ctxOf(180, RULE.ref - 0.01), diff), false);
    assert.equal(isFlatLoud(ctxOf(180, 0.85, false), diff), false);
    assert.equal(isFlatLoud({ ...ctxOf(180, 0.85), features: {} }, diff), false);
  });

  it("plays more moments on Normal of a fast song loud all through, found against the old behaviour", () => {
    const plain = chartsOf(180, 0.85, WITHOUT), on = chartsOf(180, 0.85, undefined);
    assert.ok(moments(on.normal) > moments(plain.normal) * 1.05, `${moments(on.normal)} against ${moments(plain.normal)}`);
    const unmovedOn = unmovedOf(180, 0.85, undefined), unmovedPlain = unmovedOf(180, 0.85, WITHOUT);
    for (const level of Object.keys(unmovedOn)) assert.deepEqual(unmovedOn[level], unmovedPlain[level], level);
  });

  it("leaves a slow loud song and a fast song under ref as they are", () => {
    for (const [bpm, energy] of [[120, 0.85], [180, 0.5]]) {
      assert.deepEqual(chartsOf(bpm, energy, undefined), chartsOf(bpm, energy, WITHOUT), `${bpm} BPM at ${energy}`);
    }
  });
});
