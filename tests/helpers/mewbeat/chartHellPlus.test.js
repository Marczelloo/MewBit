const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, HELL_PLUS, INTERNAL_LEVELS, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const HELL = levelOf("hell");
const SONGS = {
  "120 BPM": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "180 BPM": () => makeLayeredFeatures({ bpm: 180, durationMs: 64000 }),
  "120 BPM with holds": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, holdsEveryBeats: 16, sustainAtBeats: [8, 40, 72] }),
};
const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
const chartsOf = (song) => notesOf(generateAll(SONGS[song](), "k"));
const momentsOf = (notes) => [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);

describe("Hell built on Hard (part of Hell since v44, was the flag hellPlus)", () => {
  it("is part of Hell and no flag; no level but Hell is built on Hard", () => {
    assert.equal(FLAGS.hellPlus, undefined);
    for (const [key, value] of Object.entries(HELL_PLUS)) assert.deepEqual(DIFFICULTIES.hell[key], value, key);
    assert.equal(DIFFICULTIES.hell.buildOn, "hard");
    assert.equal(DIFFICULTIES.hell.budgetScale, HELL_PLUS.budgetScale);
    for (const level of ["easy", "normal", "hard"]) assert.notEqual(DIFFICULTIES[level].buildOn, "hard", level);
    for (const level of Object.keys(INTERNAL_LEVELS)) assert.notEqual(INTERNAL_LEVELS[level].buildOn, "hard", level);
  });

  it("plays every moment of Hard, and more", () => {
    for (const song of Object.keys(SONGS)) {
      const { hard, hell } = chartsOf(song);
      const kept = new Set(momentsOf(hell));
      assert.deepEqual(momentsOf(hard).filter((t) => !kept.has(t)), [], `${song}: Hard moments missing from Hell`);
      assert.ok(momentsOf(hell).length > momentsOf(hard).length, `${song}: ${momentsOf(hell).length} against ${momentsOf(hard).length}`);
    }
  });

  describe("keeps Hell's limits", () => {
    for (const song of Object.keys(SONGS)) {
      it(`${song}: min gap between moments and on a lane, and the jack`, () => {
        const notes = chartsOf(song).hell;
        const times = momentsOf(notes);
        for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= HELL.minNoteGapMs, `${times[i - 1]} to ${times[i]}`);
        const last = [-Infinity, -Infinity, -Infinity, -Infinity];
        const run = [0, 0, 0, 0];
        for (const n of notes) {
          assert.ok(n.t - last[n.lane] >= HELL.minLaneGapMs, `lane ${n.lane} at ${n.t}`);
          for (let l = 0; l < 4; l++) run[l] = l === n.lane ? run[l] + 1 : 0;
          assert.ok(run[n.lane] <= HELL.maxJack, `a jack of ${run[n.lane]} at ${n.t}`);
          last[n.lane] = n.t + (n.len > 0 ? n.len : 0);
        }
      });
    }
  });

  it("the debugger traces the chart it makes", () => {
    const story = traceChart(SONGS["120 BPM"](), "hell", "k");
    assert.deepEqual(story.notes.map(({ id, ...n }) => n), chartsOf("120 BPM").hell);
  });
});
