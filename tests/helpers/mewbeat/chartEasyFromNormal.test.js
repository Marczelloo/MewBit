const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS, flagsKey, withFlags } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const ON = { easyFromNormal: true };
const SONGS = [
  { bpm: 100, structure: "ABAB" },
  { bpm: 120, structure: "ABAB", holdsEveryBeats: 8 },
  { bpm: 150, structure: "AABA" },
  { bpm: 180, structure: "ABAB", sustainAtBeats: [4, 12, 20, 28] },
];
const featuresOf = (song) => makeLayeredFeatures({ ...song, durationMs: 64000 });
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const momentsOf = (notes) => new Set(notes.map((n) => n.t));

describe("Easy cut from today's Normal (flag easyFromNormal)", () => {
  it("is off by default, names only the easy level and has its own chart version", () => {
    assert.deepEqual(Object.keys(FLAGS.easyFromNormal.levels), ["easy"]);
    assert.equal(DIFFICULTIES.easy.cutFrom, "normalV26");
    assert.equal(DIFFICULTIES.easy.keepShare, undefined);
    assert.equal(withFlags(DIFFICULTIES.easy, "easy", undefined), DIFFICULTIES.easy);
    assert.equal(withFlags(DIFFICULTIES.easy, "easy", ON).cutFrom, "normal");
    for (const level of ["normal", "hard", "hell", "normalV26"]) assert.equal(withFlags(DIFFICULTIES[level] ?? DIFFICULTIES.normal, level, ON), DIFFICULTIES[level] ?? DIFFICULTIES.normal, level);
    assert.equal(flagsKey(ON), "easyFromNormal");
    assert.equal(flagsKey(undefined), "");
  });

  it("changes nothing with the flag off or written as false", () => {
    const features = featuresOf(SONGS[1]);
    const plain = notesOf(generateAll(features, "k"));
    assert.deepEqual(notesOf(generateAll(features, "k", {})), plain);
    assert.deepEqual(notesOf(generateAll(features, "k", { easyFromNormal: false })), plain);
  });

  it("changes Easy alone: Normal, Hard and Hell stay as they were", () => {
    let easyChanged = 0;
    for (const song of SONGS) {
      const features = featuresOf(song), off = notesOf(generateAll(features, "k")), on = notesOf(generateAll(features, "k", ON));
      for (const level of ["normal", "hard", "hell"]) assert.deepEqual(on[level], off[level], `${level} at ${song.bpm} BPM`);
      if (JSON.stringify(on.easy) !== JSON.stringify(off.easy)) easyChanged++;
    }
    assert.ok(easyChanged > 0, "Easy is the level the flag changes");
  });

  it("plays only moments Normal plays, and fewer of them", () => {
    for (const song of SONGS) {
      const { easy, normal } = notesOf(generateAll(featuresOf(song), "k", ON));
      const normalMoments = momentsOf(normal);
      const outside = [...momentsOf(easy)].filter((t) => !normalMoments.has(t));
      assert.deepEqual(outside, [], `${song.bpm} BPM: Easy moments Normal does not play`);
      assert.ok(momentsOf(easy).size > 0, `${song.bpm} BPM: Easy plays something`);
      assert.ok(momentsOf(easy).size < normalMoments.size, `${song.bpm} BPM: ${momentsOf(easy).size} Easy against ${normalMoments.size} Normal moments`);
    }
  });

  it("keeps the limits of Easy: gaps between moments, jacks and notes per second", () => {
    const easy = DIFFICULTIES.easy;
    for (const song of SONGS) {
      const notes = generateAll(featuresOf(song), "k", ON).easy.notes;
      const times = [...momentsOf(notes)].sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= easy.minNoteGapMs, `${song.bpm} BPM: ${times[i] - times[i - 1]} ms gap at ${times[i]}`);
      const singles = notes.filter((n) => notes.filter((m) => m.t === n.t).length === 1).sort((a, b) => a.t - b.t);
      let run = 1;
      for (let i = 1; i < singles.length; i++) {
        run = singles[i].lane === singles[i - 1].lane && singles[i].t - singles[i - 1].t < 2000 ? run + 1 : 1;
        assert.ok(run <= easy.maxJack, `${song.bpm} BPM: a jack of ${run} at ${singles[i].t}`);
      }
      assert.ok(times.length / 64 <= easy.maxNpsCeiling, `${song.bpm} BPM: ${(times.length / 64).toFixed(2)} moments per second`);
    }
  });

  it("lays its own holds and chords on the kept moments: Easy is not a copy of Normal's notes", () => {
    const { easy, normal } = notesOf(generateAll(featuresOf(SONGS[3]), "k", ON));
    assert.notDeepEqual(easy, normal);
    const lanes = new Set(easy.map((n) => n.lane));
    assert.ok([...lanes].every((lane) => lane >= 0 && lane < 4));
  });
});
