// Sounds that are no music (generate.js finish, diff.noNoise): a creator's intro or outro, speech, effects, crowd noise. Heard
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
// rule = diff.noNoise = { windowMs, hopMs, minSounds, onGrid, pitched }. `edge` (diff.noNoiseEdge = { withinMs, reachMs,
// pitched }, optional) lengthens a stretch that opens or closes the song, see edgeStretches.
function noiseLookup(raw, features, timing, rule, edge = null) {
  const decoded = Array.isArray(features?.decodedNotes) ? features.decodedNotes : raw?.decodedNotes;
  const durationMs = Number(features?.durationMs);
  if (!rule || !timing?.snapped || !Array.isArray(decoded) || decoded.length === 0 || !(durationMs > 0)) return null;
  const sounds = bandSounds(raw);
  const notes = decoded.map((n) => n?.t).filter(Number.isFinite).sort((a, b) => a - b);
  const flags = [], offGrid = [], rates = [];
  for (let centre = 0; centre <= durationMs; centre += rule.hopMs) {
    const startMs = Math.max(0, centre - rule.windowMs / 2), endMs = Math.min(durationMs, centre + rule.windowMs / 2);
    const heard = gridPhase(sounds.times, sounds.weights, timing.beats, { startMs, endMs });
    const pitched = (lowerBound(notes, endMs) - lowerBound(notes, startMs)) / Math.max(1, endMs - startMs);
    rates.push(pitched * 1000);
    offGrid.push(heard.n >= rule.minSounds && heard.onGrid < rule.onGrid);
    flags.push(offGrid[offGrid.length - 1] && rates[rates.length - 1] < rule.pitched);
  }
  const ends = edge ? edgeStretches(flags, offGrid, rates, rule, edge) : null;
  if (!flags.includes(true)) return null;
  const last = flags.length - 1;
  return (t) => (ends && (t < ends.headMs || t >= ends.tailMs)) || flags[Math.max(0, Math.min(last, Math.round(t / rule.hopMs)))] === true;
}

// A noise stretch that opens the song (or closes it) reaches on to where the music is (diff.noNoiseEdge). `flags` are the
// windows noiseLookup calls noise, `offGrid` the windows whose sounds sit off the grid; both from the edge inwards. The
// stretch that starts within `edge.withinMs` of the song's start takes every window after it that is still off the grid and
// under `edge.pitched` decoded notes a second (the rule's own limit is 1), and stops at the first that is not: the decoder
// hears a little pitch in a noise before the music (King Gnu AIZO 0:11-0:14, 1.75-2.25 a second). The cap matters: with the
// pitch waived the stretch ran over long off-grid tails that people play. The windows are 4 s wide, so the noise ends
// `edge.reachMs` past the last added window's centre (only when one was added); the tail mirrors it.
// Returns { headMs, tailMs }: noise before headMs and from tailMs on; the windows themselves are lengthened in `flags`.
function edgeStretches(flags, offGrid, rates, rule, edge) {
  const out = { headMs: 0, tailMs: Infinity };
  const first = flags.indexOf(true), last = flags.lastIndexOf(true);
  if (first < 0) return out;
  if (first * rule.hopMs <= edge.withinMs) {
    let i = first;
    while (flags[i + 1]) i++;
    const seedEnd = i;
    while (offGrid[i + 1] && rates[i + 1] < edge.pitched) flags[++i] = true;
    if (i > seedEnd) out.headMs = i * rule.hopMs + edge.reachMs;
  }
  const lastCentre = (flags.length - 1) * rule.hopMs;
  if (lastCentre - last * rule.hopMs <= edge.withinMs) {
    let i = last;
    while (flags[i - 1]) i--;
    const seedStart = i;
    while (i > 0 && offGrid[i - 1] && rates[i - 1] < edge.pitched) flags[--i] = true;
    if (i < seedStart) out.tailMs = i * rule.hopMs - edge.reachMs;
  }
  return out;
}

// withoutNoise(notes, noiseAt) -> notes without the ones that start where the sounds are no music. A hold that began in the
// music before it plays on.
function withoutNoise(notes, noiseAt) {
  if (!noiseAt) return notes;
  const kept = notes.filter((n) => !noiseAt(n.t));
  return kept.length === notes.length ? notes : kept;
}

module.exports = { noiseLookup, withoutNoise };
