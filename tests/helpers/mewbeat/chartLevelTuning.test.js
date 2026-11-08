const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS, withFlags } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { sameCuts } = require("../../../helpers/mewbeat/charts/rhythm");
const { makeLayeredFeatures } = require("./fixtures");

const SONGS = {
  "120 BPM": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "180 BPM": () => makeLayeredFeatures({ bpm: 180, durationMs: 64000 }),
  "120 BPM with holds": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, holdsEveryBeats: 16, sustainAtBeats: [8, 40, 72] }),
};
const notesOf = (song, flags) => Object.fromEntries(Object.entries(generateAll(SONGS[song](), "k", flags)).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes) => new Set(notes.map((n) => n.t));

// Four bars of 2000 ms on a 500 ms beat (snapped grid of quarter beats).
const timing = {
  snapped: true,
  downbeats: [0, 2000, 4000, 6000, 8000],
  gridPoints: (div) => Array.from({ length: 8 * div + 1 }, (_, i) => (i * 1000) / div),
};

describe("Easy keeps the same moments in bars Normal plays alike, after the floors too (flag easySameCuts)", () => {
  // Normal plays every beat and the half beat after the downbeat in each bar
  const upper = [0, 2000, 4000, 6000].flatMap((b) => [b, b + 250, b + 500, b + 1000, b + 1500]).sort((a, b) => a - b);

  it("drops a place most of the family's bars dropped, keeps one most of them play", () => {
    // the half beat (+250) stays in one bar of four, the beat at +1500 is gone in one bar of four
    const easy = [0, 2000, 4000, 6000].flatMap((b) => [b, b + 1000, ...(b !== 6000 ? [b + 1500] : []), ...(b === 0 ? [b + 250] : [])]).map((t) => ({ t, lane: 0 }));
    const out = sameCuts(easy, upper, timing, { keep: 0.4 }).map((n) => n.t);
    assert.ok(!out.includes(250), "a half beat one bar of four plays goes");
    for (const b of [0, 2000, 4000]) assert.ok(out.includes(b + 1500), `${b + 1500} stays`);
    assert.equal(out.length, easy.length - 1);
  });

  it("keeps a held moment, and leaves the notes as they are without a snapped grid", () => {
    const easy = [{ t: 0, lane: 0 }, { t: 250, lane: 1, len: 400 }, { t: 2000, lane: 0 }, { t: 4000, lane: 0 }, { t: 6000, lane: 0 }];
    assert.ok(sameCuts(easy, upper, timing, { keep: 0.4 }).some((n) => n.t === 250));
    assert.deepEqual(sameCuts(easy, upper, { ...timing, snapped: false }, { keep: 0.4 }), easy);
  });

  it("is off by default and changes Easy alone", () => {
    assert.ok(FLAGS.easySameCuts);
    assert.equal(DIFFICULTIES.easy.sameCuts, undefined);
    for (const level of ["normal", "hard", "hell", "easyV26"]) assert.equal(withFlags(levelOf(level), level, { easySameCuts: true }), levelOf(level), level);
    for (const song of Object.keys(SONGS)) {
      const off = notesOf(song, {}), on = notesOf(song, { easySameCuts: true });
      for (const level of ["normal", "hard", "hell"]) assert.deepEqual(on[level], off[level], `${song} ${level}`);
      const normal = momentsOf(on.normal);
      assert.deepEqual(on.easy.filter((n) => !normal.has(n.t)), [], `${song}: Easy moments Normal does not play`);
    }
  });
});

describe("Hard lays its own holds and lets them go with the sound (flag hardHolds)", () => {
  it("is off by default and changes Hard, and Hell built on it, alone", () => {
    assert.ok(FLAGS.hardHolds);
    assert.equal(DIFFICULTIES.hard.plusHolds, undefined);
    for (const level of ["easy", "normal", "hell", "hardBase"]) assert.equal(withFlags(levelOf(level), level, { hardHolds: true }), levelOf(level), level);
    for (const song of Object.keys(SONGS)) {
      const off = notesOf(song, {}), on = notesOf(song, { hardHolds: true });
      for (const level of ["easy", "normal"]) assert.deepEqual(on[level], off[level], `${song} ${level}`);
    }
  });

  it("keeps every moment of Normal in Hard and of Hard in Hell, with more holds in Hard", () => {
    for (const song of Object.keys(SONGS)) {
      const { normal, hard, hell } = notesOf(song, { hardHolds: true });
      const inHard = momentsOf(hard), inHell = momentsOf(hell);
      assert.deepEqual([...momentsOf(normal)].filter((t) => !inHard.has(t)), [], `${song}: Normal moments missing from Hard`);
      assert.deepEqual([...inHard].filter((t) => !inHell.has(t)), [], `${song}: Hard moments missing from Hell`);
      const holds = (notes) => notes.filter((n) => n.len > 0).length;
      assert.ok(holds(hard) >= holds(notesOf(song, {}).hard), `${song}: ${holds(hard)} holds`);
    }
  });

  it("no note on a held lane and at most two holds at once", () => {
    for (const song of Object.keys(SONGS)) {
      const notes = notesOf(song, { hardHolds: true }).hard;
      const ends = [];
      for (const h of notes.filter((n) => n.len > 0)) {
        const running = ends.filter((e) => e > h.t);
        assert.ok(running.length < 2, `${song}: a hold at ${h.t} under two others`);
        ends.splice(0, ends.length, ...running, h.t + h.len);
        assert.ok(!notes.some((n) => n !== h && n.lane === h.lane && n.t > h.t && n.t < h.t + h.len), `${song}: a note on the held lane ${h.lane} at ${h.t}`);
      }
    }
  });
});
