// Normal picks its notes from the music. Every candidate moment of a song is scored by how often people put a note there
// (momentWeights.js: its strength, its place in the bar), each phrase gets a budget from how much the music offers, and the
// best moments of the phrase fill the budget. This file scores and budgets moments and selects them; generate.js charts
// them.
const { LEAD_IN_MS, MAX_SNAP_DISTANCE_MS, SILENCE_ENERGY } = require("./difficulty");
const { beatMsOf } = require("./holds");
const { BUDGET, CLUSTER_MS, DOWNBEAT_MS, K, K_COLUMNS, METER_TOLERANCE, REPEAT } = require("./momentWeights");
const { hasSteadyPulse } = require("./phrases");
const { lowerBound, nearestIndex } = require("./util");

const HOLE_BEATS = 2;
const GRID_DIVISION = 4; // the notes of Normal sit on quarter beats, as v26's did (Hard's grid, cut to its quarter beats)
const byTime = (a, b) => a.t - b.t;

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
  const tolerance = timing.meterTolerance ?? METER_TOLERANCE;
  if (toBeat < tolerance) {
    const near = beats[i] + Math.round(position) * span;
    const downbeats = timing.downbeats ?? [];
    const d = nearestIndex(downbeats, near);
    return { metric: 0, down: d >= 0 && Math.abs(downbeats[d] - near) < DOWNBEAT_MS ? 1 : 0, grid };
  }
  if (toHalf < tolerance) return { metric: 1, down: 0, grid };
  return { metric: toQuarter < tolerance ? 2 : 3, down: 0, grid };
}

// The beats a moment's place is read on. With diff.feltTempo (Normal's, difficulty.js FELT_TEMPO) a song slower than its belowBpm is
// read at twice the tempo, its half beats as beats: on the train songs people's Normal plays about 4.3 notes a second at any
// tempo, and under 115 BPM a third of its notes on quarter beats (34%, against 4% over 170 BPM), so a slow song is played as a
// song twice as fast. The downbeats stay; the grid the moments snap to is the song's own. With felt.keepTolerance a place in the beat keeps the tolerance in ms it has at the song's own tempo: the halved beat would
// halve it, and a sound 18-37 ms off the grid, which snaps, would be read as off the beat.
function meterTimingOf(timing, felt) {
  if (!felt || !timing?.snapped || 60000 / timing.medianMs >= felt.belowBpm) return timing;
  return { ...timing, beats: timing.gridPoints(2), medianMs: timing.medianMs / 2, meterTolerance: felt.keepTolerance ? 2 * METER_TOLERANCE : METER_TOLERANCE };
}

// The key the scores of a level are kept under on the ctx: a level read at its felt tempo is scored apart.
const scoreKey = (level, felt) => (felt ? `${level}:felt${felt.belowBpm}${felt.keepTolerance ? "t" : ""}` : level);

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

// scoreMoments(ctx, level) -> [{ t, s, score, metric, down, grid, source }], time-ordered: the candidates of the whole song with
// K's score (a logit: how likely people put a note there), from the features as measured (the scores were fitted on
// those, not on the lead merged). `felt` is diff.feltTempo (meterTimingOf). Kept on the ctx, as every phrase asks.
function scoreMoments(ctx, level, felt = null) {
  ctx.scored ??= {};
  const key = scoreKey(level, felt);
  if (ctx.scored[key]) return ctx.scored[key];
  const { coef, intercept } = K[level];
  const candidates = candidatesOf(ctx.raw);
  const meterTiming = meterTimingOf(ctx.timing, felt);
  const meters = candidates.map((c) => meterOf(meterTiming, c.t));
  const columns = {
    raw_strength: rankColumn(candidates.map((c) => c.s)),
    m_beat: meters.map((m) => (m.metric === 0 ? 1 : 0)),
    m_half: meters.map((m) => (m.metric === 1 ? 1 : 0)),
    m_quarter: meters.map((m) => (m.metric === 2 ? 1 : 0)),
    m_other: meters.map((m) => (m.metric === 3 ? 1 : 0)),
    m_down: meters.map((m) => m.down),
    d_grid: rankColumn(meters.map((m) => m.grid)),
  };
  ctx.scored[key] = candidates.map((c, i) => ({
    t: c.t,
    s: c.s,
    score: intercept + K_COLUMNS.reduce((sum, name, k) => sum + coef[k] * columns[name][i], 0),
    metric: meters[i].metric,
    down: meters[i].down,
    grid: meters[i].grid,
    source: c.source,
  }));
  return ctx.scored[key];
}

