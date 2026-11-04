// Bumped on every change that alters generated charts (tuning included);
// charts and leaderboards are keyed by it.
const GENERATOR_VERSION = 28;

// --- Shared tuning constants (Task 9 tunes these by ear) -------------------

const BANDS = ["low", "lowmid", "highmid", "high"]; // band index === base lane

const MERGE_WINDOW_MS = 30; // onsets this close across bands are one candidate
const LEAD_IN_MS = 1000; // no notes before this
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
const MAX_SNAP_DISTANCE_MS = 35; // an onset further than this from the grid stays at its raw time (inside the perfect window)
const BEAT_INTERVAL_TOLERANCE = 0.25; // local beat length must be within +-25% of the median
const SNAPPED_FLOOR_SLACK = 0.98; // snapped notes may sit this much under the tempo-relative gap floor

// --- Per-difficulty parameters ---------------------------------------------

// Levels the generator charts but does not offer: DIFFICULTIES (and generateAll) stay the public ones.
// normalV26 is the Normal of generator v26, kept as what Easy is cut from.
const INTERNAL_LEVELS = {
  normalV26: {
    grammar: "normal",
    chordKeep: [0.66, 0.64, 0.38, 0.38],
    chordNew: [0.04, 0.04, 0.04, 0],
    maxNps: 6.5,
    maxNpsCeiling: 7.5,
    baseDiv: 2,
    energyDiv: 2,
    highEnergyFrom: 0.6,
    fineDiv: null,
    fineMinStrength: 0.9,
    laneGapBeats: 1 / 2,
    minLaneGapMs: 150,
    minGapBeats: 1 / 4,
    minNoteGapMs: 100,
    maxJack: 2,
    cutFrom: "hard",
    cutLevel: 2,
    maxLevel: 1,
    halfBudget: [[110, 0.74], [135, 0.82], [160, 0.73], [185, 0.62], [Infinity, 0.46]],
    quarterBudget: [[110, 0.27], [135, 0.11], [160, 0.064], [185, 0.025], [Infinity, 0.008]], // ...and quarter beats, per quarter-beat place
    fillRestBeats: 2,
    holdMinBeats: 1, // a half-beat hold reads as noise
    pulseNotesPerBeat: 1,
    holdOtherHand: "spaced",
    bandBias: [1, 1, 0.9, 0.8],
    beatBias: 0.2,
    // Second note on a beat with some weight, unless the part is quiet.
    chord: { minStrength: 0.4, onDownbeat: false, minEnergy: 0.45 },
    drumChords: true, // a drum hit under a lone note of the tune is that note's other hand
    maxChordShare: 1 / 3, // chords may run up to this share of the moments, a downbeat may always be one
    alternation: null,
    // What makes a chart readable rather than merely playable (Hard and Hell have none of these).
    gapBeats: 1 / 4, // any-lane gap on the pattern path, in beats
    chordGapBeats: 1 / 4, // ...around a chord
    leaderFirst: true, // the leading layer picks its notes before the layers backing it, on-beat moments before off-beat ones
    thinChords: true, // a chord only where diff.chord allows it, in both hands and clear of its neighbours
    densityByMoment: true, // the density cap counts moments (a chord is one thing to read)
    maxHoldShare: 0.15,
    gapHoldShare: 0.14,
    sectionChordRise: 0.7,
    sectionChordEnergy: 0.3,
    motifPull: 6,
    echoMirror: 0.3,
    sustainMinBeats: 1,
  },
};

