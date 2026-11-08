// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const { HARD_PLUS } = require("./difficulty");

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

const FLAGS = {
  // Hard = every moment of Normal plus extras (generate.js plusNotes). Only Hard changes.
  hardPlus: { label: "Hard zbudowany na Normal", levels: { hard: { ...HARD_PLUS }, hardBase: {} } },
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
