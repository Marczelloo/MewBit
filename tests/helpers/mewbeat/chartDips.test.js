const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { energyDipsOf, silentUpper, thinDips } = require("../../../helpers/mewbeat/charts/dips");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { makeLayeredFeatures } = require("./fixtures");

const RULE = DIFFICULTIES.normal.dipThin;
// 20 frames of 500 ms at 0.8, two of them (4000-5000 ms) dipping to 0.4
const values = Array.from({ length: 20 }, (_, i) => (i === 8 || i === 9 ? 0.4 : 0.8));
const beats = Array.from({ length: 21 }, (_, i) => i * 500);
const onsets = Array.from({ length: 40 }, (_, i) => ({ t: i * 250, s: 0.8 }));
const ctxOf = () => ({ features: { energy: { hopMs: 500, values } }, timing: { beats }, onsets });

describe("slowing down in a dip of the music (dipThin, v40)", () => {
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

  it("is part of Normal alone, and only thins it (v40)", () => {
    const features = makeLayeredFeatures();
    const on = generateAll(features, "k").normal.notes;
    DIFFICULTIES.normal.dipThin = undefined;
    try { assert.ok(on.length <= generateAll(features, "k").normal.notes.length); } finally { DIFFICULTIES.normal.dipThin = RULE; }
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].dipThin, undefined, level);
  });
});

describe("silence where the upper bands stop in a dip (flag dipSilence)", () => {
  const SILENCE = FLAGS.dipSilence.levels.normal.dipSilence;
  // hats every 250 ms but for a gap from 3500 to `to`; a low rumble the generator played on every beat
  const ctxWith = (to) => ({ features: { energy: { hopMs: 500, values }, bands: [{ name: "high", onsets: onsets.filter((o) => o.t <= 3500 || o.t >= to) }] } });
  const notes = [3000, 3750, 4000, 4250, 4500, 5250].map((t) => ({ t, lane: 0 }));

  it("drops the moments in the dip while the upper bands are silent, not those around it", () => {
    assert.deepEqual(silentUpper(notes, ctxWith(5500), SILENCE).map((n) => n.t), [3000, 3750, 5250]);
  });

  it("leaves a gap under a second, and one so long it is a passage of its own", () => {
    assert.deepEqual(silentUpper(notes, ctxWith(4250), SILENCE), notes);
    const long = { features: { energy: { hopMs: 500, values }, bands: [{ name: "high", onsets: [{ t: 0, s: 1 }, { t: 9750, s: 1 }] }] } };
    assert.deepEqual(silentUpper(notes, long, SILENCE), notes);
  });

  it("changes Normal alone, and only with the flag on", () => {
    const features = makeLayeredFeatures();
    const plain = generateAll(features, "k", {}), on = generateAll(features, "k", { dipSilence: true });
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level].notes, plain[level].notes, level);
    assert.equal(DIFFICULTIES.normal.dipSilence, undefined);
  });
});
