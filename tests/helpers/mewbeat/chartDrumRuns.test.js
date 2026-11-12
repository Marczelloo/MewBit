const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, DRUM_RUNS, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { drumRolls, withDrumRunNotes } = require("../../../helpers/mewbeat/charts/drumRuns");
const { analyse, generateAll, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

// What a chart is without the rule; drumRunsFit goes too, it sizes the burst the rule makes. Where the burst's own size is the
// point, FITLESS keeps the rule at the size it had before drumRunsFit.
const WITHOUT = flagWithout("withoutdrumruns", "drumRuns", "drumRunsFit");
const FITLESS = flagWithout("withoutdrumrunsfit", "drumRunsFit");

const LEVELS = ["easy", "normal", "hard", "hell"];
const QUARTER = 125; // a quarter beat at 120 BPM
const ROLL_AT = 20000; // on a beat, so the grid's quarter-beat points are ROLL_AT + k * QUARTER

// A 120 BPM song whose drums are a strong kick on every beat; `rolls` = [startMs, hits, { s, off }] lay hits a quarter beat apart
// (`s` strength, `off` ms away from the grid) on top of it.
function song(rolls = [], { kicks = true } = {}) {
  const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: "ABCDEFGHIJKLMNOP" });
  // without the kicks, two weak hits at the ends give the drums their span (a roll is judged against the span of the drums)
  const drums = kicks ? Array.from({ length: 128 }, (_, i) => ({ t: i * 500, kind: "kick", s: 0.9 })) : [{ t: 0, kind: "hat", s: 0.1 }, { t: 63000, kind: "hat", s: 0.1 }];
  for (const [at, hits, { s = 0.9, off = 0 } = {}] of rolls) {
    for (let i = 0; i < hits; i++) if (i > 0 || !kicks) drums.push({ t: at + i * QUARTER + off, kind: "snare", s });
  }
  features.drums = drums.sort((a, b) => a.t - b.t);
  return features;
}
const chartsOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([l, c]) => [l, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))].sort((a, b) => a - b);
const key = (notes) => JSON.stringify(notes.map((n) => [n.t, n.lane, n.len ?? 0]));
const grid = (hits) => Array.from({ length: hits }, (_, i) => ROLL_AT + i * QUARTER);
const rulesOf = (features) => analyse(features).timing;

