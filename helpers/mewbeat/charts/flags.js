// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const {
  COPY_MELODY,
  EASY_SAME_CUTS,
  FAST_RUNS,
  HARD_HOLDS,
  HEARD_CHORDS,
  LOUD_HOLES,
  MELODY_KEEP,
  MELODY_LINES,
  MELODY_LINES_FIRST,
  MELODY_SHIFT_PICK,
  PITCH_LANES,
  PLUS_MELODY,
  RUN_LANES,
} = require("./difficulty");

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32, figures, phraseGrid and
// firstSound in v33 (difficulty.js, phrases.js onGrid), feltTempo in v34, quietLoneHold, soloLead and feltTolerance in v35,
// miniRests in v36, copyStrictHard (difficulty.js COPY_FROM) in v37, copyStrict, fadeOut and stairs in v38, decoderLanes,
// decoderPick and melodyTuned in v39 (difficulty.js MELODY_PICK), chordLoudness, twoKeyTrill, melodyRuns and dipThin in v40,
// sustainHolds and sustainPads in v41 (difficulty.js SUSTAIN_HOLDS), melodyOnsetShift, drumless, feltTempoUp, melodyOnly and
// dipSilence in v42 (difficulty.js DRUMLESS, MELODY_ONLY, DIP_SILENCE, FELT_TEMPO), chordSlow, holdSlow, slowDynamics and
// flatLoud in v43 (difficulty.js CHORD_SLOW, HOLD_SLOW, SLOW_DYNAMICS, FLAT_LOUD).
// figuresQuarter was dropped (0% of its notes hit on the test songs), musicFirst (no gain by ear) and tempoBudget (it thinned
// fast songs, test F1 .8310 -> .8278, where flatLoud made them denser by ear). hardPlus, plusFigures, easyFromNormal,
// easyFigures, normalHolds and hellPlus became part of Easy, Hard and Hell in v44 (difficulty.js EASY_FROM_NORMAL,
// EASY_FIGURES, HARD_PLUS, PLUS_FIGURES, NORMAL_HOLDS, HELL_PLUS).
const FLAGS = {
  // Normal: a repeat whose copy would miss the melody its source plays is charted fresh (generate.js copiedRepeat).
  copyMelody: { label: "Normal: powtórka bez kopii, gdy kopia gubi melodię", levels: { normal: { copyMelody: COPY_MELODY } } },
  // Easy: the bars Normal plays alike keep the same moments after the floors too (rhythm.js sameCuts).
  easySameCuts: { label: "Easy: te same cięcia w powtarzanych taktach po limitach", levels: { easy: { ...EASY_SAME_CUTS } } },
  // Normal: the bursts of melodyRuns also where a quarter beat is under 100 ms, gaps from 70 ms (generate.js finish).
  fastRuns: { label: "Normal: krótkie serie szybkiej melodii także w szybkich utworach (ćwierć bitu poniżej 100 ms, odstęp w serii od 70 ms)", levels: { normal: { fastRuns: FAST_RUNS } } },
  // Hard: its own holds on sustains and rests, let go with the sound (generate.js plusNotes). Hell, built on Hard, follows.
  hardHolds: { label: "Hard: własne holdy, puszczane z dźwiękiem", levels: { hard: { ...HARD_HOLDS } } },
  // Normal, Hard, Hell: where a pitched line leads, a moment plays no more notes than pitches begin on it (chords.js heardPitches).
  heardChords: { label: "Akordy tylko tam, gdzie gra kilka dźwięków naraz (linia pianina itp.)", levels: { normal: { heardChords: HEARD_CHORDS }, hard: { heardChords: HEARD_CHORDS }, hell: { heardChords: HEARD_CHORDS } } },
  // Normal: a stretch a phrase left empty takes a loud sound in it, on top of its budget (selection.js selectMoments).
  loudHoles: { label: "Normal: dziura z głośnym dźwiękiem w środku dostaje nutę (ponad limit sekcji)", levels: { normal: { loudHoles: LOUD_HOLES } } },
  // Normal: thinning a slower stretch, an energy dip or the fade-out leaves the notes of the decoded melody (generate.js melodyMoments).
  melodyKeep: { label: "Normal: przerzedzanie oszczędza nuty melodii", levels: { normal: { melodyKeep: MELODY_KEEP } } },
  // Normal: the decoder's good, loud lines of melody, thinned to the level's step, are played on top of what a phrase chose (melodyLines.js, selection.js).
  melodyLines: { label: "Normal: trzyma linie melodii (dobre linie z dekodera dogrywane do tego, co już wybrane; nic nie traci miejsca)", levels: { normal: { melodyLines: MELODY_LINES } } },
  // Normal: the same lines chosen before everything else; a line wins its place from a sound that is not clearly louder (selection.js).
  melodyLinesFirst: { label: "Normal: linie melodii wchodzą pierwsze (więcej melodii kosztem części głośnych nut)", levels: { normal: { melodyLines: MELODY_LINES_FIRST } } },
  // Normal: the decoded melody is moved to where it meets the song's sounds best (generate.js pickedMelodyShift).
  melodyShiftPick: { label: "Normal: przesunięcie melodii dobierane do dźwięków utworu", levels: { normal: { melodyShiftPick: MELODY_SHIFT_PICK } } },
  // Normal: the lane moves the way the melody's pitch moves, by about as much (laneRules.js pitchCost). Lanes only: no note moves in time.
  pitchLanes: { label: "Normal: tor idzie za wysokością melodii (wyżej = w prawo)", levels: { normal: { pitchLanes: PITCH_LANES } } },
  // Hard, Hell: an extra on a note of the decoded melody scores more (generate.js plusNotes).
  plusMelody: { label: "Hard, Hell: dodatkowe nuty chętniej na melodii", levels: { hard: { plusMelody: PLUS_MELODY }, hell: { plusMelody: PLUS_MELODY } } },
  // Normal: a fast run of the melody is one staircase or roll across neighbouring lanes (laneRules.js runCost). Lanes only.
  runLanes: { label: "Normal: szybki bieg melodii to schodki po sąsiednich torach", levels: { normal: { runLanes: RUN_LANES } } },
};

const isKnown = (name) => typeof name === "string" && Object.hasOwn(FLAGS, name);

// A plain { name: true } holding only the known flags that are on. Takes undefined, an array of names or an object.
function normalFlags(input) {
  const on = Array.isArray(input)
    ? input
    : input && typeof input === "object" ? Object.keys(input).filter((name) => input[name]) : [];
  return Object.fromEntries(on.filter(isKnown).map((name) => [name, true]));
}

const namesOf = (flags) => Object.keys(normalFlags(flags)).sort();

// The enabled names, sorted and joined with "-"; "" when none are on.
const flagsKey = (flags) => namesOf(flags).join("-");

// diff itself when no enabled flag overrides this level, else a copy with the overrides applied in sorted flag order.
function withFlags(diff, levelName, flags) {
  let result = diff;
  for (const name of namesOf(flags)) {
    const overrides = FLAGS[name].levels?.[levelName];
    if (overrides) result = { ...result, ...overrides };
  }
  return result;
}

module.exports = { FLAGS, FLAGS_FILE_NAME, flagsKey, normalFlags, withFlags };
