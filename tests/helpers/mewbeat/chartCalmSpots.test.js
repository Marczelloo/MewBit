const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { CALM_SPOTS, DIFFICULTIES, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { quietLookup } = require("../../../helpers/mewbeat/charts/quiet");
const { evenSpots } = require("../../../helpers/mewbeat/charts/spots");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const WITHOUT = flagWithout("withoutcalmspots", "calmSpots"); // the chart without the rule

const LEVELS = ["easy", "normal", "hard", "hell"];
const BEAT = 500, BAR = 4 * BEAT;
const quietMiddle = (t) => (t >= 24000 && t < 40000 ? 0.25 : 0.8);
const NO_REPEATS = "ABCDEFGHIJKLMNOP";
const SONGS = {
  "120 BPM, loud": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "120 BPM, quiet middle": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: NO_REPEATS, energy: quietMiddle }),
  "150 BPM, quiet middle": () => makeLayeredFeatures({ bpm: 150, durationMs: 64000, structure: NO_REPEATS, energy: quietMiddle }),
  "120 BPM, quiet middle, repeats": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, energy: quietMiddle }),
  "120 BPM, quiet all the way but the start": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: NO_REPEATS, energy: (t) => (t < 12000 ? 0.8 : 0.3) }),
};
const chartsOf = (song, flags) => Object.fromEntries(Object.entries(generateAll(SONGS[song](), "k", flags)).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))];

// A chart by hand on the grid of a 120 BPM song: `bars` bars of 4 beats, each given as the quarter beats it plays (0..15).
const ctx = analyse(makeLayeredFeatures({ bpm: 120, durationMs: 64000 }));
const ON_BEATS = [0, 4, 8, 12];
const chart = (bars) => bars.flatMap((slots, bar) => slots.map((slot) => ({ t: bar * BAR + (slot * BEAT) / 4, lane: slot % 4, len: 0 })));
const everywhere = () => true;
const inBar = (notes, bar) => momentsOf(notes, bar * BAR, (bar + 1) * BAR).map((t) => ((t - bar * BAR) * 4) / BEAT);
// ten calm bars with one busy bar in the middle
const withBurst = (burst, calm = ON_BEATS) => Array.from({ length: 11 }, (_, bar) => (bar === 5 ? burst : calm));

