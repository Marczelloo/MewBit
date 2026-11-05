// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const FLAGS_FILE_NAME = "generator-flags.json";

const LOCAL_THIN = { reach: 6, power: 1, floor: 0.5, knee: 0.6 }; // localThin.js: the slower seconds inside a phrase
// calm.js: the holds follow the calm stretches. gapShare and maxShare stand in for gapHoldShare and maxHoldShare.
const holdsByCalm = (gapShare, maxShare) => ({ quietBelow: 0.25, loudAbove: 0.6, quietEnergy: 0.15, gapShare, maxShare });

// laneSearch.js: the lanes come from a search over the whole song. Hard stays closer to the figures it already plays.
const LANE_SEARCH = { beam: 8, tau: 1, handPull: 3, lanePull: 2, melody: 0, echoBeta: 6, echoNone: 3, echoMirror: 0, restrike: 1.5, overChord: 1.5, oneHand: 0.75 };
const HARD_LANE_SEARCH = { ...LANE_SEARCH, tau: 0.6, handPull: 1, lanePull: 1, restrike: 0, overChord: 0, oneHand: 0 };
// chords.js: the chords of Normal move out of the fast runs. Only Normal plays them differently from people there.
const CHORD_FLOW = { fastBeats: 0.62, nearBeats: 1.25, betweenFast: 0.45, withRoom: 3, holdIntoRun: 0.15, besideChord: 1.6 };

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
const FLAGS = {
  density: {
    label: "how many moments a phrase plays",
    levels: { easy: { localThin: LOCAL_THIN }, normal: { localThin: LOCAL_THIN }, hard: { localThin: LOCAL_THIN }, hell: { localThin: LOCAL_THIN } },
  },
  holds: {
    label: "where and how long the holds are",
    levels: {
      easy: { holdsByCalm: holdsByCalm({ loud: 0.15, quiet: 0.32 }, { loud: 0.2, quiet: 0.42 }) },
      normal: { holdsByCalm: holdsByCalm({ loud: 0.22, quiet: 0.42 }, { loud: 0.2, quiet: 0.5 }) },
      hard: { holdsByCalm: holdsByCalm({ loud: 0.1, quiet: 0.2 }, { loud: 0.12, quiet: 0.3 }), shortestHoldMaxMs: 225 },
      hell: { holdsByCalm: holdsByCalm({ loud: 0.07, quiet: 0.2 }, { loud: 0.12, quiet: 0.3 }), shortestHoldMaxMs: 225 },
    },
  },
  transitions: {
    label: "how one figure leads into the next",
    levels: {
      easy: { laneSearch: LANE_SEARCH },
      normalV26: { laneSearch: LANE_SEARCH },
      normal: { laneSearch: { ...LANE_SEARCH, melody: 0.15, oneHand: 1.25, echoBeta: 10, echoNone: 5, echoMirror: null }, chordFlow: CHORD_FLOW },
      hard: { laneSearch: HARD_LANE_SEARCH },
      hell: { laneSearch: HARD_LANE_SEARCH },
    },
  },
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
