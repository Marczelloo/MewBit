import { createJudge } from "./judge.js";
import {
  WINDOWS,
  accuracyOf,
  applyJudgement,
  canFever,
  createScore,
  gradeOf,
  multiplierFor,
  startFever,
  vibeAt,
} from "./scoring.js";

const START_LEAD_MS = 1000;
const JUMP_LEAD_MS = 300;

// One game run. Every method takes song time; the user offset is applied here,
// so judge, sweep and fever all work in heard time (songMs - offsetMs).
export function createRun({ chart, startSongMs, offsetMs = 0, autoplay = false }) {
  const notes = chart.notes;
  let offset = offsetMs;
  const heard = (songMs) => songMs - offset;

  const judge = createJudge(notes, { fromMs: heard(startSongMs) + START_LEAD_MS });
  let score = createScore();
  // Every hold is two judgements (head and tail); a tap is one.
  const lenOf = (note) => (note.len > 0 ? note.len : 0);
  let holdCount = 0;
  let maxLen = 0;
  let endAfterMs = -Infinity;
  for (const note of notes) {
    const len = lenOf(note);
    if (len > 0) holdCount += 1;
    maxLen = Math.max(maxLen, len);
    endAfterMs = Math.max(endAfterMs, note.t + len + WINDOWS.good);
  }
  let skipped = 0;
  for (let i = 0; i < notes.length; i += 1) {
    if (judge.outcomeOf(i) === "skipped") skipped += 1;
    if (judge.tailOutcomeOf(i) === "skipped") skipped += 1;
  }

  const hits = [];
  const eventLog = []; // the event log for the server: every applied judgement, in order
  const feverStarts = [];
  const autoReleases = []; // autoplay: pressed holds waiting for their end, as { index, lane, end }
  let autoCursor = 0;
  let feverEndAt = null;
  let ended = false;
  let lastSongMs = startSongMs;

  // Head and tail judgements both go through applyJudgement, at the moment they are judged.
  // Only head hits are recorded in snapshot().hits (timing data); tails are in the counts.
  function applyOutcome(result, heardMs) {
    const lane = notes[result.index].lane;
    score = applyJudgement(score, result.judgement, heardMs);
    eventLog.push({ n: result.index, part: result.part, j: result.judgement, t: heardMs, d: result.errorMs ?? null });
    if (result.judgement === "miss") {
      // tailMissed: the press settled the hold's tail as a miss too (the event log needs both).
      return { kind: "miss", lane, index: result.index, part: result.part, ...(result.tailMissed ? { tailMissed: true } : {}) };
    }
    if (result.part === "head") hits.push({ index: result.index, errorMs: result.errorMs });
    return { kind: "hit", lane, ...result };
  }

  function press(lane, songMs) {
    lastSongMs = songMs;
    if (ended) return null;
    const heardMs = heard(songMs);
    const result = judge.press(lane, heardMs);
    if (!result) return null;
    const outcome = applyOutcome(result, heardMs);
    // An early miss on a hold settles its tail too, which counts as a second miss (logged after its head).
    if (result.tailMissed) {
      score = applyJudgement(score, "miss", heardMs);
      eventLog.push({ n: result.index, part: "tail", j: "miss", t: heardMs, d: null });
    }
    return outcome;
  }

  function release(lane, songMs) {
    lastSongMs = songMs;
    if (ended) return [];
    const heardMs = heard(songMs);
    return judge.release(lane, heardMs).map((result) => applyOutcome(result, heardMs));
  }

  function tick(songMs) {
    lastSongMs = songMs;
    const heardMs = heard(songMs);
    const events = [];

    if (!ended) {
      if (autoplay) {
        while (autoCursor < notes.length && notes[autoCursor].t <= heardMs) {
          const note = notes[autoCursor];
          if (judge.outcomeOf(autoCursor) === "pending") {
            const result = judge.press(note.lane, note.t);
            if (result) {
              events.push(applyOutcome(result, heardMs));
              if (lenOf(note) > 0) autoReleases.push({ index: autoCursor, lane: note.lane, end: note.t + lenOf(note) });
            }
          }
          autoCursor += 1;
        }
        for (let i = 0; i < autoReleases.length; ) {
          const hold = autoReleases[i];
          if (hold.end > heardMs) {
            i += 1;
            continue;
          }
          autoReleases.splice(i, 1);
          // A jump or offset change may have settled this tail already; releasing the lane now
          // would drop whatever hold the player (or autoplay) holds there at present.
          if (judge.tailOutcomeOf(hold.index) !== "pending") continue;
          for (const result of judge.release(hold.lane, hold.end)) events.push(applyOutcome(result, heardMs));
        }
      }
      for (const result of judge.sweep(heardMs)) events.push(applyOutcome(result, heardMs));
    }

    // A FEVER still running when the chart ends gets its closing event.
    if (feverEndAt !== null && heardMs >= feverEndAt) {
      feverEndAt = null;
      events.push({ kind: "feverEnd" });
    }

    if (!ended && judge.remaining() === 0 && heardMs > endAfterMs) {
      ended = true;
      events.push({ kind: "end" });
    }
    return events;
  }

  function fever(songMs) {
    if (ended) return null;
    const heardMs = heard(songMs);
    if (!canFever(score, heardMs)) return null;
    score = startFever(score, heardMs);
    feverStarts.push(heardMs);
    feverEndAt = score.feverUntil;
    return { kind: "fever" };
  }

  function jump(songMs) {
    if (ended) return;
    skipped += judge.skipBefore(heard(songMs) + JUMP_LEAD_MS);
  }

  // Changes the audio offset mid-run, keeping score and judged notes. FEVER keeps ending at the
  // same song moment (its end is stored in heard time, so it moves with the offset). When heard
  // time moves forward (offset down), notes it has already carried past their miss window are
  // skipped, as in jump(), instead of becoming instant misses. songMs defaults to the last
  // song time this run saw.
  function setOffset(nextOffsetMs, songMs = lastSongMs) {
    const delta = nextOffsetMs - offset;
    if (delta === 0) return;
    offset = nextOffsetMs;
    if (feverEndAt !== null) feverEndAt -= delta;
    if (score.feverUntil !== null) score = { ...score, feverUntil: score.feverUntil - delta };
    if (delta < 0 && !ended) skipped += judge.skipBefore(heard(songMs) - WINDOWS.good);
  }

  // What the server needs to recompute this run: judgements as they were applied (jump/offset-skipped
  // parts never appear, they were never judged) and the heard times FEVER started at.
  function log() {
    return { events: eventLog.map((event) => ({ ...event })), fevers: feverStarts.slice() };
  }

  function snapshot(songMs) {
    const heardMs = heard(songMs);
    const feverActive = score.feverUntil !== null && heardMs < score.feverUntil;
    const accuracy = accuracyOf(score.counts);
    const { perfect, great, good, miss } = score.counts;
    return {
      score: score.score,
      combo: score.combo,
      maxCombo: score.maxCombo,
      multiplier: multiplierFor(score.combo),
      vibe: vibeAt(score, heardMs),
      feverActive,
      feverLeftMs: feverActive ? Math.max(0, score.feverUntil - heardMs) : 0,
      accuracy,
      grade: gradeOf(accuracy),
      counts: { ...score.counts },
      fevers: score.fevers,
      judged: perfect + great + good + miss,
      total: notes.length + holdCount - skipped,
      skipped,
      ranked: false,
      hits: hits.slice(),
    };
  }

  // "pending" | "held" | "dropped" | "done" for a note; taps and skipped holds are "pending".
  function holdState(i) {
    const tailOutcome = judge.tailOutcomeOf(i);
    if (tailOutcome === null) return "pending";
    // Skipped tail: a hit head means jump/setOffset cut the hold short (nothing left to draw);
    // a skipped head means the whole hold was skipped (drawn faded, like a skipped tap).
    if (tailOutcome === "skipped") return judge.outcomeOf(i) === "skipped" ? "pending" : "done";
    if (tailOutcome === "miss") return "dropped";
    if (tailOutcome !== "pending") return "done";
    return judge.outcomeOf(i) === "pending" ? "pending" : "held";
  }

  // Notes with t <= toHeardMs whose end (t + len) is >= fromHeardMs, so a hold stays listed until
  // its tail has left the window. Binary search for the first t that can qualify (the longest
  // hold bounds how far back that is).
  function visibleNotes(fromHeardMs, toHeardMs) {
    const earliest = fromHeardMs - maxLen;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].t < earliest) lo = mid + 1;
      else hi = mid;
    }
    const visible = [];
    for (let i = lo; i < notes.length && notes[i].t <= toHeardMs; i += 1) {
      const len = lenOf(notes[i]);
      if (notes[i].t + len < fromHeardMs) continue;
      visible.push({ t: notes[i].t, lane: notes[i].lane, outcome: judge.outcomeOf(i), len, hold: holdState(i) });
    }
    return visible;
  }

  return { press, release, tick, fever, jump, setOffset, log, snapshot, visibleNotes, heardTime: heard };
}
