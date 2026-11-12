// Difficulty as a filter over pattern events: keep the levels the difficulty allows, then the gaps and the density.
// This settles when a chart plays; its lanes only hold a place until chords.js and lanes.js lay the moments out. A final
// pass over the whole song (enforceFloors) has the last word on what is playable.
const { DENSITY_WINDOW_MS, ENERGY_EXPONENT, LEAD_IN_MS, SILENCE_ENERGY } = require("./difficulty");
const { beatPosition, gridSlot, timeAtPosition } = require("./grid");
const { beatMsOf, holdBlocks, isSupport, planHolds, spacedBlocked } = require("./holds");
const { budgeted, cutToRhythm } = require("./rhythm");
const { lowerBound, nearestIndex } = require("./util");

const LANES = 4;
const EPS = 1e-9;
const SEAM_LOOKBACK_MS = DENSITY_WINDOW_MS; // how much of the previous phrase's tail matters
const FINE_LEVEL = 2; // events at this level sit on the 1/8 grid; below it a difficulty plays the 1/4 grid at most
const TONAL_SOURCES = new Set(["bass", "lead"]);
const GRID_SLACK = 0.9; // a gap in beats is met within this much: a bending grid stretches it, the next step down is far below
const DOWNBEAT_MS = 1;

const handOf = (lane) => lane >> 1;

const asLookup = (energyAt) => (typeof energyAt === "function" ? { hopMs: 500, at: energyAt } : energyAt);

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const byPriority = (a, b) =>
  a.level - b.level || (a.turn ?? 0) - (b.turn ?? 0) || b.s - a.s || isSupport(a) - isSupport(b) || a.t - b.t || a.lane - b.lane;

function groupByTime(items) {
  const moments = [];
  for (const item of [...items].sort(byTime)) {
    const last = moments[moments.length - 1];
    if (last && last[0].t === item.t) last.push(item);
    else moments.push([item]);
  }
  return moments;
}

// --- chords ----------------------------------------------------------------------------

// At most `limit` events per time (the best by level, then strength).
function capMoments(items, limit) {
  const out = [];
  for (const moment of groupByTime(items)) {
    const kept = [];
    for (const e of [...moment].sort(byPriority)) {
      if (kept.length < limit && !kept.some((k) => k.lane === e.lane)) kept.push(e);
    }
    out.push(...kept);
  }
  return out;
}

// --- floors and density ------------------------------------------------------------------

// The gap diff.gapBeats asks of `candidate` to a note `n`: two notes of the sung or bass line may sit closer.
function beatGapMs(candidate, n, diff, beatMs) {
  if (!(diff.gapBeats > 0)) return 0;
  const tonal = TONAL_SOURCES.has(candidate.source) && TONAL_SOURCES.has(n.source);
  return (tonal ? diff.tonalGapBeats ?? diff.gapBeats : diff.gapBeats) * beatMs * GRID_SLACK;
}

// What adding `candidate` would break of the gaps and the sliding density cap: null when it keeps them all, else the rule
// (with the note it clashes with). `accepted` is time-sorted. `timing` (optional) gives the beat for diff.gapBeats.
function whyNotFits(candidate, accepted, diff, energy, powerFloor = 0, timing = null) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const beatMs = beatMsOf(timing, candidate.t);
  const reach = Math.max(noteGap, (diff.gapBeats ?? 0) * beatMs);
  const at = lowerBound(accepted.map((n) => n.t), candidate.t - reach);
  for (let i = at; i < accepted.length && accepted[i].t < candidate.t + reach; i++) {
    const n = accepted[i];
    const dt = Math.abs(n.t - candidate.t);
    const clash = (rule, needMs) => ({ rule, t: n.t, lane: n.lane, dtMs: dt, needMs });
    if (n.t !== candidate.t && dt < noteGap) return clash("noteGap", noteGap);
    if (n.t !== candidate.t && dt < beatGapMs(candidate, n, diff, beatMs)) return clash("beatGap", beatGapMs(candidate, n, diff, beatMs));
    if (n.lane === candidate.lane && n.t === candidate.t) return clash("sameSpot", 0);
  }
  return densityHolds(candidate, accepted, diff, energy, powerFloor) ? null : { rule: "density" };
}

