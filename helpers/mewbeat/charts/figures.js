// What the drums and the bass keep repeating. People play a snare that comes back at the same place of the bar about twice as
// often as one at the same place that does not (half beats, train songs: 71% against 36%), so a level may take those places
// where the music leaves it room (selection.js). This file only finds them; it reads rhythm, not which instrument leads.
const { TONAL_MIN_CONF } = require("./phrases");
const { beatMsOf } = require("./holds");
const { nearestIndex } = require("./util");

const GRID_DIVISION = 4; // as selection.js: the notes sit on quarter beats
const SNAP_BEATS = 0.07; // an onset this near a grid point, in beats, sounds on it
// [slots between two repeats, repeats looked at on each side, least of them that must exist]: a figure of one bar, or of two.
const PERIODS = [[4 * GRID_DIVISION, 8, 6], [8 * GRID_DIVISION, 4, 3]];

const sorted = (times) => times.filter(Number.isFinite).sort((a, b) => a - b);

// The onsets of each layer a figure may come from.
function layersOf(features) {
  const drums = Array.isArray(features.drums) ? features.drums : [];
  const bass = Array.isArray(features.bass) ? features.bass : [];
  const low = (Array.isArray(features.bands) ? features.bands : []).find((band) => band?.name === "low")?.onsets;
  return {
    kick: sorted(drums.filter((d) => d?.kind === "kick").map((d) => d.t)),
    snare: sorted(drums.filter((d) => d?.kind === "snare").map((d) => d.t)),
    bass: sorted(bass.filter((n) => (n?.conf ?? 1) >= TONAL_MIN_CONF).map((n) => n?.t)),
    low: sorted((Array.isArray(low) ? low : []).map((o) => o?.t)),
  };
}

// The share of the same places a bar or two away, on each side, where the layer sounds too: the better of the two periods.
function repeatShare(sounds, g) {
  let best = 0;
  for (const [period, repeats, least] of PERIODS) {
    let seen = 0;
    let hits = 0;
    for (let k = -repeats; k <= repeats; k++) {
      const other = g + k * period;
      if (k === 0 || other < 0 || other >= sounds.length) continue;
      seen++;
      if (sounds[other]) hits++;
    }
    if (seen >= least) best = Math.max(best, hits / seen);
  }
  return best;
}

// figureTimes(ctx, spec) -> a Set of the grid times a figure plays: an onset of a layer at a place where that layer repeats at
// least its share, spec.layers ({ name: least share }) on beats and half beats, spec.quarters on quarter beats (none without
// it). Empty without a grid. Kept on the ctx.
function figureTimes(ctx, spec) {
  if (ctx.figureTimes) return ctx.figureTimes;
  const out = new Set();
  ctx.figureTimes = out;
  const { timing, features } = ctx;
  if (!timing?.snapped) return out;
  const grid = timing.gridPoints(GRID_DIVISION);
  const layers = layersOf(features);
  for (const [name, onsets] of Object.entries(layers)) {
    if (onsets.length === 0) continue;
    const sounds = grid.map((t) => {
      const i = nearestIndex(onsets, t);
      return i >= 0 && Math.abs(onsets[i] - t) <= SNAP_BEATS * beatMsOf(timing, t);
    });
    grid.forEach((t, g) => {
      if (!sounds[g]) return;
      const least = (g % 2 === 1 ? spec.quarters : spec.layers)?.[name];
      if (least !== undefined && repeatShare(sounds, g) >= least) out.add(t);
    });
  }
  return out;
}

module.exports = { figureTimes };
