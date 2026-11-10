// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const { COPY_MELODY, EASY_SAME_CUTS, HARD_HOLDS, HEARD_CHORDS, MELODY_KEEP, MELODY_SHIFT_PICK, PLUS_MELODY } = require("./difficulty");

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
  // Hard: its own holds on sustains and rests, let go with the sound (generate.js plusNotes). Hell, built on Hard, follows.
  hardHolds: { label: "Hard: własne holdy, puszczane z dźwiękiem", levels: { hard: { ...HARD_HOLDS } } },
  // Normal, Hard, Hell: where a pitched line leads, a moment plays no more notes than pitches begin on it (chords.js heardPitches).
  heardChords: { label: "Akordy tylko tam, gdzie gra kilka dźwięków naraz (linia pianina itp.)", levels: { normal: { heardChords: HEARD_CHORDS }, hard: { heardChords: HEARD_CHORDS }, hell: { heardChords: HEARD_CHORDS } } },
  // Normal: thinning a slower stretch, an energy dip or the fade-out leaves the notes of the decoded melody (generate.js melodyMoments).
  melodyKeep: { label: "Normal: przerzedzanie oszczędza nuty melodii", levels: { normal: { melodyKeep: MELODY_KEEP } } },
  // Normal: the decoded melody is moved to where it meets the song's sounds best (generate.js pickedMelodyShift).
  melodyShiftPick: { label: "Normal: przesunięcie melodii dobierane do dźwięków utworu", levels: { normal: { melodyShiftPick: MELODY_SHIFT_PICK } } },
  // Hard, Hell: an extra on a note of the decoded melody scores more (generate.js plusNotes).
  plusMelody: { label: "Hard, Hell: dodatkowe nuty chętniej na melodii", levels: { hard: { plusMelody: PLUS_MELODY }, hell: { plusMelody: PLUS_MELODY } } },
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
