const assert = require("node:assert");
const { describe, it } = require("node:test");

const { deriveRunStats } = require("../../../helpers/mewbeat/runStats");

const chart = { notes: [{ t: 1000, len: 2000, lane: 0 }, { t: 5000, len: 0, lane: 1 }] };
const head = (j, d = null, t = 1000) => ({ n: 0, part: "head", j, t, d });
const tail = (j, t, d = null) => ({ n: 0, part: "tail", j, t, d });

describe("mewbeat run stats", () => {
  it("counts a hold up to its tail, clamped to the end of the note", () => {
    const clamped = deriveRunStats({ chart, events: [head("great"), tail("great", 3050)] });
    assert.equal(clamped.holdMs, 2000);
    assert.equal(clamped.longestHoldMs, 2000);
    assert.equal(deriveRunStats({ chart, events: [head("great"), tail("miss", 2200)] }).holdMs, 1200);
  });

  it("counts nothing for a missed head or a hold without a tail event", () => {
    assert.equal(deriveRunStats({ chart, events: [head("miss"), tail("miss", 3000)] }).holdMs, 0);
    assert.equal(deriveRunStats({ chart, events: [head("great")] }).holdMs, 0);
    assert.equal(deriveRunStats({ chart, events: [] }).longestHoldMs, 0);
  });

  it("totals the holds and keeps the longest apart", () => {
    const two = { notes: [{ t: 0, len: 500, lane: 0 }, { t: 1000, len: 900, lane: 1 }] };
    const events = [
      { n: 0, part: "head", j: "good", t: 0, d: 0 }, { n: 0, part: "tail", j: "good", t: 500, d: 0 },
      { n: 1, part: "head", j: "good", t: 1000, d: 0 }, { n: 1, part: "tail", j: "good", t: 1900, d: 0 },
    ];
    const stats = deriveRunStats({ chart: two, events });
    assert.equal(stats.holdMs, 1400);
    assert.equal(stats.longestHoldMs, 900);
  });

  it("ignores a timing error outside the plausible window", () => {
    const events = [
      { n: 0, part: "head", j: "great", t: 1000, d: 1e300 },
      { n: 0, part: "head", j: "great", t: 1000, d: -251 },
      { n: 0, part: "head", j: "great", t: 1000, d: 250 },
    ];
    assert.deepStrictEqual(deriveRunStats({ chart, events }).timing, { n: 1, sum: 250, sumSq: 62500, early: 0, late: 1 });
  });

  it("collects timing from head and tap events only, skipping a null d", () => {
    const events = [
      head("great", -10), tail("great", 3000, 99),
      { n: 1, part: "head", j: "great", t: 5000, d: 20 },
      { n: 1, part: "head", j: "miss", t: 5200, d: null },
    ];
    assert.deepStrictEqual(deriveRunStats({ chart, events }).timing, { n: 2, sum: 10, sumSq: 500, early: 1, late: 1 });
  });
});
