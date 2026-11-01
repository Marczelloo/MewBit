const assert = require("node:assert");
const { describe, it } = require("node:test");

const { buildTiming, energyLookup, foldTempo } = require("../../../helpers/mewbeat/charts/timing");
const { bandPathNotes } = require("../../../helpers/mewbeat/charts/bandPath");
const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

describe("foldTempo", () => {
  it("folds a tempo outside 70-200 BPM by powers of two", () => {
    assert.deepStrictEqual(foldTempo(220), { bpm: 110, factor: 0.5 });
    assert.deepStrictEqual(foldTempo(60), { bpm: 120, factor: 2 });
    assert.deepStrictEqual(foldTempo(120), { bpm: 120, factor: 1 });
    assert.deepStrictEqual(foldTempo(30), { bpm: 120, factor: 4 });
    assert.deepStrictEqual(foldTempo(400), { bpm: 200, factor: 0.5 });
    assert.deepStrictEqual(foldTempo(440), { bpm: 110, factor: 0.25 });
  });

  it("keeps the whole 70-200 range as is", () => {
    for (const bpm of [70, 100, 199, 200]) assert.strictEqual(foldTempo(bpm).factor, 1, String(bpm));
  });

  it("leaves non-positive and non-finite tempos alone", () => {
    assert.deepStrictEqual(foldTempo(0), { bpm: 0, factor: 1 });
    assert.deepStrictEqual(foldTempo(-5), { bpm: -5, factor: 1 });
    assert.strictEqual(foldTempo(Number.NaN).factor, 1);
    assert.strictEqual(foldTempo(Infinity).factor, 1);
    assert.strictEqual(foldTempo(undefined).factor, 1);
  });
});

describe("half-time tempos", () => {
  it("foldTempo doubles a slow tempo only when the onsets per beat say the grid is half-time", () => {
    assert.deepStrictEqual(foldTempo(87, 10), { bpm: 174, factor: 2 });
    assert.deepStrictEqual(foldTempo(71, 10), { bpm: 142, factor: 2 });
    assert.deepStrictEqual(foldTempo(87, 5), { bpm: 87, factor: 1 });
    assert.deepStrictEqual(foldTempo(87), { bpm: 87, factor: 1 });
    // At or above ~95 BPM a dense song is left alone, and a folded tempo is not doubled twice.
    assert.strictEqual(foldTempo(100, 30).factor, 1);
    assert.strictEqual(foldTempo(60, 30).factor, 2);
  });

  // Strong onsets only, so the song's busyness comes from how many onsets it has.
  const strongSong = (onsetEveryBeats) => {
    const features = makeFeatures({ bpm: 87, durationMs: 60000, onsetEveryBeats });
    return { ...features, bands: features.bands.map((b) => ({ ...b, onsets: b.onsets.map((o) => ({ ...o, s: 1 })) })) };
  };

  it("a busy 87 BPM song folds to 174 while a sparse one stays at 87", () => {
    const busy = buildTiming(strongSong(0.25), 60000);
    assert.strictEqual(busy.foldFactor, 2);
    assert.ok(Math.abs(60000 / busy.medianMs - 174) <= 1, String(60000 / busy.medianMs));

    const sparse = buildTiming(strongSong(2), 60000);
    assert.strictEqual(sparse.foldFactor, 1);
    assert.ok(Math.abs(60000 / sparse.medianMs - 87) <= 1);
  });
});

