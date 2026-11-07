const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { isFlatLoud } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const RULE = FLAGS.flatLoud.levels.normal.flatLoud;
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const chartsOf = (bpm, energy, flags) => notesOf(generateAll(makeLayeredFeatures({ bpm, durationMs: 64000, energy: () => energy }), "k", flags));
const moments = (notes) => new Set(notes.map((n) => n.t)).size;
const ctxOf = (bpm, energy, snapped = true) => ({ timing: { snapped, medianMs: 60000 / bpm }, features: { energy: { hopMs: 500, values: Array(100).fill(energy) } } });

describe("fast songs loud all through (flag flatLoud)", () => {
  it("is off by default and acts on Normal alone", () => {
    assert.deepEqual(Object.keys(FLAGS.flatLoud.levels), ["normal"]);
    assert.equal(DIFFICULTIES.normal.flatLoud, undefined);
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
    const plain = chartsOf(180, 0.85, undefined), on = chartsOf(180, 0.85, { flatLoud: true });
    assert.ok(moments(on.normal) > moments(plain.normal) * 1.05, `${moments(on.normal)} against ${moments(plain.normal)}`);
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
  });

  it("leaves a slow loud song and a fast song under ref as they are", () => {
    for (const [bpm, energy] of [[120, 0.85], [180, 0.5]]) {
      assert.deepEqual(chartsOf(bpm, energy, { flatLoud: true }), chartsOf(bpm, energy, undefined), `${bpm} BPM at ${energy}`);
    }
  });
});
