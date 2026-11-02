const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { applyDifficulty, spreadLanes } = require("../../../helpers/mewbeat/charts/difficultyFilter");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { beatPosition } = require("../../../helpers/mewbeat/charts/grid");
const { limitHoldShare, oneHoldAtATime } = require("../../../helpers/mewbeat/charts/holds");
const { copyRepeat } = require("../../../helpers/mewbeat/charts/repeats");
const { balanceHands } = require("../../../helpers/mewbeat/charts/seams");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

const { easy, normal, hard } = DIFFICULTIES;
const LOUD = () => 0.9;
const features = makeFeatures({ durationMs: 32000 });
const timing = buildTiming(features, 32000);
const event = (t, source = "lead", more = {}) => ({ t, lane: 1, level: 0, s: 0.8, source, ...more });
const chart = (events, diff, energy = LOUD) => applyDifficulty(events, diff, timing, energy, [], 0.9, 32000);
const every = (fromMs, toMs, stepMs) => Array.from({ length: Math.ceil((toMs - fromMs) / stepMs) }, (_, i) => fromMs + i * stepMs);
const offHalfGrid = (t) => t % 250 !== 0;

describe("repeats stay on the grid", () => {
  const phrase = { startMs: 10000, endMs: 14000, lagMs: 8125 }; // 16.25 beats at 120 BPM
  const source = [{ t: 2000, lane: 1 }, { t: 2500, lane: 2, len: 500 }];
  const eventTimes = [10000, 10125, 10500, 10625];

  it("a fractional lag moves the notes by whole beats on a beat grid", () => {
    assert.deepEqual(copyRepeat(source, phrase, eventTimes, timing), [{ t: 10000, lane: 1 }, { t: 10500, lane: 2, len: 500 }]);
  });

  it("without a grid they move by the lag itself", () => {
    assert.deepEqual(copyRepeat(source, phrase, eventTimes).map((n) => n.t), [10125, 10625]);
  });
});

describe("the tempo gate", () => {
  const snapped = (options, beats) => {
    const song = makeFeatures({ durationMs: 32000, ...options });
    if (beats) song.tempo.beats = beats;
    return buildTiming(song, song.durationMs).snapped;
  };

  it("trusts a confident tempo", () => assert.equal(snapped({ confidence: 0.5 }), true));
  it("trusts a doubted tempo whose beats are regular", () => assert.equal(snapped({ confidence: 0.4 }), true));
  it("does not trust a doubted tempo with irregular beats", () => {
    let t = 0;
    const beats = every(0, 40, 1).map((i) => (t += i % 2 ? 300 : 800));
    assert.equal(snapped({ confidence: 0.4 }, beats), false);
  });
  it("does not trust a doubted tempo with too few beats", () => assert.equal(snapped({ confidence: 0.4, durationMs: 6000 }), false));
  it("does not trust a tempo the analysis barely believes", () => assert.equal(snapped({ confidence: 0.2 }), false));
});

describe("gaps and fast runs", () => {
  it("a drum pattern keeps half a beat between its notes on Easy", () => {
    const drums = every(2000, 8000, 125).map((t) => event(t, "drums"));
    const times = [...new Set(chart(drums, easy).map((n) => n.t))];
    assert.ok(times.length > 0);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 225, `${times[i - 1]} to ${times[i]}`);
  });

  for (const source of ["lead", "drums"]) {
    it(`Normal runs faster on ${source} only maxFastRun gaps in a row and only maxQuarterShare off the half beat`, () => {
      const line = every(2000, 18000, 125).map((t) => event(t, source, { level: 1 }));
      const times = [...new Set(chart(line, normal).map((n) => n.t))];
      let run = 0;
      for (let i = 1; i < times.length; i++) {
        run = times[i] - times[i - 1] <= 150 ? run + 1 : 0;
        assert.ok(run <= normal.maxFastRun, `run at ${times[i]}`);
      }
      const quarters = times.filter(offHalfGrid).length;
      assert.ok(quarters <= Math.ceil(normal.maxQuarterShare * times.length), `${quarters} of ${times.length}`);
    });
  }
});

