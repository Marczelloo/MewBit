const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, DRUM_RUNS, DRUM_RUNS_FIT, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { drumRolls, withDrumRunNotes } = require("../../../helpers/mewbeat/charts/drumRuns");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const HITS = 8;

// A song at `bpm` whose drums are a strong kick on every beat, with one roll of HITS strong hits a quarter beat apart from the
// beat `at` (the fixture's grid is the truth). `energy` is the energy curve (flat, the song's loud level, by default).
function song(bpm, at, energy) {
  const beat = 60000 / bpm;
  const features = makeLayeredFeatures({ bpm, durationMs: 64000, structure: "ABCDEFGHIJKLMNOP", ...(energy ? { energy } : {}) });
  const drums = Array.from({ length: Math.floor(63000 / beat) }, (_, i) => ({ t: i * beat, kind: "kick", s: 0.9 }));
  for (let i = 1; i < HITS; i++) drums.push({ t: (at + i / 4) * beat, kind: "snare", s: 0.9 });
  features.drums = drums.sort((a, b) => a.t - b.t);
  return features;
}
const chartsOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([l, c]) => [l, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))].sort((a, b) => a - b);
const key = (notes) => JSON.stringify(notes.map((n) => [n.t, n.lane, n.len ?? 0]));
const addedBy = (features, flags) => {
  const before = new Set(momentsOf(chartsOf(features, []).normal));
  return momentsOf(chartsOf(features, flags).normal).filter((t) => !before.has(t));
};
const ROLL_BEAT = 100; // far from both ends of the song
// energy: the song is loud (0.6) all through, or quiet (0.2) from 10 s to 50 s, where the roll is
const quietly = (t) => (t > 10000 && t < 50000 ? 0.2 : 0.6);

describe("the burst sized to the song and the place (flag drumRunsFit)", () => {
  it("is a flag of Normal, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.drumRunsFit.levels, { normal: { drumRunsFit: DRUM_RUNS_FIT } });
    assert.match(FLAGS.drumRunsFit.label, /\S/);
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.drumRunsFit, undefined);
  });

  it("does nothing without drumRuns", () => {
    for (const features of [song(120, ROLL_BEAT), song(170, ROLL_BEAT, quietly)]) {
      assert.deepEqual(chartsOf(features, ["drumRunsFit"]), chartsOf(features, []));
    }
  });

  it("keeps the whole burst in a fast, loud place: drumRuns note for note, on every level", () => {
    const features = song(170, ROLL_BEAT);
    assert.ok(addedBy(features, ["drumRuns"]).length >= 2, "the fixture has a burst to keep");
    assert.deepEqual(chartsOf(features, ["drumRuns", "drumRunsFit"]), chartsOf(features, ["drumRuns"]));
  });

  it("gives a roll in a slow song one note, at its end", () => {
    const features = song(120, ROLL_BEAT);
    const full = addedBy(features, ["drumRuns"]), fitted = addedBy(features, ["drumRuns", "drumRunsFit"]);
    assert.equal(full.length, 3);
    assert.equal(fitted.length, DRUM_RUNS_FIT.shortAdds);
    assert.ok(fitted[0] >= Math.max(...full), "the note is the latest the burst would have had");
    const at = ROLL_BEAT * 500;
    assert.ok(fitted[0] > at + (HITS / 2) * 125, "in the second half of the roll");
  });

  it("gives a roll in a quiet place of a fast song one note too, and the same song loud keeps the burst", () => {
    const quiet = song(170, ROLL_BEAT, quietly), loud = song(170, ROLL_BEAT);
    assert.equal(addedBy(quiet, ["drumRuns"]).length, addedBy(loud, ["drumRuns"]).length, "the burst is the same without the flag");
    assert.equal(addedBy(quiet, ["drumRuns", "drumRunsFit"]).length, DRUM_RUNS_FIT.shortAdds);
    assert.equal(addedBy(loud, ["drumRuns", "drumRunsFit"]).length, addedBy(loud, ["drumRuns"]).length);
  });

  it("places a roll's notes by its cap: all as before when the cap is not reached, the last ones when it is", () => {
    const features = song(170, ROLL_BEAT);
    const timing = analyse(features, ["drumRuns"]).timing;
    const beat = 60000 / 170, at = ROLL_BEAT * beat;
    const stream = Array.from({ length: 40 }, (_, i) => ({ t: at - 4 * beat + i * (beat / 2), lane: i % 4 }));
    const asked = (fit) => withDrumRunNotes(stream, features.drums, timing, DRUM_RUNS, fit).filter((n) => !stream.includes(n)).map((n) => n.t);
    const full = asked(null);
    assert.ok(full.length >= 2);
    assert.deepEqual(asked(() => Infinity), full);
    assert.deepEqual(asked(() => full.length), full, "a cap the roll does not pass changes nothing");
    assert.deepEqual(asked(() => 0), []);
    const one = asked(() => 1), two = asked(() => 2);
    assert.equal(one.length, 1);
    assert.equal(two.length, 2);
    assert.equal(one[0], Math.max(...full), "one note: the last the roll could take");
    assert.ok(two.includes(one[0]));
    assert.deepEqual(asked((from, to) => (from < to ? 1 : 0)), one, "the cap is asked with the roll's first and last hit");
    assert.equal(drumRolls(features.drums, timing, DRUM_RUNS).length, 1);
  });

  it("leaves Easy as it was, and Hard and Hell on top of Normal's shortened burst with no note doubled", () => {
    const features = song(120, ROLL_BEAT);
    const plain = chartsOf(features, []), fitted = chartsOf(features, ["drumRuns", "drumRunsFit"]);
    assert.equal(key(fitted.easy), key(plain.easy));
    assert.notEqual(key(fitted.normal), key(chartsOf(features, ["drumRuns"]).normal));
    for (const level of ["hard", "hell"]) {
      const kept = new Set(momentsOf(fitted[level]));
      for (const t of momentsOf(fitted.normal)) assert.ok(kept.has(t), `${level} lost ${t}`);
      const seen = new Set();
      for (const n of fitted[level]) {
        const k = `${n.t}/${n.lane}`;
        assert.ok(!seen.has(k), `${level} doubled ${k}`);
        seen.add(k);
      }
    }
  });

  it("is the same chart in the trace as in generate", () => {
    const features = song(120, ROLL_BEAT);
    const all = chartsOf(features, ["drumRuns", "drumRunsFit"]);
    for (const level of LEVELS) {
      const traced = traceChart(features, level, "k", ["drumRuns", "drumRunsFit"]);
      assert.equal(key(traced.notes), key(all[level]), level);
    }
  });
});
