// The beat grid, fitted to the onsets. The tracker's tempo is right, but on most constant-tempo train songs its beats
// stand half a beat out or slip, and they wobble, so equal gaps between notes differ. This keeps its tempo as the start
// and refits the rest on the cached onsets, in constant-tempo stretches:
//   a windowed tempogram with Viterbi: one tempo per stretch, a change only where it pays
//   per stretch: the exact period, and where the quarter grid lies, from the phase coherence of the onsets
//   phase steps at one tempo only where the quarter grid really moves
//   which of the four quarter phases is the beat: where the highmid onsets fall
//   the bars: the tracker's downbeats vote for a beat modulo 4
// Fails on smooth rubato (median 36 ms on such songs), and cannot tell that it failed.
const { cleanTimes, lowerBound } = require("./util");

const TAU = 2 * Math.PI;
const MIN_BEATS = 16; // fewer tracked beats give no tempo to start from
const MIN_ONSETS_PER_BEAT = 0.5; // fewer onsets say nothing about where the beats lie
const MIN_BEAT_ONSETS = 16; // fewer highmid onsets cannot tell the beat from the offbeat
const BAND_WEIGHTS = [1, 1, 1, 0.7];
const MAX_ONSET_WEIGHT = 3; // an onset's strength over its band's median counts up to this
const BEAT_BAND = 2; // highmid: the band whose onsets name the beat, the best single source on the train songs

// Tempogram
const WINDOW_MS = 8000;
const HOP_MS = 2000;
const COARSE_STEP = 0.004; // log steps between the tempi tried
const COARSE_SPAN = 0.42; // ...this far either side of the tracker's tempo
const SWITCH_PENALTY = 1.2; // a jump to another tempo
const STEP_PENALTY = 0.25; // a drift to the next tempo tried
const OFF_TEMPO_PRIOR = 0.05; // the far end of the span loses this
const SAME_TEMPO_WITHIN = 0.006; // log distance
const MIN_STRETCH_MS = 6000;
// A stretch at a simple ratio of the main tempo is usually the same tempo with other subdivisions (triplets).
const SUBDIVISION_RATIOS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 4 / 3, 3 / 2, 2, 3];
const RATIO_WITHIN = 0.012; // log distance

// Phase within a stretch
const PHASE_WINDOW_BEATS = 8;
const PHASE_STEP_MS = 14; // a smaller step of the quarter grid is not a step
const MIN_PHASE_BEATS = 16;
const MERGE_KEEP = 0.85; // two parts are one tempo when one period keeps this share of their lock
const MERGE_MIN_ON_GRID = -0.8; // a part this far off the pair's quarter grid (-1 is halfway between its lines) stays apart: the sums above always let a long part swallow a thin one
const MAX_MERGE_REFINES = 64; // the merge stops trying after this many periods (a Raspberry Pi runs this)

// Which phase is the beat
const BEAT_WINDOW_BEATS = 8;
const BEAT_SWITCH_PENALTY = 2;
const KERNEL_SIGMA_MS = 12;
const MIN_BEAT_GAP = 0.45; // of a beat, where two stretches meet

// Bars
const BAR_WINDOW_BEATS = 32;
const BAR_SWITCH_PENALTY = 1.5;
const VOTE_WITHIN = 0.55; // of a beat
const BEATS_PER_BAR = 4;

// The upper middle, as the grid was fitted with.
const middle = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : 0;
};

const bandOnsets = (band) => (Array.isArray(band?.onsets) ? band.onsets : []).filter((o) => Number.isFinite(o?.t) && Number.isFinite(o?.s));

// Every band's onsets as { t, w }: its strength over the band's median, capped.
function weighted(onsets) {
  const typical = middle(onsets.map((o) => o.s)) || 1;
  return onsets.map((o) => ({ t: o.t, w: Math.min(o.s / typical, MAX_ONSET_WEIGHT) }));
}

