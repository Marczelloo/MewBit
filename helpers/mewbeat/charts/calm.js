// How calm the music is at a moment, for the holds. The pitch tracker hears few long sounds (no lead or bass at all in the
// calm middle of a song like Camellia's GHOST), but a stretch where the upper bands all but stop is plain in the onsets, and
// that is where a long note belongs and where a player has room for one.

const { clamp01 } = require("./util");

const STRONG_ONSET = 0.5;
const UPPER_BANDS = ["high", "highmid"];
const SMOOTH_SECONDS = 2; // on each side
const REFERENCE_SHARE = 0.75; // the song's full playing: this share of its seconds plays less
const CALM_ENOUGH = 0.5; // at least this calm, a moment counts as one of the calm stretch

// A lookup t -> 0 (the song at full play, or past `loudAbove` of it) .. 1 (at `quietBelow` of it or under); null for a song
// with no upper bands to read, where the holds stay as they are.
function calmLookup(features, durationMs, { quietBelow, loudAbove }) {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  const counts = new Array(seconds).fill(0);
  for (const band of features.bands ?? []) {
    if (!UPPER_BANDS.includes(band.name)) continue;
    for (const onset of band.onsets ?? []) {
      const second = Math.floor(onset.t / 1000);
      if (onset.s >= STRONG_ONSET && second >= 0 && second < seconds) counts[second]++;
    }
  }
  const smooth = counts.map((_, i) => {
    const around = counts.slice(Math.max(0, i - SMOOTH_SECONDS), i + SMOOTH_SECONDS + 1);
    return around.reduce((sum, x) => sum + x, 0) / around.length;
  });
  const full = [...smooth].sort((a, b) => a - b)[Math.floor(REFERENCE_SHARE * (seconds - 1))];
  if (!(full > 0)) return null;
  return (t) => {
    const second = Math.min(seconds - 1, Math.max(0, Math.floor(t / 1000)));
    return clamp01((loudAbove - smooth[second] / full) / (loudAbove - quietBelow));
  };
}

// `loud` at no calm, `quiet` at full calm.
const byCalm = (calm, { loud, quiet }) => loud + (quiet - loud) * calm;

// The mean of byCalm over the notes: what a share over them all comes to.
function shareOver(notes, calmAt, shares) {
  if (notes.length === 0) return shares.loud;
  return notes.reduce((sum, n) => sum + byCalm(calmAt(n.t), shares), 0) / notes.length;
}

module.exports = { CALM_ENOUGH, calmLookup, shareOver };
