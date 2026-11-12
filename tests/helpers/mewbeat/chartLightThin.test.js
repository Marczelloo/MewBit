const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, LIGHT_THIN } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { lightKeep, thinned } = require("../../../helpers/mewbeat/charts/localThin");
const { makeLayeredFeatures } = require("./fixtures");

const LEVELS = ["easy", "normal", "hard", "hell"];
// A lighter stretch of five seconds between loud parts, inside the one phrase that repeats nothing (the A phrases before it are
// copies of one another and a repeat copies its source, so only the first B phrase is charted on its own). The phrase is played
// half a beat late, which is also what makes the repeat finder (repeatFinder.js) hear it as new.
const LIGHT_FROM = 34000, LIGHT_TO = 39000;
// The charted song is faster, so that Normal plays more moments than Easy in the phrase (all Normal may give up is that
// difference): its phrase is 4.8 s long and the lighter stretch fills it.
const BPM = 200, STRETCH_FROM = 29000, STRETCH_TO = 33100;

// A 200 BPM song of 70 s: loud (energy `loud`) all through, `light` between STRETCH_FROM and STRETCH_TO.
function song({ loud = 0.95, light = 0.55, from = STRETCH_FROM, to = STRETCH_TO, bpm = BPM } = {}) {
  const features = makeLayeredFeatures({ bpm, durationMs: 70000, structure: "AAAAAAB", energy: (t) => (t >= from && t < to ? light : loud) });
  const phrase = features.phrases.list[6];
  for (const band of features.bands) band.onsets = band.onsets.map((o) => (o.t >= phrase.startMs && o.t < phrase.endMs ? { ...o, t: o.t + Math.round(30000 / bpm) } : o));
  return features;
}
const chartsOf = (features, flags) => Object.fromEntries(Object.entries(generateAll(features, "k", flags)).map(([l, c]) => [l, c.notes]));
const momentsOf = (notes, from = 0, to = Infinity) => [...new Set(notes.filter((n) => n.t >= from && n.t < to).map((n) => n.t))].sort((a, b) => a - b);
const key = (notes) => JSON.stringify(notes.map((n) => [n.t, n.lane, n.len ?? 0]));
const energyFeatures = (energy) => ({ energy: { hopMs: 500, values: Array.from({ length: 140 }, (_, i) => energy(i * 500 + 250)) } });
const keepOf = (energy, rule = LIGHT_THIN) => lightKeep(energyFeatures(energy), 70000, rule);