// snappedMoments(ctx, level) -> the moments of scoreMoments on the quarter-beat grid, time-ordered: what a chart may play. A
// moment keeps its score (K was fitted on the candidates as measured, not on the grid) and moves to the nearest grid point,
// `raw` being the time it had. Two moments on one grid point leave the higher score (ties: the one that moved less). Under a
// trusted grid a moment that cannot move is not played: it is further than MAX_SNAP_DISTANCE_MS from the grid point. Without a
// grid, or where the beats are too irregular for it to be trusted (timing.intervalOk; a stretch with no beats at all), the
// moments keep their times: there is no grid there to be on, and dropping them would empty the stretch. Kept on the ctx. The
// budget is counted on scoreMoments, as it was fitted.
function snappedMoments(ctx, level, felt = null) {
  ctx.snappedMoments ??= {};
  const key = scoreKey(level, felt);
  if (ctx.snappedMoments[key]) return ctx.snappedMoments[key];
  const scored = scoreMoments(ctx, level, felt);
  const { timing } = ctx;
  if (!timing?.snapped) return (ctx.snappedMoments[key] = scored);
  const grid = timing.gridPoints(GRID_DIVISION);
  const onGrid = new Map();
  for (const c of scored) {
    const i = nearestIndex(grid, c.t);
    const trusted = i >= 0 && timing.intervalOk(c.t) && timing.intervalOk(grid[i]);
    if (trusted && Math.abs(grid[i] - c.t) > MAX_SNAP_DISTANCE_MS) continue;
    const t = trusted ? grid[i] : c.t;
    const kept = onGrid.get(t);
    if (!kept || c.score > kept.score || (c.score === kept.score && Math.abs(c.t - t) < Math.abs((kept.raw ?? kept.t) - t))) {
      onGrid.set(t, trusted ? { ...c, t, raw: c.t } : c);
    }
  }
  return (ctx.snappedMoments[key] = [...onGrid.values()].sort(byTime));
}

// --- the budget of a phrase ----------------------------------------------------------------

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// The part of a phrase the music plays: from the lead-in on, where the energy is not below SILENCE_ENERGY. { seconds, loudness }
// with the loudness of that part against the song's mean. Without an energy curve the whole phrase counts.
function audibleOf(ctx, p, songLoudness) {
  const values = ctx.features.energy?.values ?? [];
  const hop = ctx.energy.hopMs;
  if (values.length === 0) return { seconds: Math.max(p.endMs - p.startMs, 1) / 1000, loudness: 1 };
  const from = Math.min(Math.floor(p.startMs / hop), values.length - 1);
  const heard = [];
  for (let i = Math.max(from, 0); i < Math.max(Math.floor(p.endMs / hop), from + 1) && i < values.length; i++) {
    if (i * hop >= LEAD_IN_MS && values[i] >= SILENCE_ENERGY) heard.push(values[i]);
  }
  return { seconds: (heard.length * hop) / 1000, loudness: heard.length > 0 && songLoudness > 0 ? mean(heard) / songLoudness : 1 };
}

// isFlatLoud(ctx, diff) -> with diff.flatLoud = { fromBpm, ref }, whether the song is fromBpm or faster and its mean energy
// over ref: loud all through (Coffin Dance, Camellia Remix: 0.79), so no part of it is louder than its own mean and its loud
// parts got a median song's rate, where GHOST's (0.69) stand out of its quiet ones. Such a song reads its phrases' loudness
// against ref (budgetModelOf), and its seconds are not thinned on the high band alone (generate.js followingTheMusic): the
// band drops out for seconds while the kick and the rest play on.
function isFlatLoud(ctx, diff) {
  if (!diff.flatLoud || !ctx.timing?.snapped || !(ctx.timing.medianMs > 0)) return false;
  const values = ctx.features.energy?.values ?? [];
  return 60000 / ctx.timing.medianMs >= diff.flatLoud.fromBpm && values.length > 0 && mean(values) > diff.flatLoud.ref;
}