// All bands' onsets by time, in arrays: this runs over them many times.
function onsetsOf(features) {
  const all = [];
  (Array.isArray(features.bands) ? features.bands : []).forEach((band, b) => {
    for (const o of weighted(bandOnsets(band))) all.push({ t: o.t, w: o.w * (BAND_WEIGHTS[b] ?? 1) });
  });
  all.sort((x, y) => x.t - y.t);
  return { t: Float64Array.from(all, (o) => o.t), w: Float64Array.from(all, (o) => o.w) };
}

// How well the onsets from..to sit on a comb of period P: |sum w e^(2 pi i h t / P)| over harmonics 1, 2 and 4. The second
// and fourth harmonic come from the first by doubling the angle, which saves most of the trigonometry. Onsets of several
// bands often share a time: the angle's cosine and sine are taken once for such a run (the same numbers, summed in the same order).
function combScore(on, from, to, P) {
  const k = TAU / P;
  let re1 = 0, im1 = 0, re2 = 0, im2 = 0, re4 = 0, im4 = 0;
  let at = NaN, c1 = 0, s1 = 0, c2 = 0, s2 = 0, c4 = 0, s4 = 0;
  for (let i = from; i < to; i++) {
    const t = on.t[i], w = on.w[i];
    if (t !== at) {
      at = t;
      const x = k * t;
      c1 = Math.cos(x); s1 = Math.sin(x);
      c2 = c1 * c1 - s1 * s1; s2 = 2 * s1 * c1;
      c4 = c2 * c2 - s2 * s2; s4 = 2 * s2 * c2;
    }
    re1 += w * c1; im1 += w * s1;
    re2 += w * c2; im2 += w * s2;
    re4 += w * c4; im4 += w * s4;
  }
  return Math.hypot(re1, im1) * 0.5 + Math.hypot(re2, im2) + Math.hypot(re4, im4);
}

// combScore of several overlapping windows [from[w], to[w]) at one period, the angles of the onsets taken once for all of
// them (a window of the tempogram shares three quarters of its onsets with the next ones). `sums` of a window of weight 0 is 0.
function combScores(on, froms, tos, P, trig) {
  const k = TAU / P, lo = froms[0], hi = tos[tos.length - 1];
  let at = NaN, c1 = 0, s1 = 0, c2 = 0, s2 = 0, c4 = 0, s4 = 0;
  for (let i = lo; i < hi; i++) {
    const t = on.t[i];
    if (t !== at) {
      at = t;
      const x = k * t;
      c1 = Math.cos(x); s1 = Math.sin(x);
      c2 = c1 * c1 - s1 * s1; s2 = 2 * s1 * c1;
      c4 = c2 * c2 - s2 * s2; s4 = 2 * s2 * c2;
    }
    const o = (i - lo) * 6;
    trig[o] = c1; trig[o + 1] = s1; trig[o + 2] = c2; trig[o + 3] = s2; trig[o + 4] = c4; trig[o + 5] = s4;
  }
  return froms.map((from, w) => {
    let re1 = 0, im1 = 0, re2 = 0, im2 = 0, re4 = 0, im4 = 0;
    for (let i = from; i < tos[w]; i++) {
      const o = (i - lo) * 6, wt = on.w[i];
      re1 += wt * trig[o]; im1 += wt * trig[o + 1];
      re2 += wt * trig[o + 2]; im2 += wt * trig[o + 3];
      re4 += wt * trig[o + 4]; im4 += wt * trig[o + 5];
    }
    return Math.hypot(re1, im1) * 0.5 + Math.hypot(re2, im2) + Math.hypot(re4, im4);
  });
}

const bestIndex = (values) => values.reduce((best, x, i) => (x > values[best] ? i : best), 0);

