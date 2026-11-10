// The run's story for the results screen: health over the song, where the player missed, the FEVER stretches and where
// a lost run ended. Pure; no browser globals. It replays the run's events through scoring.js the way the server does
// (helpers/mewbeat/recompute.js): judgements in time order, a FEVER that starts at the same instant as a judgement
// goes first, and a FEVER only counts when the replayed state allows it.
import { FEVER_MS, applyJudgement, createScore, isFailed, startFever } from "./scoring.js";

// Points kept for drawing: a long song has a point per judgement, far more than a graph a few hundred pixels wide shows.
export const MAX_POINTS = 240;

// A time on the graph's axis and in its notes: 83000 -> 1:23.
export function formatClock(ms) {
  const seconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Thins a line to at most `most` points by keeping each bucket's lowest and highest, so a dip never drops out of the
// drawing. The first and last point stay. Input and output are in time order.
export function downsample(points, most = MAX_POINTS) {
  if (points.length <= most || most < 4) return points;
  const buckets = Math.floor((most - 2) / 2);
  const inner = points.slice(1, -1);
  const size = Math.ceil(inner.length / buckets);
  const kept = [points[0]];
  for (let start = 0; start < inner.length; start += size) {
    const bucket = inner.slice(start, start + size);
    let low = 0;
    let high = 0;
    bucket.forEach((point, index) => {
      if (point.v < bucket[low].v) low = index;
      if (point.v > bucket[high].v) high = index;
    });
    if (low === high) kept.push(bucket[low]);
    else kept.push(bucket[Math.min(low, high)], bucket[Math.max(low, high)]);
  }
  kept.push(points.at(-1));
  return kept;
}

// events: [{ n, part, j, t }] as the run logged them (t = heard time in ms); feverStarts: the times FEVER was started.
// endMs is the axis' end: the song's length, or the last thing that happened if that is later.
export function runGraphOf({ events = [], feverStarts = [], parts, modifiers = [], noFail = false, durationMs = 0 } = {}) {
  const replay = events
    .filter((event) => Number.isFinite(event?.t))
    .map((event) => ({ j: event.j, part: event.part ?? "head", t: event.t }))
    .sort((a, b) => a.t - b.t);
  const starts = feverStarts.filter(Number.isFinite).sort((a, b) => a - b);
  const lastT = Math.max(0, replay.at(-1)?.t ?? 0, starts.at(-1) ?? 0);
  const endMs = Math.max(1, Number.isFinite(durationMs) ? durationMs : 0, lastT);

  let state = createScore({ parts, modifiers, noFail });
  const health = [{ t: 0, v: state.health }];
  const misses = [];
  const fevers = [];
  let nextFever = 0;
  const startFeversUntil = (t) => {
    while (nextFever < starts.length && starts[nextFever] <= t) {
      const before = state.fevers;
      state = startFever(state, starts[nextFever]);
      if (state.fevers > before) fevers.push({ from: starts[nextFever], to: Math.min(endMs, starts[nextFever] + FEVER_MS) });
      nextFever += 1;
    }
  };

  for (const event of replay) {
    if (isFailed(state)) break;
    startFeversUntil(event.t);
    state = applyJudgement(state, event.j, event.t, event.part);
    const t = Math.min(endMs, Math.max(0, event.t));
    if (event.j === "miss") misses.push(t);
    health.push({ t, v: state.health });
  }
  if (!isFailed(state)) startFeversUntil(Infinity);

  // A lost run's line ends where it was lost; any other runs on to the end of the axis.
  if (!isFailed(state) && health.at(-1).t < endMs) health.push({ t: endMs, v: state.health });
  return {
    health: downsample(health),
    misses,
    fevers,
    failedAt: state.failedAt,
    depletedAt: state.depletedAt,
    endMs,
  };
}
