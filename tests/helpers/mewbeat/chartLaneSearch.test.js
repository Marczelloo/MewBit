const assert = require("node:assert");
const { describe, it } = require("node:test");

const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { normalViolations } = require("../../../helpers/mewbeat/charts/laneRules");
const { searchLanes } = require("../../../helpers/mewbeat/charts/laneSearch");
const { assignLanes } = require("../../../helpers/mewbeat/charts/lanes");
const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const DURATION = 64000;
const WITHOUT = flagWithout("withoutsearch", "laneSearch", "chordFlow");
const features = () => makeLayeredFeatures({ bpm: 120, durationMs: DURATION });

describe("mewbeat lane search", () => {
  describe("in the charts", () => {
    it("gives the same chart for the same song", () => {
      const a = generateAll(features(), "k");
      const b = generateAll(features(), "k");
      for (const level of LEVELS) assert.deepStrictEqual(a[level].notes, b[level].notes);
    });

    it("changes the lanes on every level", () => {
      const off = generateAll(features(), "k", WITHOUT);
      const on = generateAll(features(), "k");
      for (const level of LEVELS) assert.notDeepStrictEqual(on[level].notes, off[level].notes, level);
    });

    it("holds no note past the next moment on its own lane, nor past the song", () => {
      const on = generateAll(features(), "k");
      for (const level of LEVELS) {
        const notes = on[level].notes;
        for (const n of notes) {
          if (!(n.len > 0)) continue;
          assert.ok(n.t + n.len <= DURATION, `${level} ${n.t}+${n.len}`);
          const hit = notes.find((o) => o !== n && o.lane === n.lane && o.t >= n.t && o.t <= n.t + n.len);
          assert.strictEqual(hit, undefined, `${level} ${n.t}+${n.len} lane ${n.lane}`);
        }
      }
    });

    it("keeps Normal within the rules of its lanes, which random lanes break (the control)", () => {
      const on = generateAll(features(), "k");
      const { timing } = analyse(features());
      assert.deepStrictEqual(normalViolations(on.normal.notes, timing, { durationMs: DURATION }), []);
      let x = 7;
      const random = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const shuffled = on.normal.notes.map((n) => ({ ...n, lane: Math.floor(random() * 4) }));
      assert.ok(normalViolations(shuffled, timing, { durationMs: DURATION }).length > 0);
    });

    it("keeps the number of holds of the chart without the search", () => {
      const off = generateAll(features(), "k", WITHOUT);
      const on = generateAll(features(), "k");
      const holds = (chart) => chart.notes.filter((n) => n.len > 0).length;
      assert.ok(Math.abs(holds(on.normal) - holds(off.normal)) <= 0.1 * holds(off.normal), `${holds(on.normal)} against ${holds(off.normal)}`);
    });
  });

  describe("searchLanes", () => {
    const ctx = analyse(features());
    const diff = DIFFICULTIES.normal;
    const notes = generateAll(features(), "k", WITHOUT).normal.notes;
    const kept = (a, b) => {
      const seen = new Set(a.map((n) => `${n.t}:${n.lane}`));
      return b.filter((n) => seen.has(`${n.t}:${n.lane}`)).length / b.length;
    };

    it("does not change the notes it is given", () => {
      const before = JSON.stringify(notes);
      searchLanes(notes, ctx, diff);
      assert.strictEqual(JSON.stringify(notes), before);
    });

    it("lets a small change stay where it is, where the walk of lanes.js reshuffles what comes after (the control)", () => {
      const from = notes[Math.floor(notes.length * 0.1)].t;
      const fewer = notes.filter((n) => n.t !== from);
      const later = (list) => list.filter((n) => n.t > from + 4000);
      const search = kept(later(searchLanes(notes, ctx, diff)), later(searchLanes(fewer, ctx, diff)));
      const walk = kept(later(assignLanes(notes.map((n) => ({ ...n })), ctx, DIFFICULTIES.normal)), later(assignLanes(fewer.map((n) => ({ ...n })), ctx, DIFFICULTIES.normal)));
      assert.ok(search > 0.8, `search ${search}`);
      assert.ok(walk < search, `walk ${walk}, search ${search}`);
    });

    it("gives nothing for no notes", () => {
      assert.deepStrictEqual(searchLanes([], ctx, diff), []);
    });
  });
});
