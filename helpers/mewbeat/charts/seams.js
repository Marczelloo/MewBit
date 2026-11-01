// Phrase seams where the leading layer changes: a sung line handing over to an instrument, or back. A mapper keeps the
// beat going through such a switch instead of letting the chart fall silent while the new part settles in, and starts
// the new part where the hands already are:
//   bridgeSeam: a silence across the seam while the drums still play is filled with those drums;
//   orientDrums: a drum pattern (symmetric: kicks outside, snares inside) is mirrored when that continues the hands.
const { SILENCE_ENERGY } = require("./difficulty");
const { gridSlot, snapToQuarterGrid } = require("./grid");
const { beatMsOf } = require("./holds");

const BRIDGE_MIN_BEATS = 2; // a silence at least this long across the seam is bridged
const BRIDGE_REACH_BEATS = 4; // ...up to this far on either side of the seam (a longer break is a break)
const BRIDGE_CLEARANCE_BEATS = 1 / 2; // bridge hits keep this far from the notes on either side
const SEAM_NOTES = 4; // the notes on either side whose lanes count as "where the hands are"
const KICK_LANES = [0, 3];
const SNARE_LANES = [1, 2];
const LANES = 4;

const endOf = (n) => n.t + (n.len > 0 ? n.len : 0);
const firstMoment = (notes) => {
  const t = Math.min(...notes.map((n) => n.t));
  return notes.filter((n) => n.t === t);
};
const lastMoment = (notes) => {
  const t = Math.max(...notes.map((n) => n.t));
  return notes.filter((n) => n.t === t);
};

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

  const kickAt = new Map(); // grid time -> is a kick there (a kick wins over a snare)
  for (const d of Array.isArray(features.drums) ? features.drums : []) {
    if (!Number.isFinite(d?.t) || (d.kind !== "kick" && d.kind !== "snare" && d.kind !== "perc")) continue;
    const { t, eighth } = snapToQuarterGrid(timing, d.t);
    if (eighth || t < from || t > to || energy.at(t) < SILENCE_ENERGY) continue;
    const slot = gridSlot(timing, t);
    if (timing?.snapped && !(slot?.beat || slot?.half)) continue;
    kickAt.set(t, kickAt.get(t) === true || d.kind === "kick");
  }

  // As in a drum phrase, the n-th kick (or snare) takes lane n % 2 of its pair; it takes the other one where that
  // repeats the note before, and the last hit also leaves the new phrase's first lanes free where it can.
  const times = [...kickAt.keys()].sort((a, b) => a - b);
  const seen = { kick: 0, snare: 0 };
  const out = [];
  let previous = new Set(lastMoment(before).map((n) => n.lane));
  times.forEach((t, k) => {
    const kick = kickAt.get(t);
    const pair = kick ? KICK_LANES : SNARE_LANES;
    const turn = seen[kick ? "kick" : "snare"]++ % 2;
    const order = [pair[turn], pair[1 - turn]];
    const avoid = k === times.length - 1 ? new Set([...previous, ...next.map((n) => n.lane)]) : previous;
    const lane = order.find((l) => !avoid.has(l)) ?? order.find((l) => !previous.has(l)) ?? order[0];
    out.push({ t, lane });
    previous = new Set([lane]);
  });
  return out;
}

const centre = (notes) => notes.reduce((sum, n) => sum + n.lane, 0) / notes.length;

// How far `after` starts from where `before` left the hands: the lane-centre jump, plus a lane the first moment
// repeats from the last one.
function seamCost(before, after) {
  const tail = [...before].sort((a, b) => a.t - b.t).slice(-SEAM_NOTES);
  const head = [...after].sort((a, b) => a.t - b.t).slice(0, SEAM_NOTES);
  const lanes = new Set(lastMoment(before).map((n) => n.lane));
  const jack = firstMoment(after).some((n) => lanes.has(n.lane)) ? 1 : 0;
  return Math.abs(centre(head) - centre(tail)) + jack;
}

// orientDrums(notes, before) -> notes
// A drum-led phrase mirrored (lane l -> 3 - l keeps kicks outside and snares inside) when that starts it closer to
// where `before` left the hands.
function orientDrums(notes, before) {
  if (notes.length === 0 || before.length === 0) return notes;
  const mirrored = notes.map((n) => ({ ...n, lane: LANES - 1 - n.lane }));
  return seamCost(before, mirrored) < seamCost(before, notes) ? mirrored : notes;
}

module.exports = { BRIDGE_MIN_BEATS, bridgeSeam, orientDrums };
