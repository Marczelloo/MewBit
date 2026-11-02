const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { INTENSITY_MAX, INTENSITY_MIN, sectionIntensity, withIntensity } = require("../../../helpers/mewbeat/charts/intensity");
const { applyDifficulty } = require("../../../helpers/mewbeat/charts/difficultyFilter");
const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");

// Three 8-second phrases: calm (a drum hit a beat at 120 bpm), busy (four a beat), calm again; equally loud.
const every = (from, to, step) => Array.from({ length: (to - from) / step }, (_, k) => ({ t: from + k * step, s: 0.9, kind: "kick" }));
const features = {
  bands: [],
  drums: [...every(0, 8000, 500), ...every(8000, 16000, 125), ...every(16000, 24000, 500)],
};
const phrases = [
  { startMs: 0, endMs: 8000, energy: 0.8 },
  { startMs: 8000, endMs: 16000, energy: 0.8 },
  { startMs: 16000, endMs: 24000, energy: 0.8 },
];
const flat = { hopMs: 500, at: () => 0.8 };

describe("sectionIntensity", () => {
  it("raises a busy section above 1 and lowers calm ones below it", () => {
    const [calm, busy, calmAgain] = sectionIntensity(features, phrases);
    assert.ok(busy > 1, `busy ${busy}`);
    assert.ok(calm < 1, `calm ${calm}`);
    assert.strictEqual(calm, calmAgain);
  });

  it("stays within its bounds", () => {
    const wild = { bands: [], drums: [...every(0, 8000, 2000), ...every(8000, 16000, 20)] };
    for (const x of sectionIntensity(wild, phrases.slice(0, 2))) assert.ok(x >= INTENSITY_MIN && x <= INTENSITY_MAX, `${x}`);
  });

  it("is 1 everywhere when nothing can be measured", () => {
    assert.deepStrictEqual(sectionIntensity({ bands: [] }, phrases), [1, 1, 1]);
    assert.deepStrictEqual(sectionIntensity(features, [phrases[0]]), [1]);
  });

  it("leaves a silent or too short phrase at 1", () => {
    const quiet = [{ ...phrases[0], energy: 0 }, phrases[1], { startMs: 16000, endMs: 17000, energy: 0.8 }, { startMs: 17000, endMs: 24000, energy: 0.8 }];
    const values = sectionIntensity(features, quiet);
    assert.strictEqual(values[0], 1);
    assert.strictEqual(values[2], 1);
  });
});

describe("withIntensity", () => {
  it("keeps the energy lookup and adds the intensity of the phrase at t", () => {
    const energy = withIntensity(flat, features, phrases);
    assert.strictEqual(energy.hopMs, 500);
    assert.strictEqual(energy.at(9000), 0.8);
    assert.ok(energy.intensity(9000) > energy.intensity(1000));
    assert.strictEqual(energy.intensity(30000), 1);
  });

  it("gives an equally loud busy section more notes than a calm one, where the cap binds", () => {
    // The same dense candidates (every 1/8 beat) in all three phrases: only the cap tells them apart.
    const events = [0, 8000, 16000].flatMap((from) =>
      Array.from({ length: 128 }, (_, k) => ({ t: from + 62.5 * k, lane: k % 4, strength: 0.9, level: 0 })),
    ).filter((e) => e.t >= 2000);
    const diff = DIFFICULTIES.hard;
    const count = (notes, from, to) => notes.filter((n) => n.t >= from && n.t < to).length;
    const plain = applyDifficulty(events, diff, null, flat);
    const shaped = applyDifficulty(events, diff, null, withIntensity(flat, features, phrases));
    assert.ok(count(shaped, 9000, 15000) > count(shaped, 17000, 23000), "busy section denser than calm one");
    assert.ok(count(shaped, 9000, 15000) > count(plain, 9000, 15000), "busy section denser than without intensity");
    assert.ok(count(shaped, 17000, 23000) < count(plain, 17000, 23000), "calm section thinner than without intensity");
  });
});
