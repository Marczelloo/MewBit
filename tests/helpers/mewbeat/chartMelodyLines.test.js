const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, MELODY_LINES, MELODY_LINES_FIRST, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { heldLineMoments } = require("../../../helpers/mewbeat/charts/melodyLines");
const { selectMoments, snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { makeLayeredFeatures } = require("./fixtures");

const BEAT = 500;
const timing = {
  snapped: true,
  beats: Array.from({ length: 60 }, (_, i) => i * BEAT),
  downbeats: Array.from({ length: 15 }, (_, i) => i * 4 * BEAT),
  beatMsAt: () => BEAT,
};
const phrase = { index: 0, startMs: 0, endMs: 16 * BEAT, pulse: 0 };
const metricOf = (t) => (t % BEAT === 0 ? 0 : t % (BEAT / 2) === 0 ? 1 : t % (BEAT / 4) === 0 ? 2 : 3);
// A moment of the song as snappedMoments hands it over: strength `s`, a score of its own, its place in the bar from its time.
const moment = (t, s, extra = {}) => ({ t, s, score: s, metric: metricOf(t), down: t % (4 * BEAT) === 0 ? 1 : 0, source: "lead", ...extra });
const notesAt = (...starts) => starts.map((t) => ({ t, pitch: 60 }));
const sorted = (set) => [...set].sort((a, b) => a - b);

describe("the melody held as lines (flags melodyLines and melodyLinesFirst)", () => {
  it("are flags of Normal, and no level has the lines without a flag", () => {
    assert.deepEqual(FLAGS.melodyLines.levels, { normal: { melodyLines: MELODY_LINES } });
    assert.deepEqual(FLAGS.melodyLinesFirst.levels, { normal: { melodyLines: MELODY_LINES_FIRST } });
    assert.equal(MELODY_LINES.first, undefined);
    assert.equal(MELODY_LINES_FIRST.first, true);
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.melodyLines, undefined);
  });
});

