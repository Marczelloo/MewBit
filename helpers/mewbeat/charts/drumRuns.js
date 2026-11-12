// A drum roll in Normal (diff.drumRuns, the drumRuns flag). Normal plays a half beat apart at most; where the drums roll, hits
// a quarter beat apart in a row, there is no moment to play on the quarter beats between, so the roll was a stream of half
// beats with the drums running twice as fast under it (King Gnu - AIZO, 0:26.3: nine strong hits at 79 ms, Normal played five).
// Here a run of strong hits that sit on the quarter-beat grid gets a note on every one of its hits, on top of the stream
// (melodyPick.js withRunNotes does the same for a fast decoded melody).
//
// What counts as a roll, so that noise read as drum hits does not: a hit is as strong as rule.minS, within rule.onMs of a
// quarter-beat grid point (the intro of AIZO, 0:00-0:15, is noise read as kicks every 50-80 ms at strength .3-.7, off the
// grid) and on a grid point the tracker trusts (timing.intervalOk); a run is rule.minHits such grid points in a row.
const { lowerBound, nearestIndex } = require("./util");
const { burstAround } = require("./melodyPick");

// drumRolls(drums, timing, rule) -> [{ times }]: the grid times of each run of consecutive quarter-beat grid points that
// hold a hit as strong as rule.minS within rule.onMs, at least rule.minHits long. `drums` is features.drums ({ t, s }).
function drumRolls(drums, timing, rule) {
  if (!rule || !timing?.snapped || !Array.isArray(drums)) return [];
  const grid = timing.gridPoints(4);
  const hit = new Set();
  for (const d of drums) {
    if (!(d.s >= rule.minS)) continue;
    const i = nearestIndex(grid, d.t);
    if (i >= 0 && Math.abs(d.t - grid[i]) <= rule.onMs && timing.intervalOk(grid[i])) hit.add(i);
  }
  const rolls = [];
  let run = [];
  for (const i of [...hit].sort((a, b) => a - b)) {
    if (run.length > 0 && i !== run[run.length - 1] + 1) {
      if (run.length >= rule.minHits) rolls.push({ times: run.map((k) => grid[k]) });
      run = [];
    }
    run.push(i);
  }
  if (run.length >= rule.minHits) rolls.push({ times: run.map((k) => grid[k]) });
  // A song whose drums roll all the time (fast hi-hat or double-kick patterns) has no jump to follow: rolls that cover more of
  // it than rule.maxCover are the pattern of the song, not a place that stands out, and make no roll at all.
  const covered = rolls.reduce((sum, r) => sum + (r.times[r.times.length - 1] - r.times[0]) + timing.beatMsAt(r.times[0]) / 4, 0);
  const span = drums.length > 1 ? drums[drums.length - 1].t - drums[0].t : 0;
  return span > 0 && covered > rule.maxCover * span ? [] : rolls;
}

// withDrumRunNotes(notes, drums, timing, rule) -> notes with a note added on every hit of a drum roll that has none, where it
// falls inside a stream: the chart's notes before and after are within rule.streamBeats of a beat and at least rule.minGapMs
// away, the note before is not held over it, and no more than rule.maxRun gaps of up to 0.3 of a beat follow in a row
// (the rest of a longer roll stays as it was). The added notes carry no lane; the lane stages lay them.
function withDrumRunNotes(notes, drums, timing, rule) {
  const rolls = drumRolls(drums, timing, rule);
  if (rolls.length === 0) return notes;
  const times = [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);
  const heldUntil = new Map();
  for (const n of notes) if (n.len > 0) heldUntil.set(n.t, Math.max(heldUntil.get(n.t) ?? 0, n.t + n.len));
  const added = [];
  for (const roll of rolls) {
    for (const t of roll.times) {
      const i = lowerBound(times, t);
      const prev = times[i - 1], next = times[i];
      if (prev === undefined || next === undefined || next === t) continue;
      const span = rule.streamBeats * timing.beatMsAt(t);
      if (t - prev > span || next - t > span || t - prev < rule.minGapMs || next - t < rule.minGapMs) continue;
      if ((heldUntil.get(prev) ?? 0) > t - rule.minGapMs) continue;
      times.splice(i, 0, t);
      if (burstAround(times, i, timing) > rule.maxRun) times.splice(i, 1);
      else added.push({ t, lane: 0 });
    }
  }
  return added.length ? [...notes, ...added].sort((a, b) => a.t - b.t) : notes;
}

module.exports = { drumRolls, withDrumRunNotes };
