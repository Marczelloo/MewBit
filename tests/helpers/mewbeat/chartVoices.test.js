const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, LEAD_VOICE_BOTH, LINE_REPEATS } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { underLine, withLineRepeats } = require("../../../helpers/mewbeat/charts/voices");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
const times = (notes) => notes.map((n) => n.t);

describe("the notes that repeat the melody's tone (flag lineRepeats)", () => {
  // A line of two notes far apart, 60 and 62.
  const line = [{ t: 0, pitch: 60, conf: 0.8, len: 100 }, { t: 2000, pitch: 62, conf: 0.7, len: 100 }];
  const heard = (t, pitch = 60, vel = 0.8) => ({ t, pitch, vel, len: 100 });

  it("is a flag of Normal, and no level has it without a flag", () => {
    assert.deepEqual(FLAGS.lineRepeats.levels, { normal: { lineRepeats: LINE_REPEATS } });
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.lineRepeats, undefined);
  });

  it("takes a note at the pitch of the line note before it, marked as a repeat", () => {
    const out = withLineRepeats(line, [heard(300)], LINE_REPEATS);
    assert.deepEqual(out, [line[0], { t: 300, pitch: 60, conf: 0.8, len: 100, repeat: true }, line[1]]);
  });

  it("takes a note at the pitch of the line note after it", () => {
    const out = withLineRepeats(line, [heard(1700, 62)], LINE_REPEATS);
    assert.deepEqual(times(out), [0, 1700, 2000]);
    assert.deepEqual(out[1], { t: 1700, pitch: 62, conf: 0.7, len: 100, repeat: true });
  });

  it("leaves the line's own notes unmarked and does not change the line it was given", () => {
    const own = line.map((n) => ({ ...n }));
    const out = withLineRepeats(own, [heard(300)], LINE_REPEATS);
    assert.deepEqual(own, line);
    assert.deepEqual(out.filter((n) => !n.repeat), line);
  });

  it("takes up a chain of repeats between two far-apart line notes over several rounds", () => {
    const far = [{ t: 0, pitch: 60, conf: 0.8 }, { t: 2400, pitch: 60, conf: 0.8 }];
    const chain = [300, 600, 900, 1200, 1500, 1800, 2100].map((t) => heard(t));
    const out = withLineRepeats(far, chain, LINE_REPEATS);
    assert.deepEqual(times(out), [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400]);
    assert.deepEqual(out.filter((n) => n.repeat).length, 7);
  });

  it("leaves out a note of another pitch, a quiet one, a far one and one on a line note", () => {
    const notes = [heard(300, 61), heard(300, 60, 0.2), heard(500), heard(40), heard(-30), heard(1990, 60)];
    assert.deepEqual(withLineRepeats(line, notes, LINE_REPEATS), line);
    // the rule's own edges: exactly minVel and exactly reachMs are taken
    assert.deepEqual(times(withLineRepeats(line, [heard(300, 60, LINE_REPEATS.minVel)], LINE_REPEATS)), [0, 300, 2000]);
    assert.deepEqual(times(withLineRepeats(line, [heard(LINE_REPEATS.reachMs)], LINE_REPEATS)), [0, 400, 2000]);
    assert.deepEqual(times(withLineRepeats(line, [heard(LINE_REPEATS.reachMs + 1)], LINE_REPEATS)), [0, 2000]);
  });

  it("takes one line note for two notes of the same pitch within 50 ms", () => {
    const out = withLineRepeats(line, [heard(300), heard(330)], LINE_REPEATS);
    assert.deepEqual(times(out), [0, 300, 2000]);
  });

  it("returns the line time-ordered, whatever the order of the notes and of the line", () => {
    const out = withLineRepeats([line[1], line[0]], [heard(1700, 62), heard(300)], LINE_REPEATS);
    assert.deepEqual(times(out), [0, 300, 1700, 2000]);
  });

  it("returns the line itself without a rule, without notes or for an empty line", () => {
    assert.equal(withLineRepeats(line, [heard(300)], null), line);
    assert.equal(withLineRepeats(line, [], LINE_REPEATS), line);
    assert.equal(withLineRepeats(line, undefined, LINE_REPEATS), line);
    const none = [];
    assert.equal(withLineRepeats(none, [heard(300)], LINE_REPEATS), none);
  });
});

