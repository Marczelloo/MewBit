const {
  BANDS,
  BEAT_INTERVAL_TOLERANCE,
  BEAT_TOLERANCE_MS,
  CONFIDENT_TEMPO,
  DENSITY_WINDOW_MS,
  DIFFICULTIES,
  ENERGY_EXPONENT,
  FALLBACK_BEAT_MS,
  GAP_TOLERANCE_MS,
  GENERATOR_VERSION,
  LEAD_IN_MS,
  MAX_SNAP_DISTANCE_MS,
  MERGE_WINDOW_MS,
  MIN_NOTES,
  SILENCE_ENERGY,
  SNAPPED_FLOOR_SLACK,
} = require("./difficulty");
const { mulberry32, seedFromKey } = require("./rng");
const { starsOf } = require("./stars");

const MIN_USABLE_BEAT_MS = 100; // a median beat length below this means garbage beats
const LANES = 4;
const NEVER = -1e9;

// --- small helpers -----------------------------------------------------------

function lowerBound(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Index of the value nearest to x (ties go to the earlier one), or -1 when empty.
function nearestIndex(sorted, x) {
  if (sorted.length === 0) return -1;
  const i = lowerBound(sorted, x);
  if (i === 0) return 0;
  if (i === sorted.length) return i - 1;
  return x - sorted[i - 1] <= sorted[i] - x ? i - 1 : i;
}

function cleanTimes(list) {
  const times = (Array.isArray(list) ? list : []).filter(Number.isFinite).map(Math.round);
  return [...new Set(times)].sort((a, b) => a - b);
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// --- timing: beat grid, or none when the tempo is not trustworthy -----------

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  gridPoints: () => [],
  intervalOk: () => false,
  beatMsAt: () => FALLBACK_BEAT_MS,
});

