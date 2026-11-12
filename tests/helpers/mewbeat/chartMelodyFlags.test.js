const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { COPY_MELODY, DIFFICULTIES, HEARD_CHORDS, INTERNAL_LEVELS, MELODY_KEEP, MELODY_SHIFT_PICK, PLUS_MELODY } = require("../../../helpers/mewbeat/charts/difficulty");
const { thinDips } = require("../../../helpers/mewbeat/charts/dips");
const { fadeOutOf, thinFadeOut } = require("../../../helpers/mewbeat/charts/fades");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { thinned } = require("../../../helpers/mewbeat/charts/localThin");
const { snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { flagWithout, makeFeatures, makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
// Each rule taken away: the chart as it was before the rule
const NO_SHIFT = flagWithout("withoutmelodyshiftpick", "melodyShiftPick");
const NO_PLUS_MELODY = flagWithout("withoutplusmelody", "plusMelody");
const NO_HEARD = flagWithout("withoutheardchords", "heardChords");
const NO_COPY = flagWithout("withoutcopymelody", "copyMelody");
const NO_KEEP = flagWithout("withoutmelodykeep", "melodyKeep");
const onlyOn = (param, names) => {
  for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (!names.includes(name)) assert.equal(level[param], undefined, `${name}.${param}`);
};
const notesOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([level, chart]) => [level, chart.notes]));
// The fixture's lead line as the second detector would hand it over, `late` ms after where it sounds.
const withMelody = (features, late = 0) => {
  const line = features.lead.map((n) => ({ t: n.t + late, pitch: n.pitch }));
  return { ...features, decodedMelody: line, decodedMelodyTuned: line };
};

describe("the melody's shift picked against the song's sounds (melodyShiftPick)", () => {
  it("is a rule of Normal (from v45), and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.normal.melodyShiftPick, MELODY_SHIFT_PICK);
    onlyOn("melodyShiftPick", ["normal"]);
  });

  it("leaves a melody that sits on the sounds where it is", () => {
    const features = withMelody(makeLayeredFeatures());
    assert.deepEqual(notesOf(features), notesOf(features, NO_SHIFT));
  });

  it("puts a melody that comes 56 ms late back on the sounds", () => {
    const features = makeLayeredFeatures();
    const placed = notesOf(withMelody(features)), late = withMelody(features, 56);
    assert.notDeepEqual(notesOf(late, NO_SHIFT).normal, placed.normal);
    const picked = notesOf(late);
    for (const level of LEVELS) assert.deepEqual(picked[level], placed[level], level);
  });
});

describe("extras on the melody for the levels built on Normal (plusMelody)", () => {
  const moments = (notes) => new Set(notes.map((n) => n.t));
  // A melody too busy for Normal: a note on every sound of the second half of each bar.
  const busy = (features) => {
    const line = snappedMoments(analyse(features), "hard").filter((m) => m.t % 2000 >= 1000).map((m) => ({ t: m.raw ?? m.t, pitch: 60 }));
    return { ...features, decodedMelody: line, decodedMelodyTuned: line };
  };
  const played = (notes, features) => features.decodedMelody.filter((n) => moments(notes).has(n.t)).length;

  it("is a rule of Hard and Hell (from v45), and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.hard.plusMelody, PLUS_MELODY);
    assert.deepEqual(DIFFICULTIES.hell.plusMelody, PLUS_MELODY);
    onlyOn("plusMelody", ["hard", "hell"]);
  });

  it("changes nothing in a song with no decoded melody", () => {
    const features = makeLayeredFeatures();
    assert.deepEqual(notesOf(features), notesOf(features, NO_PLUS_MELODY));
  });

  it("gives Hard and Hell more of the melody's notes, Easy and Normal stay", () => {
    const features = busy(makeLayeredFeatures());
    const plain = notesOf(features, NO_PLUS_MELODY), flagged = notesOf(features);
    assert.deepEqual(flagged.easy, plain.easy);
    assert.deepEqual(flagged.normal, plain.normal);
    for (const level of ["hard", "hell"]) assert.ok(played(flagged[level], features) > played(plain[level], features), level);
  });

  it("still keeps every moment of the level it is built on", () => {
    const flagged = notesOf(busy(makeLayeredFeatures()));
    for (const [lower, upper] of [["normal", "hard"], ["hard", "hell"]]) {
      const kept = moments(flagged[upper]);
      for (const t of moments(flagged[lower])) assert.ok(kept.has(t), `${upper} lost ${t} of ${lower}`);
    }
  });
});

