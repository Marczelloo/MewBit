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

  it("holds each long note of a legato line, one hold per sound, and drops the taps inside it", () => {
    const ctx = drumlessCtx([{ t: 500, len: 2000, pitch: 40, vel: 0.8 }, { t: 2500, len: 1000, pitch: 38, vel: 0.8 }, { t: 3600, len: 1000, pitch: 38, vel: 0.8 }]);
    const out = holdSustains(taps, ctx, HOLDS, TIMING);
    const holds = out.filter((n) => n.len > 0);
    assert.deepEqual(holds.map((n) => [n.t, n.t + n.len]), [[500, 2375], [2500, 4600]]);
    assert.deepEqual(out.filter((n) => n.t >= 500 && n.t < 4700), holds);
    assert.deepEqual(out.filter((n) => n.t >= 6000), taps.filter((n) => n.t >= 6000));
  });

  it("plays one note a moment where it holds", () => {
    const chords = [...taps, { t: 5000, lane: 2 }, { t: 9000, lane: 2 }];
    const out = holdSustains(chords, drumlessCtx([{ t: 500, len: 2000, pitch: 40, vel: 0.8 }]), HOLDS, TIMING);
    assert.equal(out.filter((n) => n.t === 5000).length, 1);
    assert.equal(out.filter((n) => n.t === 9000).length, 2);
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
  // 48 s, loud throughout: a long bass under 8-24 s only, a melody note every 1000 ms (the one at 10 s lasting 1.5 s, held up to the next).
  const melody = every(1000, 0, 48000, { pitch: 64, len: 200 });
  melody[10].len = 1500;
  const ctxOf = (bassFrom, bassTo) => ({
    durationMs: 48000,
    features: { durationMs: 48000, energy: { hopMs: 500, values: new Array(96).fill(0.9) }, decodedNotes: [{ t: bassFrom, len: bassTo - bassFrom, pitch: 40, vel: 0.8 }] },
  });

  it("finds a loud passage held on a bass, not a lone bar of it nor a song held on it throughout", () => {
    assert.deepEqual([...melodyOnlyWindows(ctxOf(8000, 24000), MELODY, melody)], [2, 3, 4, 5]);
    assert.equal(melodyOnlyWindows(ctxOf(8000, 12000), MELODY, melody).size, 0);
    assert.equal(melodyOnlyWindows(ctxOf(0, 48000), MELODY, melody).size, 0);
    assert.equal(melodyOnlyWindows(ctxOf(8000, 24000), MELODY, []).size, 0);
  });

  it("plays the melody alone there, one note per melody note on the nearest moment, the long ones held", () => {
    const notes = every(250, 0, 48000).map(({ t }) => ({ t: t + 30, lane: 0 }));
    const out = keepMelodyOnly(notes, ctxOf(8000, 24000), MELODY, melody, TIMING);
    const there = out.filter((n) => n.t >= 8000 && n.t < 24000);
    assert.deepEqual(there.map((n) => n.t), Array.from({ length: 16 }, (_, i) => 8030 + i * 1000));
    assert.deepEqual(there.filter((n) => n.len > 0).map((n) => [n.t, n.len]), [[10030, 875]]);
    assert.deepEqual(out.filter((n) => n.t < 8000 || n.t >= 24000), notes.filter((n) => n.t < 8000 || n.t >= 24000));
  });

  it("changes Normal alone, and only with the flag on", () => {
    const features = makeLayeredFeatures();
    const decoded = { ...features, decodedMelody: melody, decodedMelodyTuned: melody, decodedNotes: [{ t: 8000, len: 16000, pitch: 40, vel: 0.8 }] };
    const plain = notesOf(generateAll(decoded, "k", {})), on = notesOf(generateAll(decoded, "k", { melodyOnly: true }));
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.equal(DIFFICULTIES.normal.melodyOnly, undefined);
  });
});
