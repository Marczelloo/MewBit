const { DIFFICULTIES, GENERATOR_VERSION, MIN_NOTES } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { starsOf } = require("./stars");
const { buildTiming, energyLookup } = require("./timing");

// --- public API --------------------------------------------------------------

function generateChart(features, difficulty, audioKey) {
  const p = DIFFICULTIES[difficulty];
  if (!p) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (!features || !Array.isArray(features.bands) || !Number.isFinite(features.durationMs)) return null;

  const durationMs = Math.round(features.durationMs);
  const timing = buildTiming(features, durationMs);
  const energy = energyLookup(features);

  // toMs is exclusive; +1 keeps a note exactly at the end of the track.
  const notes = bandPathNotes(features, timing, p, energy, { fromMs: 0, toMs: durationMs + 1 });
  if (notes.length < MIN_NOTES) return null;

  return {
    version: GENERATOR_VERSION,
    audioKey,
    difficulty,
    durationMs,
    stars: starsOf({ notes }),
    highlightMs: Number.isFinite(features.highlightMs) && features.highlightMs >= 0 && features.highlightMs <= durationMs
      ? features.highlightMs
      : null,
    notes,
  };
}

function generateAll(features, audioKey) {
  const easy = generateChart(features, "easy", audioKey);
  const normal = generateChart(features, "normal", audioKey);
  const hard = generateChart(features, "hard", audioKey);
  return easy && normal && hard ? { easy, normal, hard } : null;
}

module.exports = { GENERATOR_VERSION, generateAll, generateChart, starsOf };
