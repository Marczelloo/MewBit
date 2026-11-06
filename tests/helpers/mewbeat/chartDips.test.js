const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { energyDipsOf, thinDips } = require("../../../helpers/mewbeat/charts/dips");
const { makeLayeredFeatures } = require("./fixtures");

const RULE = FLAGS.dipThin.levels.normal.dipThin;
// 20 frames of 500 ms at 0.8, two of them (4000-5000 ms) dipping to 0.4
const values = Array.from({ length: 20 }, (_, i) => (i === 8 || i === 9 ? 0.4 : 0.8));
const beats = Array.from({ length: 21 }, (_, i) => i * 500);
const onsets = Array.from({ length: 40 }, (_, i) => ({ t: i * 250, s: 0.8 }));
const ctxOf = () => ({ features: { energy: { hopMs: 500, values } }, timing: { beats }, onsets });

describe("slowing down in a dip of the music (flag dipThin)", () => {
  it("finds a dip of the energy curve with its depth, and none in quiet music", () => {
    assert.deepEqual(energyDipsOf(ctxOf(), RULE), [[4000, 5000, 0.5]]);
    const quiet = { features: { energy: { hopMs: 500, values: values.map((v) => v / 4) } } };
    assert.deepEqual(energyDipsOf(quiet, RULE), []);
  });

  it("drops the off-beat moments of a deep dip, keeps its beats, its holds and the music around", () => {
    const notes = [3750, 4000, 4250, 4500, 4750, 5250].map((t) => ({ t, lane: 0 }));
    notes[4].len = 400;
    assert.deepEqual(thinDips(notes, ctxOf(), RULE).map((n) => n.t), [3750, 4000, 4500, 4750, 5250]);
    assert.equal(thinDips(notes, ctxOf(), { ...RULE, deep: 0 }), notes);
  });

  it("drops a weak moment of a dip even on the beat", () => {
    const weak = onsets.map((o) => (o.t === 4500 ? { ...o, s: 0.3 } : o));
    const notes = [4000, 4500].map((t) => ({ t, lane: 0 }));
    assert.deepEqual(thinDips(notes, { ...ctxOf(), onsets: weak }, RULE).map((n) => n.t), [4000]);
  });

  it("changes Normal alone, and only with the flag on", () => {
    const features = makeLayeredFeatures();
    const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
    const plain = notesOf(generateAll(features, "k", {}));
    const on = notesOf(generateAll(features, "k", { dipThin: true }));
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.ok(on.normal.length <= plain.normal.length);
    assert.deepEqual(Object.keys(FLAGS.dipThin.levels), ["normal"]);
  });
});
