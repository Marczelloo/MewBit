const {
  BANDS,
  BEAT_TOLERANCE_MS,
  DENSITY_WINDOW_MS,
  ENERGY_EXPONENT,
  FALLBACK_BEAT_MS,
  GAP_TOLERANCE_MS,
  LEAD_IN_MS,
  MAX_SNAP_DISTANCE_MS,
  MERGE_WINDOW_MS,
  SILENCE_ENERGY,
  SNAPPED_FLOOR_SLACK,
} = require("./difficulty");
const { clamp01, lowerBound, nearestIndex } = require("./util");

const LANES = 4;
const NEVER = -1e9;
const BAR_BEATS = 4; // the tie-break looks at the previous bar

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

// Minimum gap before a note: the difficulty's floor, raised to the grid
// division the note would get (so the finest gaps stay reserved for strong
// onsets and loud parts, snapped or not), in 120-BPM beats. A snapped note may
// sit a little under it only where the track's own beat is faster than 120 BPM,
// so the grid itself stays playable.
function minNoteGap(c, p, timing, energy) {
  const beats = Math.max(p.minGapBeats, 1 / divisionFor(p, c, energy.at(c.t)));
  const floor = beats * FALLBACK_BEAT_MS;
  const gap = c.snapped ? Math.min(floor, SNAPPED_FLOOR_SLACK * beats * timing.medianMs) : floor;
  // The tempo-relative gap shrinks at high BPM; this keeps a human-playable minimum.
  return Math.max(gap, p.minNoteGapMs ?? 0);
}

function keyLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// Among candidates of exactly equal rank, picks the next one to try. A fixed
// rule instead of a random draw (it only looks at what has been chosen so far):
//   1. the candidate whose hand (lanes 0-1 / 2-3, by its band's lane) has fewer
//      chosen notes over the previous bar before it,
//   2. then the one whose lane differs from the previous chosen note's lane,
//   3. then the lower lane index,
//   4. then the earlier one (times are unique, so this settles it).
function pickTied(group, chosenTimes, chosenLanes, barMs) {
  let best = -1;
  let bestKey = null;
  for (let g = 0; g < group.length; g++) {
    const c = group[g];
    const at = lowerBound(chosenTimes, c.t);
    const hand = c.band >> 1;
    let load = 0;
    for (let i = at - 1; i >= 0 && chosenTimes[i] >= c.t - barMs; i--) {
      if (chosenLanes[i] >> 1 === hand) load++;
    }
    const sameAsPrev = at > 0 && chosenLanes[at - 1] === c.band ? 1 : 0;
    const key = [load, sameAsPrev, c.band, c.t];
    if (bestKey === null || keyLess(key, bestKey)) {
      best = g;
      bestKey = key;
    }
  }
  return best;
}

// Keeps the strongest candidates of each window up to the energy-driven target,
// never closer together than the minimum note gap. Equal-rank candidates are
// ordered by pickTied (one bar = 4 local beats, 2000 ms without a grid).
function thin(candidates, p, timing, energy) {
  const windows = new Map();
  for (const c of candidates) {
    const w = Math.floor(c.t / DENSITY_WINDOW_MS);
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w).push(c);
  }

  const barMs = BAR_BEATS * timing.medianMs;
  const chosenTimes = []; // sorted, with the base lane of each chosen note alongside
  const chosenLanes = [];
  const selected = [];
  let carry = 0;

  const conflicts = (c) => {
    // The rounding slack applies to the tempo-relative gap only, not the absolute floor.
    const floor = Math.max(minNoteGap(c, p, timing, energy) - GAP_TOLERANCE_MS, p.minNoteGapMs ?? 0);
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
    const ranked = windows.get(w).sort((a, b) => b.rank - a.rank || a.t - b.t);

    let taken = 0;
    for (let g = 0; g < ranked.length && taken < quota; ) {
      let end = g + 1;
      while (end < ranked.length && ranked[end].rank === ranked[g].rank) end++;
      const group = ranked.slice(g, end);
      g = end;
      while (group.length > 0 && taken < quota) {
        const c = group.length === 1 ? group.pop() : group.splice(pickTied(group, chosenTimes, chosenLanes, barMs), 1)[0];
        if (conflicts(c)) continue;
        const at = lowerBound(chosenTimes, c.t);
        chosenTimes.splice(at, 0, c.t);
        chosenLanes.splice(at, 0, c.band);
        selected.push(c);
        taken++;
      }
    }
    carry = Math.min(1, target + carry - taken);
  }
  return selected.sort((a, b) => a.t - b.t);
}

// --- lanes and chords --------------------------------------------------------

// Same-lane gap for a note: in local beats when its time was snapped, else in
// 120-BPM beats, but never under the difficulty's absolute floor (a jack
// faster than that is not playable at any tempo).
function laneGapMs(c, p, timing) {
  return Math.max(p.laneGapBeats * (c.snapped ? timing.beatMsAt(c.t) : FALLBACK_BEAT_MS), p.minLaneGapMs);
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
    const allowed = (lane) => c.t - lastUsed[lane] >= Math.max(gapMs - GAP_TOLERANCE_MS, p.minLaneGapMs) && runs[lane] < p.maxRun;

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

// The v3 "band path": onsets of the four frequency bands -> candidates -> snap
// to the beat grid -> thin by energy-driven density -> lanes and chords. Only
// the notes in [fromMs, toMs) are produced; thinning and lane state start fresh
// at the window start. `energyAt` is an energyLookup() result ({ hopMs, at }); a
// bare function (t -> energy) is accepted too.
function bandPathNotes(features, timing, diff, energyAt, { fromMs = 0, toMs = Infinity } = {}) {
  const energy = typeof energyAt === "function" ? { hopMs: 500, at: energyAt } : energyAt;
  const durationMs = Math.round(features.durationMs);

  let candidates = buildCandidates(features);
  if (timing.snapped) candidates = snapToGrid(candidates, diff, timing, energy);

  const from = Math.max(fromMs, LEAD_IN_MS);
  candidates = candidates.filter((c) => c.t >= from && c.t < toMs && c.t <= durationMs && energy.at(c.t) >= SILENCE_ENERGY);
  for (const c of candidates) {
    c.isBeat = isNear(timing.beats, c.t);
    c.isDownbeat = isNear(timing.downbeats, c.t);
    const level = c.isDownbeat ? 1 : c.isBeat ? 0.5 : 0;
    c.rank = c.s * diff.bandBias[c.band] + diff.beatBias * level;
  }

  const notes = assignLanes(thin(candidates, diff, timing, energy), diff, timing, energy);
  return notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
}

module.exports = { bandPathNotes };
