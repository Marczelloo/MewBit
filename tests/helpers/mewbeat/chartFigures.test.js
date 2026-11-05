const assert = require("node:assert");
const { describe, it } = require("node:test");

const { figureTimes } = require("../../../helpers/mewbeat/charts/figures");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { selectMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const BEAT = 400;
const SLOT = BEAT / 4;
const BARS = 24;
const grid = Array.from({ length: BARS * 16 + 1 }, (_, i) => i * SLOT);
const timing = { snapped: true, gridPoints: () => grid, beats: grid.filter((_, i) => i % 4 === 0), downbeats: [], beatMsAt: () => BEAT, medianMs: BEAT };
const SPEC = FLAGS.figures.levels.normal.figures;
const QUARTERS = FLAGS.figuresQuarter.levels.normal.figures;
// A hit at every one of the slots of a bar, in the bars from..to.
const hits = (kind, slots, from = 0, to = BARS) =>
  Array.from({ length: to - from }, (_, b) => slots.map((k) => ({ t: (from + b) * 16 * SLOT + k * SLOT, s: 0.8, kind }))).flat();
const ctxWith = (features) => ({ timing, features: { drums: [], bass: [], bands: [], ...features } });

describe("mewbeat figures", () => {
  describe("figureTimes", () => {
    it("finds a snare that comes back at the same place of the bar", () => {
      const out = figureTimes(ctxWith({ drums: hits("snare", [4, 12]) }), SPEC);
      assert.ok(out.has(10 * 16 * SLOT + 4 * SLOT));
      assert.ok(out.has(10 * 16 * SLOT + 12 * SLOT));
      assert.ok(!out.has(10 * 16 * SLOT + 8 * SLOT), "nothing sounds there");
    });

    it("takes a figure of two bars as well", () => {
      const everyOther = Array.from({ length: BARS / 2 }, (_, b) => ({ t: b * 32 * SLOT + 6 * SLOT, s: 0.8, kind: "kick" }));
      assert.ok(figureTimes(ctxWith({ drums: everyOther }), SPEC).has(10 * 32 * SLOT + 6 * SLOT));
    });

    it("leaves an onset that does not come back", () => {
      const lone = { t: 10 * 16 * SLOT + 8 * SLOT, s: 0.8, kind: "snare" };
      assert.strictEqual(figureTimes(ctxWith({ drums: [lone] }), SPEC).size, 0);
    });

    it("reads hats as no figure", () => {
      assert.strictEqual(figureTimes(ctxWith({ drums: hits("hat", [0, 2, 4, 6, 8, 10, 12, 14]) }), SPEC).size, 0);
    });

    it("follows a repeating bass, and leaves one it does not trust", () => {
      const notes = hits("bass", [6]).map((n) => ({ ...n, conf: 1 }));
      assert.ok(figureTimes(ctxWith({ bass: notes }), SPEC).size > 0);
      assert.strictEqual(figureTimes(ctxWith({ bass: notes.map((n) => ({ ...n, conf: 0.1 })) }), SPEC).size, 0);
    });

    it("asks the low band for a stricter repeat than the drums", () => {
      const fourInFive = hits("kick", [2]).filter((_, b) => b % 5 !== 0);
      const inTheMiddle = 12 * 16 * SLOT + 2 * SLOT; // three quarters of the bars around it sound there
      assert.ok(figureTimes(ctxWith({ drums: fourInFive }), SPEC).has(inTheMiddle));
      assert.ok(!figureTimes(ctxWith({ bands: [{ name: "low", onsets: fourInFive }] }), SPEC).has(inTheMiddle));
      assert.ok(figureTimes(ctxWith({ bands: [{ name: "low", onsets: hits("low", [2]) }] }), SPEC).has(inTheMiddle));
    });

    it("takes quarter beats only when asked to", () => {
      const drums = hits("kick", [3]);
      assert.strictEqual(figureTimes(ctxWith({ drums }), SPEC).size, 0);
      assert.ok(figureTimes(ctxWith({ drums }), QUARTERS).size > 0);
    });

    it("is empty without a grid or without drums", () => {
      assert.strictEqual(figureTimes({ timing: { snapped: false }, features: { drums: hits("snare", [4]) } }, SPEC).size, 0);
      assert.strictEqual(figureTimes({ timing, features: { drums: "none", bass: null } }, SPEC).size, 0);
    });
  });

  describe("selectMoments", () => {
    const phrase = { startMs: 0, endMs: 4 * BEAT, pulse: 0 };
    const diff = { foreground: 0.5, gapBeats: 1 / 4, minNoteGapMs: 90, figures: SPEC };
    const moment = (beats, score, metric) => ({ t: beats * BEAT, s: 0.5, score, metric, down: 0, grid: 0, source: "low" });
    const scored = [moment(0, 2, 0), moment(1, 2, 0), moment(1.5, 0, 1), moment(2.5, 0.2, 1), moment(3, 2, 0)];
    const times = (notes) => notes.map((n) => n.t / BEAT);

    it("gives what the foreground leaves to a figure before the strongest of the rest", () => {
      const notes = selectMoments(phrase, scored, 4, diff, timing, { figures: new Set([1.5 * BEAT]) });
      assert.deepStrictEqual(times(notes), [0, 1, 1.5, 3]);
      assert.strictEqual(notes[2].reason, "figura");
      assert.deepStrictEqual(times(selectMoments(phrase, scored, 4, diff, timing, { figures: new Set() })), [0, 1, 2.5, 3]);
    });

    it("drops no note of the foreground for a figure", () => {
      assert.deepStrictEqual(times(selectMoments(phrase, scored, 3, diff, timing, { figures: new Set([1.5 * BEAT]) })), [0, 1, 3]);
    });

    it("goes over the budget only by the figure's room", () => {
      const figures = new Set([1.5 * BEAT, 2.5 * BEAT]);
      assert.deepStrictEqual(times(selectMoments(phrase, scored, 3, diff, timing, { figures, figureRoom: 1 })), [0, 1, 2.5, 3]);
    });

    it("keeps a figure off its neighbours, and lets a quarter beat sit next to them", () => {
      const figures = new Set([0.25 * BEAT]);
      const around = [moment(0, 2, 0), moment(2, 2, 0)];
      assert.deepStrictEqual(times(selectMoments(phrase, [...around, moment(0.25, 0, 1)], 4, diff, timing, { figures })), [0, 2]);
      assert.deepStrictEqual(times(selectMoments(phrase, [...around, moment(0.25, 0, 2)], 4, diff, timing, { figures })), [0, 0.25, 2]);
    });
  });

  describe("the flags", () => {
    const features = makeLayeredFeatures();
    const off = generateAll(features, "figures");

    for (const flag of ["figures", "figuresQuarter"]) {
      it(`${flag} touches Normal alone`, () => {
        const on = generateAll(features, "figures", { [flag]: true });
        for (const level of ["easy", "hard", "hell"]) assert.deepStrictEqual(on[level].notes, off[level].notes, level);
      });
    }
  });
});