describe("chords", () => {
  const pair = (t) => [event(t, "drums", { s: 1 }), event(t, "lead", { lane: 2, s: 1 })];

  const times = (notes) => notes.map((n) => n.t).sort((a, b) => a - b);

  it("Easy keeps a chord only on a strong downbeat", () => {
    assert.deepEqual(times(chart([...pair(4000), ...pair(5000)], easy)), [4000, 4000, 5000]);
  });

  it("Normal keeps a chord on any strong beat, not between beats", () => {
    const lead = [2000, 2500, 3000, 3500].map((t) => event(t));
    assert.deepEqual(times(chart([...lead, ...pair(4000), ...pair(5000), ...pair(6250)], normal)), [2000, 2500, 3000, 3500, 4000, 4000, 5000, 5000, 6250]);
  });

  it("Normal doesn't turn a part where every beat could be a chord into a wall of them", () => {
    const beats = every(2000, 18000, 500);
    const notes = chart(beats.flatMap(pair), normal);
    const moments = new Set(notes.map((n) => n.t)).size;
    const chords = notes.length - moments;
    assert.ok(chords > 0);
    assert.ok(chords <= Math.ceil(normal.maxChordShare * moments), `${chords} of ${moments}`);
    const downbeats = features.tempo.downbeats.filter((t) => t >= 2000 && t < 18000);
    for (const t of downbeats) assert.equal(notes.filter((n) => n.t === t).length, 2, `${t}`);
  });

  it("the same goes for a song charted from its frequency bands", () => {
    const { notes } = generateAll(makeFeatures({ durationMs: 60000, energy: LOUD }), "key").normal;
    const moments = new Set(notes.map((n) => n.t)).size;
    assert.ok(notes.length > moments);
    assert.ok(notes.length - moments <= Math.ceil(normal.maxChordShare * moments), `${notes.length - moments} of ${moments}`);
  });

  it("a drum hit under a tune note is a chord on Normal only", () => {
    const backed = [event(4000, "lead", { s: 1 }), event(4000, "secondary", { lane: 2, level: 1, s: 1, chordOnly: true })];
    assert.equal(chart(backed, normal).length, 2);
    assert.equal(chart(backed, hard).length, 1);
    assert.equal(chart(backed, easy).length, 1);
  });

  it("a chord right next to another note is one note", () => {
    const beats = every(6000, 10000, 500).map((t) => event(t)); // the quarter is one moment of ten, under maxQuarterShare
    const chord = [event(4000, "lead", { s: 1 }), event(4000, "lead", { lane: 2, s: 1 })];
    const notes = chart([...chord, event(4125, "lead", { lane: 0, level: 1 }), ...beats], normal);
    assert.ok(notes.some((n) => n.t === 4125), "the neighbour stays");
    assert.equal(notes.filter((n) => n.t === 4000).length, 1);
  });

  it("a downbeat of a quiet phrase gets no chord on Easy", () => {
    const quiet = easy.chord.minEnergy - 0.1;
    assert.equal(applyDifficulty(pair(4000), easy, timing, LOUD, [], quiet, 32000).length, 1);
  });
});

describe("spreadLanes", () => {
  const repeat = [{ t: 3000, lane: 1 }, { t: 3250, lane: 1 }];

  it("moves a same-lane repeat closer than laneGapBeats to a free lane", () => {
    const out = spreadLanes(repeat, normal, timing);
    assert.deepEqual(out.map((n) => n.t), [3000, 3250]);
    assert.notEqual(out[1].lane, 1);
  });

  it("counts the notes before the phrase", () => {
    const out = spreadLanes([{ t: 3000, lane: 1 }], normal, timing, [{ t: 2750, lane: 1 }]);
    assert.notEqual(out[0].lane, 1);
  });

  it("leaves a repeat a beat apart, and Hard, alone", () => {
    assert.deepEqual(spreadLanes([{ t: 3000, lane: 1 }, { t: 3500, lane: 1 }], normal, timing).map((n) => n.lane), [1, 1]);
    assert.equal(spreadLanes(repeat, hard, timing), repeat);
  });
});

