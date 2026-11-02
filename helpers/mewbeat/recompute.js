const path = require("node:path");
const { pathToFileURL } = require("node:url");

const JUDGEMENTS = new Set(["perfect", "great", "good", "miss"]);
const MAX_ABS_TIME_MS = 1e9;

let scoringModule = null;

// The client's own scoring module (ESM, shipped in the image), so the server
// and the Activity can never disagree about points.
function loadClientScoring() {
  scoringModule ??= import(pathToFileURL(path.join(__dirname, "../../activity/src/mewbeat/scoring.js")).href);
  return scoringModule;
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

// How many judgements a chart has: one per tap, two per hold (head and tail).
function judgeablePartsOf(chart) {
  const notes = chart?.notes ?? [];
  return notes.reduce((total, note) => total + (note.len > 0 ? 2 : 1), 0);
}

// Replays a finished run through the client's scoring functions.
//
// events: [{ n, part: "head"|"tail", j, t, d }] in the order the client applied them. n indexes chart.notes,
// t is the HEARD time the judgement was applied at (run.heardTime(songMs): song time minus the user offset,
// which is what scoring and FEVER expiry run on), d is the timing error and unused here.
// fevers: heard times at which the player started FEVER; one counts only when the replayed state allows it.
// A FEVER starting at the same instant as a judgement is applied first.
async function recomputeRun({ chart, events, fevers = [], loadScoring = loadClientScoring }) {
  const notes = chart?.notes;
  if (!Array.isArray(notes)) throw fail("bad_event", "Chart has no notes.");
  if (!Array.isArray(events) || !Array.isArray(fevers)) throw fail("bad_event", "Events must be lists.");
  if (events.length > judgeablePartsOf(chart)) throw fail("too_many_events", "More judgements than the chart has.");

  const feverTimes = [];
  for (const t of fevers) {
    if (!Number.isFinite(t) || Math.abs(t) > MAX_ABS_TIME_MS) throw fail("bad_event", "Bad fever time.");
    feverTimes.push(t);
  }
  feverTimes.sort((a, b) => a - b);

  const seen = new Set();
  for (const event of events) {
    if (!event || typeof event !== "object") throw fail("bad_event", "Bad event.");
    const { n, part, j, t } = event;
    if (!Number.isInteger(n) || n < 0 || n >= notes.length) throw fail("bad_event", "Unknown note.");
    if (part !== "head" && part !== "tail") throw fail("bad_event", "Bad note part.");
    if (part === "tail" && !(notes[n].len > 0)) throw fail("bad_event", "A tap has no tail.");
    if (!JUDGEMENTS.has(j)) throw fail("bad_event", "Bad judgement.");
    if (!Number.isFinite(t) || Math.abs(t) > MAX_ABS_TIME_MS) throw fail("bad_event", "Bad event time.");
    const key = n * 2 + (part === "tail" ? 1 : 0);
    if (seen.has(key)) throw fail("bad_event", "Duplicate event.");
    // The client judges a head before its tail (even a missed head settles the tail after it).
    if (part === "tail" && !seen.has(n * 2)) throw fail("bad_event", "Tail before its head.");
    seen.add(key);
  }

  const { createScore, applyJudgement, startFever, accuracyOf, gradeOf } = await loadScoring();
  let state = createScore();
  let nextFever = 0;
  for (const event of events) {
    while (nextFever < feverTimes.length && feverTimes[nextFever] <= event.t) {
      state = startFever(state, feverTimes[nextFever]);
      nextFever += 1;
    }
    state = applyJudgement(state, event.j, event.t);
  }
  while (nextFever < feverTimes.length) {
    state = startFever(state, feverTimes[nextFever]);
    nextFever += 1;
  }

  const accuracy = accuracyOf(state.counts);
  return {
    score: state.score,
    accuracy,
    grade: gradeOf(accuracy),
    maxCombo: state.maxCombo,
    counts: { ...state.counts },
    judged: events.length,
    fevers: state.fevers,
  };
}

module.exports = { judgeablePartsOf, loadClientScoring, recomputeRun };