describe("a sudden dense spot in a quiet part (spots.js evenSpots)", () => {
  it("the fixture's grid is the one the hand charts are written on", () => {
    assert.equal(Math.round(ctx.timing.medianMs), BEAT);
  });

  it("thins a bar that plays well above the bars on both sides of it, the finest places first", () => {
    const notes = chart(withBurst([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    const out = evenSpots(notes, ctx, CALM_SPOTS, everywhere);
    // the sides play 4 a bar, 1.3 times that is under `most`, so the bar keeps `most` moments
    const kept = inBar(out, 5);
    assert.equal(kept.length, CALM_SPOTS.most);
    for (const slot of ON_BEATS) assert.ok(kept.includes(slot), `the beat at quarter ${slot} stays`);
    assert.ok(kept.every((slot) => slot % 2 === 0), `only beats and half beats stay: ${kept}`);
    // the calm bars around it are what they were
    for (const bar of [0, 1, 2, 3, 4, 6, 7, 8, 9, 10]) assert.deepEqual(inBar(out, bar), ON_BEATS, `bar ${bar}`);
    // no stretch of a bar holds more than `most` now, wherever it starts
    const times = momentsOf(out);
    for (const t of times) assert.ok(times.filter((x) => x >= t && x < t + BAR).length <= CALM_SPOTS.most, `the bar from ${t}`);
  });

  it("leaves a bar that is no more than `most` moments, and a busy bar where the music is loud", () => {
    const six = chart(withBurst([0, 2, 4, 8, 10, 12]));
    assert.equal(evenSpots(six, ctx, CALM_SPOTS, everywhere), six);
    const notes = chart(withBurst([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, () => false), notes);
    // quiet everywhere but around the busy bar (a stretch is read by its middle)
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, (t) => t < 4 * BAR || t >= 7 * BAR), notes);
    assert.equal(evenSpots(notes, ctx, null, everywhere), notes);
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, null), notes);
    assert.deepEqual(evenSpots([], ctx, CALM_SPOTS, everywhere), []);
  });

  it("leaves a figure that repeats bar after bar, however uneven it is inside the bar", () => {
    // three quick notes and a rest, twice a bar: 2 s windows inside it swing between 4 and 8 moments a second
    const riff = [0, 1, 2, 3, 8, 9, 10, 11];
    const notes = chart(Array.from({ length: 11 }, () => riff));
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, everywhere), notes);
  });

  it("leaves the bars that lead into a denser part and out of one", () => {
    const dense = [0, 2, 4, 6, 8, 10, 12, 14];
    const bars = [...Array(5).fill(ON_BEATS), ...Array(5).fill(dense), ...Array(5).fill(ON_BEATS)];
    const notes = chart(bars);
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, everywhere), notes);
  });

  it("thins only down to what the denser side plays times `over`", () => {
    // the sides play 8 a bar: a bar of 16 keeps floor(1.3 * 8) = 10
    const dense = [0, 2, 4, 6, 8, 10, 12, 14];
    const notes = chart(withBurst([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], dense));
    const out = evenSpots(notes, ctx, CALM_SPOTS, everywhere);
    const kept = inBar(out, 5);
    assert.equal(kept.length, Math.floor(CALM_SPOTS.over * 8));
    for (const slot of dense) assert.ok(kept.includes(slot), `the half beat at quarter ${slot} stays`);
  });

  it("keeps a moment with a hold and the moments of the level it is built on", () => {
    const notes = chart(withBurst([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    const at = (slot) => 5 * BAR + (slot * BEAT) / 4;
    const held = notes.map((n) => (n.t === at(1) ? { ...n, len: 100 } : n));
    assert.ok(inBar(evenSpots(held, ctx, CALM_SPOTS, everywhere), 5).includes(1));
    const protect = new Set([at(3), at(7), at(11)]);
    const kept = inBar(evenSpots(notes, ctx, CALM_SPOTS, everywhere, protect), 5);
    for (const slot of [3, 7, 11]) assert.ok(kept.includes(slot), `the protected moment at quarter ${slot} stays`);
    assert.equal(kept.length, CALM_SPOTS.most);
    // a bar that is all the level under it is left whole
    const all = new Set(notes.map((n) => n.t));
    assert.equal(evenSpots(notes, ctx, CALM_SPOTS, everywhere, all), notes);
  });

  it("takes a chord as one moment and drops all of its keys together", () => {
    const notes = chart(withBurst([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    const doubled = [...notes, ...notes.filter((n) => n.t >= 5 * BAR && n.t < 6 * BAR).map((n) => ({ ...n, lane: (n.lane + 1) % 4 }))];
    const out = evenSpots(doubled, ctx, CALM_SPOTS, everywhere);
    assert.equal(inBar(out, 5).length, CALM_SPOTS.most);
    for (const t of momentsOf(out, 5 * BAR, 6 * BAR)) assert.equal(out.filter((n) => n.t === t).length, 2, `the chord at ${t}`);
  });

  it("does not read a side with too little chart in it: the opening bars and the closing ones", () => {
    // a busy first bar has nothing before it and is judged by what follows; a chart of one busy bar has no side at all
    const lone = chart([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]);
    assert.equal(evenSpots(lone, ctx, CALM_SPOTS, everywhere), lone);
    const opening = chart([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ...Array(6).fill(ON_BEATS)]);
    assert.equal(inBar(evenSpots(opening, ctx, CALM_SPOTS, everywhere), 0).length, CALM_SPOTS.most);
  });
});

describe("no sudden dense spots in the quiet parts (diff.calmSpots)", () => {
  it("gives Normal, Hard and Hell the rule (from v45), and Easy and the levels before v44 not", () => {
    for (const level of ["normal", "hard", "hell"]) {
      assert.equal(DIFFICULTIES[level].calmSpots, CALM_SPOTS, level);
      assert.equal(levelOf(level).calmSpots, CALM_SPOTS, level);
    }
    for (const level of ["easy", "hardBase"]) assert.equal(levelOf(level).calmSpots, undefined, level);
  });

  it("leaves a song that is loud all the way note for note on every level", () => {
    const off = chartsOf("120 BPM, loud", WITHOUT), on = chartsOf("120 BPM, loud");
    for (const level of LEVELS) assert.deepEqual(on[level], off[level], level);
  });

  it("only takes moments away from Normal, and none where the song is loud", () => {
    for (const song of Object.keys(SONGS)) {
      const off = chartsOf(song, WITHOUT), on = chartsOf(song);
      const before = new Set(momentsOf(off.normal));
      assert.deepEqual(momentsOf(on.normal).filter((t) => !before.has(t)), [], `${song}: Normal gained moments`);
      const quiet = quietLookup(SONGS[song](), CALM_SPOTS) ?? (() => false);
      const after = new Set(momentsOf(on.normal));
      // a stretch is read by its middle, so a moment that goes lies within a bar of quiet music
      const beat = 60000 / (song.startsWith("150") ? 150 : 120);
      for (const t of momentsOf(off.normal).filter((x) => !after.has(x))) {
        assert.ok([-4, -3, -2, -1, 0, 1, 2, 3, 4].some((k) => quiet(t + k * beat)), `${song}: a moment went at ${t}, in loud music`);
      }
    }
  });

  it("keeps every moment of the level under it, and the lanes stay playable", () => {
    for (const song of Object.keys(SONGS)) {
      const charts = chartsOf(song);
      for (const [level, under] of [["hard", "normal"], ["hell", "hard"]]) {
        const mine = new Set(charts[level].map((n) => n.t));
        assert.deepEqual(momentsOf(charts[under]).filter((t) => !mine.has(t)), [], `${song}: ${under} moments missing from ${level}`);
      }
      for (const level of LEVELS) {
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
