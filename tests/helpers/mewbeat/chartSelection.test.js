const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { DIFFICULTIES, LEAD_IN_MS, SILENCE_ENERGY, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { GENERATOR_VERSION, analyse, generateChart, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { BUDGET, METER_TOLERANCE } = require("../../../helpers/mewbeat/charts/momentWeights");
const selection = require("../../../helpers/mewbeat/charts/selection");

const { audibleOf, phraseBudget, repeatPlan, scoreMoments, selectMoments, snappedMoments } = selection;
const { makeFeatures, makeLayeredFeatures, threeSectionEnergy } = require("./fixtures");

const NORMAL = levelOf("normal");
const KEY = "youtube:fixture:64000";
const layered = (extra = {}) => makeLayeredFeatures({ bpm: 120, durationMs: 64000, ...extra });
const quietLog = { warning() {} };

// A grid of 120 bpm (500 ms beats, bars of four) and a phrase of eight bars on it, for selectMoments on moments of our own.
const BEAT = 500;
const timing = {
  snapped: true,
  beats: Array.from({ length: 40 }, (_, i) => i * BEAT),
  downbeats: Array.from({ length: 10 }, (_, i) => i * 4 * BEAT),
  beatMsAt: () => BEAT,
};
const phrase = { index: 0, startMs: 0, endMs: 16 * BEAT, pulse: 0 };
const moment = (t, score, extra = {}) => ({ t, s: 0.7, score, metric: t % BEAT === 0 ? 0 : 1, down: t % (4 * BEAT) === 0 ? 1 : 0, source: "lead", ...extra });
const diff = { ...NORMAL, foreground: 0, minNoteGapMs: 100, gapBeats: 1 / 4 };

describe("Normal picks its notes from the music", () => {
  it("scores use the sound and the place in the bar", () => {
    const ctx = analyse(layered());
    const scored = scoreMoments(ctx, "normal");
    const onsetTimes = new Set([
      ...ctx.raw.bands.flatMap((b) => b.onsets.map((o) => o.t)),
      ...["drums", "bass", "lead"].flatMap((layer) => ctx.raw[layer].map((o) => o.t)),
    ]);

    // Every moment is a sound of the music, and they come time-ordered.
    assert.ok(scored.length > 100);
    assert.ok(scored.every((m, i) => (i === 0 || scored[i - 1].t < m.t) && Number.isFinite(m.score)));
    assert.ok(scored.every((m) => [...onsetTimes].some((t) => Math.abs(t - m.t) <= 30)));

    // The place in the bar counts: a downbeat is worth more than a beat, a beat more than a quarter beat.
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const downbeats = scored.filter((m) => m.down === 1);
    const beats = scored.filter((m) => m.metric === 0 && m.down === 0);
    const quarters = scored.filter((m) => m.metric === 2);
    assert.ok(downbeats.length > 0 && beats.length > 0 && quarters.length > 0);
    assert.ok(mean(downbeats.map((m) => m.score)) > mean(beats.map((m) => m.score)));
    assert.ok(mean(beats.map((m) => m.score)) > mean(quarters.map((m) => m.score)));
  });

  it("a stronger moment beats a weaker one at the same place in the bar", () => {
    const scored = scoreMoments(analyse(layered()), "normal");
    for (const metric of [0, 1, 2]) {
      // Moments that differ only in strength: the same beat level, no downbeat, the same distance to the grid.
      const places = new Map();
      for (const m of scored.filter((c) => c.metric === metric && c.down === 0)) {
        const key = m.grid.toFixed(6);
        if (!places.has(key)) places.set(key, []);
        places.get(key).push(m);
      }
      let compared = 0;
      for (const same of places.values()) {
        same.sort((x, y) => x.s - y.s);
        for (let i = 1; i < same.length; i++) {
          if (same[i].s === same[i - 1].s) {
            assert.ok(Math.abs(same[i].score - same[i - 1].score) < 1e-9, "equal strength, equal score");
          } else {
            assert.ok(same[i].score > same[i - 1].score, `metric ${metric}: s ${same[i - 1].s} then ${same[i].s}`);
            compared++;
          }
        }
      }
      assert.ok(compared > 5, `pairs compared on metric ${metric}: ${compared}`);
    }
  });

  it("over budget drops the weakest, keeps downbeats", () => {
    const moments = [];
    for (let beat = 0; beat < 16; beat++) moments.push(moment(beat * BEAT, beat % 4 === 0 ? 1 : 2 + beat / 100)); // the downbeats score the lowest, yet are in the foreground
    const picked = selectMoments(phrase, moments, 8, diff, timing);

    assert.strictEqual(picked.length, 8);
    const times = picked.map((n) => n.t);
    for (const downbeat of [0, 4, 8, 12].map((b) => b * BEAT)) assert.ok(times.includes(downbeat), `downbeat ${downbeat}`);
    // Of the other beats the four strongest stay: the later ones, which score highest here.
    for (const beat of [11, 13, 14, 15]) assert.ok(times.includes(beat * BEAT), `beat ${beat}`);
    assert.ok(picked.every((n) => n.reason === "ocena"));
  });

  it("under budget fills beats where something sounds, never the silence", () => {
    // Nothing is in the foreground; the budget asks for more than the sounds of the beats and half beats give.
    const sounds = [0, 1, 2, 3, 5, 6, 9, 10, 13].map((b) => moment(b * BEAT, -2 + b / 100));
    const picked = selectMoments(phrase, sounds, 20, { ...diff, foreground: 5 }, timing);

    assert.ok(picked.length > 0 && picked.length <= sounds.length);
    assert.ok(picked.every((n) => n.reason === "dopełnienie"));
    const soundTimes = new Set(sounds.map((m) => m.t));
    assert.ok(picked.every((n) => soundTimes.has(n.t)), "every note is on a sound");
    assert.ok(!picked.some((n) => [4, 7, 8, 11, 12, 14, 15].map((b) => b * BEAT).includes(n.t)), "no note in the silence");
  });

  it("the budget is an upper bound", () => {
    const sounds = Array.from({ length: 16 }, (_, b) => moment(b * BEAT, 3));
    for (const budget of [0, 1, 5, 40]) {
      assert.ok(selectMoments(phrase, sounds, budget, diff, timing).length <= budget);
    }
  });

  it("no sound means no notes", () => {
    assert.deepStrictEqual(selectMoments(phrase, [], 12, diff, timing), []);
    // Not even for a steady pulse that has nothing to be on: the pulse is a beat nothing sounds on only where the
    // phrase plays one; here it does not.
    assert.deepStrictEqual(selectMoments({ ...phrase, pulse: 0 }, [], 12, diff, timing), []);

    const silent = makeFeatures({ durationMs: 60000 });
    silent.bands = silent.bands.map((band) => ({ ...band, onsets: [] }));
    assert.strictEqual(generateChart(silent, "normal", KEY), null);
  });

  it("a steady pulse is played on beats nothing sounds on, last", () => {
    const sounds = [moment(0, 3), moment(BEAT * 4, 3)];
    const picked = selectMoments({ ...phrase, pulse: 1 }, sounds, 10, diff, timing);
    const pulse = picked.filter((n) => n.reason === "puls");

    assert.ok(pulse.length > 0);
    assert.ok(pulse.every((n) => n.source === "pulse" && n.t % BEAT === 0));
    assert.deepStrictEqual(picked.filter((n) => n.reason !== "puls").map((n) => n.t), [0, BEAT * 4]);
  });

  it("low tempo confidence still gives a chart", () => {
    const features = makeFeatures({ confidence: 0.1, durationMs: 120000, energy: threeSectionEnergy });
    assert.strictEqual(analyse(features).timing.snapped, false);
    const chart = generateChart(features, "normal", KEY);

    assert.ok(chart);
    assert.ok(chart.notes.length > 50);
    assert.strictEqual(chart.version, GENERATOR_VERSION);
  });

  it("features without lead, bass or drums still give a chart", () => {
    for (const layers of [{ lead: false }, { bass: false }, { drums: false }, { lead: false, bass: false, drums: false }]) {
      const features = layered(layers);
      for (const layer of ["drums", "bass", "lead"]) if (layers[layer] === false) delete features[layer];
      const chart = generateChart(features, "normal", KEY);
      assert.ok(chart, JSON.stringify(layers));
      assert.ok(chart.notes.length > 50, JSON.stringify(layers));
    }
  });

  it("same features give the same notes", () => {
    const a = generateChart(layered(), "normal", KEY);
    const b = generateChart(layered(), "normal", KEY);
    assert.deepStrictEqual(a.notes, b.notes);
    assert.ok(a.notes.length > 50);
  });

  it("the chart keeps Normal's note gap and tells why each moment was chosen", () => {
    const story = traceChart(layered(), "normal", KEY);
    const times = [...new Set(story.chart.notes.map((n) => n.t))].sort((x, y) => x - y);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= NORMAL.minNoteGapMs, `${times[i - 1]} -> ${times[i]}`);

    const reasons = new Set(story.records.filter((r) => r.kind === "event").map((r) => r.reason));
    assert.ok(reasons.size > 0);
    for (const reason of reasons) assert.ok(["ocena", "dopełnienie", "puls"].includes(reason), String(reason));
  });

  it("the budget follows the music: a loud phrase gets more than a quiet one", () => {
    const ctx = analyse(makeFeatures({ bpm: 120, durationMs: 180000, energy: threeSectionEnergy }));
    const budgets = ctx.phrases.map((p) => phraseBudget(p, ctx, NORMAL) / ((p.endMs - p.startMs) / 1000));
    const at = (ms) => ctx.phrases.findIndex((p) => p.startMs <= ms && ms < p.endMs);
    assert.ok(budgets[at(90000)] > budgets[at(20000)]);
  });

  it("a stored v26 chart is recomputed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-selection-"));
    try {
      const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000, isStream: false } };
      const chartsDir = path.join(dir, "charts");
      const file = (version) => path.join(chartsDir, `${audioKeyFile(audioKeyOf(track))}.v${version}.json`);
      fs.mkdirSync(chartsDir, { recursive: true });
      const old = { version: 26, notes: [{ t: 1000, lane: 0 }] };
      fs.writeFileSync(file(26), JSON.stringify({ easy: old, normal: old, hard: old, hell: old }));

      const analysis = { getFeatures: async () => makeFeatures(), statusOf: () => null };
      const store = createChartStore({ dir, analysis, log: quietLog });
      assert.strictEqual(GENERATOR_VERSION, 37);
      assert.strictEqual(store.peekCharts(track), null);
      const { charts } = await store.getCharts(track, "node");

      assert.strictEqual(charts.normal.version, 37);
      assert.ok(charts.normal.notes.length > 1);
      assert.ok(fs.existsSync(file(37)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The scores of density/k_weights_raw.json's test_vector (a train song's candidates, scored by the fit's own code)
  // must come out of scoreMoments. The song's features are not in the repository: skipped where they are missing.
  const weights = require("../../../mapping-analysis/salience/density/k_weights_raw.json");
  const vector = weights.test_vector;
  const featuresFile = path.join(__dirname, "../../../.mewbeat-debug/data/features", `${vector.song}.json`);
  it("reproduces test_vector from k_weights_raw.json", { skip: !fs.existsSync(featuresFile) && "the song's features are not in this checkout" }, () => {
    const raw = JSON.parse(fs.readFileSync(featuresFile, "utf8"));
    const features = raw.features ?? raw;
    // The weights were fitted on the tracker's beats: the vector is scored on them, whatever grid the charts now get.
    const ctx = analyse({ ...features, tempo: { ...features.tempo, fitted: true } });
    const scored = scoreMoments(ctx, "normal");

    assert.strictEqual(scored.length, vector.n_candidates);
    for (const c of vector.candidates) {
      assert.ok(Math.abs(scored[c.index].t - c.t_ms) <= 1, `candidate ${c.index} time`);
      assert.ok(Math.abs(scored[c.index].score - c.score.normal) < 1e-3, `candidate ${c.index}: ${scored[c.index].score} vs ${c.score.normal}`);
    }
  });

  it("exports only what the generator and the measurements use", () => {
    assert.deepStrictEqual(Object.keys(selection).sort(), ["audibleOf", "extraMoments", "openingLeadRates", "phraseBudget", "repeatPlan", "scoreMoments", "selectMoments", "snappedMoments", "soloLeadRates"]);
  });
});

describe("the grid of the candidates", () => {
  // The beats are taken out between 19.5 s and 30.5 s; the grid goes on from the last beat at the median beat, without bars.
  it("continues across a hole in the beats at the median beat, without bars", () => {
    const ctx = analyse(layered());
    const last = 19500;
    const next = 30500;
    const medianMs = ctx.timing.medianMs;
    assert.strictEqual(medianMs, BEAT);
    const real = scoreMoments(ctx, "normal");
    assert.ok(real.some((m) => m.t > last && m.t < next && m.down === 1), "the whole grid has bars in that stretch");

    ctx.timing = {
      ...ctx.timing,
      beats: ctx.timing.beats.filter((t) => t <= last || t >= next),
      downbeats: ctx.timing.downbeats.filter((t) => t <= last || t >= next),
    };
    ctx.scored = {};
    const holed = scoreMoments(ctx, "normal");

    const inHole = holed.filter((m) => m.t > last + 5 && m.t < next - 5);
    assert.ok(inHole.length > 30, `candidates in the hole: ${inHole.length}`);
    // The place each candidate has on the grid that goes on from the last beat: beat 0, half beat 1, quarter beat 2, other 3.
    const expected = (t) => {
      const u = (((t - last) / medianMs) % 1 + 1) % 1;
      if (Math.min(u, 1 - u) < METER_TOLERANCE) return 0;
      if (Math.abs(u - 0.5) < METER_TOLERANCE) return 1;
      return Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75)) < METER_TOLERANCE ? 2 : 3;
    };
    for (const m of inHole) {
      assert.strictEqual(m.metric, expected(m.t), `the place of ${m.t}`);
      assert.strictEqual(m.down, 0, `no bar at ${m.t}`);
    }
    // The hole does not turn every candidate into "anything else": beats and half beats are found in it.
    assert.ok(inHole.some((m) => m.metric === 0) && inHole.some((m) => m.metric === 1));
    // Outside the hole nothing changes: the same places, the bars as well.
    const same = (m) => m.t <= last || m.t >= next + BEAT;
    assert.deepStrictEqual(holed.filter(same).map((m) => [m.t, m.metric, m.down]), real.filter(same).map((m) => [m.t, m.metric, m.down]));
  });
});