describe("the burst where the drums roll (diff.drumRuns)", () => {
  it("is a rule of Normal (from v45), and no other level has it", () => {
    assert.equal(DIFFICULTIES.normal.drumRuns, DRUM_RUNS);
    for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) {
      if (name !== "normal") assert.equal(level.drumRuns, undefined, name);
    }
  });

  it("finds a roll of strong hits on the quarter-beat grid, and only that", () => {
    const timing = rulesOf(song());
    const rolls = (rows, kicks) => drumRolls(song(rows, { kicks }).drums, timing, DRUM_RUNS);
    assert.deepEqual(rolls([[ROLL_AT, 8]], false).map((r) => r.times), [grid(8)]);
    assert.equal(rolls([[ROLL_AT, 4]], false).length, 0, "four hits are a fill, not a roll");
    assert.equal(rolls([[ROLL_AT, 8, { s: 0.45 }]], false).length, 0, "weak hits");
    assert.equal(rolls([[ROLL_AT, 8, { off: 45 }]], false).length, 0, "off the grid");
    assert.equal(rolls([[ROLL_AT, 8, { s: 0.45, off: 40 }]], false).length, 0, "weak and off the grid");
  });

  it("charts the roll on top of the stream, and charts nothing without the rule", () => {
    const features = song([[ROLL_AT, 8]]);
    const plain = chartsOf(features, WITHOUT), rolled = chartsOf(features, FITLESS);
    const inRoll = (notes) => momentsOf(notes, ROLL_AT - 1, ROLL_AT + 8 * QUARTER);
    assert.ok(inRoll(plain.normal).length <= 4, "Normal plays the roll at most every half beat");
    // the burst starts on the beat's own note, so the cap of five quarter gaps in a row (laneRules MAX_QUARTER_GAPS) stops it
    // after the notes 125, 250 and 375 ms in; the rest of the roll stays as it was
    const before = new Set(momentsOf(plain.normal));
    const added = momentsOf(rolled.normal).filter((t) => !before.has(t));
    assert.deepEqual(added, [ROLL_AT + QUARTER, ROLL_AT + 2 * QUARTER, ROLL_AT + 3 * QUARTER]);
    assert.equal(inRoll(rolled.normal).length, inRoll(plain.normal).length + 3);
    for (const t of momentsOf(plain.normal)) assert.ok(momentsOf(rolled.normal).includes(t), `${t} lost`);
    // the notes that were there keep to the gap floors: only the burst's own notes stand under 100 ms
    const times = momentsOf(rolled.normal);
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] < 100) assert.ok(times[i] - times[i - 1] >= DRUM_RUNS.minGapMs && (added.includes(times[i]) || added.includes(times[i - 1])), `gap at ${times[i]}`);
    // away from the roll the chart is the same
    assert.equal(key(rolled.normal.filter((n) => n.t < ROLL_AT - 2000)), key(plain.normal.filter((n) => n.t < ROLL_AT - 2000)));
  });

  it("makes no burst of weak hits, of hits off the grid, or of a short fill", () => {
    for (const roll of [[ROLL_AT, 8, { s: 0.45 }], [ROLL_AT, 8, { off: 45 }], [ROLL_AT, 8, { s: 0.5, off: 40 }], [ROLL_AT, 3]]) {
      const features = song([roll]);
      assert.deepEqual(chartsOf(features, FITLESS), chartsOf(features, WITHOUT), JSON.stringify(roll));
    }
  });

  it("makes no burst in a noise of kicks every 60 ms off the grid (AIZO, the first fifteen seconds)", () => {
    const features = song([], { kicks: false });
    features.drums = Array.from({ length: 250 }, (_, i) => ({ t: i * 60 + 11, kind: "kick", s: 0.3 + 0.4 * ((i * 7) % 5) / 5 }));
    assert.deepEqual(chartsOf(features, FITLESS), chartsOf(features, WITHOUT));
  });

  it("makes no burst in a song whose drums roll all the time", () => {
    // a roll on every bar from 4 s on, over 3% of the drums' span
    const rolls = Array.from({ length: 28 }, (_, i) => [4000 + i * 2000, 8]);
    const features = song(rolls);
    assert.ok(drumRolls(features.drums, rulesOf(features), DRUM_RUNS).length === 0);
    assert.equal(key(chartsOf(features, FITLESS).normal), key(chartsOf(features, WITHOUT).normal));
  });

  it("adds a note only inside a stream: none where the notes around it are far away", () => {
    const timing = rulesOf(song());
    const drums = song([[ROLL_AT, 8]], { kicks: false }).drums;
    const far = [{ t: ROLL_AT - 2000, lane: 0 }, { t: ROLL_AT + 3000, lane: 1 }];
    assert.equal(withDrumRunNotes(far, drums, timing, DRUM_RUNS), far);
    // an unfilled stretch of half beats: a note on a quarter beat between two notes
    const stream = Array.from({ length: 12 }, (_, i) => ({ t: ROLL_AT - 500 + i * 250, lane: i % 4 }));
    const out = withDrumRunNotes(stream, drums, timing, DRUM_RUNS);
    assert.ok(out.length > stream.length);
    // a note held across the quarter beat gets none
    const held = stream.map((n, i) => (i === 2 ? { ...n, len: 400 } : n));
    const heldOut = withDrumRunNotes(held, drums, timing, DRUM_RUNS);
    assert.ok(!heldOut.some((n) => n.t > held[2].t && n.t < held[2].t + 400 - DRUM_RUNS.minGapMs && !stream.some((s) => s.t === n.t)));
  });

  it("leaves Easy as it was, and Hard and Hell on top of Normal's burst with no note doubled", () => {
    const features = song([[ROLL_AT, 8]]);
    const plain = chartsOf(features, WITHOUT), rolled = chartsOf(features, FITLESS);
    assert.equal(key(rolled.easy), key(plain.easy));
    assert.notEqual(key(rolled.normal), key(plain.normal));
    for (const level of ["hard", "hell"]) {
      const kept = new Set(momentsOf(rolled[level]));
      for (const t of momentsOf(rolled.normal)) assert.ok(kept.has(t), `${level} lost ${t}`);
      const seen = new Set();
      for (const n of rolled[level]) {
        const k = `${n.t}/${n.lane}`;
        assert.ok(!seen.has(k), `${level} doubled ${k}`);
        seen.add(k);
      }
    }
  });

  it("is the same chart in the trace as in generate, with a step per added note", () => {
    const features = song([[ROLL_AT, 8]]);
    const all = chartsOf(features, FITLESS);
    for (const level of LEVELS) {
      const traced = traceChart(features, level, "k", FITLESS);
      assert.equal(key(traced.notes), key(all[level]), level);
    }
    const steps = traceChart(features, "normal", "k", FITLESS).records.filter((r) => r.kind === "drumRuns");
    assert.ok(steps.length >= 2 && steps.every((r) => r.final));
  });
});
