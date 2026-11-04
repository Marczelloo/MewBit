const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { planChords } = require("../../../helpers/mewbeat/charts/chords");
const { DIFFICULTIES, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { assignLanes } = require("../../../helpers/mewbeat/charts/lanes");
const { findHeardRepeats } = require("../../../helpers/mewbeat/charts/repeatFinder");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

const { easy, hard } = DIFFICULTIES;
const normal = levelOf("normalV26"); // a level cut from another, as Normal was in v26 (the public Normal picks its notes from the music)
const BEAT_MS = 500; // the fixtures play at 120 BPM
const features = makeFeatures({ durationMs: 64000 });
const timing = buildTiming(features, 64000);
const every = (fromMs, toMs, stepMs) => Array.from({ length: Math.ceil((toMs - fromMs) / stepMs) }, (_, i) => fromMs + i * stepMs);

const context = (more = {}) => ({
  timing,
  phrases: [],
  sections: [],
  durationMs: 64000,
  energy: { at: () => 0.6 },
  eventTimes: [],
  onsets: [],
  ...more,
});
const beats = (fromMs = 2000, toMs = 50000) => every(fromMs, toMs, BEAT_MS).map((t) => ({ t, lane: 0 }));
const sizes = (notes) => {
  const at = new Map();
  for (const n of notes) at.set(n.t, (at.get(n.t) ?? 0) + 1);
  return at;
};

describe("assignLanes", () => {
  const halves = every(2000, 50000, 250).map((t) => ({ t, lane: 0 }));

  it("gives the same song the same lanes", () => {
    assert.deepEqual(assignLanes(halves, context(), hard), assignLanes(halves, context(), hard));
  });

  it("keeps every moment of a plain run, and what the note carries", () => {
    const tagged = halves.map((n, i) => ({ ...n, tid: i }));
    const out = assignLanes(tagged, context(), hard);
    assert.deepEqual(out.map((n) => n.t), tagged.map((n) => n.t));
    assert.deepEqual(out.map((n) => n.tid), tagged.map((n) => n.tid));
  });

  it("keeps the hands level and uses every lane", () => {
    for (const diff of [easy, normal, hard]) {
      const out = assignLanes(halves, context(), diff);
      const left = out.filter((n) => n.lane < 2).length / out.length;
      assert.ok(Math.abs(left - 0.5) <= 0.1, `${left}`);
      assert.deepEqual([...new Set(out.map((n) => n.lane))].sort(), [0, 1, 2, 3]);
    }
  });

  it("holds to the difficulty's limits on a lane", () => {
    for (const diff of [easy, normal, hard]) {
      const out = assignLanes(halves, context(), diff);
      const last = [-Infinity, -Infinity, -Infinity, -Infinity];
      const run = [0, 0, 0, 0];
      for (const n of out) {
        assert.ok(n.t - last[n.lane] >= (diff.minLaneGapMs ?? 0), `${n.lane} at ${n.t}`);
        for (let l = 0; l < 4; l++) run[l] = l === n.lane ? run[l] + 1 : 0;
        assert.ok(run[n.lane] <= (diff.maxJack ?? 4), `a jack of ${run[n.lane]} at ${n.t}`);
        last[n.lane] = n.t;
      }
    }
  });

  it("gives a chord as many lanes as it has notes", () => {
    const chords = every(2000, 20000, BEAT_MS).flatMap((t) => [{ t, lane: 0 }, { t, lane: 1 }]);
    const out = assignLanes(chords, context(), hard);
    for (const [t, size] of sizes(out)) assert.equal(size, 2, `${t}`);
    for (const t of new Set(out.map((n) => n.t))) {
      const lanes = out.filter((n) => n.t === t).map((n) => n.lane);
      assert.equal(new Set(lanes).size, 2, `${t}: ${lanes}`);
    }
  });

  it("gives a hold a hand of its own", () => {
    const notes = [{ t: 2000, lane: 0, len: 1000 }, { t: 2000, lane: 1 }, { t: 4000, lane: 0 }];
    const out = assignLanes(notes, context(), hard);
    const hold = out.find((n) => n.len > 0);
    const tap = out.find((n) => n.t === 2000 && !(n.len > 0));
    assert.ok(hold);
    assert.notEqual(hold.lane >> 1, tap.lane >> 1);
  });

  it("prefers the lanes of the level above", () => {
    const upperNotes = halves.map((n) => ({ t: n.t, lane: n.t % 1000 === 0 ? 0 : 3 }));
    const upper = { at: new Map(upperNotes.map((n) => [n.t, [n]])) };
    const same = (out) => out.filter((n) => upper.at.get(n.t)[0].lane === n.lane).length / out.length;
    assert.ok(same(assignLanes(halves, context(), normal, upper)) > same(assignLanes(halves, context(), normal)));
  });
});

describe("planChords", () => {
  it("leaves the moments where they are and only sizes them", () => {
    const notes = beats();
    const out = planChords(notes, context(), hard);
    assert.deepEqual([...sizes(out).keys()], notes.map((n) => n.t));
    assert.ok(out.length > notes.length);
  });

  it("Hard plays a chord on most downbeats and fewer between them", () => {
    const out = sizes(planChords(beats(), context(), hard));
    const onDownbeats = features.tempo.downbeats.filter((t) => out.has(t));
    const chordShare = (times) => times.filter((t) => out.get(t) >= 2).length / times.length;
    const others = [...out.keys()].filter((t) => !onDownbeats.includes(t) && t % BEAT_MS === 0);
    assert.ok(chordShare(onDownbeats) > chordShare(others), `${chordShare(onDownbeats)} and ${chordShare(others)}`);
  });

  it("stays at two notes below Hard, and Hard goes to three", () => {
    assert.ok(Math.max(...sizes(planChords(beats(), context(), hard)).values()) === 3);
    for (const diff of [easy, normal]) {
      const upper = { at: new Map(beats().map((n) => [n.t, [n, { t: n.t, lane: 1 }]])) };
      assert.ok(Math.max(...sizes(planChords(beats(), context(), diff, upper)).values()) <= 2);
    }
  });

  it("a level cut from another keeps a share of its chords and adds few", () => {
    const upper = { at: new Map(beats().map((n) => [n.t, [n, { t: n.t, lane: 1 }]])) };
    const count = (u) => [...sizes(planChords(beats(), context(), normal, u)).values()].filter((s) => s >= 2).length;
    assert.ok(count(upper) > 3 * count(null), `${count(upper)} against ${count(null)}`);
  });

  it("opens a loud section on a chord", () => {
    const section = { t: 16000, rise: 1 };
    const out = sizes(planChords(beats(), context({ sections: [section] }), { ...easy, chordKeep: [0, 0, 0, 0], chordNew: [0, 0, 0, 0] }));
    assert.equal(out.get(16000), 2);
    assert.equal(Math.max(...[...out].filter(([t]) => t !== 16000).map(([, s]) => s)), 1);
  });

  it("a repeated phrase plays the chords of its source", () => {
    const phrases = [
      { startMs: 0, endMs: 24000 },
      { startMs: 24000, endMs: 48000, repeatOf: 0, lagMs: 24000, similarity: 0.9, heard: true },
    ];
    const notes = beats(0, 48000);
    const out = sizes(planChords(notes, context({ phrases }), hard));
    for (const t of every(1000, 23000, BEAT_MS)) assert.equal(out.get(t + 24000), out.get(t), `${t}`);
  });

  it("keeps a hold among the notes of its moment", () => {
    const out = planChords([{ t: 4000, lane: 0, len: 1000 }, { t: 4000, lane: 1 }], context(), { ...hard, chordRates: [0, 0, 0, 0] });
    assert.ok(out.some((n) => n.len > 0));
  });
});

describe("findHeardRepeats", () => {
  const BEATS = 16;
  const phraseMs = BEATS * BEAT_MS;
  const songOf = (onsetsOf) => {
    const song = makeFeatures({ durationMs: 3 * phraseMs });
    song.bands = [{ name: "low", onsets: [0, 1, 2].flatMap((p) => onsetsOf(p).map((b) => ({ t: p * phraseMs + b * BEAT_MS, s: 0.8 }))) }];
    song.bass = [];
    song.lead = [];
    return song;
  };
  const raw = [0, 1, 2].map((p) => ({ startMs: p * phraseMs, endMs: (p + 1) * phraseMs, similarity: 0 }));
  const figure = [0, 1.5, 3, 4, 6.5, 8, 9.5, 12, 14.5];
  const other = [0.5, 2, 2.75, 5, 7, 10, 10.25, 11, 13, 15.5];

  it("finds a phrase that comes back", () => {
    const song = songOf((p) => (p === 1 ? other : figure));
    const out = findHeardRepeats(raw, song, buildTiming(song, song.durationMs));
    assert.equal(out[2].repeatOf, 0);
    assert.equal(out[2].heard, true);
    assert.equal(out[2].lagMs, 2 * phraseMs);
    assert.equal(out[0].repeatOf, undefined);
  });

  it("leaves unlike phrases alone", () => {
    const song = songOf((p) => (p === 1 ? other : p === 0 ? figure : [1, 1.25, 4.5, 6, 7.75, 11.5, 13.25]));
    const out = findHeardRepeats(raw, song, buildTiming(song, song.durationMs));
    assert.ok(out.every((p) => p.repeatOf === undefined), JSON.stringify(out));
  });

  it("leaves the plugin's sure mark as it is", () => {
    const song = songOf(() => figure);
    const sure = raw.map((p, i) => (i === 2 ? { ...p, repeatOf: 1, similarity: 0.9 } : p));
    assert.equal(findHeardRepeats(sure, song, buildTiming(song, song.durationMs))[2], sure[2]);
  });

  it("needs a beat grid", () => {
    const song = songOf(() => figure);
    assert.equal(findHeardRepeats(raw, song, { snapped: false }), raw);
  });
});

describe("a whole chart", () => {
  // Easy is cut from the Normal of v26 and that from Hard; the public Normal picks its own moments (selection.js) and is no part of the nest.
  it("is the same every time, and its levels nest", () => {
    const song = makeLayeredFeatures({ durationMs: 96000, energy: () => 0.7 });
    assert.deepEqual(generateChart(song, "hard", "k"), generateChart(song, "hard", "k"));
    const momentsOf = (d) => new Set(generateChart(song, d, "k").notes.map((n) => n.t));
    const hardMoments = momentsOf("hard");
    const normalMoments = momentsOf("normalV26");
    assert.ok([...momentsOf("easy")].every((t) => normalMoments.has(t)));
    assert.ok([...normalMoments].every((t) => hardMoments.has(t)));
  });
});
