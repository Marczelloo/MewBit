// Mini slowdowns: where the music dips for a moment inside a loud passage (a break of a beat or two, a gated stutter), a
// level slows down with it instead of playing its pattern on as if nothing happened. Asked for by ear (MEGALOVANIA,
// Camellia remix, 2:18-2:23). Train Normal, against the audio's 10 ms loudness: in dips of 400 ms or more people thin to
// under half the density around them 30% of the time (Normal 18%) and leave 15% empty (4%). The features carry only a
// 500 ms energy curve; a frame of it under rule.drop of the level around finds 89% of those dips. In such a frame people
// play Normal's off-beat notes weaker than the music around 43% of the time and its weak notes 31%, against 80% outside.
const { lowerBound } = require("./util");

const AROUND_MS = 2000; // the music a dip is weighed against, either side
const NEAR_MS = 35; // the onset a note plays

// The dips of the energy curve: [[startMs, endMs, depth]] of frames under rule.drop x the 80th percentile of the frames
// within AROUND_MS, where that level is at least rule.level (a dip in quiet music is no break); depth is the lowest frame
// against its level. Kept on the ctx.
function energyDipsOf(ctx, rule) {
  const { hopMs, values } = ctx.features.energy ?? {};
  if (!(hopMs > 0) || !Array.isArray(values)) return [];
  ctx.energyDips ??= new Map();
  const key = `${rule.drop}:${rule.level}`;
  if (ctx.energyDips.has(key)) return ctx.energyDips.get(key);
  const reach = Math.round(AROUND_MS / hopMs);
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const around = values.slice(Math.max(0, i - reach), i + reach + 1).sort((a, b) => a - b);
    const level = around[Math.floor(around.length * 0.8)];
    if (!(level >= rule.level && values[i] < rule.drop * level)) continue;
    const last = out[out.length - 1], depth = values[i] / level;
    if (last && last[1] === i * hopMs) (last[1] += hopMs), (last[2] = Math.min(last[2], depth));
    else out.push([i * hopMs, (i + 1) * hopMs, depth]);
  }
  ctx.energyDips.set(key, out);
  return out;
}

// The loudest onset within NEAR_MS of t, of onsets sorted by time.
function strengthAt(onsets, times, t) {
  let s = 0;
  for (let i = lowerBound(times, t - NEAR_MS); i < onsets.length && times[i] <= t + NEAR_MS; i++) s = Math.max(s, onsets[i].s);
  return s;
}

// Whether t lies on a beat of timing.beats.
function onBeat(beats, t) {
  const k = lowerBound(beats, t + 1e-9) - 1;
  if (k < 0 || k + 1 >= beats.length) return true;
  const frac = (t - beats[k]) / (beats[k + 1] - beats[k]);
  return frac < 0.08 || frac > 0.92;
}

// thinDips(notes, ctx, rule) -> notes without the moments in an energy dip that are weaker than rule.below of the music
// around (the 80th percentile of the onsets within AROUND_MS outside the dip), or off the beat and weaker than
// rule.offBeatBelow, or off the beat at all where the dip goes under rule.deep. Holds stay.
// rule = diff.dipThin = { drop, level, below, offBeatBelow, deep }.
function thinDips(notes, ctx, rule) {
  const beats = ctx.timing?.beats;
  if (!rule || !Array.isArray(beats) || beats.length < 2) return notes;
  const dips = energyDipsOf(ctx, rule);
  if (dips.length === 0) return notes;
  const onsets = ctx.onsets, times = onsets.map((o) => o.t);
  const refOf = new Map();
  const ref = ([a, b]) => {
    if (!refOf.has(a)) {
      const around = onsets.filter((o) => (o.t >= a - AROUND_MS && o.t < a) || (o.t >= b && o.t < b + AROUND_MS)).map((o) => o.s).sort((x, y) => x - y);
      refOf.set(a, around.length ? around[Math.floor(around.length * 0.8)] : 0);
    }
    return refOf.get(a);
  };
  const dropped = new Set();
  for (const n of notes) {
    if (n.len > 0 || dropped.has(n.t)) continue;
    const dip = dips.find(([a, b]) => n.t >= a && n.t < b);
    if (!dip || !(ref(dip) > 0)) continue;
    const rel = strengthAt(onsets, times, n.t) / ref(dip);
    const offBeat = !onBeat(beats, n.t);
    if (rel < rule.below || (offBeat && (rel < rule.offBeatBelow || dip[2] < (rule.deep ?? 0)))) dropped.add(n.t);
  }
  const held = new Set(notes.filter((n) => n.len > 0).map((n) => n.t));
  return dropped.size ? notes.filter((n) => !dropped.has(n.t) || held.has(n.t)) : notes;
}

// silentUpper(notes, ctx, rule) -> notes without the moments in an energy dip where the upper bands (rule.bands) hear no
// onset for rule.gapMs to rule.maxGapMs: the music stops but for a low boom or rumble, which the low bands still hear as onsets
// on every beat (REVOLVANIA 0:41.5-0:43, after the bass drum, by ear). Holds that started before run on.
// rule = diff.dipSilence = { drop, level, gapMs, maxGapMs, bands }. A longer gap is a passage of its own, a drumless intro.
function silentUpper(notes, ctx, rule) {
  if (!rule) return notes;
  const dips = energyDipsOf(ctx, rule);
  if (dips.length === 0) return notes;
  const upper = (ctx.features.bands ?? []).filter((b) => rule.bands.includes(b?.name) && Array.isArray(b.onsets)).flatMap((b) => b.onsets.map((o) => o.t)).sort((x, y) => x - y);
  const gaps = [];
  for (let i = 0; i + 1 < upper.length; i++) if (upper[i + 1] - upper[i] >= rule.gapMs && upper[i + 1] - upper[i] <= rule.maxGapMs) gaps.push([upper[i] + NEAR_MS, upper[i + 1] - NEAR_MS]);
  const silent = (t) => gaps.some(([a, b]) => t > a && t < b) && dips.some(([a, b]) => t >= a && t < b);
  return gaps.length ? notes.filter((n) => !silent(n.t)) : notes;
}

module.exports = { energyDipsOf, silentUpper, thinDips };
