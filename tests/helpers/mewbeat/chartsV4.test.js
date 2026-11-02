const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, GENERATOR_VERSION, LEAD_IN_MS } = require("../../../helpers/mewbeat/charts/difficulty");
const { applyDifficulty, enforceFloors } = require("../../../helpers/mewbeat/charts/difficultyFilter");
const { generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { holdSafe } = require("../../../helpers/mewbeat/charts/holds");
const { chartMetrics } = require("../../../helpers/mewbeat/charts/metrics");
const { patternEvents } = require("../../../helpers/mewbeat/charts/patterns");
const { buildPhrases, chooseLeaders } = require("../../../helpers/mewbeat/charts/phrases");
const { copyRepeat, sourceWindow } = require("../../../helpers/mewbeat/charts/repeats");
const { starsOf } = require("../../../helpers/mewbeat/charts/stars");
const { buildTiming, energyLookup } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

const KEY = "youtube:fixture:v4";
const DIFFS = ["easy", "normal", "hard"];

function chartsOf(features) {
  const all = generateAll(features, KEY);
  assert.ok(all, "fixture should chart on every difficulty");
  return all;
}

const notesIn = (notes, from, to) => notes.filter((n) => n.t >= from && n.t < to);
const momentTimes = (notes) => [...new Set(notes.map((n) => n.t))];

function countsByTime(notes) {
  const map = new Map();
  for (const n of notes) map.set(n.t, (map.get(n.t) || 0) + 1);
  return map;
}

function setup(features) {
  const timing = buildTiming(features, features.durationMs);
  const phrases = buildPhrases(features, timing, features.durationMs);
  return { timing, phrases, leaders: chooseLeaders(phrases), energy: energyLookup(features) };
}

describe("generator v4", () => {
  it("is version 10", () => {
    assert.equal(GENERATOR_VERSION, 16);
    for (const d of DIFFS) {
      assert.ok(Number.isInteger(DIFFICULTIES[d].maxLevel));
      assert.ok(Number.isInteger(DIFFICULTIES[d].maxJack));
      assert.ok(DIFFICULTIES[d].holdMinBeats > 0);
    }
    assert.deepEqual(DIFFS.map((d) => DIFFICULTIES[d].maxLevel), [0, 1, 2]);
    assert.deepEqual(DIFFS.map((d) => DIFFICULTIES[d].maxJack), [1, 2, 3]);
    assert.deepEqual(DIFFS.map((d) => DIFFICULTIES[d].holdMinBeats), [1, 1, 1]);
  });

  it("sourceWindow: the repeat copies its own window moved back by the lag", () => {
    const source = { startMs: 1000, endMs: 9000 };
    assert.deepEqual(sourceWindow({ startMs: 20000, endMs: 28000, lagMs: 21000 }, source), { from: -1000, to: 7000 });
    assert.deepEqual(sourceWindow({ startMs: 20000, endMs: 28000, lagMs: null }, source), { from: 1000, to: 9000 });
  });

  it("shiftedRepeatKeepsItsLastBar: a lag carrying a -4-beat shift copies the span it names, not the source phrase", () => {
    // One repeating phrase, so any span of it is the same music.
    const features = makeLayeredFeatures({ structure: "AAAA" });
    const beatMs = 60000 / features.tempo.bpm;
    const phrase = features.phrases.list[3]; // repeats phrase 0
    phrase.lagMs -= Math.round(4 * beatMs);
    const charts = chartsOf(features);
    for (const d of DIFFS) {
      const lastBar = notesIn(charts[d].notes, phrase.endMs - 4 * beatMs, phrase.endMs);
      assert.ok(lastBar.length > 0, d);
    }
  });

  it("deterministic: two runs are deep-equal", () => {
    assert.deepEqual(generateAll(makeLayeredFeatures(), KEY), generateAll(makeLayeredFeatures(), KEY));
  });

  it("tempo: every chart carries the song's BPM for the fall speed", () => {
    const charts = generateAll(makeLayeredFeatures(), KEY);
    for (const d of DIFFS) assert.equal(charts[d].bpm, 120, d);
  });

  it("noRandomness: the audioKey does not change the notes", () => {
    const features = makeLayeredFeatures();
    for (const d of DIFFS) {
      assert.deepEqual(generateChart(features, d, "a").notes, generateChart(features, d, "b").notes, d);
    }
  });

  // 0.75, not higher: at 0.85 Normal already takes every event this small fixture has, as many as Hard.
  for (const [label, energy] of [["flat energy", undefined], ["loud", () => 0.75]]) {
    describe(label, () => {
      const features = makeLayeredFeatures({ energy });

      it("repeatsIdenticalOnEveryDifficulty: phrase 2 plays like 0 and 3 like 1", () => {
        const charts = chartsOf(features);
        const { list } = features.phrases;
        for (const d of DIFFS) {
          const { notes } = charts[d];
          let checked = 0;
          list.forEach((p, i) => {
            if (p.repeatOf === null) return;
            const source = list[p.repeatOf];
            const expected = notesIn(notes, source.startMs, source.endMs).map((n) => ({ ...n, t: n.t + p.lagMs }));
            assert.ok(expected.length > 0, `${d}: source ${p.repeatOf} has notes`);
            assert.deepEqual(notesIn(notes, p.startMs, p.endMs), expected, `${d}: phrase ${i} vs ${p.repeatOf}`);
            checked++;
          });
          assert.equal(checked, 6, d);
          assert.ok(chartMetrics(charts[d], features).repeatIdentity.every((r) => r.identity === 1), d);
        }
      });

      it("easyHasNoChordsOrJacks", () => {
        const { notes } = chartsOf(features).easy;
        assert.equal(momentTimes(notes).length, notes.length, "no two Easy notes share a time");
        for (let i = 1; i < notes.length; i++) assert.notEqual(notes[i].lane, notes[i - 1].lane, `at ${notes[i].t}`);
      });

      it("neverThreeNoteChords", () => {
        for (const chart of Object.values(chartsOf(features))) {
          assert.ok([...countsByTime(chart.notes).values()].every((c) => c <= 2), chart.difficulty);
        }
      });

      it("notesSitOnLayerEvents: Normal", () => {
        const share = chartMetrics(chartsOf(features).normal, features).onLayerShare;
        assert.ok(share >= 0.9, `onLayerShare ${share}`);
      });

      it("hardIsFullerThanNormal", () => {
        const { easy, normal, hard } = chartsOf(features);
        assert.ok(hard.notes.length > normal.notes.length, `${hard.notes.length} vs ${normal.notes.length}`);
        assert.ok(normal.notes.length > easy.notes.length);
        const inNormal = new Set(normal.notes.map((n) => n.t));
        const shared = easy.notes.filter((n) => inNormal.has(n.t)).length / easy.notes.length;
        assert.ok(shared >= 0.8, `easy times in normal: ${shared}`);
      });

      it("keeps the gap floors, the lead-in and the same-lane limits", () => {
        for (const chart of Object.values(chartsOf(features))) {
          const p = DIFFICULTIES[chart.difficulty];
          assert.ok(chart.notes.every((n) => n.t >= LEAD_IN_MS));
          const times = momentTimes(chart.notes);
          for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= (p.minNoteGapMs ?? 0), `${chart.difficulty}: ${times[i]}`);
          const last = [-1e9, -1e9, -1e9, -1e9];
          for (const n of chart.notes) {
            assert.ok(n.t - last[n.lane] >= p.minLaneGapMs, `${chart.difficulty}: lane ${n.lane} at ${n.t}`);
            last[n.lane] = n.t;
          }
        }
      });
    });
  }

  it("drumLaneSpread: Normal on a drums-led song uses all four lanes", () => {
    const features = makeLayeredFeatures({ lead: false, bass: false });
    const { normal } = chartsOf(features);
    const counts = [0, 0, 0, 0];
    for (const n of normal.notes) counts[n.lane]++;
    // This synthetic song is calmer than a typical one (busy factor 0.75), so Normal's cap is lower and few notes split unevenly.
    counts.forEach((c, lane) => assert.ok(c / normal.notes.length >= 0.12, `lane ${lane}: ${counts}`));
  });

  it("copySeam: a copy after a different phrase is identical and breaks no floor", () => {
    const features = makeLayeredFeatures({ structure: "ABCA" });
    const { list } = features.phrases;
    const copies = list.map((p, i) => [p, i]).filter(([p, i]) => p.repeatOf !== null && list[i - 1].repeatOf === null);
    assert.ok(copies.length > 0, "a repeat directly after a non-repeat phrase");
    for (const chart of Object.values(chartsOf(features))) {
      const p = DIFFICULTIES[chart.difficulty];
      for (const [phrase, i] of copies) {
        const source = list[phrase.repeatOf];
        const expected = notesIn(chart.notes, source.startMs, source.endMs).map((n) => ({ ...n, t: n.t + phrase.lagMs }));
        assert.ok(expected.length > 0);
        assert.deepEqual(notesIn(chart.notes, phrase.startMs, phrase.endMs), expected, `${chart.difficulty}: phrase ${i}`);
      }
      // Jacks at a seam are allowed; breaking a gap floor is not.
      const times = momentTimes(chart.notes);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= p.minNoteGapMs, `${chart.difficulty}: ${times[i]}`);
      const last = [-1e9, -1e9, -1e9, -1e9];
      for (const n of chart.notes) {
        assert.ok(n.t - last[n.lane] >= p.minLaneGapMs, `${chart.difficulty}: lane ${n.lane} at ${n.t}`);
        last[n.lane] = n.t;
      }
    }
  });

  it("floorsHoldAt220Bpm: Easy keeps its gaps, density and the folded grid", () => {
    const features = makeLayeredFeatures({ bpm: 220 });
    const { easy } = chartsOf(features);
    const p = DIFFICULTIES.easy;
    const times = momentTimes(easy.notes);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= p.minNoteGapMs, `${times[i - 1]} -> ${times[i]}`);

    let peak = 0;
    for (let a = 0, b = 0; b < easy.notes.length; b++) {
      while (easy.notes[b].t - easy.notes[a].t >= 2000) a++;
      peak = Math.max(peak, (b - a + 1) / 2);
    }
    assert.ok(peak <= p.maxNps, `peak ${peak} nps`);

    const timing = buildTiming(features, features.durationMs);
    assert.equal(timing.foldFactor, 0.5);
    const half = timing.gridPoints(2);
    for (const n of easy.notes) assert.ok(half.some((g) => Math.abs(g - n.t) <= 2), `note ${n.t} is off the folded 1/2 grid`);
  });

  it("bandPathWhenNoLayers: v1 features still chart on every difficulty", () => {
    const features = makeFeatures({ durationMs: 120000, energy: () => 0.8 });
    const all = chartsOf(features);
    const floors = { easy: 350, normal: 200, hard: 150, hell: 110 };
    for (const chart of Object.values(all)) {
      assert.ok(chart.notes.every((n) => n.t >= LEAD_IN_MS));
      const last = [-1e9, -1e9, -1e9, -1e9];
      for (const n of chart.notes) {
        assert.ok(n.t - last[n.lane] >= floors[chart.difficulty], `${chart.difficulty}: ${n.t}`);
        last[n.lane] = n.t;
      }
    }
    assert.ok(all.easy.notes.length < all.normal.notes.length && all.normal.notes.length < all.hard.notes.length);
  });

  it("drumLaneRoles: Easy kicks go to lanes 0/3 and snares to 1/2", () => {
    const features = makeLayeredFeatures({ lead: false, bass: false });
    const { phrases, leaders } = setup(features);
    assert.ok(leaders.every((l) => l === "drums"), leaders.join());
    const { easy } = chartsOf(features);
    assert.ok(easy.notes.length > 20);
    for (const n of easy.notes) {
      const hit = features.drums.find((d) => Math.abs(d.t - n.t) <= 2 && d.kind !== "hat");
      assert.ok(hit, `no kick/snare under note ${n.t}`);
      const lanes = hit.kind === "kick" ? [0, 3] : [1, 2];
      assert.ok(lanes.includes(n.lane), `${hit.kind} at ${n.t} on lane ${n.lane}`);
    }
    assert.equal(phrases.length, 8);
  });
});

