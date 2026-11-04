// A mapper writes the moments of the hardest level first and makes the easier ones by leaving moments out: beats stay,
// half beats go with the tempo, quarter beats go first. Hard's rhythm is the music's beats and half beats wherever a
// sound is heard on them, plus what the patterns found; Normal cuts Hard's moments and Easy cuts Normal's. Each level
// then lays out its own chords and lanes over them (chords.js, lanes.js).
const { beatInBar, gridSlot } = require("./grid");
const { lowerBound, nearestIndex } = require("./util");

const SNAP_MS = 25; // an event this near a moment of the harder level plays on that moment
const ONSET_MS = 35; // a sound this near a grid point is heard on it
const DEFAULT_STRENGTH = 0.3; // a moment no sound is near: a fill or an accent the chart asked for
const RUN_GAP_BEATS = 0.6; // moments no further apart than this are one run of half beats
const POSITIONS_PER_BEAT = 4;
const TONAL_BONUS = 0.25; // a note of the tune claims its place before a louder hit next to it
const CHORD_BONUS = 0.3; // people keep nearly every chord of the level above and half of its single notes
const QUIET_SCALE = 0.6; // a phrase's budget at its quietest and loudest
const LOUD_SCALE = 1.3;
const MID_ENERGY = 0.5; // a phrase this loud gets the budget as written
const TONAL_SOURCES = new Set(["bass", "lead"]);

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;

// Every layer event and band onset as { t, s }, time-ordered: what the music plays, whichever layer heard it.
function sortedOnsets(features) {
  const out = [];
  const push = (e) => {
    if (Number.isFinite(e?.t)) out.push({ t: e.t, s: Number.isFinite(e.s) ? e.s : 0.5 });
  };
  for (const layer of ["drums", "bass", "lead"]) (Array.isArray(features[layer]) ? features[layer] : []).forEach(push);
  for (const band of features.bands) (Array.isArray(band?.onsets) ? band.onsets : []).forEach(push);
  return out.sort((a, b) => a.t - b.t);
}

// How strong the loudest sound heard at t is, or null when nothing sounds there.
function strengthAt(ctx, t) {
  const { eventTimes, onsets } = ctx;
  let best = null;
  for (let i = lowerBound(eventTimes, t - ONSET_MS); i < eventTimes.length && eventTimes[i] <= t + ONSET_MS; i++) {
    if (best === null || onsets[i].s > best) best = onsets[i].s;
  }
  return best;
}

// Where t sits, strongest first: 0 a beat, 1 a half beat, 2 a quarter beat, 3 anything finer. Without a grid, or where
// the grid has a hole, every event keeps the level its pattern gave it.
function metricLevel(timing, t, own) {
  if (!timing?.snapped || !timing.intervalOk(t)) return own ?? 1;
  const slot = gridSlot(timing, t);
  if (slot === null) return 3;
  if (slot.beat) return 0;
  if (slot.half) return 1;
  return slot.quarter ? 2 : 3;
}

// The lanes of events that have none: the other hand than the last note, there the lane rested longest. It walks the
// four lanes rather than trilling two.
function laneTheRest(events) {
  const lastAt = [-Infinity, -Infinity, -Infinity, -Infinity];
  let lastHand = 1;
  return [...events].sort((a, b) => a.t - b.t).map((e) => {
    let lane = e.lane;
    if (!Number.isInteger(lane)) {
      const low = (1 - lastHand) * 2;
      lane = lastAt[low] <= lastAt[low + 1] ? low : low + 1;
    }
    lastAt[lane] = e.t;
    lastHand = lane >> 1;
    return Number.isInteger(e.lane) ? e : { ...e, lane };
  });
}

