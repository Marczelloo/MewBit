const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, MELODY_SHIFT_PICK } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const notesOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([level, chart]) => [level, chart.notes]));
// The fixture's lead line as the second detector would hand it over, `late` ms after where it sounds.
const withMelody = (features, late = 0) => {
  const line = features.lead.map((n) => ({ t: n.t + late, pitch: n.pitch }));
  return { ...features, decodedMelody: line, decodedMelodyTuned: line };
};

describe("the melody's shift picked against the song's sounds (flag melodyShiftPick)", () => {
  it("is a flag of Normal, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.melodyShiftPick.levels, { normal: { melodyShiftPick: MELODY_SHIFT_PICK } });
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.melodyShiftPick, undefined);
  });

  it("leaves a melody that sits on the sounds where it is", () => {
    const features = withMelody(makeLayeredFeatures());
    assert.deepEqual(notesOf(features, ["melodyShiftPick"]), notesOf(features));
  });

  it("puts a melody that comes 56 ms late back on the sounds", () => {
    const features = makeLayeredFeatures();
    const placed = notesOf(withMelody(features)), late = withMelody(features, 56);
    assert.notDeepEqual(notesOf(late).normal, placed.normal);
    const picked = notesOf(late, ["melodyShiftPick"]);
    for (const level of LEVELS) assert.deepEqual(picked[level], placed[level], level);
  });
});
