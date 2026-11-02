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

  it("does not depend on the audioKey: no RNG in chart generation", () => {
    const features = fixture({ energy: () => 1 });
    for (const difficulty of ["easy", "normal", "hard"]) {
      const a = generateChart(features, difficulty, "a");
      const b = generateChart(features, difficulty, "b");
      assert.deepStrictEqual(b, { ...a, audioKey: "b" }, difficulty);
    }
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
    for (const chart of [easy, normal, hard]) {
      assert.ok([...countsByTime(chart.notes).values()].every((c) => c <= 2), `${chart.difficulty}: 3+ note chord`);
    }
    for (const [chart, allowed] of [[easy, features.tempo.downbeats], [normal, features.tempo.beats]]) {
      const chords = [...countsByTime(chart.notes)].filter(([, c]) => c === 2);
      assert.ok(chords.length > 0, `${chart.difficulty} should have some chords`);
      assert.ok(chords.every(([t]) => allowed.includes(t)), `${chart.difficulty}: a chord where it has no place`);
    }
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
      // Rests are filled on Easy and Normal, so the beat is their floor where the music plays: less room to grow.
      const factor = chart.difficulty === "easy" || chart.difficulty === "normal" ? 1.4 : 2;
      assert.ok(
        rate(chart.notes, 60000, 120000) >= factor * rate(chart.notes, 0, 60000),
        `${chart.difficulty}: loud ${rate(chart.notes, 60000, 120000)} vs quiet ${rate(chart.notes, 0, 60000)}`,
      );
    }
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

  describe("absolute playability floors", () => {
    const MIN_LANE_GAP_MS = { easy: 350, normal: 200, hard: 150, hell: 110 };
    const MIN_EASY_NOTE_GAP_MS = 200;
    const scenarios = {
      "180 BPM confident": () => makeFeatures({ bpm: 180, confidence: 0.9, durationMs: 120000, energy: () => 1 }),
      "200 BPM confident": () => makeFeatures({ bpm: 200, confidence: 0.9, durationMs: 120000, energy: () => 1 }),
      "180 BPM low confidence": () => makeFeatures({ bpm: 180, confidence: 0.35, durationMs: 120000, energy: () => 1 }),
    };

    for (const [name, build] of Object.entries(scenarios)) {
      it(`keeps same-lane gaps above the per-difficulty floor: ${name}`, () => {
        for (const chart of Object.values(chartsOf(build()))) {
          const min = minSameLaneGap(chart.notes);
          assert.ok(min >= MIN_LANE_GAP_MS[chart.difficulty], `${chart.difficulty}: ${min} ms`);
        }
      });

      it(`keeps easy notes at least 200 ms apart in any lane: ${name}`, () => {
        const times = [...new Set(chartsOf(build()).easy.notes.map((n) => n.t))];
        for (let i = 1; i < times.length; i++) {
          assert.ok(times[i] - times[i - 1] >= MIN_EASY_NOTE_GAP_MS, `${times[i - 1]} -> ${times[i]}`);
        }
      });
    }
  });

  it("limits same-lane runs to 2 on easy and normal and 3 on hard, chords included", () => {
    const all = chartsOf(fixture({ energy: () => 1 }));
    const maxRun = (chart) => {
      // Longest streak of consecutive note moments (chords are one moment) that use the same lane.
      const moments = new Map();
      for (const n of chart.notes) moments.set(n.t, [...(moments.get(n.t) || []), n.lane]);
      const runs = [0, 0, 0, 0];
      let best = 0;
      for (const lanes of moments.values()) {
        for (let l = 0; l < 4; l++) runs[l] = lanes.includes(l) ? runs[l] + 1 : 0;
        best = Math.max(best, ...runs);
      }
      return best;
    };
    assert.ok([...countsByTime(all.hard.notes).values()].some((c) => c === 2), "hard run test needs chords");
    assert.ok(maxRun(all.easy) <= 2);
    assert.ok(maxRun(all.normal) <= 2);
    assert.ok(maxRun(all.hard) <= 3);
  });

  describe("untrustworthy tempo.beats", () => {
    const FLOORS = { easy: 250, normal: 125, hard: 62.5, hell: 62.5 };

    it("keeps its density when beats are missing for 60-120 s", () => {
      const full = chartsOf(fixture());
      const gapped = fixture();
      gapped.tempo.beats = gapped.tempo.beats.filter((t) => t < 60000 || t >= 120000);
      gapped.tempo.downbeats = gapped.tempo.downbeats.filter((t) => t < 60000 || t >= 120000);
      const gappedCharts = chartsOf(gapped);
      for (const d of Object.keys(FLOORS)) {
        const ratio = rate(gappedCharts[d].notes, 60000, 120000) / rate(full[d].notes, 60000, 120000);
        assert.ok(ratio >= 0.5 && ratio <= 2, `${d}: ratio ${ratio}`);
      }
    });

    it("never moves a note far from its onset when only every 4th beat is kept", () => {
      const sparse = fixture();
      sparse.tempo.beats = sparse.tempo.beats.filter((_, i) => i % 4 === 0);
      const onsets = [...new Set(sparse.bands.flatMap((b) => b.onsets.map((o) => o.t)))].sort((a, b) => a - b);
      for (const chart of Object.values(chartsOf(sparse))) {
        for (const n of chart.notes) {
          const nearest = Math.min(...onsets.filter((t) => Math.abs(t - n.t) <= 200).map((t) => Math.abs(t - n.t)));
          assert.ok(nearest <= 60, `${chart.difficulty}: note ${n.t} is ${nearest} ms from an onset`);
        }
      }
    });

    it("never puts notes closer than the floor around a near-duplicate beat", () => {
      const noisy = fixture({ energy: () => 1 });
      const extra = noisy.tempo.beats.filter((_, i) => i % 6 === 3).map((t) => t + 20);
      noisy.tempo.beats = [...noisy.tempo.beats, ...extra].sort((a, b) => a - b);
      for (const chart of Object.values(chartsOf(noisy))) {
        const times = [...new Set(chart.notes.map((n) => n.t))];
        for (let i = 1; i < times.length; i++) {
          // 0.98: a snapped note may sit 2% under the floor (beat jitter), nothing more.
          assert.ok(
            times[i] - times[i - 1] >= 0.98 * FLOORS[chart.difficulty] - 1,
            `${chart.difficulty}: ${times[i - 1]} -> ${times[i]}`,
          );
        }
      }
    });

    it("applies the note floor on the snapped path too, scaled to the tempo above 120 BPM", () => {
      // At 180 BPM a beat is 333 ms: the floor is the difficulty's grid step (98%), not 250/125/62.5.
      const fast = makeFeatures({ bpm: 180, confidence: 0.9, durationMs: 120000, energy: () => 1 });
      const floors = { easy: 0.98 * 0.5 * 333, normal: 0.98 * 0.25 * 333, hard: 0.98 * 0.125 * 333, hell: 0.98 * 0.125 * 333 };
      for (const chart of Object.values(chartsOf(fast))) {
        const times = [...new Set(chart.notes.map((n) => n.t))];
        for (let i = 1; i < times.length; i++) {
          assert.ok(times[i] - times[i - 1] >= floors[chart.difficulty] - 2, `${chart.difficulty}: ${times[i]}`);
        }
      }
    });
  });

  describe("input validation", () => {
    it("treats non-iterable onsets and null bands as empty", () => {
      const features = fixture();
      features.bands.push({ name: "low", onsets: 5 }, { name: "high", onsets: null }, null);
      assert.doesNotThrow(() => generateAll(features, KEY));
    });

    it("emits highlightMs only when it is a finite number inside the track", () => {
      for (const bad of [Number.NaN, -1, 180001, "90000", Infinity, undefined]) {
        const features = fixture();
        features.highlightMs = bad;
        assert.strictEqual(generateChart(features, "easy", KEY).highlightMs, null, String(bad));
      }
      assert.strictEqual(generateChart(fixture({ highlightMs: 0 }), "easy", KEY).highlightMs, 0);
      assert.strictEqual(generateChart(fixture({ highlightMs: 180000 }), "easy", KEY).highlightMs, 180000);
    });

    it("stays bounded when the first beat is absurdly far from the track", () => {
      const features = fixture();
      features.tempo.beats = [1e12, 1e12 + 500, 1e12 + 1000];
      const started = Date.now();
      assert.doesNotThrow(() => generateAll(features, KEY));
      assert.ok(Date.now() - started < 2000);
    });
  });

  it("starsOrder", () => {
    const { easy, normal, hard } = chartsOf(fixture());
    assert.ok(starsOf(easy) < starsOf(normal));
    assert.ok(starsOf(normal) < starsOf(hard));
  });

  it("formatShape", () => {
    const chart = generateChart(fixture(), "normal", KEY);
    assert.deepStrictEqual(Object.keys(chart), [
      "version", "audioKey", "difficulty", "durationMs", "stars", "bpm", "highlightMs", "notes",
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
