// Bumped on every change that alters generated charts (tuning included);
// charts and leaderboards are keyed by it.
const GENERATOR_VERSION = 4;

// --- Shared tuning constants (Task 9 tunes these by ear) -------------------

const BANDS = ["low", "lowmid", "highmid", "high"]; // band index === base lane

const MERGE_WINDOW_MS = 30; // onsets this close across bands are one candidate
const LEAD_IN_MS = 1500; // no notes before this
const SILENCE_ENERGY = 0.08; // no notes where the energy curve is below this
const MIN_NOTES = 20; // fewer notes than this means "not chartable"

const DENSITY_WINDOW_MS = 2000; // candidates are thinned per window of this size
const ENERGY_EXPONENT = 1.5; // target notes/s = maxNps * energy^ENERGY_EXPONENT

const CONFIDENT_TEMPO = 0.5; // snap to the beat grid at/above this confidence
const FALLBACK_BEAT_MS = 500; // 120 BPM, used for gaps when tempo is not trusted
const BEAT_TOLERANCE_MS = 35; // a note this close to a beat counts as "on" it
const GAP_TOLERANCE_MS = 1; // rounding slack on the same-lane gap check
const MAX_SNAP_DISTANCE_MS = 60; // an onset further than this from the grid stays at its raw time
const BEAT_INTERVAL_TOLERANCE = 0.25; // local beat length must be within +-25% of the median
const SNAPPED_FLOOR_SLACK = 0.98; // snapped notes may sit this much under the tempo-relative gap floor

// --- Per-difficulty parameters ---------------------------------------------

const DIFFICULTIES = {
  easy: {
    maxNps: 2.5,
    // Grid divisions per beat: baseDiv normally, energyDiv at energy >= highEnergyFrom,
    // fineDiv for onsets with strength >= fineMinStrength (null = never).
    baseDiv: 2,
    energyDiv: 2,
    highEnergyFrom: 0.6,
    fineDiv: null,
    fineMinStrength: 0.9,
    laneGapBeats: 1, // same-lane gap, in beats
    minLaneGapMs: 350, // ...never below this, whatever the tempo
    minGapBeats: 1 / 2, // any-lane gap on the unsnapped path, in 120-BPM beats
    minNoteGapMs: 200, // any-lane gap between distinct times, never below this (Normal 100, Hard 60)
    maxJack: 1, // longest same-lane run of consecutive notes (1 = no jacks)
    maxLevel: 0, // patterns keep events up to this level (0 = strong, 1 = grid, 2 = fine)
    quarterMinEnergy: null, // Normal: off-1/2-grid level-1 events need at least this phrase energy
    holdMinBeats: 1, // shortest sustained note that becomes a hold, in beats
    // Selection ranking = strength * bandBias[band] + beatBias * (1 downbeat, 0.5 beat, 0 off-beat).
    // Easy/Normal lean on the backbone (kick/snare, downbeats); Hard follows the
    // raw onset strength across all bands, so its note choice differs from Normal.
    bandBias: [1, 1, 0.85, 0.7],
    beatBias: 0.35,
    chord: null,
    alternation: null,
  },
  normal: {
    maxNps: 4.5,
    baseDiv: 2,
    energyDiv: 4,
    highEnergyFrom: 0.6,
    fineDiv: null,
    fineMinStrength: 0.9,
    laneGapBeats: 1 / 2,
    minLaneGapMs: 200,
    minGapBeats: 1 / 4,
    minNoteGapMs: 100,
    maxJack: 2,
    maxLevel: 1,
    quarterMinEnergy: 0.6,
    holdMinBeats: 0.5,
    bandBias: [1, 1, 0.9, 0.8],
    beatBias: 0.2,
    // Second note only on a strong downbeat in a loud part.
    chord: { minStrength: 0.8, onDownbeat: true, minEnergy: 0.6 },
    alternation: null,
  },
  hard: {
    maxNps: 7.0,
    baseDiv: 4,
    energyDiv: 4,
    highEnergyFrom: 0.6,
    fineDiv: 8,
    fineMinStrength: 0.9,
    laneGapBeats: 1 / 4,
    minLaneGapMs: 150,
    minGapBeats: 1 / 8,
    minNoteGapMs: 60,
    maxJack: 3,
    maxLevel: 2,
    quarterMinEnergy: null,
    holdMinBeats: 0.5,
    bandBias: [0.9, 1, 1, 1],
    beatBias: 0,
    chord: { minStrength: 0.95, onDownbeat: false, minEnergy: 0.5 },
    // Hard's own lane logic: inside a stream (notes within maxGapBeats of each
    // other) every second note takes the runner-up band's lane instead of the
    // strongest band's, so patterns alternate between the two loudest bands.
    alternation: { maxGapBeats: 2 },
  },
};

module.exports = {
  BANDS,
  BEAT_INTERVAL_TOLERANCE,
  BEAT_TOLERANCE_MS,
  CONFIDENT_TEMPO,
  DENSITY_WINDOW_MS,
  DIFFICULTIES,
  ENERGY_EXPONENT,
  FALLBACK_BEAT_MS,
  GAP_TOLERANCE_MS,
  GENERATOR_VERSION,
  LEAD_IN_MS,
  MAX_SNAP_DISTANCE_MS,
  MERGE_WINDOW_MS,
  MIN_NOTES,
  SILENCE_ENERGY,
  SNAPPED_FLOOR_SLACK,
};
