// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const { FELT_TEMPO, FIGURES } = require("./difficulty");

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32, figures, phraseGrid and
// firstSound in v33 (difficulty.js, phrases.js onGrid), feltTempo in v34.
const FLAGS = {
  // Normal's figures (difficulty.js FIGURES) on quarter beats too, where people follow a figure far less often (27% of
  // these, about 5% of an unrepeated onset; 0% on the test songs). The level's least gap keeps them to songs under about
  // 150 BPM, most to the slow ones, which lack quarter beats the most.
  figuresQuarter: { label: "Figury także na ćwierćbeatach", levels: { normal: { figures: { ...FIGURES, quarters: { snare: 0.7, kick: 0.7, bass: 0.7 } } } } },
  // bridges.js: a rest of Normal where the music plays on keeps its best moment (a mini rest); one where the music holds
  // no moment that strong stays empty (a full rest).
  miniRests: { label: "Mini pauzy łączą sekcje", levels: { normal: { restBridge: { minBeats: 1.5, playing: 0.25, score: 0, edgeBeats: 0.5 } } } },
  // chords.js: a moment of Normal after 2 beats of nothing in quiet music plays one note, no chord; with quietLoneHold
  // (applied after quietLone, the names are sorted) that note holds until half a beat before the next moment.
  quietLone: { label: "Samotna nuta w ciszy bez akordu", levels: { normal: { quietLone: { gapBeats: 2, below: 0.25 } } } },
  // selection.js soloLeadRates, chords.js: a quiet phrase after the song's first loud one, drums hardly there and the lead
  // sure of itself (a piano alone), keeps this share of its lead line in its budget and plays one note at a time.
  soloLead: { label: "Ciche solo melodii pojedynczymi nutami", levels: { normal: { soloLead: { drumsBelow: 0.3, leadFrom: 0.8, share: 0.6 } } } },
  // selection.js meterTimingOf: a slow song read at twice its tempo keeps the song's own tolerance in ms for a place in the
  // beat, so a sound 18-37 ms off the grid still counts as on it (ASGORE 1:47.73, a piano slowing down).
  feltTolerance: { label: "Wolne utwory: ta sama tolerancja rytmu", levels: { normal: { feltTempo: { ...FELT_TEMPO, keepTolerance: true } } } },
  quietLoneHold: { label: "Samotna nuta w ciszy jako hold", levels: { normal: { quietLone: { gapBeats: 2, below: 0.25, hold: { minBeats: 1, releaseBeats: 0.5 } } } } },
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
