const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { fitBeats, withFittedBeats } = require("../../../helpers/mewbeat/charts/beatFit");
const { analyse, generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { chartMetrics } = require("../../../helpers/mewbeat/charts/metrics");
const { makeFeatures, makeLayeredFeatures, threeSectionEnergy } = require("./fixtures");

const WOBBLE_MS = [0, 11, -7, 15, -13, 4, -9, 12];

// A song whose onsets lie on true beats, with a tracker that stands `trackerOff` of a beat away and wobbles: highmid on
// the beats, the other bands on the beats and every quarter of a beat, in a rhythm that repeats.
function song({ bpm = 120, durationMs = 120000, firstBeat = 250, trackerOff = 0.5, confidence = 0.8, beatAt = null } = {}) {
  const beatMs = 60000 / bpm;
  const at = beatAt ?? ((i) => firstBeat + i * beatMs);
  const bands = ["low", "lowmid", "highmid", "high"].map((name) => ({ name, onsets: [] }));
  const beats = [];
  const downbeats = [];
  for (let i = 0; at(i) < durationMs; i++) {
    const t = Math.round(at(i));
    bands[2].onsets.push({ t, s: i % 4 === 0 ? 1 : 0.8 });
    bands[i % 2 === 0 ? 0 : 1].onsets.push({ t, s: 0.9 });
    bands[3].onsets.push({ t: Math.round(t + beatMs / 2), s: 0.5 }, { t: Math.round(t + beatMs / 4), s: 0.3 });
    bands[1].onsets.push({ t: Math.round(t + (3 * beatMs) / 4), s: 0.3 });
    const tracked = Math.round(at(i) + trackerOff * beatMs + WOBBLE_MS[i % WOBBLE_MS.length]);
    beats.push(tracked);
    if (i % 4 === 0) downbeats.push(tracked);
  }
  for (const band of bands) band.onsets.sort((a, b) => a.t - b.t);
  return {
    featuresVersion: 1,
    durationMs,
    hopMs: 10,
    bands,
    tempo: { bpm, confidence, beats, downbeats },
    energy: { hopMs: 500, values: new Array(Math.ceil(durationMs / 500)).fill(0.6) },
    sections: [],
    highlightMs: 30000,
  };
}

const nearest = (list, t) => list.reduce((best, x) => Math.min(best, Math.abs(x - t)), Infinity);
const gaps = (beats) => beats.slice(1).map((t, i) => t - beats[i]);

describe("the fitted beats", () => {
  it("puts a tracker half a beat out back on the beat", () => {
    const f = song({ trackerOff: 0.5 });
    const onBeat = f.bands[2].onsets.map((o) => o.t);
    assert.ok(f.tempo.beats.every((t) => nearest(onBeat, t) > 200), "the tracker stands off the beat here");
    const { beats } = fitBeats(f);
    for (const t of onBeat) assert.ok(nearest(beats, t) <= 4, `no fitted beat at ${t}`);
  });

  it("keeps a thin opening on its own sound when it stands off the long part's grid", () => {
    const bpm = 171, beatMs = 60000 / bpm, introBeats = 57;
    const f = song({ bpm, trackerOff: 0, beatAt: (i) => 250 + i * beatMs + (i < introBeats ? -38 : 0) });
    const introEnd = 250 + introBeats * beatMs;
    f.bands.forEach((band, b) => {
      band.onsets = band.onsets.filter((o) => o.t >= introEnd - 38 || (b === 2 && Math.round((o.t - 212) / beatMs) % 2 === 0));
    });
    const intro = f.bands[2].onsets.filter((o) => o.t < introEnd - 38).map((o) => o.t);
    const { beats } = fitBeats(f);
    const off = intro.filter((t) => nearest(beats, t) > 12);
    assert.ok(off.length <= 1, `${off.length} of ${intro.length} opening onsets have no fitted beat within 12 ms`); // the one next to the seam may go
  });

  it("takes the wobble out: equal gaps stay equal to the millisecond", () => {
    const f = song({ trackerOff: 0 });
    assert.ok(Math.max(...gaps(f.tempo.beats)) - Math.min(...gaps(f.tempo.beats)) > 20, "the tracker wobbles here");
    const fitted = gaps(fitBeats(f).beats);
    assert.ok(Math.max(...fitted) - Math.min(...fitted) <= 1, `gaps from ${Math.min(...fitted)} to ${Math.max(...fitted)}`);
  });

  it("gives whole milliseconds, and downbeats among the beats, in the tracker's bar", () => {
    const f = song({ trackerOff: 0 });
    const { beats, downbeats } = fitBeats(f);
    assert.ok(beats.every(Number.isInteger));
    assert.ok(downbeats.length > 0);
    assert.strictEqual(new Set(downbeats.map((t) => beats.indexOf(t) % 4)).size, 1);
    assert.ok(!downbeats.some((t) => beats.indexOf(t) < 0));
    for (const t of downbeats.slice(1, -1)) assert.ok(nearest(f.tempo.downbeats, t) <= 20, `downbeat ${t}`);
  });

  it("follows a change of tempo", () => {
    const change = 120; // 500 ms a beat up to here, 400 after it
    const beatAt = (i) => 250 + (i < change ? i * 500 : change * 500 + (i - change) * 400);
    const { beats } = fitBeats(song({ trackerOff: 0, beatAt }));
    const gapAt = (t) => {
      const i = beats.findIndex((b) => b >= t);
      return beats[i + 1] - beats[i];
    };
    for (const t of [20000, 40000]) assert.ok(Math.abs(gapAt(t) - 500) <= 2, `${gapAt(t)} at ${t}`);
    for (const t of [80000, 100000]) assert.ok(Math.abs(gapAt(t) - 400) <= 2, `${gapAt(t)} at ${t}`);
  });

  it("follows a phase step at one tempo", () => {
    const beatAt = (i) => 250 + i * 500 + (i >= 120 ? 60 : 0); // the song slips by 60 ms halfway
    const { beats } = fitBeats(song({ trackerOff: 0, beatAt }));
    for (const i of [20, 60, 180, 220]) assert.ok(nearest(beats, Math.round(beatAt(i))) <= 3, `beat ${i}`);
  });

  it("gives the same grid every time", () => {
    assert.deepStrictEqual(fitBeats(song()), fitBeats(song()));
  });
});

describe("what the fit leaves alone", () => {
  it("the tracker's beats stand when the song gives too little", () => {
    const fewBeats = song();
    fewBeats.tempo.beats = fewBeats.tempo.beats.slice(0, 15);
    const noTempo = song();
    delete noTempo.tempo;
    const noOnsets = song();
    noOnsets.bands = noOnsets.bands.map((b) => ({ ...b, onsets: [] }));
    const fewOnsets = song();
    fewOnsets.bands = fewOnsets.bands.map((b) => ({ ...b, onsets: b.onsets.slice(0, 5) }));
    const noBeatBand = song();
    noBeatBand.bands[2] = { name: "highmid", onsets: [] };
    const noBands = song();
    delete noBands.bands;
    const noLength = song();
    noLength.durationMs = 0;
    for (const f of [fewBeats, noTempo, noOnsets, fewOnsets, noBeatBand, noBands, noLength]) {
      assert.strictEqual(fitBeats(f), null);
      assert.strictEqual(withFittedBeats(f), f);
    }
  });

  it("broken onsets are skipped", () => {
    const f = song();
    f.bands[0].onsets.push({ t: NaN, s: 1 }, { t: 5, s: undefined }, null);
    assert.deepStrictEqual(fitBeats(f), fitBeats(song()));
  });

  it("a grid already fitted stands, and the fit runs once", () => {
    const fixture = makeFeatures();
    assert.strictEqual(withFittedBeats(fixture), fixture);
    const once = withFittedBeats(song());
    assert.strictEqual(once.tempo.fitted, true);
    assert.strictEqual(withFittedBeats(once), once);
  });

  it("leaves the features it was given as they were", () => {
    const f = song();
    const before = JSON.stringify(f);
    const out = withFittedBeats(f);
    assert.notStrictEqual(out.tempo, f.tempo);
    assert.notDeepStrictEqual(out.tempo.beats, f.tempo.beats);
    generateChart(f, "normal", "youtube:fixture:120000");
    assert.strictEqual(JSON.stringify(f), before);
  });
});

describe("the generator on the fitted beats", () => {
  const layered = () => makeLayeredFeatures({ bpm: 120, durationMs: 96000, energy: threeSectionEnergy });
  // The onsets of the fixture with the tracker moved half a beat away from them, wobbling.
  const layeredOff = () => {
    const f = layered();
    const off = (t) => t + 250 + WOBBLE_MS[Math.round(t / 500) % WOBBLE_MS.length];
    const { fitted: _, ...tempo } = f.tempo;
    return { ...f, tempo: { ...tempo, beats: tempo.beats.map(off), downbeats: tempo.downbeats.map(off) } };
  };
  const onBeats = (chart, beats) => chart.notes.filter((n) => nearest(beats, n.t) <= 15).length / chart.notes.length;

  it("charts every level on the beats the music has", () => {
    const beats = layered().tempo.beats;
    for (const level of ["easy", "normal", "hard"]) {
      const f = layeredOff();
      const tracker = generateChart({ ...f, tempo: { ...f.tempo, fitted: true } }, level, "youtube:fixture:96000");
      const fitted = generateChart(f, level, "youtube:fixture:96000");
      assert.ok(onBeats(fitted, beats) > onBeats(tracker, beats) + 0.1, `${level}: ${onBeats(fitted, beats)} vs ${onBeats(tracker, beats)}`);
    }
  });

  it("the chart and its metrics stand on one grid", () => {
    const f = layeredOff();
    const chart = generateChart(f, "normal", "youtube:fixture:96000");
    assert.deepStrictEqual(chartMetrics(chart, f), chartMetrics(chart, withFittedBeats(f)));
    assert.deepStrictEqual(analyse(f).timing.beats, analyse(withFittedBeats(f)).timing.beats);
  });

  it("a doubted tracker's grid that was too irregular to trust is trusted once fitted", () => {
    const f = song({ confidence: 0.3, trackerOff: 0 });
    f.tempo.beats = f.tempo.beats.map((t, i) => t + (i % 2) * 90);
    assert.strictEqual(analyse({ ...f, tempo: { ...f.tempo, fitted: true } }).timing.snapped, false);
    assert.strictEqual(analyse(f).timing.snapped, true);
  });

  it("a tempo the tracker does not trust at all stays untrusted", () => {
    const f = song({ confidence: 0.1, trackerOff: 0 });
    assert.strictEqual(analyse(f).timing.snapped, false);
  });
});
