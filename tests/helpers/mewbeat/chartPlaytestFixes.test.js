const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { CALM_SPOTS, COPY_SURE, DIFFICULTIES, INTERNAL_LEVELS, MELODY_ONLY, MELODY_ONLY_LONG } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { evenSpots } = require("../../../helpers/mewbeat/charts/spots");
const { melodyOnlyWindows } = require("../../../helpers/mewbeat/charts/sustain");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const EVERY_LEVEL = [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)];
const notesOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([level, chart]) => [level, chart.notes]));
const moments = (notes, fromMs = 0, toMs = Infinity) => [...new Set(notes.filter((n) => n.t >= fromMs && n.t < toMs).map((n) => n.t))];

describe("calmSpots leaves the notes of the melody (flag calmMelody)", () => {
  // 120 BPM, quiet from 24 to 40 s; the decoded melody is the lead's line, but for one bar at 30 s it runs a note every
  // quarter beat: Normal plays 8 moments in that bar against 4 in the bars around it.
  const BEAT = 500, FROM = 30000, TO = FROM + 4 * BEAT;
  const song = () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: "ABCDEFGHIJKLMNOP", energy: (t) => (t >= 24000 && t < 40000 ? 0.25 : 0.8) });
    const run = Array.from({ length: 16 }, (_, i) => ({ t: FROM + (i * BEAT) / 4, pitch: 60 + (i % 5) }));
    const line = [...features.lead.filter((n) => n.t < FROM || n.t >= TO).map((n) => ({ t: n.t, pitch: n.pitch })), ...run].sort((a, b) => a.t - b.t);
    return { ...features, decodedMelody: line, decodedMelodyTuned: line };
  };
  const lostFrom = (before, after) => {
    const kept = new Set(moments(after));
    return moments(before).filter((t) => !kept.has(t));
  };

  it("is a flag of Normal, Hard and Hell, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.calmMelody.levels, { normal: { calmMelody: true }, hard: { calmMelody: true }, hell: { calmMelody: true } });
    for (const level of EVERY_LEVEL) assert.equal(level.calmMelody, undefined);
  });

  it("does nothing without calmSpots", () => {
    const features = song();
    assert.deepEqual(notesOf(features, ["calmMelody"]), notesOf(features));
  });

  it("the melody's run stays whole; what still goes is no note of the melody", () => {
    const features = song();
    const onMelody = new Set(features.decodedMelody.map((n) => n.t));
    const off = notesOf(features).normal;
    const lostAlone = lostFrom(off, notesOf(features, ["calmSpots"]).normal);
    const lostBoth = lostFrom(off, notesOf(features, ["calmSpots", "calmMelody"]).normal);
    // the control: calmSpots alone does take notes of the run
    assert.ok(lostAlone.filter((t) => onMelody.has(t)).length >= 2, `calmSpots alone drops ${lostAlone}`);
    assert.deepEqual(lostBoth.filter((t) => onMelody.has(t)), []);
    assert.ok(lostBoth.length < lostAlone.length, `${lostAlone.length} -> ${lostBoth.length}`);
  });

  it("a bar is judged by what plays beside the melody: its notes neither count nor go (spots.js evenSpots)", () => {
    // by hand on the 120 BPM grid: ten bars on the beats, the sixth plays every quarter beat
    const ctx = analyse(makeLayeredFeatures({ bpm: 120, durationMs: 64000 }), []);
    const BAR = 4 * BEAT, at = (slot) => 5 * BAR + (slot * BEAT) / 4;
    const notes = Array.from({ length: 11 }, (_, bar) => (bar === 5 ? Array.from({ length: 16 }, (_x, i) => i) : [0, 4, 8, 12]))
      .flatMap((slots, bar) => slots.map((slot) => ({ t: bar * BAR + (slot * BEAT) / 4, lane: slot % 4, len: 0 })));
    const everywhere = () => true;
    const inBar = (out) => moments(out, 5 * BAR, 6 * BAR);
    assert.equal(inBar(evenSpots(notes, ctx, CALM_SPOTS, everywhere)).length, CALM_SPOTS.most);
    // ten of the sixteen are the melody's: the six beside it are no spot
    const run = new Set([1, 2, 3, 5, 6, 7, 9, 10, 11, 13].map(at));
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, everywhere, null, run), notes);
    // two are the melody's: the fourteen beside it are thinned to `most`, and the two stay on top
    const two = new Set([1, 3].map(at));
    const kept = inBar(evenSpots(notes, ctx, CALM_SPOTS, everywhere, null, two));
    assert.equal(kept.length, CALM_SPOTS.most + 2);
    for (const t of two) assert.ok(kept.includes(t), `the melody's note at ${t} stays`);
  });

  it("keeps every moment of the level under it on Hard and Hell", () => {
    const charts = notesOf(song(), ["hardHolds", "hellHolds", "calmSpots", "calmMelody"]);
    for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
      const mine = new Set(charts[level].map((n) => n.t));
      assert.deepEqual(moments(charts[under]).filter((t) => !mine.has(t)), [], `${under} moments missing from ${level}`);
    }
  });
});

