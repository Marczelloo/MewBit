const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, LOCAL_THIN_SURE } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { localKeep } = require("../../../helpers/mewbeat/charts/localThin");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const LOCAL_THIN = { reach: 6, power: 1, floor: 0.5, knee: 0.6 }; // the levels own setting (difficulty.js)
const momentsOf = (notes) => new Set(notes.map((n) => n.t)).size;
// Normal as it was before the pseudo-count: the level's own setting back
FLAGS.withoutlocalthinsure = { label: "withoutlocalthinsure", levels: { normal: { localThin: LOCAL_THIN } } };
const PLAIN = { withoutlocalthinsure: true };

// The high band of a song of `seconds`, with `perSecond(second)` strong onsets each second.
const highBand = (seconds, perSecond) => ({
  bands: [{
    name: "high",
    onsets: Array.from({ length: seconds }, (_, second) => Array.from({ length: perSecond(second) }, (__, k) => ({ t: second * 1000 + k * 10, s: 0.8 }))).flat(),
  }],
});
const dipAt = (from, to, inside, outside) => (s) => (s >= from && s < to ? inside : outside);

describe("a signal too thin to say anything is no dip (localThinSure)", () => {
  it("is a setting of Normal (from v45), and no other level has the pseudo-count", () => {
    assert.deepEqual(DIFFICULTIES.normal.localThin, LOCAL_THIN_SURE);
    assert.deepEqual(LOCAL_THIN_SURE, { ...LOCAL_THIN, noise: 2 });
    for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (name !== "normal") assert.equal(level.localThin?.noise, undefined, name);
  });

  describe("localKeep", () => {
    const band = (inside, outside) => highBand(40, dipAt(18, 24, inside, outside));

    it("is what it was with no pseudo-count", () => {
      for (const [inside, outside] of [[0, 8], [1, 2], [2, 3], [0, 0]]) {
        assert.deepEqual(localKeep(band(inside, outside), 40000, { ...LOCAL_THIN, noise: 0 }), localKeep(band(inside, outside), 40000, LOCAL_THIN));
      }
    });

    it("reads 0 strong onsets against 2 round it as a mild dip, not as the floor", () => {
      const plain = localKeep(band(0, 2), 40000, LOCAL_THIN)[21];
      const sure = localKeep(band(0, 2), 40000, LOCAL_THIN_SURE)[21];
      assert.equal(plain, LOCAL_THIN.floor);
      assert.ok(sure > plain && sure < 1, `${sure}`);
    });

    it("still thins a real dip, 0 against 8 strong onsets a second, down to the floor", () => {
      assert.equal(localKeep(band(0, 8), 40000, LOCAL_THIN_SURE)[21], LOCAL_THIN.floor);
    });

    it("keeps everything where the music plays the same throughout, and never gives up more than the floor", () => {
      assert.ok(localKeep(highBand(40, () => 1), 40000, LOCAL_THIN_SURE).every((keep) => keep === 1));
      assert.ok(localKeep(band(0, 3), 40000, LOCAL_THIN_SURE).every((keep) => keep >= LOCAL_THIN.floor));
    });

    it("is never below what the plain reading gives, which is the point of it", () => {
      for (const [inside, outside] of [[0, 1], [0, 2], [1, 3], [2, 6], [0, 8]]) {
        const plain = localKeep(band(inside, outside), 40000, LOCAL_THIN);
        const sure = localKeep(band(inside, outside), 40000, LOCAL_THIN_SURE);
        sure.forEach((keep, i) => assert.ok(keep >= plain[i] - 1e-12, `${inside}/${outside} second ${i}`));
      }
    });
  });

  describe("in the charts", () => {
    // A song whose high band has `outside` strong onsets a second, `inside` for the seconds 9-14 of a phrase that repeats nothing.
    const song = (inside, outside) => {
      const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000 });
      const high = features.bands.find((band) => band.name === "high");
      high.onsets = Array.from({ length: 64 }, (_, s) => Array.from({ length: dipAt(9, 14, inside, outside)(s) }, (__, k) => ({ t: s * 1000 + k * 100, s: 0.9 }))).flat();
      return features;
    };
    const dip = (chart) => momentsOf(chart.notes.filter((n) => n.t >= 9000 && n.t < 14000));

    // Seconds 9 and 13 of a real dip (0 against 8) are read against seconds of the dip itself, where the signal is thin: the
    // pseudo-count gives up fewer moments there, and nowhere more; the middle of the dip, read against 8, stays at the floor.
    // (Easy is cut from Normal's moments and Hard and Hell are built on them, so the levels after Normal can move either way.)
    it("gives up fewer moments at the edges of a dip on Normal, and none more", () => {
      const off = generateAll(song(0, 8), "k", PLAIN);
      const on = generateAll(song(0, 8), "k");
      assert.ok(dip(on.normal) > dip(off.normal), `${dip(on.normal)} > ${dip(off.normal)}`);
    });

    it("still thins the dip against a song with none, on Normal", () => {
      const dipped = generateAll(song(0, 8), "k");
      const even = generateAll(song(8, 8), "k");
      assert.ok(dip(dipped.normal) < dip(even.normal), `${dip(dipped.normal)} < ${dip(even.normal)}`);
    });

    it("leaves every level note for note where the signal shows no dip (the control)", () => {
      const off = generateAll(song(8, 8), "k", PLAIN);
      const on = generateAll(song(8, 8), "k");
      for (const level of LEVELS) assert.deepEqual(on[level].notes, off[level].notes, level);
    });
  });
});
