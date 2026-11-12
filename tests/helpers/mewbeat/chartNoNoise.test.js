const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, NO_NOISE, NO_NOISE_EDGE } = require("../../../helpers/mewbeat/charts/difficulty");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { noiseLookup, withoutNoise } = require("../../../helpers/mewbeat/charts/noise");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const QUARTER = 125; // a quarter beat at 120 BPM
const NOISE_TO = 10000;
// A level without the rule (noNoiseEdge alone does nothing, see chartNoNoiseEdge, so it stays where it is).
const NO_RULE = flagWithout("withoutnonoise", "noNoise");

// A 120 BPM song with a pitched note on every beat. `noise` = [fromMs, toMs): there the bands' sounds sit halfway between the
// grid's quarter lines and nothing is pitched; `pitched: true` keeps the pitched notes in it, `onGrid: true` the sounds.
function song({ noise = null, pitched = false, onGrid = false, decoded = true } = {}) {
  const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: "ABCDEFGHIJKLMNOP" });
  const inNoise = (t) => noise && t >= noise[0] && t < noise[1];
  if (noise && !onGrid) {
    features.bands = features.bands.map((band) => ({
      ...band,
      onsets: band.onsets.map((o) => (inNoise(o.t) ? { ...o, t: Math.floor(o.t / QUARTER) * QUARTER + QUARTER / 2 } : o)),
    }));
  }
  if (decoded) {
    features.decodedNotes = [];
    for (let t = 0; t < 64000; t += 500) if (pitched || !inNoise(t)) features.decodedNotes.push({ t, len: 200, pitch: 60, vel: 0.5 });
  }
  return features;
}
const lookupOf = (features, edge = null) => {
  const ctx = analyse(features, []);
  return noiseLookup(ctx.raw, ctx.features, ctx.timing, NO_NOISE, edge);
};
const chartsOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))];

describe("sounds that are no music (noise.js)", () => {
  it("finds none in a song whose sounds sit on the grid and carry pitch", () => {
    assert.equal(lookupOf(song()), null);
  });

  it("calls noise a stretch off the grid with no pitched note, and nothing else", () => {
    const noiseAt = lookupOf(song({ noise: [0, NOISE_TO] }));
    assert.ok(noiseAt);
    for (const t of [0, 1000, 3000, 5000, 7000]) assert.equal(noiseAt(t), true, `at ${t}`);
    // the place is read over 4 s, so the edge is good to about a second
    for (const t of [NOISE_TO + 1500, 20000, 40000, 63000]) assert.equal(noiseAt(t), false, `at ${t}`);
    const middle = lookupOf(song({ noise: [30000, 40000] }));
    for (const t of [32000, 35000, 38000]) assert.equal(middle(t), true, `at ${t}`);
    for (const t of [10000, 28000, 42000, 60000]) assert.equal(middle(t), false, `at ${t}`);
  });

  it("needs both: sounds off the grid that carry pitch are music, and so are unpitched sounds on the grid", () => {
    assert.equal(lookupOf(song({ noise: [0, NOISE_TO], pitched: true })), null);
    assert.equal(lookupOf(song({ noise: [0, NOISE_TO], onGrid: true })), null);
  });

  it("says nothing without decoded notes, without a grid or without a rule", () => {
    assert.equal(lookupOf(song({ noise: [0, NOISE_TO], decoded: false })), null);
    const features = song({ noise: [0, NOISE_TO] });
    const ctx = analyse(features, []);
    assert.equal(noiseLookup(ctx.raw, ctx.features, { snapped: false }, NO_NOISE), null);
    assert.equal(noiseLookup(ctx.raw, ctx.features, ctx.timing, null), null);
  });

  it("drops the notes that start in the noise and keeps a hold that began before it", () => {
    const notes = [{ t: 500, lane: 0, len: 0 }, { t: 900, lane: 1, len: 600 }, { t: 1200, lane: 2, len: 0 }, { t: 2500, lane: 0, len: 0 }];
    const out = withoutNoise(notes, (t) => t >= 1000 && t < 2000);
    assert.deepEqual(out.map((n) => n.t), [500, 900, 2500]);
    assert.equal(out[1].len, 600);
    assert.equal(withoutNoise(notes, () => false), notes);
    assert.equal(withoutNoise(notes, null), notes);
  });
});

describe("no notes on sounds that are no music (noNoise)", () => {
  it("is a rule of every level (from v45)", () => {
    for (const level of LEVELS) assert.deepEqual(DIFFICULTIES[level].noNoise, NO_NOISE, level);
    // the levels the others are built on stay whole
    assert.equal(INTERNAL_LEVELS.hardBase.noNoise, undefined);
    assert.equal(INTERNAL_LEVELS.easyV26.noNoise, undefined);
  });

  it("leaves a song with no noise in it note for note on every level, with or without decoded notes", () => {
    for (const features of [song(), makeLayeredFeatures({ bpm: 120, durationMs: 64000 }), song({ noise: [0, NOISE_TO], pitched: true })]) {
      const off = chartsOf(features, NO_RULE), on = chartsOf(features);
      for (const level of LEVELS) assert.deepEqual(on[level], off[level], level);
    }
  });

  it("charts nothing in the noise and leaves the rest of every level note for note", () => {
    for (const noise of [[0, NOISE_TO], [30000, 40000], [54000, 64000]]) {
      const features = song({ noise });
      const noiseAt = lookupOf(features, NO_NOISE_EDGE); // the levels carry the edge too (chartNoNoiseEdge)
      const off = chartsOf(features, NO_RULE), on = chartsOf(features);
      for (const level of LEVELS) {
        assert.ok(momentsOf(off[level], noise[0] + 2000, noise[1] - 2000).length >= 4, `${noise} ${level}: the fixture charts the noise without the rule`);
        assert.deepEqual(momentsOf(on[level], noise[0] + 2000, noise[1] - 2000), [], `${noise} ${level} plays in the noise`);
        // the notes in the noise go and nothing else moves: a level built on another is built on the whole of it
        assert.deepEqual(on[level], off[level].filter((n) => !noiseAt(n.t)), `${noise} ${level}`);
      }
    }
  });

  it("keeps every moment of the level under it, and the lanes stay playable", () => {
    for (const noise of [[0, NOISE_TO], [30000, 40000], [54000, 64000]]) {
      const charts = chartsOf(song({ noise }));
      for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
        const mine = new Set(charts[level].map((n) => n.t));
        assert.deepEqual(momentsOf(charts[under]).filter((t) => !mine.has(t)), [], `${noise}: ${under} moments missing from ${level}`);
      }
      for (const level of LEVELS) {
        const byTime = new Map();
        for (const n of charts[level]) byTime.set(n.t, [...(byTime.get(n.t) ?? []), n.lane]);
        for (const [t, lanes] of byTime) {
          assert.equal(new Set(lanes).size, lanes.length, `${noise} ${level}: a lane twice at ${t}`);
          assert.ok(lanes.length < 4, `${noise} ${level}: four keys at ${t}`);
        }
        for (let lane = 0; lane < 4; lane++) {
          const own = charts[level].filter((n) => n.lane === lane).sort((a, b) => a.t - b.t);
          own.forEach((n, i) => {
            const next = own[i + 1];
            if (n.len > 0 && next) assert.ok(next.t >= n.t + n.len, `${noise} ${level}: a note at ${next.t} inside the hold at ${n.t} on lane ${lane}`);
          });
        }
      }
    }
  });
});