// What the music offers each phrase of the song (momentWeights.js BUDGET): [fitted rate] over the audible part of the
// phrase, that part's seconds, and the song's mean rate, weighted by the audible seconds of the phrases long enough to say
// something. Kept on the ctx. In a song isFlatLoud calls so, the phrases' loudness is read against diff.flatLoud.ref.
function budgetModelOf(ctx, diff) {
  ctx.budgets ??= {};
  const flat = isFlatLoud(ctx, diff);
  const key = scoreKey(diff.scoreLevel, diff.feltTempo) + (flat ? `:flat${diff.flatLoud.ref}` : "");
  if (ctx.budgets[key]) return ctx.budgets[key];
  const scored = scoreMoments(ctx, diff.scoreLevel, diff.feltTempo);
  const ranked = scored.map((m) => m.score).sort((a, b) => a - b);
  const salientFrom = ranked.length > 0 ? ranked[Math.min(ranked.length - 1, Math.floor(BUDGET.q * ranked.length))] : Infinity;
  const times = scored.map((m) => m.t);
  const values = ctx.features.energy?.values ?? [];
  const songLoudness = flat ? diff.flatLoud.ref : values.length > 0 ? mean(values) : 1;
  const audible = ctx.phrases.map((p) => audibleOf(ctx, p, songLoudness));
  const fitted = ctx.phrases.map((p, k) => {
    let salient = 0;
    for (let i = lowerBound(times, p.startMs); i < scored.length && times[i] < p.endMs; i++) {
      if (scored[i].score >= salientFrom && scored[i].t >= LEAD_IN_MS && ctx.energy.at(scored[i].t) >= SILENCE_ENERGY) salient++;
    }
    const { seconds, loudness } = audible[k];
    return seconds > 0 ? BUDGET.intercept + BUDGET.coef[0] * (salient / seconds) + BUDGET.coef[1] * loudness : 0;
  });
  const long = ctx.phrases.map((p, i) => i).filter((i) => audible[i].seconds * 1000 >= BUDGET.minPhraseMs);
  const weights = (long.length > 0 ? long : ctx.phrases.map((p, i) => i)).map((i) => ({ rate: fitted[i], seconds: audible[i].seconds }));
  const total = weights.reduce((sum, w) => sum + w.seconds, 0);
  const song = total > 0 ? weights.reduce((sum, w) => sum + w.rate * w.seconds, 0) / total : 0;
  const firstLoud = audible.findIndex((a) => a.seconds > 0 && a.loudness >= BUDGET.openingLoudness);
  ctx.budgets[key] = { fitted, song, seconds: audible.map((a) => a.seconds), openingEnd: Math.max(firstLoud, 0) };
  return ctx.budgets[key];
}

// The notes per audible second of the lead line in each phrase before the song's first loud one, 0 in the others: a quiet
// soloist at the start of a song leads it, where the loudness alone says a quiet part. Kept on the ctx.
function openingLeadRates(ctx) {
  if (ctx.openingLeadRates) return ctx.openingLeadRates;
  const values = ctx.features.energy?.values ?? [];
  const songLoudness = values.length > 0 ? mean(values) : 1;
  const audible = ctx.phrases.map((p) => audibleOf(ctx, p, songLoudness));
  const firstLoud = audible.findIndex((a) => a.seconds > 0 && a.loudness >= BUDGET.openingLoudness);
  const lead = (ctx.features.lead ?? []).map((n) => n.t);
  ctx.openingLeadRates = ctx.phrases.map((p, k) => (k < firstLoud && audible[k].seconds > 0 ? lead.filter((t) => t >= p.startMs && t < p.endMs).length / audible[k].seconds : 0));
  return ctx.openingLeadRates;
}

