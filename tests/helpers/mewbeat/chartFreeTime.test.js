const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FREE_TIME, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { thinDips } = require("../../../helpers/mewbeat/charts/dips");
const { beatSpread, freePhrases, gridPhase, inFree } = require("../../../helpers/mewbeat/charts/freeTime");
const { analyse, generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { scoreMoments, selectMoments, snappedMoments } = require("../../../helpers/mewbeat/charts/selection");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const PLAIN = flagWithout("withoutfreetime", "freeTime"); // Normal as it was before freeTime
const BEAT = 500;
const FREE_FROM = 16000; // the third phrase of the fixture (16 beats of 500 ms a phrase)
const FREE_TO = 24000;
const LEVELS = ["easy", "normal", "hard", "hell"];
const SCATTER = [40, 215, 330, 95, 410, 170, 290, 455, 20, 365, 130, 245, 480, 70, 310, 190]; // where in its beat a free note begins

// A decoded melody for the fixture: a note on every beat, and through the third phrase one a beat at no steady place.
function melodyOf(features) {
  const notes = [];
  for (let i = 0; i * BEAT < features.durationMs; i++) {
    const beat = i * BEAT;
    const free = beat >= FREE_FROM && beat < FREE_TO;
    notes.push({ t: free ? beat + SCATTER[i % SCATTER.length] : beat, pitch: 60 + (i % 5), conf: 0.8, len: 200 });
  }
  return notes;
}

// The fixture's song with its third phrase out of tempo: there every other beat comes 60 ms late (the tracker's beats, and the
// fixture's grid with them), so the sounds, which stay where they were, leave the grid's lines, and the melody wanders.
function freeFeatures() {
  const features = makeLayeredFeatures();
  const beats = features.tempo.beats.map((t, i) => (t >= FREE_FROM && t < FREE_TO && i % 2 === 1 ? t + 60 : t));
  return { ...features, tempo: { ...features.tempo, beats }, decodedMelody: melodyOf(features) };
}

describe("phrases with no tempo to hold (freeTime)", () => {
  const steady = Array.from({ length: 33 }, (_, i) => i * BEAT);
  const phrase = { index: 0, startMs: 0, endMs: 16 * BEAT, pulse: 1 };
  const quarters = Array.from({ length: 64 }, (_, i) => (i * BEAT) / 4);
  const ones = (times) => times.map(() => 1);

  it("is a rule of Normal (from v45) the other levels follow, and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.normal.freeTime, FREE_TIME);
    for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (name !== "normal") assert.equal(level.freeTime, undefined, name);
  });

  it("reads how uneven a phrase's tracked beats are", () => {
    assert.equal(beatSpread(steady, phrase, 6), 0);
    const wandering = steady.map((t, i) => (i % 2 === 1 ? t + 60 : t));
    assert.ok(beatSpread(wandering, phrase, 6) > FREE_TIME.spread);
    // too few beats in the phrase to say
    assert.equal(beatSpread(steady, { startMs: 0, endMs: 2 * BEAT }, 6), null);
    assert.equal(beatSpread([], phrase, 6), null);
  });

  it("reads where a phrase's sounds sit against the grid's quarter lines", () => {
    const on = gridPhase(quarters, ones(quarters), steady, phrase);
    assert.equal(on.n, 64);
    assert.ok(on.onGrid > 0.999 && on.lock > 0.999);
    // every sound halfway between two lines: off this grid, but on one of their own
    const between = quarters.map((t) => t + BEAT / 8);
    const off = gridPhase(between, ones(between), steady, phrase);
    assert.ok(off.onGrid < -0.999 && off.lock > 0.999);
    // sounds at no steady place: neither
    const anywhere = steady.slice(0, 16).map((t, i) => t + SCATTER[i]);
    const none = gridPhase(anywhere, ones(anywhere), steady, phrase);
    assert.ok(Math.abs(none.onGrid) < 0.3 && none.lock < 0.3);
    // nothing in the phrase
    assert.deepEqual(gridPhase([], [], steady, phrase), { n: 0, onGrid: null, lock: null });
  });

  it("calls a phrase free only when the beats, the sounds and the melody all say so", () => {
    const second = { index: 1, startMs: 16 * BEAT, endMs: 32 * BEAT, pulse: 1 };
    const phrases = [phrase, second];
    const timing = { snapped: true, beats: steady };
    const wandering = steady.map((t, i) => (t >= second.startMs && i % 2 === 1 ? t + 60 : t));
    const scattered = steady.slice(0, 32).map((t, i) => (t >= second.startMs ? t + SCATTER[i % 16] : t));
    const bands = (times) => [{ name: "low", onsets: times.map((t) => ({ t, s: 0.8 })) }];
    const melody = (times) => times.map((t) => ({ t }));
    const free = (beats, sounds, lead, rule = FREE_TIME) => freePhrases({ tempo: { beats }, bands: bands(sounds) }, { decodedMelody: melody(lead) }, timing, phrases, rule);

    assert.deepEqual(free(wandering, scattered, scattered), [second]);
    // steady tracked beats: a breakdown or a solo that keeps its tempo
    assert.deepEqual(free(steady, scattered, scattered), []);
    // the sounds on the lines
    assert.deepEqual(free(wandering, steady.slice(0, 32), scattered), []);
    // the melody on the lines, or too few of its notes to tell
    assert.deepEqual(free(wandering, scattered, steady.slice(0, 32)), []);
    assert.deepEqual(free(wandering, scattered, scattered.slice(0, 16 + FREE_TIME.minLead - 1)), []);
    // the tuned line is the one read where there is one
    assert.deepEqual(freePhrases({ tempo: { beats: wandering }, bands: bands(scattered) }, { decodedMelody: melody(scattered), decodedMelodyTuned: melody(steady.slice(0, 32)) }, timing, phrases, FREE_TIME), []);
    // no rule, no melody, no grid
    assert.deepEqual(free(wandering, scattered, scattered, null), []);
    assert.deepEqual(freePhrases({ tempo: { beats: wandering }, bands: bands(scattered) }, {}, timing, phrases, FREE_TIME), []);
    assert.deepEqual(freePhrases({ tempo: { beats: wandering }, bands: bands(scattered) }, { decodedMelody: melody(scattered) }, { snapped: false, beats: [] }, phrases, FREE_TIME), []);

    assert.equal(inFree([second], second.startMs), true);
    assert.equal(inFree([second], second.startMs - 1), false);
    assert.equal(inFree([], 0), false);
  });

  it("leaves a song with a steady tempo as it is", () => {
    const features = { ...makeLayeredFeatures(), decodedMelody: melodyOf(makeLayeredFeatures()) };
    assert.deepEqual(analyse(features).free, []);
    const charts = generateAll(features, "free-time-test");
    const plain = generateAll(features, "free-time-test", PLAIN);
    for (const level of LEVELS) assert.deepEqual(charts[level].notes, plain[level].notes);
  });

  it("finds the free phrase of a song and stops trusting the grid there", () => {
    const features = freeFeatures();
    const plain = analyse(features, PLAIN);
    const ctx = analyse(features);
    assert.deepEqual(plain.free, []);
    assert.deepEqual(ctx.free.map((p) => [p.startMs, p.endMs]), [[FREE_FROM, FREE_TO]]);
    assert.equal(plain.timing.intervalOk(FREE_FROM + 1000), true);
    assert.equal(ctx.timing.intervalOk(FREE_FROM + 1000), false);
    assert.equal(ctx.timing.intervalOk(FREE_FROM - 1000), true);
    assert.equal(ctx.timing.intervalOk(FREE_TO + 1000), true);
  });

  it("scores a free phrase's sounds by their strength alone and leaves them where they were heard", () => {
    const features = freeFeatures();
    const plain = scoreMoments(analyse(features, PLAIN), "normal");
    const ctx = analyse(features);
    const scored = scoreMoments(ctx, "normal");
    assert.equal(scored.length, plain.length);
    const inside = scored.filter((m) => m.t >= FREE_FROM && m.t < FREE_TO);
    assert.ok(inside.length > 8);
    for (const m of inside) assert.deepEqual([m.metric, m.down, m.free], [1, 0, true]);
    // the same strength scores the same wherever it falls in the bar
    const byStrength = new Map();
    for (const m of inside) byStrength.set(m.s, [...(byStrength.get(m.s) ?? []), m.score]);
    for (const scores of byStrength.values()) assert.equal(new Set(scores).size, 1);
    // the rest of the song is scored as without the rule
    scored.forEach((m, i) => {
      if (m.t < FREE_FROM || m.t >= FREE_TO) assert.deepEqual(m, plain[i]);
    });
    // no moment of the free phrase moved to the grid
    const heard = new Set(inside.map((m) => m.t));
    for (const m of snappedMoments(ctx, "normal").filter((m) => m.t >= FREE_FROM && m.t < FREE_TO)) {
      assert.equal(m.raw, undefined);
      assert.ok(heard.has(m.t));
    }
  });

  it("plays no beat for the pulse in a free phrase", () => {
    const timing = { snapped: true, beats: steady, downbeats: steady.filter((_, i) => i % 4 === 0), beatMsAt: () => BEAT };
    const diff = { minNoteGapMs: 200, gapBeats: 0, foreground: 1 };
    const scored = [{ t: 0, s: 0.9, score: 3, metric: 0, down: 1, source: "lead" }];
    const pulsed = selectMoments(phrase, scored, 6, diff, timing, {});
    assert.ok(pulsed.some((n) => n.reason === "puls"));
    const free = selectMoments(phrase, scored, 6, diff, timing, { free: true });
    assert.deepEqual(free.map((n) => n.t), [0]);
  });

  it("thins an energy dip of a free phrase by strength, not by the beat", () => {
    // a deep dip from 4 to 6 s; a loud sound in it, off the grid's beats
    const values = Array.from({ length: 160 }, (_, i) => (i >= 40 && i < 60 ? 0.2 : 0.8));
    const onsets = [{ t: 3000, s: 0.9 }, { t: 3500, s: 0.9 }, { t: 5130, s: 0.9 }, { t: 6500, s: 0.9 }, { t: 7000, s: 0.9 }];
    const rule = DIFFICULTIES.normal.dipThin;
    const ctx = { timing: { beats: steady }, onsets, features: { energy: { hopMs: 100, values } }, energy: { hopMs: 100 }, durationMs: 16000 };
    const notes = onsets.map((o) => ({ t: o.t, lane: 0 }));
    const gone = thinDips(notes, { ...ctx, free: [] }, rule).length;
    const kept = thinDips(notes, { ...ctx, free: [{ startMs: 4000, endMs: 8000 }] }, rule).length;
    assert.equal(kept, notes.length);
    assert.ok(gone <= kept);
  });

  it("charts a song with a free phrase on every level, the rest of it as without the rule", () => {
    const features = freeFeatures();
    const plain = generateAll(features, "free-time-test", PLAIN);
    const flagged = generateAll(features, "free-time-test");
    for (const level of LEVELS) {
      assert.ok(flagged[level].notes.some((n) => n.t >= FREE_FROM && n.t < FREE_TO));
      const outside = (chart) => chart.notes.filter((n) => n.t < FREE_FROM - 2 * BEAT || n.t >= FREE_TO + 2 * BEAT).length;
      assert.ok(Math.abs(outside(flagged[level]) - outside(plain[level])) <= 0.1 * outside(plain[level]));
    }
  });
});