describe("the edges of a phrase", () => {
  const edgePhrase = { index: 1, startMs: 8000, endMs: 16000, pulse: 0 };
  const opts = { ...diff, foreground: 5 };
  const sound = (t) => moment(t, -1);
  // A sound the phrase before left after its last note (6500), sounds in the phrase, one in the middle, and the tail.
  const carry = [7000, 7500].map(sound);
  const own = [8500, 9000, 9500, 10000, 13000, 14000, 14500, 15000, 15500].map(sound);

  const marks = (picked, before, end) => [before, ...picked.map((n) => n.t), end];
  const stretches = (picked, before, end, candidates) => {
    const m = marks(picked, before, end);
    const open = [];
    for (let i = 1; i < m.length; i++) {
      if (m[i] - m[i - 1] <= 2 * BEAT) continue;
      for (const c of candidates) if (c.t > m[i - 1] + 100 && c.t < m[i] - 100) open.push([m[i - 1], m[i], c.t]);
    }
    return open;
  };

  it("takes a sound for the stretch from the last note before the phrase to its first note", () => {
    const picked = selectMoments(edgePhrase, own, 20, opts, timing, { before: 6500, carry });
    assert.ok(picked.length > 0);
    assert.deepStrictEqual(stretches(picked, 6500, edgePhrase.endMs, [...carry, ...own]), []);
    // Alone the phrase's start would have been the mark: the first own sound is at 8500, 2000 ms after 6500.
    assert.ok(picked.some((n) => n.t < edgePhrase.startMs), "a sound the phrase before left");
    assert.ok(picked.every((n) => Math.abs(n.t - 6500) >= 100));
  });

  it("takes a sound for the stretch from the last note to the end of the phrase", () => {
    const picked = selectMoments(edgePhrase, own.slice(0, 4), 20, opts, timing, { before: 7900 });
    const tail = selectMoments(edgePhrase, own, 20, opts, timing, { before: 7900 });
    assert.deepStrictEqual(stretches(tail, 7900, edgePhrase.endMs, own), []);
    assert.ok(tail.some((n) => n.t >= 13000), "the tail is not left open");
    // Without the sounds of the tail it stays open, and nothing is made up.
    assert.ok(picked.every((n) => own.slice(0, 4).some((c) => c.t === n.t)));
  });

  it("measures a phrase with no neighbour from its own start", () => {
    const picked = selectMoments(edgePhrase, own, 20, opts, timing);
    assert.deepStrictEqual(stretches(picked, edgePhrase.startMs, edgePhrase.endMs, own), []);
    assert.ok(picked.every((n) => n.t >= edgePhrase.startMs));
  });

  it("keeps the budget while closing a stretch", () => {
    for (const budget of [1, 3, 6]) {
      const picked = selectMoments(edgePhrase, own, budget, opts, timing, { before: 6500, carry });
      assert.ok(picked.length <= budget, `budget ${budget}: ${picked.length}`);
    }
  });

  it("a real song has no stretch of more than two beats with a sound in it across the start of a phrase it charts itself", () => {
    // Phrases that are told to repeat none, with bands that differ, so most are picked from the music (a copied repeat plays its source).
    const features = layered({ energy: () => 0.7 });
    for (const p of features.phrases.list) Object.assign(p, { repeatOf: null, similarity: 0, lagMs: 0 });
    // A phrase is 64 sixteenths: dropping every fifth onset gives each phrase its own bands, so none is heard as a repeat.
    for (const band of features.bands) band.onsets = band.onsets.filter((o) => Math.round(o.t / 125) % 5 !== 0);
    const story = traceChart(features, "normal", KEY);
    const ctx = analyse(features);
    const times = [...new Set(story.chart.notes.map((n) => n.t))].sort((x, y) => x - y);
    const heard = scoreMoments(ctx, "normal").filter((m) => m.t >= LEAD_IN_MS && ctx.energy.at(m.t) >= SILENCE_ENERGY);
    let checked = 0;
    for (const p of ctx.phrases.slice(1)) {
      if (story.phrases[p.index].charted !== "music") continue; // a copy plays its source
      checked++;
      const before = times.filter((t) => t < p.startMs).pop();
      const after = times.find((t) => t >= p.startMs);
      assert.ok(before !== undefined && after !== undefined, `notes either side of ${p.startMs}`);
      if (after - before <= 2 * BEAT) continue;
      const open = heard.filter((c) => c.t > before + 100 && c.t < after - 100);
      assert.deepStrictEqual(open.map((c) => c.t), [], `the seam at ${p.startMs}: ${before} to ${after}`);
    }
    assert.ok(checked >= 3, `seams checked: ${checked}`);
  });
});

