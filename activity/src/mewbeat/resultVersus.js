import { formatCount } from "./playerFormat.js";

const MINUS = "−";

// A signed difference: the sign is always written, so colour is never the only thing that tells better from worse.
// A difference of nothing reads "±".
const signedText = (units, text) => `${units > 0 ? "+" : units < 0 ? MINUS : "±"}${text}`;
const trendOf = (units) => (units > 0 ? "up" : units < 0 ? "down" : "even");

// The score now against the one before: "+12,400", "−3,200", "±0". null while either is unknown.
export function scoreDiff(score, before) {
  if (!Number.isFinite(score) || !Number.isFinite(before)) return null;
  const units = Math.round(score) - Math.round(before);
  return { text: signedText(units, formatCount(Math.abs(units))), trend: trendOf(units) };
}

// The accuracy now against the one before, in the hundredths the screen shows, so the difference is that of the two
// numbers as read: "+1.24%", "−0.30%", "±0.00%".
export function accuracyDiff(accuracy, before) {
  if (!Number.isFinite(accuracy) || !Number.isFinite(before)) return null;
  const hundredths = Math.round(accuracy * 100) - Math.round(before * 100);
  return { text: signedText(hundredths, `${(Math.abs(hundredths) / 100).toFixed(2)}%`), trend: trendOf(hundredths) };
}

// What the results screen says on top of the run itself, from the score reply: the pp of the run (counts: it is the play
// the profile holds, which only a new best is), and the run against the best from before it. null for a run that was
// not ranked, and for fields a bot that does not send them leaves out. first: there was no best before this run.
export function versusOf(result) {
  if (!result?.ranked) return null;
  const { pp, previousBest, newBest } = result;
  return {
    pp: Number.isFinite(pp) ? { text: `${formatCount(Math.round(pp))} pp`, counts: Boolean(newBest) } : null,
    first: previousBest === null,
    score: previousBest ? scoreDiff(result.score, previousBest.score) : null,
    accuracy: previousBest ? accuracyDiff(result.accuracy, previousBest.accuracy) : null,
  };
}