// The notes per audible second of the lead line in each phrase a quiet soloist leads after the song's first loud one, 0 in
// the others (diff.soloLead = { drumsBelow, leadFrom, share }, Normal's SOLO_LEAD): quieter than the opening's end
// against the song, the drums' confidence under drumsBelow and the lead's at least leadFrom. On the train songs people's
// Normal plays a chord on 19% of the moments of such a phrase, Normal on 44%. Kept on the ctx.
function soloLeadRates(ctx, rule) {
  if (!rule) return ctx.phrases.map(() => 0);
  const key = `${rule.drumsBelow}:${rule.leadFrom}`;
  ctx.soloLeadRates ??= {};
  if (ctx.soloLeadRates[key]) return ctx.soloLeadRates[key];
  const values = ctx.features.energy?.values ?? [];
  const songLoudness = values.length > 0 ? mean(values) : 1;
  const audible = ctx.phrases.map((p) => audibleOf(ctx, p, songLoudness));
  const firstLoud = audible.findIndex((a) => a.seconds > 0 && a.loudness >= BUDGET.openingLoudness);
  const lead = (ctx.features.lead ?? []).map((n) => n.t);
  const solo = (p, k) => firstLoud >= 0 && k > firstLoud && audible[k].seconds > 0 && audible[k].loudness < BUDGET.openingLoudness && p.confidence && p.confidence.drums < rule.drumsBelow && p.confidence.lead >= rule.leadFrom;
  ctx.soloLeadRates[key] = ctx.phrases.map((p, k) => (solo(p, k) ? lead.filter((t) => t >= p.startMs && t < p.endMs).length / audible[k].seconds : 0));
  return ctx.soloLeadRates[key];
}

// phraseBudget(phrase, ctx, diff) -> the most moments the phrase gets: the seconds the music plays in it at the rate the
// music calls for (a song and a phrase the music fills get more than the median, a thin one fewer), times diff.budgetScale,
// and never above diff.maxNpsCeiling moments per second. A quiet phrase before the song's first loud one keeps a higher floor
// than one later on, and with diff.openingLead at least that share of the notes of its lead line (generator flag "lead"); a
// quiet soloist later in the song (soloLeadRates) keeps diff.soloLead.share of its line. With diff.tempoBudget = { refBpm,
// power } the music's rate is times (bpm / refBpm) ^ -power: people's Normal plays about 4.3 moments a second at any tempo,
// where the fitted rate follows the beats (train, loud parts over 190 BPM: people 4.98, Normal 5.68). A budget is a limit; selectMoments
// leaves it unused where the music has less to offer. With diff.slowDynamics = { belowBpm, delta } a song slower than belowBpm
// stretches its phrases' rates less round the song's (BUDGET.delta): people's quiet parts of slow songs are denser against
// the loud ones than the generator's (train, 115-145 BPM, Normal: quiet 2.00 / loud 4.79 moments a second, people 3.26 / 4.68).
function phraseBudget(phrase, ctx, diff) {
  const { fitted, song, seconds: played, openingEnd } = budgetModelOf(ctx, diff);
  const own = fitted[phrase.index];
  const seconds = played[phrase.index];
  const most = Math.floor((diff.maxNpsCeiling ?? Infinity) * seconds);
  if (!(song > 0) || !Number.isFinite(own)) return Math.min(most, Math.round(BUDGET.medianRate * seconds * diff.budgetScale));
  const bySong = Math.pow(song / BUDGET.refModel, BUDGET.gamma);
  const floor = phrase.index < openingEnd ? BUDGET.openingMinRatio : BUDGET.minRatio;
  const slow = diff.slowDynamics && ctx.timing?.snapped && ctx.timing.medianMs > 0 && 60000 / ctx.timing.medianMs < diff.slowDynamics.belowBpm;
  const byPhrase = Math.pow(clamp(own / song, floor, Infinity), slow ? diff.slowDynamics.delta : BUDGET.delta);
  const lead = (diff.openingLead ?? 0) * openingLeadRates(ctx)[phrase.index] * seconds;
  const solo = (diff.soloLead?.share ?? 0) * soloLeadRates(ctx, diff.soloLead)[phrase.index] * seconds;
  const byTempo = diff.tempoBudget && ctx.timing?.medianMs > 0 ? Math.pow(60000 / ctx.timing.medianMs / diff.tempoBudget.refBpm, -diff.tempoBudget.power) : 1;
  return Math.max(0, Math.min(most, Math.round(Math.max(lead, solo, BUDGET.medianRate * bySong * byPhrase * seconds * diff.budgetScale * byTempo))));
}

