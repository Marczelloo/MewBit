const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { CHORD_SLOW, DIFFICULTIES, HOLD_SLOW } = require("../../../helpers/mewbeat/charts/difficulty");
const { slowChords } = require("../../../helpers/mewbeat/charts/chords");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { slowHolds } = require("../../../helpers/mewbeat/charts/holds");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const SLOW = ["chordSlow", "holdSlow", "slowDynamics"];
// Normal without one of them, or without all three: the behaviour before v43.
const without = (...names) => flagWithout(`without${names.join("")}`, ...names);
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const chartsOf = (bpm, flags) => notesOf(generateAll(makeLayeredFeatures({ bpm, durationMs: 64000 }), "k", flags));
const chordShare = (notes) => {
  const at = new Map();
  for (const n of notes) at.set(n.t, (at.get(n.t) ?? 0) + 1);
  return [...at.values()].filter((c) => c > 1).length / at.size;
};
const timingAt = (bpm) => ({ snapped: true, medianMs: 60000 / bpm });

describe("slow songs (Normal's chordSlow, holdSlow, slowDynamics, v43)", () => {
  it("are Normal's alone", () => {
    for (const name of SLOW) {
      assert.ok(DIFFICULTIES.normal[name], name);
      for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level][name], undefined, `${level} ${name}`);
    }
  });

  it("leave Easy, Hard and Hell byte-identical, on a slow song and a fast one", () => {
    for (const bpm of [95, 130, 180]) {
      const on = chartsOf(bpm, undefined);
      for (const names of [...SLOW.map((name) => [name]), SLOW]) {
        const plain = chartsOf(bpm, without(...names));
        for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], `${bpm} BPM ${level} ${names}`);
      }
    }
  });

  it("leave Normal as it is on a song at or above 145 BPM", () => {
    for (const bpm of [150, 180]) {
      const on = chartsOf(bpm, undefined);
      for (const name of SLOW) assert.deepEqual(chartsOf(bpm, without(name)).normal, on.normal, `${bpm} BPM ${name}`);
    }
  });

  it("chordSlow plays more chords on a slow song, found against the old behaviour", () => {
    const plain = chordShare(chartsOf(95, without("chordSlow")).normal), on = chordShare(chartsOf(95, undefined).normal);
    assert.ok(on > plain + 0.05, `${on} against ${plain}`);
  });

  it("slowChords grows the rates, the share and the 8-beat window with the tempo gap, at most max", () => {
    const rule = CHORD_SLOW;
    const diff = DIFFICULTIES.normal, plain = { ...diff, chordSlow: undefined };
    assert.equal(slowChords(plain, timingAt(100)), plain);
    assert.equal(slowChords(diff, timingAt(145)), diff);
    assert.equal(slowChords(diff, timingAt(200)), diff);
    assert.equal(slowChords(diff, { snapped: false, medianMs: 600 }), diff);
    const a = slowChords(diff, timingAt(120)), b = slowChords(diff, timingAt(60));
    assert.ok(a.chordRates[0] > diff.chordRates[0] && a.chordRates[0] < b.chordRates[0]);
    assert.ok(Math.abs(b.chordRates[0] / diff.chordRates[0] - rule.max) < 1e-9);
    assert.ok(a.maxChordShare > diff.maxChordShare && b.maxChordShare <= rule.maxShare);
    assert.ok(a.maxChordsPer8Beats > diff.maxChordsPer8Beats);
  });

  it("slowHolds shortens the minimum hold of a slow song to minMs and leaves others alone", () => {
    const rule = HOLD_SLOW;
    const diff = DIFFICULTIES.normal, plain = { ...diff, holdSlow: undefined };
    assert.equal(slowHolds(plain, timingAt(100)), plain);
    assert.equal(slowHolds(diff, timingAt(150)), diff);
    assert.equal(slowHolds(diff, { snapped: false, medianMs: 600 }), diff);
    const slow = slowHolds(diff, timingAt(100));
    assert.ok(Math.abs(slow.holdMinBeats * 600 - rule.minMs) < 1e-6);
    assert.ok(Math.abs(slow.sustainMinBeats * 600 - rule.minMs) < 1e-6);
    assert.equal(slowHolds(diff, timingAt(100)).holdMinBeats < diff.holdMinBeats, true);
  });
});