// The tempo per window, with a cost for changing it.
function tempoPath(windows, periods, P0) {
  const J = periods.length;
  const local = (w, j) => windows[w][j] - (OFF_TEMPO_PRIOR * Math.abs(Math.log(periods[j] / P0))) / COARSE_SPAN;
  let cost = new Float64Array(J);
  for (let j = 0; j < J; j++) cost[j] = local(0, j);
  const back = [];
  for (let w = 1; w < windows.length; w++) {
    const prevBest = bestIndex(cost);
    const next = new Float64Array(J), from = new Int32Array(J);
    for (let j = 0; j < J; j++) {
      let best = cost[prevBest] - SWITCH_PENALTY, bestJ = prevBest;
      for (let d = -1; d <= 1; d++) {
        const i = j + d;
        if (i < 0 || i >= J) continue;
        const c = cost[i] - (d ? STEP_PENALTY : 0);
        if (c > best) { best = c; bestJ = i; }
      }
      next[j] = best + local(w, j);
      from[j] = bestJ;
    }
    cost = next;
    back.push(from);
  }
  const path = new Array(windows.length);
  path[windows.length - 1] = bestIndex(cost);
  for (let w = windows.length - 2; w >= 0; w--) path[w] = back[w][path[w + 1]];
  return path;
}

// Stretches of one tempo over the song: [{ a, b, P }].
function tempoStretches(on, P0, startMs, endMs) {
  const steps = Math.round(COARSE_SPAN / COARSE_STEP);
  const periods = [];
  for (let j = -steps; j <= steps; j++) periods.push(P0 * Math.exp(j * COARSE_STEP));
  const starts = [], froms = [], tos = [], sums = [];
  for (let a = startMs; a + HOP_MS < endMs; a += HOP_MS) {
    const from = lowerBound(on.t, a), to = lowerBound(on.t, a + WINDOW_MS);
    let sum = 0;
    for (let i = from; i < to; i++) sum += on.w[i];
    starts.push(a);
    froms.push(from);
    tos.push(to);
    sums.push(sum);
  }
  // windows[w][j]: window w's comb score at period j, 1 when every onset sits on the comb. The angles are taken once per period.
  const windows = starts.map(() => new Array(periods.length));
  if (starts.length) {
    const trig = new Float64Array(6 * Math.max(0, tos[tos.length - 1] - froms[0]));
    periods.forEach((P, j) => {
      const scores = combScores(on, froms, tos, P, trig);
      for (let w = 0; w < starts.length; w++) windows[w][j] = sums[w] > 0 ? scores[w] / sums[w] / 2.5 : 0;
    });
  }
  if (!windows.length) return [{ a: startMs, b: endMs, P: P0 }];
  const path = tempoPath(windows, periods, P0);
  const runs = [];
  path.forEach((j, w) => {
    const P = periods[j], last = runs[runs.length - 1];
    if (last && Math.abs(Math.log(P / last.P)) <= SAME_TEMPO_WITHIN) {
      last.all.push(P);
      last.P = middle(last.all);
      last.lastWindow = w;
    } else runs.push({ P, all: [P], firstWindow: w, lastWindow: w });
  });
  const mid = (w) => starts[w] + WINDOW_MS / 2; // a window speaks for its middle
  const stretches = runs.map((r, i) => ({
    P: r.P,
    a: i === 0 ? startMs : (mid(runs[i - 1].lastWindow) + mid(r.firstWindow)) / 2,
    b: i === runs.length - 1 ? endMs : (mid(r.lastWindow) + mid(runs[i + 1].firstWindow)) / 2,
  }));
  // A short stretch goes to its neighbour.
  for (let i = 0; i < stretches.length && stretches.length > 1; ) {
    if (stretches[i].b - stretches[i].a >= MIN_STRETCH_MS) { i++; continue; }
    const left = stretches[i - 1], right = stretches[i + 1];
    if (left && (!right || left.b - left.a >= right.b - right.a)) left.b = stretches[i].b;
    else right.a = stretches[i].a;
    stretches.splice(i, 1);
    i = 0;
  }
  return stretches;
}

function keepMainTempo(stretches) {
  if (stretches.length < 2) return stretches;
  const total = new Map();
  for (const s of stretches) total.set(s.P, (total.get(s.P) ?? 0) + s.b - s.a);
  const main = [...total.entries()].sort((x, y) => y[1] - x[1])[0][0];
  const merged = [];
  for (const stretch of stretches) {
    const r = stretch.P / main;
    const s = SUBDIVISION_RATIOS.some((x) => Math.abs(Math.log(r / x)) < RATIO_WITHIN) ? { ...stretch, P: main } : { ...stretch };
    const last = merged[merged.length - 1];
    if (last && Math.abs(Math.log(last.P / s.P)) <= SAME_TEMPO_WITHIN) last.b = s.b;
    else merged.push(s);
  }
  return merged;
}

