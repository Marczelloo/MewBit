const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

const { gridSlot } = require("../../../helpers/mewbeat/charts/grid");
const { patternEvents } = require("../../../helpers/mewbeat/charts/patterns");
const { buildPhrases, chooseLeaders, isVocalSong, supportLayers } = require("../../../helpers/mewbeat/charts/phrases");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeLayeredFeatures } = require("./fixtures");

const LOUD = () => 0.9;
const CLEAR_MS = 125; // SUPPORT_REST_BEATS (1/4 beat) at 120 bpm: nearer than this to a leader note is "with" it

function setup(options = {}) {
  const features = makeLayeredFeatures({ energy: LOUD, ...options });
  const timing = buildTiming(features, features.durationMs);
  const phrases = buildPhrases(features, timing, features.durationMs).map((p) => ({ ...p, energy: 0.9 }));
  return { features, timing, phrases };
}

const hash = (events) => crypto.createHash("sha1").update(JSON.stringify(events)).digest("hex").slice(0, 12);
const hand = (e) => e.lane >> 1;

describe("supportLayers", () => {
  const { phrases } = setup();
  const phrase = { ...phrases[0], activity: { drums: 0.8, bass: 0.7, lead: 0.75 }, confidence: { drums: 0.8, bass: 0.7, lead: 0.5 }, rate: { drums: 4, bass: 1, lead: 1.5 } };

  it("lists the comparable layers beside the leader, strongest first", () => {
    const supports = supportLayers(phrase, "drums");
    assert.ok(supports.length >= 1 && !supports.includes("drums"), `supports ${supports}`);
  });

  it("is empty when the leader is dominant", () => {
    const dominant = { ...phrase, activity: { drums: 0.9, bass: 0.02, lead: 0 }, confidence: { drums: 0.9, bass: 0.7, lead: 0 }, rate: { drums: 4, bass: 0.1, lead: 0 } };
    assert.deepEqual(supportLayers(dominant, "drums"), []);
  });

  it("is empty for the band path and for an unknown leader", () => {
    assert.deepEqual(supportLayers(phrase, "bands"), []);
    assert.deepEqual(supportLayers(phrase, "nothing"), []);
  });

  it("leaves a sung lead in a vocal song alone", () => {
    const sung = { ...phrase, confidence: { drums: 0.8, bass: 0.7, lead: 0.9 }, rate: { drums: 4, bass: 1, lead: 2 } };
    assert.equal(isVocalSong([sung, sung, sung, sung]), true);
    assert.deepEqual(supportLayers(sung, "lead", true), []);
    assert.deepEqual(supportLayers(sung, "lead", false), ["drums", "bass"]); // not a vocal song: the usual rule decides
  });
});