describe("the budget of a phrase", () => {
  const loud = (extra = {}) => makeFeatures({ bpm: 120, durationMs: 64000, energy: () => 0.8, ...extra });

  it("never passes the level's ceiling in moments per second", () => {
    for (const features of [loud(), layered({ energy: () => 0.95 })]) {
      const ctx = analyse(features);
      for (const p of ctx.phrases) {
        const seconds = audibleOf(ctx, p, 1).seconds;
        assert.ok(phraseBudget(p, ctx, NORMAL) <= Math.floor(NORMAL.maxNpsCeiling * seconds), `phrase ${p.index}`);
      }
    }
    // A ceiling below what the music calls for binds exactly; the constant of the model's own is gone.
    const ctx = analyse(layered({ energy: () => 0.95 }));
    const p = ctx.phrases[3];
    const seconds = audibleOf(ctx, p, 1).seconds;
    assert.strictEqual(phraseBudget(p, ctx, { ...NORMAL, maxNpsCeiling: 1 }), Math.floor(seconds));
    assert.ok(phraseBudget(p, ctx, { ...NORMAL, maxNpsCeiling: Infinity }) > Math.floor(seconds));
    assert.strictEqual(BUDGET.maxRate, undefined);
  });

  it("the chart's phrases stay under the ceiling in moments per second", () => {
    for (const features of [loud(), layered({ energy: () => 0.95 })]) {
      const ctx = analyse(features);
      const times = [...new Set(generateChart(features, "normal", KEY).notes.map((n) => n.t))];
      for (const p of ctx.phrases) {
        const moments = times.filter((t) => t >= p.startMs && t < p.endMs).length;
        assert.ok(moments / ((p.endMs - p.startMs) / 1000) <= NORMAL.maxNpsCeiling, `phrase ${p.index}: ${moments}`);
      }
    }
  });

  it("counts the seconds the music plays: the lead-in and the silence take none", () => {
    const silent = (t) => (t >= 28000 && t < 32000 ? 0 : 0.8);
    const whole = analyse(loud());
    const gap = analyse(loud({ energy: silent }));
    const at = (ctx, ms) => ctx.phrases.find((p) => p.startMs <= ms && ms < p.endMs);
    const wholePhrase = at(whole, 30000);
    const gapPhrase = at(gap, 30000);
    const full = audibleOf(whole, wholePhrase, 1).seconds;
    const less = audibleOf(gap, gapPhrase, 1).seconds;
    assert.strictEqual(less, full - 4);
    assert.ok(phraseBudget(gapPhrase, gap, NORMAL) < phraseBudget(wholePhrase, whole, NORMAL));

    // The first second of the song is lead-in.
    const first = whole.phrases[0];
    assert.strictEqual(audibleOf(whole, first, 1).seconds, (first.endMs - first.startMs) / 1000 - LEAD_IN_MS / 1000);
  });

  it("a quiet opening gets more than the same quiet after the song's first loud phrase", () => {
    const quiet = (t) => t < 16000 || (t >= 40000 && t < 48000);
    const ctx = analyse(loud({ energy: (t) => (quiet(t) ? SILENCE_ENERGY + 0.02 : 0.8) }));
    const wide = { ...NORMAL, budgetScale: 100, maxNpsCeiling: Infinity }; // the rates, without the rounding of a small budget
    const rate = (p) => phraseBudget(p, ctx, wide) / audibleOf(ctx, p, 1).seconds;
    const inside = (a, b) => ctx.phrases.find((p) => p.startMs >= a && p.endMs <= b);
    const opening = inside(0, 16000);
    const later = inside(40000, 48000);
    assert.ok(opening && later, "a quiet phrase in each place");
    const floor = BUDGET.openingMinRatio;
    BUDGET.openingMinRatio = 0.9; // the fixture's quiet phrases lie just above the real floor, this one binds
    try {
      assert.ok(rate(opening) > rate(later), `${rate(opening)} against ${rate(later)}`);
      assert.ok(rate(opening) < rate(inside(16000, 40000)), "the opening stays below the loud phrases");
    } finally {
      BUDGET.openingMinRatio = floor;
    }
  });

  it("a song that starts loud has no opening, and silence does not end one", () => {
    const quietAt = (t) => t >= 40000 && t < 48000;
    const startsLoud = analyse(loud({ energy: (t) => (quietAt(t) ? 0.2 : 0.8) }));
    phraseBudget(startsLoud.phrases[0], startsLoud, NORMAL);
    // Normal's budgets are kept under one key, its felt tempo in it (selection.js scoreKey).
    const keys = Object.keys(startsLoud.budgets);
    assert.strictEqual(keys.length, 1);
    const [key] = keys;
    assert.strictEqual(startsLoud.budgets[key].openingEnd, 0);

    // A silent phrase reports the loudness of the song, and it is not the first loud one.
    const silence = analyse(loud({ energy: (t) => (t < 8000 ? 0 : t < 16000 ? 0.2 : 0.8) }));
    phraseBudget(silence.phrases[0], silence, NORMAL);
    const end = silence.budgets[key].openingEnd;
    assert.ok(silence.phrases[end].startMs >= 8000, `the opening ends at phrase ${end}`);
  });

  it("a phrase wholly in the silence gets no budget", () => {
    const ctx = analyse(loud({ energy: (t) => (t >= 24000 && t < 40000 ? 0 : 0.8) }));
    const p = ctx.phrases.find((q) => q.startMs >= 24000 && q.endMs <= 40000);
    assert.ok(p, "a phrase in the silence");
    assert.strictEqual(phraseBudget(p, ctx, NORMAL), 0);
  });
});

