const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, LEAD_IN_MS, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { generateChart, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { limitHoldShare } = require("../../../helpers/mewbeat/charts/holds");
const { BUDGET } = require("../../../helpers/mewbeat/charts/momentWeights");
const { LEGATO_MAX_GAP_MS, mergeLegato, withMergedLead } = require("../../../helpers/mewbeat/charts/legato");
const { buildPhrases, chooseLeaders, hasSteadyPulse } = require("../../../helpers/mewbeat/charts/phrases");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeLayeredFeatures } = require("./fixtures");

const LEVEL_V26 = levelOf("normalV26");
const LEVEL_EASY_V26 = levelOf("easyV26");

const BEAT_MS = 500; // the fixtures play at 120 BPM
const PHRASE_BEATS = 16;
const PHRASES = 8; // in a 64 s fixture

const phrasesOf = (features) => buildPhrases(features, buildTiming(features, features.durationMs), features.durationMs);

// A quiet song whose only rhythm is faint kicks (instrumental: no lead line to sing along with).
function softKicks() {
  const features = makeLayeredFeatures({ structure: "ABAB", bass: false, lead: false, energy: () => 0.15 });
  features.drums = features.drums.map((d) => ({ ...d, s: 0.2 }));
  for (const p of features.phrases.list) p.activity.drums = 0.1;
  return features;
}

// A quiet pad: a held bass note, no drums and no low-band onsets, so nothing carries a beat.
function quietPad() {
  const features = makeLayeredFeatures({ structure: "ABAB", drums: false, lead: false, energy: () => 0.15 });
  features.bands[0].onsets = [];
  return features;
}

describe("quiet rhythmic passages", () => {
  it("a steady soft kick pattern leads an instrumental song", () => {
    const phrases = phrasesOf(softKicks());
    assert.ok(phrases.every(hasSteadyPulse), phrases.map((p) => p.pulse).join());
    assert.deepEqual(chooseLeaders(phrases), Array(phrases.length).fill("drums"));
  });

  // A mapper of Easy keeps 62% of the beats where the music is quiet (REPORT, F2).
  it("gets about a note per beat on Normal and the quiet share of that on Easy", () => {
    const features = softKicks();
    const phrases = phrasesOf(features);
    const perPhrase = (chart) => chart.notes.length / phrases.length;
    assert.ok(perPhrase(generateChart(features, "normal", "k")) >= PHRASE_BEATS * LEVEL_V26.pulseNotesPerBeat);
    // Since v44 Easy is cut from Normal (keepShare), so the pulse rule it was written for is asserted on easyV26, the Easy
    // that was charted on its own; the public Easy is a subset of Normal.
    assert.ok(perPhrase(generateChart(features, "easyV26", "k")) >= PHRASE_BEATS * LEVEL_EASY_V26.pulseNotesPerBeat * LEVEL_EASY_V26.quietBeats);
  });

  it("a quiet pad with no pulse stays sparse", () => {
    const features = quietPad();
    const phrases = phrasesOf(features);
    assert.ok(phrases.every((p) => !hasSteadyPulse(p)));
    // Normal picks from what sounds: no note is played for a pulse the music does not have. The budget is song-relative
    // (the quiet pad is the whole song), so what bounds the moments is the sound: the pad has little of it, and its rate
    // stays well under what a median song gets (BUDGET.medianRate, moments per second).
    const story = traceChart(features, "normal", "k");
    assert.ok(!story.records.some((r) => r.reason === "puls"));
    const moments = new Set(story.chart.notes.map((n) => n.t)).size;
    const seconds = (features.durationMs - LEAD_IN_MS) / 1000;
    assert.ok(moments > 0);
    assert.ok(moments / seconds < 0.5 * BUDGET.medianRate, `${(moments / seconds).toFixed(2)} moments/s against a median of ${BUDGET.medianRate}`);
  });

  it("a sung line keeps its lead even with a pulse under it", () => {
    // Fast, confident lead notes make the song vocal: the soft-drum lift does not apply, the lead stays in front.
    const features = makeLayeredFeatures({ structure: "ABAB", bass: false, energy: () => 0.3 });
    const phrases = phrasesOf(features);
    assert.ok(phrases.every(hasSteadyPulse));
    assert.deepEqual(chooseLeaders(phrases), Array(phrases.length).fill("lead"));
  });
});

describe("mergeLegato", () => {
  const note = (t, len, pitch, extra = {}) => ({ t, len, pitch, conf: 0.9, s: 0.7, ...extra });

  it("joins fragments of one held pitch into a single note", () => {
    const merged = mergeLegato([note(1000, 200, 60, { conf: 0.8 }), note(1200 + LEGATO_MAX_GAP_MS, 300, 60.4, { conf: 1, s: 0.9 })]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].t, 1000);
    assert.equal(merged[0].len, 560);
    assert.equal(merged[0].pitch, 60);
    assert.ok(Math.abs(merged[0].conf - 0.9) < 1e-9);
    assert.equal(merged[0].s, 0.9);
  });

  it("keeps notes apart across a gap or a pitch jump of more than a semitone", () => {
    assert.equal(mergeLegato([note(1000, 200, 60), note(1200 + LEGATO_MAX_GAP_MS + 1, 300, 60)]).length, 2);
    assert.equal(mergeLegato([note(1000, 200, 60), note(1200, 300, 62)]).length, 2);
  });

  it("does not let a slow drift chain into a run wider than a semitone", () => {
    const out = mergeLegato([note(1000, 100, 60), note(1100, 100, 60.6), note(1200, 100, 61.2)]);
    assert.deepEqual(out.map((n) => n.t), [1000, 1200]);
  });

  it("returns lines it cannot read unchanged and merges only the lead", () => {
    const odd = [{ t: 1 }, { t: 2 }];
    assert.equal(mergeLegato(odd), odd);
    const features = { lead: [note(0, 100, 60), note(100, 100, 60)], bass: [note(0, 100, 40), note(100, 100, 40)] };
    const out = withMergedLead(features);
    assert.equal(out.lead.length, 1);
    assert.equal(out.bass, features.bass);
  });
});

