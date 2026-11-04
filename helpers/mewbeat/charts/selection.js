// Normal picks its notes from the music. Every candidate moment of a song is scored by how often people put a note there
// (momentWeights.js: its strength, its place in the bar), each phrase gets a budget from how much the music offers, and the
// best moments of the phrase fill the budget. This file scores and budgets moments and selects them; generate.js charts
// them.
const { beatMsOf } = require("./holds");
const { BUDGET, CLUSTER_MS, DOWNBEAT_MS, K, K_COLUMNS, METER_TOLERANCE } = require("./momentWeights");
const { hasSteadyPulse } = require("./phrases");
const { lowerBound, nearestIndex } = require("./util");

const HOLE_BEATS = 2;
const byTime = (a, b) => a.t - b.t;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Every onset of the features as { t, s, source }, time-ordered: the bands, then the drums, bass and lead layers.
function onsetsOf(features) {
  const out = [];
  const push = (e, source) => {
    if (Number.isFinite(e?.t)) out.push({ t: e.t, s: Number.isFinite(e.s) ? e.s : 0.5, source });
  };
  for (const band of features.bands) (Array.isArray(band?.onsets) ? band.onsets : []).forEach((e) => push(e, band.name));
  for (const layer of ["drums", "bass", "lead"]) (Array.isArray(features[layer]) ? features[layer] : []).forEach((e) => push(e, layer));
  return out.sort(byTime);
}

// The candidate moments: onsets within CLUSTER_MS of a cluster's first onset are one moment, at its strongest onset's
// time and strength.
function candidatesOf(features) {
  const out = [];
  let from = -Infinity;
  for (const onset of onsetsOf(features)) {
    if (onset.t - from > CLUSTER_MS) {
      from = onset.t;
      out.push({ t: onset.t, s: onset.s, source: onset.source });
    } else if (onset.s > out[out.length - 1].s) {
      Object.assign(out[out.length - 1], onset);
    }
  }
  return out;
}

// A candidate's place in the beat on the generator's grid: metric 0 a beat, 1 a half beat, 2 a quarter beat, 3 anything
// else, `down` for a beat that opens a bar and `grid` for the distance to the nearest of those places in beats. Without
// a grid every candidate is "anything else". Where the beats are missing for a stretch (two beats further apart than
// HOLE_BEATS median beats) the grid goes on from the last beat at the median beat, without bars.
function meterOf(timing, t) {
  const beats = timing?.snapped ? timing.beats : null;
  if (!beats || beats.length < 3) return { metric: 3, down: 0, grid: 0 };
  const i = Math.min(Math.max(lowerBound(beats, t + 1e-9) - 1, 0), beats.length - 2);
  const hole = beats[i + 1] - beats[i] > HOLE_BEATS * timing.medianMs;
  const span = hole ? timing.medianMs : beats[i + 1] - beats[i];
  const position = (t - beats[i]) / span;
  const u = position - Math.floor(position);
  const toBeat = Math.min(u, 1 - u);
  const toHalf = Math.abs(u - 0.5);
  const toQuarter = Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75));
  const grid = Math.min(toBeat, toHalf, toQuarter);
  if (toBeat < METER_TOLERANCE) {
    const near = beats[i] + Math.round(position) * span;
    const downbeats = timing.downbeats ?? [];
    const d = nearestIndex(downbeats, near);
    return { metric: 0, down: d >= 0 && Math.abs(downbeats[d] - near) < DOWNBEAT_MS ? 1 : 0, grid };
  }
  if (toHalf < METER_TOLERANCE) return { metric: 1, down: 0, grid };
  return { metric: toQuarter < METER_TOLERANCE ? 2 : 3, down: 0, grid };
}

// Within-song rank in (0, 1]: ties share the mean of their ranks. A column of at most two distinct values stays as it is.
function rankColumn(values) {
  if (new Set(values).size <= 2) return values;
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const ranked = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const mean = (i + j + 2) / 2 / values.length; // ranks are 1-based
    for (let k = i; k <= j; k++) ranked[order[k]] = mean;
    i = j + 1;
  }
  return ranked;
}