describe("what Normal still guarantees", () => {
  // The limits v26 kept, on the public Normal, over a song with every layer and over one with the frequency bands alone
  // (makeFeatures has no drums, bass or lead). A property that fails is a bug of the chart, not a number to widen.
  const songs = {
    layered: layered({ durationMs: 192000, energy: () => 0.75 }),
    "layered with holds": layered({ durationMs: 192000, holdsEveryBeats: 4, sustainAtBeats: [6, 22], energy: () => 0.85 }),
    "bands only": makeFeatures({ bpm: 120, durationMs: 120000, energy: () => 0.8 }),
  };
  for (const [name, features] of Object.entries(songs)) {
    describe(name, () => {
      const notes = generateChart(features, "normal", KEY).notes;
      const moments = new Map();
      for (const n of notes) moments.set(n.t, (moments.get(n.t) ?? 0) + 1);

      it("has chords on at most maxChordShare of its moments, two notes each", () => {
        const chords = [...moments.values()].filter((c) => c > 1).length;
        assert.ok(chords / moments.size <= NORMAL.maxChordShare + 1e-9, `${chords} of ${moments.size}`);
        assert.ok([...moments.values()].every((c) => c <= 2));
      });

      it("keeps minLaneGapMs on a lane and a jack of at most maxJack", () => {
        const last = [-Infinity, -Infinity, -Infinity, -Infinity];
        const run = [0, 0, 0, 0];
        for (const n of notes) {
          assert.ok(n.t - last[n.lane] >= NORMAL.minLaneGapMs, `lane ${n.lane} at ${n.t}`);
          for (let l = 0; l < 4; l++) run[l] = l === n.lane ? run[l] + 1 : 0;
          assert.ok(run[n.lane] <= NORMAL.maxJack, `a jack of ${run[n.lane]} at ${n.t}`);
          last[n.lane] = n.t;
        }
      });

      it("has at most two holds running and no note on a lane while it is held", () => {
        // holds.js freeLength: a second hold takes the other hand, a third has none
        const ends = [];
        for (const h of notes.filter((n) => n.len > 0)) {
          const running = ends.filter((e) => e > h.t);
          assert.ok(running.length < 2, `a hold at ${h.t} under two others`);
          ends.splice(0, ends.length, ...running, h.t + h.len);
          assert.ok(!notes.some((n) => n !== h && n.lane === h.lane && n.t > h.t && n.t < h.t + h.len), `a note on the held lane ${h.lane} at ${h.t}`);
        }
      });
    });
  }

  it("the song with holds has holds to test", () => {
    assert.ok(generateChart(songs["layered with holds"], "normal", KEY).notes.some((n) => n.len > 0));
  });
});

