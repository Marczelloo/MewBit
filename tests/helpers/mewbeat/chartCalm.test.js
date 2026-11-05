const assert = require("node:assert");
const { describe, it } = require("node:test");

const { calmLookup, shareOver } = require("../../../helpers/mewbeat/charts/calm");
const { addGapHolds } = require("../../../helpers/mewbeat/charts/holds");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const PARAMS = { quietBelow: 0.25, loudAbove: 0.6 };
const LEVELS = ["easy", "normal", "hard", "hell"];

// The upper bands of a song of `seconds`, with `perSecond(second)` strong onsets each second in each band.
const upperBands = (seconds, perSecond, s = 0.8) => ({
  bands: ["high", "highmid"].map((name) => ({
    name,
    onsets: Array.from({ length: seconds }, (_, second) => Array.from({ length: perSecond(second) }, (__, k) => ({ t: second * 1000 + k * 10, s }))).flat(),
  })),
});
const STILL = (second) => second >= 20 && second < 30;

describe("mewbeat calm", () => {
  describe("calmLookup", () => {
    it("is calm where the upper bands stop, and not where they play", () => {
      const calm = calmLookup(upperBands(60, (s) => (STILL(s) ? 0 : 8)), 60000, PARAMS);
      assert.strictEqual(calm(25000), 1);
      assert.strictEqual(calm(5000), 0);
      assert.strictEqual(calm(50000), 0);
    });

    it("hears only the strong onsets of the upper bands", () => {
      assert.strictEqual(calmLookup(upperBands(60, () => 8, 0.3), 60000, PARAMS), null);
      const low = { bands: [{ name: "low", onsets: upperBands(60, () => 8).bands[0].onsets }] };
      assert.strictEqual(calmLookup(low, 60000, PARAMS), null);
    });

    it("has nothing to say about a song with no bands", () => {
      assert.strictEqual(calmLookup({}, 60000, PARAMS), null);
    });

    it("says nothing is calm where the song plays the same throughout (the control)", () => {
      const calm = calmLookup(upperBands(60, () => 8), 60000, PARAMS);
      for (let t = 0; t < 60000; t += 1000) assert.strictEqual(calm(t), 0, `${t}`);
    });

    it("stays within the song for a time before or past it", () => {
      const calm = calmLookup(upperBands(60, (s) => (s < 10 ? 0 : 8)), 60000, PARAMS);
      assert.strictEqual(calm(-2000), 1);
      assert.strictEqual(calm(90000), 0);
    });
  });

  describe("shareOver", () => {
    const shares = { loud: 0.1, quiet: 0.5 };
    const notes = [{ t: 0 }, { t: 1000 }];

    it("is the mean over the notes between the two shares", () => {
      assert.strictEqual(shareOver(notes, () => 0, shares), 0.1);
      assert.strictEqual(shareOver(notes, () => 1, shares), 0.5);
      assert.ok(Math.abs(shareOver(notes, (t) => (t === 0 ? 1 : 0), shares) - 0.3) < 1e-9);
    });

    it("is the loud share with no notes", () => {
      assert.strictEqual(shareOver([], () => 1, shares), 0.1);
    });
  });

  describe("addGapHolds with the calm", () => {
    const BEAT = 500;
    const timing = { beats: Array.from({ length: 80 }, (_, i) => i * BEAT), snapped: true, beatMsAt: () => BEAT, medianMs: BEAT };
    const diff = {
      holdMinBeats: 1,
      holdRelease: "free",
      minNoteGapMs: 0,
      holdsByCalm: { quietEnergy: 0.15, gapShare: { loud: 0.2, quiet: 0.2 }, maxShare: { loud: 0.2, quiet: 0.2 } },
    };
    const energy = { at: () => 0.2 }; // too quiet for a gap hold anywhere but in the calm
    const notes = (fromMs) => Array.from({ length: 10 }, (_, i) => ({ t: fromMs + i * 3 * BEAT, lane: 0 }));

    it("holds through a long rest and quiet music only where it is calm", () => {
      const calm = addGapHolds(notes(0), {}, diff, timing, energy, Infinity, -Infinity, () => 1);
      assert.ok(calm.some((n) => n.len > 0), "held in the calm");
      const loud = addGapHolds(notes(0), {}, diff, timing, energy, Infinity, -Infinity, () => 0);
      assert.ok(loud.every((n) => !(n.len > 0)), "not held out of it");
    });

    it("takes the calm moments first", () => {
      const song = [...notes(0), ...notes(15000).map((n) => ({ ...n }))];
      const inCalm = (t) => (t >= 15000 ? 1 : 0);
      const loudEnough = { at: () => 0.9 };
      const shortRests = song.map((n, i) => ({ ...n, t: i < 10 ? i * BEAT * 2 : n.t }));
      const after = addGapHolds(shortRests, {}, { ...diff, holdsByCalm: { ...diff.holdsByCalm, gapShare: { loud: 0.15, quiet: 0.15 } } }, timing, loudEnough, Infinity, -Infinity, inCalm);
      const held = after.filter((n) => n.len > 0);
      assert.ok(held.length > 0);
      assert.ok(held.every((n) => n.t >= 15000), held.map((n) => n.t).join());
    });
  });

  describe("behind the holds flag", () => {
    // A song whose upper bands all but stop for a few seconds inside a phrase that repeats nothing (a repeat copies its source).
    const stilled = () => {
      const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000 });
      for (const band of features.bands) {
        if (band.name === "high" || band.name === "highmid") band.onsets = band.onsets.filter((o) => o.t < 8000 || o.t >= 15000);
      }
      return features;
    };
    const heldIn = (chart, from, to) => chart.notes.filter((n) => n.t >= from && n.t < to && n.len > 0).length;

    it("leaves every level as it was with the flag off", () => {
      const off = generateAll(stilled(), "k");
      const none = generateAll(stilled(), "k", {});
      for (const level of LEVELS) assert.deepStrictEqual(none[level].notes, off[level].notes);
    });

    it("holds as much or more in the calm stretch with the flag on", () => {
      const off = generateAll(stilled(), "k");
      const on = generateAll(stilled(), "k", { holds: true });
      for (const level of LEVELS) assert.ok(heldIn(on[level], 8000, 15000) >= heldIn(off[level], 8000, 15000), `${level}: ${heldIn(on[level], 8000, 15000)} < ${heldIn(off[level], 8000, 15000)}`);
      assert.ok(LEVELS.some((level) => heldIn(on[level], 8000, 15000) > heldIn(off[level], 8000, 15000)), "some level holds more");
    });

    it("gives the same chart for the same song", () => {
      const a = generateAll(stilled(), "k", { holds: true });
      const b = generateAll(stilled(), "k", { holds: true });
      for (const level of LEVELS) assert.deepStrictEqual(a[level].notes, b[level].notes);
    });

    it("holds no note past the next moment on its own lane, nor past the song", () => {
      const on = generateAll(stilled(), "k", { holds: true });
      for (const level of LEVELS) {
        const notes = on[level].notes;
        for (const n of notes) {
          if (!(n.len > 0)) continue;
          assert.ok(n.t + n.len <= 64000, `${level} ${n.t}+${n.len}`);
          const hit = notes.find((o) => o !== n && o.lane === n.lane && o.t >= n.t && o.t <= n.t + n.len);
          assert.strictEqual(hit, undefined, `${level} ${n.t}+${n.len} lane ${n.lane}`);
        }
      }
    });
  });
});
