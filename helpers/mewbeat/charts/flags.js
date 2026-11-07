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
// sustainHolds and sustainPads in v41 (difficulty.js SUSTAIN_HOLDS).
// figuresQuarter was dropped (0% of its notes hit on the test songs).
const MELODY_ONLY = { windowMs: 4000, lowBelow: 52, longMs: 1000, minVel: 0.3, cover: 0.4, loudAbove: 0.7, shortMs: 600, sameMs: 60, linePerSec: 1.5, chordShare: 0.25, minRun: 2, snapMs: 80, notLedBy: "drums" };

const FLAGS = {
  // Normal's melody (generate.js decodedMelodyOf) is shifted to the onsets of all our layers, not to the same-pitch notes of
  // the lead line, which are few on some songs: the export's two shifts differ by 20-90 ms on 17 of the 38 decoded songs
  // (Rude Buster, Camellia remix: the line sat 30 ms early on the grid). Bot songs only; the train songs have no melody.
  melodyOnsetShift: { label: "Melodia wyrównana do onsetów", levels: { normal: { melodyOnsetShift: true } } },
  // Normal drops what only the drums layer's "kicks" gave it where no cymbals or hats play (drumless.js): REVOLVANIA's
  // opening brass read as kicks. Train Normal F1 .8005 -> .8007, 11 songs changed, the dropped moments people's 14%.
  drumless: { label: "Bez perkusji tylko linie melodyczne", levels: { normal: { drumless: { windowMs: 2000, highBelow: 1, highmidBelow: 4 } } } },
  // Normal's phrase budget follows the felt pace, not the beats (selection.js phraseBudget): people's density hardly moves
  // with the tempo, Normal's rose with it (train, loud parts: under 170 BPM people 4.75 / Normal 4.51, over 190 BPM 4.98 /
  // 5.68). Train F1 .8005 -> .8018; over 190 BPM 4.82 -> 4.63 moments a second (people 4.35), 145-170 4.16 -> 4.23 (4.34).
  tempoBudget: { label: "Gęstość od tempa", levels: { normal: { tempoBudget: { refBpm: 175, power: 0.5 } } } },
  // Normal reads songs under 145 BPM, not 115, on half beats (selection.js meterTimingOf), so their sixteenths are in
  // reach. Train 115-145 BPM: quarter-beat gaps 1.3 -> 27% (people 20%), 3.65 -> 4.09 moments a second (4.32), but F1
  // .8005 -> .7970: the ear decides.
  feltTempoUp: { label: "Szesnastki do 145 BPM", levels: { normal: { feltTempo: { belowBpm: 145, keepTolerance: true } } } },
  // Normal plays the decoder's short-note line alone where it runs over a held bed in a loud passage of 8 s or more
  // (sustain.js keepMelodyOnly): REVOLVANIA 0:20-0:42, the MEGALOVANIA motif on a low synth, by ear. The line comes from the
  // decoder's low-threshold run where the melody file has one (60 of the motif's 77 notes in 0:20-0:40, the first run 38).
  // A rule, no song named: it fires on 5 of 36 bot songs (REVOLVANIA 0:20-0:40, GHOST 4:24-4:32, MEGALOVANIA Camellia 4:36-4:44, Live My Life
  // 0:32-0:40, FIRESTARTER 2:04-2:12) and on 1 of 78 train songs, too few to say what people play there: the ear decides.
  melodyOnly: {
    label: "Sama melodia nad długim basem",
    levels: { normal: { melodyOnly: MELODY_ONLY } },
  },
  // Normal drops the moments in an energy dip where the upper bands go quiet for a second or more (dips.js silentUpper):
  // REVOLVANIA 0:41.5-0:43, a low rumble after the bass drum that the low band hears on every beat, by ear.
  dipSilence: { label: "Cisza w spadku energii", levels: { normal: { dipSilence: { drop: 0.7, level: 0.3, gapMs: 1000, maxGapMs: 4000, bands: ["highmid", "high"] } } } },
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
