const assert = require("node:assert/strict");
const { afterEach, describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const features = () => makeLayeredFeatures({ bpm: 170, durationMs: 96000 });
const momentsIn = (notes, p) => new Set(notes.filter((n) => n.t >= p.startMs && n.t < p.endMs).map((n) => n.t)).size;
const thinnerThanEasy = (charts, phrases) => phrases.filter((p) => momentsIn(charts.normal.notes, p) < momentsIn(charts.easy.notes, p)).length;

describe("Normal is not thinner than Easy", () => {
  const notBelow = DIFFICULTIES.normal.notBelow;
  afterEach(() => { DIFFICULTIES.normal.notBelow = notBelow; });

  it("no phrase of Normal has fewer moments than Easy plays there", () => {
    const f = features();
    assert.equal(thinnerThanEasy(generateAll(f, "k"), analyse(f).phrases), 0);
  });

  it("this song does go thinner without the floor", () => { // the control: the test above sees the defect it is there for
    delete DIFFICULTIES.normal.notBelow;
    const f = features();
    assert.ok(thinnerThanEasy(generateAll(f, "k"), analyse(f).phrases) > 0);
  });

  it("the floor moves only Normal", () => {
    const f = features();
    const floored = generateAll(f, "k");
    delete DIFFICULTIES.normal.notBelow;
    const free = generateAll(f, "k");
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(floored[level].notes, free[level].notes, level);
  });
});