describe("patternEvents", () => {
  const features = makeLayeredFeatures({ lead: false, bass: false });
  const { timing, phrases } = setup(features);

  it("drums: kick/snare pairs alternate per class, hats opposite the previous hand, 3 levels of detail", () => {
    const events = patternEvents(phrases[0], "drums", features, timing);
    const at = (t) => events.filter((e) => e.t === t);
    assert.deepEqual(at(0).map((e) => e.lane), [0]); // first kick: pair 0
    assert.deepEqual(at(500).map((e) => e.lane), [1]); // first snare: pair 0
    assert.deepEqual(at(1000).map((e) => e.lane), [3]); // second kick: pair 1
    assert.deepEqual(at(1500).map((e) => e.lane), [2]); // second snare: pair 1
    const hat = at(250)[0]; // hat after the kick on lane 0 -> the other hand
    assert.equal(hat.level, 2);
    assert.ok(hat.lane >> 1 === 1);
    assert.ok(events.every((e) => e.t >= 0 && e.t < 8000));
    for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t);
  });

  it("never emits three events at one time", () => {
    const withAll = makeLayeredFeatures();
    const s = setup(withAll);
    for (const leader of ["drums", "bass", "lead"]) {
      const counts = new Map();
      for (const e of patternEvents({ ...s.phrases[1], energy: 0.9 }, leader, withAll, s.timing)) counts.set(e.t, (counts.get(e.t) || 0) + 1);
      assert.ok([...counts.values()].every((c) => c <= 2), leader);
    }
  });

  it("returns nothing for the band-path leader", () => {
    assert.deepEqual(patternEvents(phrases[0], "bands", features, timing), []);
  });

  describe("tonal lines", () => {
    const base = makeFeatures({ durationMs: 16000 });
    const phrase = { startMs: 0, endMs: 8000, energy: 0.3 };
    const line = (pitches, stepMs = 500, extra = {}) => ({
      ...base,
      lead: pitches.map((pitch, i) => ({ t: 2000 + i * stepMs, s: 0.8, pitch, len: 200, conf: 0.8, ...extra })),
    });
    // Mirror notes (level 1) are the chord layer; the melody is the level 0 events.
    const eventsOf = (features) => patternEvents(phrase, "lead", features, buildTiming(features, 16000));
    const lanesOf = (features) => eventsOf(features).filter((e) => e.level !== 1).map((e) => e.lane);

    it("maps the pitch range onto the four lanes", () => {
      assert.deepEqual(lanesOf(line([60, 64, 68, 72])), [0, 1, 2, 3]);
    });

    it("follows the contour for a narrow range, bouncing at the edges", () => {
      assert.deepEqual(lanesOf(line([60, 61, 60, 61, 60])), [1, 2, 1, 2, 1]);
      assert.deepEqual(lanesOf(line([60, 61, 62, 61])).length, 4);
    });

    it("holds a repeated pitch on its lane when slow and trills when fast", () => {
      assert.deepEqual(lanesOf(line([60, 72, 72], 500)), [0, 3, 3]);
      const fast = lanesOf(line([60, 72, 72, 72, 72], 125));
      assert.ok(fast.length >= 2 && fast.slice(1).every((l) => l === 2 || l === 3) && fast.slice(1).includes(2), `trill lanes ${fast}`);
    });

    it("climbs one lane per step on a run of three or more steps", () => {
      const stairs = lanesOf(line([60, 61, 62, 63, 64, 90]));
      assert.deepEqual(stairs.slice(0, 5), [0, 1, 2, 3, 2]);
    });

    it("keeps lanes tracking pitch: a rising scale never falls, low pitch on lane 0/1, high on 2/3", () => {
      const lanes = lanesOf(line([60, 62, 64, 66, 68]));
      assert.deepEqual(lanes, [0, 1, 2, 3, 2]); // up one lane per step, bouncing only at the edge
      assert.ok(lanes[0] <= 1 && lanes[lanes.length - 1] >= 2);
      // Longer scales climb to the edge before they bounce.
      const long = lanesOf(line([60, 62, 64, 66, 68, 70, 72]));
      assert.deepEqual(long.slice(0, 4), [0, 1, 2, 3]);
      // A stair run that starts mid-phrase re-anchors on its first note's pitch lane.
      const mixed = lanesOf(line([72, 60, 61, 62, 63, 72, 60]));
      assert.equal(mixed[0], 3);
      assert.deepEqual(mixed.slice(1, 5), [0, 1, 2, 3]);
      const pitches = [72, 60, 61, 62, 63, 72, 60];
      assert.ok(mixed[pitches.indexOf(60)] <= 1 && mixed[pitches.lastIndexOf(72)] >= 2);
    });

    it("keeps the sustain length and ignores low-confidence notes", () => {
      const events = eventsOf(line([60, 64])).filter((e) => e.level !== 1);
      assert.ok(events.length === 2 && events.every((e) => e.sustainMs === 200 && e.source === "lead"));
      assert.deepEqual(eventsOf(line([60, 64], 500, { conf: 0.2 })), []);
    });

    it("keeps a lead note on the 1/8 grid for Normal, snapped to the 1/4 grid there", () => {
      const features = makeFeatures({ durationMs: 16000 });
      // 2000 ms is a beat at 120 BPM; +190 ms lies between 1/4 slots (125 ms) so it goes to the 1/8 grid (187.5 ms).
      features.lead = [2000, 2190, 2500].map((t, i) => ({ t, s: 0.8, pitch: 60 + i * 4, len: 100, conf: 0.9 }));
      const timing = buildTiming(features, 16000);
      const events = patternEvents(phrase, "lead", features, timing).filter((e) => e.source === "lead" && e.t > 2100 && e.t < 2400);
      assert.equal(events.length, 1);
      assert.equal(events[0].level, 1);
      assert.equal(events[0].t % 125 === 0, false, "stays on the 1/8 grid for Hard");
      const normal = applyDifficulty(events, DIFFICULTIES.normal, timing, () => 0.3, [], 0.3, phrase.endMs);
      assert.deepEqual(normal.map((n) => n.t), [2250]);
      const hard = applyDifficulty(events, DIFFICULTIES.hard, timing, () => 0.3, [], 0.3, phrase.endMs);
      assert.deepEqual(hard.map((n) => n.t), [events[0].t]);
      assert.deepEqual(applyDifficulty(events, DIFFICULTIES.easy, timing, () => 0.3, [], 0.3, phrase.endMs), []);
    });

    it("keeps bass/lead notes off the half beat in a quiet phrase on Normal, but not drums", () => {
      const features = makeFeatures({ durationMs: 16000 });
      const timing = buildTiming(features, 16000);
      const note = (source) => ({ t: 2125, lane: 1, level: 1, s: 0.8, source }); // a 1/4 slot off the beat and half beat
      const normal = (source) => applyDifficulty([note(source)], DIFFICULTIES.normal, timing, () => 0.3, [], 0.3, 8000);
      assert.equal(normal("lead").length, 1);
      assert.equal(normal("bass").length, 1);
      assert.equal(normal("drums").length, 0);
    });

    it("adds a mirror note on a strong bar start and drums only when the phrase is loud", () => {
      const all = makeLayeredFeatures();
      const s = setup(all);
      const calm = patternEvents({ ...s.phrases[1], energy: 0.3 }, "lead", all, s.timing);
      const loud = patternEvents({ ...s.phrases[1], energy: 0.9 }, "lead", all, s.timing);
      assert.ok(calm.every((e) => e.source === "lead"));
      const mirrored = calm.filter((e) => calm.some((o) => o.t === e.t && o.lane === 3 - e.lane));
      assert.ok(mirrored.length > 0, "a chord on a bar start");
      assert.ok(mirrored.every((e) => e.t % 2000 === 0 || e.t === s.phrases[1].startMs));
      const secondary = loud.filter((e) => e.source === "secondary");
      // Kick/snare backbone: Normal+ (1), Easy too when on a beat (0); only a hit between 1/4 slots stays Hard-only.
      assert.ok(secondary.length > 0 && secondary.every((e) => e.level <= 1));
      assert.ok(secondary.some((e) => e.level === 1), "a hit off the beat is level 1");
      // With a sparse lead the drum hits on the beats survive and are level 0 (Easy).
      const sparse = { ...all, lead: all.lead.filter((n) => n.t < s.phrases[1].startMs + 600) };
      const open = patternEvents({ ...s.phrases[1], energy: 0.9 }, "lead", sparse, s.timing).filter((e) => e.source === "secondary");
      assert.ok(open.some((e) => e.level === 0), "a kick/snare on a beat is level 0");
      const leaders = loud.filter((e) => e.source !== "secondary").map((e) => e.t);
      assert.ok(secondary.every((e) => leaders.every((t) => Math.abs(t - e.t) >= 125)));
    });
  });
});

