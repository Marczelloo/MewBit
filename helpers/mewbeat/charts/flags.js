// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const { COPY_FROM, FIGURES } = require("./difficulty");

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32, figures, phraseGrid and
// firstSound in v33 (difficulty.js, phrases.js onGrid), feltTempo in v34, quietLoneHold, soloLead and feltTolerance in v35,
// miniRests in v36, copyStrictHard (difficulty.js COPY_FROM) in v37.
const FLAGS = {
  // Normal's lanes climb or come down a lane a note where the lead (or bass) line goes up or down over at least three
  // single notes (laneRules.js stairSteps, laneSearch.js). Asked for by ear: people follow such a run no more than chance
  // does (40-50% of the steps go the melody's way on the train songs, random lanes 42%).
  stairs: { label: "Schodki za melodią", levels: { normal: { stairs: { minNotes: 3, maxGapBeats: 1, weight: 3 } } } },
  // Normal's fade-out at the end of a song (fades.js), from where it falls under `from`: every bar keeps half its moments,
  // the ones on the beat first, and a lone tap with room is held. People play half as many notes a second there as v36
  // (1.27 against 2.48; the flag 1.60). Bad Piggies by eye: thinned over the whole fade-out at once, its slow, still busy
  // start lost most of its notes.
  fadeOut: {
    label: "Spokojniejszy fade-out (rzadziej, holdy)",
    levels: { normal: { fadeOut: { loud: 0.6, from: 0.5, quiet: 0.35, minSec: 4, keep: 0.5, barBeats: 4, hold: { minBeats: 1, releaseBeats: 0.5, lastBeats: 2 } } } },
  },
  // A repeat phrase of Normal copies its source's notes only when it is at least this similar (generate.js
  // copiedRepeat; phrases.js REPEAT_SIMILARITY is 0.85), else it is charted from its own music. Where we copy, people
  // often play other notes: train F1 Normal 0.7985 -> 0.8016, Hard 0.7678 -> 0.7712 (0.9: .8007, .7706; never: .8018, .7717).
  copyStrict: { label: "Kopia powtórzeń tylko przy bardzo podobnych frazach (Normal)", levels: { normal: { copyFrom: COPY_FROM } } },
  // Normal's figures (difficulty.js FIGURES) on quarter beats too, where people follow a figure far less often (27% of
  // these, about 5% of an unrepeated onset; 0% on the test songs). The level's least gap keeps them to songs under about
  // 150 BPM, most to the slow ones, which lack quarter beats the most.
  figuresQuarter: { label: "Figury także na ćwierćbeatach", levels: { normal: { figures: { ...FIGURES, quarters: { snare: 0.7, kick: 0.7, bass: 0.7 } } } } },
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
