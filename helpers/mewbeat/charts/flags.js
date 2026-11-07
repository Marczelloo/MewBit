// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32, figures, phraseGrid and
// firstSound in v33 (difficulty.js, phrases.js onGrid), feltTempo in v34, quietLoneHold, soloLead and feltTolerance in v35,
// miniRests in v36, copyStrictHard (difficulty.js COPY_FROM) in v37, copyStrict, fadeOut and stairs in v38, decoderLanes,
// decoderPick and melodyTuned in v39 (difficulty.js MELODY_PICK), chordLoudness, twoKeyTrill, melodyRuns and dipThin in v40,
// sustainHolds and sustainPads in v41 (difficulty.js SUSTAIN_HOLDS), melodyOnsetShift, drumless, feltTempoUp, melodyOnly and
// dipSilence in v42 (difficulty.js DRUMLESS, MELODY_ONLY, DIP_SILENCE, FELT_TEMPO), chordSlow, holdSlow, slowDynamics and
// flatLoud in v43 (difficulty.js CHORD_SLOW, HOLD_SLOW, SLOW_DYNAMICS, FLAT_LOUD).
// figuresQuarter was dropped (0% of its notes hit on the test songs).

const FLAGS = {
  // Normal's phrase budget follows the felt pace, not the beats (selection.js phraseBudget): people's density hardly moves
  // with the tempo, Normal's rose with it (train, loud parts: under 170 BPM people 4.75 / Normal 4.51, over 190 BPM 4.98 /
  // 5.68). Train F1 .8005 -> .8018; over 190 BPM 4.82 -> 4.63 moments a second (people 4.35), 145-170 4.16 -> 4.23 (4.34).
  tempoBudget: { label: "Gęstość od tempa", levels: { normal: { tempoBudget: { refBpm: 175, power: 0.5 } } } },
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