// The exact period of a stretch.
function refinePeriod(on, a, b, P) {
  const from = lowerBound(on.t, a), to = lowerBound(on.t, b);
  const span = 0.012 * P, step = (P * P) / (32 * Math.max(b - a, 4000));
  let best = P, bestScore = -1;
  for (let x = P - span; x <= P + span; x += step) {
    const s = combScore(on, from, to, x);
    if (s > bestScore) { bestScore = s; best = x; }
  }
  return best;
}

// Where the quarter grid lies in a..b (a time on it, at the middle, so that a small period error stays small), and how
// firmly the onsets lock to it.
function quarterPhase(on, a, b, P) {
  const from = lowerBound(on.t, a), to = lowerBound(on.t, b), mid = (a + b) / 2;
  const k = (TAU * BEATS_PER_BAR) / P;
  let re = 0, im = 0;
  for (let i = from; i < to; i++) {
    const x = k * (on.t[i] - mid), w = on.w[i];
    re += w * Math.cos(x);
    im += w * Math.sin(x);
  }
  return { t: mid + (Math.atan2(im, re) * P) / (TAU * BEATS_PER_BAR), lock: Math.hypot(re, im) };
}

// The parts of a stretch between which the quarter grid steps: binary segmentation of its phase in short windows.
function phaseSteps(on, a, b, P) {
  const quarter = P / 4, winMs = PHASE_WINDOW_BEATS * P;
  const points = [];
  for (let s = a; s + winMs <= b + 1; s += winMs) {
    const p = quarterPhase(on, s, s + winMs, P);
    if (p.lock > 0) points.push({ s, t: p.t, lock: p.lock, d: 0 });
  }
  if (points.length < 2) return [{ a, b }];
  let prev = 0;
  for (const p of points) {
    let d = (p.t - points[0].t) % quarter;
    while (d - prev > quarter / 2) d -= quarter;
    while (d - prev < -quarter / 2) d += quarter;
    p.d = d;
    prev = d;
  }
  const minWindows = Math.ceil(MIN_PHASE_BEATS / PHASE_WINDOW_BEATS);
  const mean = (i, j) => {
    let weight = 0, sum = 0;
    for (let k = i; k < j; k++) { weight += points[k].lock; sum += points[k].lock * points[k].d; }
    return weight ? sum / weight : 0;
  };
  const spread = (i, j, c) => {
    let sum = 0;
    for (let k = i; k < j; k++) sum += points[k].lock * (points[k].d - c) ** 2;
    return sum;
  };
  const cuts = [];
  const split = (i, j) => {
    const whole = spread(i, j, mean(i, j));
    let gain = 0, at = -1, step = 0;
    for (let k = i + minWindows; k <= j - minWindows; k++) {
      const left = mean(i, k), right = mean(k, j);
      const g = whole - spread(i, k, left) - spread(k, j, right);
      if (g > gain) { gain = g; at = k; step = right - left; }
    }
    if (at > 0 && Math.abs(step) >= PHASE_STEP_MS) {
      split(i, at);
      split(at, j);
    } else cuts.push([i, j]);
  };
  split(0, points.length);
  return cuts.map(([i, j], n) => ({ a: n === 0 ? a : points[i].s, b: n === cuts.length - 1 ? b : points[j].s }));
}

