// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const FLAGS_FILE_NAME = "generator-flags.json";

// What the drums and bass keep repeating, for Normal (figures.js, selection.js): the least share of the same places a bar or two
// away where the layer sounds too, on beats and half beats. On the train songs people have a note on 66% of the moments this
// adds, on 55% of the few it costs, and on a third of an unrepeated onset at the same place. A phrase whose lead plays fewer
// than weakLead notes a beat may go extra over its budget for them; none of it drops a note of the foreground.
const FIGURES = { layers: { snare: 0.7, kick: 0.7, bass: 0.7, low: 0.85 }, restBeats: 0.45, weakLead: 0.5, extra: 0.2 };

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32 (difficulty.js).
const FLAGS = {
  figures: { label: "Figury perkusji i basu", levels: { normal: { figures: FIGURES } } },
  // The same with quarter beats, where people follow a figure far less often (27% of these, about 5% of an unrepeated onset).
  // The level's least gap keeps them to songs under about 150 BPM, most to the slow ones, which lack quarter beats the most.
  figuresQuarter: { label: "Figury także na ćwierćbeatach", levels: { normal: { figures: { ...FIGURES, quarters: { snare: 0.7, kick: 0.7, bass: 0.7 } } } } },
  // phrases.js onGrid: the phrase bounds move onto the grid the moments sit on. They came a few ms off it (58731 against a
  // moment at 58730), so the moment on a phrase's first beat fell to the phrase before; a repeat left it out and the drop
  // came in a beat late (Cutie Mew Mew Magic 0:53, Hopes And Dreams 1:35). It changes the analysis, so every level.
  phraseGrid: { label: "Granice fraz na siatce", analysis: { phraseGrid: true }, levels: {} },
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

// The switches the enabled flags set on the shared analysis (generate.js analyse), for a flag no difficulty parameter can carry.
const analysisOf = (flags) => Object.assign({}, ...namesOf(flags).map((name) => FLAGS[name].analysis ?? {}));

module.exports = { FLAGS, FLAGS_FILE_NAME, analysisOf, flagsKey, normalFlags, withFlags };
