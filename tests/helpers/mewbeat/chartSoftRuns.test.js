const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, SOFT_RUNS } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateAll, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { placeRunNotes, withRunNotes } = require("../../../helpers/mewbeat/charts/melodyPick");
const { softRunTimes, withSoftRunNotes } = require("../../../helpers/mewbeat/charts/softRuns");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const PLAIN = flagWithout("withoutsoftruns", "softRuns");
const BEAT = 500; // 120 BPM, a quarter beat is 125 ms
const QUARTERS = Array.from({ length: 400 }, (_, i) => i * (BEAT / 4));
const timing = { snapped: true, beatMsAt: () => BEAT, gridPoints: () => QUARTERS, intervalOk: () => true };
const note = (t, extra = {}) => ({ t, lane: 0, ...extra });
const times = (notes) => notes.map((n) => n.t);
const key = (notes) => JSON.stringify(notes.map((n) => [n.t, n.lane, n.len ?? 0]));
const momentsOf = (notes) => [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);

describe("the burst where every decoded note runs fast (softRuns)", () => {
  it("is a rule of Normal (from v45), and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.normal.softRuns, SOFT_RUNS);
    for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (name !== "normal") assert.equal(level.softRuns, undefined, name);
  });

  it("finds a quarter-beat grid point where a decoded note of a fast run begins, and only that", () => {
    // four notes 125 ms apart: a run; a lone note 1 s later: no run; the first run note 40 ms off the grid: not on it
    const run = [1000, 1125, 1250, 1375].map((t) => ({ t, vel: 0.5 }));
    const rule = { ...SOFT_RUNS, minRun: 2 };
    assert.deepEqual(softRunTimes(run, timing, rule), [1000, 1125, 1250, 1375]);
    assert.deepEqual(softRunTimes([...run, { t: 2500, vel: 0.5 }], timing, rule), [1000, 1125, 1250, 1375]);
    assert.deepEqual(softRunTimes(run.map((n, i) => (i === 0 ? { ...n, t: 1040 } : n)), timing, rule), [1125, 1250, 1375]);
    // notes within mergeMs are one onset (a chord), so two chords 125 ms apart are a run and one chord is not
    assert.deepEqual(softRunTimes([{ t: 1000 }, { t: 1020 }, { t: 1040 }], timing, rule), []);
    // a run of three notes is no run under minRun 4; a quiet onset is none under minVel
    assert.deepEqual(softRunTimes(run.slice(0, 3), timing, { ...rule, minRun: 4 }), []);
    assert.deepEqual(softRunTimes(run, timing, { ...rule, minVel: 0.6 }), []);
    assert.deepEqual(softRunTimes(run, { snapped: false }, rule), []);
    assert.deepEqual(softRunTimes(null, timing, rule), []);
  });

  it("adds a note inside a stream, none beside a real sustain or far from the stream, and at most maxRun short gaps in a row", () => {
    const rule = { ...SOFT_RUNS, minRun: 2, cutGapHolds: false, onlyOverHolds: false };
    const stream = [1000, 1250, 1500, 1750].map((t) => note(t));
    // every decoded note 125 ms apart: the quarter beats between the half beats become moments, but not a fourth short gap in a row
    const run = [1000, 1125, 1250, 1375, 1500, 1625, 1750].map((t) => ({ t, vel: 0.5 }));
    assert.deepEqual(times(withSoftRunNotes(stream, run, timing, rule)), [1000, 1125, 1250, 1500, 1625, 1750]);
    const longer = [1000, 1250, 1500, 1750, 2000, 2250].map((t) => note(t));
    const all = Array.from({ length: 11 }, (_, i) => ({ t: 1000 + i * 125, vel: 0.5 }));
    const out = times(withSoftRunNotes(longer, all, timing, rule));
    let worst = 0, row = 0;
    for (let i = 1; i < out.length; i++) { row = out[i] - out[i - 1] <= BEAT * 0.3 ? row + 1 : 0; worst = Math.max(worst, row); }
    assert.ok(worst <= SOFT_RUNS.maxRun, `${worst} short gaps in a row`);
    // far from the stream: no neighbour within streamBeats of a beat
    const far = [note(1000), note(4000)];
    assert.equal(withSoftRunNotes(far, [1125, 1250].map((t) => ({ t })), timing, rule), far);
    // a hold over the note keeps it out, with cutGapHolds off
    const held = [note(1000, { len: 200 }), ...stream.slice(1)];
    assert.ok(!times(withSoftRunNotes(held, run, timing, rule)).includes(1125));
    // a note that exists is not doubled
    assert.deepEqual(times(withSoftRunNotes(stream, [{ t: 1250 }, { t: 1375 }], timing, rule)), [1000, 1250, 1375, 1500, 1750]);
  });

  it("lets a gap hold give way to the burst, a real sustain not, and with onlyOverHolds adds nothing where no hold lies", () => {
    const rule = { ...SOFT_RUNS, minRun: 2 };
    const gap = (n) => n.gap === true;
    const run = [1000, 1125, 1250, 1375, 1500].map((t) => ({ t, vel: 0.5 }));
    const gapHeld = [note(1000, { len: 450, gap: true }), note(1500)];
    const out = withSoftRunNotes(gapHeld, run, timing, rule, gap);
    // 1375 would be a fourth short gap in a row: the run stays a burst
    assert.deepEqual(times(out), [1000, 1125, 1250, 1500]);
    assert.equal(out[0].len, 0, "the hold is a tap now");
    // the burst notes that follow the first one stay in the run: they began in the same hold
    const sustained = [note(1000, { len: 450 }), note(1500)];
    assert.equal(withSoftRunNotes(sustained, run, timing, rule, gap), sustained);
    // onlyOverHolds: a stream with no hold gets no burst note, a hold gets one
    const stream = [1000, 1250, 1500].map((t) => note(t));
    const only = { ...rule, onlyOverHolds: true };
    assert.equal(withSoftRunNotes(stream, run, timing, only, gap), stream);
    assert.ok(withSoftRunNotes(gapHeld, run, timing, only, gap).length > gapHeld.length);
    // without the rule's cutGapHolds the hold keeps the note out
    assert.equal(withSoftRunNotes(gapHeld, run, timing, { ...rule, cutGapHolds: false }, gap), gapHeld);
  });

  it("changes nothing in the shared placing without the new rules: withRunNotes keeps its notes note for note", () => {
    const rule = { fastMs: 200, streamBeats: 1.1, minGapMs: 100, maxRun: 3 };
    const notes = [{ t: 1000, lane: 0, len: 450 }, { t: 1500, lane: 1 }];
    const scored = [{ t: 1125, melodyRun: true }, { t: 1250, melodyRun: true }];
    assert.equal(withRunNotes(notes, scored, timing, rule), notes, "a hold keeps the burst out");
    assert.equal(placeRunNotes(notes, [1125, 1250], timing, rule, () => true), notes, "a gapHold function alone does nothing");
  });

  function songWith(decoded) {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: "ABCDEFGHIJKLMNOP" });
    return { ...features, decodedMelody: decoded, decodedMelodyTuned: decoded, decodedNotes: decoded };
  }
  const fastLine = Array.from({ length: 400 }, (_, i) => ({ t: 1000 + i * 125, pitch: 60 + (i % 5), vel: 0.6 }));

  it("charts where no melody was decoded as without the rule, and a decoded line the same way every time", () => {
    const bare = makeLayeredFeatures({ bpm: 120, durationMs: 64000, structure: "ABCDEFGHIJKLMNOP" });
    const plain = generateAll(bare, "k", PLAIN);
    const charted = generateAll(bare, "k");
    for (const level of LEVELS) assert.equal(key(charted[level].notes), key(plain[level].notes), level);
    const features = songWith(fastLine);
    const on = generateAll(features, "k"), again = generateAll(features, "k");
    for (const level of LEVELS) assert.equal(key(on[level].notes), key(again[level].notes), level);
  });

  it("leaves Easy as it was, and keeps every moment of Normal in Hard and Hell with no note doubled", () => {
    const features = songWith(fastLine);
    const plain = generateAll(features, "k", PLAIN), soft = generateAll(features, "k");
    assert.equal(key(soft.easy.notes), key(plain.easy.notes));
    for (const level of ["hard", "hell"]) {
      const kept = new Set(momentsOf(soft[level].notes));
      for (const t of momentsOf(soft.normal.notes)) assert.ok(kept.has(t), `${level} lost ${t}`);
      const seen = new Set();
      for (const n of soft[level].notes) {
        const k = `${n.t}/${n.lane}`;
        assert.ok(!seen.has(k), `${level} doubled ${k}`);
        seen.add(k);
      }
    }
  });

  it("is the same chart in the trace as in generate, with a step record per added note", () => {
    const features = songWith(fastLine);
    const all = generateAll(features, "k");
    for (const level of LEVELS) assert.equal(key(traceChart(features, level, "k").notes), key(all[level].notes), level);
    const steps = traceChart(features, "normal", "k").records.filter((r) => r.kind === "softRuns");
    assert.ok(steps.every((r) => r.final || r.rejected));
  });
});