describe("chords only where several pitches begin (heardChords)", () => {
  // The second detector's notes: `pitches` of them on every sound `keep` lets through.
  const heard = (pitches, keep = () => true) => {
    const features = makeLayeredFeatures();
    const notes = snappedMoments(analyse(features), "hard").filter(keep).flatMap((m) => Array.from({ length: pitches }, (_, i) => ({ t: m.t, len: 100, pitch: 60 + 4 * i, vel: 0.8 })));
    return { ...features, decodedNotes: notes };
  };
  const chords = (notes) => {
    const sizes = new Map();
    for (const n of notes) sizes.set(n.t, (sizes.get(n.t) ?? 0) + 1);
    return [...sizes].filter(([, size]) => size > 1).map(([t]) => t);
  };

  it("is a rule of Normal, Hard and Hell (from v45), and no other level has it", () => {
    for (const name of ["normal", "hard", "hell"]) assert.deepEqual(DIFFICULTIES[name].heardChords, HEARD_CHORDS, name);
    onlyOn("heardChords", ["normal", "hard", "hell"]);
  });

  it("changes nothing in a song the second detector heard no notes of", () => {
    const features = makeLayeredFeatures();
    assert.deepEqual(notesOf(features), notesOf(features, NO_HEARD));
  });

  it("a line of single pitches plays single notes, but for the chord that opens a phrase", () => {
    const features = heard(1);
    const plain = notesOf(features, NO_HEARD), flagged = notesOf(features);
    for (const level of ["normal", "hard"]) {
      assert.ok(chords(plain[level]).length > 20, level);
      assert.ok(chords(flagged[level]).every((t) => t % 8000 === 0), level);
      assert.equal(new Set(flagged[level].map((n) => n.t)).size, new Set(plain[level].map((n) => n.t)).size, level);
    }
    // Hell's own extras put a few chords off the openers (12 of 18 here; plusHeard does not remove them), so Hell is held to
    // what the rule does: far fewer chords than without it, and no moment lost.
    assert.ok(chords(plain.hell).length > 20);
    assert.ok(chords(flagged.hell).length < chords(plain.hell).length / 4, `${chords(flagged.hell).length} < ${chords(plain.hell).length}`);
    assert.ok(new Set(flagged.hell.map((n) => n.t)).size >= new Set(plain.hell.map((n) => n.t)).size);
  });

  it("chords stay where several pitches begin, and where the pitched line does not carry the phrase", () => {
    for (const features of [heard(2), heard(3), heard(1, (m) => m.t % 1000 < 500)]) assert.deepEqual(notesOf(features), notesOf(features, NO_HEARD));
  });
});

describe("a repeat whose copy would miss the melody is charted fresh (copyMelody)", () => {
  const PHRASE = 8000; // the fixture's phrases: the third repeats the first
  const moments = (notes, fromMs = 0, toMs = Infinity) => [...new Set(notes.filter((n) => n.t >= fromMs && n.t < toMs).map((n) => n.t))];
  // loudHoles and paceHoles fill holes on their own, also at the borders of a repeat (15750, 31750, ... in the fixture), so the
  // comparison below leaves them out on both sides to see what copyMelody alone does.
  const NO_HOLES = flagWithout("withoutholes", "loudHoles", "paceHoles");
  const NO_HOLES_COPY = flagWithout("withoutholescopy", "loudHoles", "paceHoles", "copyMelody");
  // A melody on the moments Normal plays, but in the third phrase on the ones it leaves out.
  const moved = (features) => {
    const played = new Set(moments(notesOf(features, NO_HOLES_COPY).normal));
    const there = (t) => t >= 2 * PHRASE && t < 3 * PHRASE;
    const line = snappedMoments(analyse(features), "hard").filter((m) => played.has(m.t) !== there(m.t)).map((m) => ({ t: m.raw ?? m.t, pitch: 60 }));
    return { ...features, decodedMelody: line, decodedMelodyTuned: line };
  };

  it("is a rule of Normal (from v45), and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.normal.copyMelody, COPY_MELODY);
    onlyOn("copyMelody", ["normal"]);
  });

  it("changes nothing in a song with no decoded melody, or with one that repeats with its phrases", () => {
    const features = makeLayeredFeatures();
    assert.deepEqual(notesOf(features), notesOf(features, NO_COPY));
    assert.deepEqual(notesOf(withMelody(features)), notesOf(withMelody(features), NO_COPY));
  });

  it("a repeat with the melody on other moments than its source plays more of it, the other phrases keep their moments", () => {
    const features = moved(makeLayeredFeatures());
    const plain = notesOf(features, NO_HOLES_COPY).normal, flagged = notesOf(features, NO_HOLES).normal;
    const onMelody = (notes) => {
      const at = new Set(moments(notes, 2 * PHRASE, 3 * PHRASE));
      return features.decodedMelody.filter((n) => at.has(n.t)).length;
    };
    assert.ok(onMelody(flagged) > 1.5 * onMelody(plain), `${onMelody(plain)} -> ${onMelody(flagged)}`);
    assert.deepEqual(moments(flagged, 0, 2 * PHRASE), moments(plain, 0, 2 * PHRASE));
    assert.deepEqual(moments(flagged, 3 * PHRASE), moments(plain, 3 * PHRASE));
  });
});

