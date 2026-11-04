const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { GENERATOR_VERSION, analyse, generateChart, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { phraseBudget, scoreMoments, selectMoments } = require("../../../helpers/mewbeat/charts/selection");
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

  it("a stronger moment beats a weaker one on the same beat level", () => {
    const scored = scoreMoments(analyse(layered()), "normal");
    for (const metric of [0, 1, 2]) {
      const level = scored.filter((m) => m.metric === metric && m.down === 0).sort((a, b) => a.s - b.s);
      assert.ok(level.length > 5, `moments on metric ${metric}`);
      // Within a beat level the score rises with the strength (ranked within the song, so ties share a score).
      for (let i = 1; i < level.length; i++) assert.ok(level[i].s === level[i - 1].s || level[i].score >= level[i - 1].score - 1e-9 || level[i].t !== level[i - 1].t);
      const weakest = level[0];
      const strongest = level[level.length - 1];
      assert.ok(strongest.score > weakest.score, `metric ${metric}`);
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
      assert.strictEqual(GENERATOR_VERSION, 27);
      assert.strictEqual(store.peekCharts(track), null);
      const { charts } = await store.getCharts(track, "node");

      assert.strictEqual(charts.normal.version, 27);
      assert.ok(charts.normal.notes.length > 1);
      assert.ok(fs.existsSync(file(27)));
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
    const ctx = analyse(raw.features ?? raw);
    const scored = scoreMoments(ctx, "normal");

    assert.strictEqual(scored.length, vector.n_candidates);
    for (const c of vector.candidates) {
      assert.ok(Math.abs(scored[c.index].t - c.t_ms) <= 1, `candidate ${c.index} time`);
      assert.ok(Math.abs(scored[c.index].score - c.score.normal) < 1e-3, `candidate ${c.index}: ${scored[c.index].score} vs ${c.score.normal}`);
    }
  });
});
