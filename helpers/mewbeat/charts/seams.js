// Phrase seams where the leading layer changes: a sung line handing over to an instrument, or back. A mapper keeps the
// beat going through such a switch instead of letting the chart fall silent while the new part settles in:
//   bridgeSeam: a silence across the seam while the drums still play is filled with those drums;
//   fillGaps: the same for any rest of a phrase (a sung line pausing while the band plays on).
const { SILENCE_ENERGY } = require("./difficulty");
const { gridSlot, snapToQuarterGrid } = require("./grid");
const { beatMsOf } = require("./holds");

const BRIDGE_MIN_BEATS = 2; // a silence at least this long across the seam is bridged
const BRIDGE_REACH_BEATS = 4; // ...up to this far on either side of the seam (a longer break is a break)
const BRIDGE_CLEARANCE_BEATS = 1 / 2; // bridge hits keep this far from the notes on either side
const KICK_LANES = [0, 3];
const SNARE_LANES = [1, 2];

const endOf = (n) => n.t + (n.len > 0 ? n.len : 0);
const firstMoment = (notes) => {
  const t = Math.min(...notes.map((n) => n.t));
  return notes.filter((n) => n.t === t);
};
const lastMoment = (notes) => {
  const t = Math.max(...notes.map((n) => n.t));
  return notes.filter((n) => n.t === t);
};

// The kicks and snares (and other hits) between fromMs and toMs on a beat or half beat, where the music is not silent:
// grid time -> is a kick there (a kick wins over a snare).
function drumSlots(fromMs, toMs, features, timing, energy) {
  const kickAt = new Map();
  for (const d of Array.isArray(features.drums) ? features.drums : []) {
    if (!Number.isFinite(d?.t) || (d.kind !== "kick" && d.kind !== "snare" && d.kind !== "perc")) continue;
    const { t, eighth } = snapToQuarterGrid(timing, d.t);
    if (eighth || t < fromMs || t > toMs || energy.at(t) < SILENCE_ENERGY) continue;
    const slot = gridSlot(timing, t);
    if (timing?.snapped && !(slot?.beat || slot?.half)) continue;
    kickAt.set(t, kickAt.get(t) === true || d.kind === "kick");
  }
  return kickAt;
}

// As in a drum phrase, the n-th kick (or snare) takes lane n % 2 of its pair; it takes the other one where that
// repeats the note before, and the last hit also leaves the next notes' lanes free where it can.
function drumNotes(kickAt, previousLanes, nextLanes) {
  const times = [...kickAt.keys()].sort((a, b) => a - b);
  const seen = { kick: 0, snare: 0 };
  const out = [];
  let previous = new Set(previousLanes);
  times.forEach((t, k) => {
    const kick = kickAt.get(t);
    const pair = kick ? KICK_LANES : SNARE_LANES;
    const turn = seen[kick ? "kick" : "snare"]++ % 2;
    const order = [pair[turn], pair[1 - turn]];
    const avoid = k === times.length - 1 ? new Set([...previous, ...nextLanes]) : previous;
    const lane = order.find((l) => !avoid.has(l)) ?? order.find((l) => !previous.has(l)) ?? order[0];
    out.push({ t, lane });
    previous = new Set([lane]);
  });
  return out;
}

// bridgeSeam(before, after, seamMs, features, timing, energy) -> notes, time-ordered
// `before`: the notes so far (all ending before the seam), `after`: the new phrase's. Where the chart is silent for
// at least BRIDGE_MIN_BEATS between them, the kicks and snares in that silence near the seam, on a beat or half beat,
// fill it: kicks on the outer lanes, snares on the inner.
function bridgeSeam(before, after, seamMs, features, timing, energy) {
  if (before.length === 0 || after.length === 0) return [];
  const lastEnd = Math.max(...before.map(endOf));
  const next = firstMoment(after);
  const first = next[0].t;
  const beat = beatMsOf(timing, seamMs);
  if (first - lastEnd < BRIDGE_MIN_BEATS * beat) return [];
  const clear = BRIDGE_CLEARANCE_BEATS * beat;
  const from = Math.max(lastEnd + clear, seamMs - BRIDGE_REACH_BEATS * beat);
  const to = Math.min(first - clear, seamMs + BRIDGE_REACH_BEATS * beat);
  return drumNotes(drumSlots(from, to, features, timing, energy), lastMoment(before).map((n) => n.lane), next.map((n) => n.lane));
}

// fillGaps(before, notes, features, timing, energy, untilMs = null) -> drum notes, time-ordered
// The rests of a phrase's `notes` (and the one between `before`, the notes so far, and its first note) at least
// BRIDGE_MIN_BEATS long, where the drums still play: a sung line resting, a lead that drops out. The drums keep the
// beat there, as across a seam. With `untilMs` (the last phrase), the rest after its last note up to then as well.
function fillGaps(before, notes, features, timing, energy, untilMs = null) {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane);
  const out = [];
  let lastEnd = before.length > 0 ? Math.max(...before.map(endOf)) : null;
  let lastLanes = before.length > 0 ? lastMoment(before).map((n) => n.lane) : [];
  const fill = (fromMs, toMs, nextLanes) => {
    const beat = beatMsOf(timing, fromMs);
    if (toMs - fromMs < BRIDGE_MIN_BEATS * beat) return;
    const clear = BRIDGE_CLEARANCE_BEATS * beat;
    out.push(...drumNotes(drumSlots(fromMs + clear, toMs - clear, features, timing, energy), lastLanes, nextLanes));
  };
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].t === sorted[i].t) j++;
    const moment = sorted.slice(i, j);
    if (lastEnd !== null) fill(lastEnd, moment[0].t, moment.map((n) => n.lane));
    lastEnd = Math.max(lastEnd ?? -Infinity, ...moment.map(endOf));
    lastLanes = moment.map((n) => n.lane);
    i = j;
  }
  if (untilMs !== null && lastEnd !== null) fill(lastEnd, untilMs + BRIDGE_CLEARANCE_BEATS * beatMsOf(timing, untilMs), []);
  return out;
}

module.exports = { BRIDGE_MIN_BEATS, bridgeSeam, fillGaps };