const DIFFICULTIES = {
  easy: {
    grammar: "easy", // which human lane patterns the level draws from (lanes.js)
    chordKeep: [0.5, 0.14, 0, 0], // how many of the level above's chords stay chords, by place in the bar (downbeat, beat, half, finer)
    chordNew: [0.08, 0, 0, 0], // ...and how many of its single notes become one
    chordGapBeats: 1 / 2,
    maxNps: 3.5, // the busy factor spreads it 2.8-4.5; a mapper plays about 3.5 notes/s at 185 BPM and up
    maxNpsCeiling: 4.5, // the busy factor never lifts the density cap above this
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
    minNoteGapMs: 130, // any-lane gap between distinct times, never below this (Normal 100, Hard 60)
    maxJack: 2, // longest same-lane run of consecutive notes (1 = no jacks)
    cutFrom: "normalV26", // the level whose moments this one is cut from (rhythm.js)
    cutLevel: 1, // cut from a harder level, moments kept up to this place (0 = a beat, 1 = a half beat, 2 = a quarter beat)
    maxLevel: 0, // patterns keep events up to this level (0 = strong, 1 = grid, 2 = fine)
    halfBudget: [[110, 0.45], [Infinity, 0.19]], // half beats a mapper plays per beat, up to a tempo in BPM
    maxHalfRun: 5, // longest run of half beats; the next beat ends it
    quietBeats: 0.62, // share of its beats a phrase keeps at its quietest; a loud one keeps them all
    fillRestBeats: 2, // a rest this long while the music plays gets a note of the music there (rests.js; null = never)
    holdMinBeats: 1, // shortest sustained note that becomes a hold, in beats
    pulseNotesPerBeat: 1, // density floor in a phrase with a steady pulse (phrases.js hasSteadyPulse), notes per beat
    holdOtherHand: "blocked", // while a hold runs: "blocked" = no note in any lane, "spaced" = other hand >= 1/2 beat apart, "free"
    // Selection ranking = strength * bandBias[band] + beatBias * (1 downbeat, 0.5 beat, 0 off-beat).
    // Easy/Normal lean on the backbone (kick/snare, downbeats); Hard follows the
    // raw onset strength across all bands, so its note choice differs from Normal.
    bandBias: [1, 1, 0.85, 0.7],
    beatBias: 0.35,
    // Second note only on a strong downbeat (Easy has no 1/8s or fills to accent a bar with).
    chord: { minStrength: 0.8, onDownbeat: true, minEnergy: 0.7 },
    alternation: null,
    // What makes a chart readable rather than merely playable (Hard and Hell have none of these).
    gapBeats: 1 / 2, // any-lane gap on the pattern path, in beats
    tonalGapBeats: 1 / 2, // ...between two notes of the sung or bass line
    leaderFirst: true, // the leading layer picks its notes before the layers backing it, on-beat moments before off-beat ones
    thinChords: true, // a chord only where diff.chord allows it, in both hands and clear of its neighbours
    densityByMoment: true, // the density cap counts moments (a chord is one thing to read)
    vocalLeads: true, // in a sung song the voice leads every phrase it is heard in: it is what a beginner follows
    oneLayer: true, // the leading layer alone: a second layer in the other hand is a skill Easy does not ask for
    longNotesOnBeats: true, // a long sung note off the half-beat grid starts on the nearest beat (its hold carries the voice)
    oneHoldAtATime: true, // a hold starting under another stays a tap: two held keys are a skill Easy does not ask for
    maxHoldShare: 0.2,
    gapHoldShare: 0.13, // holds are brought up to this share where a bass or lead line plays
    sectionChordRise: 0.9, // a section this much louder than the last one opens on a chord (sections.js)...
    sectionChordEnergy: 0.35, // ...when it is at least this loud
    sustainMinBeats: 1,
  },
  // Normal picks its notes from the music (selection.js): the moments the music puts in the foreground, as many as its
  // phrase has budget for, and not cut from Hard's. Chords come over the finished moments like Hard's (chords.js).
  normal: {
    selector: "music",
    scoreLevel: "normal", // the weights the moments are scored with (momentWeights.js K)
    foreground: 0.5, // a moment scoring at least this (a logit) is in the foreground
    budgetScale: 1.1, // the phrase budget as the music calls for it times this (selection.js phraseBudget)
    grammar: "normal",
    melodyLanes: true, // the lanes follow the melody and keep the rules of Normal (laneRules.js, lanes.js)
    chordRates: [0.7, 0.6, 0.13, 0.14], // how often a moment is a chord, by place in the bar (chords.js)
    maxChordShare: 1 / 3, // chords may run up to this share of the moments (chords.js; v26's cap, which acts on this path as well)
    chordGapBeats: 1 / 4,
    maxNps: 6.5,
    maxNpsCeiling: 7.5,
    laneGapBeats: 1 / 2,
    minLaneGapMs: 150,
    minNoteGapMs: 100,
    maxJack: 2,
    holdMinBeats: 1, // a half-beat hold reads as noise
    holdOtherHand: "spaced",
    gapBeats: 1 / 4, // any-lane gap between two moments, in beats
    maxHoldShare: 0.15,
    gapHoldShare: 0.14,
    sectionChordRise: 0.7,
    sectionChordEnergy: 0.3,
    motifPull: 6,
    echoMirror: 0.3,
    sustainMinBeats: 1,
  },
  hard: {
    grammar: "hard",
    chordRates: [1.3, 1.15, 0.26, 0.3], // how often a moment is a chord, by place in the bar (chords.js)
    chordTriples: [0.3, 0.1, 0.1, 0.1], // how many of those chords take a third note
    chordGapBeats: 1 / 8,
    chordMinGapMs: 75,
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
    holdMinBeats: 1,
    pulseNotesPerBeat: 2,
    fastQuarterMs: 90, // above about 167 BPM the half beats come first (difficultyFilter.js fastQuarterLevel)
    holdOtherHand: "free",
    restHoldBeats: 1 / 2, // the shortest hold a rest gets (the others: holdMinBeats)
    gapHoldShare: 0.09,
    sectionChordRise: 0.5,
    sectionChordEnergy: 0.25,
    motifPull: 6,
    echoMirror: 0.3,
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
    grammar: "hard",
    chordRates: [1.35, 1.25, 0.38, 0.4],
    chordTriples: [0.3, 0.1, 0.1, 0.1],
    chordGapBeats: 1 / 8,
    chordMinGapMs: 60,
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
    holdMinBeats: 1,
    pulseNotesPerBeat: 4,
    holdOtherHand: "free",
    restHoldBeats: 1 / 2,
    gapHoldShare: 0.07,
    sectionChordRise: 0.5,
    sectionChordEnergy: 0.25,
    motifPull: 6,
    echoMirror: 0.3,
    bandBias: [0.9, 1, 1, 1],
    beatBias: 0,
    chord: { minStrength: 0.8, onDownbeat: false, minEnergy: 0.4 },
    alternation: { maxGapBeats: 2 },
  },
};

// A level by name, public or internal.
const levelOf = (name) => INTERNAL_LEVELS[name] ?? DIFFICULTIES[name];

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
  INTERNAL_LEVELS,
  LEAD_IN_MS,
  levelOf,
  MAX_SNAP_DISTANCE_MS,
  MERGE_WINDOW_MS,
  MIN_NOTES,
  SILENCE_ENERGY,
  SNAPPED_FLOOR_SLACK,
};