describe("holds on sustained notes of a non-leader layer", () => {
  // Drums lead; a long bass note sits between the kicks (beat 4.5 of each phrase, 3 beats long).
  function withBassNote(overrides = {}) {
    const features = makeLayeredFeatures({ structure: "BBBB", bass: false, lead: false });
    features.bass = Array.from({ length: PHRASES }, (_, i) => i).map((i) => ({ t: i * PHRASE_BEATS * BEAT_MS + 4.5 * BEAT_MS, len: 3 * BEAT_MS, pitch: 40, conf: 1, s: 0.9, ...overrides }));
    return features;
  }
  const holdsOf = (chart) => chart.notes.filter((n) => n.len > 0);

  it("a long, confident bass note under a drum leader becomes a hold", () => {
    const features = withBassNote();
    assert.deepEqual(chooseLeaders(phrasesOf(features)), Array(PHRASES).fill("drums"));
    // On hardBase (the Hard from before v44; the public Hard is built on Normal and has its own holds): Normal's other hand
    // plays too much under this one, and a hold that short stays empty (settleHolds).
    const holds = holdsOf(generateChart(features, "hardBase", "k"));
    for (let phrase = 0; phrase < PHRASES; phrase++) {
      const t = phrase * PHRASE_BEATS * BEAT_MS + 4.5 * BEAT_MS;
      assert.ok(holds.some((h) => h.t === t && h.len >= BEAT_MS), `a hold at ${t}`);
    }
  });

  it("a short or unsure bass note stays out", () => {
    // Without the floor under Easy: its extra notes bring holds of their own into the gaps, none of them this note's. And
    // without the felt tempo (from v42 under 145 BPM): on half beats the gap after the note's moment is held as a gap.
    const { notBelow, feltTempo } = DIFFICULTIES.normal;
    delete DIFFICULTIES.normal.notBelow;
    delete DIFFICULTIES.normal.feltTempo;
    try {
      for (const weak of [{ len: BEAT_MS }, { conf: 0.6 }]) {
        assert.equal(holdsOf(generateChart(withBassNote(weak), "normal", "k")).length, 0, JSON.stringify(weak));
      }
    } finally {
      Object.assign(DIFFICULTIES.normal, { notBelow, feltTempo });
    }
  });

  it("a note that starts on a drum hit holds the drum's note", () => {
    const features = withBassNote();
    features.bass = features.bass.map((n) => ({ ...n, t: n.t + BEAT_MS / 2 })); // on the next beat, where a kick falls
    const holds = holdsOf(generateChart(features, "hard", "k"));
    assert.ok(holds.length > 0);
    assert.ok(holds.every((h) => features.bass.some((n) => Math.abs(n.t - h.t) <= 40)), JSON.stringify(holds));
  });

  // The lane search lets a hold go early for a note on its own hand, down to half a beat (laneSearch.js clipRelease). On the
  // train songs that moves Normal's short holds towards people's: under .89 of a beat they are 45 %, it 30 %, without it 0 %.
  it("no hold is shorter than half a beat, on Hard than the shortest it may be", () => {
    const songs = [
      withBassNote(),
      makeLayeredFeatures({ sustainAtBeats: [6], drums: false, durationMs: 128000 }),
      makeLayeredFeatures({ holdsEveryBeats: 2, drums: false }),
      makeLayeredFeatures({ energy: () => 0.85 }),
    ];
    for (const features of songs) {
      for (const d of ["easy", "normal", "hard"]) {
        const shortest = (d === "hard" ? Math.min(BEAT_MS / 2, DIFFICULTIES.hard.shortestHoldMaxMs) : BEAT_MS / 2) * 0.89;
        for (const h of holdsOf(generateChart(features, d, "k"))) assert.ok(h.len >= shortest, `${d}: ${h.len} at ${h.t}`);
      }
    }
  });
});

describe("limitHoldShare", () => {
  const taps = (n) => Array.from({ length: n }, (_, i) => ({ t: i * 500, lane: i % 4 }));

  it("turns the shortest holds into taps until at most 12 % of the notes are held", () => {
    const notes = taps(100).map((n, i) => (i < 16 ? { ...n, len: 500 + i * 10 } : n));
    const out = limitHoldShare(notes);
    const held = out.filter((n) => n.len > 0);
    assert.equal(held.length, 12);
    assert.deepEqual(held.map((n) => n.t), Array.from({ length: 12 }, (_, k) => (k + 4) * 500)); // the longest stay
    assert.ok(out.every((n) => n.len === undefined || n.len > 0));
    assert.ok(out.slice(0, 4).every((n) => !("len" in n)), "a demoted hold has no len key at all");
  });

  it("leaves a chart under the share alone", () => {
    const notes = taps(100).map((n, i) => (i < 12 ? { ...n, len: 600 } : n));
    assert.equal(limitHoldShare(notes), notes);
  });
});
