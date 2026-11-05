// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const FLAGS_FILE_NAME = "generator-flags.json";

const LOCAL_THIN = { reach: 6, power: 1, floor: 0.5, knee: 0.6 }; // localThin.js: the slower seconds inside a phrase

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
const FLAGS = {
  density: {
    label: "how many moments a phrase plays",
    levels: { easy: { localThin: LOCAL_THIN }, normal: { localThin: LOCAL_THIN }, hard: { localThin: LOCAL_THIN }, hell: { localThin: LOCAL_THIN } },
  },
  holds: { label: "where and how long the holds are", levels: {} },
  transitions: { label: "how one figure leads into the next", levels: {} },
  lead: { label: "which instrument carries the melody", levels: {} },
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
