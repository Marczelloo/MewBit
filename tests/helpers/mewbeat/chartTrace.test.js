const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateChart, traceChart } = require("../../../helpers/mewbeat/charts/generate");

// A steady song with drums on every beat, a bass line and a long sung note. Without phrases it is charted by the
// band path, with them phrase by phrase; fast enough, Easy has to throw notes out.
function song({ beatMs = 500, phrased = false } = {}) {
  const durationMs = 60000;
  const beats = [];
  for (let t = 1000; t < durationMs; t += beatMs) beats.push(t);
  const phraseMs = beatMs * 16;
  const list = [];
  for (let t = 0; phrased && t < durationMs; t += phraseMs) {
    list.push({ startMs: t, endMs: Math.min(t + phraseMs, durationMs), repeatOf: null, similarity: 0, lagMs: 0, activity: 0.8, confidence: { drums: 0.9, bass: 0.8, lead: 0.8 } });
  }
  const onsets = (step, s) => beats.filter((_, i) => i % step === 0).map((t) => ({ t, s }));
  return {
    featuresVersion: 3,
    durationMs,
    hopMs: 10,
    bands: [
      { name: "low", onsets: onsets(2, 0.8) },
      { name: "lowMid", onsets: onsets(1, 0.5) },
      { name: "highMid", onsets: onsets(4, 0.4) },
      { name: "high", onsets: beats.map((t) => ({ t: t + 125, s: 0.3 })) },
    ],
    tempo: { bpm: 60000 / beatMs, confidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0) },
    energy: { hopMs: 500, values: new Array(120).fill(0.7) },
    sections: [{ startMs: 0, endMs: durationMs, energy: 0.7 }],
    highlightMs: 20000,
    analysisTier: "full",
    drums: beats.flatMap((t, i) => [{ t, s: 0.8, kind: i % 2 ? "snare" : "kick" }, { t: t + 250, s: 0.3, kind: "hat" }]),
    bass: beats.filter((_, i) => i % 2 === 0).map((t) => ({ t, len: 400, pitch: 40, s: 0.7, conf: 0.8 })),
    lead: beats.filter((_, i) => i % 8 === 0).map((t) => ({ t, len: 1500, pitch: 60, s: 0.7, conf: 0.8 })),
    phrases: { beatsPerPhrase: 16, list },
  };
}

const SONGS = { "band path": {}, phrases: { beatMs: 300, phrased: true } };

describe("traceChart", () => {
  for (const level of Object.keys(DIFFICULTIES)) {
    for (const [name, shape] of Object.entries(SONGS)) {
      it(`${level}, ${name}: tells the story of the very chart generateChart makes`, () => {
        const features = song(shape);
        const plain = generateChart(features, level, "key");
        const story = traceChart(features, level, "key");
        assert.deepEqual(story.chart, plain);
        const notes = story.notes.map(({ id, ...n }) => n);
        assert.deepEqual(notes, plain.notes);
      });

      it(`${level}, ${name}: every note has an origin, every candidate an end`, () => {
        const story = traceChart(song(shape), level, "key");
        const final = new Set(story.notes.map((n) => n.id));
        assert.equal(final.size, story.notes.length);
        for (const record of story.records) {
          assert.equal(record.final, final.has(record.id));
          assert.ok(record.final || record.rejected?.stage, `record ${record.id} (${record.kind}) vanished without a stage`);
        }
      });
    }
  }

  it("names the rule that threw a note out", () => {
    const rejected = traceChart(song(SONGS.phrases), "easy", "key").records.filter((r) => r.rejected?.stage === "floors");
    assert.ok(rejected.length > 0);
    for (const r of rejected) assert.match(r.rejected.why.rule, /^(noteGap|beatGap|laneGap|sameSpot|fastRun|density)$/);
  });
});
