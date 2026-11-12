const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, PLUS_CALM, PLUS_CALM_END } = require("../../../helpers/mewbeat/charts/difficulty");
const { fadeOutOf } = require("../../../helpers/mewbeat/charts/fades");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { quietLookup } = require("../../../helpers/mewbeat/charts/quiet");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

// The charts without a rule are the default call with the rule taken off Hard and Hell (the only levels that have them). Every chart
// here is also charted without calmSpots, which thins the same quiet parts from the other side, and without the holds in the gaps
// (plusHolds, holdsByCalm), which turn some of Hell's extras there into holds (10 -> 4 in the quiet middle of the fixture): both have
// their own tests, and what is measured here is plusCalm alone, as it was when they were flags that were off.
const NO_SPOTS = flagWithout("withoutcalmspots", "calmSpots", "calmMelody", "plusHolds", "holdsByCalm");
const NO_PLUS = flagWithout("withoutpluscalm", "plusCalm", "plusCalmEnd");
const NO_PLUS_CALM = flagWithout("withoutpluscalmonly", "plusCalm");
const NO_PLUS_END = flagWithout("withoutplusend", "plusCalmEnd");
const LEVELS = ["easy", "normal", "hard", "hell"];
const QUIET_FROM = 24000, QUIET_TO = 40000;
const quietMiddle = (t) => (t >= QUIET_FROM && t < QUIET_TO ? 0.25 : 0.8);
// every phrase its own letter: no phrase is a repeat of another
const NO_REPEATS = "ABCDEFGHIJKLMNOP";
const SONGS = {
  "120 BPM, loud": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "120 BPM, quiet middle": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: NO_REPEATS, energy: quietMiddle }),
  "150 BPM, quiet middle": () => makeLayeredFeatures({ bpm: 150, durationMs: 64000, structure: NO_REPEATS, energy: quietMiddle }),
  "120 BPM, quiet middle, repeats": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, energy: quietMiddle }),
  "120 BPM, quiet ending": () => makeLayeredFeatures({ bpm: 120, durationMs: 60000, energy: (t) => (t < 48000 ? 0.8 : 0.21) }),
  "120 BPM, fading": () => makeLayeredFeatures({ bpm: 120, durationMs: 60000, energy: (t) => (t < 50000 ? 0.8 : Math.max(0, (0.8 * (60000 - t)) / 10000)) }),
};
const QUIET_MIDDLE = ["120 BPM, quiet middle", "150 BPM, quiet middle", "120 BPM, quiet middle, repeats"];
const ENDING = ["120 BPM, quiet ending", "120 BPM, fading"];
const chartsOf = (song, flags) => Object.fromEntries(Object.entries(generateAll(SONGS[song](), "k", { ...NO_SPOTS, ...flags })).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))];
// the moments a level plays that the level under it does not
const extrasOf = (notes, under, from = 0, to = Infinity) => {
  const below = new Set(under.map((n) => n.t));
  return momentsOf(notes, from, to).filter((t) => !below.has(t));
};

// The fixtures' Hard never adds more than half of Normal's moments, so the real numbers leave them alone; the cap itself is
// shown with a rule far tighter than Hard's own. The first leaves the quiet-ending rule out, as a plusCalm alone would be.
const TIGHT = { below: PLUS_CALM.below, share: 0.05 };
FLAGS.plusCalmTight = { label: "plusCalmTight", levels: { hard: { plusCalm: TIGHT, plusCalmEnd: undefined }, hell: { plusCalm: TIGHT, plusCalmEnd: undefined } } };
FLAGS.plusCalmTightEnd = { label: "plusCalmTightEnd", levels: { hard: { plusCalm: TIGHT }, hell: { plusCalm: TIGHT } } };

describe("where the song is quiet (quietLookup)", () => {
  const features = (values, hopMs = 500) => ({ energy: { hopMs, values } });

  it("calls quiet what plays under the given share of the loud level, read over 2.5 s", () => {
    const quiet = quietLookup(features([...Array(20).fill(0.8), ...Array(20).fill(0.25), ...Array(20).fill(0.8)]), PLUS_CALM);
    assert.equal(quiet(5000), false);
    assert.equal(quiet(15000), true);
    assert.equal(quiet(25000), false);
    // the edge belongs to the loud side: half of the 2.5 s around it is still loud
    assert.equal(quiet(10000), false);
    assert.equal(quiet(10500), true);
  });

  it("does not take a short dip for a quiet part, and silence does not set the loud level", () => {
    const dip = quietLookup(features([...Array(20).fill(0.8), 0.1, ...Array(20).fill(0.8)]), PLUS_CALM);
    assert.equal(dip(10000), false);
    // a song that is half silence: the loud level is that of what sounds
    const half = quietLookup(features([...Array(30).fill(0), ...Array(30).fill(0.6)]), PLUS_CALM);
    assert.equal(half(20000), false);
    assert.equal(quietLookup(features([0, 0, 0]), PLUS_CALM), null);
    assert.equal(quietLookup({}, PLUS_CALM), null);
  });
});

