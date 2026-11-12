const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, NO_NOISE, NO_NOISE_EDGE, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS, withFlags } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { noiseLookup } = require("../../../helpers/mewbeat/charts/noise");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const QUARTER = 125; // a quarter beat at 120 BPM
const DURATION = 64000;

// A 120 BPM song with a pitched note on every beat. `offGrid` = [fromMs, toMs): there the bands' sounds sit halfway between
// the grid's quarter lines. `unpitched` = [fromMs, toMs): there the decoder hears nothing. The shape King Gnu AIZO has at its
// start: noise nobody pitches, then off-grid sound with a few notes under it, then the music on the grid.
function song({ offGrid = null, unpitched = null } = {}) {
  const features = makeLayeredFeatures({ bpm: 120, durationMs: DURATION, structure: "ABCDEFGHIJKLMNOP" });
  const within = (range, t) => range && t >= range[0] && t < range[1];
  if (offGrid) {
    features.bands = features.bands.map((band) => ({
      ...band,
      onsets: band.onsets.map((o) => (within(offGrid, o.t) ? { ...o, t: Math.floor(o.t / QUARTER) * QUARTER + QUARTER / 2 } : o)),
    }));
  }
  features.decodedNotes = [];
  for (let t = 0; t < DURATION; t += 500) if (!within(unpitched, t)) features.decodedNotes.push({ t, len: 200, pitch: 60, vel: 0.5 });
  return features;
}
const HEAD = { offGrid: [0, 14000], unpitched: [0, 6000] };
const TAIL = { offGrid: [50000, DURATION], unpitched: [58000, DURATION] };
const lookupOf = (features, edge = null) => {
  const ctx = analyse(features, []);
  return noiseLookup(ctx.raw, ctx.features, ctx.timing, NO_NOISE, edge);
};
const chartsOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))];

describe("a noise stretch at the song's ends reaches the music (flag noNoiseEdge)", () => {
  it("is off by default, on every level, and only with noNoise", () => {
    assert.ok(FLAGS.noNoiseEdge);
    assert.deepEqual(Object.keys(FLAGS.noNoiseEdge.levels), LEVELS);
    for (const level of LEVELS) {
      assert.equal(DIFFICULTIES[level].noNoiseEdge, undefined, level);
      assert.equal(withFlags(levelOf(level), level, { noNoiseEdge: true }).noNoiseEdge, NO_NOISE_EDGE, level);
    }
    // the levels the others are built on stay whole
    assert.equal(withFlags(levelOf("hardBase"), "hardBase", { noNoiseEdge: true }), levelOf("hardBase"));
    assert.equal(withFlags(levelOf("easyV26"), "easyV26", { noNoiseEdge: true }), levelOf("easyV26"));
    // the flag alone does nothing: the rule that finds the stretch is noNoise's
    const features = song(HEAD);
    const off = chartsOf(features, []), alone = chartsOf(features, ["noNoiseEdge"]);
    for (const level of LEVELS) assert.deepEqual(alone[level], off[level], level);
  });

  it("takes the opening noise on through the off-grid sound with a little pitch under it, up to the music", () => {
    const features = song(HEAD);
    const plain = lookupOf(features), edged = lookupOf(features, NO_NOISE_EDGE);
    assert.ok(plain && edged);
    // without the flag only the unpitched part: the windows that hear the notes from 6 s on are music
    for (const t of [500, 2000, 4000]) assert.equal(plain(t), true, `plain at ${t}`);
    for (const t of [8000, 10000, 12000]) assert.equal(plain(t), false, `plain at ${t}`);
    for (const t of [500, 2000, 4000, 8000, 10000, 12000]) assert.equal(edged(t), true, `edged at ${t}`);
    // and the music itself, on the grid from 14 s (a window of 4 s still hears the off-grid half of it up to 16 s), is not touched
    for (const t of [16500, 18000, 30000, 60000]) assert.equal(edged(t), false, `edged at ${t}`);
  });

  it("charts nothing before the music with the flag, and with it off the notes in the pitched part stay", () => {
    const features = song(HEAD);
    const off = chartsOf(features, ["noNoise"]), on = chartsOf(features, ["noNoise", "noNoiseEdge"]);
    for (const level of LEVELS) {
      assert.ok(momentsOf(off[level], 8000, 12000).length >= 2, `${level}: the fixture charts the pitched part without the flag`);
      assert.deepEqual(momentsOf(on[level], 0, 12000), [], `${level} plays before the music`);
      assert.ok(momentsOf(on[level], 17000, 22000).length >= 2, `${level} lost the music`);
    }
  });

  it("keeps an off-grid pitched opening that has no noise before it", () => {
    const features = song({ offGrid: [0, 14000] });
    assert.equal(lookupOf(features), null);
    assert.equal(lookupOf(features, NO_NOISE_EDGE), null);
    const off = chartsOf(features, ["noNoise"]), on = chartsOf(features, ["noNoise", "noNoiseEdge"]);
    for (const level of LEVELS) {
      assert.ok(momentsOf(off[level], 0, 12000).length >= 4, `${level}: the fixture charts the opening`);
      assert.deepEqual(on[level], off[level], level);
    }
  });

  it("does not reach from a noise stretch that is far from the song's start or end", () => {
    const features = song({ offGrid: [20000, 34000], unpitched: [20000, 26000] });
    const plain = lookupOf(features), edged = lookupOf(features, NO_NOISE_EDGE);
    assert.ok(plain && edged);
    for (let t = 0; t <= DURATION; t += 250) assert.equal(edged(t), plain(t), `at ${t}`);
  });

  it("does the same at the end: noise closes the song, off-grid sound before it, the music before that", () => {
    const features = song(TAIL);
    const plain = lookupOf(features), edged = lookupOf(features, NO_NOISE_EDGE);
    assert.ok(plain && edged);
    for (const t of [60000, 62500, 63900]) assert.equal(plain(t), true, `plain at ${t}`);
    for (const t of [52500, 54000, 56000]) assert.equal(plain(t), false, `plain at ${t}`);
    for (const t of [52500, 54000, 56000, 60000, 63900]) assert.equal(edged(t), true, `edged at ${t}`);
    for (const t of [1000, 20000, 40000, 47000]) assert.equal(edged(t), false, `edged at ${t}`);
    const off = chartsOf(features, ["noNoise"]), on = chartsOf(features, ["noNoise", "noNoiseEdge"]);
    for (const level of LEVELS) {
      assert.ok(momentsOf(off[level], 53000, 57000).length >= 2, `${level}: the fixture charts the pitched part without the flag`);
      assert.deepEqual(momentsOf(on[level], 53000), [], `${level} plays after the music`);
      assert.ok(momentsOf(on[level], 40000, 47000).length >= 2, `${level} lost the music`);
    }
  });

  it("gives every level its flag-off chart minus the notes in the stretch, nothing else moved", () => {
    for (const shape of [HEAD, TAIL]) {
      const features = song(shape);
      const edgeAt = lookupOf(features, NO_NOISE_EDGE);
      const off = chartsOf(features, ["noNoise"]), on = chartsOf(features, ["noNoise", "noNoiseEdge"]);
      for (const level of LEVELS) {
        assert.ok(on[level].length < off[level].length, `${level}: the stretch holds notes`);
        assert.deepEqual(on[level], off[level].filter((n) => !edgeAt(n.t)), `${JSON.stringify(shape)} ${level}`);
      }
    }
  });
});
