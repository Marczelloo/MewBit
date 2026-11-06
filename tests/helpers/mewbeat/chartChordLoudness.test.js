const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { planChords } = require("../../../helpers/mewbeat/charts/chords");
const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

const BEAT_MS = 500; // the fixtures play at 120 BPM
const timing = buildTiming(makeFeatures({ durationMs: 64000 }), 64000);
const context = (level) => ({ timing, phrases: [], sections: [], durationMs: 64000, energy: { at: () => level }, eventTimes: [], onsets: [] });
const notes = () => Array.from({ length: 64 }, (_, i) => ({ t: 2000 + i * BEAT_MS, lane: 0 }));
const LOUDNESS = DIFFICULTIES.normal.chordLoudness;
// Normal with even chord rates and no caps, so only the rates decide.
const even = (chordLoudness) => ({ ...DIFFICULTIES.normal, chordRates: [0.5, 0.5, 0.5, 0.5], maxChordShare: undefined, maxChordsPer8Beats: 0, chordFlow: undefined, chordLoudness });
const chordsOf = (out) => {
  const at = new Map();
  for (const n of out) at.set(n.t, (at.get(n.t) ?? 0) + 1);
  return [...at.values()].filter((k) => k > 1).length;
};

describe("chords that follow how loud the music is (chordLoudness, v40)", () => {
  it("plays far fewer chords in quiet music and as many or more in loud music", () => {
    const quietPlain = chordsOf(planChords(notes(), context(0.15), even(undefined)));
    const quiet = chordsOf(planChords(notes(), context(0.15), even(LOUDNESS)));
    assert.ok(quietPlain > 0);
    assert.ok(quiet <= quietPlain / 4, `${quiet} of ${quietPlain}`);
    const loudPlain = chordsOf(planChords(notes(), context(0.9), even(undefined)));
    assert.ok(chordsOf(planChords(notes(), context(0.9), even(LOUDNESS))) >= loudPlain);
  });

  it("is part of Normal alone (v40)", () => {
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].chordLoudness, undefined, level);
    assert.ok(DIFFICULTIES.normal.chordLoudness);
  });
});
