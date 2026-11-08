const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, HARD_PLUS, INTERNAL_LEVELS, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll, generateChart, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const HARD = levelOf("hard");
const SONGS = {
  "120 BPM": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "150 BPM": () => makeLayeredFeatures({ bpm: 150, durationMs: 64000 }),
  "180 BPM": () => makeLayeredFeatures({ bpm: 180, durationMs: 64000 }),
  "120 BPM with holds": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, holdsEveryBeats: 16, sustainAtBeats: [8, 40, 72] }),
};
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const chartsOf = (song) => notesOf(generateAll(SONGS[song](), "k"));
const momentsOf = (notes) => [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);

describe("Hard built on Normal (part of Hard since v44, was the flag hardPlus)", () => {
  it("is part of Hard and no flag; hardBase is Hard as v43 charted it without the flag", () => {
    assert.equal(FLAGS.hardPlus, undefined);
    for (const [key, value] of Object.entries(HARD_PLUS)) assert.deepEqual(DIFFICULTIES.hard[key], value, key);
    assert.equal(DIFFICULTIES.hard.buildOn, "normal");
    assert.equal(DIFFICULTIES.hard.budgetScale, HARD_PLUS.budgetScale);
    assert.equal(INTERNAL_LEVELS.hardBase.buildOn, undefined);
    for (const level of ["easy", "normal", "hell"]) assert.notEqual(DIFFICULTIES[level].buildOn, "normal", level);
    assert.equal(INTERNAL_LEVELS.normalV26.buildOn, undefined);
  });

  it("changes Hard against hardBase, which is cut as Hard was without the flag", () => {
    for (const song of Object.keys(SONGS)) {
      const features = SONGS[song]();
      const base = generateChart(features, "hardBase", "k").notes;
      assert.notDeepEqual(chartsOf(song).hard, base, song);
    }
  });

  it("plays every moment of Normal, and more", () => {
    for (const song of Object.keys(SONGS)) {
      const { normal, hard } = chartsOf(song);
      const kept = new Set(momentsOf(hard));
      const lost = momentsOf(normal).filter((t) => !kept.has(t));
      assert.deepEqual(lost, [], `${song}: Normal moments missing from Hard`);
      assert.ok(momentsOf(hard).length > momentsOf(normal).length, `${song}: ${momentsOf(hard).length} against ${momentsOf(normal).length}`);
    }
  });

  describe("keeps Hard's limits", () => {
    for (const song of Object.keys(SONGS)) {
      const notes = chartsOf(song).hard;

      it(`${song}: min gap between moments and on a lane, and the jack`, () => {
        const times = momentsOf(notes);
        for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= HARD.minNoteGapMs, `${times[i - 1]} to ${times[i]}`);
        const last = [-Infinity, -Infinity, -Infinity, -Infinity];
        const run = [0, 0, 0, 0];
        for (const n of notes) {
          assert.ok(n.t - last[n.lane] >= HARD.minLaneGapMs, `lane ${n.lane} at ${n.t}`);
          for (let l = 0; l < 4; l++) run[l] = l === n.lane ? run[l] + 1 : 0;
          assert.ok(run[n.lane] <= HARD.maxJack, `a jack of ${run[n.lane]} at ${n.t}`);
          last[n.lane] = n.t + (n.len > 0 ? n.len : 0);
        }
      });

      it(`${song}: at most two holds running, none with a note on its lane`, () => {
        const ends = [];
        for (const h of notes.filter((n) => n.len > 0)) {
          const running = ends.filter((e) => e > h.t);
          assert.ok(running.length < 2, `a hold at ${h.t} under two others`);
          ends.splice(0, ends.length, ...running, h.t + h.len);
          assert.ok(!notes.some((n) => n !== h && n.lane === h.lane && n.t > h.t && n.t < h.t + h.len), `a note on the held lane ${h.lane} at ${h.t}`);
        }
      });
    }
  });

  it("the debugger traces the chart it makes", () => {
    const features = SONGS["120 BPM"]();
    const story = traceChart(features, "hard", "k");
    assert.deepEqual(story.notes.map(({ id, ...n }) => n), chartsOf("120 BPM").hard);
  });
});
