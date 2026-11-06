const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { planChords } = require("../../../helpers/mewbeat/charts/chords");
const { DIFFICULTIES, SOLO_LEAD } = require("../../../helpers/mewbeat/charts/difficulty");
const { soloLeadRates } = require("../../../helpers/mewbeat/charts/selection");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

const RULE = SOLO_LEAD;
const HOP_MS = 100;
const timing = buildTiming(makeFeatures({ durationMs: 40000 }), 40000);
// Loud, then a quiet stretch the lead plays alone, then quiet with the drums back, then loud again.
const loudness = (t) => (t >= 10000 && t < 30000 ? 0.2 : 0.8);
const phrases = [
  { index: 0, startMs: 0, endMs: 10000, confidence: { drums: 0.9, lead: 0.9 } },
  { index: 1, startMs: 10000, endMs: 20000, confidence: { drums: 0.1, lead: 0.95 } },
  { index: 2, startMs: 20000, endMs: 30000, confidence: { drums: 0.6, lead: 0.95 } },
  { index: 3, startMs: 30000, endMs: 40000, confidence: { drums: 0.9, lead: 0.9 } },
];
const context = () => ({
  timing,
  phrases,
  sections: [],
  durationMs: 40000,
  features: { energy: { values: Array.from({ length: 400 }, (_, i) => loudness(i * HOP_MS)) }, lead: Array.from({ length: 30 }, (_, i) => ({ t: 10000 + i * 333, len: 200 })) },
  energy: { hopMs: HOP_MS, at: loudness },
  eventTimes: [],
  onsets: [],
});
const beats = () => Array.from({ length: 76 }, (_, i) => ({ t: 1000 + i * 500, lane: 0 }));
const chordy = (rule) => ({ ...DIFFICULTIES.normal, chordRates: [10, 10, 10, 10], maxChordShare: undefined, maxChordsPer8Beats: 0, soloLead: rule });
const chordTimes = (notes) => {
  const at = new Map();
  for (const n of notes) at.set(n.t, (at.get(n.t) ?? 0) + 1);
  return [...at].filter(([, size]) => size > 1).map(([t]) => t);
};

describe("a quiet soloist after the song has come in (Normal's soloLead)", () => {
  it("is a quiet phrase after the first loud one, with the drums away and the lead sure", () => {
    const rates = soloLeadRates(context(), RULE);
    assert.equal(rates[0], 0, "the loud opening");
    assert.ok(rates[1] > 2.5 && rates[1] < 3.5, `the solo plays its lead's ${rates[1]} notes a second`);
    assert.equal(rates[2], 0, "the drums are back");
    assert.equal(rates[3], 0, "loud again");
    assert.deepEqual(soloLeadRates(context(), undefined), [0, 0, 0, 0]);
  });

  it("plays one note at a time there, and the chords elsewhere as they were", () => {
    const plain = chordTimes(planChords(beats(), context(), chordy(undefined)));
    const solo = chordTimes(planChords(beats(), context(), chordy(RULE)));
    assert.ok(plain.some((t) => t >= 10000 && t < 20000));
    assert.deepEqual(solo, plain.filter((t) => t < 10000 || t >= 20000));
  });

  it("is Normal's alone", () => {
    assert.deepEqual(DIFFICULTIES.normal.soloLead, SOLO_LEAD);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].soloLead, undefined, level);
  });
});
