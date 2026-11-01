const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { busyFactor, effectiveDifficulty, strongOnsetRate } = require("../../../helpers/mewbeat/charts/busyness");
const {
  BUSY_MAX_FACTOR,
  BUSY_MEDIAN_RATE,
  BUSY_MIN_FACTOR,
  DIFFICULTIES,
} = require("../../../helpers/mewbeat/charts/difficulty");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

// The same song with only every `keep`-th onset left: sparser, but otherwise identical.
function thinned(features, keep) {
  return {
    ...features,
    bands: features.bands.map((b) => ({ ...b, onsets: b.onsets.filter((_, i) => i % keep === 0) })),
  };
}

// Every onset made strong, which is what a dense, loud song looks like to the busyness measure.
function allStrong(features) {
  return {
    ...features,
    bands: features.bands.map((b) => ({ ...b, onsets: b.onsets.map((o) => ({ ...o, s: Math.max(o.s, 0.9) })) })),
  };
}

// A song with a flat rate of strong onsets: `perSecond` onsets of strength 1, in one band.
function withRate(perSecond, durationMs = 60000) {
  const features = makeFeatures({ durationMs, energy: () => 0.8 });
  const step = 1000 / perSecond;
  const onsets = [];
  for (let t = 2000; t < durationMs - 100; t += step) onsets.push({ t: Math.round(t), s: 1 });
  features.bands = features.bands.map((b, i) => ({ ...b, onsets: i === 0 ? onsets : [] }));
  return features;
}

const nps = (chart) => chart.notes.length / (chart.durationMs / 1000);

// Most note moments (a chord counts once, as in the density cap) in any fixed 2 s window.
function busiestWindow(notes) {
  const counts = new Map();
  for (const t of new Set(notes.map((n) => n.t))) counts.set(Math.floor(t / 2000), (counts.get(Math.floor(t / 2000)) ?? 0) + 1);
  return Math.max(...counts.values());
}

describe("busyness", () => {
  it("counts strong onsets per second of audible audio only", () => {
    const features = makeFeatures({ durationMs: 60000, energy: (ms) => (ms < 30000 ? 0.8 : 0) });
    features.bands = features.bands.map((b, i) => ({
      ...b,
      onsets: i === 0 ? [{ t: 2000, s: 0.9 }, { t: 3000, s: 0.5 }, { t: 4000, s: 0.49 }, { t: 40000, s: 1 }] : [],
    }));
    // 3 strong onsets (0.49 is weak) over the 30 audible seconds.
    assert.ok(Math.abs(strongOnsetRate(features) - 0.1) < 1e-9, String(strongOnsetRate(features)));
  });

  it("is neutral when it cannot be measured", () => {
    assert.equal(busyFactor({ bands: [], energy: { hopMs: 500, values: [] } }), 1);
    assert.equal(busyFactor({}), 1);
  });

  it("scales with the onset rate and clamps at both ends", () => {
    assert.ok(Math.abs(busyFactor(withRate(BUSY_MEDIAN_RATE)) - 1) < 0.05, String(busyFactor(withRate(BUSY_MEDIAN_RATE))));
    assert.equal(busyFactor(withRate(1)), BUSY_MIN_FACTOR);
    assert.equal(busyFactor(withRate(60)), BUSY_MAX_FACTOR);
    const mid = busyFactor(withRate(BUSY_MEDIAN_RATE * 1.2));
    assert.ok(mid > 1.1 && mid < BUSY_MAX_FACTOR, String(mid));
  });

  it("effective maxNps follows the factor but never passes the difficulty's ceiling", () => {
    for (const name of ["easy", "normal", "hard"]) {
      const d = DIFFICULTIES[name];
      assert.ok(d.maxNpsCeiling >= d.maxNps, name);
      assert.equal(effectiveDifficulty(d, 1).maxNps, d.maxNps);
      assert.equal(effectiveDifficulty(d, 0.8).maxNps, d.maxNps * 0.8);
      assert.equal(effectiveDifficulty(d, 100).maxNps, d.maxNpsCeiling);
      assert.equal(effectiveDifficulty(d, BUSY_MAX_FACTOR).maxNps <= d.maxNpsCeiling, true);
    }
    assert.equal(effectiveDifficulty(DIFFICULTIES.hard, 1).maxNps, 9);
  });

  it("a busy song charts more notes than the same song made sparse, on every difficulty", () => {
    const busy = makeFeatures({ durationMs: 120000, energy: () => 0.9, onsetEveryBeats: 0.125, bpm: 150 });
    const sparse = thinned(busy, 8);
    assert.ok(busyFactor(busy) > busyFactor(sparse));
    const a = generateAll(busy, "k");
    const b = generateAll(sparse, "k");
    for (const d of ["easy", "normal", "hard"]) assert.ok(nps(a[d]) > nps(b[d]), `${d}: ${nps(a[d])} vs ${nps(b[d])}`);
    assert.ok(a.normal.stars > b.normal.stars, `${a.normal.stars} vs ${b.normal.stars}`);
  });

  it("no 2 s window passes the difficulty's ceiling, however busy the song", () => {
    const frantic = allStrong(makeFeatures({ durationMs: 90000, energy: () => 1, onsetEveryBeats: 0.125, bpm: 150 }));
    assert.equal(busyFactor(frantic), BUSY_MAX_FACTOR);
    const all = generateAll(frantic, "k");
    for (const d of ["easy", "normal", "hard"]) {
      // The band path thins per fixed 2 s window and carries up to one note over: ceiling * 2 s + 1.
      assert.ok(busiestWindow(all[d].notes) <= DIFFICULTIES[d].maxNpsCeiling * 2 + 1, `${d}: ${busiestWindow(all[d].notes)}`);
      assert.ok(new Set(all[d].notes.map((n) => n.t)).size / (all[d].durationMs / 1000) <= DIFFICULTIES[d].maxNpsCeiling, `${d}: mean`);
    }
  });

  it("a half-time busy song still builds a usable timing", () => {
    assert.equal(buildTiming(withRate(14), 60000).snapped, true);
  });
});
