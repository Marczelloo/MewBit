// d comes from the client unchecked; anything beyond this is a bogus value that must not enter permanent totals.
const MAX_TIMING_ERROR_MS = 250;

// Numbers the server derives from a finished run's events, for the player's stats.
// events: [{ n, part: "head"|"tail", j, t, d }] as recomputeRun takes them; chart: { notes: [{ t, len, lane }] }.
//
// holdMs: for each hold whose head was not a miss and whose tail was judged, the tail time clamped to the
// note's end, minus the note's start. longestHoldMs is the longest single hold.
// timing: the timing error d of head (and tap) events that have one; negative is early. Kept as sums, so runs add up.
function deriveRunStats({ chart, events }) {
  const notes = chart?.notes ?? [];
  const heads = new Map();
  const tails = new Map();
  const timing = { n: 0, sum: 0, sumSq: 0, early: 0, late: 0 };

  for (const event of events ?? []) {
    if (event.part === "tail") {
      tails.set(event.n, event);
      continue;
    }
    heads.set(event.n, event);
    if (Number.isFinite(event.d) && Math.abs(event.d) <= MAX_TIMING_ERROR_MS) {
      timing.n += 1;
      timing.sum += event.d;
      timing.sumSq += event.d * event.d;
      if (event.d < 0) timing.early += 1;
      else if (event.d > 0) timing.late += 1;
    }
  }

  let holdMs = 0;
  let longestHoldMs = 0;
  for (const [n, head] of heads) {
    const note = notes[n];
    const tail = tails.get(n);
    if (!note || !(note.len > 0) || head.j === "miss" || !tail) continue;
    const held = Math.max(0, Math.min(tail.t, note.t + note.len) - note.t);
    holdMs += held;
    longestHoldMs = Math.max(longestHoldMs, held);
  }

  return { holdMs, longestHoldMs, timing };
}

module.exports = { deriveRunStats };
