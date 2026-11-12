// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const crypto = require("node:crypto");

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label (Polish, for the player), levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32, figures, phraseGrid and
// firstSound in v33 (difficulty.js, phrases.js onGrid), feltTempo in v34, quietLoneHold, soloLead and feltTolerance in v35,
// miniRests in v36, copyStrictHard (difficulty.js COPY_FROM) in v37, copyStrict, fadeOut and stairs in v38, decoderLanes,
// decoderPick and melodyTuned in v39 (difficulty.js MELODY_PICK), chordLoudness, twoKeyTrill, melodyRuns and dipThin in v40,
// sustainHolds and sustainPads in v41 (difficulty.js SUSTAIN_HOLDS), melodyOnsetShift, drumless, feltTempoUp, melodyOnly and
// dipSilence in v42 (difficulty.js DRUMLESS, MELODY_ONLY, DIP_SILENCE, FELT_TEMPO), chordSlow, holdSlow, slowDynamics and
// flatLoud in v43 (difficulty.js CHORD_SLOW, HOLD_SLOW, SLOW_DYNAMICS, FLAT_LOUD).
// figuresQuarter was dropped (0% of its notes hit on the test songs), musicFirst (no gain by ear), tempoBudget (it thinned
// fast songs, test F1 .8310 -> .8278, where flatLoud made them denser by ear), runLanes (after fastRuns it moved 3% of Normal's notes and nothing one could hear) and
// leadVoice (the bass gave way to the melody everywhere the line played; heard against leadVoiceBoth it lost, Rush E Normal 656
// moments against 673 and Finale 570 against 612 with the left hand gone, and it broke nesting: Normal kept 6-20 moments Hard lacked). hardPlus, plusFigures, easyFromNormal,
// easyFigures, normalHolds and hellPlus became part of Easy, Hard and Hell in v44 (difficulty.js EASY_FROM_NORMAL,
// EASY_FIGURES, HARD_PLUS, PLUS_FIGURES, NORMAL_HOLDS, HELL_PLUS).
// The 32 flags the bot played became part of the levels in v45: in Normal calmSpots, calmMelody, copyMelody, copySure, drumRuns,
// drumRunsFit, fadeFalls, fastRuns, fillFloor, freeTime, heardChords, leadVoiceBoth, lightThin, lineRepeats, localThinSure,
// loudHoles, melodyKeep, melodyLines, melodyOnlyLong, melodyShiftPick, noNoise, noNoiseEdge, paceHoles, pitchLanes and softRuns
// (the Normal literal of difficulty.js; fadeFalls and melodyOnlyLong are FADE_OUT's `falls` and MELODY_ONLY's minRun 3, localThinSure
// LOCAL_THIN_SURE, leadVoiceBoth LEAD_VOICE_BOTH); in Easy easySameCuts (in EASY_FROM_NORMAL) and the two noise rules; in Hard
// calmSpots, calmMelody, hardHolds, heardChords, noNoise, noNoiseEdge, plusCalm, plusCalmEnd, plusHeard and plusMelody (HARD_PLUS);
// in Hell the same but for hardHolds, which hellHolds replaces (HELL_PLUS).
// melodyLinesFirst was dropped in the same version: the melody lines chosen before the foreground gave more of the melody (bot 18.2
// -> 21.9 points, corpus 10.8 -> 15.8) for notes people do not play (corpus F1 .807 -> .795, recall .864 -> .847, Easy .733 ->
// .718), and nobody heard a difference by ear. A melody moment winning single close calls in the foreground (melodyDuel) was tried
// and removed before: it cost the same F1 for half the melody.
const FLAGS = {};

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

// The marker of a chart made without a decoded melody (generate.js puts it after the version, the chart store after the flags
// in the file name): such charts are a different map, so they have their own scores and their own file. The chart made with a
// melody carries no marker, so its version and file name are what they were before. "nm" is not a flag name.
const NO_MELODY = "nm";
const noMelodyKey = (flagged) => (flagged ? `${flagged}-${NO_MELODY}` : NO_MELODY);

// A flags key as the name of a chart file holds it (chartStore.js): the key itself, or past MAX_FILE_KEY characters "flags-"
// and the first 16 hex digits of its SHA-1. The store writes a file under a temporary name some 60 characters longer, and
// no file name passes 255 characters: with fourteen flags on, the charts were made and never kept.
const MAX_FILE_KEY = 140;
const fileKey = (key) => (key.length > MAX_FILE_KEY ? `flags-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}` : key);

// diff itself when no enabled flag overrides this level, else a copy with the overrides applied in sorted flag order.
function withFlags(diff, levelName, flags) {
  let result = diff;
  for (const name of namesOf(flags)) {
    const overrides = FLAGS[name].levels?.[levelName];
    if (overrides) result = { ...result, ...overrides };
  }
  return result;
}

module.exports = { FLAGS, FLAGS_FILE_NAME, fileKey, flagsKey, noMelodyKey, normalFlags, withFlags };
