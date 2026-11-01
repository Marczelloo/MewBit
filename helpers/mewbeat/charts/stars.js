// Star rating tuning (Task 9 may adjust; any change bumps GENERATOR_VERSION).
const BASE_STARS = 0.5;
const STARS_PER_NPS = 0.48;
const STARS_PER_CHORD_RATIO = 2;
const STARS_PER_HOLD_RATIO = 0.3; // times the share of notes that are holds
const PEAK_WINDOW_MS = 8000;
const MAX_STARS = 10;

// Highest notes/s over any 8 s window.
function peakNps(notes) {
  let best = 0;
  let start = 0;
  for (let end = 0; end < notes.length; end++) {
    while (notes[end].t - notes[start].t >= PEAK_WINDOW_MS) start++;
    best = Math.max(best, end - start + 1);
  }
  return best / (PEAK_WINDOW_MS / 1000);
}

// Share of note moments (distinct times) that are chords.
function chordRatio(notes) {
  let moments = 0;
  let chords = 0;
  for (let i = 0; i < notes.length; i++) {
    if (i > 0 && notes[i].t === notes[i - 1].t) continue;
    moments++;
    if (i + 1 < notes.length && notes[i + 1].t === notes[i].t) chords++;
  }
  return moments === 0 ? 0 : chords / moments;
}

// Share of notes that are holds (a hold counts as one note everywhere else).
function holdRatio(notes) {
  return notes.filter((n) => n.len > 0).length / notes.length;
}

function starsOf(chart) {
  const notes = chart?.notes ?? [];
  if (notes.length === 0) return 0;
  const raw = BASE_STARS + STARS_PER_NPS * peakNps(notes) + STARS_PER_CHORD_RATIO * chordRatio(notes) + STARS_PER_HOLD_RATIO * holdRatio(notes);
  return Math.round(Math.min(MAX_STARS, Math.max(0, raw)) * 10) / 10;
}

module.exports = { starsOf };