describe("heldLineMoments", () => {
  // A level with a flat gap of 200 ms.
  const diff = { minNoteGapMs: 200, gapBeats: 0, melodyLines: MELODY_LINES };
  const held = (scored, melody, rule = diff) => sorted(heldLineMoments(scored, melody, timing, rule));
  // The moments of a melody: one 20 ms after each note (the sound is heard where `raw` says), as strong as `s`.
  const onNotes = (starts, s = 0.9) => starts.map((t) => moment(t, s, { raw: t + 20 }));

  it("holds nothing without a rule, a melody or moments", () => {
    const scored = onNotes([0, 400, 800, 1200]);
    assert.equal(held(scored, notesAt(0, 400, 800, 1200), { ...diff, melodyLines: undefined }).length, 0);
    assert.equal(held(scored, [], diff).length, 0);
    assert.equal(held(scored, null, diff).length, 0);
    assert.equal(held([], notesAt(0, 400, 800, 1200), diff).length, 0);
  });

  it("chains notes within the larger of a beat and 450 ms into lines of at least four notes", () => {
    const starts = [0, 400, 800, 1200];
    assert.deepEqual(held(onNotes(starts), notesAt(...starts)), starts);
    // three notes are no line
    assert.deepEqual(held(onNotes([0, 400, 800]), notesAt(0, 400, 800)), []);
    // a gap of a beat joins, a longer one cuts the six notes into two lines of three
    const joined = [0, 500, 1000, 1500, 2000, 2500], cut = [0, 500, 1000, 1600, 2100, 2600];
    assert.deepEqual(held(onNotes(joined), notesAt(...joined)), joined);
    assert.deepEqual(held(onNotes(cut), notesAt(...cut)), []);
    // two lines of four, a long gap apart: both are held
    const two = [0, 400, 800, 1200, 5000, 5400, 5800, 6200];
    assert.deepEqual(held(onNotes(two), notesAt(...two)), two);
  });

  it("joins by the beat of the song where it is longer than 450 ms", () => {
    const slow = { ...timing, beatMsAt: () => 1000 };
    const starts = [0, 900, 1800, 2700];
    assert.deepEqual(sorted(heldLineMoments(onNotes(starts), notesAt(...starts), slow, diff)), starts);
    assert.deepEqual(held(onNotes(starts), notesAt(...starts)), []);
  });

  it("holds a line when 60% of its notes have a sound, and not under that", () => {
    const starts = [0, 400, 800, 1200, 1600];
    const sounds = (keep) => onNotes(keep);
    assert.deepEqual(held(sounds([0, 400]), notesAt(...starts)), []);
    assert.deepEqual(held(sounds([0, 800, 1600]), notesAt(...starts)), [0, 800, 1600]);
    // a sound further than 50 ms from a note is not its sound
    const off = starts.map((t) => moment(t, 0.9, { raw: t + 80 }));
    assert.deepEqual(held(off, notesAt(...starts)), []);
  });

  it("does not hold a line that is quiet against the song", () => {
    const starts = [0, 400, 800, 1200];
    const background = Array.from({ length: 20 }, (_, i) => moment(10000 + i * 300, 0.5));
    // louder than the song: held; the same line quieter than 20 other moments (mean rank 0.2 under 0.3): not
    assert.deepEqual(held([...onNotes(starts, 0.9), ...background], notesAt(...starts)), starts);
    assert.deepEqual(held([...onNotes(starts, 0.1), ...background], notesAt(...starts)), []);
  });

  it("drops the one moment a clearly louder neighbour stands beside, not its neighbours on the line", () => {
    const starts = [0, 400, 800, 1200, 1600];
    const gapDiff = { ...diff, minNoteGapMs: 150 };
    const loud = moment(440, 0.95, { raw: 440 }); // 40 ms after the second note's moment (heard at 420): inside the gap of that moment only
    const scored = [...onNotes(starts, 0.5), loud].sort((a, b) => a.t - b.t);
    assert.deepEqual(held(scored, notesAt(...starts), gapDiff), [0, 800, 1200, 1600]);
    // a neighbour that is not louder by 0.3 of a rank leaves it
    const close = moment(440, 0.5, { raw: 440 });
    assert.deepEqual(held([...onNotes(starts, 0.5), close].sort((a, b) => a.t - b.t), notesAt(...starts), gapDiff), starts);
  });

  it("does not count a louder moment of the line itself against its neighbour, the thinning picks", () => {
    const starts = [0, 100, 200, 300, 400];
    const scored = starts.map((t, i) => moment(t, i % 2 ? 0.95 : 0.5));
    assert.deepEqual(held(scored, notesAt(...starts)), [0, 200, 400]);
  });

  it("thins a run faster than the gap to an even staircase, the most notes first", () => {
    const starts = Array.from({ length: 17 }, (_, i) => i * 125);
    const stairs = { ...diff, minNoteGapMs: 250 };
    const scored = starts.map((t) => moment(t, 0.9));
    const kept = held(scored, notesAt(...starts), stairs);
    assert.deepEqual(kept, Array.from({ length: 9 }, (_, i) => i * 250));
  });

  it("prefers beats and half beats over quarter beats at the same count, then the better score", () => {
    const stairs = { ...diff, minNoteGapMs: 250 };
    const starts = [125, 250, 375, 500];
    assert.deepEqual(held(starts.map((t) => moment(t, 0.9)), notesAt(...starts), stairs), [250, 500]);
    // the same count and the same place in the bar: the higher score
    const flat = [130, 190, 590, 650];
    const scored = flat.map((t, i) => moment(t, 0.9, { score: [1, 2, 3, 0][i], metric: 3 }));
    assert.deepEqual(held(scored, notesAt(...flat), stairs), [190, 590]);
  });

  it("thins a line across what would be a phrase's bound, it knows no phrases", () => {
    const stairs = { ...diff, minNoteGapMs: 250 };
    const starts = Array.from({ length: 17 }, (_, i) => 7000 + i * 125); // 7000..9000, the bound at 8000
    const kept = held(starts.map((t) => moment(t, 0.9)), notesAt(...starts), stairs);
    assert.equal(kept.length, 9);
    kept.slice(1).forEach((t, i) => assert.equal(t - kept[i], 250));
    assert.ok(kept.some((t) => t < 8000) && kept.some((t) => t >= 8000));
  });
});

