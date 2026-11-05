const assert = require("node:assert");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { openingLeadRates, phraseBudget } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const DURATION = 64000;
const QUIET_UNTIL = 16000;
const FLAG = { lead: true };

// Two quiet phrases and then the song, with a lead line of four notes a second all through.
const features = ({ lead = true } = {}) => {
  const f = makeLayeredFeatures({ bpm: 120, durationMs: DURATION });
  f.energy.values = f.energy.values.map((_, i) => (i * f.energy.hopMs < QUIET_UNTIL ? 0.15 : 0.8));
  for (const p of f.phrases.list) p.repeatOf = null;
  f.lead = lead ? Array.from({ length: DURATION / 250 }, (_, i) => ({ t: i * 250, s: 0.8, len: 200, pitch: 60 + (i % 5) * 2, conf: 0.9 })) : [];
  return f;
};
const momentsIn = (chart, from, to) => new Set(chart.notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t)).size;

describe("mewbeat opening lead", () => {
  describe("openingLeadRates", () => {
    it("counts the lead line only in the phrases before the first loud one", () => {
      const rates = openingLeadRates(analyse(features()));
      assert.ok(rates[0] > 1 && rates[1] > 1, `${rates[0]} ${rates[1]}`);
      assert.ok(rates.slice(2).every((r) => r === 0), rates.join());
    });

    it("is nothing without a lead line", () => {
      assert.ok(openingLeadRates(analyse(features({ lead: false }))).every((r) => r === 0));
    });
  });

  describe("phraseBudget", () => {
    it("lets a quiet opening play its lead line, and nothing past it (the control)", () => {
      const ctx = analyse(features());
      const plain = DIFFICULTIES.normal;
      const lifted = { ...plain, openingLead: 0.9 };
      assert.ok(phraseBudget(ctx.phrases[0], ctx, lifted) > phraseBudget(ctx.phrases[0], ctx, plain));
      assert.strictEqual(phraseBudget(ctx.phrases[4], ctx, lifted), phraseBudget(ctx.phrases[4], ctx, plain));
    });

    it("stays under the ceiling of the level", () => {
      const ctx = analyse(features());
      const lifted = { ...DIFFICULTIES.normal, openingLead: 100 };
      const seconds = (ctx.phrases[0].endMs - ctx.phrases[0].startMs) / 1000;
      assert.ok(phraseBudget(ctx.phrases[0], ctx, lifted) <= DIFFICULTIES.normal.maxNpsCeiling * seconds);
    });
  });

  describe("behind the lead flag", () => {
    it("leaves every level as it was with the flag off", () => {
      const off = generateAll(features(), "k");
      const none = generateAll(features(), "k", {});
      for (const level of LEVELS) assert.deepStrictEqual(none[level].notes, off[level].notes);
    });

    it("plays more of the opening on Normal and Hard, and keeps Easy under Normal", () => {
      const off = generateAll(features(), "k");
      const on = generateAll(features(), "k", FLAG);
      assert.ok(momentsIn(on.normal, 0, QUIET_UNTIL) > momentsIn(off.normal, 0, QUIET_UNTIL));
      assert.ok(momentsIn(on.hard, 0, QUIET_UNTIL) >= momentsIn(off.hard, 0, QUIET_UNTIL));
      assert.ok(momentsIn(on.easy, 0, QUIET_UNTIL) <= momentsIn(on.normal, 0, QUIET_UNTIL));
    });

    it("gives the same chart for the same song", () => {
      const a = generateAll(features(), "k", FLAG);
      const b = generateAll(features(), "k", FLAG);
      for (const level of LEVELS) assert.deepStrictEqual(a[level].notes, b[level].notes);
    });

    it("holds no note past the next moment on its own lane, nor past the song", () => {
      const on = generateAll(features(), "k", FLAG);
      for (const level of LEVELS) {
        const { notes } = on[level];
        for (const n of notes) {
          if (!(n.len > 0)) continue;
          assert.ok(n.t + n.len <= DURATION, `${level} ${n.t}+${n.len}`);
          const hit = notes.find((o) => o !== n && o.lane === n.lane && o.t >= n.t && o.t <= n.t + n.len);
          assert.strictEqual(hit, undefined, `${level} ${n.t}+${n.len} lane ${n.lane}`);
        }
      }
    });
  });
});
