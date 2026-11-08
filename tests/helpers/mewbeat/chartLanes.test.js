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

  describe("the local limit", () => {
    // Every moment wants a chord, the downbeats more than the other beats; the limit is on 8 beats (4 s at 120 BPM).
    const eager = { ...hard, chordTriples: undefined, chordRates: [3, 2, 2, 2], maxChordsPer8Beats: 3 };
    const chordTimes = (out) => [...sizes(out)].filter(([, size]) => size >= 2).map(([t]) => t);
    const mostIn = (times) => Math.max(...times.map((from) => times.filter((t) => t >= from && t < from + 8 * BEAT_MS).length));
    const downbeats = features.tempo.downbeats;

    it("chords stay under the local limit", () => {
      const notes = beats();
      const free = planChords(notes, context(), { ...eager, maxChordsPer8Beats: undefined });
      assert.ok(mostIn(chordTimes(free)) > 5, "without the limit the fixture is over it"); // control: the check below can fail
      const out = planChords(notes, context(), eager);
      assert.ok(mostIn(chordTimes(out)) <= 3, `${mostIn(chordTimes(out))}`);
      assert.deepEqual([...sizes(out).keys()], notes.map((n) => n.t)); // a chord given back is a note, not a lost moment
    });

    it("the weakest chords of a window go first, not the latest", () => {
      const out = chordTimes(planChords(beats(), context(), { ...eager, maxChordsPer8Beats: 2 }));
      assert.ok(out.length > 0);
      assert.ok(out.every((t) => downbeats.includes(t)), `${out.filter((t) => !downbeats.includes(t))}`);
    });

    it("a section start keeps its chord", () => {
      const section = { t: 16000, rise: 1 };
      const limited = { ...eager, maxChordsPer8Beats: 1 };
      const free = planChords(beats(), context({ sections: [section] }), { ...limited, maxChordsPer8Beats: undefined });
      assert.ok(chordTimes(free).some((t) => t !== 16000 && Math.abs(t - 16000) < 8 * BEAT_MS), "control: chords stand near the section start");
      const out = planChords(beats(), context({ sections: [section] }), limited);
      assert.equal(sizes(out).get(16000), 2);
      assert.equal(mostIn(chordTimes(out).filter((t) => Math.abs(t - 16000) < 8 * BEAT_MS)), 1);
    });

    it("a hold keeps its moment: two holds at once stay a chord", () => {
      const notes = [...beats().filter((n) => n.t !== 20000), { t: 20000, lane: 0, len: 600 }, { t: 20000, lane: 1, len: 600 }].sort((a, b) => a.t - b.t || a.lane - b.lane);
      const out = planChords(notes, context(), { ...eager, maxChordsPer8Beats: 1 });
      assert.equal(sizes(out).get(20000), 2);
      assert.equal(out.filter((n) => n.len > 0).length, 2);
    });

    it("a repeat plays the chords its source was left with", () => {
      const phrases = [
        { startMs: 0, endMs: 24000 },
        { startMs: 24000, endMs: 48000, repeatOf: 0, lagMs: 24000, similarity: 0.9, heard: true },
      ];
      const out = planChords(beats(0, 48000), context({ phrases }), eager);
      const at = sizes(out);
      for (const t of every(1000, 23000, BEAT_MS)) assert.equal(at.get(t + 24000), at.get(t), `${t}`);
      assert.ok(mostIn(chordTimes(out)) <= 3);
    });

    // A phrase, its repeat, then new moments (the repeat would be their source, so they are a phrase of their own).
    const repeating = (lagMs) => [
      { startMs: 0, endMs: lagMs },
      { startMs: lagMs, endMs: 2 * lagMs, repeatOf: 0, lagMs, similarity: 0.9, heard: true },
      { startMs: 2 * lagMs, endMs: 64000 },
    ];

    it("the share gate spends as if a chord given back stood, also on its repeat", () => {
      // Dense moments in the phrase and its repeat, where the limit bites; sparse ones after, where only the gate keeps the chords down.
      const gated = { ...eager, maxChordShare: 0.15, maxChordsPer8Beats: 2 };
      const notes = [...every(0, 24000, 250), ...every(24000, 62000, 1000)].map((t) => ({ t, lane: 0 }));
      const run = (diff) => chordTimes(planChords(notes, context({ phrases: repeating(12000) }), diff));
      const free = run({ ...gated, maxChordsPer8Beats: undefined });
      const limited = run(gated);
      const after = (times) => times.filter((t) => t >= 24000).length;
      assert.ok(limited.filter((t) => t < 12000).length < free.filter((t) => t < 12000).length, "control: the limit gave chords back in the first phrase");
      assert.ok(after(free) > 0, "control: the gate lets chords through after the repeat");
      // The chords given back were spent all the same: the limit must not make room for more of them than the gate allows.
      assert.ok(after(limited) <= after(free), `${after(limited)} against ${after(free)}`);
    });

    it("a repeat of a chord that was given back stays a single note, though its own window has room", () => {
      // A section start makes the chords near it give way in the first phrase. At the repeat its moment has a neighbour 30 ms away, so it
      // cannot be a chord there and the window around the repeat is emptier than the source's was.
      const sections = [{ t: 4000, rise: 1 }];
      const notes = [...beats(0, 48000), { t: 28030, lane: 0 }].sort((a, b) => a.t - b.t);
      const limited = { ...eager, maxChordsPer8Beats: 1 };
      const run = (diff) => sizes(planChords(notes, context({ phrases: repeating(24000), sections }), diff));
      const free = run({ ...limited, maxChordsPer8Beats: undefined });
      const out = run(limited);
      assert.equal(out.get(28000), 1, "control: the repeat of the section start is not a chord");
      const gone = every(0, 24000, BEAT_MS).filter((t) => free.get(t) >= 2 && out.get(t) === 1);
      assert.ok(gone.length > 0, "control: the first phrase gave chords back");
      assert.deepEqual(gone.filter((t) => out.get(t + 24000) >= 2), []);
    });

    it("chords more than 8 beats apart do not count against each other, closer ones do", () => {
      const run = (stepMs, diff) => chordTimes(planChords(every(2000, 40000, stepMs).map((t) => ({ t, lane: 0 })), context(), diff));
      const limited = { ...eager, maxChordsPer8Beats: 1 };
      const free = { ...limited, maxChordsPer8Beats: undefined };
      assert.ok(run(8 * BEAT_MS, free).length > 3, "control: the moments are chords without the limit");
      assert.deepEqual(run(8 * BEAT_MS, limited), run(8 * BEAT_MS, free));
      assert.ok(run(7 * BEAT_MS, limited).length < run(7 * BEAT_MS, free).length);
    });

    it("a chord given back keeps the hold of its moment, not the tap", () => {
      const notes = [...beats().filter((n) => n.t !== 21000), { t: 21000, lane: 0, len: 300 }, { t: 21000, lane: 1 }].sort((a, b) => a.t - b.t || a.lane - b.lane);
      const free = planChords(notes, context(), { ...eager, maxChordsPer8Beats: undefined });
      assert.equal(sizes(free).get(21000), 2, "control: the moment is a chord of a hold and a tap");
      const out = planChords(notes, context(), { ...eager, maxChordsPer8Beats: 1 });
      const at = out.filter((n) => n.t === 21000);
      assert.deepEqual(at.map((n) => [n.lane, n.len > 0]), [[0, true]]);
    });

    it("the weakest chord is the one in the quieter bar when the place in the bar is the same", () => {
      // One moment on the second beat of every bar, 4 beats apart: a window holds two, every other bar is loud. All of them want a chord.
      const onBeat2 = every(2500, 40000, 4 * BEAT_MS).map((t) => ({ t, lane: 0 }));
      const loud = (t) => Math.floor(t / 2000) % 2 === 0;
      const run = (diff) => chordTimes(planChords(onBeat2, context({ energy: { at: (t) => (loud(t) ? 0.9 : 0.3) } }), { ...eager, chordRates: [9, 9, 9, 9], ...diff }));
      assert.ok(run({ maxChordsPer8Beats: undefined }).some((t) => !loud(t)), "control: the quiet bars have chords without the limit");
      const out = run({ maxChordsPer8Beats: 1 });
      assert.ok(out.length > 0);
      assert.ok(out.every(loud), `${out.filter((t) => !loud(t))}`);
    });
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
  // Since v44 the public levels nest on Normal: Easy is cut from it and Hard is built on it. Before, easyV26 was cut from normalV26 and that
  // from hardBase; the public Normal picks its own moments (selection.js), so these internal levels keep the old nest.
  it("is the same every time, and its levels nest", () => {
    const song = makeLayeredFeatures({ durationMs: 96000, energy: () => 0.7 });
    assert.deepEqual(generateChart(song, "hard", "k"), generateChart(song, "hard", "k"));
    const momentsOf = (d) => new Set(generateChart(song, d, "k").notes.map((n) => n.t));
    const nested = (inner, outer) => [...momentsOf(inner)].every((t) => momentsOf(outer).has(t));
    assert.ok(nested("easy", "normal"), "Easy is cut from Normal");
    assert.ok(nested("normal", "hard"), "Hard is built on Normal");
    assert.ok(nested("easyV26", "normalV26"));
    assert.ok(nested("normalV26", "hardBase"));
  });
});
