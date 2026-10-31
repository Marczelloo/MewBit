const {
  BANDS,
  BEAT_TOLERANCE_MS,
  CONFIDENT_TEMPO,
  DENSITY_WINDOW_MS,
  DIFFICULTIES,
  ENERGY_EXPONENT,
  FALLBACK_BEAT_MS,
  GAP_TOLERANCE_MS,
  GENERATOR_VERSION,
  LEAD_IN_MS,
  MERGE_WINDOW_MS,
  MIN_NOTES,
  SILENCE_ENERGY,
} = require("./difficulty");
const { mulberry32, seedFromKey } = require("./rng");
const { starsOf } = require("./stars");

const MIN_USABLE_BEAT_MS = 100; // beat grids tighter than this are treated as garbage
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

// Extends the beat list backwards to 0 and forwards to the end of the track
// with the nearest known beat length, so the grid also covers the edges.
function extendBeats(beats, durationMs) {
  const head = [];
  const headStep = beats[1] - beats[0];
  for (let t = beats[0] - headStep; t > -headStep; t -= headStep) head.push(t);
  head.reverse();
  const tail = [];
  const tailStep = beats[beats.length - 1] - beats[beats.length - 2];
  for (let t = beats[beats.length - 1] + tailStep; t < durationMs + tailStep; t += tailStep) tail.push(t);
  return [...head, ...beats, ...tail];
}

function buildTiming(features, durationMs) {
  const tempo = features.tempo || {};
  const beats = cleanTimes(tempo.beats);
  const usable =
    Number(tempo.confidence) >= CONFIDENT_TEMPO &&
    beats.length >= 2 &&
    beats[1] - beats[0] >= MIN_USABLE_BEAT_MS &&
    beats[beats.length - 1] - beats[beats.length - 2] >= MIN_USABLE_BEAT_MS;

  // Below confidence the raw onset times are kept and the beat data is ignored
  // entirely (no grid, no chords): it is too unreliable to place notes by.
  if (!usable) {
    return { snapped: false, beats: [], downbeats: [], beatMsAt: () => FALLBACK_BEAT_MS, gridPoints: () => [] };
  }

  const extended = extendBeats(beats, durationMs);
  const gridCache = new Map();
  return {
    snapped: true,
    beats: extended,
    downbeats: cleanTimes(tempo.downbeats),
    // Length of the beat containing t.
    beatMsAt(t) {
      const i = Math.min(extended.length - 2, Math.max(0, lowerBound(extended, t + GAP_TOLERANCE_MS + 1e-9) - 1));
      return extended[i + 1] - extended[i];
    },
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
    if (lane < 0) continue;
    for (const o of band.onsets ?? []) {
      if (Number.isFinite(o?.t) && Number.isFinite(o?.s)) all.push({ t: Math.round(o.t), s: clamp01(o.s), band: lane });
    }
  }
  all.sort((a, b) => a.t - b.t || a.band - b.band || b.s - a.s);

  const merged = [];
  let i = 0;
  while (i < all.length) {
    const first = all[i];
    let best = first;
    let j = i + 1;
    while (j < all.length && all[j].t - first.t <= MERGE_WINDOW_MS) {
      if (all[j].s > best.s) best = all[j];
      j++;
    }
    merged.push({ t: best.t, s: best.s, band: best.band });
    i = j;
  }
  return merged;
}

function divisionFor(p, candidate, energy) {
  if (p.fineDiv && candidate.s >= p.fineMinStrength) return p.fineDiv;
  return energy >= p.highEnergyFrom ? p.energyDiv : p.baseDiv;
}

// Snaps each candidate to the difficulty's grid; candidates landing on the same
// grid point collapse into the strongest (ties: the one that moved least).
function snapToGrid(candidates, p, timing, energy) {
  const byTime = new Map();
  for (const c of candidates) {
    const grid = timing.gridPoints(divisionFor(p, c, energy.at(c.t)));
    const idx = nearestIndex(grid, c.t);
    if (idx < 0) continue;
    const t = grid[idx];
    const dist = Math.abs(t - c.t);
    const prev = byTime.get(t);
    if (!prev || c.s > prev.s || (c.s === prev.s && dist < prev.dist)) byTime.set(t, { ...c, t, dist });
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

// Keeps the strongest candidates of each window up to the energy-driven target.
// On the unsnapped path it also enforces the minimum note-to-note gap.
function thin(candidates, p, timing, energy) {
  const windows = new Map();
  for (const c of candidates) {
    const w = Math.floor(c.t / DENSITY_WINDOW_MS);
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w).push(c);
  }

  const minGap = timing.snapped ? 0 : p.minGapBeats * FALLBACK_BEAT_MS;
  const chosenTimes = [];
  const selected = [];
  let carry = 0;

  const conflicts = (t) => {
    const i = lowerBound(chosenTimes, t);
    return (i < chosenTimes.length && chosenTimes[i] - t < minGap) || (i > 0 && t - chosenTimes[i - 1] < minGap);
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
      if (minGap > 0 && conflicts(c.t)) continue;
      chosenTimes.splice(lowerBound(chosenTimes, c.t), 0, c.t);
      selected.push(c);
      taken++;
    }
    carry = Math.min(1, target + carry - taken);
  }
  return selected.sort((a, b) => a.t - b.t);
}

// --- lanes and chords --------------------------------------------------------

function assignLanes(notes, p, timing, energy) {
  const lastUsed = new Array(LANES).fill(NEVER);
  let runLane = -1;
  let runLength = 0;
  const out = [];

  for (const c of notes) {
    const gapMs = p.laneGapBeats * (timing.snapped ? timing.beatMsAt(c.t) : FALLBACK_BEAT_MS);
    const isFree = (lane) => c.t - lastUsed[lane] >= gapMs - GAP_TOLERANCE_MS;
    const allowed = (lane) => isFree(lane) && !(lane === runLane && runLength >= p.maxRun);

    let lane = allowed(c.band) ? c.band : -1;
    if (lane < 0) {
      // The free lane that has been idle the longest (ties: lower index).
      for (let l = 0; l < LANES; l++) {
        if (allowed(l) && (lane < 0 || lastUsed[l] < lastUsed[lane])) lane = l;
      }
    }
    if (lane < 0) continue; // every lane is too recent: skip the note

    runLength = lane === runLane ? runLength + 1 : 1;
    runLane = lane;
    lastUsed[lane] = c.t;
    out.push({ t: c.t, lane });

    const second = chordLane(c, lane, p, gapMs, lastUsed, energy);
    if (second >= 0) {
      lastUsed[second] = c.t;
      out.push({ t: c.t, lane: second });
    }
  }
  return out;
}

// Second chord lane: the mirror of the first, else the nearest free lane; -1 for no chord.
function chordLane(c, lane, p, gapMs, lastUsed, energy) {
  const rule = p.chord;
  if (!rule || c.s < rule.minStrength || energy.at(c.t) < rule.minEnergy) return -1;
  if (!(rule.onDownbeat ? c.isDownbeat : c.isBeat)) return -1;

  const mirror = LANES - 1 - lane;
  let best = -1;
  for (let l = 0; l < LANES; l++) {
    if (l === lane || c.t - lastUsed[l] < gapMs - GAP_TOLERANCE_MS) continue;
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
    highlightMs: features.highlightMs ?? null,
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