describe("less notes in a lighter stretch (flag lightThin)", () => {
  it("is a flag of Normal, and no level has it without the flag", () => {
    assert.deepEqual(FLAGS.lightThin.levels, { normal: { lightThin: LIGHT_THIN } });
    assert.match(FLAGS.lightThin.label, /\S/);
    for (const level of [...Object.values(DIFFICULTIES), ...Object.values(INTERNAL_LEVELS)]) assert.equal(level.lightThin, undefined);
  });

  it("keeps a share under 1 in a stretch lighter than the loud music on both sides, and 1 everywhere else", () => {
    const keep = keepOf((t) => (t >= LIGHT_FROM && t < LIGHT_TO ? 0.55 : 0.95));
    for (let s = LIGHT_FROM / 1000 + 1; s < LIGHT_TO / 1000 - 1; s++) assert.ok(keep[s] < 1 && keep[s] >= LIGHT_THIN.floor, `second ${s}: ${keep[s]}`);
    for (let s = 0; s < 70; s++) if (s < LIGHT_FROM / 1000 - 1 || s >= LIGHT_TO / 1000 + 1) assert.equal(keep[s], 1, `second ${s}`);
    // the lighter the music, the fewer moments it keeps (a milder dip keeps more, and a dip at the knee keeps all)
    const milder = keepOf((t) => (t >= LIGHT_FROM && t < LIGHT_TO ? 0.75 : 0.95));
    assert.ok(milder[36] > keep[36] && milder[36] < 1);
    assert.ok(keepOf((t) => (t >= LIGHT_FROM && t < LIGHT_TO ? 0.85 : 0.95)).every((k) => k === 1));
  });

  it("does not read a quiet song, a long light part, a quiet ending or the edge of the song as a lighter stretch", () => {
    // quiet all through, with the same dip: the level around is under minLevel (Rush E plays fast piano on little energy)
    assert.ok(keepOf((t) => (t >= LIGHT_FROM && t < LIGHT_TO ? 0.2 : 0.6)).every((k) => k === 1));
    // a light part of 30 s: its middle has no louder music within reach
    const long = keepOf((t) => (t >= 20000 && t < 50000 ? 0.55 : 0.95));
    for (let s = 30; s < 40; s++) assert.equal(long[s], 1, `second ${s}`);
    // an ending that falls quiet: no loud music on its far side
    const ending = keepOf((t) => (t >= 60000 ? 0.4 : 0.95));
    for (let s = 62; s < 70; s++) assert.equal(ending[s], 1, `second ${s}`);
    // no energy to read
    assert.deepEqual(lightKeep({}, 5000, LIGHT_THIN), [1, 1, 1, 1, 1]);
  });

  it("is note for note the same chart with the flag off, and with the flag on where nothing is lighter", () => {
    const flat = song({ light: 0.95 });
    const dip = song();
    const plainFlat = chartsOf(flat, []), plainDip = chartsOf(dip, []);
    const onFlat = chartsOf(flat, ["lightThin"]);
    for (const level of LEVELS) assert.equal(key(onFlat[level]), key(plainFlat[level]), level);
    // the dip is the same chart unless the flag is on
    assert.equal(key(chartsOf(dip, [])["normal"]), key(plainDip.normal));
    assert.notEqual(key(chartsOf(dip, ["lightThin"]).normal), key(plainDip.normal));
  });

  it("plays fewer moments in the lighter stretch, and the same ones in the loud music around it", () => {
    const features = song();
    const plain = chartsOf(features, []), thin = chartsOf(features, ["lightThin"]);
    const inStretch = (notes) => momentsOf(notes, STRETCH_FROM, STRETCH_TO + 500).length;
    assert.ok(inStretch(thin.normal) < inStretch(plain.normal), `${inStretch(thin.normal)} against ${inStretch(plain.normal)}`);
    // never under the floor, so a stretch keeps most of its moments
    assert.ok(inStretch(thin.normal) >= Math.floor(inStretch(plain.normal) * LIGHT_THIN.floor) - 1);
    // the loud music away from the stretch is the same chart
    // (the last B phrase, from 62.4 s, is a repeat of the thinned one and copies it)
    const away = (notes) => key(notes.filter((n) => n.t < STRETCH_FROM - 12000 || (n.t >= STRETCH_TO + 12000 && n.t < 57000)));
    assert.equal(away(thin.normal), away(plain.normal));
    // a moment is only dropped, none is moved or added
    const before = new Set(momentsOf(plain.normal));
    for (const t of momentsOf(thin.normal)) assert.ok(before.has(t), `${t} is new`);
  });

  it("opens no gap over two beats where it thins", () => {
    const features = song();
    const plain = momentsOf(chartsOf(features, []).normal, STRETCH_FROM - 3000, STRETCH_TO + 3000);
    const thin = momentsOf(chartsOf(features, ["lightThin"]).normal, STRETCH_FROM - 3000, STRETCH_TO + 3000);
    const longest = (times) => times.reduce((gap, t, i) => (i ? Math.max(gap, t - times[i - 1]) : gap), 0);
    const twoBeats = 2 * (60000 / BPM);
    assert.ok(longest(thin) <= Math.max(longest(plain), twoBeats) + 1, `${longest(thin)} ms`);
  });

  it("thins a loud song that is flat loud too, where the strong onsets say nothing", () => {
    const features = song({ loud: 0.98, light: 0.6 });
    const flat = ["flatLoud"];
    const plain = chartsOf(features, flat), thin = chartsOf(features, [...flat, "lightThin"]);
    const inStretch = (notes) => momentsOf(notes, STRETCH_FROM, STRETCH_TO + 500).length;
    assert.ok(inStretch(thin.normal) < inStretch(plain.normal), `${inStretch(thin.normal)} against ${inStretch(plain.normal)}`);
    for (const t of momentsOf(thin.normal)) assert.ok(momentsOf(plain.normal).includes(t), `${t} is new`);
  });

  it("leaves Easy a cut of Normal that is not thinned twice, and Hard and Hell on top of the thinned Normal", () => {
    const features = song();
    const plain = chartsOf(features, []), thin = chartsOf(features, ["lightThin"]);
    assert.equal(FLAGS.lightThin.levels.easy, undefined);
    const removed = momentsOf(plain.normal).length - momentsOf(thin.normal).length;
    assert.ok(removed > 0);
    // Easy plays a fifth of Normal's moments less than Normal at most by what Normal gave up
    assert.ok(momentsOf(plain.easy).length - momentsOf(thin.easy).length <= removed);
    for (const level of ["hard", "hell"]) {
      const kept = new Set(momentsOf(thin[level]));
      const lost = momentsOf(thin.normal).filter((t) => !kept.has(t));
      assert.equal(lost.length, 0, `${level} lost Normal's moments ${lost.slice(0, 3)}`);
    }
  });

  it("is the same chart in the trace as in generate", () => {
    const features = song();
    const all = chartsOf(features, ["lightThin"]);
    for (const level of LEVELS) assert.equal(key(traceChart(features, level, "k", ["lightThin"]).notes), key(all[level]), level);
  });

  it("gives up about the share the energy asks for in a dense stretch, and opens no gap over two beats", () => {
    // a chart of a moment every 250 ms at 120 BPM (every other one on a beat), with the lighter stretch's keep from its energy
    const BEAT = 500;
    const timing = { beats: Array.from({ length: 160 }, (_, i) => i * BEAT), snapped: true, beatMsAt: () => BEAT, medianMs: BEAT };
    const notes = Array.from({ length: 280 }, (_, i) => ({ t: i * 250, lane: i % 4 }));
    const keep = keepOf((t) => (t >= LIGHT_FROM && t < LIGHT_TO ? 0.55 : 0.95));
    const after = thinned(notes, keep, timing);
    const asked = Math.round(keep.reduce((sum, k) => sum + (1 - k) * 4, 0));
    assert.equal(notes.length - after.length, asked);
    assert.ok(asked > 0);
    // all of it inside the stretch, off the beat first
    for (const n of notes) if (!after.includes(n)) assert.ok(n.t >= LIGHT_FROM - 1000 && n.t < LIGHT_TO + 1000 && n.t % BEAT !== 0, `${n.t}`);
    after.slice(1).forEach((n, i) => assert.ok(n.t - after[i].t <= 2 * BEAT, `${after[i].t} -> ${n.t}`));
  });

  it("takes each lighter second's own share, and does not pass what a second cannot give on to a louder one", () => {
    const BEAT = 500;
    const timing = { beats: Array.from({ length: 160 }, (_, i) => i * BEAT), snapped: true, beatMsAt: () => BEAT, medianMs: BEAT };
    const notes = Array.from({ length: 280 }, (_, i) => ({ t: i * 250, lane: i % 4 }));
    const keep = new Array(70).fill(1);
    keep[34] = keep[35] = 0.6;
    keep[36] = 0.9;
    const goneIn = (after, second) => notes.filter((n) => Math.floor(n.t / 1000) === second && !after.includes(n)).length;
    // 4 moments a second: 1.6 + 1.6 + .4 asked, the rounding carried along: 2, 1, 1 (and not 3 early in the run, as spread along it)
    const after = thinned(notes, keep, timing, Infinity, null, keep);
    assert.deepEqual([34, 35, 36].map((s) => goneIn(after, s)), [2, 1, 1]);
    for (const n of notes) if (!after.includes(n)) assert.ok(n.t >= 34000 && n.t < 37000, `${n.t}`);
    // a second of held moments gives nothing, and the share it could not give goes on to no one (35 gives its own 1, not 2)
    const held = notes.map((n) => (Math.floor(n.t / 1000) === 34 ? { ...n, len: 200 } : n));
    const afterHeld = thinned(held, keep, timing, Infinity, null, keep);
    assert.equal(held.filter((n) => Math.floor(n.t / 1000) === 34 && !afterHeld.includes(n)).length, 0);
    assert.deepEqual([35, 36].map((s) => held.filter((n) => Math.floor(n.t / 1000) === s && !afterHeld.includes(n)).length), [1, 1]);
    // the melody's moments go last inside the second, but go when the others are used up
    const melody = new Set(notes.filter((n) => Math.floor(n.t / 1000) === 35 && n.t % 500 !== 0).map((n) => n.t));
    const afterMelody = thinned(notes, keep, timing, Infinity, melody, keep);
    assert.equal(goneIn(afterMelody, 35), 1);
    // the moment that went in second 35 is not one of the melody's (the two off the beat)
    for (const n of notes) if (!afterMelody.includes(n) && Math.floor(n.t / 1000) === 35) assert.ok(!melody.has(n.t), `${n.t} is the melody's`);
    // every moment of second 34 is the melody's: the 2 it gives are taken from the melody once the others are used up
    const all34 = new Set(notes.filter((n) => Math.floor(n.t / 1000) === 34).map((n) => n.t));
    assert.equal(goneIn(thinned(notes, keep, timing, Infinity, all34, keep), 34), 2);
    // without `exact` the call is the old spread along the run
    assert.equal(notes.length - thinned(notes, keep, timing).length, Math.round(1.6 + 1.6 + 0.4));
  });
});
