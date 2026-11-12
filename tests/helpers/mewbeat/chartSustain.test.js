const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { holdSustains, keepMelodyOnly, melodyOnlyWindows, padLanes } = require("../../../helpers/mewbeat/charts/sustain");
const { makeLayeredFeatures } = require("./fixtures");

const HOLDS = DIFFICULTIES.normal.sustainHolds;
const { pad: _pad, ...NO_PAD } = HOLDS;
const MELODY = DIFFICULTIES.normal.melodyOnly;
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

describe("long notes held where no drums play (sustainHolds, v41)", () => {
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

  it("is part of Normal alone (v41): Easy, Hard and Hell are charted as without it", () => {
    const features = { ...makeLayeredFeatures(), decodedNotes: [{ t: 2000, len: 3000, pitch: 40, vel: 0.8 }] };
    const on = notesOf(generateAll(features, "k"));
    DIFFICULTIES.normal.sustainHolds = undefined;
    try {
      const off = notesOf(generateAll(features, "k"));
      for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], off[level], level);
    } finally {
      DIFFICULTIES.normal.sustainHolds = HOLDS;
    }
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].sustainHolds, undefined, level);
  });
});

describe("a quiet pad's chords held, the lane moving with the pitch (sustainHolds.pad, v41)", () => {
  const PADS = HOLDS;
  const taps = every(250, 0, 12000).map(({ t }) => ({ t, lane: 0 }));
  // 12 s: the high-mid busy throughout (not drumless), no hats or cymbals and a quiet energy under 6 s, loud after.
  const padCtx = (decodedNotes) => ({
    durationMs: 12000,
    features: {
      durationMs: 12000,
      bands: [{ name: "low", onsets: every(250, 0, 12000) }, { name: "highmid", onsets: every(125, 0, 12000) }, { name: "high", onsets: every(250, 6000, 12000) }],
      energy: { hopMs: 500, values: [...new Array(12).fill(0.3), ...new Array(12).fill(1)] },
      bass: [],
      lead: [],
      decodedNotes,
    },
  });
  // C3 under a G3 that comes in later and outlasts it, then D3.
  const chords = [{ t: 500, len: 2000, pitch: 48, vel: 0.5 }, { t: 2000, len: 2000, pitch: 55, vel: 0.5 }, { t: 4100, len: 1900, pitch: 50, vel: 0.5 }];

  it("holds one hold per chord, an inner voice coming in held by the chord under it", () => {
    const out = holdSustains(taps, padCtx(chords), PADS, TIMING);
    assert.deepEqual(out.filter((n) => n.len > 0).map((n) => [n.t, n.t + n.len]), [[500, 3875], [4000, 6000]]);
    assert.deepEqual(out.filter((n) => n.t >= 6125), taps.filter((n) => n.t >= 6125));
    assert.deepEqual(holdSustains(taps, padCtx(chords), NO_PAD, TIMING), taps);
  });

  it("starts a new hold where the next bass note comes in just before the one under it lets go", () => {
    const legato = [{ t: 500, len: 2000, pitch: 48, vel: 0.5 }, { t: 2400, len: 2000, pitch: 50, vel: 0.5 }];
    const out = holdSustains(taps, padCtx(legato), PADS, TIMING);
    assert.deepEqual(out.filter((n) => n.len > 0).map((n) => [n.t, n.t + n.len]), [[500, 2375], [2500, 4400]]);
  });

  it("steps the lane the way the chord moves, back the other way at the edge", () => {
    const holds = (lane) => [{ t: 500, lane, len: 3375 }, { t: 4000, lane, len: 2000 }];
    assert.deepEqual(padLanes(holds(2), padCtx(chords), PADS, TIMING).map((n) => n.lane), [2, 3]);
    assert.deepEqual(padLanes(holds(3), padCtx(chords), PADS, TIMING).map((n) => n.lane), [3, 2]);
  });

  it("steps the lane too for a chord in a lone window with a few hats between two quiet ones", () => {
    const ctx = padCtx([{ t: 500, len: 1900, pitch: 48, vel: 0.5 }, { t: 2600, len: 2000, pitch: 50, vel: 0.5 }]);
    ctx.features.bands[2].onsets.unshift(...[2100, 2600, 3100].map((t) => ({ t, s: 0.5 })));
    const holds = [{ t: 500, lane: 2, len: 1975 }, { t: 2600, lane: 2, len: 2000 }];
    assert.deepEqual(padLanes(holds, ctx, PADS, TIMING).map((n) => n.lane), [2, 3]);
  });

  it("is Normal's setting from v41", () => {
    assert.deepEqual(PADS.pad, { highBelow: 1, quietBelow: 0.6 });
    assert.equal(PADS.minVel, 0.35);
  });
});

