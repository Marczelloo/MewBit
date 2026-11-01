const {
  BEAT_INTERVAL_TOLERANCE,
  BEAT_TOLERANCE_MS,
  CONFIDENT_TEMPO,
  FALLBACK_BEAT_MS,
  GAP_TOLERANCE_MS,
} = require("./difficulty");
const { strongOnsetRate } = require("./busyness");
const { cleanTimes, lowerBound, median, nearestIndex } = require("./util");

const MIN_USABLE_BEAT_MS = 100; // a median beat length below this means garbage beats
const FOLD_MIN_BPM = 70; // the beat grid is folded into this range
const FOLD_MAX_BPM = 200;
// A tracker that lands on half the real tempo (drum & bass at 87 instead of 174) puts
// a slow beat under a dense onset stream. Below HALF_TIME_BELOW_BPM, a song with at
// least this many strong onsets per detected beat is doubled back: its grid was the
// half-time one. (Fixtures: the half-time songs sit at 9.6-10.4, a sparse ballad ~5.)
const HALF_TIME_BELOW_BPM = 95; // doubled this stays under FOLD_MAX_BPM
const HALF_TIME_ONSETS_PER_BEAT = 8;
const MAX_DOUBLING = 8; // a tempo needing more than 8x doubling is not a tempo at all

// --- timing: beat grid, or none when the tempo is not trustworthy -----------

// Halves/doubles a tempo until it lies in 70-200 BPM. `factor` is the power of
// two the tempo was multiplied by (0.5 = every second beat is used). Anything
// that is not a positive finite tempo is returned untouched.
// `onsetsPerBeat` (strong onsets per detected beat, optional) lets a busy slow
// tempo be doubled once more, see HALF_TIME_ONSETS_PER_BEAT.
function foldTempo(bpm, onsetsPerBeat = 0) {
  if (!Number.isFinite(bpm) || !(bpm > 0)) return { bpm, factor: 1 };
  let factor = 1;
  while (bpm * factor > FOLD_MAX_BPM) factor /= 2;
  while (bpm * factor < FOLD_MIN_BPM) factor *= 2;
  if (bpm * factor < HALF_TIME_BELOW_BPM && onsetsPerBeat >= HALF_TIME_ONSETS_PER_BEAT) factor *= 2;
  return { bpm: bpm * factor, factor };
}

// Extends the beat list backwards to 0 and forwards to the end of the track
// with the median beat length, so the grid also covers the edges. Both loops
// are bounded by the track length, whatever the beats claim.
function extendBeats(beats, stepMs, durationMs) {
  const maxSteps = Math.ceil(durationMs / stepMs) + 2;
  const head = [];
  for (let t = beats[0] - stepMs; t > -stepMs && head.length < maxSteps; t -= stepMs) head.push(t);
  head.reverse();
  const tail = [];
  const last = beats[beats.length - 1];
  for (let t = last + stepMs; t < durationMs + stepMs && tail.length < maxSteps; t += stepMs) tail.push(t);
  return [...head, ...beats, ...tail];
}

const NO_TIMING = Object.freeze({
  snapped: false,
  beats: [],
  downbeats: [],
  medianMs: FALLBACK_BEAT_MS,
  foldFactor: 1,
  gridPoints: () => [],
  intervalOk: () => false,
  beatMsAt: () => FALLBACK_BEAT_MS,
});

// factor > 1 (2, 4, ...): evenly spaced points are inserted between every pair
// of beats; the original beats, and so the downbeats, all stay.
function doubleBeats(beats, factor) {
  const out = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const step = (beats[i + 1] - beats[i]) / factor;
    for (let k = 0; k < factor; k++) out.push(Math.round(beats[i] + k * step));
  }
  out.push(beats[beats.length - 1]);
  return [...new Set(out)];
}