describe("selectMoments with held lines", () => {
  const level = { ...levelOf("normal"), foreground: 0, minNoteGapMs: 100, gapBeats: 1 / 4 };
  const onTop = { ...level, melodyLines: MELODY_LINES }, first = { ...level, melodyLines: MELODY_LINES_FIRST };
  const pick = (scored, budget, edges = {}, rule = level) => selectMoments(phrase, scored, budget, rule, timing, edges);
  const times = (chosen) => chosen.map((n) => n.t);
  // Three quiet moments of a line, under the foreground, and four strong sounds; the first of the line is 100 ms from a strong one.
  const quiet = [1000, 1500, 2500].map((t) => moment(t, 0.2, { score: -1 }));
  const strong = [1100, 3000, 3500, 4000].map((t) => moment(t, 0.9, { score: 3 }));
  const scored = [...quiet, ...strong].sort((a, b) => a.t - b.t);
  const lines = new Set([1000, 1500, 2500]);

  it("plays the held moments on top of what the phrase chose, where they fit: no note gives its place (flag melodyLines)", () => {
    const plain = pick(scored, 3);
    assert.ok(times(plain).includes(1100) && !times(plain).some((t) => lines.has(t)));
    const chosen = pick(scored, 3, { lines, lineRoom: 2 }, onTop);
    assert.deepEqual(chosen.filter((n) => n.reason !== "linia"), plain);
    // the moment 100 ms from a chosen note is inside the gap of 112.5 ms and stays out
    assert.deepEqual(chosen.filter((n) => n.reason === "linia").map((n) => n.t), [1500, 2500]);
  });

  it("plays at most the lines' room on top (flag melodyLines)", () => {
    const many = Array.from({ length: 12 }, (_, i) => moment(500 + i * 500, 0.2, { score: -1 }));
    const all = new Set(many.map((m) => m.t));
    const plain = pick(many, 3).length;
    assert.equal(pick(many, 3, { lines: all, lineRoom: 2 }, onTop).length, plain + 2);
    assert.equal(pick(many, 3, { lines: all, lineRoom: 0 }, onTop).length, plain);
    assert.equal(pick(many, 3, { lines: all }, onTop).length, plain);
  });

  it("takes the held moments before the foreground, also under its threshold (flag melodyLinesFirst)", () => {
    const chosen = pick(scored, 3, { lines, lineRoom: 0 }, first);
    assert.deepEqual(times(chosen), [1000, 1500, 2500]);
    assert.ok(chosen.every((n) => n.reason === "linia"));
  });

  it("takes at most the budget and the lines' room (flag melodyLinesFirst)", () => {
    const many = Array.from({ length: 12 }, (_, i) => moment(500 + i * 500, 0.2, { score: -1 }));
    const all = new Set(many.map((m) => m.t));
    assert.equal(pick(many, 3, { lines: all, lineRoom: 1 }, first).length, 4);
    assert.equal(pick(many, 3, { lines: all, lineRoom: 0 }, first).length, 3);
    assert.equal(pick(many, 3, { lines: all }, first).length, 3);
  });

  it("is never swapped out by the long stretches (flag melodyLinesFirst)", () => {
    const held = [1500, 5500].map((t) => moment(t, 0.2, { score: -1 }));
    const around = [...held, moment(3500, 0.9, { score: 5 })].sort((a, b) => a.t - b.t);
    assert.deepEqual(times(pick(around, 2, { lines: new Set([1500, 5500]) }, first)), [1500, 5500]);
  });

  it("changes nothing without held lines", () => {
    const mixed = Array.from({ length: 24 }, (_, i) => moment(i * 250, 0.3 + ((i * 7) % 10) / 20, { score: ((i * 7) % 10) / 3 - 1 }));
    const plain = pick(mixed, 6);
    for (const rule of [onTop, first]) {
      assert.deepEqual(pick(mixed, 6, { lines: null, lineRoom: 3 }, rule), plain);
      assert.deepEqual(pick(mixed, 6, { lines: new Set(), lineRoom: 3 }, rule), plain);
    }
  });
});

describe("the flags on a whole song", () => {
  const notesOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([name, chart]) => [name, chart.notes]));
  const withLine = (features, line) => ({ ...features, decodedMelody: line, decodedMelodyTuned: line });
  // A melody too busy for Normal: a note on every sound of the second half of each bar.
  const busy = (features) => withLine(features, snappedMoments(analyse(features), "hard").filter((m) => m.t % 2000 >= 1000).map((m) => ({ t: m.raw ?? m.t, pitch: 60 })));
  const played = (notes, features) => {
    const moments = new Set(notes.map((n) => n.t));
    return features.decodedMelody.filter((n) => moments.has(n.t)).length;
  };

  it("change nothing in a song with no decoded melody", () => {
    const features = makeLayeredFeatures();
    const plain = notesOf(features);
    for (const flag of ["melodyLines", "melodyLinesFirst"]) assert.deepEqual(notesOf(features, [flag]), plain, flag);
  });

  it("change nothing where Normal already plays the melody whole", () => {
    const features = makeLayeredFeatures();
    const mine = withLine(features, features.lead.map((n) => ({ t: n.t, pitch: n.pitch })));
    const plain = notesOf(mine);
    for (const flag of ["melodyLines", "melodyLinesFirst"]) assert.deepEqual(notesOf(mine, [flag]), plain, flag);
  });

  it("play more of a melody Normal leaves out, within the lines' room", () => {
    const features = busy(makeLayeredFeatures());
    const plain = notesOf(features);
    const moments = (notes) => new Set(notes.map((n) => n.t)).size;
    for (const [flag, rule] of [["melodyLines", MELODY_LINES], ["melodyLinesFirst", MELODY_LINES_FIRST]]) {
      const flagged = notesOf(features, [flag]);
      assert.ok(played(flagged.normal, features) > played(plain.normal, features), `${flag}: ${played(plain.normal, features)} -> ${played(flagged.normal, features)}`);
      assert.ok(moments(flagged.normal) <= (1.1 + rule.room) * moments(plain.normal), `${flag}: ${moments(plain.normal)} -> ${moments(flagged.normal)}`);
    }
  });

});