describe("the repeats of Normal", () => {
  // Eight phrases of 8 s, ABAB: phrase 3 plays phrase 1 again, 16 s later. Phrase 3 is as loud as the rest unless told otherwise.
  const QUIET = 0.4;
  const song = (repeatEnergy = QUIET) => layered({ energy: (ms) => (ms >= 24000 && ms < 32000 ? repeatEnergy : QUIET) });
  const momentsIn = (notes, p) => [...new Set(notes.filter((n) => n.t >= p.startMs && n.t < p.endMs).map((n) => n.t))].sort((a, b) => a - b);

  // What these test is the plan against Normal's own budget: the floor under Easy lifts that budget, and the mini rests
  // (bridges.js) fill the rests of source and repeat alike after the plan; both have their own tests.
  const { notBelow, restBridge } = DIFFICULTIES.normal;
  beforeEach(() => {
    delete DIFFICULTIES.normal.notBelow;
    delete DIFFICULTIES.normal.restBridge;
  });
  afterEach(() => {
    DIFFICULTIES.normal.notBelow = notBelow;
    DIFFICULTIES.normal.restBridge = restBridge;
  });

  it("same loudness copies rhythm and lanes", () => {
    const features = song();
    const ctx = analyse(features);
    const [source, repeat] = [ctx.phrases[1], ctx.phrases[3]];
    assert.strictEqual(repeat.repeatOf, 1);
    assert.deepStrictEqual(repeatPlan(repeat, source, ctx, NORMAL), { copy: true, extra: 0 });

    const story = traceChart(features, "normal", KEY);
    assert.strictEqual(story.phrases[3].charted, "copy");
    // The rhythm is the source's, moment for moment, nothing added and nothing lost.
    const lag = repeat.startMs - source.startMs;
    assert.deepStrictEqual(momentsIn(story.chart.notes, repeat), momentsIn(story.chart.notes, source).map((t) => t + lag));
    // Every note of the repeat remembers the note of the source it copies (the lanes are laid over them by lanes.js, which echoes the source's).
    const copies = story.records.filter((r) => r.kind === "copy" && r.phrase === 3 && r.final);
    assert.ok(copies.length >= 10);
    assert.ok(copies.every((r) => r.copyOf !== null && r.copyOfT !== null));
  });

  it("a louder repeat adds notes above the copy", () => {
    const features = song(0.48);
    const ctx = analyse(features);
    const [source, repeat] = [ctx.phrases[1], ctx.phrases[3]];
    const plan = repeatPlan(repeat, source, ctx, NORMAL);
    assert.strictEqual(plan.copy, true);
    assert.ok(plan.extra >= 1, `extra ${plan.extra}`);

    const story = traceChart(features, "normal", KEY);
    assert.strictEqual(story.phrases[3].charted, "copy");
    const lag = repeat.startMs - source.startMs;
    const own = momentsIn(story.chart.notes, source);
    const played = momentsIn(story.chart.notes, repeat);
    // Everything the source plays comes again, and the extra moments are on top of it, within the repeat's budget.
    for (const t of own) assert.ok(played.includes(t + lag), `the source's ${t} comes again`);
    assert.ok(played.length > own.length);
    assert.ok(played.length <= phraseBudget(repeat, ctx, NORMAL), `${played.length} of ${phraseBudget(repeat, ctx, NORMAL)}`);
    assert.ok(played.length <= Math.ceil(own.length * 1.3), `${played.length} against ${own.length}`);
    // The extras come from the ranking and keep Normal's gap.
    const added = played.filter((t) => !own.map((o) => o + lag).includes(t));
    const ranked = story.records.filter((r) => r.kind === "event" && r.phrase === 3 && r.final);
    assert.deepStrictEqual(ranked.map((r) => r.from.t).sort((a, b) => a - b), added);
    assert.ok(ranked.every((r) => r.reason === "ocena"));
    for (let i = 1; i < played.length; i++) assert.ok(played[i] - played[i - 1] >= NORMAL.minNoteGapMs);
  });

  it("a sparse phrase is not copied onto a loud section", () => {
    const features = song(0.95);
    const ctx = analyse(features);
    const [source, repeat] = [ctx.phrases[1], ctx.phrases[3]];
    assert.deepStrictEqual(repeatPlan(repeat, source, ctx, NORMAL), { copy: false, extra: 0 });

    const story = traceChart(features, "normal", KEY);
    assert.strictEqual(story.phrases[3].charted, "music");
    // Charted fresh it is as full as the music is loud, not the thin copy of a quiet source.
    const played = momentsIn(story.chart.notes, repeat).length;
    assert.ok(played > momentsIn(story.chart.notes, source).length * 1.5, `${played} moments`);
    assert.ok(played <= phraseBudget(repeat, ctx, NORMAL));
  });

  it("a quieter repeat and a phrase that is no repeat get no extra", () => {
    const ctx = analyse(song(0.3));
    assert.deepStrictEqual(repeatPlan(ctx.phrases[3], ctx.phrases[1], ctx, NORMAL), { copy: true, extra: 0 });
    assert.deepStrictEqual(repeatPlan(ctx.phrases[4], ctx.phrases[0], ctx, NORMAL), { copy: true, extra: 0 });
  });

  it("the other levels copy their repeats as before", () => {
    const ctx = analyse(song(0.95));
    for (const level of ["easy", "hard", "hell"]) {
      assert.deepStrictEqual(repeatPlan(ctx.phrases[3], ctx.phrases[1], ctx, levelOf(level)), { copy: true, extra: 0 }, level);
    }
  });
});

