// Difficulty as a filter over pattern events: keep the levels the difficulty
// allows, then enforce what is playable (chords, jacks, gaps, density).
// Precedence when constraints collide: floors (minNoteGapMs / minLaneGapMs)
// > never 3-note chords > repeat identity > jack limit at phrase seams.
const { DENSITY_WINDOW_MS, ENERGY_EXPONENT, LEAD_IN_MS, SILENCE_ENERGY } = require("./difficulty");
const { beatPosition, gridSlot, timeAtPosition } = require("./grid");
const { beatMsOf, holdBlocks, holdSafe, isSupport, planHolds, spacedBlocked } = require("./holds");
const { lowerBound, nearestIndex } = require("./util");

const LANES = 4;
const EPS = 1e-9;
const SEAM_LOOKBACK_MS = DENSITY_WINDOW_MS; // how much of the previous phrase's tail matters
const FINE_LEVEL = 2; // events at this level sit on the 1/8 grid; below it a difficulty plays the 1/4 grid at most
const TONAL_SOURCES = new Set(["bass", "lead"]);
const GRID_SLACK = 0.9; // a gap in beats is met within this much: a bending grid stretches it, the next step down is far below
const FAST_GAP_BEATS = 0.3; // a gap up to this long keeps a fast run going (diff.maxFastRun)
const DOWNBEAT_MS = 1;

const handOf = (lane) => lane >> 1;
// The beat the player counts: a grid doubled for a half-time song (timing.foldFactor) still feels like its real tempo.
const feltBeatMs = (timing, t) => beatMsOf(timing, t) * Math.max(1, timing?.foldFactor ?? 1);

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

// --- jacks -----------------------------------------------------------------------------

// Lanes in order of preference when a note has to leave `lane`: a drum hit (or secondary drum) first
// takes its role partner (kick 0<->3, snare 1<->2), then the lane ^ 1 neighbour,
// then the rest by distance.
function alternatives(lane, source, hand) {
  // A note of a mixed phrase (it has a hand) stays in its hand: the neighbour lane first.
  const order = hand === undefined && (source === "drums" || source === "secondary") ? [LANES - 1 - lane, lane ^ 1] : [lane ^ 1];
  const rest = [0, 1, 2, 3].sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane) || a - b);
  return [...new Set([...order, ...rest])].filter((l) => l !== lane);
}

// Same-lane run lengths at the end of `notes`, and the lanes of the last moment.
function trailingRuns(notes) {
  const runs = new Array(LANES).fill(0);
  const moments = groupByTime(notes);
  if (moments.length === 0) return { runs, last: new Set() };
  const last = new Set(moments[moments.length - 1].map((n) => n.lane));
  const alive = new Set(last);
  for (const l of last) runs[l] = 1;
  // Walk back moment by moment, extending the run of lanes present in every step.
  for (let m = moments.length - 2; m >= 0 && alive.size > 0; m--) {
    const lanes = new Set(moments[m].map((n) => n.lane));
    for (const l of [...alive]) {
      if (lanes.has(l)) runs[l]++;
      else alive.delete(l);
    }
  }
  return { runs, last };
}

// Is placing a note at (lane, t) clear of every other note in that lane by `gap`?
function laneClear(lane, t, gap, pool, ignore) {
  return pool.every((n) => n === ignore || n.lane !== lane || Math.abs(n.t - t) >= gap);
}

// Moves notes out of same-lane runs longer than diff.maxJack. `notes` are records
// ({t, lane, source?}), time-ordered; `prevNotes` seed the run state. A note that
// has no free lane keeps its lane (lenient) or is dropped (strict). Lane moves
// respect minLaneGapMs on both sides.
function limitJacks(notes, diff, prevNotes, { strict, timing = null }) {
  const maxJack = diff.maxJack ?? LANES;
  const minLane = diff.minLaneGapMs ?? 0;
  const seed = trailingRuns(prevNotes);
  let runs = seed.runs;
  let last = seed.last;
  const out = [...notes];
  const dropped = new Set();

  for (const moment of groupByTime(out)) {
    const taken = new Set(moment.map((n) => n.lane));
    const nextRuns = new Array(LANES).fill(0);
    const nextLast = new Set();
    for (const note of moment) {
      const runOf = (l) => (last.has(l) ? runs[l] + 1 : 1);
      let lane = note.lane;
      if (runOf(lane) > maxJack) {
        const pool = [...prevNotes, ...out.filter((n) => !dropped.has(n))];
        const free = alternatives(lane, note.source, note.hand).filter((l) => !taken.has(l) && runOf(l) <= maxJack);
        // A held note may only move where it (and the notes around it) keep the hold rules.
        const clear = free.find(
          (l) => laneClear(l, note.t, minLane, pool, note) && holdSafe({ t: note.t, lane: l, len: note.len }, pool.filter((n) => n !== note), diff, timing),
        );
        const choice = clear ?? (strict ? undefined : free[0]);
        if (choice === undefined) {
          if (strict) {
            dropped.add(note);
            taken.delete(note.lane);
            continue;
          }
        } else {
          taken.delete(note.lane);
          taken.add(choice);
          note.lane = choice;
          lane = choice;
        }
      }
      nextRuns[lane] = runOf(lane);
      nextLast.add(lane);
    }
    runs = nextRuns;
    last = nextLast;
  }
  return out.filter((n) => !dropped.has(n));
}

