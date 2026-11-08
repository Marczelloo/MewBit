const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { analyse, generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { isRepeatOf, onGrid } = require("../../../helpers/mewbeat/charts/phrases");
const { sourceWindow } = require("../../../helpers/mewbeat/charts/repeats");
const { makeLayeredFeatures } = require("./fixtures");

const KEY = "youtube:phrasegrid:64000";
const LEVELS = ["easy", "normal", "hard", "hell"];

// A steady 120 BPM grid: beats every 500 ms, quarter-beat points every 125 ms.
const BEATS = Array.from({ length: 200 }, (_, i) => i * 500);
const timing = {
  snapped: true,
  beats: BEATS,
  beatMsAt: () => 500,
  gridPoints: (div) => BEATS.flatMap((b) => Array.from({ length: div }, (_, k) => b + (500 * k) / div)),
};

// The plugin's bounds, a millisecond off the beat as in Cutie Mew Mew Magic (58731 against a moment at 58730).
const offBeat = (features) => {
  const list = features.phrases.list.map((p, i) => ({ ...p, startMs: i === 0 ? p.startMs : p.startMs + 1, endMs: i === features.phrases.list.length - 1 ? p.endMs : p.endMs + 1 }));
  return { ...features, phrases: { ...features.phrases, list } };
};

describe("phrase bounds on the grid (v33)", () => {
  it("onGrid moves a bound a few ms off the grid onto its point, and leaves the song's start and end", () => {
    const phrases = [{ startMs: 0, endMs: 8001 }, { startMs: 8001, endMs: 15997 }, { startMs: 15997, endMs: 20003 }];
    assert.deepEqual(onGrid(phrases, timing).map((p) => [p.startMs, p.endMs]), [[0, 8000], [8000, 16000], [16000, 20003]]);
  });

  it("onGrid leaves a bound farther than a sixteenth of a beat from the grid, and does nothing without a grid", () => {
    const phrases = [{ startMs: 0, endMs: 8040 }, { startMs: 8040, endMs: 16000 }];
    assert.deepEqual(onGrid(phrases, timing).map((p) => p.startMs), [0, 8040]);
    assert.equal(onGrid(phrases, { snapped: false }), phrases);
  });

  it("sourceWindow on a grid moves the window back by whole beats, onto the grid", () => {
    const phrase = { startMs: 20000, endMs: 28000, lagMs: 16001 };
    assert.deepEqual(sourceWindow(phrase, { startMs: 4000 }, timing), { from: 4000, to: 12000 });
    assert.deepEqual(sourceWindow(phrase, { startMs: 4000 }), { from: 3999, to: 11999 });
  });

  it("puts the analysed phrase bounds on the grid points of the moments", () => {
    const features = offBeat(makeLayeredFeatures({ bpm: 120, durationMs: 64000 }));
    const { phrases, timing: analysed } = analyse(features);
    const grid = new Set(analysed.gridPoints(4));
    assert.ok(features.phrases.list.slice(1).every((p) => !grid.has(p.startMs)), "the fixture's bounds start off the grid");
    assert.ok(phrases.slice(1).every((p) => grid.has(p.startMs)));
  });

  it("gives every repeat the first beat its source plays, on every level", () => {
    const features = offBeat(makeLayeredFeatures({ bpm: 120, durationMs: 64000 }));
    const charts = generateAll(features, KEY);
    // Since v44 Easy is cut from Normal and may drop the first moment of a repeat (the same exception chartsV4 allows
    // for a repeat's first moment), so the first beat is asserted on easyV26, the Easy that was charted on its own.
    const notes = { ...Object.fromEntries(LEVELS.map((l) => [l, charts[l].notes])), easy: generateChart(features, "easyV26", KEY).notes };
    const { phrases } = analyse(features);
    for (const level of LEVELS) {
      const times = new Set(notes[level].map((n) => n.t));
      phrases.forEach((p, i) => {
        if (!isRepeatOf(p, i) || !times.has(phrases[p.repeatOf].startMs)) return;
        assert.ok(times.has(p.startMs), `${level}: phrase ${i} at ${p.startMs}`);
      });
    }
  });
});
