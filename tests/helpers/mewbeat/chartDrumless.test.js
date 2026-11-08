const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FELT_TEMPO, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { analyse, generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { drumlessWindows, thinDrumless } = require("../../../helpers/mewbeat/charts/drumless");
const { makeLayeredFeatures } = require("./fixtures");

const RULE = DIFFICULTIES.normal.drumless;
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
// Since v44 Easy, Hard and Hell are cut from or built on Normal and move with it; what cannot move is the internal levels
// that stay as they were (hardBase, easyV26), so they stand for "Normal alone" in the checks below.
const UNMOVED = ["hardBase", "easyV26"];
const chartsOf = (features) => ({ ...notesOf(generateAll(features, "k")), ...Object.fromEntries(UNMOVED.map((level) => [level, generateChart(features, level, "k").notes])) });
// The charts with Normal's `key` set to `value` for the call (undefined: Normal without it).
function chartsWith(features, key, value) {
  const saved = DIFFICULTIES.normal[key];
  DIFFICULTIES.normal[key] = value;
  try {
    return chartsOf(features);
  } finally {
    DIFFICULTIES.normal[key] = saved;
  }
}

// 8 s: hats and cymbals in the first 4 s only, a kick every 125 ms throughout, a bass note every 500 ms.
const every = (ms, from, to) => Array.from({ length: Math.floor((to - from) / ms) }, (_, i) => ({ t: from + i * ms, s: 0.5 }));
const ctxOf = () => ({
  durationMs: 8000,
  features: {
    durationMs: 8000,
    bands: [{ name: "low", onsets: every(125, 0, 8000) }, { name: "lowmid", onsets: [] }, { name: "highmid", onsets: every(250, 0, 4000) }, { name: "high", onsets: every(250, 0, 4000) }],
    bass: every(500, 0, 8000),
    lead: [],
  },
});

describe("no drum kit playing (Normal's drumless, v42)", () => {
  it("finds the windows with no cymbals or hats", () => {
    assert.deepEqual([...drumlessWindows(ctxOf(), RULE)], [2, 3]);
  });

  it("keeps what a pitched line plays there, the holds, and everything where the drums play", () => {
    const notes = [1125, 1500, 4125, 4500, 4625, 5000].map((t) => ({ t, lane: 0 }));
    notes[4].len = 300;
    assert.deepEqual(thinDrumless(notes, ctxOf(), RULE, null).map((n) => n.t), [1125, 1500, 4500, 4625, 5000]);
    assert.deepEqual(thinDrumless(notes, ctxOf(), RULE, [{ t: 4125 }]).map((n) => n.t), [1125, 1500, 4125, 4500, 4625, 5000]);
  });

  it("is part of Normal alone", () => {
    const features = makeLayeredFeatures();
    const on = chartsOf(features), off = chartsWith(features, "drumless", undefined);
    for (const level of UNMOVED) assert.deepEqual(on[level], off[level], level);
    for (const level of ["easy", "hard", "hell", ...UNMOVED]) assert.equal((DIFFICULTIES[level] ?? INTERNAL_LEVELS[level]).drumless, undefined, level);
  });
});

describe("the decoded melody moved to our onsets (Normal's melodyOnsetShift, v42)", () => {
  it("moves the melody Normal reads by the stored shift", () => {
    const features = makeLayeredFeatures();
    const run = Array.from({ length: 120 }, (_, i) => ({ t: 1000 + i * 250, pitch: 60 + (i % 5) }));
    const decoded = { ...features, decodedMelody: run, decodedMelodyTuned: run };
    const plain = chartsOf(decoded);
    assert.deepEqual(plain, chartsWith(decoded, "melodyOnsetShift", undefined));
    const shifted = { ...decoded, decodedMelodyShift: 125 };
    const moved = chartsOf(shifted);
    assert.deepEqual(chartsWith(shifted, "melodyOnsetShift", undefined).normal, plain.normal);
    assert.notDeepEqual(moved.normal, plain.normal);
    for (const level of UNMOVED) assert.deepEqual(moved[level], plain[level], level);
  });
});

describe("half beats up to 145 BPM (Normal's feltTempo, v42)", () => {
  it("changes Normal alone against the old 115 BPM bound, on a 130 BPM song and not on a 160 BPM one", () => {
    assert.equal(FELT_TEMPO.belowBpm, 145);
    for (const [bpm, changes] of [[130, true], [160, false]]) {
      const features = makeLayeredFeatures({ bpm, durationMs: 64000 });
      const plain = chartsWith(features, "feltTempo", { ...FELT_TEMPO, belowBpm: 115 }), on = chartsOf(features);
      for (const level of UNMOVED) assert.deepEqual(on[level], plain[level], `${bpm} ${level}`);
      assert.equal(JSON.stringify(on.normal) !== JSON.stringify(plain.normal), changes, `${bpm} BPM`);
    }
  });
});
