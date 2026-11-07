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
// dipSilence in v42 (difficulty.js DRUMLESS, MELODY_ONLY, DIP_SILENCE, FELT_TEMPO).
// figuresQuarter was dropped (0% of its notes hit on the test songs).

const FLAGS = {
  // Sung phrases of Normal follow the music, not the voice (musicFirst.js). Train: Normal F1 .7984 -> .7955 (P 77.8, R 82.0 -> 81.3); Easy, Hard and Hell unchanged; thresholds kept from the first try (a sweep of narrower/wider windows and weights only moved F1 within .004).
  musicFirst: { label: "Muzyka przed śpiewem", levels: { normal: { musicFirst: { minConf: 0.7, minRate: 0.6, minActivity: 0.12, musicBonus: 0.75, voicePenalty: 0.75, holdConf: 0.7, minBeats: 1, headMs: 100, maxBeats: 4 } } } },
  // Normal's phrase budget follows the felt pace, not the beats (selection.js phraseBudget): people's density hardly moves
  // with the tempo, Normal's rose with it (train, loud parts: under 170 BPM people 4.75 / Normal 4.51, over 190 BPM 4.98 /
  // 5.68). Train F1 .8005 -> .8018; over 190 BPM 4.82 -> 4.63 moments a second (people 4.35), 145-170 4.16 -> 4.23 (4.34).
  tempoBudget: { label: "Gęstość od tempa", levels: { normal: { tempoBudget: { refBpm: 175, power: 0.5 } } } },
  // Slow songs (agents/slow): people play more chords the slower the song, Normal's rates do not follow (chords.js slowChords).
  // Train, chord against tap at the moments both play: under 115 BPM 68.1% -> 72.9% agree (chords 16% -> 33%, people 42%), 115-145 BPM
  // 63.2% -> 66.8% (22% -> 30%, people 44%); over 145 BPM unchanged.
  chordSlow: { label: "Akordy na wolnych piosenkach", levels: { normal: { chordSlow: { refBpm: 145, power: 3, max: 3.5, maxShare: 0.5 } } } },
  // The shortest hold of Normal is a beat, 460 ms at 130 BPM and 600 ms at 100; people's median on those songs is half a beat
  // (holds.js slowHolds). The shortest hold is at most 300 ms.
  holdSlow: { label: "Krótsze holdy na wolnych piosenkach", levels: { normal: { holdSlow: { belowBpm: 145, minMs: 300 } } } },
  // Quiet parts of slow songs get more notes against the loud ones (selection.js phraseBudget): people play 3.26 moments a second in the
  // quiet ones and 4.68 in the loud, Normal 2.00 and 4.79.
  slowDynamics: { label: "Mniejsze różnice głośności na wolnych", levels: { normal: { slowDynamics: { belowBpm: 145, delta: 1 } } } },
  // A fast song loud all through reads its loudness against a typical song's, not its own mean (selection.js budgetModelOf):
  // Coffin Dance (Camellia Remix) played 5.0-5.6 moments a second in its loud parts, GHOST 6.3-6.8, over music as busy. Set
  // by ear, not by people: on the train songs people play their loud phrases at about 4.8 a second however loud the song.
  flatLoud: { label: "Gęściej w szybkich, cały czas głośnych", levels: { normal: { flatLoud: { fromBpm: 145, ref: 0.7 } } } },
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