// scoreMoments(ctx, level) -> [{ t, s, score, metric, down, source }], time-ordered: the candidates of the whole song with
// K's score (a logit; sigmoid(score) is how likely people put a note there), from the features as measured (the scores
// were fitted on those, not on the lead merged). Kept on the ctx, as every phrase asks.
function scoreMoments(ctx, level) {
  ctx.scored ??= {};
  if (ctx.scored[level]) return ctx.scored[level];
  const { coef, intercept } = K[level];
  const candidates = candidatesOf(ctx.raw);
  const meters = candidates.map((c) => meterOf(ctx.timing, c.t));
  const columns = {
    raw_strength: rankColumn(candidates.map((c) => c.s)),
    m_beat: meters.map((m) => (m.metric === 0 ? 1 : 0)),
    m_half: meters.map((m) => (m.metric === 1 ? 1 : 0)),
    m_quarter: meters.map((m) => (m.metric === 2 ? 1 : 0)),
    m_other: meters.map((m) => (m.metric === 3 ? 1 : 0)),
    m_down: meters.map((m) => m.down),
    d_grid: rankColumn(meters.map((m) => m.grid)),
  };
  ctx.scored[level] = candidates.map((c, i) => ({
    t: c.t,
    s: c.s,
    score: intercept + K_COLUMNS.reduce((sum, name, k) => sum + coef[k] * columns[name][i], 0),
    metric: meters[i].metric,
    down: meters[i].down,
    source: c.source,
  }));
  return ctx.scored[level];
}

// --- the budget of a phrase ----------------------------------------------------------------

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// What the music offers each phrase of the song (momentWeights.js BUDGET): [fitted rate], and the song's mean of those,
// weighted by the length of the phrases long enough to say something. Kept on the ctx.
function budgetModelOf(ctx, diff) {
  ctx.budgets ??= {};
  if (ctx.budgets[diff.scoreLevel]) return ctx.budgets[diff.scoreLevel];
  const scored = scoreMoments(ctx, diff.scoreLevel);
  const ranked = scored.map((m) => m.score).sort((a, b) => a - b);
  const salientFrom = ranked.length > 0 ? ranked[Math.min(ranked.length - 1, Math.floor(BUDGET.q * ranked.length))] : Infinity;
  const times = scored.map((m) => m.t);
  const values = ctx.features.energy?.values ?? [];
  const hop = ctx.energy.hopMs;
  const songLoudness = values.length > 0 ? mean(values) : 1;
  const fitted = ctx.phrases.map((p) => {
    const seconds = Math.max(p.endMs - p.startMs, 1) / 1000;
    let salient = 0;
    for (let i = lowerBound(times, p.startMs); i < scored.length && times[i] < p.endMs; i++) if (scored[i].score >= salientFrom) salient++;
    const from = Math.min(Math.floor(p.startMs / hop), values.length - 1);
    const heard = values.slice(Math.max(from, 0), Math.max(Math.floor(p.endMs / hop), from + 1));
    const loudness = heard.length > 0 && songLoudness > 0 ? mean(heard) / songLoudness : 1;
    return BUDGET.intercept + BUDGET.coef[0] * (salient / seconds) + BUDGET.coef[1] * loudness;
  });
  const long = ctx.phrases.map((p, i) => i).filter((i) => ctx.phrases[i].endMs - ctx.phrases[i].startMs >= BUDGET.minPhraseMs);
  const weights = (long.length > 0 ? long : ctx.phrases.map((p, i) => i)).map((i) => ({ rate: fitted[i], seconds: ctx.phrases[i].endMs - ctx.phrases[i].startMs }));
  const total = weights.reduce((sum, w) => sum + w.seconds, 0);
  const song = total > 0 ? weights.reduce((sum, w) => sum + w.rate * w.seconds, 0) / total : 0;
  ctx.budgets[diff.scoreLevel] = { fitted, song };
  return ctx.budgets[diff.scoreLevel];
}

// phraseBudget(phrase, ctx, diff) -> the most moments the phrase gets: its seconds at the rate the music calls for (a
// song and a phrase the music fills get more than the median, a thin one fewer), times diff.budgetScale. A budget is a
// limit; selectMoments leaves it unused where the music has less to offer.
function phraseBudget(phrase, ctx, diff) {
  const { fitted, song } = budgetModelOf(ctx, diff);
  const own = fitted[phrase.index];
  const seconds = (phrase.endMs - phrase.startMs) / 1000;
  if (!(song > 0) || !Number.isFinite(own)) return Math.round(BUDGET.medianRate * seconds * diff.budgetScale);
  const bySong = Math.pow(song / BUDGET.refModel, BUDGET.gamma);
  const byPhrase = Math.pow(clamp(own / song, BUDGET.minRatio, Infinity), BUDGET.delta);
  const rate = Math.min(BUDGET.maxRate, BUDGET.medianRate * bySong * byPhrase);
  return Math.max(0, Math.round(rate * seconds * diff.budgetScale));
}

// --- choosing the moments --------------------------------------------------------------------

