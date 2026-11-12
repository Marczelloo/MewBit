// A burst where the decoded notes run fast and Normal's half-beat stream does not follow them (diff.softRuns, Normal from
// v45). The bursts of melodyRuns (melodyPick.js) read the decoded melody LINE: one note at a time, the top voice. A piano that
// plays fast in both hands (Rush E) has a line that runs slower than the music (0:54-1:06: the line 4.2 notes a second, every
// decoded note 6.5). What kept those quarter beats out was not a missing candidate (the fast on-grid notes of the line already
// had scored moments) but the gap holds: the one-beat holds between half-beat taps lie over the quarter beats and the
// placing refuses a note under a hold. Here the quarter-beat grid points the tracker trusts that carry a decoded note (any
// voice) in a run of `minRun` onsets close together are placed under the rules of withRunNotes (melodyPick.js placeRunNotes):
// only inside a stream, `maxRun` gaps in a row, and with rule.cutGapHolds a gap hold (not a real sustain) gives way to the
// burst note and becomes a tap. With rule.onlyOverHolds a burst note is added only where it cuts such a hold (or follows one
// that did): added on a plain gap the share people play was no better than the control.
// The moments are filtered by `allowed(t)` (generate.js softAllowed: not in the seconds lightThin thinned).
const { nearestIndex } = require("./util");
const { placeRunNotes } = require("./melodyPick");

// softRunTimes(decoded, timing, rule) -> the quarter-beat grid times with a decoded note beginning within rule.onMs, where the
// notes before or after it begin within rule.fastMs. `decoded` is [{ t, vel? }]; notes that begin within rule.mergeMs of each
// other are one onset (a chord, an arpeggio's decoded ghosts), and an onset with no note of rule.minVel is no onset.
function softRunTimes(decoded, timing, rule) {
  if (!rule || !timing?.snapped || !Array.isArray(decoded) || decoded.length < 2) return [];
  const sorted = decoded.filter((n) => Number.isFinite(n.t)).sort((a, b) => a.t - b.t);
  const onsets = [];
  for (const n of sorted) {
    const last = onsets[onsets.length - 1];
    if (last && n.t - last.at <= rule.mergeMs) last.vel = Math.max(last.vel, n.vel ?? 1);
    else onsets.push({ t: n.t, at: n.t, vel: n.vel ?? 1 });
  }
  const grid = timing.gridPoints(4);
  const found = new Set();
  // the length of the chain of onsets, each within rule.fastMs of the next, that onset k belongs to
  const chain = new Array(onsets.length).fill(1);
  for (let k = 1; k < onsets.length; k++) if (onsets[k].t - onsets[k - 1].t <= rule.fastMs) chain[k] = chain[k - 1] + 1;
  for (let k = onsets.length - 2; k >= 0; k--) if (onsets[k + 1].t - onsets[k].t <= rule.fastMs) chain[k] = Math.max(chain[k], chain[k + 1]);
  onsets.forEach((o, k) => {
    if (o.vel < (rule.minVel ?? 0)) return;
    const fast = (k > 0 && o.t - onsets[k - 1].t <= rule.fastMs) || (k + 1 < onsets.length && onsets[k + 1].t - o.t <= rule.fastMs);
    if (!fast || chain[k] < (rule.minRun ?? 2)) return;
    const i = nearestIndex(grid, o.t);
    if (i >= 0 && Math.abs(o.t - grid[i]) <= rule.onMs && timing.intervalOk(grid[i])) found.add(grid[i]);
  });
  return [...found].sort((a, b) => a - b);
}

// withSoftRunNotes(notes, decoded, timing, rule, gapHold, allowed) -> notes with a note added on each softRunTimes moment that
// has none (and that `allowed` lets stand), inside a stream (melodyPick.js placeRunNotes). gapHold(note) says a hold is a gap hold,
// not a real sustain. The added notes carry no lane; the lane stages lay them.
function withSoftRunNotes(notes, decoded, timing, rule, gapHold = null, allowed = null) {
  const times = softRunTimes(decoded, timing, rule);
  return placeRunNotes(notes, allowed ? times.filter(allowed) : times, timing, rule, gapHold);
}

module.exports = { softRunTimes, withSoftRunNotes };
