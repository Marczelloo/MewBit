import { EARLY_MISS_MS, HOLD_WINDOW_SCALE, WINDOWS, judgementFor } from "./scoring.js";

const LANES = 4;
const TAIL_GOOD_MS = WINDOWS.good * HOLD_WINDOW_SCALE;
const NO_RESULTS = Object.freeze([]);

// Notes are sorted by t within each lane. `outcome[i]` is undefined while
// pending, otherwise a judgement or "skipped". A hold (note with `len`) has a
// second outcome, `tail[i]`, judged on release. Every lane keeps forward-only
// cursors for press, sweep and skipBefore, so a frame never rescans the chart.
export function createJudge(notes, { fromMs = 0 } = {}) {
  const outcome = new Array(notes.length);
  const tail = new Array(notes.length);
  const endOf = notes.map((note) => note.t + (note.len > 0 ? note.len : 0));
  const isHold = notes.map((note) => note.len > 0);
  const laneIndexes = Array.from({ length: LANES }, () => []);
  notes.forEach((note, index) => laneIndexes[note.lane]?.push(index));
  // Holds whose head was hit and whose tail is still pending, per lane, in index order.
  const active = Array.from({ length: LANES }, () => []);
  const pressCursor = new Array(LANES).fill(0);
  const sweepCursor = new Array(LANES).fill(0);
  const skipCursor = new Array(LANES).fill(0);
  let pending = notes.length + isHold.filter(Boolean).length;

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
      if (errorMs < -EARLY_MISS_MS) return null;
      if (errorMs > WINDOWS.good) continue;
      // Inside the early miss band the note is taken as a miss; a hold loses its tail with it.
      const judgement = judgementFor(Math.abs(errorMs)) ?? "miss";
      outcome[index] = judgement;
      pending -= 1;
      if (!isHold[index]) return { index, judgement, errorMs, part: "head" };
      if (judgement !== "miss") {
        active[lane].push(index);
        return { index, judgement, errorMs, part: "head" };
      }
      settleTail(index, "miss");
      return { index, judgement, errorMs, part: "head", tailMissed: true };
    }
    return null;
  }

  function settleTail(index, mark) {
    tail[index] = mark;
    pending -= 1;
  }

  // Judges the tail of an active hold released at songMs: inside the tail windows
  // (or later) it counts, earlier is a drop.
  function release(lane, songMs) {
    const list = active[lane];
    if (!list || list.length === 0) return [];
    const index = list[0];
    const end = endOf[index];
    list.shift();
    if (songMs < end - TAIL_GOOD_MS) {
      settleTail(index, "miss");
      return [{ index, judgement: "miss", errorMs: null, part: "tail" }];
    }
    const errorMs = songMs - end;
    const judgement = judgementFor(Math.abs(errorMs), HOLD_WINDOW_SCALE) ?? "good";
    settleTail(index, judgement);
    return [{ index, judgement, errorMs, part: "tail" }];
  }

  // Advances each lane's cursor over heads `expired` says are past, applying
  // `mark` to those still pending (and to their tails); returns the marked
  // judgements as [index, part] pairs into `marked`.
  function advance(cursors, expired, mark, marked) {
    for (let lane = 0; lane < LANES; lane += 1) {
      const indexes = laneIndexes[lane];
      let cursor = cursors[lane];
      while (cursor < indexes.length && expired(notes[indexes[cursor]].t)) {
        const index = indexes[cursor];
        if (outcome[index] === undefined) {
          outcome[index] = mark;
          pending -= 1;
          marked.push([index, "head"]);
          if (isHold[index]) {
            settleTail(index, mark);
            marked.push([index, "tail"]);
          }
        }
        cursor += 1;
      }
      cursors[lane] = cursor;
    }
  }

  // Event order: by time of the judged moment, then chart index, head before tail.
  const momentOf = ([index, part]) => (part === "tail" ? endOf[index] : notes[index].t);
  const byMoment = (a, b) => momentOf(a) - momentOf(b) || a[0] - b[0] || (a[1] === "head" ? -1 : 1);

  // Most frames judge nothing: those allocate nothing and answer with the shared empty list.
  const swept = [];
  let sweepNow = 0;
  const sweepExpired = (t) => t + WINDOWS.good < sweepNow;

  function sweep(songMs) {
    sweepNow = songMs;
    swept.length = 0;
    advance(sweepCursor, sweepExpired, "miss", swept);
    if (swept.length === 0) {
      let ended = false;
      for (let lane = 0; lane < LANES && !ended; lane += 1) ended = active[lane].length > 0 && endOf[active[lane][0]] <= songMs;
      if (!ended) return NO_RESULTS;
    }
    const out = swept.map(([index, part]) => [index, part, { index, judgement: "miss", errorMs: null, part }]);
    for (let lane = 0; lane < LANES; lane += 1) {
      const list = active[lane];
      while (list.length && endOf[list[0]] <= songMs) {
        const index = list.shift();
        settleTail(index, "perfect");
        out.push([index, "tail", { index, judgement: "perfect", errorMs: 0, part: "tail" }]);
      }
    }
    return out.sort(byMoment).map((entry) => entry[2]);
  }

  // Skips heads before songMs (their tails with them, even when the hold ends later), and the
  // tails of active holds that end before songMs. Returns the number of judgements skipped.
  function skipBefore(songMs) {
    const skippedHeads = [];
    advance(skipCursor, (t) => t < songMs, "skipped", skippedHeads);
    let count = skippedHeads.length;
    for (let lane = 0; lane < LANES; lane += 1) {
      const list = active[lane];
      for (let i = 0; i < list.length; ) {
        if (endOf[list[i]] < songMs) {
          settleTail(list[i], "skipped");
          list.splice(i, 1);
          count += 1;
        } else i += 1;
      }
    }
    return count;
  }

  function outcomeOf(index) {
    return outcome[index] ?? "pending";
  }

  // null for a tap; "pending" while a hold's tail is unjudged.
  function tailOutcomeOf(index) {
    if (!isHold[index]) return null;
    return tail[index] ?? "pending";
  }

  // Swaps every note from index `keep` on for `tailNotes` (already sorted, all later than the kept ones), keeping
  // the outcomes, active holds and cursors of the kept notes. Edits the notes array this judge was created with.
  function replaceFrom(keep, tailNotes) {
    notes.length = keep;
    outcome.length = keep;
    tail.length = keep;
    endOf.length = keep;
    isHold.length = keep;
    for (let lane = 0; lane < LANES; lane += 1) {
      const kept = laneIndexes[lane].filter((index) => index < keep);
      laneIndexes[lane] = kept;
      active[lane] = active[lane].filter((index) => index < keep);
      for (const cursors of [pressCursor, sweepCursor, skipCursor]) cursors[lane] = Math.min(cursors[lane], kept.length);
    }
    for (const note of tailNotes) {
      const index = notes.length;
      notes.push(note);
      endOf.push(note.t + (note.len > 0 ? note.len : 0));
      isHold.push(note.len > 0);
      laneIndexes[note.lane]?.push(index);
    }
    pending = 0;
    for (let i = 0; i < notes.length; i += 1) {
      if (outcome[i] === undefined) pending += 1;
      if (isHold[i] && tail[i] === undefined) pending += 1;
    }
  }

  // How many judgements were skipped (jump, offset change, lead-in) among the current notes.
  function skippedCount() {
    let count = 0;
    for (let i = 0; i < notes.length; i += 1) {
      if (outcome[i] === "skipped") count += 1;
      if (tail[i] === "skipped") count += 1;
    }
    return count;
  }

  skipBefore(fromMs);

  return { press, release, sweep, skipBefore, replaceFrom, skippedCount, remaining: () => pending, outcomeOf, tailOutcomeOf };
}