describe("drum backbone under a lead leader", () => {
  it("plays secondary kick/snare on Normal, and those on a beat on Easy", () => {
    const all = makeLayeredFeatures({ energy: () => 0.9 });
    const s = setup(all);
    const phrase = { ...s.phrases[1], energy: 0.9 };
    const sparse = { ...all, lead: all.lead.filter((n) => n.t < phrase.startMs + 600) };
    const events = patternEvents(phrase, "lead", sparse, s.timing);
    const secondary = events.filter((e) => e.source === "secondary" && e.level <= 1);
    assert.ok(secondary.length >= 4);
    const times = (diff) => new Set(applyDifficulty(events, DIFFICULTIES[diff], s.timing, s.energy, [], 0.9, phrase.endMs).map((n) => n.t));
    const normal = times("normal");
    const easy = times("easy");
    assert.ok(secondary.filter((e) => normal.has(e.t)).length >= 4, "Normal plays the backbone");
    assert.ok(secondary.some((e) => e.level === 0 && easy.has(e.t)), "Easy plays a kick/snare on a beat");
    assert.ok(secondary.filter((e) => e.level === 1).every((e) => !easy.has(e.t)), "Easy leaves the rest out");
  });
});

describe("applyDifficulty", () => {
  const features = makeLayeredFeatures({ lead: false, bass: false, energy: () => 0.9 });
  const { timing, phrases, energy } = setup(features);
  const events = patternEvents(phrases[1], "drums", features, timing);

  it("keeps only the levels the difficulty allows, and fewer notes on easier ones", () => {
    const easy = applyDifficulty(events, DIFFICULTIES.easy, timing, energy, []);
    const normal = applyDifficulty(events, DIFFICULTIES.normal, timing, energy, []);
    const hard = applyDifficulty(events, DIFFICULTIES.hard, timing, energy, []);
    assert.ok(easy.length > 0 && easy.length < normal.length && normal.length <= hard.length);
    assert.ok(easy.every((n) => Object.keys(n).join() === "t,lane"));
  });

  it("drops notes in the lead-in and in silence", () => {
    const early = [{ t: 500, lane: 0, level: 0, s: 1, source: "drums" }, { t: 9000, lane: 1, level: 0, s: 1, source: "drums" }];
    const out = applyDifficulty(early, DIFFICULTIES.easy, timing, () => 0.9, []);
    assert.deepEqual(out, [{ t: 9000, lane: 1 }]);
    assert.deepEqual(applyDifficulty(early, DIFFICULTIES.easy, timing, () => 0.01, []), []);
  });

  it("splits a jack to lane ^ 1 (a drum hit keeps its role) and holds gaps across the seam", () => {
    const run = [3000, 3500, 4000].map((t) => ({ t, lane: 2, level: 0, s: 1, source: "lead" }));
    assert.deepEqual(
      applyDifficulty(run, DIFFICULTIES.easy, timing, () => 0.9, []).map((n) => n.lane),
      [2, 3, 2],
    );
    const kicks = [3000, 3500].map((t) => ({ t, lane: 0, level: 0, s: 1, source: "drums" }));
    assert.deepEqual(applyDifficulty(kicks, DIFFICULTIES.easy, timing, () => 0.9, []).map((n) => n.lane), [0, 3]);
    // The previous phrase ended on lane 2 at 2950: too close for the same lane and a jack on Easy.
    const seam = applyDifficulty([{ t: 3000, lane: 2, level: 0, s: 1, source: "lead" }], DIFFICULTIES.easy, timing, () => 0.9, [{ t: 2900, lane: 2 }]);
    assert.deepEqual(seam, []);
  });

  it("never lets a chord have three notes", () => {
    const three = [0, 1, 2].map((lane) => ({ t: 3000, lane, level: 0, s: 1 - lane / 10, source: "lead" }));
    assert.equal(applyDifficulty(three, DIFFICULTIES.hard, timing, () => 0.9, []).length, 2);
    assert.equal(applyDifficulty(three, DIFFICULTIES.easy, timing, () => 0.9, []).length, 1);
  });
});