describe("thinning leaves the notes of the melody (melodyKeep)", () => {
  const BEAT = 500;
  const every = (ms, fromMs, toMs) => Array.from({ length: Math.ceil((toMs - fromMs) / ms) }, (_, i) => ({ t: fromMs + i * ms, lane: 0 }));
  const times = (notes) => notes.map((n) => n.t);

  it("is a rule of Normal (from v45), and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.normal.melodyKeep, MELODY_KEEP);
    onlyOn("melodyKeep", ["normal"]);
  });

  it("changes nothing in a song with no decoded melody", () => {
    const features = makeLayeredFeatures();
    assert.deepEqual(notesOf(features), notesOf(features, NO_KEEP));
  });

  it("a slower stretch gives up its other moments first, and the melody's only when it has no other", () => {
    const timing = { beats: Array.from({ length: 200 }, (_, i) => i * BEAT), snapped: true, beatMsAt: () => BEAT, medianMs: BEAT };
    const notes = every(250, 0, 10001), half = new Array(10).fill(0.5);
    // the melody plays off the beat: without the melody those are the moments that go
    const melody = new Set(times(notes).filter((t) => t % BEAT !== 0));
    assert.ok(thinned(notes, half, timing).every((n) => !melody.has(n.t)));
    const after = thinned(notes, half, timing, Infinity, melody);
    assert.ok(after.length < notes.length - 15, `${after.length}`);
    assert.equal(after.filter((n) => melody.has(n.t)).length, melody.size);
    // every moment on the melody: the same ones go as without it
    assert.deepEqual(thinned(notes, half, timing, Infinity, new Set(times(notes))), thinned(notes, half, timing));
  });

  it("a melody note stays through a dip of the music", () => {
    const values = Array.from({ length: 20 }, (_, i) => (i === 8 || i === 9 ? 0.4 : 0.8));
    const ctx = { features: { energy: { hopMs: 500, values } }, timing: { beats: Array.from({ length: 21 }, (_, i) => i * BEAT) }, onsets: Array.from({ length: 40 }, (_, i) => ({ t: i * 250, s: 0.8 })) };
    const notes = [3750, 4000, 4250, 4500, 4750, 5250].map((t) => ({ t, lane: 0 }));
    const rule = DIFFICULTIES.normal.dipThin;
    assert.deepEqual(times(thinDips(notes, ctx, rule)), [3750, 4000, 4500, 5250]);
    assert.deepEqual(times(thinDips(notes, ctx, rule, new Set([4250]))), [3750, 4000, 4250, 4500, 5250]);
  });

  it("the fade-out keeps a melody note before a moment on the beat", () => {
    const duration = 64000;
    const fading = (t) => (t < 50000 ? 0.8 : Math.max(0, (0.8 * (60000 - t)) / 10000));
    const ctx = { timing: buildTiming(makeFeatures({ durationMs: duration }), duration), phrases: [], durationMs: duration, energy: { at: fading }, eventTimes: [], onsets: [] };
    const rule = DIFFICULTIES.normal.fadeOut;
    const notes = every(BEAT / 2, 40000, 59000);
    const { startMs } = fadeOutOf(ctx, rule);
    const offBeat = new Set(times(notes).filter((t) => t >= startMs && t % BEAT !== 0));
    assert.ok(thinFadeOut(notes, ctx, rule).every((n) => !offBeat.has(n.t)));
    const after = thinFadeOut(notes, ctx, rule, offBeat);
    assert.equal(after.length, thinFadeOut(notes, ctx, rule).length);
    assert.ok(after.filter((n) => n.t >= startMs).every((n) => offBeat.has(n.t)));
  });
});
