const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { REPEAT_SIMILARITY, TONAL_MIN_CONF, buildPhrases, chooseLeaders } = require("../../../helpers/mewbeat/charts/phrases");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

function phrasesOf(features, durationMs = features.durationMs) {
  return buildPhrases(features, buildTiming(features, durationMs), durationMs);
}

// A phrase stub with only what chooseLeaders reads. Each layer is [activity, confidence].
function stub(lead, bass, drums, extra = {}) {
  return {
    activity: { drums: drums?.[0] ?? 0, bass: bass?.[0] ?? 0, lead: lead?.[0] ?? 0 },
    confidence: { drums: drums?.[1] ?? 0, bass: bass?.[1] ?? 0, lead: lead?.[1] ?? 0 },
    repeatOf: null,
    similarity: 0,
    sectionStart: false,
    ...extra,
  };
}

describe("constants", () => {
  it("exports the thresholds", () => {
    assert.equal(REPEAT_SIMILARITY, 0.85);
    assert.equal(TONAL_MIN_CONF, 0.45);
  });
});

describe("buildPhrases", () => {
  it("fallbackWindowsWhenNoPhrases: v1 data gives 16-beat windows with no repeats", () => {
    const features = makeFeatures({ bpm: 120, durationMs: 64000 });
    const phrases = phrasesOf(features);
    assert.equal(phrases.length, 8);
    phrases.forEach((p, i) => {
      assert.equal(p.index, i);
      assert.equal(p.startMs, i * 8000);
      assert.equal(p.endMs, (i + 1) * 8000);
      assert.equal(p.repeatOf, null);
      assert.deepEqual(p.activity, { drums: 0, bass: 0, lead: 0 });
      assert.deepEqual(p.confidence, { drums: 0, bass: 0, lead: 0 });
      assert.equal(typeof p.energy, "number");
    });
  });

  it("uses 8000 ms windows without timing", () => {
    const features = makeFeatures({ confidence: 0.1, durationMs: 40000 });
    const phrases = phrasesOf(features);
    assert.deepEqual(
      phrases.map((p) => [p.startMs, p.endMs]),
      [0, 8000, 16000, 24000, 32000].map((s) => [s, s + 8000]),
    );
  });

  it("windows are counted in beats, whatever the tempo", () => {
    const features = makeFeatures({ bpm: 150, durationMs: 60000 });
    const phrases = phrasesOf(features);
    assert.equal(phrases[0].endMs - phrases[0].startMs, 6400);
    assert.equal(phrases[1].startMs, 6400);
    assert.equal(phrases.at(-1).endMs, 60000);
  });

  it("clips fallback windows to section boundaries and flags section starts", () => {
    const features = makeFeatures({ bpm: 120, durationMs: 32000 });
    features.sections = [
      { startMs: 0, endMs: 12000, energy: 0.3 },
      { startMs: 12000, endMs: 32000, energy: 0.9 },
    ];
    const phrases = phrasesOf(features);
    assert.deepEqual(
      phrases.map((p) => [p.startMs, p.endMs]),
      [
        [0, 8000],
        [8000, 12000],
        [12000, 16000],
        [16000, 24000],
        [24000, 32000],
      ],
    );
    assert.deepEqual(
      phrases.map((p) => p.sectionStart),
      [false, false, true, false, false],
    );
  });

  it("flags a section boundary within one beat of the start", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 32000 });
    features.sections = [
      { startMs: 0, endMs: 8400, energy: 0.3 },
      { startMs: 8400, endMs: 32000, energy: 0.9 },
    ];
    const phrases = phrasesOf(features);
    assert.deepEqual(
      phrases.map((p) => p.sectionStart),
      [false, true, false, false],
    );
  });

  it("energy is the mean energy over the phrase", () => {
    const features = makeFeatures({ bpm: 120, durationMs: 16000, energy: (ms) => (ms < 8000 ? 0.2 : 0.8) });
    const phrases = phrasesOf(features);
    assert.ok(Math.abs(phrases[0].energy - 0.2) < 1e-9);
    assert.ok(Math.abs(phrases[1].energy - 0.8) < 1e-9);
  });

  it("takes plugin phrases as they are", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 32000, structure: "ABAB" });
    const phrases = phrasesOf(features);
    assert.equal(phrases.length, 4);
    assert.equal(phrases[0].repeatOf, null);
    assert.equal(phrases[2].repeatOf, 0);
    assert.equal(phrases[3].repeatOf, 1);
    assert.equal(phrases[2].lagMs, 16000);
    assert.equal(phrases[2].similarity, 0.95);
    assert.deepEqual(phrases[0].activity, features.phrases.list[0].activity);
    assert.deepEqual(phrases[0].confidence, features.phrases.list[0].confidence);
  });

  it("the fixture's repeatOf is the earliest occurrence, lagMs measured from it", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 96000, structure: "AB" });
    const list = features.phrases.list;
    assert.equal(list[4].repeatOf, 0);
    assert.equal(list[4].lagMs, 4 * 8000);
    assert.equal(list[5].repeatOf, 1);
    assert.equal(list[5].lagMs, 4 * 8000);
  });

  it("fallback computes activity and confidence from drums/bass/lead", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 32000, structure: "AB" });
    delete features.phrases;
    const phrases = phrasesOf(features);
    assert.equal(phrases.length, 4);
    for (const p of phrases) {
      for (const layer of ["drums", "bass", "lead"]) {
        assert.ok(p.activity[layer] > 0 && p.activity[layer] <= 1, `${layer} activity ${p.activity[layer]}`);
        assert.ok(p.confidence[layer] > 0 && p.confidence[layer] <= 1, `${layer} confidence ${p.confidence[layer]}`);
      }
      assert.ok(Math.abs(p.confidence.lead - 0.9) < 1e-9);
      assert.ok(Math.abs(p.confidence.bass - 0.7) < 1e-9);
    }
    const only = makeLayeredFeatures({ bpm: 120, durationMs: 32000, structure: "A", bass: false, lead: false });
    delete only.phrases;
    const p = phrasesOf(only)[0];
    assert.ok(p.activity.drums > 0.5);
    assert.deepEqual([p.activity.bass, p.activity.lead], [0, 0]);
    assert.deepEqual([p.confidence.bass, p.confidence.lead], [0, 0]);
  });

  it("an empty phrase list falls back too", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 32000 });
    features.phrases.list = [];
    assert.equal(phrasesOf(features).length, 4);
  });
});

