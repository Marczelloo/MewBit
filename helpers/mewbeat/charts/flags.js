// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const { EASY_FIGURES, HARD_PLUS, HELL_PLUS, NORMAL_HOLDS, PLUS_FIGURES } = require("./difficulty");

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
// fast songs, test F1 .8310 -> .8278, where flatLoud made them denser by ear).
// hardPlus is off by default: the user plays it first (generate.js plusNotes).

// easyFromNormal (off): Easy is cut from today's Normal instead of from normalV26, the Normal of generator v26. Easy so far lacked
// every later improvement of Normal (decoded melody, felt tempo, rests, figures, holds on sustains) and had moments Normal does
// not play (train, median per song: 94% of Easy's moments were Normal's, the least 52%). The user wants Hard as "Normal plus" and
// Easy as "Normal minus": with the flag every Easy moment is a Normal moment (100%, exact, on every train song), Normal's rests
// stay rests, and Easy lays its own chords, holds and lanes on the moments it keeps. cutFrom "normal" makes the cut; keepShare
// replaces the thinning a cut level had (every beat plus a budget of half beats, rhythm.js budgeted): per phrase Easy keeps this
// share of Normal's moments by tempo (in BPM), the beats and half beats competing for it, the beats scoring keepBeatBonus more.
// chordKeep and chordNew (Normal's chords Easy keeps, singles it makes chords) bring Easy's chord share back to people's .10,
// where Normal's moments alone had it at .087. The shares, the bonus and the chord settings were tuned on the train songs
// against people's Easy (the sweep is in the comment under easyV26 in difficulty.js).
// Normal, Hard and Hell are not touched: Normal's floor under Easy (notBelow) reads the old Easy, easyV26, while this flag is on
// (generate.js belowOf).
const FLAGS = {
  // Hard = every moment of Normal plus extras (generate.js plusNotes). Only Hard changes.
  hardPlus: { label: "Hard zbudowany na Normal", levels: { hard: { ...HARD_PLUS }, hardBase: {} } },
  // With hardPlus: the extras follow the figures of the bars, the same in each bar Normal plays alike (selection.js plusFigures).
  plusFigures: { label: "Hard: dodatki powtarzają figury taktów", levels: { hard: { ...PLUS_FIGURES }, hardBase: {} } },
  easyFromNormal: {
    label: "Easy wycięty z obecnego Normal",
    levels: { easy: { cutFrom: "normal", keepShare: [[145, 0.66], [190, 0.8], [Infinity, 0.85]], keepBeatBonus: 0.6, chordKeep: [0.6, 0.14, 0, 0], chordNew: [0.14, 0, 0, 0] } },
  },
  // With easyFromNormal: the bars Normal plays alike keep the same moments in Easy (rhythm.js figureMoments).
  easyFigures: { label: "Easy: te same cięcia w powtarzanych taktach", levels: { easy: { ...EASY_FIGURES } } },
  // Easy and Hard keep Normal's long holds: no extra cuts them, Easy keeps their moments (holds.js keptHolds).
  normalHolds: { label: "Easy i Hard: długie holdy z Normal zostają", levels: { easy: { ...NORMAL_HOLDS }, hard: { ...NORMAL_HOLDS }, hardBase: {} } },
  // Hell = every moment of Hard plus extras, sixteenths and chords on top (generate.js plusNotes). Only Hell changes.
  hellPlus: { label: "Hell zbudowany na Hard", levels: { hell: { ...HELL_PLUS } } },
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
    // hardBase (difficulty.js) is Hard as the levels cut from it see it: it takes the overrides of Hard unless the flag names it
    const levels = FLAGS[name].levels;
    const overrides = levels?.[levelName] ?? (levelName === "hardBase" ? levels?.hard : undefined);
    if (overrides) result = { ...result, ...overrides };
  }
  return result;
}

module.exports = { FLAGS, FLAGS_FILE_NAME, flagsKey, normalFlags, withFlags };
