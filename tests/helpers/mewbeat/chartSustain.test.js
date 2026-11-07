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

describe("the short-note line alone over a held bed (flag melodyOnly)", () => {
  // 48 s, loud throughout: a long bass under 8-24 s, a short note every 400 ms throughout (a chord of two after 32 s).
  const line = every(400, 0, 48000).flatMap(({ t }) => {
    const n = { t, len: 150, pitch: 50 + ((t / 400) % 5), vel: 0.5 };
    return t >= 32000 ? [n, { ...n, pitch: n.pitch + 7 }] : [n];
  });
  const ctxOf = (bassFrom, bassTo, notes = line) => ({
    durationMs: 48000,
    features: { durationMs: 48000, energy: { hopMs: 500, values: new Array(96).fill(0.9) }, decodedNotes: [{ t: bassFrom, len: bassTo - bassFrom, pitch: 40, vel: 0.8 }, ...notes] },
  });

  it("finds a passage of a single line over the bed, not a lone bar, a riff of chords nor a line with no bed", () => {
    assert.deepEqual([...melodyOnlyWindows(ctxOf(8000, 24000), MELODY)], [2, 3, 4, 5]);
    assert.equal(melodyOnlyWindows(ctxOf(8000, 12000), MELODY).size, 0);
    assert.equal(melodyOnlyWindows(ctxOf(32000, 48000), MELODY).size, 0);
    assert.equal(melodyOnlyWindows(ctxOf(8000, 24000, []), MELODY).size, 0);
  });

  it("plays the line alone there, one note per line note on the nearest moment", () => {
    const notes = every(200, 0, 48000).map(({ t }) => ({ t: t + 30, lane: 0 }));
    const out = keepMelodyOnly(notes, ctxOf(8000, 24000), MELODY, TIMING);
    const there = out.filter((n) => n.t >= 8000 && n.t < 24000).map((n) => n.t);
    assert.deepEqual(there, line.filter((n) => n.t >= 8000 && n.t < 24000).map((n) => n.t + 30));
    assert.deepEqual(out.filter((n) => n.t < 8000 || n.t >= 24000), notes.filter((n) => n.t < 8000 || n.t >= 24000));
  });

  it("changes Normal alone, and only with the flag on", () => {
    const features = { ...makeLayeredFeatures(), decodedNotes: ctxOf(8000, 24000).features.decodedNotes };
    const plain = notesOf(generateAll(features, "k", {})), on = notesOf(generateAll(features, "k", { melodyOnly: true }));
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.equal(DIFFICULTIES.normal.melodyOnly, undefined);
  });
});
