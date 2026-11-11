// Sounds that are no music (generate.js finish, flag noNoise): a creator's intro or outro, speech, effects, crowd noise. Heard
// as blocks on a noise that belongs to no note (the user, 2026-11-11). Two things say so together: the sounds of a stretch sit
// off the song's grid, no nearer to its lines than chance, and the decoder finds almost no pitched note in it. Either alone
// is common in music (vocals sit off the lines, a drum break has no pitch). The numbers are with NO_NOISE in difficulty.js.
const { gridPhase } = require("./freeTime");
const { lowerBound } = require("./util");

// Every band's onsets in time: { times, weights }, an onset weighing its strength.
function bandSounds(raw) {
  const out = [];
  for (const band of Array.isArray(raw?.bands) ? raw.bands : []) {
    for (const o of Array.isArray(band?.onsets) ? band.onsets : []) if (Number.isFinite(o?.t) && Number.isFinite(o?.s)) out.push({ t: o.t, w: o.s });
  }
  out.sort((a, b) => a.t - b.t);
  return { times: out.map((o) => o.t), weights: out.map((o) => o.w) };
}

// noiseLookup(raw, features, timing, rule) -> (t) => whether the sounds around t are no music, or null when there is nothing
// to tell it by (no grid, no decoded notes). Read every `hopMs` over the `windowMs` around the place: `minSounds` sounds or
// more, under `onGrid` of the grid's quarter lines (freeTime.js gridPhase), and under `pitched` decoded notes a second.
// rule = diff.noNoise = { windowMs, hopMs, minSounds, onGrid, pitched }.
function noiseLookup(raw, features, timing, rule) {
  const decoded = Array.isArray(features?.decodedNotes) ? features.decodedNotes : raw?.decodedNotes;
  const durationMs = Number(features?.durationMs);
  if (!rule || !timing?.snapped || !Array.isArray(decoded) || decoded.length === 0 || !(durationMs > 0)) return null;
  const sounds = bandSounds(raw);
  const notes = decoded.map((n) => n?.t).filter(Number.isFinite).sort((a, b) => a - b);
  const flags = [];
  for (let centre = 0; centre <= durationMs; centre += rule.hopMs) {
    const startMs = Math.max(0, centre - rule.windowMs / 2), endMs = Math.min(durationMs, centre + rule.windowMs / 2);
    const heard = gridPhase(sounds.times, sounds.weights, timing.beats, { startMs, endMs });
    const pitched = (lowerBound(notes, endMs) - lowerBound(notes, startMs)) / Math.max(1, endMs - startMs);
    flags.push(heard.n >= rule.minSounds && heard.onGrid < rule.onGrid && pitched * 1000 < rule.pitched);
  }
  if (!flags.includes(true)) return null;
  return (t) => flags[Math.max(0, Math.min(flags.length - 1, Math.round(t / rule.hopMs)))] === true;
}

// withoutNoise(notes, noiseAt) -> notes without the ones that start where the sounds are no music. A hold that began in the
// music before it plays on.
function withoutNoise(notes, noiseAt) {
  if (!noiseAt) return notes;
  const kept = notes.filter((n) => !noiseAt(n.t));
  return kept.length === notes.length ? notes : kept;
}

module.exports = { noiseLookup, withoutNoise };