describe("what plays under the melody (flag leadVoiceBoth)", () => {
  const rule = LEAD_VOICE_BOTH;
  const phrase = { startMs: 0, endMs: 8250 };
  // 16 moments, one every 500 ms from 500 to 8000, each stronger than the one before: the last eight are the loud ones.
  const moments = Array.from({ length: 16 }, (_, k) => ({ t: 500 * (k + 1), s: 0.5 + 0.03 * k, score: 3, metric: 0 }));
  // The line: a long note from 1000 that rings until 3000, then a note every 500 ms from 4250 to 8250, one of them on a loud moment.
  const line = [{ t: 1000, pitch: 72, len: 2000 }, ...Array.from({ length: 9 }, (_, i) => ({ t: 4250 + 500 * i, pitch: 72, len: 100 })), { t: 5020, pitch: 72, len: 100 }];
  // The line with a note 70-100 ms from four of the moments below: the place a low sound there would take from it.
  const next = [...line, { t: 6100, pitch: 72, len: 100 }, { t: 6570, pitch: 72, len: 100 }, { t: 6930, pitch: 72, len: 100 }, { t: 7430, pitch: 72, len: 100 }];
  // Every moment has a note at the line's pitch, except where the cases below set others.
  const pitches = new Map(moments.map((m) => [m.t, [72]]));
  const set = (t, ...of) => pitches.set(t, of);
  set(1500, 60); // the long note rings, but no note of the line begins near it
  set(3500, 60); // the line is silent
  set(5000, 60); // a line note begins 20 ms after it
  set(6000, 60); // twelve semitones under, a line note begins 100 ms after it
  set(6500, 65); // exactly rule.below under, a line note begins 70 ms after it
  set(7000, 66); // one short of rule.below, a line note begins 70 ms before it
  set(7500, 60, 70); // the highest pitch is two under, a line note begins 70 ms before it
  set(8000); // no pitch
  const notesOf = (map) => [...map].flatMap(([t, list]) => list.map((pitch) => ({ t, pitch, len: 100, vel: 0.8 })));
  const notes = notesOf(pitches);
  const at = (result, t) => result.find((m) => m.t === t);

  it("is a flag of Normal, and no level has it without a flag", () => {
    assert.deepEqual(LEAD_VOICE_BOTH, { nearMs: 60, pitched: 0.8, minLoud: 0.5, minMoments: 6, song: 0.75, below: 7, clashMs: 120, penalty: 2.5 });
    assert.deepEqual(FLAGS.leadVoiceBoth.levels, { normal: { leadVoice: LEAD_VOICE_BOTH } });
    assert.equal(FLAGS.leadVoice, undefined);
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.leadVoice, undefined);
  });

  it("takes the penalty from a low moment a line note begins next to, and marks it", () => {
    const out = underLine(moments, next, notes, [phrase], rule);
    assert.equal(out.length, moments.length);
    for (const t of [6000, 6500]) assert.deepEqual(at(out, t), { ...at(moments, t), score: 3 - rule.penalty, under: true }, String(t));
    // the moments themselves are not changed
    assert.ok(moments.every((m) => m.score === 3 && m.under === undefined));
  });

  it("leaves every other moment as it is", () => {
    const out = underLine(moments, next, notes, [phrase], rule);
    for (const m of moments.filter((m) => ![6000, 6500].includes(m.t))) assert.equal(at(out, m.t), m, String(m.t));
  });

  it("leaves alone a moment on a line note, one with no pitch, one less than rule.below under, one whose top pitch is near the line and a low one where the line is silent", () => {
    const out = underLine(moments, next, notes, [phrase], rule);
    for (const t of [5000, 8000, 7000, 7500, 3500]) assert.equal(at(out, t), at(moments, t), String(t));
  });

  it("leaves a low moment under a note of the line that rings, where no note of it begins next to it", () => {
    // 1500 is 500 ms after the long note began and still under it; the line has no note within the window
    assert.equal(at(underLine(moments, next, notes, [phrase], rule), 1500), at(moments, 1500));
    assert.equal(at(underLine(moments, [{ ...next[0], t: 1400, len: 2000 }, ...next.slice(1)], notes, [phrase], rule), 1500).under, true);
  });

  it("reads the window on either side of the moment, to rule.clashMs", () => {
    const beforeEdge = [...line, { t: 6000 - rule.clashMs, pitch: 72, len: 100 }];
    const afterEdge = [...line, { t: 6000 + rule.clashMs, pitch: 72, len: 100 }];
    assert.equal(at(underLine(moments, beforeEdge, notes, [phrase], rule), 6000).under, true);
    assert.equal(at(underLine(moments, afterEdge, notes, [phrase], rule), 6000).under, true);
    const beforeOut = [...line, { t: 6000 - rule.clashMs - 1, pitch: 72, len: 100 }];
    const afterOut = [...line, { t: 6000 + rule.clashMs + 1, pitch: 72, len: 100 }];
    assert.equal(at(underLine(moments, beforeOut, notes, [phrase], rule), 6000), at(moments, 6000));
    assert.equal(at(underLine(moments, afterOut, notes, [phrase], rule), 6000), at(moments, 6000));
  });

  it("reads a low moment before the line's first note against that note", () => {
    const low = notesOf(new Map([...pitches, [500, [60]]]));
    const out = underLine(moments, [{ t: 600, pitch: 72, len: 100 }, ...next], low, [phrase], rule);
    assert.deepEqual(at(out, 500), { ...at(moments, 500), score: 3 - rule.penalty, under: true });
  });

  it("takes nothing in a song no pitched line carries: too few of the loud moments have a pitch", () => {
    const half = notesOf(new Map([...pitches].map(([t, list]) => [t, (t / 500) % 2 === 0 ? list : []])));
    assert.equal(underLine(moments, next, half, [phrase], rule), moments);
  });

  it("takes nothing when fewer than rule.song of the phrases are led", () => {
    // a second phrase of six quiet moments, no loud one in it
    const quiet = Array.from({ length: 6 }, (_, k) => ({ t: 9000 + 500 * k, s: 0.01 * k, score: 3, metric: 0 }));
    const all = [...quiet, ...moments].sort((a, b) => a.t - b.t);
    const both = [{ startMs: 0, endMs: 8250 }, { startMs: 8250, endMs: 12500 }];
    assert.equal(underLine(all, next, notes, both, rule), all);
    assert.ok(underLine(all, next, notes, [both[0]], rule).some((m) => m.under));
  });

  it("reads the whole song as one phrase where there are none", () => {
    assert.ok(underLine(moments, next, notes, [], rule).some((m) => m.under));
    assert.ok(underLine(moments, next, notes, undefined, rule).some((m) => m.under));
  });

  it("returns scored itself without a rule, without notes or without a line", () => {
    assert.equal(underLine(moments, next, notes, [phrase], null), moments);
    assert.equal(underLine(moments, next, [], [phrase], rule), moments);
    assert.equal(underLine(moments, next, undefined, [phrase], rule), moments);
    assert.equal(underLine(moments, [], notes, [phrase], rule), moments);
    assert.equal(underLine(moments, null, notes, [phrase], rule), moments);
  });

  it("reads a moment where it was heard, not where it was moved to", () => {
    // moved onto the line note at 6100: read there, it would sit on a line note and be left alone
    const moved = moments.map((m) => (m.t === 6000 ? { ...m, t: 6100, raw: 6000 } : m)).sort((a, b) => a.t - b.t);
    assert.equal(at(underLine(moved, next, notes, [phrase], rule), 6100).under, true);
  });

  describe("through a whole song", () => {
    const notesOfLevels = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "voice-test", flags)).map(([level, chart]) => [level, chart.notes]));
    // The fixture's lead on every beat is the line; the second detector heard it (unless `onBeats` is false), and a note on every sound
    // between its beats: far under the line on the half beats a quarter into each second, near it on the others.
    const carried = (onBeats = true) => {
      const features = makeLayeredFeatures();
      const line = features.lead.map((n) => ({ t: n.t, pitch: 72, conf: 0.9, len: 200 }));
      const heard = snappedMoments(analyse(features, []), "normal").map((m) => m.raw ?? m.t);
      const struck = new Set(line.map((n) => n.t));
      const under = heard.filter((t) => !struck.has(t)).map((t) => ({ t, pitch: t % 1000 === 250 ? 45 : 70, vel: 0.8, len: 100 }));
      const decodedNotes = [...(onBeats ? line.map((n) => ({ t: n.t, pitch: 72, vel: 0.9, len: 200 })) : []), ...under];
      return { ...features, decodedMelody: line, decodedMelodyTuned: line, decodedNotes };
    };
    // carried(), with a note of the line 100 ms before every sound far under it: each of those would take that note's place
    const clashing = (onBeats = true) => {
      const features = carried(onBeats);
      const early = features.decodedNotes.filter((n) => n.pitch === 45).map((n) => ({ t: n.t - 100, pitch: 72, conf: 0.9, len: 80 }));
      const line = [...features.decodedMelody, ...early].sort((a, b) => a.t - b.t);
      return { ...features, decodedMelody: line, decodedMelodyTuned: line };
    };

    it("charts the same song on every level as without the flag where the gate does not hold", () => {
      // the line is drawn, but only the sounds between its beats have a decoded pitch: most loud moments have none
      const features = clashing(false);
      const plain = notesOfLevels(features, []);
      const voiced = notesOfLevels(features, ["leadVoiceBoth"]);
      for (const level of LEVELS) assert.deepEqual(voiced[level], plain[level], level);
    });

    it("charts the same song on every level as without the flag when no notes were decoded", () => {
      const features = { ...clashing(), decodedNotes: undefined };
      const plain = notesOfLevels(features, []);
      const voiced = notesOfLevels(features, ["leadVoiceBoth"]);
      for (const level of LEVELS) assert.deepEqual(voiced[level], plain[level], level);
    });

    it("leaves Normal as without a flag where no line note begins next to the low sounds", () => {
      const features = carried();
      assert.deepEqual(notesOfLevels(features, ["leadVoiceBoth"]).normal, notesOfLevels(features, []).normal);
    });

    it("takes the low sounds next to a line note from Normal, and Hard and Hell hold every moment of Normal", () => {
      const features = clashing();
      const plain = notesOfLevels(features, []);
      const both = notesOfLevels(features, ["leadVoiceBoth"]);
      assert.notDeepEqual(both.normal, plain.normal);
      for (const level of ["hard", "hell"]) {
        const held = new Set(times(both[level]));
        assert.deepEqual(times(both.normal).filter((t) => !held.has(t)), [], level);
      }
    });

    it("charts a whole song with lineRepeats and leadVoiceBoth on, every level", () => {
      const flagged = generateAll(clashing(), "voice-test", ["lineRepeats", "leadVoiceBoth"]);
      for (const level of LEVELS) assert.ok(flagged[level].notes.length > 0, level);
    });
  });
});
