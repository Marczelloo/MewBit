const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { COPY_FROM, DIFFICULTIES, FADE_OUT, STAIRS: STAIRS_RULE } = require("../../../helpers/mewbeat/charts/difficulty");
const { fadeOutOf, holdFadeOut, thinFadeOut } = require("../../../helpers/mewbeat/charts/fades");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { stairSteps } = require("../../../helpers/mewbeat/charts/laneRules");
const { searchLanes } = require("../../../helpers/mewbeat/charts/laneSearch");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

const BEAT_MS = 500; // the fixtures play at 120 BPM
const DURATION_MS = 64000;
const timing = buildTiming(makeFeatures({ durationMs: DURATION_MS }), DURATION_MS);
const beatOf = () => BEAT_MS;
const STAIRS = STAIRS_RULE;
const FADE = FADE_OUT;

// A lead line with these pitches, one note a half beat from 1000 ms.
const leadOf = (pitches) => pitches.map((pitch, i) => ({ t: 1000 + i * 250, pitch, conf: 0.9 }));
const stairContext = (pitches) => ({ features: { lead: leadOf(pitches), bass: [], bands: [] }, timing, phrases: [], durationMs: DURATION_MS });
const timesOf = (n) => Array.from({ length: n }, (_, i) => 1000 + i * 250);

describe("the moments of a stair (laneRules.js stairSteps)", () => {
  it("marks every step of a run of at least three notes going one way", () => {
    assert.deepEqual(stairSteps(stairContext([60, 62, 64, 65, 63, 61, 59]), timesOf(7), beatOf, STAIRS), [0, 1, 1, 1, -1, -1, -1]);
  });

  it("leaves a single step, a repeated pitch and a chord out", () => {
    assert.deepEqual(stairSteps(stairContext([60, 62, 62, 60]), timesOf(4), beatOf, STAIRS), [0, 0, 0, 0]);
    const times = timesOf(5);
    times[2] = null; // a chord breaks the run in two
    assert.deepEqual(stairSteps(stairContext([60, 62, 64, 66, 68]), times, beatOf, STAIRS), [0, 0, 0, 0, 0]);
  });

  it("needs the notes within a beat of each other", () => {
    const lead = [0, 1, 2, 3].map((i) => ({ t: 1000 + i * 1200, pitch: 60 + 2 * i, conf: 0.9 }));
    const ctx = { features: { lead, bass: [], bands: [] } };
    assert.deepEqual(stairSteps(ctx, lead.map((n) => n.t), beatOf, STAIRS), [0, 0, 0, 0]);
  });
});

describe("Normal's lanes on a stair (diff.stairs)", () => {
  it("climbs a lane a note, starting over at the edge", () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    const notes = timesOf(pitches.length).map((t) => ({ t, lane: 0 }));
    const diff = DIFFICULTIES.normal;
    const lanes = searchLanes(notes, stairContext(pitches), diff).map((n) => n.lane);
    assert.equal(lanes.length, pitches.length);
    for (let i = 1; i < lanes.length; i++) assert.ok(lanes[i] === lanes[i - 1] + 1 || (lanes[i - 1] >= 2 && lanes[i] <= 1), `${lanes}`);
  });

  it("is Normal's alone", () => {
    assert.equal(DIFFICULTIES.normal.stairs, STAIRS);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].stairs, undefined, level);
  });
});

// Loud until 50 s, then fading out to nothing at 60 s.
const fading = (t) => (t < 50000 ? 0.8 : Math.max(0, (0.8 * (60000 - t)) / 10000));
const fadeContext = () => ({ timing, phrases: [], durationMs: DURATION_MS, energy: { at: fading }, eventTimes: [], onsets: [] });
const every = (fromMs, toMs, stepMs) => Array.from({ length: Math.ceil((toMs - fromMs) / stepMs) }, (_, i) => ({ t: fromMs + i * stepMs, lane: 0 }));

