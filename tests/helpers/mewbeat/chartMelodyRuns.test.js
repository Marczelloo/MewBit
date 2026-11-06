const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { withMelodyRuns, withRunNotes } = require("../../../helpers/mewbeat/charts/melodyPick");
const { makeLayeredFeatures } = require("./fixtures");

const RULE = FLAGS.melodyRuns.levels.normal.melodyRuns;
const timing = { snapped: true, beatMsAt: () => 500 };

describe("short bursts where the melody runs fast (flag melodyRuns)", () => {
  it("marks a moment on a melody start whose neighbour starts within fastMs", () => {
    const scored = [{ t: 1000 }, { t: 1250, raw: 1260 }, { t: 2000 }];
    const melody = [{ t: 1000 }, { t: 1130 }, { t: 2000 }, { t: 2600 }];
    assert.deepEqual(withMelodyRuns(scored, melody, RULE).map((m) => Boolean(m.melodyRun)), [true, false, false]);
    assert.equal(withMelodyRuns(scored, [{ t: 1000 }], RULE), scored);
  });

  it("adds a marked moment inside a stream, not beside a hold, and caps a burst at maxRun short gaps", () => {
    const notes = [{ t: 1000, lane: 0 }, { t: 1250, lane: 0 }, { t: 1500, lane: 0 }];
    const runs = [{ t: 1125, melodyRun: true }, { t: 1375, melodyRun: true }, { t: 3000, melodyRun: true }];
    // 1375 would make four short gaps in a row, one over maxRun
    assert.deepEqual(withRunNotes(notes, runs, timing, RULE).map((n) => n.t), [1000, 1125, 1250, 1500]);
    assert.deepEqual(withRunNotes(notes, runs.slice(1), timing, RULE).map((n) => n.t), [1000, 1250, 1375, 1500]);
    const held = [{ t: 1000, lane: 0, len: 200 }, { t: 1250, lane: 0 }];
    assert.deepEqual(withRunNotes(held, runs, timing, RULE).map((n) => n.t), [1000, 1250]);
    const stream = [1000, 1125, 1250, 1375, 1500, 1750].map((t) => ({ t, lane: 0 }));
    assert.deepEqual(withRunNotes(stream, [{ t: 1625, melodyRun: true }], timing, RULE).map((n) => n.t), stream.map((n) => n.t));
    assert.equal(withRunNotes(notes, [{ t: 1125 }], timing, RULE), notes);
  });

  it("changes Normal alone, and only with the flag on and a melody decoded", () => {
    const features = makeLayeredFeatures();
    const run = Array.from({ length: 200 }, (_, i) => ({ t: 1000 + Math.floor(i / 2) * 500 + (i % 2) * 125, pitch: 60 + (i % 5) }));
    const decoded = { ...features, decodedMelody: run, decodedMelodyTuned: run };
    const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
    const plain = notesOf(generateAll(decoded, "k", {}));
    assert.deepEqual(notesOf(generateAll(features, "k", { melodyRuns: true })), notesOf(generateAll(features, "k", {})));
    const on = notesOf(generateAll(decoded, "k", { melodyRuns: true }));
    assert.ok(on.normal.length > plain.normal.length);
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.deepEqual(Object.keys(FLAGS.melodyRuns.levels), ["normal"]);
  });
});