// withBeats(events, phrase, ctx) -> events: the phrase's patterns over the skeleton of its beats. An event on a beat or
// a half beat ranks by that place whatever instrument it came from (a hat may carry a half beat), and a beat or half
// beat where the music sounds but no pattern looked gets an event of its own. Quarter beats keep their levels, so a
// sung syncopation stays where the pattern put it.
function withBeats(events, phrase, ctx) {
  const { timing } = ctx;
  if (!timing?.snapped) return events;
  const lifted = events.map((e) => {
    if (e.chordOnly) return e;
    const place = metricLevel(timing, e.t, e.level);
    return place < 2 && e.level > place ? { ...e, level: place } : e;
  });
  const points = timing.gridPoints(2);
  const times = lifted.map((e) => e.t).sort((a, b) => a - b);
  const added = [];
  for (let i = lowerBound(points, phrase.startMs); i < points.length && points[i] < phrase.endMs; i++) {
    const t = points[i];
    const near = nearestIndex(times, t);
    if (near >= 0 && Math.abs(times[near] - t) <= ONSET_MS) continue;
    const s = strengthAt(ctx, t);
    if (s !== null) added.push({ t, level: metricLevel(timing, t, 1), s, source: "rhythm", support: true });
  }
  return added.length > 0 ? laneTheRest([...lifted, ...added]) : lifted;
}

// The moments of a finished chart: { moments: sorted times, at: Map(t -> notes), strength: Map(t -> s), sounds }.
// `sounds` is what fillRests may pick from on a level cut from this one.
function rhythmOf(notes, ctx) {
  const at = new Map();
  for (const n of notes) {
    if (!at.has(n.t)) at.set(n.t, []);
    at.get(n.t).push(n);
  }
  const moments = [...at.keys()].sort((a, b) => a - b);
  const strength = new Map(moments.map((t) => [t, strengthAt(ctx, t) ?? DEFAULT_STRENGTH]));
  const sounds = moments.map((t) => {
    const { lane } = at.get(t)[0];
    return { t, s: strength.get(t), lanes: [...new Set([lane, lane ^ 1, 3 - lane, 3 - (lane ^ 1)])], layer: "rhythm" };
  });
  return { moments, at, strength, sounds };
}

// cutToRhythm(events, { rhythm, fromMs, toMs }, timing) -> events on the harder level's moments only. A phrase's own
// event keeps its lane and moves onto the moment it is near; any other is dropped. A moment in the window that no event
// of this phrase reached is borrowed: all its notes, new objects, on their lanes. A level is ranked by where a moment
// sits, not by what played it.
function cutToRhythm(events, { rhythm, fromMs, toMs }, timing) {
  const { moments, at, strength } = rhythm;
  const covered = new Set();
  const own = [];
  for (const e of events) {
    const i = nearestIndex(moments, e.t);
    if (i < 0 || Math.abs(moments[i] - e.t) > SNAP_MS) continue;
    if (!e.chordOnly) covered.add(moments[i]);
    own.push({ ...e, t: moments[i], level: metricLevel(timing, moments[i], e.level), upperChord: at.get(moments[i]).length > 1 });
  }
  const borrowed = [];
  for (let i = lowerBound(moments, fromMs); i < moments.length && moments[i] < toMs; i++) {
    const t = moments[i];
    if (covered.has(t)) continue;
    for (const n of at.get(t)) {
      const event = { t, lane: n.lane, level: metricLevel(timing, t), s: strength.get(t), source: "rhythm", support: true, upperChord: at.get(t).length > 1 };
      borrowed.push(n.len > 0 ? { ...event, sustainMs: n.len } : event);
    }
  }
  return [...own, ...borrowed];
}

const shareAt = (table, bpm) => table.find(([upTo]) => bpm < upTo)?.[1] ?? 0;

// Keeps the `count` best of `moments` (times): strong, and at a place in the bar that is strong all phrase, so what is
// left is a rhythm that comes back rather than scattered peaks. A note of the tune goes first.
function bestMoments(moments, count, byMoment, timing) {
  const positionOf = (t) => Math.round(beatInBar(timing, t) * POSITIONS_PER_BEAT);
  const strengthOf = (t) => Math.max(...byMoment.get(t).map((e) => e.s ?? 0));
  const sums = new Map();
  for (const t of moments) {
    const { sum = 0, n = 0 } = sums.get(positionOf(t)) ?? {};
    sums.set(positionOf(t), { sum: sum + strengthOf(t), n: n + 1 });
  }
  const scoreOf = (t) => {
    const { sum, n } = sums.get(positionOf(t));
    const events = byMoment.get(t);
    return 0.5 * strengthOf(t) + (0.5 * sum) / n + (events.some((e) => TONAL_SOURCES.has(e.source)) ? TONAL_BONUS : 0) + (events.some((e) => e.upperChord) ? CHORD_BONUS : 0);
  };
  return moments
    .map((t) => ({ t, score: scoreOf(t) }))
    .sort((a, b) => b.score - a.score || a.t - b.t)
    .slice(0, count)
    .map((m) => m.t);
}