describe("the short-note line alone over a held bed (Normal's melodyOnly, v42)", () => {
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

  it("leaves a phrase the drums lead: no lead is heard there to play alone", () => {
    const ctx = { ...ctxOf(8000, 24000), phrases: [{ startMs: 0, endMs: 20000 }, { startMs: 20000, endMs: 48000 }], leaders: ["lead", "drums"] };
    assert.deepEqual([...melodyOnlyWindows(ctx, MELODY)], [2, 3, 4]);
    // the two windows before drums that lead from 16 s are a run too short to play alone (Normal asks for three, v45)
    const early = { ...ctx, phrases: [{ startMs: 0, endMs: 16000 }, { startMs: 16000, endMs: 48000 }] };
    assert.equal(melodyOnlyWindows(early, MELODY).size, 0);
    assert.deepEqual([...melodyOnlyWindows(early, { ...MELODY, minRun: 2 })], [2, 3]);
  });

  it("plays the line alone there, one note per line note on the nearest moment", () => {
    const notes = every(200, 0, 48000).map(({ t }) => ({ t: t + 30, lane: 0 }));
    const out = keepMelodyOnly(notes, ctxOf(8000, 24000), MELODY, TIMING);
    const there = out.filter((n) => n.t >= 8000 && n.t < 24000).map((n) => n.t);
    assert.deepEqual(there, line.filter((n) => n.t >= 8000 && n.t < 24000).map((n) => n.t + 30));
    assert.deepEqual(out.filter((n) => n.t < 8000 || n.t >= 24000), notes.filter((n) => n.t < 8000 || n.t >= 24000));
  });

  it("lets a hold from before go a quarter beat before the line's first note, or makes it a tap", () => {
    const notes = [{ t: 6000, lane: 1, len: 2500 }, { t: 7700, lane: 2, len: 800 }, ...every(200, 8000, 24000).map(({ t }) => ({ t, lane: 0 }))];
    const out = keepMelodyOnly(notes, ctxOf(8000, 24000), MELODY, TIMING);
    assert.deepEqual(out.filter((n) => n.t < 8000), [{ t: 6000, lane: 1, len: 1875 }, { t: 7700, lane: 2 }]);
    assert.equal(out.filter((n) => n.t >= 8000 && n.t < 24000)[0].t, 8000);
  });

  it("finds the passage on the first run and plays the low-threshold run's line, without the bed's retriggers", () => {
    const ctx = ctxOf(8000, 24000);
    const quiet = every(200, 8000, 24000).map(({ t }) => ({ t, len: 100, pitch: 55, vel: 0.4 }));
    ctx.features.decodedShortNotes = [...quiet, { t: 9100, len: 100, pitch: 40, vel: 0.9 }];
    const notes = every(100, 0, 48000).map(({ t }) => ({ t, lane: 0 }));
    const there = keepMelodyOnly(notes, ctx, MELODY, TIMING).filter((n) => n.t >= 8000 && n.t < 24000).map((n) => n.t);
    assert.deepEqual(there, quiet.map((n) => n.t));
    assert.deepEqual([...melodyOnlyWindows(ctx, MELODY)], [2, 3, 4, 5]);
  });

  it("is part of Normal alone", () => {
    const features = { ...makeLayeredFeatures(), decodedNotes: ctxOf(8000, 24000).features.decodedNotes };
    const on = notesOf(generateAll(features, "k"));
    DIFFICULTIES.normal.melodyOnly = undefined;
    try {
      const off = notesOf(generateAll(features, "k"));
      for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], off[level], level);
    } finally {
      DIFFICULTIES.normal.melodyOnly = MELODY;
    }
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].melodyOnly, undefined, level);
  });
});