const GAP_SLACK = 0.9; // as in the difficulty's other gaps in beats
const SILENT_GAP_BEATS = 2; // a stretch longer than this between two notes, with a sound in it, gets one of them
const FILL_REST_BEATS = 0.45; // a note filling a rest keeps this far from its neighbours, in beats
const PULSE_REST_BEATS = 0.75; // ...and one for the pulse this far
const SOUND_MS = 35; // a beat with a candidate this near has a sound
const PULSE_STRENGTH = 0.3; // what a note for the pulse reports as strength (rhythm.js DEFAULT_STRENGTH)

// selectMoments(phrase, scored, budget, diff, timing) -> [{ t, s, reason, source }], time-ordered. `scored` is what the
// phrase may play (scoreMoments, without the lead-in and silence). The best moments come first, a downbeat before the
// rest, as long as the music puts them in the foreground (diff.foreground) and up to the budget. A stretch of more than
// SILENT_GAP_BEATS between notes with a sound in it takes its best moment, for a spare place or for the weakest note. What
// the foreground leaves of the budget goes to beats and half beats in the rests where something sounds; a beat nothing
// sounds on is played only where the phrase has a steady pulse. The budget is never passed.
function selectMoments(phrase, scored, budget, diff, timing) {
  const snapped = !!timing?.snapped;
  const beatAt = (t) => beatMsOf(timing, t);
  const gapAt = (t) => Math.max(diff.minNoteGapMs ?? 0, (diff.gapBeats ?? 0) * beatAt(t) * GAP_SLACK);
  const chosen = []; // time-ordered
  const nearest = (t) => {
    const i = lowerBound(chosen.map((n) => n.t), t);
    return { before: chosen[i - 1], after: chosen[i], i };
  };
  const fits = (t, restBeats = 0) => {
    const { before, after } = nearest(t);
    return [before, after].every((n) => !n || Math.abs(n.t - t) >= Math.max(gapAt(t), restBeats * beatAt(t)));
  };
  const add = (c, reason) => {
    chosen.splice(nearest(c.t).i, 0, { t: c.t, s: c.s, reason, source: c.source, score: c.score, down: c.down });
  };

  // The foreground.
  const foreground = scored.filter((c) => c.score >= diff.foreground).sort((a, b) => b.down - a.down || b.score - a.score || a.t - b.t);
  for (const c of foreground) {
    if (chosen.length >= budget) break;
    if (fits(c.t)) add(c, "ocena");
  }

  // A long stretch with a sound in it.
  for (let rounds = 0; rounds < scored.length; rounds++) {
    let best = null;
    for (let i = 1; i < chosen.length; i++) {
      const from = chosen[i - 1].t;
      const to = chosen[i].t;
      if (to - from <= SILENT_GAP_BEATS * beatAt(from)) continue;
      for (const c of scored) {
        if (c.t > from && c.t < to && fits(c.t) && (!best || c.score > best.c.score)) best = { c, from, to };
      }
    }
    if (!best) break;
    if (chosen.length < budget) {
      add(best.c, "dopełnienie");
      continue;
    }
    const weakest = chosen.filter((n) => !n.down && n.score < best.c.score).sort((a, b) => a.score - b.score || a.t - b.t)[0];
    if (!weakest) break;
    chosen.splice(chosen.indexOf(weakest), 1);
    add(best.c, "dopełnienie");
  }

  // What is missing: beats and half beats with a sound, in the rests.
  while (chosen.length < budget) {
    const c = scored.filter((s) => (!snapped || s.metric <= 1) && fits(s.t, FILL_REST_BEATS)).sort((a, b) => b.score - a.score || a.t - b.t)[0];
    if (!c) break;
    add(c, "dopełnienie");
  }

  // The pulse: a beat nothing sounds on, in a phrase whose beats are carried by drums or bass.
  if (snapped && hasSteadyPulse(phrase)) {
    const sounding = scored.map((c) => c.t);
    const beats = timing.beats.filter((t) => t >= phrase.startMs && t < phrase.endMs);
    const isDown = (t) => timing.downbeats.some((d) => Math.abs(d - t) < DOWNBEAT_MS);
    for (const t of [...beats].sort((a, b) => Number(isDown(b)) - Number(isDown(a)) || a - b)) {
      if (chosen.length >= budget) break;
      const heard = nearestIndex(sounding, t);
      if ((heard >= 0 && Math.abs(sounding[heard] - t) <= SOUND_MS) || !fits(t, PULSE_REST_BEATS)) continue;
      add({ t, s: PULSE_STRENGTH, source: "pulse", score: -Infinity, down: Number(isDown(t)) }, "puls");
    }
  }

  return chosen.map(({ t, s, reason, source }) => ({ t, s, reason, source }));
}

module.exports = { candidatesOf, phraseBudget, scoreMoments, selectMoments, sigmoid };
