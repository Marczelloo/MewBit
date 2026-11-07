const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { holdSustains, keepMelodyOnly, melodyOnlyWindows } = require("../../../helpers/mewbeat/charts/sustain");
const { makeLayeredFeatures } = require("./fixtures");

const HOLDS = FLAGS.sustainHolds.levels.normal.sustainHolds;
const MELODY = FLAGS.melodyOnly.levels.normal.melodyOnly;
const TIMING = { medianMs: 500 };
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const every = (ms, from, to, extra = {}) => Array.from({ length: Math.floor((to - from) / ms) }, (_, i) => ({ t: from + i * ms, s: 0.5, ...extra }));

// 12 s: hats and cymbals from 6 s on only, a "kick" every 250 ms throughout.
const drumlessCtx = (decodedNotes) => ({
  durationMs: 12000,
  features: {
    durationMs: 12000,
    bands: [{ name: "low", onsets: every(250, 0, 12000) }, { name: "highmid", onsets: every(250, 6000, 12000) }, { name: "high", onsets: every(250, 6000, 12000) }],
    bass: [],
    lead: [],
    decodedNotes,
  },
});

describe("long notes held where no drums play (flag sustainHolds)", () => {
  const taps = every(250, 0, 12000).map(({ t }) => ({ t, lane: 0 }));

  it("holds each long note of a legato line and drops the taps inside it", () => {
    const ctx = drumlessCtx([{ t: 500, len: 2000, pitch: 40, vel: 0.8 }, { t: 2500, len: 2000, pitch: 38, vel: 0.8 }]);
    const out = holdSustains(taps, ctx, HOLDS, TIMING);
    const holds = out.filter((n) => n.len > 0);
    assert.deepEqual(holds.map((n) => n.t), [500, 2500]);
    assert.ok(holds[0].t + holds[0].len + 250 <= 2500 - HOLDS.headMs, "the first lets go before the second's head");
    assert.equal(out.filter((n) => n.t > 500 && n.t < 2500).length, 0);
    assert.deepEqual(out.filter((n) => n.t >= 6000), taps.filter((n) => n.t >= 6000));
  });

  it("leaves long notes where the drums play, short or quiet ones, and a song with no decoded notes", () => {
    const ctx = drumlessCtx([{ t: 7000, len: 2000, pitch: 40, vel: 0.8 }, { t: 1000, len: 400, pitch: 40, vel: 0.8 }, { t: 3000, len: 2000, pitch: 40, vel: 0.2 }]);
    assert.deepEqual(holdSustains(taps, ctx, HOLDS, TIMING), taps);
    assert.deepEqual(holdSustains(taps, drumlessCtx(undefined), HOLDS, TIMING), taps);
  });

  it("changes Normal alone, and only with the flag on", () => {
    const features = { ...makeLayeredFeatures(), decodedNotes: [{ t: 2000, len: 3000, pitch: 40, vel: 0.8 }] };
    const plain = notesOf(generateAll(features, "k", {})), on = notesOf(generateAll(features, "k", { sustainHolds: true }));
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.equal(DIFFICULTIES.normal.sustainHolds, undefined);
  });
});

describe("the melody alone over a long bass (flag melodyOnly)", () => {
  // 16 s, loud throughout: a long bass under 4-8 s only, a melody note every 500 ms.
  const melody = every(500, 0, 16000, { pitch: 64 });
  const ctxOf = (bassFrom, bassTo) => ({
    durationMs: 16000,
    features: { durationMs: 16000, energy: { hopMs: 500, values: new Array(32).fill(0.9) }, decodedNotes: [{ t: bassFrom, len: bassTo - bassFrom, pitch: 40, vel: 0.8 }] },
  });

  it("finds the loud window held on a bass, not in a song held on it throughout", () => {
    assert.deepEqual([...melodyOnlyWindows(ctxOf(4000, 8000), MELODY, melody)], [1]);
    assert.equal(melodyOnlyWindows(ctxOf(0, 16000), MELODY, melody).size, 0);
    assert.equal(melodyOnlyWindows(ctxOf(4000, 8000), MELODY, []).size, 0);
  });

  it("keeps the melody's moments and the holds there, and everything elsewhere", () => {
    const notes = [4250, 4500, 5000, 5100, 9250].map((t) => ({ t, lane: 0 }));
    notes[3].len = 600;
    assert.deepEqual(keepMelodyOnly(notes, ctxOf(4000, 8000), MELODY, melody).map((n) => n.t), [4500, 5000, 5100, 9250]);
  });

  it("changes Normal alone, and only with the flag on", () => {
    const features = makeLayeredFeatures();
    const decoded = { ...features, decodedMelody: melody, decodedMelodyTuned: melody, decodedNotes: [{ t: 4000, len: 4000, pitch: 40, vel: 0.8 }] };
    const plain = notesOf(generateAll(decoded, "k", {})), on = notesOf(generateAll(decoded, "k", { melodyOnly: true }));
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.equal(DIFFICULTIES.normal.melodyOnly, undefined);
  });
});
