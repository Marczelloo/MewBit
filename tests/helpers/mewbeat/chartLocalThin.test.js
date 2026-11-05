const assert = require("node:assert");
const { describe, it } = require("node:test");

const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { localKeep, thinned } = require("../../../helpers/mewbeat/charts/localThin");
const { makeLayeredFeatures } = require("./fixtures");

const PARAMS = { reach: 6, power: 1, floor: 0.5, knee: 0.6 };
const BEAT = 500;
const timing = { beats: Array.from({ length: 200 }, (_, i) => i * BEAT), snapped: true, beatMsAt: () => BEAT, medianMs: BEAT };
const momentsOf = (notes) => new Set(notes.map((n) => n.t)).size;
const every = (ms, fromMs, toMs) => Array.from({ length: Math.ceil((toMs - fromMs) / ms) }, (_, i) => ({ t: fromMs + i * ms, lane: 0 }));

// The high band of a song of `seconds`, with `perSecond(second)` strong onsets each second.
const highBand = (seconds, perSecond, s = 0.8) => ({
  bands: [{
    name: "high",
    onsets: Array.from({ length: seconds }, (_, second) => Array.from({ length: perSecond(second) }, (__, k) => ({ t: second * 1000 + k * 10, s }))).flat(),
  }],
});

describe("mewbeat local thinning", () => {
  describe("localKeep", () => {
    it("keeps everything where the music plays the same throughout", () => {
      assert.ok(localKeep(highBand(40, () => 8), 40000, PARAMS).every((keep) => keep === 1));
    });

    it("gives up moments in the seconds that play less than those around them, down to the floor", () => {
      const keep = localKeep(highBand(40, (s) => (s >= 18 && s < 24 ? 0 : 8)), 40000, PARAMS);
      assert.strictEqual(keep[5], 1);
      assert.strictEqual(keep[35], 1);
      assert.strictEqual(keep[21], PARAMS.floor);
    });

    it("hears only the strong onsets, and keeps everything with no high band", () => {
      const weak = highBand(40, (s) => (s >= 18 && s < 24 ? 0 : 8), 0.3);
      assert.ok(localKeep(weak, 40000, PARAMS).every((keep) => keep === 1));
      assert.ok(localKeep({ bands: [] }, 40000, PARAMS).every((keep) => keep === 1));
    });
  });

  describe("thinned", () => {
    it("returns the notes themselves where every second keeps all", () => {
      const notes = every(250, 0, 10000);
      assert.strictEqual(thinned(notes, new Array(10).fill(1), timing), notes);
    });

    it("gives up the share each second asks for, off the beat before on it", () => {
      const notes = every(250, 0, 10001); // every other moment on a beat, the last one too
      const after = thinned(notes, new Array(10).fill(0.5), timing);
      assert.strictEqual(momentsOf(after), notes.length - 20);
      assert.ok(after.every((n) => n.t % 500 === 0), "everything left is on a beat");
    });

    it("keeps a held moment, and both ends of the phrase", () => {
      const notes = every(250, 0, 10000).map((n) => (n.t === 2250 ? { ...n, len: 500 } : n));
      const after = thinned(notes, new Array(10).fill(0.5), timing);
      assert.ok(after.some((n) => n.t === 2250));
      assert.strictEqual(after[0].t, 0);
      assert.strictEqual(after.at(-1).t, 9750);
    });

    it("opens no stretch longer than two beats", () => {
      const notes = every(500, 0, 20000); // on the beat, nothing off it to go first
      const after = thinned(notes, new Array(20).fill(0.1), timing);
      assert.ok(momentsOf(after) < notes.length);
      after.slice(1).forEach((n, i) => assert.ok(n.t - after[i].t <= 2 * BEAT, `${after[i].t} -> ${n.t}`));
    });

    it("gives up no more than it may", () => {
      const notes = every(250, 0, 10000);
      assert.strictEqual(momentsOf(thinned(notes, new Array(10).fill(0.5), timing, 3)), notes.length - 3);
      assert.strictEqual(thinned(notes, new Array(10).fill(0.5), timing, 0).length, notes.length);
    });

    it("takes a chord whole", () => {
      const notes = every(250, 0, 4000).flatMap((n) => [n, { ...n, lane: 1 }]);
      const after = thinned(notes, new Array(4).fill(0.5), timing);
      const sizes = new Map();
      for (const n of after) sizes.set(n.t, (sizes.get(n.t) ?? 0) + 1);
      assert.ok(after.length < notes.length);
      assert.ok([...sizes.values()].every((size) => size === 2));
    });
  });

  describe("behind the density flag", () => {
    const LEVELS = ["easy", "normal", "hard", "hell"];
    // A song whose high band all but stops for a few seconds inside a phrase that repeats nothing (a repeat copies its source).
    const dipped = () => {
      const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000 });
      const high = features.bands.find((band) => band.name === "high");
      const inDip = (t) => t >= 9000 && t < 14000;
      high.onsets = high.onsets.filter((o) => !inDip(o.t));
      return features;
    };
    const dip = (chart) => momentsOf(chart.notes.filter((n) => n.t >= 9000 && n.t < 14000));

    it("leaves every level as it was with the flag off", () => {
      const off = generateAll(dipped(), "k");
      const none = generateAll(dipped(), "k", {});
      for (const level of LEVELS) assert.deepStrictEqual(none[level].notes, off[level].notes);
    });

    it("plays fewer moments in the dip with the flag on", () => {
      const off = generateAll(dipped(), "k");
      const on = generateAll(dipped(), "k", { density: true });
      assert.ok(LEVELS.some((level) => dip(on[level]) < dip(off[level])), "the dip is thinned on some level");
      for (const level of LEVELS) assert.ok(dip(on[level]) <= dip(off[level]), `${level}: ${dip(on[level])} > ${dip(off[level])}`);
    });

    it("does nothing with the signal that shows no dip (the control)", () => {
      const even = () => {
        const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000 });
        const high = features.bands.find((band) => band.name === "high");
        high.onsets = Array.from({ length: 64 * 8 }, (_, i) => ({ t: i * 125, s: 0.9 }));
        return features;
      };
      const off = generateAll(even(), "k");
      const on = generateAll(even(), "k", { density: true });
      for (const level of LEVELS) assert.deepStrictEqual(on[level].notes, off[level].notes);
    });
  });
});
