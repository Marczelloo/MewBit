const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, EASY_FROM_NORMAL, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const SONGS = [
  { bpm: 100, structure: "ABAB" },
  { bpm: 120, structure: "ABAB", holdsEveryBeats: 8 },
  { bpm: 150, structure: "AABA" },
  { bpm: 180, structure: "ABAB", sustainAtBeats: [4, 12, 20, 28] },
];
const featuresOf = (song) => makeLayeredFeatures({ ...song, durationMs: 64000 });
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const momentsOf = (notes) => new Set(notes.map((n) => n.t));

describe("Easy cut from today's Normal (part of Easy since v44, was the flag easyFromNormal)", () => {
  it("is part of Easy alone; easyV26 is Easy as v43 charted it without the flag", () => {
    assert.equal(FLAGS.easyFromNormal, undefined);
    for (const [key, value] of Object.entries(EASY_FROM_NORMAL)) assert.deepEqual(DIFFICULTIES.easy[key], value, key);
    assert.equal(DIFFICULTIES.easy.cutFrom, "normal");
    assert.equal(INTERNAL_LEVELS.easyV26.cutFrom, "normalV26");
    assert.equal(INTERNAL_LEVELS.easyV26.keepShare, undefined);
    for (const level of ["normal", "hard", "hell"]) assert.notEqual(DIFFICULTIES[level].cutFrom, "normal", level);
    // Normal's floor is the old Easy, as Easy itself is cut from Normal
    assert.equal(DIFFICULTIES.normal.notBelow, "easyV26");
  });

  it("changes Easy against easyV26", () => {
    let easyChanged = 0;
    for (const song of SONGS) {
      const features = featuresOf(song);
      if (JSON.stringify(notesOf(generateAll(features, "k")).easy) !== JSON.stringify(generateChart(features, "easyV26", "k").notes)) easyChanged++;
    }
    assert.ok(easyChanged > 0, "Easy is cut from Normal, easyV26 is not");
  });

  it("plays only moments Normal plays, and fewer of them", () => {
    for (const song of SONGS) {
      const { easy, normal } = notesOf(generateAll(featuresOf(song), "k"));
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
      const notes = generateAll(featuresOf(song), "k").easy.notes;
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
    const { easy, normal } = notesOf(generateAll(featuresOf(SONGS[3]), "k"));
    assert.notDeepEqual(easy, normal);
    const lanes = new Set(easy.map((n) => n.lane));
    assert.ok([...lanes].every((lane) => lane >= 0 && lane < 4));
  });
});