// Neighbouring parts become one when one tempo explains them: a small real tempo change shows up as many phase steps.
// A pair that did not merge stays apart until one of its parts changes, so it is not tried twice.
function mergeParts(on, parts, P) {
  const list = parts.map((p) => ({ ...p, P, apartFrom: null }));
  let refines = 0;
  for (let i = 0; i + 1 < list.length && refines < MAX_MERGE_REFINES; ) {
    const x = list[i], y = list[i + 1];
    if (x.apartFrom === y) { i++; continue; }
    const both = refinePeriod(on, x.a, y.b, P);
    refines++;
    const whole = quarterPhase(on, x.a, y.b, both);
    const onGrid = (part) => Math.cos(((TAU * BEATS_PER_BAR) / both) * (quarterPhase(on, part.a, part.b, both).t - whole.t));
    const fits = onGrid(x) >= MERGE_MIN_ON_GRID && onGrid(y) >= MERGE_MIN_ON_GRID;
    if (fits && whole.lock >= MERGE_KEEP * (quarterPhase(on, x.a, x.b, x.P).lock + quarterPhase(on, y.a, y.b, y.P).lock)) {
      list.splice(i, 2, { a: x.a, b: y.b, P: both, apartFrom: null });
      i = 0;
    } else {
      x.apartFrom = y;
      i++;
    }
  }
  return list;
}

// A time on the quarter grid of every part, and its lock. Part j's phase 0 continues part j-1's at their border, so a
// phase step keeps the place of the beat.
function linkParts(on, parts) {
  let prev = null;
  for (const part of parts) {
    const q = quarterPhase(on, part.a, part.b, part.P);
    part.phi = q.t;
    if (prev) {
      const landing = prev.phi + Math.round((part.a - prev.phi) / prev.P) * prev.P;
      part.phi = q.t - Math.round((q.t - landing) / (part.P / 4)) * (part.P / 4);
    }
    prev = part;
  }
}

// How much of list (by time) falls within the kernel around t0 + n P.
function kernelEnergy(list, a, b, P, t0) {
  const reach = 3 * KERNEL_SIGMA_MS;
  let energy = 0;
  for (let i = lowerBound(list.t, a); i < list.t.length && list.t[i] < b; i++) {
    let d = (list.t[i] - t0) % P;
    if (d > P / 2) d -= P;
    if (d < -P / 2) d += P;
    if (Math.abs(d) < reach) energy += list.w[i] * Math.exp((-0.5 * d * d) / (KERNEL_SIGMA_MS * KERNEL_SIGMA_MS));
  }
  return energy;
}

// The best path through windows of four scores, with a cost for changing.
function fourWayPath(scores, switchPenalty) {
  let cost = [...scores[0]];
  const back = [];
  for (let w = 1; w < scores.length; w++) {
    const best = cost.indexOf(Math.max(...cost));
    const from = [0, 0, 0, 0], next = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const stay = cost[k], move = cost[best] - switchPenalty;
      from[k] = stay >= move ? k : best;
      next[k] = Math.max(stay, move) + scores[w][k];
    }
    cost = next;
    back.push(from);
  }
  const path = new Array(scores.length);
  path[scores.length - 1] = cost.indexOf(Math.max(...cost));
  for (let w = scores.length - 2; w >= 0; w--) path[w] = back[w][path[w + 1]];
  return path;
}

// Which quarter phase is the beat, window by window across the parts of one stretch: [{ a, b, P, phi }].
function beatRuns(beatOnsets, parts) {
  const windows = [];
  for (const part of parts) {
    const winMs = BEAT_WINDOW_BEATS * part.P;
    const n = Math.max(1, Math.floor((part.b - part.a) / winMs));
    for (let w = 0; w < n; w++) {
      const a = part.a + w * winMs, b = w === n - 1 ? part.b : a + winMs;
      const energy = [0, 1, 2, 3].map((k) => kernelEnergy(beatOnsets, a, b, part.P, part.phi + (k * part.P) / 4));
      windows.push({ a, b, part, energy, sum: energy[0] + energy[1] + energy[2] + energy[3] });
    }
  }
  const typical = middle(windows.map((w) => w.sum).filter((x) => x > 0)) || 1;
  // A window's say: the share of each phase, less when the window is quiet.
  const scores = windows.map((w) => w.energy.map((x) => (w.sum > 0 ? (x / w.sum) * Math.min(1, w.sum / typical) : 0)));
  const runs = [];
  fourWayPath(scores, BEAT_SWITCH_PENALTY).forEach((k, i) => {
    const last = runs[runs.length - 1], w = windows[i];
    if (last && last.k === k && last.part === w.part) last.b = w.b;
    else runs.push({ k, part: w.part, a: w.a, b: w.b });
  });
  return runs.map((r) => ({ a: r.a, b: r.b, P: r.part.P, phi: r.part.phi + (r.k * r.part.P) / 4 }));
}