// Mean of energy^ENERGY_EXPONENT, times the section's intensity (intensity.js) where the lookup has one, over a
// window; silent hops count as 0.
function windowPower(fromMs, energy) {
  let sum = 0;
  let n = 0;
  for (let t = fromMs; t < fromMs + DENSITY_WINDOW_MS; t += energy.hopMs) {
    const e = energy.at(t);
    sum += e >= SILENCE_ENERGY ? Math.pow(e, ENERGY_EXPONENT) * (energy.intensity?.(t) ?? 1) : 0;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

// Any DENSITY_WINDOW_MS window holds at most maxNps * 2 s notes, scaled by the window's power (energy^ENERGY_EXPONENT
// times the section's intensity, plus one note of slack, like the v3 carry); an intense section may go past maxNps
// by its intensity. `powerFloor` is the least power a window gets: a phrase with a steady pulse is never thinner
// than that, however quiet.
function densityHolds(candidate, accepted, diff, energy, powerFloor = 0) {
  const seconds = DENSITY_WINDOW_MS / 1000;
  const starts = new Set([candidate.t]);
  for (const n of accepted) if (n.t > candidate.t - DENSITY_WINDOW_MS && n.t < candidate.t) starts.add(n.t);
  for (const from of starts) {
    const inside = accepted.filter((n) => n.t >= from && n.t < from + DENSITY_WINDOW_MS);
    const count = diff.densityByMoment ? new Set([candidate.t, ...inside.map((n) => n.t)]).size : 1 + inside.length;
    const power = windowPower(from, energy);
    const hardCap = Math.floor(diff.maxNps * seconds * Math.max(1, power) + EPS);
    const cap = Math.min(hardCap, Math.floor(diff.maxNps * seconds * Math.max(powerFloor, power) + 1 + EPS));
    if (count > cap) return false;
  }
  return true;
}

function isDownbeat(timing, t) {
  const downbeats = timing?.downbeats ?? [];
  const i = nearestIndex(downbeats, t);
  return i >= 0 && Math.abs(downbeats[i] - t) <= DOWNBEAT_MS;
}

// Where t sits, strongest first: downbeat, beat, half beat, anything else.
function slotRank(timing, t) {
  const slot = gridSlot(timing, t);
  if (slot === null) return 3;
  if (slot.beat) return isDownbeat(timing, t) ? 0 : 1;
  return slot.half ? 2 : 3;
}

// The order events get to claim their place. With diff.leaderFirst the leading layer goes before what backs it and a
// beat before what sits next to it, so a player tapping along finds the note on the beat, and the tune is not pushed
// out by a louder drum transient. A long note goes before its equals: the song holds it, and a hold says so to the player.
function selectionOrder(items, diff, timing) {
  if (!diff.leaderFirst) return [...items].sort(byPriority);
  const cutFrom = !!diff.cutFrom; // cut from a harder level: where a moment sits comes before what plays it
  const ranked = items.map((item) => {
    const rank = slotRank(timing, item.t);
    const long = item.sustainMs >= beatMsOf(timing, item.t) ? 1 : 0;
    return { item, rank, long, tier: rank > 0 && isSupport(item) ? 1 : 0 }; // the downbeat is everyone's
  });
  ranked.sort((a, b) => (cutFrom ? a.item.level - b.item.level || a.rank - b.rank || a.tier - b.tier : a.tier - b.tier || a.item.level - b.item.level || a.rank - b.rank) || b.long - a.long || byPriority(a.item, b.item));
  return ranked.map((r) => r.item);
}

// Picks events in priority order (lowest level first, then strongest), skipping
// any that would break a floor or the density cap; so the highest level and the
// weakest events are what gets dropped. `onReject` (optional) hears each one dropped and why.
function selectByFloors(items, diff, energy, prevNotes, powerFloor = 0, timing = null, onReject = null) {
  const accepted = prevNotes.map((n) => ({ t: n.t, lane: n.lane })).sort(byTime);
  const kept = [];
  for (const item of selectionOrder(items, diff, timing)) {
    const why = whyNotFits(item, accepted, diff, energy, powerFloor, timing);
    if (why) {
      onReject?.(item, why);
      continue;
    }
    accepted.splice(lowerBound(accepted.map((n) => n.t), item.t), 0, { t: item.t, lane: item.lane, source: item.source });
    kept.push(item);
  }
  return kept.sort(byTime);
}

// --- chords that mean something (diff.thinChords) ---------------------------------------------

// A moment stays a chord only on a strong beat (diff.chord.onDownbeat: a downbeat) of a loud enough phrase, with a note
// in each hand; otherwise its best note plays alone. Off the downbeats chords spend a budget that grows by
// diff.maxChordShare per moment, so a part where every beat could be one doesn't become a wall of them.
function thinChords(items, diff, timing, phraseEnergy, energy) {
  const { minStrength, minEnergy, onDownbeat } = diff.chord;
  const share = diff.maxChordShare ?? 1;
  const out = [];
  let chords = 0;
  for (const [i, moment] of groupByTime(items).entries()) {
    const [best, ...rest] = [...moment].sort(byPriority);
    out.push(best);
    if (rest.length === 0) continue;
    const accent = (onDownbeat ? isDownbeat(timing, best.t) : gridSlot(timing, best.t)?.beat === true)
      && Math.max(...moment.map((e) => e.s ?? 0)) >= minStrength
      && (phraseEnergy ?? energy.at(best.t)) >= minEnergy;
    const partner = accent && rest.find((e) => handOf(e.lane) !== handOf(best.lane));
    if (partner && (isDownbeat(timing, best.t) || chords < share * (i + 1))) {
      out.push(partner);
      chords++;
    }
  }
  return out;
}

// --- what a difficulty may ask of the half-beat grid -------------------------------------------

const offHalfGrid = (timing, t) => {
  const slot = gridSlot(timing, t);
  return slot !== null && !slot.beat && !slot.half;
};

// A long sung note off the half-beat grid starts on the nearest beat and ends where it did (diff.longNotesOnBeats).
// Short ones stay out: they would be heard a quarter beat from where they are played, a long one is held through it.
function longNoteOnBeat(e, timing) {
  if (e.source !== "lead" || !(e.sustainMs >= beatMsOf(timing, e.t)) || !timing?.snapped || !offHalfGrid(timing, e.t)) return e;
  const t = timeAtPosition(timing, Math.round(beatPosition(timing, e.t)));
  return { ...e, t, level: 0, sustainMs: e.sustainMs + e.t - t };
}

// A chord with a note closer than diff.chordGapBeats (or diff.gapBeats) keeps only its best note: it would sit inside a run.
function spaceChords(items, diff, timing) {
  const moments = groupByTime(items);
  return moments.flatMap((moment, i) => {
    if (moment.length < 2) return moment;
    const clear = (diff.chordGapBeats ?? diff.gapBeats) * beatMsOf(timing, moment[0].t) * GRID_SLACK;
    const crowded = [moments[i - 1], moments[i + 1]].some((o) => o && Math.abs(o[0].t - moment[0].t) < clear);
    return crowded ? [[...moment].sort(byPriority)[0]] : moment;
  });
}

// The density power a phrase with a steady pulse never drops below: the difficulty's pulseNotesPerBeat at the
// song's tempo, as a share of maxNps (so the usual cap formula yields it). 0 without a pulse or a beat grid.
function pulsePowerFloor(diff, timing) {
  if (!(diff.pulseNotesPerBeat > 0) || !(diff.maxNps > 0) || !timing?.snapped) return 0;
  return Math.min(1, (diff.pulseNotesPerBeat * 1000) / (timing.medianMs * diff.maxNps));
}

// At a tempo too fast for its 1/4 grid to be the everyday one (a 1/4 step under diff.fastQuarterMs), that grid counts
// as the fine one: an event off the half beats steps down a level, so the half beats claim their place first and what
// was already fine (hats, 1/8 hits) drops out.
function fastQuarterLevel(e, diff, timing) {
  if (!(diff.fastQuarterMs > 0) || !timing?.snapped) return e;
  if (beatMsOf(timing, e.t) / 4 >= diff.fastQuarterMs || !offHalfGrid(timing, e.t)) return e;
  return { ...e, level: e.level + 1 };
}

// --- public API ----------------------------------------------------------------------------

// applyDifficulty(events, diff, timing, energyAt, prevNotes, phraseEnergy, phraseEndMs, steadyPulse) -> [{ t, lane, len? }]
// `prevNotes` is the previous phrase's tail (gaps and holds carry across the seam).
// `phraseEnergy` (optional) is the phrase's mean energy for the chords;
// without it the energy at the event's time is used. `phraseEndMs` (optional) keeps holds
// inside their phrase. A sustained bass/lead event becomes a hold (see holds.js). `steadyPulse` (optional)
// marks a phrase whose beats carry drum or bass onsets: it gets a density floor (pulsePowerFloor). `trace` (optional,
// trace.js) hears what every stage did; the notes then keep their ids. `cut` (optional, { rhythm, fromMs, toMs }) is the
// harder level's rhythm this phrase is cut from, and the part of it the phrase covers (rhythm.js).
function applyDifficulty(events, diff, timing, energyAt, prevNotes = [], phraseEnergy = null, phraseEndMs = Infinity, steadyPulse = false, trace = null, cut = null) {
  const energy = asLookup(energyAt);
  const tail = (Array.isArray(prevNotes) ? prevNotes : []).filter((n) => Number.isFinite(n?.t) && Number.isInteger(n?.lane));
  const sorted = [...events].sort(byTime);
  const lastKept = sorted.length > 0 ? sorted[0].t - SEAM_LOOKBACK_MS : 0;
  const prev = tail.filter((n) => n.t >= lastKept || n.t + (n.len > 0 ? n.len : 0) >= lastKept);

  // A tonal note on the 1/8 grid is level 1 so Normal keeps the syncopation; there it plays on the 1/4 grid.
  const onGrid = (e) => (diff.maxLevel < FINE_LEVEL && Number.isFinite(e.coarseT) ? { ...e, t: e.coarseT } : e);

  const step = (stage, before, after) => (trace ? trace.step(stage, before, after) : after);
  const keep = (stage, list, test) => step(stage, list, list.filter(test));

  const placed = sorted
    .map(onGrid)
    .map((e) => (diff.longNotesOnBeats ? longNoteOnBeat(e, timing) : e))
    .map((e) => fastQuarterLevel(e, diff, timing))
    .sort(byTime);
  step("gridLevel", sorted, placed);
  const inRhythm = cut ? step("cut", placed, cutToRhythm(placed, cut, timing)).sort(byTime) : placed;
  const topLevel = cut ? diff.cutLevel : diff.maxLevel;
  let items = keep("level", inRhythm, (e) => (e.level <= topLevel || (diff.thinChords && e.accent)) && (!e.chordOnly || diff.drumChords));
  items = keep("leadIn", items, (e) => e.t >= LEAD_IN_MS);
  items = keep("silence", items, (e) => energy.at(e.t) >= SILENCE_ENERGY).map((e) => ({ ...e }));
  if (cut) items = step("budget", items, budgeted(items, diff, timing, cut, phraseEnergy));

  if (diff.thinChords) items = step("thinChords", items, thinChords(items, diff, timing, phraseEnergy, energy));
  items = step("capMoments", items, capMoments(items, diff.chord ? 2 : 1));
  const onReject = trace ? (item, why) => trace.reject(item, "floors", why) : null;
  items = step("floors", items, selectByFloors(items, diff, energy, prev, Math.max(steadyPulse ? pulsePowerFloor(diff, timing) : 0, diff.leadPowerFloor ?? 0), timing, onReject));
  if (diff.thinChords) items = step("spaceChords", items, spaceChords(items, diff, timing));
  items = step("planHolds", items, planHolds(items.sort(byTime), diff, timing, prev, phraseEndMs));
  const bare = (n) => (n.len > 0 ? { t: n.t, lane: n.lane, len: n.len } : { t: n.t, lane: n.lane });
  return items.sort(byTime).map((n) => (trace ? { ...bare(n), tid: n.tid } : bare(n)));
}

// The gap two moments must keep: the level's, or `close.gapMs` if that is shorter and one of the two is a moment of `close.times`.
const gapBetween = (a, b, noteGap, close) => (close && (close.times.has(a) || close.times.has(b)) ? Math.min(noteGap, close.gapMs) : noteGap);

// Final whole-song pass: drops only notes that break minNoteGapMs (any lane,
// between distinct times), minLaneGapMs (same lane, counted from the end of a hold)
// or a hold's rules (see holds.js). The earlier note wins. `timing` (optional) gives
// the beat length for Normal's half-beat spacing next to a hold. `close` (optional,
// { times, gapMs }: diff.fastRuns) lets a moment of `times` and its neighbour
// stand gapMs apart.
function enforceFloors(notes, diff, timing = null, close = null) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  const reach = Math.max(noteGap, laneGap);
  const laneFree = new Array(LANES).fill(-Infinity); // when each lane's last note (or hold) ends
  let lastT = -Infinity;
  let active = []; // kept holds that can still constrain later notes
  const out = [];
  for (const note of [...notes].sort(byTime)) {
    if (note.t !== lastT && note.t - lastT < gapBetween(lastT, note.t, noteGap, close)) continue;
    if (note.t - laneFree[note.lane] < laneGap) continue;
    active = active.filter((h) => h.t + h.len + reach > note.t);
    const halfBeat = beatMsOf(timing, note.t) / 2;
    if (active.some((h) => holdBlocks(h, note, diff) || spacedBlocked(h, note, out, diff, halfBeat))) continue;
    if (note.len > 0 && out.some((o) => o.t === note.t && holdBlocks(note, o, diff))) continue;
    out.push(note);
    lastT = note.t;
    laneFree[note.lane] = note.t + (note.len > 0 ? note.len : 0);
    if (note.len > 0) active.push(note);
  }
  return out;
}

// The moments a chart keeps before its lanes are known: only the gap between moments counts, and the earlier note wins.
// `close` as in enforceFloors.
function spacedMoments(notes, diff, close = null) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const seen = new Set();
  let lastT = -Infinity;
  const out = [];
  for (const note of [...notes].sort(byTime)) {
    if (note.t !== lastT && note.t - lastT < gapBetween(lastT, note.t, noteGap, close)) continue;
    const key = `${note.t}:${note.lane}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
    lastT = note.t;
  }
  return out;
}

module.exports = { applyDifficulty, capMoments, enforceFloors, groupByTime, pulsePowerFloor, selectByFloors, slotRank, spacedMoments };