describe("chooseLeaders", () => {
  it("leaderFollowsVocalsAndDrums", () => {
    const loud = phrasesOf(makeLayeredFeatures({ bpm: 120, durationMs: 32000, leadConfidence: 0.9 }));
    assert.deepEqual(chooseLeaders(loud), ["lead", "lead", "lead", "lead"]);
    const weak = phrasesOf(makeLayeredFeatures({ bpm: 120, durationMs: 32000, leadConfidence: 0.2 }));
    assert.deepEqual(chooseLeaders(weak), ["drums", "drums", "drums", "drums"]);
  });

  it("bandsWhenNoLayers", () => {
    const phrases = phrasesOf(makeFeatures({ bpm: 120, durationMs: 64000 }));
    assert.deepEqual(
      chooseLeaders(phrases),
      phrases.map(() => "bands"),
    );
  });

  it("bands when every layer is absent", () => {
    assert.deepEqual(
      chooseLeaders([stub([0.9, 0.4], [0.9, 0.44], [0.1, 0.9]), stub([0.9, 0.9], [0.9, 0.9], [0.9, 0.29])]),
      ["bands", "lead"],
    );
  });

  it("an absent lead does not lead, however loud", () => {
    assert.deepEqual(chooseLeaders([stub([1, 0.44], [0.5, 0.6], null)]), ["bass"]);
  });

  // A song whose phrases carry a clearly sung line: confident and at least one onset per second.
  const sung = (extra = {}) => stub([0.1, 0.9], null, null, { rate: { drums: 0, bass: 0, lead: 2 }, ...extra });
  const VOCAL = [sung(), sung(), sung()];

  it("in a vocal song lead wins from a score of 0.5, otherwise the best score does", () => {
    const at = (conf, bass, drums) => chooseLeaders([stub([0.1, conf], bass, drums), ...VOCAL])[0];
    assert.equal(at(0.5, [0.9, 0.9], [0.9, 0.9]), "lead"); // 0.5 exactly
    assert.equal(at(0.49, [1, 0.95], [0.9, 0.9]), "bass");
    assert.equal(at(0.49, [0.5, 0.9], [0.9, 0.9]), "drums");
  });

  it("a sung line wins with little coverage: its score is confidence, not coverage x confidence", () => {
    const phrases = [stub([0.08, 0.9], [0.9, 0.9], [0.9, 0.9]), ...VOCAL];
    assert.equal(chooseLeaders(phrases)[0], "lead");
  });

  it("an instrumental song (no confident, busy lead) keeps its drum and bass leaders", () => {
    const quiet = (extra) => stub([0.1, 0.7], [0.6, 0.9], [0.9, 0.9], { rate: { drums: 4, bass: 1, lead: 2 }, ...extra });
    // lead confidence 0.7 is below the vocal bar, so lead is not preferred even with a score over 0.5
    assert.deepEqual(chooseLeaders([quiet(), quiet(), quiet()]), ["drums", "drums", "drums"]);
    // a confident lead that is too sparse (< 1 note/s) is not a vocal either
    const sparse = () => stub([0.1, 0.9], [0.6, 0.9], [0.9, 0.9], { rate: { drums: 4, bass: 1, lead: 0.5 } });
    assert.deepEqual(chooseLeaders([sparse(), sparse(), sparse()]), ["drums", "drums", "drums"]);
  });

  it("a song turns vocal at 30 % of its phrases", () => {
    const other = () => stub([0.1, 0.9], [0.6, 0.9], [0.9, 0.9], { rate: { drums: 4, bass: 1, lead: 0.5 }, sectionStart: true });
    const mix = (n) => [...Array.from({ length: n }, () => sung()), ...Array.from({ length: 10 - n }, other)];
    assert.equal(chooseLeaders(mix(3))[0], "lead"); // sung phrases still need a score >= 0.5: 0.9 here
    assert.equal(chooseLeaders(mix(3))[9], "lead");
    assert.equal(chooseLeaders(mix(2))[9], "drums");
  });

  it("hysteresisAvoidsFlicker", () => {
    const phrases = [0.5, 0.45, 0.5, 0.45, 0.5, 0.45].map((lead) => stub([lead, 1], [0.42, 1], null));
    assert.deepEqual(chooseLeaders(phrases), Array(6).fill("lead"));

    // lead (score 0.5) is not the best but within 0.8x of it: kept, unless a section starts.
    const kept = [stub([0.6, 1], null, null), stub([0.5, 0.5], [0.6, 1], null), stub([0.5, 0.5], [0.6, 1], null)];
    assert.deepEqual(chooseLeaders(kept), ["lead", "lead", "lead"]);
    const switched = [
      stub([0.6, 1], null, null),
      stub([0.5, 0.5], [0.6, 1], null, { sectionStart: true }),
      stub([0.5, 0.5], [0.6, 1], null),
    ];
    assert.deepEqual(chooseLeaders(switched), ["lead", "bass", "bass"]);
  });

  it("drum strength counts once: confidence only gates the drums", () => {
    // drums 0.5 x 0.5 used to score 0.25 and lose to bass 0.3 x 1.
    assert.deepEqual(chooseLeaders([stub(null, [0.3, 1], [0.5, 0.5])]), ["drums"]);
    assert.deepEqual(chooseLeaders([stub(null, [0.3, 1], [0.5, 0.29])]), ["bass"]);
  });

  it("a sparse line loses a loud phrase to busy drums", () => {
    const loud = (rate) => stub([0.9, 0.9], [0.8, 1], [0.4, 0.5], { energy: 1, rate });
    // bass gives 1 note/s where a full-energy phrase needs 3, so 0.8 counts as 0.27; the lead too sparse to be preferred.
    assert.deepEqual(chooseLeaders([loud({ drums: 4, bass: 1, lead: 0.5 })]), ["drums"]);
    assert.deepEqual(chooseLeaders([loud({ drums: 4, bass: 3, lead: 0.5 })]), ["bass"]);
    assert.deepEqual(chooseLeaders([loud({ drums: 4, bass: 1, lead: 2 })]), ["lead"]);
    // A quiet phrase needs few notes, so the same sparse bass keeps its score.
    assert.deepEqual(chooseLeaders([stub(null, [0.8, 1], [0.4, 0.5], { energy: 0.3, rate: { drums: 4, bass: 1, lead: 0 } })]), ["bass"]);
  });

  it("buildPhrases counts onsets per second for each layer", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 32000, structure: "AB" });
    const [p] = phrasesOf(features);
    const seconds = (p.endMs - p.startMs) / 1000;
    const inside = (t) => t >= p.startMs && t < p.endMs;
    const hits = features.drums.filter((d) => inside(d.t) && (d.kind === "kick" || d.kind === "snare")).length;
    assert.ok(Math.abs(p.rate.drums - hits / seconds) < 1e-3, `drums ${p.rate.drums}`);
    assert.ok(Math.abs(p.rate.bass - features.bass.filter((n) => inside(n.t)).length / seconds) < 1e-3);
    assert.ok(p.rate.lead > 0);
  });

  it("hysteresis lets go when the previous leader falls well behind", () => {
    const phrases = [stub(null, [0.9, 1], null), stub(null, [0.3, 1], [0.9, 1])];
    assert.deepEqual(chooseLeaders(phrases), ["bass", "drums"]);
  });

  it("repeatInheritsLeader", () => {
    const phrases = [
      stub([0.8, 0.9], null, [0.5, 0.9]),
      stub(null, [0.9, 0.9], [0.5, 0.9]),
      stub(null, [0.9, 0.9], [0.5, 0.9], { repeatOf: 0, similarity: 0.9 }),
      stub(null, [0.9, 0.9], [0.5, 0.9], { repeatOf: 0, similarity: 0.84 }),
    ];
    assert.deepEqual(chooseLeaders(phrases), ["lead", "bass", "lead", "bass"]);
  });

  it("repeat chains follow the inherited leader; forward and out-of-range indices are ignored", () => {
    const base = { similarity: 0.95 };
    const phrases = [
      stub([0.8, 0.9], null, null),
      stub(null, [0.9, 0.9], null, { ...base, repeatOf: 0 }),
      stub(null, [0.9, 0.9], null, { ...base, repeatOf: 1 }),
      stub(null, [0.9, 0.9], null, { ...base, repeatOf: 9 }),
      stub(null, [0.9, 0.9], null, { ...base, repeatOf: 5 }),
      stub([0.8, 0.9], null, null),
    ];
    assert.deepEqual(chooseLeaders(phrases), ["lead", "lead", "lead", "bass", "bass", "lead"]);
  });

  it("works on fixture phrases with a repeating structure", () => {
    const phrases = phrasesOf(makeLayeredFeatures({ bpm: 120, durationMs: 32000, structure: "ABAB" }));
    const leaders = chooseLeaders(phrases);
    assert.equal(leaders.length, phrases.length);
    assert.equal(leaders[2], leaders[0]);
    assert.equal(leaders[3], leaders[1]);
  });
});
