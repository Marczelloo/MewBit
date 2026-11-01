const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, GENERATOR_VERSION, LEAD_IN_MS } = require("../../../helpers/mewbeat/charts/difficulty");
const { applyDifficulty, enforceFloors } = require("../../../helpers/mewbeat/charts/difficultyFilter");
const { generateAll, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { chartMetrics } = require("../../../helpers/mewbeat/charts/metrics");
const { patternEvents } = require("../../../helpers/mewbeat/charts/patterns");
const { buildPhrases, chooseLeaders } = require("../../../helpers/mewbeat/charts/phrases");
const { copyRepeat } = require("../../../helpers/mewbeat/charts/repeats");
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
  it("is version 4", () => {
    assert.equal(GENERATOR_VERSION, 4);
    for (const d of DIFFS) {
      assert.ok(Number.isInteger(DIFFICULTIES[d].maxLevel));
      assert.ok(Number.isInteger(DIFFICULTIES[d].maxJack));
      assert.ok(DIFFICULTIES[d].holdMinBeats > 0);
    }
    assert.deepEqual(DIFFS.map((d) => DIFFICULTIES[d].maxLevel), [0, 1, 2]);
    assert.deepEqual(DIFFS.map((d) => DIFFICULTIES[d].maxJack), [1, 2, 3]);
    assert.deepEqual(DIFFS.map((d) => DIFFICULTIES[d].holdMinBeats), [1, 0.5, 0.5]);
  });

  it("deterministic: two runs are deep-equal", () => {
    assert.deepEqual(generateAll(makeLayeredFeatures(), KEY), generateAll(makeLayeredFeatures(), KEY));
  });

  it("noRandomness: the audioKey does not change the notes", () => {
    const features = makeLayeredFeatures();
    for (const d of DIFFS) {
      assert.deepEqual(generateChart(features, d, "a").notes, generateChart(features, d, "b").notes, d);
    }
  });

  for (const [label, energy] of [["flat energy", undefined], ["loud", () => 0.85]]) {
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
            const expected = notesIn(notes, source.startMs, source.endMs).map((n) => ({ t: n.t + p.lagMs, lane: n.lane }));
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
    counts.forEach((c, lane) => assert.ok(c / normal.notes.length >= 0.15, `lane ${lane}: ${counts}`));
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
        const expected = notesIn(chart.notes, source.startMs, source.endMs).map((n) => ({ t: n.t + phrase.lagMs, lane: n.lane }));
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
    const floors = { easy: 350, normal: 200, hard: 150 };
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
      assert.ok(secondary.length > 0 && secondary.every((e) => e.level === 2));
      const leaders = loud.filter((e) => e.source !== "secondary").map((e) => e.t);
      assert.ok(secondary.every((e) => leaders.every((t) => Math.abs(t - e.t) >= 125)));
    });
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