// factor < 1 (1/2, 1/4, ...): every (1/factor)-th beat is kept. The kept beats
// are phase-locked to the first downbeat (so that downbeat always survives); with
// no usable downbeat the phase starts at beat 0.
// Downbeats are the kept beats that were downbeats; when none are left (or none
// were given) every 4th kept beat becomes one.
function halveBeats(beats, downbeats, factor) {
  const stride = Math.round(1 / factor);
  let start = 0;
  if (downbeats.length > 0) {
    const i = nearestIndex(beats, downbeats[0]);
    if (i >= 0 && Math.abs(beats[i] - downbeats[0]) <= BEAT_TOLERANCE_MS) start = i % stride;
  }
  const kept = beats.filter((_, i) => i % stride === start);
  let keptDownbeats = kept.filter((t) => {
    const i = nearestIndex(downbeats, t);
    return i >= 0 && Math.abs(downbeats[i] - t) <= BEAT_TOLERANCE_MS;
  });
  if (keptDownbeats.length === 0) keptDownbeats = kept.filter((_, i) => i % 4 === 0);
  return { beats: kept, downbeats: keptDownbeats };
}

function buildTiming(features, durationMs) {
  const tempo = features.tempo || {};
  const rawBeats = cleanTimes(tempo.beats);
  if (!(Number(tempo.confidence) >= CONFIDENT_TEMPO) || rawBeats.length < 2) return NO_TIMING;

  const rawMedianMs = median(rawBeats.slice(1).map((t, i) => t - rawBeats[i]));
  // Below confidence (or with a nonsensical grid) the raw onset times are kept
  // and the beat data is ignored entirely: no grid, no chords.
  if (!(rawMedianMs >= MIN_USABLE_BEAT_MS)) return NO_TIMING;

  // Tempo folding: the grid is built at 70-200 BPM whatever the tracker reported.
  const onsetsPerBeat = (strongOnsetRate(features) * rawMedianMs) / 1000;
  const { factor } = foldTempo(60000 / rawMedianMs, onsetsPerBeat);
  if (factor > MAX_DOUBLING) return NO_TIMING;
  let beats = rawBeats;
  let downbeats = cleanTimes(tempo.downbeats);
  if (factor > 1) {
    beats = doubleBeats(rawBeats, factor);
  } else if (factor < 1) {
    ({ beats, downbeats } = halveBeats(rawBeats, downbeats, factor));
    if (beats.length < 2) return NO_TIMING;
  }
  const medianMs = factor === 1 ? rawMedianMs : median(beats.slice(1).map((t, i) => t - beats[i]));
  if (!(medianMs >= MIN_USABLE_BEAT_MS)) return NO_TIMING;

  const extended = extendBeats(beats, medianMs, durationMs);
  const gridCache = new Map();
  const beatMsAt = (t) => {
    const i = Math.min(extended.length - 2, Math.max(0, lowerBound(extended, t + GAP_TOLERANCE_MS + 1e-9) - 1));
    return extended[i + 1] - extended[i];
  };
  return {
    snapped: true,
    beats: extended,
    downbeats,
    medianMs,
    foldFactor: factor,
    // A local beat length is only trusted when it is close to the median one.
    intervalOk: (t) => Math.abs(beatMsAt(t) - medianMs) <= BEAT_INTERVAL_TOLERANCE * medianMs,
    // Length of the beat containing t, clamped to the median +-25% for gap maths.
    beatMsAt: (t) =>
      Math.min((1 + BEAT_INTERVAL_TOLERANCE) * medianMs, Math.max((1 - BEAT_INTERVAL_TOLERANCE) * medianMs, beatMsAt(t))),
    // Subdivision points interpolated between consecutive (non-uniform) beats.
    gridPoints(div) {
      if (!gridCache.has(div)) {
        const points = [];
        for (let i = 0; i + 1 < extended.length; i++) {
          const step = (extended[i + 1] - extended[i]) / div;
          for (let k = 0; k < div; k++) points.push(Math.round(extended[i] + k * step));
        }
        points.push(extended[extended.length - 1]);
        gridCache.set(div, points);
      }
      return gridCache.get(div);
    },
  };
}

function energyLookup(features) {
  const values = features.energy?.values ?? [];
  const hopMs = features.energy?.hopMs > 0 ? features.energy.hopMs : 500;
  return {
    hopMs,
    at(t) {
      if (values.length === 0) return 0;
      const i = Math.min(values.length - 1, Math.max(0, Math.floor(t / hopMs)));
      return Number.isFinite(values[i]) ? values[i] : 0;
    },
  };
}

module.exports = { buildTiming, energyLookup, foldTempo };