// --- choosing the moments --------------------------------------------------------------------

const GAP_SLACK = 0.9; // as in the difficulty's other gaps in beats
const SILENT_GAP_BEATS = 2; // a stretch longer than this between two notes, with a sound in it, gets one of them
const FILL_REST_BEATS = 0.45; // a note filling a rest keeps this far from its neighbours, in beats
const PULSE_REST_BEATS = 0.75; // ...and one for the pulse this far
const SOUND_MS = 35; // a beat with a candidate this near has a sound
const PULSE_STRENGTH = 0.3; // what a note for the pulse reports as strength (rhythm.js DEFAULT_STRENGTH)

// The least distance in ms between two notes at t.
function gapOf(diff, timing) {
  return (t) => Math.max(diff.minNoteGapMs ?? 0, (diff.gapBeats ?? 0) * beatMsOf(timing, t) * GAP_SLACK);
}

// selectMoments(phrase, scored, budget, diff, timing, edges) -> [{ t, s, reason, source }], time-ordered. `scored` is what
// the phrase may play (scoreMoments, without the lead-in and silence). The best moments come first, a downbeat before the
// rest, as long as the music puts them in the foreground (diff.foreground) and up to the budget. A stretch of more than
// SILENT_GAP_BEATS between notes with a sound in it takes its best moment, for a spare place or for the weakest note; the
// stretches count from the phrase's start to its first note and from its last note to its end too, and from the last note of
// the phrase before (`edges.before`, its time) with the sounds that lie after that note in `edges.carry` (earlier moments,
// they may be chosen too). What the foreground leaves of the budget goes first to what the drums and bass repeat (`edges.figures`,
// the times of figures.js), then to beats and half beats in the rests where something sounds; a beat nothing sounds on is played
// only where the phrase has a steady pulse. The budget is never passed, but for the figures' `edges.figureRoom`.
function selectMoments(phrase, scored, budget, diff, timing, edges = {}) {
  const snapped = !!timing?.snapped;
  const beatAt = (t) => beatMsOf(timing, t);
  const gapAt = gapOf(diff, timing);
  const chosen = []; // time-ordered
  const nearest = (t) => {
    const i = lowerBound(chosen.map((n) => n.t), t);
    return { before: chosen[i - 1], after: chosen[i], i };
  };
  const lastBefore = Number.isFinite(edges.before) ? edges.before : null; // a note of the phrase before, which stays
  const fits = (t, restBeats = 0) => {
    const { before, after } = nearest(t);
    const apart = Math.max(gapAt(t), restBeats * beatAt(t));
    return [before?.t, after?.t, lastBefore].every((n) => n === undefined || n === null || Math.abs(n - t) >= apart);
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

  // A long stretch with a sound in it, between two notes and at the phrase's edges.
  const pool = edges.carry?.length > 0 ? [...edges.carry, ...scored] : scored;
  for (let rounds = 0; rounds < pool.length; rounds++) {
    let best = null;
    const marks = [lastBefore ?? phrase.startMs, ...chosen.map((n) => n.t), phrase.endMs];
    for (let i = 1; i < marks.length; i++) {
      const from = marks[i - 1];
      const to = marks[i];
      if (to - from <= SILENT_GAP_BEATS * beatAt(from)) continue;
      for (const c of pool) {
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

  // What the drums and bass keep repeating (diff.figures), before the rests are filled: the foreground and the long stretches
  // keep their notes. `edges.figureRoom` is what a phrase with a weak lead may take on top of its budget.
  if (edges.figures?.size > 0) {
    const most = budget + (edges.figureRoom ?? 0);
    const figure = scored.filter((c) => edges.figures.has(c.t)).sort((a, b) => a.metric - b.metric || b.score - a.score || a.t - b.t);
    for (const c of figure) {
      if (chosen.length >= most) break;
      if (fits(c.t, c.metric === 2 ? 0 : diff.figures.restBeats)) add(c, "figura");
    }
  }

  // What is missing: beats and half beats with a sound, in the rests.
  while (chosen.length < budget) {
    const c = scored.filter((s) => (!snapped || s.metric <= 1) && fits(s.t, FILL_REST_BEATS)).sort((a, b) => b.score - a.score || a.t - b.t)[0];
    if (!c) break;
    add(c, "dopełnienie");
  }

  // The pulse: a beat nothing sounds on, in a phrase whose beats are carried by drums or bass.
  if (snapped && hasSteadyPulse(phrase)) {
    const sounding = scored.map((c) => c.raw ?? c.t); // a beat is heard where the music sounded, not where its moment moved to
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

// --- repeats ------------------------------------------------------------------------------------

// repeatPlan(phrase, source, ctx, diff, sourceMoments) -> { copy, extra }: how a repeat of Normal is charted. A repeat as loud
// as its source (the loudness of the audible part, as the budget counts it) copies the source's rhythm; a louder one
// (REPEAT.louder times the source's loudness) copies it and takes `extra` moments of its own ranking on top (REPEAT.gain of the
// source's, never past the repeat's budget); a source with fewer moments than REPEAT.sparse of that louder repeat's budget is
// not copied, the repeat is charted fresh. Only levels
// that pick from the music plan: the others copy every repeat. `sourceMoments`, the moments the source plays, defaults to the
// source's own budget.
function repeatPlan(phrase, source, ctx, diff, sourceMoments = null) {
  const copy = { copy: true, extra: 0 };
  if (diff.selector !== "music") return copy;
  const was = audibleOf(ctx, source, 1).loudness;
  if (!(was > 0) || audibleOf(ctx, phrase, 1).loudness / was < REPEAT.louder) return copy;
  const budget = phraseBudget(phrase, ctx, diff);
  const had = sourceMoments ?? phraseBudget(source, ctx, diff);
  if (had < REPEAT.sparse * budget) return { copy: false, extra: 0 };
  return { copy: true, extra: Math.max(0, Math.min(Math.round((REPEAT.gain - 1) * had), budget - had)) };
}

// extraMoments(phrase, scored, kept, extra, diff, timing, edges) -> [{ t, s, reason, source }], time-ordered: the moments a
// copied repeat takes besides its copy. `kept` holds the times of the copy's notes, `scored` what the phrase may play and
// `edges` the phrase before as selectMoments has it. The stretch from the last note before the phrase to the copy's first
// note, when it is over SILENT_GAP_BEATS with a sound in it, takes its best moment first ("dopełnienie"; the copy was cut from
// a source whose own start the phrase before did not know of), then the best moments of the ranking ("ocena"), up to `extra`
// in all. The gap of the level holds against the copy and the phrase before.
function extraMoments(phrase, scored, kept, extra, diff, timing, edges = {}) {
  const gapAt = gapOf(diff, timing);
  const chosen = [];
  const lastBefore = Number.isFinite(edges.before) ? edges.before : null;
  const fits = (t) => [...kept, ...chosen.map((n) => n.t), lastBefore].every((n) => n === null || Math.abs(n - t) >= gapAt(t));
  const add = (c, reason) => chosen.push({ t: c.t, s: c.s, reason, source: c.source, score: c.score });
  const first = Math.min(...kept);

  const pool = edges.carry?.length > 0 ? [...edges.carry, ...scored] : scored;
  for (let rounds = 0; rounds < pool.length; rounds++) {
    let best = null;
    const marks = [lastBefore ?? phrase.startMs, ...chosen.map((n) => n.t).sort((a, b) => a - b), first];
    for (let i = 1; i < marks.length; i++) {
      if (marks[i] - marks[i - 1] <= SILENT_GAP_BEATS * beatMsOf(timing, marks[i - 1])) continue;
      for (const c of pool) {
        if (c.t > marks[i - 1] && c.t < marks[i] && fits(c.t) && (!best || c.score > best.score)) best = c;
      }
    }
    if (!best) break;
    add(best, "dopełnienie");
  }
  for (const c of [...scored].sort((a, b) => b.score - a.score || a.t - b.t)) {
    if (chosen.length >= extra) break;
    if (fits(c.t)) add(c, "ocena");
  }
  return chosen.sort(byTime).map(({ t, s, reason, source }) => ({ t, s, reason, source }));
}

module.exports = { audibleOf, extraMoments, isFlatLoud, openingLeadRates, phraseBudget, repeatPlan, scoreMoments, selectMoments, snappedMoments, soloLeadRates };
