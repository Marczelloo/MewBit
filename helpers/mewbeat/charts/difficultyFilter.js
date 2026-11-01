// Difficulty as a filter over pattern events: keep the levels the difficulty
// allows, then enforce what is playable (chords, jacks, gaps, density).
// Precedence when constraints collide: floors (minNoteGapMs / minLaneGapMs)
// > never 3-note chords > repeat identity > jack limit at phrase seams.
const { DENSITY_WINDOW_MS, ENERGY_EXPONENT, LEAD_IN_MS, SILENCE_ENERGY } = require("./difficulty");
const { gridSlot } = require("./grid");
const { holdBlocks, holdSafe, planHolds, spacedBlocked } = require("./holds");
const { lowerBound } = require("./util");

const LANES = 4;
const EPS = 1e-9;
const SEAM_LOOKBACK_MS = DENSITY_WINDOW_MS; // how much of the previous phrase's tail matters

const asLookup = (energyAt) => (typeof energyAt === "function" ? { hopMs: 500, at: energyAt } : energyAt);

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const byPriority = (a, b) =>
  a.level - b.level || b.s - a.s || (a.source === "secondary") - (b.source === "secondary") || a.t - b.t || a.lane - b.lane;

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
function alternatives(lane, source) {
  const order = source === "drums" || source === "secondary" ? [LANES - 1 - lane, lane ^ 1] : [lane ^ 1];
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
function limitJacks(notes, diff, prevNotes, { strict }) {
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
        const free = alternatives(lane, note.source).filter((l) => !taken.has(l) && runOf(l) <= maxJack);
        // A held note may only move where it (and the notes around it) keep the hold rules.
        const clear = free.find(
          (l) => laneClear(l, note.t, minLane, pool, note) && holdSafe({ t: note.t, lane: l, len: note.len }, pool.filter((n) => n !== note), diff),
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

// Does adding `candidate` keep every gap and the sliding density cap?
// `accepted` is time-sorted.
function fits(candidate, accepted, diff, energy) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  const reach = Math.max(noteGap, laneGap);
  const at = lowerBound(accepted.map((n) => n.t), candidate.t - reach);
  for (let i = at; i < accepted.length && accepted[i].t < candidate.t + reach; i++) {
    const n = accepted[i];
    const dt = Math.abs(n.t - candidate.t);
    if (n.t !== candidate.t && dt < noteGap) return false;
    if (n.lane === candidate.lane && dt < laneGap) return false;
    if (n.lane === candidate.lane && n.t === candidate.t) return false;
  }
  return densityHolds(candidate, accepted, diff, energy);
}

// Mean of energy^1.5 over a window; silent hops count as 0.
function windowPower(fromMs, energy) {
  let sum = 0;
  let n = 0;
  for (let t = fromMs; t < fromMs + DENSITY_WINDOW_MS; t += energy.hopMs) {
    const e = energy.at(t);
    sum += e >= SILENCE_ENERGY ? Math.pow(e, ENERGY_EXPONENT) : 0;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

// Any DENSITY_WINDOW_MS window holds at most maxNps * 2 s notes, scaled down by
// the window's energy^1.5 (plus one note of slack, like the v3 carry).
function densityHolds(candidate, accepted, diff, energy) {
  const seconds = DENSITY_WINDOW_MS / 1000;
  const hardCap = Math.floor(diff.maxNps * seconds + EPS);
  const starts = new Set([candidate.t]);
  for (const n of accepted) if (n.t > candidate.t - DENSITY_WINDOW_MS && n.t < candidate.t) starts.add(n.t);
  for (const from of starts) {
    let count = 1;
    for (const n of accepted) if (n.t >= from && n.t < from + DENSITY_WINDOW_MS) count++;
    const cap = Math.min(hardCap, Math.floor(diff.maxNps * seconds * windowPower(from, energy) + 1 + EPS));
    if (count > cap) return false;
  }
  return true;
}

// Picks events in priority order (lowest level first, then strongest), skipping
// any that would break a floor or the density cap; so the highest level and the
// weakest events are what gets dropped.
function selectByFloors(items, diff, energy, prevNotes) {
  const accepted = prevNotes.map((n) => ({ t: n.t, lane: n.lane })).sort(byTime);
  const kept = [];
  for (const item of [...items].sort(byPriority)) {
    if (!fits(item, accepted, diff, energy)) continue;
    accepted.splice(lowerBound(accepted.map((n) => n.t), item.t), 0, { t: item.t, lane: item.lane });
    kept.push(item);
  }
  return kept.sort(byTime);
}

// --- public API ----------------------------------------------------------------------------

// applyDifficulty(events, diff, timing, energyAt, prevNotes, phraseEnergy, phraseEndMs) -> [{ t, lane, len? }]
// `prevNotes` is the previous phrase's tail (gaps, jacks and holds carry across the seam).
// `phraseEnergy` (optional) is the phrase's mean energy for Normal's quarter-grid rule;
// without it the energy at the event's time is used. `phraseEndMs` (optional) keeps holds
// inside their phrase. A sustained bass/lead event becomes a hold (see holds.js).
function applyDifficulty(events, diff, timing, energyAt, prevNotes = [], phraseEnergy = null, phraseEndMs = Infinity) {
  const energy = asLookup(energyAt);
  const tail = (Array.isArray(prevNotes) ? prevNotes : []).filter((n) => Number.isFinite(n?.t) && Number.isInteger(n?.lane));
  const sorted = [...events].sort(byTime);
  const lastKept = sorted.length > 0 ? sorted[0].t - SEAM_LOOKBACK_MS : 0;
  const prev = tail.filter((n) => n.t >= lastKept || n.t + (n.len > 0 ? n.len : 0) >= lastKept);

  let items = sorted
    .filter((e) => e.level <= diff.maxLevel)
    .filter((e) => {
      if (!(diff.quarterMinEnergy > 0) || e.level !== 1) return true;
      const slot = gridSlot(timing, e.t);
      const offHalf = slot !== null && !slot.beat && !slot.half;
      return !(offHalf && (phraseEnergy ?? energy.at(e.t)) < diff.quarterMinEnergy);
    })
    .filter((e) => e.t >= LEAD_IN_MS && energy.at(e.t) >= SILENCE_ENERGY)
    .map((e) => ({ ...e }));

  items = capMoments(items, diff.chord ? 2 : 1);
  items = limitJacks(items, diff, prev, { strict: false });
  items = selectByFloors(items, diff, energy, prev);
  items = planHolds(items.sort(byTime), diff, timing, prev, phraseEndMs);
  items = limitJacks(items, diff, prev, { strict: true });
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
    const beat = typeof timing?.beatMsAt === "function" ? timing.beatMsAt(note.t) : 500;
    if (active.some((h) => holdBlocks(h, note, diff) || spacedBlocked(h, note, out, diff, beat / 2))) continue;
    if (note.len > 0 && out.some((o) => o.t === note.t && holdBlocks(note, o, diff))) continue;
    out.push(note);
    lastT = note.t;
    laneFree[note.lane] = note.t + (note.len > 0 ? note.len : 0);
    if (note.len > 0) active.push(note);
  }
  return out;
}

module.exports = { applyDifficulty, capMoments, enforceFloors, limitJacks };
