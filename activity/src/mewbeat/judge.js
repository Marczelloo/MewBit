import { WINDOWS, judgementFor } from "./scoring.js";

const LANES = 4;

// Notes are sorted by t within each lane. `outcome[i]` is undefined while
// pending, otherwise a judgement or "skipped". Every lane keeps forward-only
// cursors for press, sweep and skipBefore, so a frame never rescans the chart.
export function createJudge(notes, { fromMs = 0 } = {}) {
  const outcome = new Array(notes.length);
  const laneIndexes = Array.from({ length: LANES }, () => []);
  notes.forEach((note, index) => laneIndexes[note.lane]?.push(index));
  const pressCursor = new Array(LANES).fill(0);
  const sweepCursor = new Array(LANES).fill(0);
  const skipCursor = new Array(LANES).fill(0);
  let pending = notes.length;

  function press(lane, songMs) {
    const indexes = laneIndexes[lane];
    if (!indexes) return null;
    let cursor = pressCursor[lane];
    while (cursor < indexes.length && outcome[indexes[cursor]] !== undefined) cursor += 1;
    pressCursor[lane] = cursor;
    for (let i = cursor; i < indexes.length; i += 1) {
      const index = indexes[i];
      if (outcome[index] !== undefined) continue;
      const errorMs = songMs - notes[index].t;
      if (errorMs < -WINDOWS.good) return null;
      if (errorMs > WINDOWS.good) continue;
      const judgement = judgementFor(Math.abs(errorMs));
      outcome[index] = judgement;
      pending -= 1;
      return { index, judgement, errorMs };
    }
    return null;
  }

  // Advances each lane's cursor over notes `expired` says are past, applying
  // `mark` to those still pending; returns the indexes it marked.
  function advance(cursors, expired, mark) {
    const marked = [];
    for (let lane = 0; lane < LANES; lane += 1) {
      const indexes = laneIndexes[lane];
      let cursor = cursors[lane];
      while (cursor < indexes.length && expired(notes[indexes[cursor]].t)) {
        const index = indexes[cursor];
        if (outcome[index] === undefined) {
          outcome[index] = mark;
          pending -= 1;
          marked.push(index);
        }
        cursor += 1;
      }
      cursors[lane] = cursor;
    }
    return marked.sort((a, b) => a - b);
  }

  function sweep(songMs) {
    return advance(sweepCursor, (t) => t + WINDOWS.good < songMs, "miss").map((index) => ({
      index,
      judgement: "miss",
      errorMs: null,
    }));
  }

  function skipBefore(songMs) {
    return advance(skipCursor, (t) => t < songMs, "skipped").length;
  }

  function outcomeOf(index) {
    return outcome[index] ?? "pending";
  }

  skipBefore(fromMs);

  return { press, sweep, skipBefore, remaining: () => pending, outcomeOf };
}
