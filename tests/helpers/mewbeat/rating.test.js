const assert = require("node:assert");
const { describe, it } = require("node:test");

const { playPp, ratingOf } = require("../../../helpers/mewbeat/rating");

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

describe("mewbeat rating", () => {
  it("scales a play by stars and by accuracy above the floor", () => {
    near(playPp({ stars: 4, accuracy: 100 }), 8 * 4 ** 2.2);
    near(playPp({ stars: 4, accuracy: 75 }), 8 * 4 ** 2.2 * 0.5 ** 2.5);
  });

  it("gives nothing at or below the accuracy floor, or without stars", () => {
    assert.equal(playPp({ stars: 4, accuracy: 50 }), 0);
    assert.equal(playPp({ stars: 4, accuracy: 30 }), 0);
    assert.equal(playPp({ stars: null, accuracy: 99 }), 0);
    assert.equal(playPp({ stars: 4, accuracy: null }), 0);
  });

  it("weights the plays by rank, best first, without touching the input", () => {
    assert.equal(ratingOf([]), 0);
    near(ratingOf([100, 200]), 200 + 100 * 0.95);
    const pps = [100, 200];
    ratingOf(pps);
    assert.deepStrictEqual(pps, [100, 200]);
  });
});
