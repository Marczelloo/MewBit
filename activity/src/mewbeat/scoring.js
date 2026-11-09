export const WINDOWS = { perfect: 50, great: 90, good: 125 };
// A press this early, but past the good window, still takes the note, as a miss (osu!mania's early
// miss band): mashing ahead of the notes breaks combo instead of waiting for them to arrive.
export const EARLY_MISS_MS = 150;
// Hold tails are judged against the tap windows scaled by this factor.
export const HOLD_WINDOW_SCALE = 1.5;
export const BASE_POINTS = { perfect: 300, great: 200, good: 100, miss: 0 };
export const VIBE_DELTA = { perfect: 0.03, great: 0.02, good: 0.01, miss: -0.06 };
export const ACCURACY_WEIGHT = { perfect: 100, great: 80, good: 50, miss: 0 };
export const FEVER_MS = 8000;

export function judgementFor(absErrorMs, scale = 1) {
  if (absErrorMs <= WINDOWS.perfect * scale) return "perfect";
  if (absErrorMs <= WINDOWS.great * scale) return "great";
  if (absErrorMs <= WINDOWS.good * scale) return "good";
  return null;
}

export function multiplierFor(combo) {
  return Math.min(4, 1 + Math.floor(combo / 10));
}

export function createScore() {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    vibe: 0,
    feverUntil: null,
    fevers: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
  };
}

// Round away float drift so a vibe that is "full" by arithmetic compares as 1.
function clampVibe(vibe) {
  return Math.min(1, Math.max(0, Math.round(vibe * 1e6) / 1e6));
}

function feverActive(state, songMs) {
  return state.feverUntil !== null && songMs < state.feverUntil;
}

// An expired FEVER leaves vibe at 0 and clears itself.
function settleFever(state, songMs) {
  if (state.feverUntil !== null && songMs >= state.feverUntil) {
    return { ...state, vibe: 0, feverUntil: null };
  }
  return state;
}

export function applyJudgement(state, judgement, songMs) {
  const current = settleFever(state, songMs);
  const fever = feverActive(current, songMs);
  const points = BASE_POINTS[judgement] * multiplierFor(current.combo) * (fever ? 2 : 1);
  const combo = judgement === "miss" ? 0 : current.combo + 1;
  return {
    ...current,
    score: current.score + points,
    combo,
    maxCombo: Math.max(current.maxCombo, combo),
    vibe: fever ? current.vibe : clampVibe(current.vibe + VIBE_DELTA[judgement]),
    counts: { ...current.counts, [judgement]: current.counts[judgement] + 1 },
  };
}

export function vibeAt(state, songMs) {
  if (state.feverUntil === null) return state.vibe;
  if (songMs >= state.feverUntil) return 0;
  return Math.min(1, Math.max(0, (state.feverUntil - songMs) / FEVER_MS));
}

export function canFever(state, songMs) {
  return !feverActive(state, songMs) && vibeAt(state, songMs) >= 1;
}

export function startFever(state, songMs) {
  if (!canFever(state, songMs)) return state;
  return { ...state, feverUntil: songMs + FEVER_MS, fevers: state.fevers + 1 };
}

export function accuracyOf(counts) {
  const judged = counts.perfect + counts.great + counts.good + counts.miss;
  if (judged === 0) return null;
  const weighted =
    counts.perfect * ACCURACY_WEIGHT.perfect +
    counts.great * ACCURACY_WEIGHT.great +
    counts.good * ACCURACY_WEIGHT.good +
    counts.miss * ACCURACY_WEIGHT.miss;
  return Math.round((weighted / judged) * 100) / 100;
}

// The lowest accuracy of each grade, worst first.
export const GRADE_STEPS = [
  { grade: "D", floor: 0 },
  { grade: "C", floor: 70 },
  { grade: "B", floor: 80 },
  { grade: "A", floor: 90 },
  { grade: "S", floor: 95 },
];

export function gradeOf(accuracy) {
  if (accuracy === null || accuracy === undefined) return null;
  return [...GRADE_STEPS].reverse().find((step) => accuracy >= step.floor)?.grade ?? "D";
}

const hundredths = (value) => Math.round(value * 100) / 100;

// An accuracy's place on the grade ladder: how full each grade's step is, the next grade up and the distance to it,
// or at the top (next is null) how much room is left above the grade below.
export function gradeLadder(accuracy) {
  const steps = GRADE_STEPS.map(({ grade, floor }, index) => {
    const top = GRADE_STEPS[index + 1]?.floor ?? 100;
    return { grade, fill: Math.max(0, Math.min(1, (accuracy - floor) / (top - floor))) };
  });
  const above = GRADE_STEPS.find((step) => step.floor > accuracy);
  return {
    steps,
    next: above ? { grade: above.grade, gap: hundredths(above.floor - accuracy) } : null,
    cushion: above ? null : hundredths(accuracy - GRADE_STEPS.at(-1).floor),
  };
}
