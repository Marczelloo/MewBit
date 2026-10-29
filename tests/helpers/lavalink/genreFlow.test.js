const assert = require("node:assert");
const { describe, it } = require("node:test");

const {
  evaluateGenreFlow,
  getCoreGenreFamilies,
  getGenreFamilyDistance,
} = require("../../../helpers/lavalink/genreUtils");

describe("Genre flow", () => {
  it("measures how far apart two genre families sit", () => {
    assert.strictEqual(getGenreFamilyDistance(["hiphop"], ["hiphop"]), 0);
    assert.strictEqual(getGenreFamilyDistance(["hiphop"], ["rnb"]), 1);
    assert.strictEqual(getGenreFamilyDistance(["hiphop"], ["metal"]), 3);
    assert.strictEqual(getGenreFamilyDistance([], ["metal"]), null);
  });

  it("reads the core families from the leading tags only", () => {
    assert.deepStrictEqual(getCoreGenreFamilies(["hip hop", "rap", "metal"], 2), ["hiphop"]);
  });

  it("never jumps from rap straight into metal or rock", () => {
    assert.strictEqual(evaluateGenreFlow(["metal"], ["hip hop"], ["hip hop"]).allowed, false);
    assert.strictEqual(evaluateGenreFlow(["rock"], ["hip hop"], ["hip hop"]).allowed, false);
  });

  it("moves one neighbouring genre at a time", () => {
    assert.strictEqual(evaluateGenreFlow(["rnb"], ["hip hop"], ["hip hop"]).reason, "near");
    // Rap -> pop -> rock is a walk, one step per track.
    assert.strictEqual(evaluateGenreFlow(["rock"], ["pop"], ["hip hop"]).reason, "near");
  });

  it("stops the walk from drifting too far from the session anchor", () => {
    const flow = evaluateGenreFlow(["metal"], ["rock"], ["hip hop"]);
    assert.strictEqual(flow.allowed, false);
    assert.strictEqual(flow.reason, "anchor-drift");
  });

  it("allows a two-step bridge only back towards the anchor", () => {
    assert.strictEqual(evaluateGenreFlow(["rock"], ["hip hop"], ["pop"]).reason, "bridge");
  });

  it("does not block what it cannot judge", () => {
    assert.strictEqual(evaluateGenreFlow([], ["hip hop"], ["hip hop"]).reason, "unknown-candidate");
    assert.strictEqual(evaluateGenreFlow(["metal"], [], []).reason, "unknown-session");
  });
});
