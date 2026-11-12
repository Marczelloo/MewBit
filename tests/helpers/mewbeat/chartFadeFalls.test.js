const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FADE_OUT, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { fadeOutOf, holdFadeOut, thinFadeOut } = require("../../../helpers/mewbeat/charts/fades");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures, makeLayeredFeatures } = require("./fixtures");

const BEAT_MS = 500; // the fixtures play at 120 BPM
const DURATION_MS = 60000;
const timing = buildTiming(makeFeatures({ bpm: 120, durationMs: DURATION_MS }), DURATION_MS);

// Loud until 50 s, then fading out to nothing at 60 s.
const fading = (t) => (t < 50000 ? 0.8 : Math.max(0, (0.8 * (60000 - t)) / 10000));
// Loud until 48 s, then a quiet ending that plays on at one loudness until the song stops at 60 s.
const quietEnding = (t) => (t < 48000 ? 0.8 : t < 60000 ? 0.21 : 0);
const context = (at) => ({ timing, phrases: [], durationMs: DURATION_MS, energy: { at }, eventTimes: [], onsets: [] });
const every = (fromMs, toMs, stepMs) => Array.from({ length: Math.ceil((toMs - fromMs) / stepMs) }, (_, i) => ({ t: fromMs + i * stepMs, lane: 0 }));

// The rule as it was before v45 added `falls`: a fade-out is any ending that gets quiet, whether it falls or plays on.
const { falls: _falls, ...WITHOUT_FALLS } = FADE_OUT;

describe("a quiet ending is not a fade-out (fadeOut.falls)", () => {
  it("is part of Normal's fade-out rule (from v45), and no other level has it", () => {
    assert.equal(DIFFICULTIES.normal.fadeOut, FADE_OUT);
    assert.equal(FADE_OUT.falls, 0.7);
    for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) {
      if (name !== "normal") assert.equal(level.fadeOut?.falls, undefined, name);
    }
  });

  it("still finds a fade-out whose energy falls, the same one", () => {
    assert.deepEqual(fadeOutOf(context(fading), FADE_OUT), fadeOutOf(context(fading), WITHOUT_FALLS));
    assert.notEqual(fadeOutOf(context(fading), FADE_OUT), null);
  });

  it("finds none in an ending that plays on as loud as it began", () => {
    const plain = fadeOutOf(context(quietEnding), WITHOUT_FALLS);
    assert.ok(Math.abs(plain.startMs - 48000) <= 50 && Math.abs(plain.endMs - 60000) <= 50, JSON.stringify(plain));
    assert.equal(fadeOutOf(context(quietEnding), FADE_OUT), null);
  });

  it("leaves the notes of such an ending as they are, where the rule without it takes half of them", () => {
    const notes = every(40000, 59500, BEAT_MS / 2);
    const ctx = context(quietEnding);
    const thinnedPlain = thinFadeOut(notes, ctx, WITHOUT_FALLS);
    assert.ok(thinnedPlain.filter((n) => n.t >= 48000).length <= 0.6 * notes.filter((n) => n.t >= 48000).length);
    assert.deepEqual(holdFadeOut(thinFadeOut(notes, ctx, FADE_OUT), ctx, FADE_OUT), notes);
  });

  it("charts a whole song, every level", () => {
    const charts = generateAll(makeLayeredFeatures(), "fade-falls-test");
    for (const level of ["easy", "normal", "hard", "hell"]) assert.ok(charts[level].notes.length > 0);
  });
});
