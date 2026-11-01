// Beat-grid helpers shared by the v4 pattern and difficulty modules.
// Positions are measured in beats on timing.beats (the extended, folded grid).
const { lowerBound, nearestIndex } = require("./util");

const POSITION_TOLERANCE = 0.2; // a position within this many 1/8 beats of a grid step counts as on it
const EIGHTHS_PER_BEAT = 8;

// Fractional beat index of t on timing.beats, or NaN without a usable grid.
function beatPosition(timing, t) {
  const beats = timing?.beats ?? [];
  if (!timing?.snapped || beats.length < 2) return Number.NaN;
  const i = Math.min(beats.length - 2, Math.max(0, lowerBound(beats, t + 0.5) - 1));
  return i + (t - beats[i]) / (beats[i + 1] - beats[i]);
}

// Where t sits on the grid: { beat, half, quarter, eighth } (exactly one is true),
// or null without a grid or when t is between 1/8 steps.
function gridSlot(timing, t) {
  const pos = beatPosition(timing, t);
  if (!Number.isFinite(pos)) return null;
  const eighths = pos * EIGHTHS_PER_BEAT;
  const nearest = Math.round(eighths);
  if (Math.abs(eighths - nearest) > POSITION_TOLERANCE) return null;
  const step = ((nearest % EIGHTHS_PER_BEAT) + EIGHTHS_PER_BEAT) % EIGHTHS_PER_BEAT;
  return { beat: step === 0, half: step === 4, quarter: step === 2 || step === 6, eighth: step % 2 === 1 };
}

// Beats since the bar's downbeat (fractional), from timing.downbeats. With the
// tempo folded a bar is not necessarily 4 folded beats, so the bar is whatever
// the downbeats say. Without downbeats the beat index itself is used.
function beatInBar(timing, t) {
  const pos = beatPosition(timing, t);
  if (!Number.isFinite(pos)) return 0;
  const downbeats = timing.downbeats ?? [];
  if (downbeats.length === 0) return pos;
  const i = Math.max(0, lowerBound(downbeats, t + 0.5) - 1);
  return Math.max(0, pos - beatPosition(timing, downbeats[i]));
}

// {t, eighth}: t moved to the nearest 1/4-beat grid point; an event farther than
// 1/16 beat from it goes to the 1/8 grid instead (eighth = true). Without a grid
// the time stays raw.
function snapToQuarterGrid(timing, t) {
  const g4 = timing?.snapped ? timing.gridPoints(4) : [];
  if (g4.length === 0) return { t: Math.round(t), eighth: false };
  const i = nearestIndex(g4, t);
  if (Math.abs(g4[i] - t) <= timing.beatMsAt(t) / 16) return { t: g4[i], eighth: false };
  const g8 = timing.gridPoints(8);
  return { t: g8[nearestIndex(g8, t)], eighth: true };
}

// t moved to the nearest 1/4-beat grid point (raw time without a grid).
function nearestQuarter(timing, t) {
  const g4 = timing?.snapped ? timing.gridPoints(4) : [];
  return g4.length === 0 ? Math.round(t) : g4[nearestIndex(g4, t)];
}

module.exports = { beatInBar, beatPosition, gridSlot, nearestQuarter, snapToQuarterGrid };