describe("mixed patterns", () => {
  it("puts bass on the left hand and snare/hats on the right", () => {
    const { features, timing, phrases } = setup({ lead: false });
    const events = patternEvents(phrases[0], "bass", features, timing, ["drums"]);
    // (a lone leader note on a bar start also gets a mirror note, withChords, which has no hand: left out here)
    const bass = events.filter((e) => e.source === "bass" && e.hand !== undefined);
    const drums = events.filter((e) => e.source === "drums");
    assert.ok(bass.length > 0 && drums.length > 0);
    assert.ok(bass.every((e) => hand(e) === 0), "bass on lanes 0-1");
    assert.ok(drums.every((e) => e.support === true));
    assert.ok(drums.filter((e) => hand(e) === 1).length > 0, "snare/hats on lanes 2-3");
    assert.ok(events.every((e) => e.lane >= 0 && e.lane <= 3));
  });

  it("puts a lead on the right hand beside bass on the left", () => {
    const { features, timing, phrases } = setup();
    const events = patternEvents(phrases[0], "lead", features, timing, ["bass", "drums"]).filter((e) => e.hand !== undefined);
    assert.ok(events.filter((e) => e.source === "lead").every((e) => hand(e) === 1));
    assert.ok(events.filter((e) => e.source === "bass").every((e) => hand(e) === 0));
  });

  it("puts the kick on the left when no bass takes the slot", () => {
    const { features, timing, phrases } = setup({ bass: false });
    const events = patternEvents(phrases[0], "lead", features, timing, ["drums"]);
    assert.ok(events.some((e) => e.source === "drums" && hand(e) === 0), "kicks on the left");
    assert.ok(events.filter((e) => e.source === "lead").every((e) => hand(e) === 1));
  });

  it("gives a support note one level more than its own, but not in the leader's rest", () => {
    const { features, timing, phrases } = setup({ bass: false, holdsEveryBeats: 4 });
    const events = patternEvents(phrases[0], "lead", features, timing, ["drums"]);
    const leadTimes = events.filter((e) => !e.support && e.source === "lead").map((e) => e.t);
    const near = (e) => leadTimes.some((t) => Math.abs(t - e.t) < CLEAR_MS);
    const supports = events.filter((e) => e.support === true && e.sustainMs === undefined);
    const withLeader = supports.filter(near);
    const inRest = supports.filter((e) => !near(e));
    assert.ok(withLeader.length > 0 && inRest.length > 0);
    assert.ok(withLeader.every((e) => e.level >= 1), "with a leader note: level 1 or more");
    assert.ok(inRest.some((e) => e.level === 0), "in a rest a quiet support stays level 0");
  });

  it("turns a bar-start kick under a leader note on the other hand into a Hard-only chord", () => {
    const { features, timing, phrases } = setup({ bass: false });
    const events = patternEvents(phrases[0], "lead", features, timing, ["drums"]);
    const barStart = 2000; // a downbeat of the fixture (120 bpm, 4/4)
    const here = events.filter((e) => e.t === barStart);
    const kick = here.find((e) => e.source === "drums");
    assert.ok(kick && hand(kick) === 0, "kick on the left");
    assert.ok(here.some((e) => e.source === "lead" && hand(e) === 1), "leader note on the right");
    assert.equal(kick.level, 2);
    // Off a bar start the same kicks stay on Normal's level.
    const offBar = events.filter((e) => e.source === "drums" && hand(e) === 0 && e.t % 2000 !== 0);
    assert.ok(offBar.length > 0 && offBar.every((e) => e.level <= 1));
  });

  it("never puts three events on one moment", () => {
    const { features, timing, phrases } = setup();
    for (const leader of ["drums", "bass", "lead"]) {
      const others = ["drums", "bass", "lead"].filter((l) => l !== leader);
      const counts = new Map();
      for (const e of patternEvents(phrases[1], leader, features, timing, others)) counts.set(e.t, (counts.get(e.t) || 0) + 1);
      assert.ok([...counts.values()].every((c) => c <= 2), leader);
    }
  });
});

describe("dominant phrases", () => {
  const { features, timing, phrases } = setup();
  const GOLDEN = { drums: ["95febfbcc361", 58], bass: ["ea8ccc20f616", 45], lead: ["ba1dae1c6edc", 48] };

  for (const leader of Object.keys(GOLDEN)) {
    it(`${leader}: no supports gives exactly the single-layer events`, () => {
      const events = [0, 1].flatMap((i) => patternEvents(phrases[i], leader, features, timing)).filter((e) => !e.chordOnly);
      assert.equal(events.length, GOLDEN[leader][1]);
      assert.equal(hash(events), GOLDEN[leader][0]);
      assert.deepEqual(patternEvents(phrases[0], leader, features, timing, []), patternEvents(phrases[0], leader, features, timing));
    });
  }

  it("offers a drum hit under a lone tune note on a beat as its other hand", () => {
    const events = patternEvents(phrases[0], "lead", features, timing);
    const offered = events.filter((e) => e.chordOnly);
    assert.ok(offered.length > 0);
    for (const e of offered) {
      const here = events.filter((other) => other.t === e.t);
      assert.equal(here.length, 2, `${e.t}`);
      assert.notEqual(hand(here[0]), hand(here[1]), `${e.t}`);
      assert.equal(gridSlot(timing, e.t).beat, true, `${e.t}`);
    }
  });

  it("offers no such hit under a drum leader or in a quiet phrase", () => {
    assert.equal(patternEvents(phrases[0], "drums", features, timing).some((e) => e.chordOnly), false);
    const quiet = { ...phrases[0], energy: 0.1 };
    assert.equal(patternEvents(quiet, "lead", features, timing).some((e) => e.chordOnly), false);
  });

  it("a lead-only leader with no supports has no hand-split fields", () => {
    for (const e of patternEvents(phrases[0], "lead", features, timing)) assert.ok(e.support === undefined && e.hand === undefined);
  });
});

describe("chooseLeaders is unchanged by supports", () => {
  it("still picks one leader per phrase", () => {
    const { phrases } = setup();
    const leaders = chooseLeaders(phrases);
    assert.equal(leaders.length, phrases.length);
  });
});
