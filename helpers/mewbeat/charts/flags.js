// Runtime switches for experimental generator changes. A flag is a named set of difficulty parameter overrides per
// level; with no flag on, every chart is what the generator makes without this module. The chart store reads the
// enabled flags from a file (chartStore.js), so a flag can be flipped while the bot runs, and each combination of
// flags has its own cached charts. Names must not contain "-": the enabled names are joined with it.

const crypto = require("node:crypto");

const {
  CALM_SPOTS,
  COPY_MELODY,
  COPY_SURE,
  DRUM_RUNS,
  LIGHT_THIN,
  DRUM_RUNS_FIT,
  EASY_SAME_CUTS,
  FADE_FALLS,
  FAST_RUNS,
  FILL_FLOOR,
  FREE_TIME,
  HARD_HOLDS,
  HEARD_CHORDS,
  HELL_HOLDS,
  LEAD_VOICE_BOTH,
  LINE_REPEATS,
  LOCAL_THIN_SURE,
  LOUD_HOLES,
  MELODY_KEEP,
  PACE_HOLES,
  MELODY_LINES,
  MELODY_LINES_FIRST,
  MELODY_ONLY_LONG,
  MELODY_SHIFT_PICK,
  NO_NOISE,
  NO_NOISE_EDGE,
  PITCH_LANES,
  PLUS_CALM,
  PLUS_CALM_END,
  PLUS_HEARD,
  PLUS_MELODY,
} = require("./difficulty");

const FLAGS_FILE_NAME = "generator-flags.json";