// --- floors and density ------------------------------------------------------------------

// The gap diff.gapBeats asks of `candidate` to a note `n`: two notes of the sung or bass line may sit closer.
function beatGapMs(candidate, n, diff, felt) {
  if (!(diff.gapBeats > 0)) return 0;
  const tonal = TONAL_SOURCES.has(candidate.source) && TONAL_SOURCES.has(n.source);
  return (tonal ? diff.tonalGapBeats ?? diff.gapBeats : diff.gapBeats) * felt * GRID_SLACK;
}

// Would `candidate` make more than diff.maxFastRun fast gaps in a row?
function fastRunHolds(candidate, accepted, diff, felt) {
  if (!(diff.maxFastRun > 0)) return true;
  const fast = FAST_GAP_BEATS * felt;
  const reach = fast * (diff.maxFastRun + 1);
  const near = accepted.filter((n) => Math.abs(n.t - candidate.t) <= reach).map((n) => n.t);
  const times = [...new Set([candidate.t, ...near])].sort((a, b) => a - b);
  let run = 0;
  for (let i = 1; i < times.length; i++) {
    run = times[i] - times[i - 1] <= fast ? run + 1 : 0;
    if (run > diff.maxFastRun) return false;
  }
  return true;
}

// Does adding `candidate` keep every gap and the sliding density cap?
// `accepted` is time-sorted. `timing` (optional) gives the beat for diff.gapBeats and diff.maxFastRun.
function fits(candidate, accepted, diff, energy, powerFloor = 0, timing = null) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  const felt = feltBeatMs(timing, candidate.t);
  const reach = Math.max(noteGap, laneGap, (diff.gapBeats ?? 0) * felt);
  const at = lowerBound(accepted.map((n) => n.t), candidate.t - reach);
  for (let i = at; i < accepted.length && accepted[i].t < candidate.t + reach; i++) {
    const n = accepted[i];
    const dt = Math.abs(n.t - candidate.t);
    if (n.t !== candidate.t && (dt < noteGap || dt < beatGapMs(candidate, n, diff, felt))) return false;
    if (n.lane === candidate.lane && dt < laneGap) return false;
    if (n.lane === candidate.lane && n.t === candidate.t) return false;
  }
  return fastRunHolds(candidate, accepted, diff, felt) && densityHolds(candidate, accepted, diff, energy, powerFloor);
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
  const ranked = items.map((item) => {
    const rank = slotRank(timing, item.t);
    const long = item.sustainMs >= beatMsOf(timing, item.t) ? 1 : 0;
    return { item, rank, long, tier: rank > 0 && isSupport(item) ? 1 : 0 }; // the downbeat is everyone's
  });
  ranked.sort((a, b) => a.tier - b.tier || a.item.level - b.item.level || a.rank - b.rank || b.long - a.long || byPriority(a.item, b.item));
  return ranked.map((r) => r.item);
}

// Picks events in priority order (lowest level first, then strongest), skipping
// any that would break a floor or the density cap; so the highest level and the
// weakest events are what gets dropped.
function selectByFloors(items, diff, energy, prevNotes, powerFloor = 0, timing = null) {
  const accepted = prevNotes.map((n) => ({ t: n.t, lane: n.lane })).sort(byTime);
  const kept = [];
  for (const item of selectionOrder(items, diff, timing)) {
    if (!fits(item, accepted, diff, energy, powerFloor, timing)) continue;
    accepted.splice(lowerBound(accepted.map((n) => n.t), item.t), 0, { t: item.t, lane: item.lane, source: item.source });
    kept.push(item);
  }
  return kept.sort(byTime);
}