function buildTiming(features, durationMs) {
  const tempo = features.tempo || {};
  const beats = cleanTimes(tempo.beats);
  if (!(Number(tempo.confidence) >= CONFIDENT_TEMPO) || beats.length < 2) return NO_TIMING;

  const medianMs = median(beats.slice(1).map((t, i) => t - beats[i]));
  // Below confidence (or with a nonsensical grid) the raw onset times are kept
  // and the beat data is ignored entirely: no grid, no chords.
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
    downbeats: cleanTimes(tempo.downbeats),
    medianMs,
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

// --- candidates --------------------------------------------------------------

// Union of every band's onsets, merged within MERGE_WINDOW_MS. The strongest
// onset of a cluster supplies the time, strength and (base) lane.
function buildCandidates(features) {
  const all = [];
  for (const band of features.bands) {
    const lane = BANDS.indexOf(band?.name);
    if (lane < 0 || !Array.isArray(band.onsets)) continue;
    for (const o of band.onsets) {
      if (Number.isFinite(o?.t) && Number.isFinite(o?.s)) all.push({ t: Math.round(o.t), s: clamp01(o.s), band: lane });
    }
  }
  all.sort((a, b) => a.t - b.t || a.band - b.band || b.s - a.s);

  const merged = [];
  let i = 0;
  while (i < all.length) {
    const first = all[i];
    let best = first;
    const perBand = new Array(BANDS.length).fill(-1);
    let j = i;
    while (j < all.length && all[j].t - first.t <= MERGE_WINDOW_MS) {
      if (all[j].s > best.s) best = all[j];
      perBand[all[j].band] = Math.max(perBand[all[j].band], all[j].s);
      j++;
    }
    // Runner-up band (lower index wins ties), -1 when only one band fired.
    let alt = -1;
    for (let b = 0; b < perBand.length; b++) {
      if (b !== best.band && perBand[b] >= 0 && (alt < 0 || perBand[b] > perBand[alt])) alt = b;
    }
    merged.push({ t: best.t, s: best.s, band: best.band, alt });
    i = j;
  }
  return merged;
}

function divisionFor(p, candidate, energy) {
  if (p.fineDiv && candidate.s >= p.fineMinStrength) return p.fineDiv;
  return energy >= p.highEnergyFrom ? p.energyDiv : p.baseDiv;
}

// Snaps each candidate to the difficulty's grid, but only where the grid can be
// trusted: the grid point is close and the local beat length is regular. Other
// candidates keep their raw time and follow the unsnapped rules. Candidates on
// the same time collapse into the strongest (ties: the one that moved least).
function snapToGrid(candidates, p, timing, energy) {
  const byTime = new Map();
  for (const c of candidates) {
    const grid = timing.gridPoints(divisionFor(p, c, energy.at(c.t)));
    const idx = nearestIndex(grid, c.t);
    const trusted =
      idx >= 0 &&
      Math.abs(grid[idx] - c.t) <= MAX_SNAP_DISTANCE_MS &&
      timing.intervalOk(c.t) &&
      timing.intervalOk(grid[idx]);
    const snapped = { ...c, t: trusted ? grid[idx] : c.t, snapped: trusted };
    snapped.dist = Math.abs(snapped.t - c.t);
    const prev = byTime.get(snapped.t);
    if (!prev || c.s > prev.s || (c.s === prev.s && snapped.dist < prev.dist)) byTime.set(snapped.t, snapped);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function isNear(sorted, t) {
  const i = nearestIndex(sorted, t);
  return i >= 0 && Math.abs(sorted[i] - t) <= BEAT_TOLERANCE_MS;
}

// --- density -----------------------------------------------------------------

// Mean of energy^exponent over the hops of a window; silent hops count as 0.
function windowPower(windowIndex, energy) {
  let sum = 0;
  let n = 0;
  for (let t = windowIndex * DENSITY_WINDOW_MS; t < (windowIndex + 1) * DENSITY_WINDOW_MS; t += energy.hopMs) {
    const e = energy.at(t);
    sum += e >= SILENCE_ENERGY ? Math.pow(e, ENERGY_EXPONENT) : 0;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

// Minimum gap between any two notes: 1/2, 1/4 or 1/8 beat at 120 BPM. A snapped
// note may sit a little under it only where the track's own beat is faster than
// 120 BPM, so the grid itself stays playable.
function minNoteGap(c, p, timing) {
  const floor = p.minGapBeats * FALLBACK_BEAT_MS;
  return c.snapped ? Math.min(floor, SNAPPED_FLOOR_SLACK * p.minGapBeats * timing.medianMs) : floor;
}

// Keeps the strongest candidates of each window up to the energy-driven target,
// never closer together than the minimum note gap.
function thin(candidates, p, timing, energy) {
  const windows = new Map();
  for (const c of candidates) {
    const w = Math.floor(c.t / DENSITY_WINDOW_MS);
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w).push(c);
  }

  const chosenTimes = [];
  const selected = [];
  let carry = 0;

  const conflicts = (c) => {
    const floor = minNoteGap(c, p, timing) - GAP_TOLERANCE_MS;
    const i = lowerBound(chosenTimes, c.t);
    return (i < chosenTimes.length && chosenTimes[i] - c.t < floor) || (i > 0 && c.t - chosenTimes[i - 1] < floor);
  };

  for (const w of [...windows.keys()].sort((a, b) => a - b)) {
    const power = windowPower(w, energy);
    if (power === 0) {
      carry = 0;
      continue;
    }
    const target = p.maxNps * power * (DENSITY_WINDOW_MS / 1000);
    const quota = Math.floor(target + carry + 1e-9);
    const ranked = windows.get(w).sort((a, b) => b.rank - a.rank || b.tie - a.tie);

    let taken = 0;
    for (const c of ranked) {
      if (taken >= quota) break;
      if (conflicts(c)) continue;
      chosenTimes.splice(lowerBound(chosenTimes, c.t), 0, c.t);
      selected.push(c);
      taken++;
    }
    carry = Math.min(1, target + carry - taken);
  }
  return selected.sort((a, b) => a.t - b.t);
}

// --- lanes and chords --------------------------------------------------------

// Same-lane gap for a note: in local beats when its time was snapped, else in
// 120-BPM beats.
function laneGapMs(c, p, timing) {
  return p.laneGapBeats * (c.snapped ? timing.beatMsAt(c.t) : FALLBACK_BEAT_MS);
}

function assignLanes(notes, p, timing, energy) {
  const lastUsed = new Array(LANES).fill(NEVER);
  const runs = new Array(LANES).fill(0); // consecutive note moments each lane has appeared in
  let prevT = NEVER;
  let streamIndex = 0;
  let prevLane = -1;
  const out = [];

  for (const c of notes) {
    const gapMs = laneGapMs(c, p, timing);
    const allowed = (lane) => c.t - lastUsed[lane] >= gapMs - GAP_TOLERANCE_MS && runs[lane] < p.maxRun;

    // Hard alternates between the two loudest bands inside a stream of close notes.
    let want = c.band;
    if (p.alternation) {
      const streamGap = p.alternation.maxGapBeats * (c.snapped ? timing.beatMsAt(c.t) : FALLBACK_BEAT_MS);
      streamIndex = c.t - prevT <= streamGap + GAP_TOLERANCE_MS ? streamIndex + 1 : 0;
      if (streamIndex % 2 === 1 && c.alt >= 0) want = c.alt;
      // ...and never repeats a lane when the runner-up band offers another one.
      if (want === prevLane && c.alt >= 0 && c.alt !== prevLane) want = c.alt;
    }
    prevT = c.t;

    let lane = allowed(want) ? want : -1;
    if (lane < 0 && want !== c.band && allowed(c.band)) lane = c.band;
    if (lane < 0) {
      // The free lane that has been idle the longest (ties: lower index).
      for (let l = 0; l < LANES; l++) {
        if (allowed(l) && (lane < 0 || lastUsed[l] < lastUsed[lane])) lane = l;
      }
    }
    if (lane < 0) continue; // every lane is too recent or too repeated: skip the note

    prevLane = lane;
    const second = chordLane(c, lane, p, allowed, energy);
    const used = second >= 0 ? [lane, second] : [lane];
    for (let l = 0; l < LANES; l++) runs[l] = used.includes(l) ? runs[l] + 1 : 0;
    for (const l of used) {
      lastUsed[l] = c.t;
      out.push({ t: c.t, lane: l });
    }
  }
  return out;
}

// Second chord lane: the mirror of the first, else the nearest allowed lane; -1 for no chord.
function chordLane(c, lane, p, allowed, energy) {
  const rule = p.chord;
  if (!rule || c.s < rule.minStrength || energy.at(c.t) < rule.minEnergy) return -1;
  if (!(rule.onDownbeat ? c.isDownbeat : c.isBeat)) return -1;

  const mirror = LANES - 1 - lane;
  let best = -1;
  for (let l = 0; l < LANES; l++) {
    if (l === lane || !allowed(l)) continue;
    if (best < 0 || Math.abs(l - mirror) < Math.abs(best - mirror)) best = l;
  }
  return best;
}

// --- public API --------------------------------------------------------------

function generateChart(features, difficulty, audioKey) {
  const p = DIFFICULTIES[difficulty];
  if (!p) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (!features || !Array.isArray(features.bands) || !Number.isFinite(features.durationMs)) return null;

  const durationMs = Math.round(features.durationMs);
  const timing = buildTiming(features, durationMs);
  const energy = energyLookup(features);
  const rng = mulberry32(seedFromKey(audioKey));

  let candidates = buildCandidates(features);
  if (timing.snapped) candidates = snapToGrid(candidates, p, timing, energy);

  candidates = candidates.filter((c) => c.t >= LEAD_IN_MS && c.t <= durationMs && energy.at(c.t) >= SILENCE_ENERGY);
  for (const c of candidates) {
    c.isBeat = isNear(timing.beats, c.t);
    c.isDownbeat = isNear(timing.downbeats, c.t);
    const level = c.isDownbeat ? 1 : c.isBeat ? 0.5 : 0;
    c.rank = c.s * p.bandBias[c.band] + p.beatBias * level;
    c.tie = rng(); // deterministic tie-break, drawn in time order
  }

  const notes = assignLanes(thin(candidates, p, timing, energy), p, timing, energy);
  if (notes.length < MIN_NOTES) return null;
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);

  return {
    version: GENERATOR_VERSION,
    audioKey,
    difficulty,
    durationMs,
    stars: starsOf({ notes }),
    highlightMs: Number.isFinite(features.highlightMs) && features.highlightMs >= 0 && features.highlightMs <= durationMs
      ? features.highlightMs
      : null,
    notes,
  };
}

function generateAll(features, audioKey) {
  const easy = generateChart(features, "easy", audioKey);
  const normal = generateChart(features, "normal", audioKey);
  const hard = generateChart(features, "hard", audioKey);
  return easy && normal && hard ? { easy, normal, hard } : null;
}

module.exports = { GENERATOR_VERSION, generateAll, generateChart, starsOf };
