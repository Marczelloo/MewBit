// Scroll velocity (osu!mania "SV"): the notes fall a little faster through an intense section and a little slower
// through a calm one, so the highway follows the song as the notes do. A phrase's intensity is how busy the chart is
// there against the chart's typical phrase; the multiplier is a gentle power of it, normalised so the song as a whole
// still scrolls at 1, within the difficulty's bounds (diff.scroll, after the osu!mania ranking criteria: none on Easy,
// 0.90-1.05 on Normal, 0.80-1.10 on Hard). A change starts on the beat a phrase starts on and ramps over one beat.
const { beatMsOf } = require("./holds");
const { nearestIndex } = require("./util");

const SCROLL_EXPONENT = 0.4; // multiplier = (phrase density / typical density) ^ this, before normalising
const SCROLL_STEP = 0.05; // multipliers are rounded to this, so a small wobble in density changes nothing
const RAMP_BEATS = 1;
const MIN_PHRASE_MS = 2000; // a phrase shorter than this keeps the speed before it

const round = (x) => Math.round(x / SCROLL_STEP) * SCROLL_STEP;
const fixed = (x) => Math.round(x * 100) / 100;

// The beat nearest t, or t without a beat grid.
function onBeat(timing, t) {
  if (!timing?.snapped) return Math.round(t);
  const beats = timing.beats;
  return Math.round(beats[nearestIndex(beats, t)]);
}

// Moments per second of `notes` in [fromMs, toMs).
function densityIn(times, fromMs, toMs) {
  let n = 0;
  for (const t of times) if (t >= fromMs && t < toMs) n++;
  return (n * 1000) / (toMs - fromMs);
}

// scrollMap(notes, ctx, diff) -> [{ t, x }] | null. Points of a piecewise-linear multiplier (before the first point
// the first one's x holds, after the last the last one's); null when the difficulty keeps one speed or nothing changes.
function scrollMap(notes, ctx, diff) {
  const bounds = diff.scroll;
  const { phrases = [], timing } = ctx;
  if (!bounds || phrases.length < 2 || notes.length === 0) return null;
  const times = [...new Set(notes.map((n) => n.t))];
  const parts = phrases
    .map((p) => ({ fromMs: p.startMs, toMs: p.endMs }))
    .filter((p) => p.toMs - p.fromMs >= MIN_PHRASE_MS)
    .map((p) => ({ ...p, density: densityIn(times, p.fromMs, p.toMs) }));
  const charted = parts.filter((p) => p.density > 0);
  if (charted.length < 2) return null;

  // Typical density: time-weighted geometric mean, so the song as a whole scrolls at 1.
  const span = charted.reduce((s, p) => s + p.toMs - p.fromMs, 0);
  const logMean = charted.reduce((s, p) => s + (p.toMs - p.fromMs) * Math.log(p.density), 0) / span;
  const typical = Math.exp(logMean);
  const clampX = (x) => Math.min(bounds.max, Math.max(bounds.min, x));

  const points = [];
  let current = null;
  for (const p of parts) {
    // A rest (a phrase with no note) keeps the speed before it: nothing there to read faster or slower.
    if (p.density === 0) continue;
    const x = fixed(clampX(round((p.density / typical) ** SCROLL_EXPONENT)));
    if (current === null) {
      points.push({ t: 0, x });
    } else if (x !== current) {
      const at = onBeat(timing, p.fromMs);
      const ramp = Math.round(RAMP_BEATS * beatMsOf(timing, at));
      points.push({ t: at, x: current }, { t: at + ramp, x });
    }
    current = x;
  }
  if (points.every((p) => p.x === 1)) return null;
  return points;
}

module.exports = { SCROLL_EXPONENT, SCROLL_STEP, scrollMap };
