// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
// density, holds, transitions and lead were played and became part of the levels in v32, figures, phraseGrid and
// firstSound in v33 (difficulty.js, phrases.js onGrid), feltTempo in v34, quietLoneHold, soloLead and feltTolerance in v35,
// miniRests in v36, copyStrictHard (difficulty.js COPY_FROM) in v37, copyStrict, fadeOut and stairs in v38. figuresQuarter
// was dropped (0% of its notes hit on the test songs).
const FLAGS = {
  // Normal's chord rate scales with how loud the music is (chords.js loudnessScale): bars were ranked against the
  // song only, so a near-silent opening chorded like its middle. Train, chords by energy 0.1-0.2 / -0.3 / -0.45 / -0.6 /
  // louder: people 6 / 7 / 15 / 19 / 33%, v38 23 / 31 / 35 / 30 / 27%, the flag 8 / 8 / 15 / 21 / 29%. F1 unchanged.
  chordLoudness: { label: "Akordy za głośnością", levels: { normal: { chordLoudness: [[0.2, 0.1], [0.3, 0.12], [0.45, 0.35], [0.6, 0.6], [0.75, 1.4]] } } },
  // Normal's lanes trill on two keys where the lead (or the bass) alternates two pitches fast (laneRules alternateSteps):
  // the user's wish, not the corpus. People trill only 7% of such notes on Normal, and the lines show them in 4 of the
  // 80 train songs (half a beat or faster), so it fires rarely: the detector hears no pitch in most of a fast melody.
  // Normal's lanes follow a melody from a second detector (Basic Pitch's foreground line, decoded offline into
  // helpers/data/mewbeat/melody/<audio key>.json) instead of the lead line; the moments still come from the lead.
  // Train: a melody direction on 74% of single notes (lead 65%), stairs 1.9% (0.4%), lanes as close to people's.
  decoderLanes: { label: "Melodia z drugiego detektora (tory)", levels: { normal: { melodyLine: true } } },
  twoKeyTrill: { label: "Tryl na naprzemiennych nutach", levels: { normal: { twoKeyTrill: { minNotes: 4, maxGapBeats: 0.6, weight: 3 } } } },
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