// --- chords that mean something (diff.thinChords) ---------------------------------------------

// A moment stays a chord only on a strong downbeat of a loud enough phrase, with a note in each hand; otherwise its
// best note plays alone.
function thinChords(items, diff, timing, phraseEnergy, energy) {
  const { minStrength, minEnergy } = diff.chord;
  const out = [];
  for (const moment of groupByTime(items)) {
    const [best, ...rest] = [...moment].sort(byPriority);
    out.push(best);
    if (rest.length === 0) continue;
    const accent = isDownbeat(timing, best.t)
      && Math.max(...moment.map((e) => e.s ?? 0)) >= minStrength
      && (phraseEnergy ?? energy.at(best.t)) >= minEnergy;
    const partner = accent && rest.find((e) => handOf(e.lane) !== handOf(best.lane));
    if (partner) out.push(partner);
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

// At most diff.maxQuarterShare of the moments stay off the half-beat grid: the weakest go, long notes last.
function capQuarters(items, diff, timing) {
  const moments = groupByTime(items);
  const quarters = moments.filter((m) => offHalfGrid(timing, m[0].t));
  const share = diff.maxQuarterShare;
  const excess = Math.ceil((quarters.length - share * moments.length) / (1 - share));
  if (excess <= 0) return items;
  const weight = (m) => Math.max(...m.map((e) => e.s ?? 0));
  const long = (m) => m.some((e) => e.sustainMs > 0);
  const out = quarters.sort((a, b) => long(a) - long(b) || weight(a) - weight(b)).slice(0, excess);
  const dropped = new Set(out.flat());
  return items.filter((e) => !dropped.has(e));
}

// A chord with a note closer than diff.gapBeats keeps only its best note: it would sit inside a run.
function spaceChords(items, diff, timing) {
  const moments = groupByTime(items);
  return moments.flatMap((moment, i) => {
    if (moment.length < 2) return moment;
    const clear = diff.gapBeats * feltBeatMs(timing, moment[0].t) * GRID_SLACK;
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

// --- public API ----------------------------------------------------------------------------

// applyDifficulty(events, diff, timing, energyAt, prevNotes, phraseEnergy, phraseEndMs, steadyPulse) -> [{ t, lane, len? }]
// `prevNotes` is the previous phrase's tail (gaps, jacks and holds carry across the seam).
// `phraseEnergy` (optional) is the phrase's mean energy for Normal's quarter-grid rule;
// without it the energy at the event's time is used. `phraseEndMs` (optional) keeps holds
// inside their phrase. A sustained bass/lead event becomes a hold (see holds.js). `steadyPulse` (optional)
// marks a phrase whose beats carry drum or bass onsets: it gets a density floor (pulsePowerFloor).
function applyDifficulty(events, diff, timing, energyAt, prevNotes = [], phraseEnergy = null, phraseEndMs = Infinity, steadyPulse = false) {
  const energy = asLookup(energyAt);
  const tail = (Array.isArray(prevNotes) ? prevNotes : []).filter((n) => Number.isFinite(n?.t) && Number.isInteger(n?.lane));
  const sorted = [...events].sort(byTime);
  const lastKept = sorted.length > 0 ? sorted[0].t - SEAM_LOOKBACK_MS : 0;
  const prev = tail.filter((n) => n.t >= lastKept || n.t + (n.len > 0 ? n.len : 0) >= lastKept);

  // A tonal note on the 1/8 grid is level 1 so Normal keeps the syncopation; there it plays on the 1/4 grid.
  const onGrid = (e) => (diff.maxLevel < FINE_LEVEL && Number.isFinite(e.coarseT) ? { ...e, t: e.coarseT } : e);

  let items = sorted
    .map(onGrid)
    .map((e) => (diff.longNotesOnBeats ? longNoteOnBeat(e, timing) : e))
    .sort(byTime)
    .filter((e) => e.level <= diff.maxLevel || (diff.thinChords && e.accent))
    .filter((e) => {
      // A sung or bass line is not "quiet phrase filler": its off-beat notes are the tune.
      if (!(diff.quarterMinEnergy > 0) || e.level !== 1 || TONAL_SOURCES.has(e.source)) return true;
      const slot = gridSlot(timing, e.t);
      const offHalf = slot !== null && !slot.beat && !slot.half;
      return !(offHalf && (phraseEnergy ?? energy.at(e.t)) < diff.quarterMinEnergy);
    })
    .filter((e) => {
      if (!diff.secondaryOnBeats || e.source !== "secondary") return true;
      const slot = gridSlot(timing, e.t);
      return slot === null || slot.beat;
    })
    .filter((e) => e.t >= LEAD_IN_MS && energy.at(e.t) >= SILENCE_ENERGY)
    .map((e) => ({ ...e }));

  if (diff.thinChords) items = thinChords(items, diff, timing, phraseEnergy, energy);
  items = capMoments(items, diff.chord ? 2 : 1);
  items = limitJacks(items, diff, prev, { strict: false, timing });
  items = selectByFloors(items, diff, energy, prev, steadyPulse ? pulsePowerFloor(diff, timing) : 0, timing);
  if (diff.maxQuarterShare != null) items = capQuarters(items, diff, timing);
  if (diff.thinChords) items = spaceChords(items, diff, timing);
  items = planHolds(items.sort(byTime), diff, timing, prev, phraseEndMs);
  items = limitJacks(items, diff, prev, { strict: true, timing });
  return items.sort(byTime).map((n) => (n.len > 0 ? { t: n.t, lane: n.lane, len: n.len } : { t: n.t, lane: n.lane }));
}

// Final whole-song pass: drops only notes that break minNoteGapMs (any lane,
// between distinct times), minLaneGapMs (same lane, counted from the end of a hold)
// or a hold's rules (see holds.js). The earlier note wins. `timing` (optional) gives
// the beat length for Normal's half-beat spacing next to a hold.
function enforceFloors(notes, diff, timing = null) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  const reach = Math.max(noteGap, laneGap);
  const laneFree = new Array(LANES).fill(-Infinity); // when each lane's last note (or hold) ends
  let lastT = -Infinity;
  let active = []; // kept holds that can still constrain later notes
  const out = [];
  for (const note of [...notes].sort(byTime)) {
    if (note.t !== lastT && note.t - lastT < noteGap) continue;
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

// spreadLanes(notes, diff, timing, prevNotes) -> notes (diff.spreadLanes): a note closer than laneGapBeats (felt
// beats) after the last note of its lane moves to a free lane; only with none free is it dropped. The hand the last
// note did not use comes first, then the lane nearest the mirror (which keeps a drum's kick or snare role). Whatever
// made the repeat (a groove, a seam, a fill), a chart without one comes through untouched.
function spreadLanes(notes, diff, timing, prevNotes = []) {
  if (!diff.spreadLanes) return notes;
  const out = [...notes].sort(byTime).map((n) => ({ ...n }));
  const lastAt = new Array(LANES).fill(-Infinity);
  for (const n of prevNotes) lastAt[n.lane] = Math.max(lastAt[n.lane], n.t);
  const dropped = new Set();
  let prevHand = null;
  for (const moment of groupByTime(out)) {
    const gap = (diff.laneGapBeats ?? 0) * feltBeatMs(timing, moment[0].t) * GRID_SLACK;
    const taken = new Set(moment.map((n) => n.lane));
    for (const note of moment) {
      if (moment[0].t - lastAt[note.lane] < gap) {
        const mirror = LANES - 1 - note.lane;
        const others = [...prevNotes, ...out].filter((o) => o !== note && !dropped.has(o));
        const free = [0, 1, 2, 3]
          .filter((l) => !taken.has(l) && moment[0].t - lastAt[l] >= gap)
          .sort((a, b) => (handOf(a) === prevHand) - (handOf(b) === prevHand) || Math.abs(a - mirror) - Math.abs(b - mirror) || a - b)
          .find((l) => holdSafe({ t: note.t, lane: l, len: note.len }, others, diff, timing));
        if (free === undefined) {
          dropped.add(note);
          taken.delete(note.lane);
          continue;
        }
        taken.delete(note.lane);
        taken.add(free);
        note.lane = free;
      }
      lastAt[note.lane] = note.t;
    }
    const kept = moment.filter((n) => !dropped.has(n));
    if (kept.length > 0) prevHand = kept.length === 1 ? handOf(kept[0].lane) : null;
  }
  return out.filter((n) => !dropped.has(n));
}

module.exports = { applyDifficulty, capMoments, enforceFloors, limitJacks, pulsePowerFloor, selectByFloors, spreadLanes };
