const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, MELODY_SHIFT_PICK, PLUS_MELODY } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
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

describe("extras on the melody for the levels built on Normal (flag plusMelody)", () => {
  const moments = (notes) => new Set(notes.map((n) => n.t));
  // A melody too busy for Normal: a note on every sound of the second half of each bar.
  const busy = (features) => {
    const line = snappedMoments(analyse(features), "hard").filter((m) => m.t % 2000 >= 1000).map((m) => ({ t: m.raw ?? m.t, pitch: 60 }));
    return { ...features, decodedMelody: line, decodedMelodyTuned: line };
  };
  const played = (notes, features) => features.decodedMelody.filter((n) => moments(notes).has(n.t)).length;

  it("is a flag of Hard and Hell, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.plusMelody.levels, { hard: { plusMelody: PLUS_MELODY }, hell: { plusMelody: PLUS_MELODY } });
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.plusMelody, undefined);
  });

  it("changes nothing in a song with no decoded melody", () => {
    const features = makeLayeredFeatures();
    assert.deepEqual(notesOf(features, ["plusMelody"]), notesOf(features));
  });

  it("gives Hard and Hell more of the melody's notes, Easy and Normal stay", () => {
    const features = busy(makeLayeredFeatures());
    const plain = notesOf(features), flagged = notesOf(features, ["plusMelody"]);
    assert.deepEqual(flagged.easy, plain.easy);
    assert.deepEqual(flagged.normal, plain.normal);
    for (const level of ["hard", "hell"]) assert.ok(played(flagged[level], features) > played(plain[level], features), level);
  });

  it("still keeps every moment of the level it is built on", () => {
    const flagged = notesOf(busy(makeLayeredFeatures()), ["plusMelody"]);
    for (const [lower, upper] of [["normal", "hard"], ["hard", "hell"]]) {
      const kept = moments(flagged[upper]);
      for (const t of moments(flagged[lower])) assert.ok(kept.has(t), `${upper} lost ${t} of ${lower}`);
    }
  });
});