describe("enforceFloors", () => {
  it("drops only notes that break a floor", () => {
    const p = DIFFICULTIES.easy; // 200 ms any lane, 350 ms same lane
    const notes = [
      { t: 2000, lane: 0 },
      { t: 2150, lane: 1 }, // < 200 ms after the previous moment
      { t: 2300, lane: 2 },
      { t: 2400, lane: 0 }, // 100 ms after the previous moment: note floor
      { t: 2600, lane: 0 }, // 300 ms after 2300 and 600 ms after lane 0's last: fine
    ];
    assert.deepEqual(enforceFloors(notes, p).map((n) => n.t), [2000, 2300, 2600]);
  });

  it("keeps a chord (same time) intact", () => {
    const out = enforceFloors([{ t: 2000, lane: 0 }, { t: 2000, lane: 3 }], DIFFICULTIES.hard);
    assert.equal(out.length, 2);
  });
});

describe("copyRepeat", () => {
  const phrase = { startMs: 16000, endMs: 24000, lagMs: 16000 };

  it("shifts notes by the lag, keeps len, and stays inside the phrase", () => {
    const source = [{ t: 1500, lane: 1, len: 300 }, { t: 7900, lane: 2 }, { t: 9000, lane: 3 }];
    const out = copyRepeat(source, phrase, [17500, 23900, 25000]);
    assert.deepEqual(out, [{ t: 17500, lane: 1, len: 300 }, { t: 23900, lane: 2 }]);
  });

  it("drops a copied note with no event within 60 ms", () => {
    const out = copyRepeat([{ t: 1500, lane: 1 }, { t: 2500, lane: 2 }], phrase, [17540, 18600]);
    assert.deepEqual(out, [{ t: 17500, lane: 1 }]);
  });
});

