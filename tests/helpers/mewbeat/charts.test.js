const assert = require("node:assert");
const { describe, it } = require("node:test");

const { GENERATOR_VERSION, generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { starsOf } = require("../../../helpers/mewbeat/charts/stars");
const { makeFeatures, threeSectionEnergy } = require("./fixtures");

const KEY = "youtube:fixture:180000";
const BEAT_MS = 500;

function fixture(overrides = {}) {
  return makeFeatures({ bpm: 120, confidence: 0.9, durationMs: 180000, energy: threeSectionEnergy, ...overrides });
}

function chartsOf(features) {
  const all = generateAll(features, KEY);
  assert.ok(all, "fixture should chart on every difficulty");
  return all;
}

function rate(notes, fromMs, toMs) {
  return notes.filter((n) => n.t >= fromMs && n.t < toMs).length / ((toMs - fromMs) / 1000);
}

function minSameLaneGap(notes) {
  const last = [-1e9, -1e9, -1e9, -1e9];
  let min = Infinity;
  for (const n of notes) {
    min = Math.min(min, n.t - last[n.lane]);
    last[n.lane] = n.t;
  }
  return min;
}

function countsByTime(notes) {
  const map = new Map();
  for (const n of notes) map.set(n.t, (map.get(n.t) || 0) + 1);
  return map;
}

describe("mewbeat chart generator", () => {
  it("isDeterministic: same input gives the same bytes", () => {
    const a = JSON.stringify(generateAll(fixture(), KEY));
    const b = JSON.stringify(generateAll(fixture(), KEY));
    assert.strictEqual(a, b);
  });

  it("sameLaneGapRespected", () => {
    const { easy, normal, hard } = chartsOf(fixture());
    assert.ok(minSameLaneGap(easy.notes) >= BEAT_MS - 2);
    assert.ok(minSameLaneGap(normal.notes) >= BEAT_MS / 2 - 2);
    assert.ok(minSameLaneGap(hard.notes) >= BEAT_MS / 4 - 2);
  });

  it("chordRules", () => {
    const features = fixture();
    const { easy, normal, hard } = chartsOf(features);
    assert.strictEqual([...countsByTime(easy.notes).values()].filter((c) => c > 1).length, 0);
    for (const chart of [normal, hard]) {
      assert.ok([...countsByTime(chart.notes).values()].every((c) => c <= 2), `${chart.difficulty}: 3+ note chord`);
    }
    const downbeats = new Set(features.tempo.downbeats);
    const normalChords = [...countsByTime(normal.notes)].filter(([, c]) => c === 2);
    assert.ok(normalChords.length > 0, "normal should have some chords");
    assert.ok(normalChords.every(([t]) => downbeats.has(t)));
    assert.ok([...countsByTime(hard.notes).values()].some((c) => c === 2), "hard should have some chords");
  });

  it("densityOrder", () => {
    const { easy, normal, hard } = chartsOf(fixture());
    assert.ok(easy.notes.length < normal.notes.length);
    assert.ok(normal.notes.length < hard.notes.length);
  });

  it("followsEnergy", () => {
    const all = chartsOf(fixture());
    for (const chart of Object.values(all)) {
      assert.ok(
        rate(chart.notes, 60000, 120000) >= 2 * rate(chart.notes, 0, 60000),
        `${chart.difficulty}: loud ${rate(chart.notes, 60000, 120000)} vs quiet ${rate(chart.notes, 0, 60000)}`,
      );
    }
  });

  it("hardIsNotNormalPlusNoise", () => {
    const { normal, hard } = chartsOf(fixture());
    const inNormal = new Set(normal.notes.map((n) => `${n.t}:${n.lane}`));
    const shared = hard.notes.filter((n) => inNormal.has(`${n.t}:${n.lane}`)).length / hard.notes.length;
    assert.ok(shared <= 0.85, `shared share ${shared}`);
  });

  it("onGridWhenConfident", () => {
    const { easy, normal } = chartsOf(fixture());
    const distToGrid = (t, stepMs) => Math.abs(t - Math.round(t / stepMs) * stepMs);
    for (const n of easy.notes) assert.ok(distToGrid(n.t, BEAT_MS / 2) <= 3, `easy t=${n.t}`);
    for (const n of normal.notes) assert.ok(distToGrid(n.t, BEAT_MS / 4) <= 3, `normal t=${n.t}`);
  });

  it("normal uses the 1/2 grid in quiet parts", () => {
    const { normal } = chartsOf(fixture());
    const quiet = normal.notes.filter((n) => n.t < 60000);
    assert.ok(quiet.length > 0);
    assert.ok(quiet.every((n) => Math.abs(n.t - Math.round(n.t / (BEAT_MS / 2)) * (BEAT_MS / 2)) <= 3));
  });

  it("hard snaps to 1/8 only for very strong onsets", () => {
    const features = fixture({ energy: () => 1 });
    // 1/8 beat is 62.5 ms: 20062/20063 is off the 1/4 grid, so only a 1/8 snap can keep it.
    features.bands[0].onsets.push({ t: 20063, s: 0.95 }, { t: 21063, s: 0.5 });
    const hard = generateChart(features, "hard", KEY);
    const offQuarterGrid = (t) => Math.abs(t - Math.round(t / 125) * 125) > 3;
    const strong = hard.notes.filter((n) => n.t >= 20000 && n.t <= 20125 && offQuarterGrid(n.t));
    const weak = hard.notes.filter((n) => n.t >= 21000 && n.t <= 21125 && offQuarterGrid(n.t));
    assert.strictEqual(strong.length, 1, "strong onset keeps its 1/8 position");
    assert.strictEqual(weak.length, 0, "weak onset is snapped to the 1/4 grid");
  });

  it("leadInAndSilence", () => {
    const features = fixture({ energy: (ms) => (ms >= 30000 && ms < 40000 ? 0 : 1) });
    for (const chart of Object.values(chartsOf(features))) {
      assert.ok(chart.notes.every((n) => n.t >= 1500), `${chart.difficulty}: note in lead-in`);
      assert.ok(
        chart.notes.every((n) => n.t < 30000 || n.t >= 40000),
        `${chart.difficulty}: note in silence`,
      );
    }
  });

  it("ambientIsUnchartedOrPlayable", () => {
    const features = makeFeatures({
      confidence: 0.1,
      durationMs: 120000,
      energy: () => 0.1,
      onsetEveryBeats: 16,
    });
    const all = generateAll(features, KEY);
    if (all !== null) {
      for (const chart of Object.values(all)) assert.ok(chart.notes.length >= 20);
    }
    for (const d of ["easy", "normal", "hard"]) {
      const chart = generateChart(features, d, KEY);
      assert.ok(chart === null || chart.notes.length >= 20);
    }
  });

  it("charts a dense low-confidence track on the raw-time path with playable gaps", () => {
    const features = fixture({ confidence: 0.35, energy: () => 1 });
    const all = chartsOf(features);
    for (const [name, minGap] of [["easy", 250], ["normal", 125], ["hard", 62.5]]) {
      const times = [...new Set(all[name].notes.map((n) => n.t))];
      for (let i = 1; i < times.length; i++) {
        assert.ok(times[i] - times[i - 1] >= minGap - 1, `${name}: ${times[i - 1]} -> ${times[i]}`);
      }
    }
    assert.ok(minSameLaneGap(all.easy.notes) >= 500 - 2);
    assert.ok(minSameLaneGap(all.normal.notes) >= 250 - 2);
    assert.ok(minSameLaneGap(all.hard.notes) >= 125 - 2);
    assert.ok(all.easy.notes.length < all.normal.notes.length && all.normal.notes.length < all.hard.notes.length);
  });

  it("limits same-lane runs to 2 on easy/normal and 3 on hard", () => {
    const all = chartsOf(fixture({ energy: () => 1 }));
    const maxRun = (chart) => {
      // Easy has no chords; for the others only single-note moments are compared.
      const singles = [];
      const counts = countsByTime(chart.notes);
      for (const n of chart.notes) if (counts.get(n.t) === 1) singles.push(n.lane);
      let run = 1;
      let best = 1;
      for (let i = 1; i < singles.length; i++) {
        run = singles[i] === singles[i - 1] ? run + 1 : 1;
        best = Math.max(best, run);
      }
      return best;
    };
    assert.ok(maxRun(all.easy) <= 2);
    assert.ok(maxRun(all.normal) <= 2);
    assert.ok(maxRun(all.hard) <= 3);
  });

  it("starsOrder", () => {
    const { easy, normal, hard } = chartsOf(fixture());
    assert.ok(starsOf(easy) < starsOf(normal));
    assert.ok(starsOf(normal) < starsOf(hard));
  });

  it("formatShape", () => {
    const chart = generateChart(fixture(), "normal", KEY);
    assert.deepStrictEqual(Object.keys(chart), [
      "version", "audioKey", "difficulty", "durationMs", "stars", "highlightMs", "notes",
    ]);
    assert.strictEqual(chart.version, GENERATOR_VERSION);
    assert.strictEqual(chart.audioKey, KEY);
    assert.strictEqual(chart.difficulty, "normal");
    assert.strictEqual(chart.durationMs, 180000);
    assert.strictEqual(chart.highlightMs, 90000);
    assert.strictEqual(chart.stars, Math.round(chart.stars * 10) / 10);
    for (const n of chart.notes) {
      assert.deepStrictEqual(Object.keys(n), ["t", "lane"]);
      assert.ok(Number.isInteger(n.t));
      assert.ok(Number.isInteger(n.lane) && n.lane >= 0 && n.lane <= 3);
    }
    for (let i = 1; i < chart.notes.length; i++) {
      const a = chart.notes[i - 1];
      const b = chart.notes[i];
      assert.ok(a.t < b.t || (a.t === b.t && a.lane < b.lane));
    }
  });

  it("passes a null highlight through and returns null when too sparse", () => {
    assert.strictEqual(generateChart(fixture({ highlightMs: null }), "easy", KEY).highlightMs, null);
    const sparse = fixture({ energy: () => 0.1, durationMs: 40000 });
    assert.strictEqual(generateChart(sparse, "easy", KEY), null);
    assert.strictEqual(generateAll(sparse, KEY), null);
  });
});
