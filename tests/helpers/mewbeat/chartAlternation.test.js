const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { alternateSteps } = require("../../../helpers/mewbeat/charts/laneRules");
const { searchLanes } = require("../../../helpers/mewbeat/charts/laneSearch");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

const BEAT_MS = 500; // the fixtures play at 120 BPM
const DURATION_MS = 64000;
const timing = buildTiming(makeFeatures({ durationMs: DURATION_MS }), DURATION_MS);
const beatOf = () => BEAT_MS;
const RULE = FLAGS.twoKeyTrill.levels.normal.twoKeyTrill;

// A lead line with these pitches, one note a half beat from 1000 ms.
const leadOf = (pitches) => pitches.map((pitch, i) => ({ t: 1000 + i * 250, pitch, conf: 0.9 }));
const context = (pitches) => ({ features: { lead: leadOf(pitches), bass: [], bands: [] }, timing, phrases: [], durationMs: DURATION_MS });
const timesOf = (n) => Array.from({ length: n }, (_, i) => 1000 + i * 250);

describe("the moments of an alternation (laneRules.js alternateSteps)", () => {
  it("marks a run of four or more notes going back and forth between two pitches, from its third note", () => {
    const marks = alternateSteps(context([60, 64, 60, 64, 60, 62, 65]), timesOf(7), beatOf, RULE);
    assert.deepEqual(marks, [false, false, true, true, true, false, false]);
  });

  it("leaves out three notes, a stair, a repeated pitch, a chord and slow notes", () => {
    assert.deepEqual(alternateSteps(context([60, 64, 60, 67]), timesOf(4), beatOf, RULE), [false, false, false, false]);
    assert.deepEqual(alternateSteps(context([60, 62, 64, 65]), timesOf(4), beatOf, RULE), [false, false, false, false]);
    assert.deepEqual(alternateSteps(context([60, 60, 60, 60]), timesOf(4), beatOf, RULE), [false, false, false, false]);
    const times = timesOf(6);
    times[3] = null; // a chord breaks the run
    assert.deepEqual(alternateSteps(context([60, 64, 60, 64, 60, 64]), times, beatOf, RULE), [false, false, false, false, false, false]);
    const lead = [0, 1, 2, 3, 4].map((i) => ({ t: 1000 + i * 500, pitch: i % 2 ? 64 : 60, conf: 0.9 }));
    assert.ok(alternateSteps({ features: { lead, bass: [], bands: [] } }, lead.map((n) => n.t), beatOf, RULE).every((x) => !x));
  });
});

describe("Normal's lanes on an alternation (flag twoKeyTrill)", () => {
  it("trills on two keys while the melody alternates", () => {
    const pitches = [60, 67, 60, 67, 60, 67, 60, 67];
    const notes = timesOf(pitches.length).map((t) => ({ t, lane: 0 }));
    const lanes = searchLanes(notes, context(pitches), { ...DIFFICULTIES.normal, twoKeyTrill: RULE }).map((n) => n.lane);
    assert.equal(lanes.length, pitches.length);
    for (let i = 3; i < lanes.length; i++) assert.ok(lanes[i] === lanes[i - 2] && lanes[i] !== lanes[i - 1], `${lanes}`);
  });

  it("is off unless the flag is on, and Normal's alone", () => {
    for (const level of ["easy", "normal", "hard", "hell"]) assert.equal(DIFFICULTIES[level].twoKeyTrill, undefined, level);
    assert.deepEqual(Object.keys(FLAGS.twoKeyTrill.levels), ["normal"]);
  });
});