describe("chartMetrics", () => {
  it("reports layer share, repeat identity, hand balance and nps", () => {
    const features = makeLayeredFeatures();
    const metrics = chartMetrics(chartsOf(features).normal, features);
    assert.deepEqual(Object.keys(metrics), ["onLayerShare", "repeatIdentity", "handBalance", "nps"]);
    assert.ok(Math.abs(metrics.handBalance.left + metrics.handBalance.right - 1) < 1e-9);
    assert.ok(metrics.nps.mean > 0 && metrics.nps.peak >= metrics.nps.mean);
    assert.deepEqual(metrics.repeatIdentity.map((r) => [r.phrase, r.source]), [[2, 0], [3, 1], [4, 0], [5, 1], [6, 0], [7, 1]]);
  });
});

describe("holds", () => {
  // One 2-beat sustain per phrase among beat taps: holds stay under the 12 % share cap, as in a real chart. No drums, so the lead leads.
  const features = makeLayeredFeatures({ sustainAtBeats: [6], drums: false, durationMs: 192000 });
  const { timing, phrases, leaders } = setup(features);
  const beatMs = 500;
  const holdsOf = (notes) => notes.filter((n) => n.len !== undefined);

  it("holdsFollowSustainedNotes: Normal turns kept sustained lead notes into holds", () => {
    const { normal } = chartsOf(features);
    assert.ok(holdsOf(normal.notes).length >= phrases.length - 2, `${holdsOf(normal.notes).length} holds`);
    const sustainTimes = new Set(features.lead.filter((n) => n.len >= beatMs).map((n) => n.t));
    phrases.forEach((p, i) => {
      assert.equal(leaders[i], "lead");
      const onSustain = notesIn(normal.notes, p.startMs, p.endMs).filter((n) => sustainTimes.has(n.t));
      assert.equal(onSustain.length, 1, `phrase ${i}`);
      assert.ok(onSustain[0].len >= beatMs, `phrase ${i}: the sustained note stayed a tap`);
    });
    for (const n of holdsOf(normal.notes)) {
      assert.ok(Number.isInteger(n.len) && n.len >= beatMs && n.len <= 4 * beatMs, `len ${n.len} at ${n.t}`);
    }
  });

  it("easyHoldsAreAloneAndLong: a hold is at least a beat and nothing starts until it is over", () => {
    const { easy } = chartsOf(features);
    const holds = holdsOf(easy.notes);
    assert.ok(holds.length >= 10, `${holds.length} holds`);
    for (const h of holds) {
      assert.ok(h.len >= beatMs, `len ${h.len} at ${h.t}`);
      assert.ok(!easy.notes.some((n) => n.t > h.t && n.t <= h.t + h.len), `a note starts inside the hold at ${h.t}`);
      const next = easy.notes.find((n) => n.t > h.t + h.len);
      if (next) assert.ok(next.t - (h.t + h.len) >= DIFFICULTIES.easy.minNoteGapMs, `gap after hold at ${h.t}`);
    }
  });

  it("noSameHandNotesDuringHold: on every difficulty, and Easy/Normal holds are never in a chord", () => {
    for (const chart of Object.values(chartsOf(features))) {
      const p = DIFFICULTIES[chart.difficulty];
      const holds = holdsOf(chart.notes);
      assert.ok(holds.length > 0, chart.difficulty);
      for (const h of holds) {
        for (const n of chart.notes) {
          if (n === h) continue;
          if (n.t >= h.t && n.t <= h.t + h.len && n.lane >> 1 === h.lane >> 1) {
            assert.fail(`${chart.difficulty}: lane ${n.lane} at ${n.t} inside hold ${h.t}+${h.len}`);
          }
          if (n.t === h.t && chart.difficulty !== "hard" && chart.difficulty !== "hell") assert.fail(`${chart.difficulty}: hold at ${h.t} is in a chord`);
        }
        // Its own lane stays busy until the minimum lane gap after it.
        const later = chart.notes.find((n) => n.lane === h.lane && n.t > h.t);
        if (later) assert.ok(later.t - (h.t + h.len) >= p.minLaneGapMs, `${chart.difficulty}: lane gap after ${h.t}`);
        // The minimum note gap holds after the end of the hold, for its own hand.
        const afterEnd = chart.notes.find((n) => n.lane >> 1 === h.lane >> 1 && n.t > h.t + h.len);
        if (afterEnd) assert.ok(afterEnd.t - (h.t + h.len) >= p.minNoteGapMs, `${chart.difficulty}: note gap after ${h.t}`);
        // Easy: the other hand is silent too.
        if (chart.difficulty === "easy") {
          assert.ok(!chart.notes.some((n) => n.lane >> 1 !== h.lane >> 1 && n.t >= h.t && n.t <= h.t + h.len), `easy: other hand plays during hold ${h.t}`);
        }
      }
    }
  });

  it("Normal: the other hand is spaced at least half a beat apart while a hold runs", () => {
    const { normal } = chartsOf(features);
    for (const h of holdsOf(normal.notes)) {
      const other = normal.notes.filter((n) => n.lane >> 1 !== h.lane >> 1 && n.t > h.t && n.t < h.t + h.len);
      // Strictly apart: two other-hand notes at one time would be a third key.
      for (let i = 1; i < other.length; i++) assert.ok(other[i].t - other[i - 1].t >= beatMs / 2, `at ${other[i].t}`);
    }
  });

  it("holdsSurviveRepeats: the repeat identity includes len", () => {
    const charts = chartsOf(features);
    const { list } = features.phrases;
    for (const d of DIFFS) {
      const { notes } = charts[d];
      let withHolds = 0;
      list.forEach((p, i) => {
        if (p.repeatOf === null) return;
        const source = list[p.repeatOf];
        const expected = notesIn(notes, source.startMs, source.endMs).map((n) => ({ ...n, t: n.t + p.lagMs }));
        if (expected.some((n) => n.len !== undefined)) withHolds++;
        assert.deepEqual(notesIn(notes, p.startMs, p.endMs), expected, `${d}: phrase ${i} vs ${p.repeatOf}`);
      });
      assert.ok(withHolds > 0, `${d}: some repeat source has holds`);
    }
  });

  it("starsCountHolds: the same notes with holds get more stars", () => {
    const { normal } = chartsOf(features);
    const flat = { notes: normal.notes.map((n) => ({ t: n.t, lane: n.lane })) };
    // A chart this hold-light gains under a rounding step, so hold every third note of the same chart.
    const some = { notes: flat.notes.map((n, i) => (i % 3 === 0 ? { ...n, len: 400 } : n)) };
    assert.ok(starsOf(some) > starsOf(flat), `${starsOf(some)} vs ${starsOf(flat)}`);
    const all = { notes: flat.notes.map((n) => ({ ...n, len: 400 })) };
    assert.ok(starsOf(all) - starsOf(flat) <= 0.41);
    const dense = { notes: Array.from({ length: 400 }, (_, i) => ({ t: i * 100, lane: i % 4, len: 50 })) };
    assert.ok(starsOf(dense) <= 10);
  });

  it("tapChartsHaveNoLenKey: a drums-only song has no len keys at all", () => {
    for (const chart of Object.values(chartsOf(makeLayeredFeatures({ lead: false, bass: false })))) {
      assert.ok(chart.notes.length > 0);
      assert.ok(chart.notes.every((n) => Object.keys(n).join() === "t,lane"), chart.difficulty);
    }
  });

  describe("holds near the end of a copy or of the song", () => {
    const { list } = features.phrases;
    const last = list[list.length - 1];
    const full = chartsOf(features);
    const crossing = full.normal.notes.find((n) => n.t >= last.startMs && n.len >= 800);
    const noHoldPast = (chart, limit, from = 0) =>
      chart.notes.filter((n) => n.t >= from && n.len && n.t + n.len > limit).map((n) => `${chart.difficulty} ${n.t}+${n.len}`);

    it("a truncated final repeat phrase leaves no hold past durationMs", () => {
      assert.equal(last.repeatOf, 1);
      assert.ok(crossing, "a long hold in the last (copied) phrase");
      // Cut a fifth short: still room for a hold of a beat after the lane gap.
      const cut = crossing.t + Math.round(crossing.len * 0.8);
      const truncated = { ...features, durationMs: cut, phrases: { ...features.phrases, list: [...list.slice(0, -1), { ...last, endMs: cut }] } };
      const charts = chartsOf(truncated);
      for (const d of DIFFS) assert.deepEqual(noHoldPast(charts[d], cut), [], d);
      const clipped = charts.normal.notes.find((n) => n.t === crossing.t);
      assert.ok(clipped && clipped.len < crossing.len && clipped.len > 0, "the crossing hold was shortened, not dropped");
    });

    it("a copy shorter than its source clips its holds to its own end", () => {
      const endMs = crossing.t + Math.round(crossing.len * 0.8);
      const shorter = { ...features, phrases: { ...features.phrases, list: [...list.slice(0, -1), { ...last, endMs }] } };
      const charts = chartsOf(shorter);
      for (const d of DIFFS) assert.deepEqual(noHoldPast(charts[d], endMs, last.startMs), [], d);
      const clipped = charts.normal.notes.find((n) => n.t === crossing.t);
      assert.ok(clipped && clipped.len < crossing.len, "shortened");
      assert.ok(clipped.len + DIFFICULTIES.normal.minLaneGapMs + clipped.t <= endMs);
    });

    it("a clipped hold below its minimum becomes a tap with no len key", () => {
      const endMs = crossing.t + 100; // 100 ms of room: below any minimum
      const shorter = { ...features, phrases: { ...features.phrases, list: [...list.slice(0, -1), { ...last, endMs }] } };
      const note = chartsOf(shorter).normal.notes.find((n) => n.t === crossing.t);
      assert.ok(note, "the note itself stays");
      assert.ok(!("len" in note), JSON.stringify(note));
    });
  });

  it("a hold's len is an integer and never present as undefined", () => {
    for (const chart of Object.values(chartsOf(features))) {
      for (const n of chart.notes) {
        assert.ok(!("len" in n) || (Number.isInteger(n.len) && n.len > 0), `${chart.difficulty} ${JSON.stringify(n)}`);
      }
    }
  });

  describe("applyDifficulty", () => {
    const lead = (t, lane, sustainMs, extra = {}) => ({ t, lane, level: 0, s: 1, source: "lead", sustainMs, ...extra });
    const run = (events, diff, prev = [], endMs = Infinity) =>
      applyDifficulty(events, DIFFICULTIES[diff], timing, () => 0.9, prev, null, endMs);

    it("a sustained tonal event becomes a hold, a short one or a drum hit does not", () => {
      assert.deepEqual(run([lead(3000, 0, 1000)], "normal"), [{ t: 3000, lane: 0, len: 1000 }]);
      assert.deepEqual(run([lead(3000, 0, 200)], "normal"), [{ t: 3000, lane: 0 }]);
      assert.deepEqual(run([lead(3000, 0, 400)], "easy"), [{ t: 3000, lane: 0 }]); // under a beat
      assert.deepEqual(run([lead(3000, 0, 1000, { source: "drums" })], "normal"), [{ t: 3000, lane: 0 }]);
    });

    it("len is capped at 4 beats and by the next note of the same lane", () => {
      assert.equal(run([lead(3000, 0, 5000)], "hard")[0].len, 2000);
      const out = run([lead(3000, 0, 1500), lead(4000, 0, 200)], "normal");
      assert.equal(out[0].len, 1000 - DIFFICULTIES.normal.minLaneGapMs);
    });

    it("a hold is clipped to leave room before the next note of its hand", () => {
      const out = run([lead(3000, 0, 1500), lead(3800, 1, 200, { level: 1 })], "normal");
      assert.deepEqual(out.map((n) => [n.t, n.lane, n.len]), [[3000, 0, 700], [3800, 1, undefined]]);
    });

    it("a hold drops lower-priority notes it cannot be clipped around, and is demoted by higher-priority ones", () => {
      // The other note is only 100 ms after the hold starts: no room for a clip.
      const lowerPriority = run([lead(3000, 0, 1000), lead(3100, 1, 200, { level: 1 })], "hard");
      assert.deepEqual(lowerPriority, [{ t: 3000, lane: 0, len: 1000 }]);
      const higher = run([lead(3000, 0, 1000, { level: 1 }), lead(3100, 1, 200, { level: 0 })], "hard");
      assert.deepEqual(higher, [{ t: 3000, lane: 0 }, { t: 3100, lane: 1 }]);
    });

    it("a hold never costs a note of its own level: legato lines stay taps on Easy", () => {
      const legato = [3000, 3500, 4000, 4500].map((t, i) => lead(t, i % 2, 500));
      const out = run(legato, "easy");
      assert.deepEqual(out.map((n) => n.t), [3000, 3500, 4000, 4500]);
      assert.ok(out.slice(0, 3).every((n) => n.len === undefined)); // the last note has room for its hold
    });

    it("Hard lets the other hand play over a hold, Normal spaces it, Easy blocks it", () => {
      const events = [lead(3000, 0, 2000), lead(3500, 2, 200), lead(3600, 3, 200, { level: 1 })];
      assert.deepEqual(run(events, "hard").map((n) => n.t), [3000, 3500, 3600]);
      assert.deepEqual(run(events, "normal").map((n) => n.t), [3000, 3500]);
      // Easy: the other note is as important as the hold, so the hold gives way and both stay taps.
      assert.deepEqual(run(events, "easy"), [{ t: 3000, lane: 0 }, { t: 3500, lane: 2 }]);
    });

    it("Normal drops one note of an other-hand chord while a hold runs, Hard keeps it", () => {
      const events = [lead(3000, 0, 2000), lead(3500, 2, 200), lead(3500, 3, 200, { level: 1 })];
      assert.deepEqual(run(events, "normal").map((n) => [n.t, n.lane]), [[3000, 0], [3500, 2]]);
      assert.deepEqual(run(events, "hard").map((n) => [n.t, n.lane]), [[3000, 0], [3500, 2], [3500, 3]]);
    });

    it("a hold from the previous phrase blocks its hand and (on Easy) every lane", () => {
      const prev = [{ t: 2000, lane: 0, len: 1500 }];
      assert.deepEqual(run([lead(3000, 1, 200), lead(3300, 2, 200)], "normal", prev).map((n) => n.lane), [2]);
      assert.deepEqual(run([lead(3000, 2, 200)], "easy", prev), []);
    });

    it("a hold is clipped to the end of its phrase", () => {
      const out = run([lead(3000, 0, 1500)], "normal", [], 4000);
      assert.equal(out[0].len, 1000 - DIFFICULTIES.normal.minLaneGapMs);
    });
  });

  describe("holdSafe", () => {
    const pool = [{ t: 2000, lane: 0, len: 1500 }, { t: 2300, lane: 2 }];
    it("refuses a slot enforceFloors would drop: too close to an other-hand note, or a chord, on Normal", () => {
      assert.equal(holdSafe({ t: 2400, lane: 3 }, pool, DIFFICULTIES.normal, timing), false);
      assert.equal(holdSafe({ t: 2300, lane: 3 }, pool, DIFFICULTIES.normal, timing), false);
      assert.equal(holdSafe({ t: 2600, lane: 3 }, pool, DIFFICULTIES.normal, timing), true);
      assert.equal(holdSafe({ t: 2400, lane: 3 }, pool, DIFFICULTIES.hard, timing), true);
    });

    it("refuses moving a hold over other-hand notes that are too close together", () => {
      const close = [{ t: 2300, lane: 2 }, { t: 2400, lane: 3 }];
      assert.equal(holdSafe({ t: 2000, lane: 0, len: 1500 }, close, DIFFICULTIES.normal, timing), false);
      assert.equal(holdSafe({ t: 2000, lane: 0, len: 1500 }, close, DIFFICULTIES.hard, timing), true); // Hard leaves the other hand free
    });
  });

  describe("enforceFloors", () => {
    it("drops later notes inside a hold's hand, and on Easy in every lane, until the gap after it", () => {
      const notes = [{ t: 2000, lane: 0, len: 1000 }, { t: 2500, lane: 1 }, { t: 2600, lane: 2 }, { t: 3100, lane: 3 }, { t: 3300, lane: 3 }];
      assert.deepEqual(enforceFloors(notes, DIFFICULTIES.hard).map((n) => n.t), [2000, 2600, 3100, 3300]);
      assert.deepEqual(enforceFloors(notes, DIFFICULTIES.easy).map((n) => n.t), [2000, 3300]);
    });

    it("a hold occupies its own lane until t + len + minLaneGapMs", () => {
      const notes = [{ t: 2000, lane: 0, len: 1000 }, { t: 3100, lane: 0 }, { t: 3200, lane: 0 }];
      assert.deepEqual(enforceFloors(notes, DIFFICULTIES.normal).map((n) => n.t), [2000, 3200]);
    });

    it("a hold does not share its time with a note of its hand, nor (Normal) with any note", () => {
      const sameHand = [{ t: 2000, lane: 0 }, { t: 2000, lane: 1, len: 500 }];
      assert.equal(enforceFloors(sameHand, DIFFICULTIES.hard).length, 1);
      const chord = [{ t: 2000, lane: 0, len: 500 }, { t: 2000, lane: 3 }];
      assert.equal(enforceFloors(chord, DIFFICULTIES.hard).length, 2);
      assert.equal(enforceFloors(chord, DIFFICULTIES.normal).length, 1);
    });

    it("Normal drops the later note of an other-hand chord during a hold, Hard keeps both", () => {
      const notes = [{ t: 2000, lane: 0, len: 1500 }, { t: 2500, lane: 2 }, { t: 2500, lane: 3 }];
      assert.deepEqual(enforceFloors(notes, DIFFICULTIES.normal, timing).map((n) => n.lane), [0, 2]);
      assert.equal(enforceFloors(notes, DIFFICULTIES.hard, timing).length, 3);
    });

    it("Normal spaces the other hand by half a beat while a hold runs", () => {
      const notes = [{ t: 2000, lane: 0, len: 1500 }, { t: 2300, lane: 2 }, { t: 2400, lane: 3 }, { t: 2600, lane: 2 }];
      assert.deepEqual(enforceFloors(notes, DIFFICULTIES.normal).map((n) => n.t), [2000, 2300, 2600]);
    });
  });
});
