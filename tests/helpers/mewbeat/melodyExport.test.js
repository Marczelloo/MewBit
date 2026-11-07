const assert = require("node:assert");
const { describe, it } = require("node:test");

const { melodyFileOf } = require("../../../scripts/mewbeat-melody/build");
const fixture = require("./fixtures/melody-export.json");

// `expected` was made by the export script before it was split into melodyFileOf (scripts/mewbeat-melody/build.js).
describe("mewbeat melody export", () => {
  it("makes the same melody file as the export script did", () => {
    assert.deepStrictEqual(melodyFileOf(fixture.decoded, fixture.features, fixture.short), fixture.expected);
  });

  it("leaves `short` out when there is no second run", () => {
    const { short, ...rest } = fixture.expected;
    assert.deepStrictEqual(melodyFileOf(fixture.decoded, fixture.features), rest);
  });

  it("moves every note by the shift to our lead line", () => {
    const melody = melodyFileOf(fixture.decoded, fixture.features, fixture.short);
    const [t, len, midi, vel] = fixture.short[0];
    assert.deepStrictEqual(melody.short[0], [Math.round(t + melody.shiftMs), len, midi, vel]);
    assert.strictEqual(melody.all.length, fixture.decoded.notes.length);
  });
});