describe("balanceHands", () => {
  const left = (t, lane = 0) => ({ t, lane });
  const before = every(0, 20, 1).map((i) => left(i * 500));

  it("mirrors a phrase when the chart leans to its side", () => {
    assert.deepEqual(balanceHands([left(20000, 1)], before, []), [{ t: 20000, lane: 2 }]);
  });

  it("leaves a phrase that already evens the chart out", () => {
    const right = [{ t: 20000, lane: 3 }];
    assert.equal(balanceHands(right, before, []), right);
  });
});

describe("holds", () => {
  it("oneHoldAtATime turns a hold under another into a tap, with no len key", () => {
    const notes = [{ t: 1000, lane: 0, len: 1000 }, { t: 1500, lane: 2, len: 1000 }, { t: 1800, lane: 3 }, { t: 2500, lane: 1, len: 500 }];
    assert.deepEqual(oneHoldAtATime(notes), [{ t: 1000, lane: 0, len: 1000 }, { t: 1500, lane: 2 }, { t: 1800, lane: 3 }, { t: 2500, lane: 1, len: 500 }]);
  });

  it("limitHoldShare keeps real sustains first", () => {
    const notes = every(0, 10, 1).map((i) => ({ t: i * 1000, lane: i % 4, len: 500 }));
    const out = limitHoldShare(notes, Math.round, (n) => n.t === 9000, 0.3);
    const held = out.filter((n) => n.len > 0);
    assert.equal(held.length, 3);
    assert.ok(held.some((n) => n.t === 9000));
    assert.equal(out.length, notes.length);
  });

  it("no two holds overlap on Easy, and the share stays under each difficulty's cap", () => {
    const song = makeLayeredFeatures({ sustainAtBeats: every(4, 400, 8), durationMs: 192000 });
    const charts = generateAll(song, "key");
    let heldUntil = -Infinity;
    for (const n of charts.easy.notes.filter((h) => h.len > 0)) {
      assert.ok(n.t > heldUntil, `a hold starts at ${n.t} under another`);
      heldUntil = n.t + n.len;
    }
    for (const d of ["easy", "normal"]) {
      const { notes } = charts[d];
      const share = notes.filter((n) => n.len > 0).length / notes.length;
      assert.ok(share > 0 && share <= DIFFICULTIES[d].maxHoldShare + 0.02, `${d}: ${share}`);
    }
  });
});

describe("what Easy follows", () => {
  const song = makeLayeredFeatures({ durationMs: 96000, energy: LOUD });
  const songTiming = buildTiming(song, song.durationMs);

  it("stays on the half-beat grid whatever the song plays", () => {
    const { notes } = generateAll(song, "key").easy;
    assert.ok(notes.length > 0);
    for (const n of notes) {
      const position = beatPosition(songTiming, n.t) * 2;
      assert.ok(Math.abs(position - Math.round(position)) < 0.05, `${n.t}`);
    }
  });

  it("a long sung note off the half-beat grid starts on the nearest beat and ends where it did", () => {
    const [note, ...rest] = chart([event(3125, "lead", { level: 1, sustainMs: 1000 })], easy);
    assert.deepEqual(rest, []);
    assert.equal(note.t, 3000);
    assert.ok(note.len > 0);
    assert.ok(note.t + note.len <= 4125, `${note.t}+${note.len}`);
  });

  it("a short one is not moved: it would be heard a quarter beat from where it is played", () => {
    assert.deepEqual(chart([event(3125, "lead", { level: 1 })], easy), []);
  });

  it("a long note goes before its equals when the density cap chooses", () => {
    const quiet = () => 0.2;
    const events = [event(3000), event(3500, "lead", { lane: 2 }), event(4000, "lead", { lane: 3 }), event(4500, "lead", { lane: 0, sustainMs: 1000 })];
    const notes = chart(events, easy, quiet);
    assert.ok(notes.length < events.length, `${notes.length} kept: the cap must choose`);
    assert.ok(notes.some((n) => n.t === 4500), JSON.stringify(notes));
  });
});
