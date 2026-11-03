const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { patternEvents } = require("../../../helpers/mewbeat/charts/patterns");
const { BRIDGE_MIN_BEATS, bridgeSeam, fillGaps } = require("../../../helpers/mewbeat/charts/seams");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

// 120 bpm: a beat is 500 ms, a bar 2000 ms.
const base = makeFeatures({ durationMs: 20000 });
const timing = buildTiming(base, base.durationMs);
const energy = { at: () => 0.5 };
const drum = (t, kind) => ({ t, kind, s: 0.8 });

describe("bridgeSeam", () => {
  const drums = [
    drum(500, "kick"),
    drum(1000, "snare"),
    drum(1125, "kick"), // a 1/4-beat off-beat: no bridge hit
    drum(1250, "hat"),
    drum(1500, "kick"),
    drum(2000, "snare"),
    drum(2500, "kick"),
    drum(3000, "snare"),
    drum(3500, "kick"),
    drum(3900, "snare"), // too close to the new phrase's first note
  ];
  const features = { ...base, drums };

  it("exports its threshold", () => {
    assert.equal(BRIDGE_MIN_BEATS, 2);
  });

  it("fills a silence across the seam with the kicks and snares on beats and half beats, kicks outside, snares inside", () => {
    const out = bridgeSeam([{ t: 0, lane: 1 }], [{ t: 4000, lane: 2 }], 2000, features, timing, energy);
    assert.deepEqual(out, [
      { t: 500, lane: 0 },
      { t: 1000, lane: 1 },
      { t: 1500, lane: 3 },
      { t: 2000, lane: 2 },
      { t: 2500, lane: 0 },
      { t: 3000, lane: 1 },
      { t: 3500, lane: 3 },
    ]);
  });

  it("starts half a beat after the end of a hold, and leaves the lanes of the notes on either side", () => {
    const out = bridgeSeam([{ t: 0, lane: 0, len: 1200 }], [{ t: 4000, lane: 3 }], 2000, features, timing, energy);
    assert.deepEqual(out.map((n) => n.t), [1500, 2000, 2500, 3000, 3500]);
    assert.notEqual(out[0].lane, 0);
    assert.notEqual(out[out.length - 1].lane, 3);
  });

  it("leaves a short rest, a silent stretch and an empty side alone", () => {
    assert.deepEqual(bridgeSeam([{ t: 1500, lane: 0 }], [{ t: 2400, lane: 1 }], 2000, features, timing, energy), []);
    assert.deepEqual(bridgeSeam([{ t: 0, lane: 0 }], [{ t: 4000, lane: 1 }], 2000, features, timing, { at: () => 0 }), []);
    assert.deepEqual(bridgeSeam([], [{ t: 4000, lane: 1 }], 2000, features, timing, energy), []);
  });

  it("reaches at most a bar to either side of the seam", () => {
    const far = { ...base, drums: [drum(500, "kick"), drum(9000, "snare"), drum(10500, "kick"), drum(14000, "snare")] };
    const out = bridgeSeam([{ t: 0, lane: 1 }], [{ t: 16000, lane: 2 }], 10000, far, timing, energy);
    assert.deepEqual(out.map((n) => n.t), [9000, 10500]);
  });
});

describe("fillGaps", () => {
  const drums = [500, 1000, 1500, 2000, 2500, 3000, 3500].map((t, k) => drum(t, k % 2 ? "snare" : "kick"));
  const features = { ...base, drums };
  const beats = [500, 1000, 1500, 2000, 2500, 3000, 3500];

  it("fills a rest inside a phrase, and the rest after the notes before it, with the drums", () => {
    assert.deepEqual(fillGaps([], [{ t: 0, lane: 1 }, { t: 4000, lane: 2 }], features, timing, energy).map((n) => n.t), beats);
    assert.deepEqual(fillGaps([{ t: 0, lane: 1 }], [{ t: 4000, lane: 2 }, { t: 4500, lane: 1 }], features, timing, energy).map((n) => n.t), beats);
  });

  it("fills the end of the last phrase up to untilMs, and nothing before the first note", () => {
    assert.deepEqual(fillGaps([], [{ t: 0, lane: 1 }], features, timing, energy, 4000).map((n) => n.t), beats);
    assert.deepEqual(fillGaps([], [{ t: 4000, lane: 1 }], features, timing, energy), []);
  });

  it("leaves a short rest and a silent stretch alone", () => {
    assert.deepEqual(fillGaps([], [{ t: 1500, lane: 0 }, { t: 2400, lane: 1 }], features, timing, energy), []);
    assert.deepEqual(fillGaps([], [{ t: 0, lane: 0 }, { t: 4000, lane: 1 }], features, timing, { at: () => 0 }), []);
  });
});

describe("lead line registers", () => {
  // A low sung part, a rest, then a melody an octave and more above it: each part spreads over both hands.
  const note = (t, pitch) => ({ t, pitch, len: 200, conf: 0.95, s: 0.8 });
  const lead = [note(500, 50), note(750, 54), note(1000, 51), note(1250, 55), note(2500, 70), note(2750, 74), note(3000, 71), note(3250, 75)];
  const phrase = { startMs: 0, endMs: 4000, energy: 0.3 };
  const lanesOf = (events, from, to) => events.filter((e) => e.source === "lead" && e.t >= from && e.t < to).map((e) => e.lane);

  it("maps a part after a rest and a register jump on its own pitch range", () => {
    const events = patternEvents(phrase, "lead", { ...base, lead, drums: [] }, timing);
    for (const [from, to] of [[0, 2000], [2000, 4000]]) {
      const hands = new Set(lanesOf(events, from, to).map((lane) => lane >> 1));
      assert.equal(hands.size, 2, `notes ${from}-${to} use both hands: ${lanesOf(events, from, to)}`);
    }
  });

  it("keeps one range without a rest between the registers", () => {
    const legato = lead.map((n, i) => (i >= 4 ? { ...n, t: n.t - 1000 } : n));
    const events = patternEvents(phrase, "lead", { ...base, lead: legato, drums: [] }, timing);
    const low = lanesOf(events, 0, 1400);
    assert.ok(low.length > 0 && low.every((lane) => lane < 2), `the low notes stay on the left hand: ${low}`);
  });
});
