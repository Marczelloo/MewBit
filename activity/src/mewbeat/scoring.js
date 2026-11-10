import { modifierMultiplier } from "./modifiers.js";

export const WINDOWS = { perfect: 50, great: 90, good: 125 };
// A press this early, but past the good window, still takes the note, as a miss (osu!mania's early
// miss band): mashing ahead of the notes breaks combo instead of waiting for them to arrive.
export const EARLY_MISS_MS = 150;
// Hold tails are judged against the tap windows scaled by this factor.
export const HOLD_WINDOW_SCALE = 1.5;
export const BASE_POINTS = { perfect: 300, great: 200, good: 100, miss: 0 };
// A full fever bar takes feverNFor(parts) perfects: what a judgement adds is its weight over N, a miss takes a
// fixed slice off. Tied to the chart's size, a map gives about the same few fevers however many notes it has.
export const VIBE_WEIGHT = { perfect: 1, great: 0.6, good: 0.25 };
export const VIBE_MISS = -0.05;
export const FEVER_MIN_N = 30;
export const FEVER_SHARE = 0.2;
export const ACCURACY_WEIGHT = { perfect: 100, great: 80, good: 50, miss: 0 };
export const FEVER_MS = 8000;

export const HEALTH_START = 0.5;
// Health a judgement adds. A miss costs more on a head or a tap than on a hold's tail.
export const HEALTH_DELTA = { perfect: 0.01, great: 0.01, good: 0.005, miss: -0.08, missTail: -0.04 };
export const FOUR_LIVES = 4;
// With No Fail, every judgement after health first hit 0 is worth this share of its points.
export const NO_FAIL_PENALTY = 0.5;

export function judgementFor(absErrorMs, scale = 1) {
  if (absErrorMs <= WINDOWS.perfect * scale) return "perfect";
  if (absErrorMs <= WINDOWS.great * scale) return "great";
  if (absErrorMs <= WINDOWS.good * scale) return "good";
  return null;
}

export function multiplierFor(combo) {
  return Math.min(4, 1 + Math.floor(combo / 10));
}

// How many perfects fill the fever bar of a chart with this many judgements (a tap is one, a hold two).
// Without a size the minimum applies.
export function feverNFor(parts) {
  return Math.max(FEVER_MIN_N, Math.round(FEVER_SHARE * (Number.isFinite(parts) ? parts : 0)));
}

// parts: the chart's judgement count (judgeablePartsOf), which sizes the fever bar. modifiers: ids from
// modifiers.js. noFail is no modifier: a run that can never be lost and pays no penalty for it (calibration,
// tutorial, autoplay, a spectator); the No Fail modifier is the one that costs points once health is gone.
export function createScore({ parts, modifiers = [], noFail = false } = {}) {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    vibe: 0,
    feverUntil: null,
    fevers: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    health: HEALTH_START,
    lives: modifiers.includes("fl") ? FOUR_LIVES : null,
    failedAt: null,
    depletedAt: null,
    feverN: feverNFor(parts),
    modMult: modifierMultiplier(modifiers),
    rules: {
      oneLife: modifiers.includes("ol"),
      fourLives: modifiers.includes("fl"),
      unlosable: noFail || modifiers.includes("nf"),
      penalty: modifiers.includes("nf") && !noFail,
    },
  };
}

export const isFailed = (state) => state.failedAt !== null;
export const healthOf = (state) => state.health;

// Clamp to 0..1 and snap float drift, so a vibe or health that is "full" (or empty) by arithmetic compares as
// 1 (or 0). Not rounded to a grid: steps of 1/N would lose a little each time and never add up to 1.
const SNAP = 1e-9;
function clampUnit(value) {
  if (value >= 1 - SNAP) return 1;
  return value <= SNAP ? 0 : value;
}

function vibeDelta(judgement, feverN) {
  return judgement === "miss" ? VIBE_MISS : VIBE_WEIGHT[judgement] / feverN;
}

function healthDelta(judgement, part) {
  return judgement === "miss" && part === "tail" ? HEALTH_DELTA.missTail : HEALTH_DELTA[judgement];
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

// part is "head" (a tap counts as one) or "tail"; only the health cost of a miss differs between them.
// A lost run stays as it was lost: nothing judged after the fail changes it.
export function applyJudgement(state, judgement, songMs, part = "head") {
  if (isFailed(state)) return state;
  const current = settleFever(state, songMs);
  const fever = feverActive(current, songMs);
  const penalty = current.depletedAt !== null && current.rules.penalty ? NO_FAIL_PENALTY : 1;
  const points = Math.round(
    BASE_POINTS[judgement] * multiplierFor(current.combo) * (fever ? 2 : 1) * current.modMult * penalty,
  );
  const combo = judgement === "miss" ? 0 : current.combo + 1;
  const health = clampUnit(current.health + healthDelta(judgement, part));
  const missed = judgement === "miss";
  const lives = current.lives !== null && missed ? current.lives - 1 : current.lives;
  const lost = !current.rules.unlosable && (current.rules.oneLife
    ? missed
    : current.rules.fourLives ? lives === 0 : health === 0);
  return {
    ...current,
    score: current.score + points,
    combo,
    maxCombo: Math.max(current.maxCombo, combo),
    vibe: fever ? current.vibe : clampUnit(current.vibe + vibeDelta(judgement, current.feverN)),
    counts: { ...current.counts, [judgement]: current.counts[judgement] + 1 },
    health: current.rules.oneLife && missed && !current.rules.unlosable ? 0 : health,
    lives,
    failedAt: lost ? songMs : null,
    depletedAt: current.depletedAt ?? (current.rules.penalty && health === 0 ? songMs : null),
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
  if (isFailed(state) || !canFever(state, songMs)) return state;
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
