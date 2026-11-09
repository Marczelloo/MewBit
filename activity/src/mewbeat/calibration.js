// Audio offset calibration from the player's own taps. Each lane press is matched to the nearest
// note in that lane and its error is kept in *song* time (songMs - note.t), which does not depend
// on the offset in use: a player tapping by ear lands at the same song moment whatever the offset,
// so the median of those errors is the offset that would centre them.

// A press counts when it lands this close to a note in heard time (around the current offset),
// wider than the "good" window so a badly set offset still yields samples.
export const CAPTURE_MS = 220;
export const MIN_TAPS = 16; // fewer and one sloppy phrase moves the estimate
export const KEEP_TAPS = 64; // a sliding window, so a player who settles in is followed
const OFFSET_MIN = -300; // same limits as the settings slider
const OFFSET_MAX = 700;
const OFFSET_STEP = 5;

function median(sorted) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// The offset that centres these errors, snapped to the slider's step, and the median absolute deviation around it.
function centreOf(samples) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const centre = median(sorted);
  const spreadMs = Math.round(median(sorted.map((x) => Math.abs(x - centre)).sort((a, b) => a - b)));
  const snapped = Math.round(centre / OFFSET_STEP) * OFFSET_STEP;
  return { offsetMs: Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, snapped)), spreadMs };
}

// One press against one block's click, in ms (positive: after the sound). Null when no offset could explain it.
export function blockError(pressMs, soundMs) {
  const errorMs = pressMs - soundMs;
  return errorMs >= OFFSET_MIN && errorMs <= OFFSET_MAX ? errorMs : null;
}

// The bot's clicks come every 1.5 s (helpers/mewbeat/calibrationTrack.js): a block falls, then its press window runs
// out, just as the next block starts.
export const BLOCK_FALL_LIVE_MS = 1000;
export const BLOCK_LISTEN_LIVE_MS = 500;

// The click whose block belongs on the lane at this moment of the song, past `afterMs`; null when none does.
export function nextBlockNote(notes, clockMs, offsetMs, afterMs = -Infinity) {
  return notes.find((note) => {
    const arrival = note.t + offsetMs;
    return note.t > afterMs && arrival - BLOCK_FALL_LIVE_MS <= clockMs && clockMs <= arrival + BLOCK_LISTEN_LIVE_MS;
  }) ?? null;
}

// What the presses of the block calibration suggest. One press is already an answer, more of them a better one.
export function blockEstimate(errors) {
  return errors.length ? { ...centreOf(errors), presses: errors.length } : null;
}

// The note of `lane` (any lane when null) nearest to heardMs within CAPTURE_MS, or null. notes are
// sorted by t.
export function nearestNote(notes, lane, heardMs) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].t < heardMs - CAPTURE_MS) lo = mid + 1;
    else hi = mid;
  }
  let best = null;
  for (let i = lo; i < notes.length && notes[i].t <= heardMs + CAPTURE_MS; i += 1) {
    if (lane !== null && notes[i].lane !== lane) continue;
    if (!best || Math.abs(heardMs - notes[i].t) < Math.abs(heardMs - best.t)) best = notes[i];
  }
  return best;
}

// The median head-hit error of one run, in heard time (positive: late against the offset in use),
// once it has enough hits to mean something; else null.
const RUN_TIMING_MIN_HITS = 8;
export function runTimingOf(hits) {
  if (!Array.isArray(hits) || hits.length < RUN_TIMING_MIN_HITS) return null;
  return Math.round(median(hits.map((hit) => hit.errorMs).sort((a, b) => a - b)));
}

export function createTapTiming() {
  const samples = []; // song-time errors, oldest first
  let total = 0; // every sample ever taken, so a caller can tell how many are new

  // Records one press; returns its song-time error, or null when no note was near.
  function add(notes, lane, songMs, offsetMs) {
    const note = nearestNote(notes, lane, songMs - offsetMs);
    if (!note) return null;
    const errorMs = songMs - note.t;
    samples.push(errorMs);
    total += 1;
    if (samples.length > KEEP_TAPS) samples.shift();
    return errorMs;
  }

  // { offsetMs, taps, spreadMs, total } once MIN_TAPS are in, else offsetMs and spreadMs are null.
  // offsetMs is the median error snapped to the slider's step; spreadMs is the median
  // absolute deviation, how scattered the taps are around it.
  function estimate() {
    const taps = samples.length;
    if (taps < MIN_TAPS) return { offsetMs: null, taps, spreadMs: null, total };
    return { ...centreOf(samples), taps, total };
  }

  function reset() {
    samples.length = 0;
  }

  return { add, estimate, reset };
}