describe("the fade-out at the end of a song (fades.js, diff.fadeOut)", () => {
  it("runs from where the energy falls under `from` (else the last loud moment) to the last sound", () => {
    const fade = fadeOutOf(fadeContext(), FADE);
    assert.ok(Math.abs(fade.startMs - 53750) <= 50, `${fade.startMs}`);
    assert.ok(Math.abs(fade.endMs - 59375) <= 50, `${fade.endMs}`);
    assert.ok(Math.abs(fadeOutOf(fadeContext(), { ...FADE, from: undefined }).startMs - 52500) <= 50);
    assert.equal(fadeOutOf({ ...fadeContext(), energy: { at: () => 0.8 } }, FADE), null);
  });

  it("keeps half the moments of every bar of the fade-out, the ones on the beat, and nothing else changes", () => {
    const fade = fadeOutOf(fadeContext(), FADE);
    // a dense bar (half beats) and then sparse ones (a beat and a half apart)
    const notes = [...every(40000, 54000, BEAT_MS / 2), ...every(54000, 56000, BEAT_MS / 2), ...every(56000, 59000, 1.5 * BEAT_MS)];
    const out = thinFadeOut(notes, fadeContext(), FADE);
    const count = (list, a, b) => list.filter((n) => n.t >= a && n.t < b).length;
    const first = notes.find((n) => n.t >= fade.startMs).t;
    for (let a = first; a < fade.endMs; a += 4 * BEAT_MS) assert.equal(count(out, a, a + 4 * BEAT_MS), Math.ceil(count(notes, a, a + 4 * BEAT_MS) / 2), `${a}`);
    for (const n of out.filter((x) => x.t >= fade.startMs && x.t < 56000)) assert.equal(n.t % BEAT_MS, 0, `${n.t}`);
    assert.deepEqual(out.filter((n) => n.t < fade.startMs), notes.filter((n) => n.t < fade.startMs));
  });

  it("holds a lone tap with a beat of room until half a beat before the next one, the last for two beats", () => {
    const notes = every(54000, 59000, 2 * BEAT_MS);
    const held = holdFadeOut(notes, fadeContext(), FADE);
    assert.deepEqual(held.slice(0, -1).map((n) => n.len), held.slice(0, -1).map(() => 2 * BEAT_MS - BEAT_MS / 2));
    assert.equal(held.at(-1).len, 2 * BEAT_MS);
    // a beat apart there is no room, but for the last one (until the sound ends)
    const tight = holdFadeOut(every(54000, 59000, BEAT_MS), fadeContext(), FADE).filter((n) => n.len > 0);
    assert.deepEqual(tight.map((n) => n.t), [58500]);
    assert.ok(Math.abs(tight[0].t + tight[0].len - fadeOutOf(fadeContext(), FADE).endMs) <= 1);
  });

  it("is Normal's alone", () => {
    assert.equal(DIFFICULTIES.normal.fadeOut, FADE_OUT);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].fadeOut, undefined, level);
  });
});

describe("a repeat copied only when it is very like its source (Normal and Hard)", () => {
  it("is part of Hard since v37 and of Normal since v38", () => {
    assert.equal(COPY_FROM, 0.95);
    for (const level of ["normal", "hard"]) assert.equal(DIFFICULTIES[level].copyFrom, COPY_FROM, level);
    for (const level of ["easy", "hell"]) assert.equal(DIFFICULTIES[level].copyFrom, undefined, level);
    for (const name of ["copyStrict", "copyStrictHard", "fadeOut", "stairs"]) assert.equal(FLAGS[name], undefined, name);
  });
});

describe("a song never loud (fades.js)", () => {
  it("has no fade-out, however quiet its end", () => {
    const quiet = { timing, phrases: [], durationMs: DURATION_MS, energy: { at: (t) => (t < 60000 ? 0.15 : 0) }, eventTimes: [], onsets: [] };
    assert.equal(fadeOutOf(quiet, FADE), null);
    const notes = every(2000, 59000, BEAT_MS);
    assert.deepEqual(thinFadeOut(notes, quiet, FADE), notes);
  });
});