describe("Normal's notes sit on the grid", () => {
  // Every onset of the music moved off the grid by up to 20 ms, as real onsets are: the candidates are off the grid, the chart's notes must not be.
  const loose = (features) => {
    const out = structuredClone(features);
    let i = 0;
    const move = (e) => ({ ...e, t: e.t + ((i++ * 7) % 41) - 20 });
    out.bands = out.bands.map((band) => ({ ...band, onsets: band.onsets.map(move) }));
    for (const layer of ["drums", "bass", "lead"]) if (out[layer]) out[layer] = out[layer].map(move);
    return out;
  };
  const rawTimes = (features) => new Set([...features.bands.flatMap((b) => b.onsets), ...["drums", "bass", "lead"].flatMap((l) => features[l] ?? [])].map((o) => o.t));
  const distance = (points, t) => Math.min(...points.filter((p) => Math.abs(p - t) < 200).map((p) => Math.abs(p - t)));
  const TIGHT_MS = 1.5; // the rounding of the grid points and of the shifted copies, not a window for the onsets

  const songs = {
    layered: loose(layered({ durationMs: 192000, energy: () => 0.75 })),
    "layered with a louder repeat": loose(layered({ energy: (ms) => (ms >= 24000 && ms < 32000 ? 0.48 : 0.4) })),
    "a sparse source on a loud section": loose(layered({ energy: (ms) => (ms >= 24000 && ms < 32000 ? 0.95 : 0.4) })),
    "bands only": loose(makeFeatures({ bpm: 120, durationMs: 120000, energy: () => 0.8 })),
    "an odd tempo": loose(layered({ bpm: 137, durationMs: 96000, energy: () => 0.7 })),
  };
  for (const [name, features] of Object.entries(songs)) {
    it(`with a trusted grid every note of ${name} is on it`, () => {
      const ctx = analyse(features);
      assert.strictEqual(ctx.timing.snapped, true);
      const grid = ctx.timing.gridPoints(4);
      // The test has something to move: the music itself is off the grid.
      const raw = [...rawTimes(features)].filter((t) => t > LEAD_IN_MS);
      assert.ok(raw.filter((t) => distance(grid, t) > 5).length > raw.length / 2);

      const chart = generateChart(features, "normal", KEY);
      assert.ok(chart.notes.length > 50);
      const off = chart.notes.filter((n) => distance(grid, n.t) > TIGHT_MS);
      assert.deepStrictEqual(off.slice(0, 5).map((n) => [n.t, distance(grid, n.t)]), [], `${off.length} of ${chart.notes.length} notes off the grid`);
    });
  }

  it("the louder repeat's extra notes and the seam fill are on the grid too", () => {
    const features = songs["layered with a louder repeat"];
    const story = traceChart(features, "normal", KEY);
    const grid = analyse(features).timing.gridPoints(4);
    const picked = story.records.filter((r) => r.kind === "event" && r.final);
    assert.ok(picked.some((r) => r.phrase === 3 && r.reason === "ocena"), "the repeat has extra notes");
    for (const r of picked) assert.ok(distance(grid, r.from.t) <= TIGHT_MS, `${r.reason} at ${r.from.t}`);
  });

  it("two candidates for one grid time leave the higher score; one too far from the grid is not a moment", () => {
    const features = makeFeatures({ bpm: 120, durationMs: 20000 });
    const g = 5000; // a beat of the grid, 125 ms between its quarter beats
    features.bands = features.bands.map((band, b) => ({
      name: band.name,
      onsets: [
        // the filler the strengths are ranked against
        ...Array.from({ length: 60 }, (_, i) => ({ t: 3000 + i * 250, s: 0.3 + (i % 7) / 10 })).filter(() => b === 0),
        ...(b === 1 ? [{ t: g - 34, s: 0.4 }, { t: g + 1, s: 0.9 }] : []), // 35 ms apart: two candidates, one grid time
        ...(b === 2 ? [{ t: g + 125 + 62, s: 0.9 }] : []), // 62 ms from the nearest grid point: no grid time
      ],
    }));
    const ctx = analyse(features);
    const raw = scoreMoments(ctx, "normal");
    const snapped = snappedMoments(ctx, "normal");
    const grid = ctx.timing.gridPoints(4);

    const pair = raw.filter((m) => m.t === g - 34 || m.t === g + 1);
    assert.strictEqual(pair.length, 2);
    const kept = snapped.filter((m) => m.t === g);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(kept[0].raw, g + 1);
    assert.strictEqual(kept[0].score, Math.max(...pair.map((m) => m.score)));
    assert.strictEqual(kept[0].s, 0.9);
    assert.ok(!snapped.some((m) => m.raw === g - 34));
    assert.ok(!snapped.some((m) => m.raw === g + 125 + 62), "too far to snap");
    assert.ok(snapped.every((m) => grid.includes(m.t) && Math.abs(m.t - m.raw) <= 35));
    assert.ok(snapped.every((m, i) => i === 0 || snapped[i - 1].t < m.t));
  });

  it("a stretch with no beats keeps its moments at the time of the music, the rest sits on the grid", () => {
    const features = loose(layered({ durationMs: 192000, energy: () => 0.75 }));
    features.tempo.beats = features.tempo.beats.filter((t) => t < 60000 || t >= 120000);
    features.tempo.downbeats = features.tempo.downbeats.filter((t) => t < 60000 || t >= 120000);
    const ctx = analyse(features);
    const grid = ctx.timing.gridPoints(4);
    const snapped = snappedMoments(ctx, "normal");
    const inGap = snapped.filter((m) => m.t >= 66000 && m.t < 114000);
    assert.ok(inGap.length > 50, "the stretch is not emptied");
    assert.ok(inGap.every((m) => m.raw === undefined), "its moments are not moved");
    const outside = snapped.filter((m) => m.t < 54000 || m.t >= 126000);
    assert.ok(outside.length > 100);
    assert.ok(outside.every((m) => distance(grid, m.t) <= TIGHT_MS), "the rest sits on the grid");
  });

  it("without a trusted grid the notes keep the time of the music", () => {
    const features = loose(makeFeatures({ confidence: 0.1, durationMs: 120000, energy: threeSectionEnergy }));
    const ctx = analyse(features);
    assert.strictEqual(ctx.timing.snapped, false);
    assert.deepStrictEqual(snappedMoments(ctx, "normal"), scoreMoments(ctx, "normal"));

    const raw = rawTimes(features);
    const notes = generateChart(features, "normal", KEY).notes;
    assert.ok(notes.length > 50);
    assert.ok(notes.every((n) => raw.has(n.t)), "every note is on an onset");
    assert.ok(notes.some((n) => n.t % 125 !== 0), "and not moved");
  });
});