describe("the line plays alone only in a long passage (flag melodyOnlyLong)", () => {
  // chartSustain.test.js's song: 48 s, loud throughout, a short note every 400 ms, a long bass under part of it.
  const line = Array.from({ length: 120 }, (_, i) => ({ t: i * 400, len: 150, pitch: 50 + (i % 5), vel: 0.5 }));
  const ctxOf = (bassFrom, bassTo) => ({
    durationMs: 48000,
    features: { durationMs: 48000, energy: { hopMs: 500, values: new Array(96).fill(0.9) }, decodedNotes: [{ t: bassFrom, len: bassTo - bassFrom, pitch: 40, vel: 0.8 }, ...line] },
  });

  it("is a flag of Normal that changes only the shortest passage", () => {
    assert.deepEqual(FLAGS.melodyOnlyLong.levels, { normal: { melodyOnly: MELODY_ONLY_LONG } });
    assert.deepEqual(MELODY_ONLY_LONG, { ...MELODY_ONLY, minRun: 3 });
    assert.equal(DIFFICULTIES.normal.melodyOnly, MELODY_ONLY);
  });

  it("two windows are no passage any more, three are", () => {
    assert.deepEqual([...melodyOnlyWindows(ctxOf(8000, 16000), MELODY_ONLY)], [2, 3]);
    assert.equal(melodyOnlyWindows(ctxOf(8000, 16000), MELODY_ONLY_LONG).size, 0);
    assert.deepEqual([...melodyOnlyWindows(ctxOf(8000, 20000), MELODY_ONLY_LONG)], [2, 3, 4]);
    assert.deepEqual([...melodyOnlyWindows(ctxOf(8000, 24000), MELODY_ONLY_LONG)], [2, 3, 4, 5]);
  });

  it("a song with a passage of four windows is charted as without the flag, on every level", () => {
    const features = { ...makeLayeredFeatures(), decodedNotes: ctxOf(8000, 24000).features.decodedNotes };
    const off = notesOf(features), on = notesOf(features, ["melodyOnlyLong"]);
    for (const level of LEVELS) assert.deepEqual(on[level], off[level], level);
  });
});

describe("a repeat almost exactly like its source is copied all the same (flag copySure)", () => {
  const PHRASE = 8000; // the fixture's phrases: the third repeats the first, similarity .95
  // chartMelodyFlags.test.js's song: a melody on the moments Normal plays, but in the third phrase on the ones it leaves
  // out, so copyMelody charts that phrase fresh. `similarity` is how alike the third phrase is said to be to the first.
  const moved = (similarity) => {
    const features = makeLayeredFeatures();
    const played = new Set(moments(notesOf(features).normal));
    const there = (t) => t >= 2 * PHRASE && t < 3 * PHRASE;
    const line = snappedMoments(analyse(features), "hard").filter((m) => played.has(m.t) !== there(m.t)).map((m) => ({ t: m.raw ?? m.t, pitch: 60 }));
    const list = features.phrases.list.map((p, i) => (i === 2 ? { ...p, similarity } : p));
    return { ...features, phrases: { ...features.phrases, list }, decodedMelody: line, decodedMelodyTuned: line };
  };

  it("is a flag of Normal, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.copySure.levels, { normal: { copySure: COPY_SURE } });
    for (const level of EVERY_LEVEL) assert.equal(level.copySure, undefined);
  });

  it("does nothing without copyMelody", () => {
    const features = moved(0.99);
    assert.deepEqual(notesOf(features, ["copySure"]), notesOf(features));
  });

  it("the phrase is a copy again where it is that alike, and stays fresh where it is not", () => {
    const alike = moved(0.99);
    // the control: copyMelody alone charts the third phrase fresh
    assert.notDeepEqual(moments(notesOf(alike, ["copyMelody"]).normal, 2 * PHRASE, 3 * PHRASE), moments(notesOf(alike).normal, 2 * PHRASE, 3 * PHRASE));
    assert.deepEqual(notesOf(alike, ["copyMelody", "copySure"]), notesOf(alike));
    const less = moved(COPY_SURE - 0.01);
    assert.deepEqual(notesOf(less, ["copyMelody", "copySure"]), notesOf(less, ["copyMelody"]));
  });
});
