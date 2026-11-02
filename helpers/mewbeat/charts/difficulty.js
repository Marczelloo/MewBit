// Bumped on every change that alters generated charts (tuning included);
// charts and leaderboards are keyed by it.
const GENERATOR_VERSION = 16;

// --- Shared tuning constants (Task 9 tunes these by ear) -------------------

const BANDS = ["low", "lowmid", "highmid", "high"]; // band index === base lane

const MERGE_WINDOW_MS = 30; // onsets this close across bands are one candidate
const LEAD_IN_MS = 1500; // no notes before this
const SILENCE_ENERGY = 0.08; // no notes where the energy curve is below this
const MIN_NOTES = 20; // fewer notes than this means "not chartable"

const DENSITY_WINDOW_MS = 2000; // candidates are thinned per window of this size
// Target notes/s = maxNps * busy * energy^ENERGY_EXPONENT. Below 1.5 so a mid-energy passage (a drum section
// at half the song's peak) is not charted as if it were nearly silent. phrases.js scores layers by it too.
const ENERGY_EXPONENT = 1.0;

// Busyness: the energy curve is normalised per song, so without this every
// song's loud parts get the same density. A song's strong-onset rate scales the
// density cap instead (see busyness.js), within an absolute per-difficulty ceiling.
const BUSY_ONSET_STRENGTH = 0.5; // an onset at/above this strength counts towards busyness
const BUSY_MEDIAN_RATE = 14; // strong onsets per second of non-silent audio of a typical song (busy factor 1)
const BUSY_MIN_FACTOR = 0.8; // the calmest song gets 80 % of the difficulty's maxNps
const BUSY_MAX_FACTOR = 1.6; // the busiest gets 160 % (until the difficulty's ceiling)

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
    maxNps: 3.0, // was 2.5; the busy factor now spreads it 2.4-3.5
    maxNpsCeiling: 3.5, // the busy factor never lifts the density cap above this
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
    fillRestBeats: 3, // a rest this long while the music plays gets a note of the music there (rests.js; null = never)
    scroll: null, // scroll-velocity bounds for the sections (scroll.js; null = one speed, as osu!mania's Easy)
    quarterMinEnergy: null, // Normal: off-1/2-grid level-1 events need at least this phrase energy
    holdMinBeats: 1, // shortest sustained note that becomes a hold, in beats
    pulseNotesPerBeat: 0.5, // density floor in a drum-led phrase with a steady pulse (phrases.js hasSteadyPulse), notes per beat
    holdOtherHand: "blocked", // while a hold runs: "blocked" = no note in any lane, "spaced" = other hand >= 1/2 beat apart, "free"
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
    maxNpsCeiling: 6.5,
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
    fillRestBeats: 2.5,
    scroll: { min: 0.9, max: 1.05 },
    quarterMinEnergy: 0.6,
    holdMinBeats: 1, // a half-beat hold reads as noise
    pulseNotesPerBeat: 1,
    holdOtherHand: "spaced",
    bandBias: [1, 1, 0.9, 0.8],
    beatBias: 0.2,
    // Second note only on a strong downbeat in a loud part.
    chord: { minStrength: 0.8, onDownbeat: true, minEnergy: 0.6 },
    alternation: null,
  },
  hard: {
    maxNps: 9.0,
    maxNpsCeiling: 10,
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
    fillRestBeats: null, // Hard's rests are filled with the drums (seams.js fillGaps)
    scroll: { min: 0.8, max: 1.1 },
    quarterMinEnergy: null,
    holdMinBeats: 1,
    pulseNotesPerBeat: 2,
    holdOtherHand: "free",
    bandBias: [0.9, 1, 1, 1],
    beatBias: 0,
    chord: { minStrength: 0.95, onDownbeat: false, minEnergy: 0.5 },
    // Hard's own lane logic: inside a stream (notes within maxGapBeats of each
    // other) every second note takes the runner-up band's lane instead of the
    // strongest band's, so patterns alternate between the two loudest bands.
    alternation: { maxGapBeats: 2 },
  },
  // For fun, beyond Hard. Charted from the music like Hard, not by stacking notes on it: the extra notes are the
  // music's own sixteenths and accents (finer onsets kept at a lower strength, chords on more of the loud hits,
  // denser drum pulses), so the chart is harder to play but still follows the song.
  hell: {
    maxNps: 13.0,
    maxNpsCeiling: 16,
    baseDiv: 4,
    energyDiv: 4,
    highEnergyFrom: 0.5,
    fineDiv: 8,
    fineMinStrength: 0.7,
    laneGapBeats: 1 / 4,
    minLaneGapMs: 110,
    minGapBeats: 1 / 8,
    minNoteGapMs: 45,
    maxJack: 4,
    maxLevel: 2,
    fillRestBeats: null,
    scroll: { min: 0.7, max: 1.1 },
    quarterMinEnergy: null,
    holdMinBeats: 1,
    pulseNotesPerBeat: 4,
    holdOtherHand: "free",
    bandBias: [0.9, 1, 1, 1],
    beatBias: 0,
    chord: { minStrength: 0.8, onDownbeat: false, minEnergy: 0.4 },
    alternation: { maxGapBeats: 2 },
  },
};

module.exports = {
  BANDS,
  BEAT_INTERVAL_TOLERANCE,
  BEAT_TOLERANCE_MS,
  BUSY_MAX_FACTOR,
  BUSY_MEDIAN_RATE,
  BUSY_MIN_FACTOR,
  BUSY_ONSET_STRENGTH,
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