// budgeted(items, diff, timing, { fromMs, toMs }, phraseEnergy) -> items: beats stay (in a quiet phrase only their
// diff.quietBeats share); the half beats (and the quarter beats) a mapper of this level plays at this tempo, per beat of
// the phrase, as written in diff.halfBudget and diff.quarterBudget and scaled by how loud the phrase is.
// diff.maxHalfRun ends a run of half beats on the next beat.
function budgeted(items, diff, timing, { fromMs, toMs }, phraseEnergy) {
  if (!diff.halfBudget || !timing?.snapped) return items;
  const beats = Math.max(0, Math.min(toMs, timing.beats.at(-1)) - Math.max(fromMs, timing.beats[0])) / timing.medianMs;
  const bpm = 60000 / timing.medianMs;
  const scale = Number.isFinite(phraseEnergy) ? Math.min(LOUD_SCALE, Math.max(QUIET_SCALE, phraseEnergy / MID_ENERGY)) : 1;
  const byMoment = new Map();
  for (const e of items) {
    if (!byMoment.has(e.t)) byMoment.set(e.t, []);
    byMoment.get(e.t).push(e);
  }
  // Where the grid has a hole nobody can say what is a half beat: those moments stay, the floors thin them.
  const ofLevel = (level) => [...byMoment.keys()].filter((t) => timing.intervalOk(t) && metricLevel(timing, t) === level);
  const budgetedLevel = (t) => timing.intervalOk(t) && (metricLevel(timing, t) === 1 || metricLevel(timing, t) === 2);
  const kept = new Set([...byMoment.keys()].filter((t) => !budgetedLevel(t)));
  if (diff.quietBeats > 0 && Number.isFinite(phraseEnergy) && phraseEnergy < MID_ENERGY) {
    const onBeat = ofLevel(0);
    const stay = new Set(bestMoments(onBeat, Math.round(onBeat.length * Math.max(diff.quietBeats, phraseEnergy / MID_ENERGY)), byMoment, timing));
    for (const t of onBeat) if (!stay.has(t)) kept.delete(t);
  }
  for (const t of bestMoments(ofLevel(1), Math.round(shareAt(diff.halfBudget, bpm) * scale * beats), byMoment, timing)) kept.add(t);
  const quarters = diff.quarterBudget ? Math.round(shareAt(diff.quarterBudget, bpm) * scale * 2 * beats) : Infinity;
  for (const t of bestMoments(ofLevel(2), quarters, byMoment, timing)) kept.add(t);
  if (diff.maxHalfRun > 0) {
    const beatMs = timing.medianMs;
    let run = 0;
    let last = -Infinity;
    for (const t of [...kept].sort((a, b) => a - b)) {
      if (metricLevel(timing, t) > 0 && t - last <= RUN_GAP_BEATS * beatMs && run >= diff.maxHalfRun) {
        kept.delete(t);
        continue;
      }
      run = t - last <= RUN_GAP_BEATS * beatMs ? run + 1 : 1;
      last = t;
    }
  }
  return items.filter((e) => kept.has(e.t));
}

// Only the harder level's moments: a note near one moves onto it, any other goes. What every later stage does to a
// chart only removes notes, shortens them or changes their lane, so a level stays inside the one it was cut from.
function nested(notes, rhythm) {
  const { moments } = rhythm;
  const seen = new Set();
  const out = [];
  for (const n of [...notes].sort(byTime)) {
    const i = nearestIndex(moments, n.t);
    if (i < 0 || Math.abs(moments[i] - n.t) > SNAP_MS) continue;
    const t = moments[i];
    if (seen.has(`${t}:${n.lane}`)) continue;
    seen.add(`${t}:${n.lane}`);
    out.push(t === n.t ? n : { ...n, t });
  }
  return out;
}

module.exports = { MID_ENERGY, budgeted, cutToRhythm, laneTheRest, metricLevel, nested, rhythmOf, sortedOnsets, strengthAt, withBeats };
