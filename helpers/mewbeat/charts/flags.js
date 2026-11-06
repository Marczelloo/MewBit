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
  // Normal's choice of moments leans on the same melody (melodyPick.js): a moment where it hears a melody note begin
  // scores 1.25 more. Train (78 songs): F1 .8018 -> .8037, moments on a melody start 27.1 -> 29.8% (people 29.9%), the
  // loudest fifth of moments kept as often (79.2 / 79.1%), loud 2-beat holes 278 -> 284 (people 325). A floor on how
  // loud the moment must be (minStrength) only cost F1. Other levels unchanged. No test control: no audio to decode.
  // decoderLanes and decoderPick on a tuned line of the same decoder (scripts/mewbeat-melody/line.js, base .2 and jump .5
  // against .62 and .05): train, notes 1.9 -> 2.3/s, steps of up to 5 semitones 65 -> 81%, octave leaps 15 -> 6%. People's
  // maps do not tell melody from backing (they play both as often), so the shape of a melody was the target. With
  // decoderPick, train Normal: F1 .8036 (.8037 on the old line), moments on the melody 36.6% (people 37.0%), loud holes 269
  // (278 without the flags). Changes nothing without decoderLanes or decoderPick, or where no tuned line was decoded.
  melodyTuned: { label: "Dostrojona linia melodii (dekoder)", levels: { normal: { melodyTuned: true } } },
  decoderPick: { label: "Melodia z drugiego detektora (wybór nut)", levels: { normal: { melodyPick: { bonus: 1.25, minStrength: 0 } } } },
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