describe("Hard and Hell add less where the song is quiet (plusCalm, plusCalmEnd)", () => {
  it("both are rules of Hard and Hell (from v45) and no other level has them", () => {
    for (const [param, rule] of [["plusCalm", PLUS_CALM], ["plusCalmEnd", PLUS_CALM_END]]) {
      for (const level of ["hard", "hell"]) assert.equal(DIFFICULTIES[level][param], rule, `${param} ${level}`);
      for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (name !== "hard" && name !== "hell") assert.equal(level[param], undefined, `${param} ${name}`);
    }
  });

  it("leave Easy and Normal note for note, and a song that is loud all the way on every level", () => {
    for (const song of Object.keys(SONGS)) {
      const off = chartsOf(song, NO_PLUS);
      for (const [name, flags] of [["plusCalm", NO_PLUS_END], ["plusCalmEnd", NO_PLUS_CALM], ["both", undefined], ["plusCalmTight", { plusCalmTight: true }], ["plusCalmTightEnd", { plusCalmTightEnd: true }]]) {
        const on = chartsOf(song, flags);
        for (const level of song === "120 BPM, loud" ? LEVELS : ["easy", "normal"]) assert.deepEqual(on[level], off[level], `${song} ${level} ${name}`);
      }
    }
  });

  it("plusCalm: in a quiet part a level adds no more than its share of what the level under it plays there", () => {
    for (const song of QUIET_MIDDLE) {
      const off = chartsOf(song, NO_PLUS), on = chartsOf(song, { plusCalmTight: true });
      const quiet = quietLookup(SONGS[song](), PLUS_CALM);
      const calm = (notes, under) => extrasOf(notes, under).filter(quiet).length;
      for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
        const before = calm(off[level], off[under]), after = calm(on[level], on[under]);
        assert.ok(before >= 6, `${song} ${level}: ${before} extras in the quiet part without the rule`);
        // two phrases of the fixture lie in the quiet part and each rounds its share up; Hard's other rules now leave 8 extras there in
        // the 150 BPM song, so the cap halves them (4) where it used to cut them below a half
        assert.ok(after <= 4 && after <= before / 2, `${song} ${level}: ${after} extras in the quiet part against ${before}`);
      }
      // the loud parts of Hard are what they were, a repeat of a quiet phrase too; Hell's follow the Hard under it
      for (const [from, to] of [[0, QUIET_FROM - 2000], [QUIET_TO + 2000, Infinity]]) {
        assert.deepEqual(momentsOf(on.hard, from, to), momentsOf(off.hard, from, to), `${song}: Hard from ${from}`);
        assert.ok(momentsOf(on.hell, from, to).length >= 0.95 * momentsOf(off.hell, from, to).length, `${song}: Hell from ${from}`);
      }
    }
  });

  it("plusCalm with its real numbers never adds to a quiet part", () => {
    for (const song of Object.keys(SONGS)) {
      const off = chartsOf(song, NO_PLUS), on = chartsOf(song, NO_PLUS_END);
      const quiet = quietLookup(SONGS[song](), PLUS_CALM) ?? (() => false);
      for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
        const before = extrasOf(off[level], off[under]).filter(quiet).length, after = extrasOf(on[level], on[under]).filter(quiet).length;
        assert.ok(after <= before, `${song} ${level}: ${after} extras in the quiet parts against ${before}`);
      }
    }
  });

  it("plusCalmEnd: a quiet ending plays what the level under it plays", () => {
    for (const song of ENDING) {
      const ending = fadeOutOf(analyse(SONGS[song](), {}), PLUS_CALM_END);
      assert.ok(ending && ending.startMs >= 40000, `${song}: the ending starts at ${ending?.startMs}`);
      const off = chartsOf(song, NO_PLUS), on = chartsOf(song, NO_PLUS_CALM);
      assert.ok(extrasOf(off.hard, off.normal, ending.startMs).length + extrasOf(off.hell, off.hard, ending.startMs).length > 0, `${song}: nothing added to the ending without the rule`);
      for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
        assert.deepEqual(extrasOf(on[level], on[under], ending.startMs), [], `${song}: ${level} adds to the ending`);
        assert.deepEqual(momentsOf(on[level], ending.startMs), momentsOf(on.normal, ending.startMs), `${song}: ${level} in the ending`);
      }
      // up to the ending Hard is what it was
      assert.deepEqual(momentsOf(on.hard, 0, ending.startMs - 2000), momentsOf(off.hard, 0, ending.startMs - 2000), song);
    }
    // no quiet ending, nothing to do
    for (const song of ["120 BPM, loud", ...QUIET_MIDDLE]) assert.deepEqual(chartsOf(song, NO_PLUS_CALM), chartsOf(song, NO_PLUS), song);
  });

  it("keeps every moment of the level under it, and the lanes stay playable", () => {
    for (const song of Object.keys(SONGS)) {
      const charts = chartsOf(song, { plusCalmTightEnd: true });
      for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
        const mine = new Set(charts[level].map((n) => n.t));
        assert.deepEqual(momentsOf(charts[under]).filter((t) => !mine.has(t)), [], `${song}: ${under} moments missing from ${level}`);
        const byTime = new Map();
        for (const n of charts[level]) byTime.set(n.t, [...(byTime.get(n.t) ?? []), n.lane]);
        for (const [t, lanes] of byTime) {
          assert.equal(new Set(lanes).size, lanes.length, `${song} ${level}: a lane twice at ${t}`);
          assert.ok(lanes.length < 4, `${song} ${level}: four keys at ${t}`);
        }
        for (let lane = 0; lane < 4; lane++) {
          const own = charts[level].filter((n) => n.lane === lane).sort((a, b) => a.t - b.t);
          own.forEach((n, i) => {
            const next = own[i + 1];
            if (n.len > 0 && next) assert.ok(next.t >= n.t + n.len, `${song} ${level}: a note at ${next.t} inside the hold at ${n.t} on lane ${lane}`);
          });
        }
      }
    }
  });
});