// name -> { label, levels: { <level name, public or internal>: { <difficulty parameter>: value } } }
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
const FLAGS = {
  // Normal, Hard, Hell: in a quiet part no bar plays well above the bars on both sides of it (spots.js evenSpots). Easy is
  // cut from Normal and follows it.
  calmSpots: { label: "Normal, Hard, Hell: w cichym fragmencie bez nagłych zagęszczeń (takt nie gra dużo gęściej niż takty przed nim i po nim)", levels: { normal: { calmSpots: CALM_SPOTS }, hard: { calmSpots: CALM_SPOTS }, hell: { calmSpots: CALM_SPOTS } } },
  // Normal, Hard, Hell: with calmSpots, the moments on a note of the decoded melody stay (generate.js finish).
  calmMelody: { label: "Normal, Hard, Hell: wygładzanie cichych fragmentów (calmSpots) nie zabiera nut melodii", levels: { normal: { calmMelody: true }, hard: { calmMelody: true }, hell: { calmMelody: true } } },
  // Normal: a repeat whose copy would miss the melody its source plays is charted fresh (generate.js copiedRepeat).
  copyMelody: { label: "Normal: powtórka bez kopii, gdy kopia gubi melodię", levels: { normal: { copyMelody: COPY_MELODY } } },
  // Normal: with copyMelody, a repeat that sounds almost exactly like its source is copied all the same (generate.js copiedRepeat).
  copySure: { label: "Normal: prawie identyczna powtórka zawsze jest kopią (copyMelody jej nie odrzuca)", levels: { normal: { copySure: COPY_SURE } } },
  // Normal: a drum roll, strong hits a quarter beat apart on the grid, gets a note on each hit on top of the stream (drumRuns.js).
  // Easy is cut from the Normal without them; Hard and Hell are built on the one with them.
  lightThin: { label: "Normal: mniej nut w lżejszym fragmencie muzyki między głośniejszymi (energia wyraźnie poniżej poziomu wokół)", levels: { normal: { lightThin: LIGHT_THIN } } },
  drumRuns: { label: "Normal: krótka seria nut, gdy perkusja gra szybkie uderzenia co ćwierć bitu (na siatce i mocne)", levels: { normal: { drumRuns: DRUM_RUNS } } },
  // Normal: with drumRuns, a roll in a slow song or a quiet place gets one or two notes, at its end, not the whole burst (generate.js
  // drumFitOf, drumRuns.js). A fast, loud place keeps the burst. Does nothing without drumRuns.
  drumRunsFit: { label: "Normal: seria nut na rolce perkusji dopasowana do utworu (wolny lub cichy fragment: jedna-dwie nuty na końcu rolki, szybki i głośny: cała seria)", levels: { normal: { drumRunsFit: DRUM_RUNS_FIT } } },
  // Easy: the bars Normal plays alike keep the same moments after the floors too (rhythm.js sameCuts).
  easySameCuts: { label: "Easy: te same cięcia w powtarzanych taktach po limitach", levels: { easy: { ...EASY_SAME_CUTS } } },
  // Normal: a quiet ending that plays on at one loudness is not a fade-out, and keeps its notes (fades.js fadeOutOf).
  fadeFalls: { label: "Normal: ciche zakończenie o równej głośności nie jest wyciszeniem (bez przerzedzania nut)", levels: { normal: { fadeOut: FADE_FALLS } } },
  // Normal: the bursts of melodyRuns also where a quarter beat is under 100 ms, gaps from 70 ms (generate.js finish).
  fastRuns: { label: "Normal: krótkie serie szybkiej melodii także w szybkich utworach (ćwierć bitu poniżej 100 ms, odstęp w serii od 70 ms)", levels: { normal: { fastRuns: FAST_RUNS } } },
  // Normal: a long stretch or a rest is not filled with a barely audible sound (selection.js selectMoments).
  fillFloor: { label: "Normal: dopełnienia nie biorą ledwo słyszalnych dźwięków (jedna długa nuta = jeden bloczek)", levels: { normal: { fillFloor: FILL_FLOOR } } },
  // Every level: a phrase the tracker found no steady beat in is charted off the grid, by the strength of its sounds (freeTime.js).
  freeTime: { label: "Wszystkie poziomy: fragment bez stałego tempa idzie za dźwiękiem, nie za siatką", levels: { normal: { freeTime: FREE_TIME } } },
  // Hard: its own holds on sustains and rests, let go with the sound (generate.js plusNotes). Hell, built on Hard, follows.
  hardHolds: { label: "Hard: własne holdy, puszczane z dźwiękiem", levels: { hard: { ...HARD_HOLDS } } },
  // Normal, Hard, Hell: where a pitched line leads, a moment plays no more notes than pitches begin on it (chords.js heardPitches).
  heardChords: { label: "Akordy tylko tam, gdzie gra kilka dźwięków naraz (linia pianina itp.)", levels: { normal: { heardChords: HEARD_CHORDS }, hard: { heardChords: HEARD_CHORDS }, hell: { heardChords: HEARD_CHORDS } } },
  // Hell: every hold of Hard stays a hold, let go with its sound, and no extra lands under it (generate.js plusNotes, holds.js keptHolds).
  hellHolds: { label: "Hell: trzyma holdy Harda", levels: { hell: { ...HELL_HOLDS } } },
  // Normal: in a song a piano or another pitched line carries, both hands play: the bass gives way only where it would take a
  // melody note's place (voices.js underLine, rule.clashMs), and Hard and Hell are built on this Normal.
  leadVoiceBoth: { label: "Normal: w utworze na pianino itp. grają obie ręce, bas ustępuje tylko tam, gdzie zabrałby miejsce nucie melodii", levels: { normal: { leadVoice: LEAD_VOICE_BOTH } } },
  // Normal: the melody's line takes the notes that repeat its tone, which the decoder left out (voices.js withLineRepeats).
  lineRepeats: { label: "Normal: powtarzana nuta melodii liczy się cała, nie co druga", levels: { normal: { lineRepeats: LINE_REPEATS } } },
  // Normal: localThin reads a second's strong onsets with a count of noise added, so it does not thin where that signal is too low to tell (localThin.js localKeep). Easy is cut from Normal and follows; Hard and Hell are built on it.
  localThinSure: { label: "Normal: zagęszczenie nut nie spada tam, gdzie sygnał (mocne uderzenia w górnym paśmie) jest zbyt niski, żeby coś powiedzieć", levels: { normal: { localThin: LOCAL_THIN_SURE } } },
  // Normal: a stretch a phrase left empty takes a loud sound in it, on top of its budget (selection.js selectMoments).
  loudHoles: { label: "Normal: dziura z głośnym dźwiękiem w środku dostaje nutę (ponad limit sekcji)", levels: { normal: { loudHoles: LOUD_HOLES } } },
  // Normal: a stretch longer than the notes round it run takes a moment of the foreground the budget left out (selection.js selectMoments).
  paceHoles: { label: "Normal: przerwa dłuższa niż tempo nut wokół niej dostaje nutę, jeśli gra tam coś wyraźnego", levels: { normal: { paceHoles: PACE_HOLES } } },
  // Normal: thinning a slower stretch, an energy dip or the fade-out leaves the notes of the decoded melody (generate.js melodyMoments).
  melodyKeep: { label: "Normal: przerzedzanie oszczędza nuty melodii", levels: { normal: { melodyKeep: MELODY_KEEP } } },
  // Normal: the decoder's good, loud lines of melody, thinned to the level's step, are played on top of what a phrase chose (melodyLines.js, selection.js).
  melodyLines: { label: "Normal: trzyma linie melodii (dobre linie z dekodera dogrywane do tego, co już wybrane; nic nie traci miejsca)", levels: { normal: { melodyLines: MELODY_LINES } } },
  // Normal: the same lines chosen before everything else; a line wins its place from a sound that is not clearly louder (selection.js).
  melodyLinesFirst: { label: "Normal: linie melodii wchodzą pierwsze (więcej melodii kosztem części głośnych nut)", levels: { normal: { melodyLines: MELODY_LINES_FIRST } } },
  // Normal: the short-note line plays alone (sustain.js keepMelodyOnly) only in a passage of 12 s or more, not for two bars of a drop.
  melodyOnlyLong: { label: "Normal: sama linia melodii nad długim tłem tylko w pasażu od 12 s (krótsze wstawki grają jak reszta sekcji)", levels: { normal: { melodyOnly: MELODY_ONLY_LONG } } },
  // Normal: the decoded melody is moved to where it meets the song's sounds best (generate.js pickedMelodyShift).
  melodyShiftPick: { label: "Normal: przesunięcie melodii dobierane do dźwięków utworu", levels: { normal: { melodyShiftPick: MELODY_SHIFT_PICK } } },
  // Every level: no notes where the sounds are no music, off the grid and without pitch (noise.js; generate.js playedNotes).
  noNoise: { label: "Wszystkie poziomy: bez nut na dźwiękach spoza muzyki (szum, mowa, efekty: poza siatką i bez wysokości dźwięku)", levels: { easy: { noNoise: NO_NOISE }, normal: { noNoise: NO_NOISE }, hard: { noNoise: NO_NOISE }, hell: { noNoise: NO_NOISE } } },
  // Every level, with noNoise: a noise stretch that opens the song reaches on to where the music begins, one that closes it back to where the music stopped (noise.js edgeStretches).
  noNoiseEdge: { label: "Wszystkie poziomy, z noNoise: szum na początku (końcu) utworu sięga do miejsca, gdzie zaczyna się (kończy) muzyka, także gdy dekoder słyszy w nim nuty", levels: { easy: { noNoiseEdge: NO_NOISE_EDGE }, normal: { noNoiseEdge: NO_NOISE_EDGE }, hard: { noNoiseEdge: NO_NOISE_EDGE }, hell: { noNoiseEdge: NO_NOISE_EDGE } } },
  // Normal: the lane moves the way the melody's pitch moves, by about as much (laneRules.js pitchCost). Lanes only: no note moves in time.
  pitchLanes: { label: "Normal: tor idzie za wysokością melodii (wyżej = w prawo)", levels: { normal: { pitchLanes: PITCH_LANES } } },
  // Hard, Hell: in a quiet stretch the extras number at most half of what the level below plays there (generate.js plusNotes, quiet.js).
  plusCalm: { label: "Hard, Hell: w cichym fragmencie dodatkowych nut najwyżej połowa tego, co gra poziom niżej", levels: { hard: { plusCalm: PLUS_CALM }, hell: { plusCalm: PLUS_CALM } } },
  // Hard, Hell: the quiet ending of a song takes no extras, the level plays the notes it was built on (generate.js plusNotes).
  plusCalmEnd: { label: "Hard, Hell: ciche zakończenie bez dodatkowych nut (gra to, co poziom niżej)", levels: { hard: { plusCalmEnd: PLUS_CALM_END }, hell: { plusCalmEnd: PLUS_CALM_END } } },
  // Hard, Hell: an extra on a note of the decoded melody scores more (generate.js plusNotes).
  // Hard, Hell: in a song a piano or another pitched line carries, no extra where no pitch begins (voices.js offPitch).
  plusHeard: { label: "Hard, Hell: w utworze na pianino itp. dodatkowe nuty tylko tam, gdzie zaczyna się dźwięk", levels: { hard: { plusHeard: PLUS_HEARD }, hell: { plusHeard: PLUS_HEARD } } },
  plusMelody: { label: "Hard, Hell: dodatkowe nuty chętniej na melodii", levels: { hard: { plusMelody: PLUS_MELODY }, hell: { plusMelody: PLUS_MELODY } } },
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
