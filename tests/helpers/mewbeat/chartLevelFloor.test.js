const assert = require("node:assert/strict");
const { afterEach, describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { analyse, generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const features = () => makeLayeredFeatures({ bpm: 150, durationMs: 96000 }); // 150 BPM: the song where Normal without its floor goes under Easy (at 170 the rules Normal gained by v45 keep it above)
const momentsIn = (notes, p) => new Set(notes.filter((n) => n.t >= p.startMs && n.t < p.endMs).map((n) => n.t)).size;
// The floor is easyV26, Easy before v44: Easy is cut from Normal now, so it can never be the thicker of the two.
const thinnerThanEasy = (charts, phrases, f) => {
  const easy = generateChart(f, "easyV26", "k").notes;
  return phrases.filter((p) => momentsIn(charts.normal.notes, p) < momentsIn(easy, p)).length;
};

describe("Normal is not thinner than Easy", () => {
  const notBelow = DIFFICULTIES.normal.notBelow;
  afterEach(() => { DIFFICULTIES.normal.notBelow = notBelow; });

  it("no phrase of Normal has fewer moments than Easy plays there", () => {
    const f = features();
    assert.equal(thinnerThanEasy(generateAll(f, "k"), analyse(f).phrases, f), 0);
    // and Easy itself, cut from Normal, plays no more moments than Normal in any phrase
    const charts = generateAll(f, "k");
    for (const p of analyse(f).phrases) assert.ok(momentsIn(charts.easy.notes, p) <= momentsIn(charts.normal.notes, p), `phrase at ${p.startMs}`);
  });

  it("this song does go thinner without the floor", () => { // the control: the test above sees the defect it is there for
    delete DIFFICULTIES.normal.notBelow;
    const f = features();
    assert.ok(thinnerThanEasy(generateAll(f, "k"), analyse(f).phrases, f) > 0);
  });

  it("the floor moves Normal, not the levels that stay as they were", () => {
    const f = features();
    // Easy, Hard and Hell are cut from or built on Normal since v44 and move with it; hardBase and easyV26 do not read it
    const unmoved = () => Object.fromEntries(["hardBase", "easyV26"].map((level) => [level, generateChart(f, level, "k").notes]));
    const floored = { normal: generateAll(f, "k").normal.notes, ...unmoved() };
    delete DIFFICULTIES.normal.notBelow;
    const free = { normal: generateAll(f, "k").normal.notes, ...unmoved() };
    assert.notDeepEqual(floored.normal, free.normal);
    for (const level of ["hardBase", "easyV26"]) assert.deepEqual(floored[level], free[level], level);
  });
});