// Bars on the new beats: the tracker's downbeats vote for a beat modulo 4, window by window, with a cost for changing.
function fitDownbeats(beats, trackedDownbeats) {
  const votes = new Float64Array(beats.length);
  for (const d of trackedDownbeats) {
    const i = Math.min(lowerBound(beats, d), beats.length - 1);
    const j = i > 0 && Math.abs(beats[i - 1] - d) <= Math.abs(beats[i] - d) ? i - 1 : i;
    const gap = j + 1 < beats.length ? beats[j + 1] - beats[j] : beats[j] - beats[j - 1];
    if (Math.abs(beats[j] - d) <= VOTE_WITHIN * gap) votes[j] += 1;
  }
  const scores = [];
  for (let w = 0; w <= Math.floor(beats.length / BAR_WINDOW_BEATS); w++) {
    const v = [0, 0, 0, 0];
    for (let i = w * BAR_WINDOW_BEATS; i < Math.min(beats.length, (w + 1) * BAR_WINDOW_BEATS); i++) v[i % BEATS_PER_BAR] += votes[i];
    const sum = v[0] + v[1] + v[2] + v[3];
    scores.push(sum > 0 ? v.map((x) => x / sum) : [0, 0, 0, 0]);
  }
  const path = fourWayPath(scores, BAR_SWITCH_PENALTY);
  return beats.filter((_, i) => i % BEATS_PER_BAR === path[Math.floor(i / BAR_WINDOW_BEATS)]);
}

// fitBeats(features) -> { beats, downbeats } in whole ms, or null when the song gives too little to fit (the tracker's
// beats stand then).
function fitBeats(features) {
  const tracked = cleanTimes(features.tempo?.beats);
  const durationMs = features.durationMs;
  if (tracked.length < MIN_BEATS || !(durationMs > 0)) return null;
  const on = onsetsOf(features);
  const beatList = weighted(bandOnsets(features.bands?.[BEAT_BAND])).sort((x, y) => x.t - y.t);
  if (on.t.length < MIN_ONSETS_PER_BEAT * tracked.length || beatList.length < MIN_BEAT_ONSETS) return null;
  const beatOnsets = { t: beatList.map((o) => o.t), w: beatList.map((o) => o.w) };

  const P0 = middle(tracked.slice(1).map((t, i) => t - tracked[i]));
  const runs = [];
  for (const stretch of keepMainTempo(tempoStretches(on, P0, 0, durationMs))) {
    const P = refinePeriod(on, stretch.a, stretch.b, stretch.P);
    const parts = mergeParts(on, phaseSteps(on, stretch.a, stretch.b, P), P);
    linkParts(on, parts);
    runs.push(...beatRuns(beatOnsets, parts));
  }
  const fitted = [];
  for (const { a, b, P, phi } of runs) {
    let n = Math.ceil((a - phi) / P);
    for (let t = phi + n * P; t < b; t = phi + ++n * P) {
      if (!fitted.length || t - fitted[fitted.length - 1] > P * MIN_BEAT_GAP) fitted.push(t);
    }
  }
  if (fitted.length < MIN_BEATS) return null;
  const downbeats = fitDownbeats(fitted, cleanTimes(features.tempo?.downbeats));
  return { beats: fitted.map(Math.round), downbeats: downbeats.map(Math.round) };
}

// withFittedBeats(features) -> the features with the fitted beats and downbeats in their tempo, marked `fitted`, or the
// features themselves when the fit has too little to go on or the grid is marked already. The features are left as they
// are: they may be the cached ones.
function withFittedBeats(features) {
  if (features.tempo?.fitted) return features;
  const fit = fitBeats(features);
  return fit ? { ...features, tempo: { ...features.tempo, ...fit, fitted: true } } : features;
}

module.exports = { fitBeats, withFittedBeats };
