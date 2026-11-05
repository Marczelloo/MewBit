const assert = require("node:assert");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const pinned = require("./fixtures/v26-notes.json");
const { flagWithout, makeFeatures, makeLayeredFeatures, threeSectionEnergy } = require("./fixtures");

// The charts of generator v26 as hashes (fixtures/v26-notes.json, taken before the levels were rewired): under what v32
// laid over them Easy and Hard and Hell stay v26, normalV26 is the Normal of v26. Re-pinned once, for the song's first
// second: every hash matched with the old one-second lead-in and only LEAD_IN_MS moved to 0.
const UNDER_V32 = flagWithout("underv32", "localThin", "holdsByCalm", "shortestHoldMaxMs", "laneSearch", "chordFlow", "openingLead");
const FIXTURES = {
  plain120: () => makeFeatures({ bpm: 120, durationMs: 180000, energy: threeSectionEnergy }),
  plain90: () => makeFeatures({ bpm: 90, durationMs: 120000, energy: threeSectionEnergy }),
  plain170: () => makeFeatures({ bpm: 170, durationMs: 120000, energy: threeSectionEnergy }),
  layered: () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  layeredHolds: () => makeLayeredFeatures({ bpm: 100, durationMs: 96000, structure: "ABAC", holdsEveryBeats: 4 }),
  layeredSustain: () => makeLayeredFeatures({ bpm: 140, durationMs: 80000, structure: "AABB", sustainAtBeats: [4, 10] }),
  layeredNoLead: () => makeLayeredFeatures({ bpm: 128, durationMs: 64000, lead: false, energy: threeSectionEnergy }),
};
const KEY = "youtube:fixture:180000";

const sha1 = (notes) => crypto.createHash("sha1").update(JSON.stringify(notes)).digest("hex");

function check(level, name) {
  for (const [fixture, make] of Object.entries(FIXTURES)) {
    const notes = generateChart(make(), name, KEY, UNDER_V32).notes;
    assert.deepStrictEqual({ count: notes.length, sha1: sha1(notes) }, pinned[fixture][level], `${level} on ${fixture}`);
  }
}

describe("v26 identity", () => {
  it("easy, hard and hell notes stay identical to v26", () => {
    for (const level of ["easy", "hard", "hell"]) check(level, level);
  });

  it("normalV26 charts the Normal of v26", () => {
    check("normal", "normalV26");
  });

  it("generateAll exposes only public levels", () => {
    assert.deepStrictEqual(Object.keys(DIFFICULTIES), ["easy", "normal", "hard", "hell"]);
    const all = generateAll(FIXTURES.plain120(), KEY);
    assert.deepStrictEqual(Object.keys(all), ["easy", "normal", "hard", "hell"]);
  });

  it("an unknown level throws", () => {
    assert.throws(() => generateChart(FIXTURES.layered(), "normalV27", KEY), /Unknown difficulty/);
  });
});