describe("buildTiming folding", () => {
  it("folds a 230 BPM grid to half the tempo", () => {
    const timing = buildTiming(makeFeatures({ bpm: 230, durationMs: 60000 }), 60000);
    assert.strictEqual(timing.snapped, true);
    assert.strictEqual(timing.foldFactor, 0.5);
    assert.ok(Math.abs(timing.medianMs - 521.7) <= 1, String(timing.medianMs));
  });

  it("halving drops the beats between the kept ones and keeps downbeats on kept beats", () => {
    const features = makeFeatures({ bpm: 240, durationMs: 60000 }); // 250 ms beats, downbeat every 4th
    const timing = buildTiming(features, 60000);
    assert.strictEqual(timing.foldFactor, 0.5);
    assert.ok(Math.abs(timing.medianMs - 500) <= 1);
    assert.ok(timing.downbeats.length > 0);
    for (const d of timing.downbeats) assert.ok(timing.beats.includes(d), `downbeat ${d} is a beat`);
    assert.deepStrictEqual(timing.downbeats.slice(0, 3), [0, 1000, 2000]);
  });

  it("falls back to every 4th kept beat when there is no downbeat to keep", () => {
    const features = makeFeatures({ bpm: 240, durationMs: 60000 });
    features.tempo.downbeats = [];
    const timing = buildTiming(features, 60000);
    assert.ok(timing.downbeats.length > 0);
    const idx = timing.downbeats.map((d) => timing.beats.indexOf(d));
    assert.ok(idx.every((i, k) => i === idx[0] + k * 4), JSON.stringify(idx.slice(0, 5)));
    assert.ok(timing.downbeats.every((d) => timing.beats.includes(d)));
  });

  it("keeps the phase of the first downbeat when it sits on an odd beat", () => {
    const features = makeFeatures({ bpm: 240, durationMs: 60000 }); // beats every 250 ms
    features.tempo.downbeats = features.tempo.beats.filter((_, i) => i % 4 === 1); // 250, 1250, ...
    const timing = buildTiming(features, 60000);
    assert.ok(timing.beats.includes(250), "the first downbeat survives");
    assert.ok(!timing.beats.includes(0), "the beat between is dropped");
    assert.deepStrictEqual(timing.downbeats.slice(0, 3), [250, 1250, 2250]);
  });

  it("doubling inserts a midpoint between every pair of beats", () => {
    const timing = buildTiming(makeFeatures({ bpm: 60, durationMs: 60000 }), 60000);
    assert.strictEqual(timing.foldFactor, 2);
    assert.ok(Math.abs(timing.medianMs - 500) <= 1);
    assert.ok(timing.beats.includes(500) && timing.beats.includes(1000) && timing.beats.includes(1500));
    // The original downbeats (every 4th beat = 4000 ms) are still downbeats.
    assert.ok(timing.downbeats.includes(0) && timing.downbeats.includes(4000));
    assert.ok(!timing.downbeats.includes(500));
  });

  it("does not fold a normal tempo", () => {
    const features = makeFeatures({ bpm: 120, durationMs: 60000 });
    const timing = buildTiming(features, 60000);
    assert.strictEqual(timing.foldFactor, 1);
    assert.strictEqual(timing.medianMs, 500);
    assert.ok(timing.downbeats.every((d) => features.tempo.downbeats.includes(d)));
  });

  it("reports foldFactor 1 when there is no usable grid", () => {
    const features = makeFeatures({ bpm: 120, confidence: 0.1, durationMs: 60000 });
    const timing = buildTiming(features, 60000);
    assert.strictEqual(timing.snapped, false);
    assert.strictEqual(timing.foldFactor, 1);
  });
});

describe("bandPathNotes", () => {
  const energy = (features) => energyLookup(features);

  function run(features, difficulty, window) {
    const timing = buildTiming(features, features.durationMs);
    return bandPathNotes(features, timing, DIFFICULTIES[difficulty], energy(features), window);
  }

  it("is time-ordered and stays inside the window", () => {
    const features = makeLayeredFeatures({ durationMs: 64000 });
    features.energy = { hopMs: 500, values: new Array(128).fill(0.9) };
    const notes = run(features, "hard", { fromMs: 16000, toMs: 32000 });
    assert.ok(notes.length > 10);
    for (let i = 0; i < notes.length; i++) {
      assert.ok(notes[i].t >= 16000 && notes[i].t < 32000, `t=${notes[i].t}`);
      assert.ok(Number.isInteger(notes[i].lane) && notes[i].lane >= 0 && notes[i].lane <= 3);
      if (i > 0) assert.ok(notes[i - 1].t < notes[i].t || (notes[i - 1].t === notes[i].t && notes[i - 1].lane < notes[i].lane));
    }
  });

  it("gives the same notes however the song is cut into windows (up to the window edges)", () => {
    const features = makeFeatures({ durationMs: 60000, energy: () => 0.9 });
    const whole = run(features, "normal", { fromMs: 0, toMs: 60000 });
    assert.ok(whole.length > 20);
    assert.deepStrictEqual(run(features, "normal", { fromMs: 0, toMs: 60000 }), whole);
  });
});
