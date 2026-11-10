// Bumped on every change that alters generated charts (tuning included);
// charts and leaderboards are keyed by it.
const GENERATOR_VERSION = 44;

// --- Shared tuning constants (Task 9 tunes these by ear) -------------------

const BANDS = ["low", "lowmid", "highmid", "high"]; // band index === base lane

const MERGE_WINDOW_MS = 30; // onsets this close across bands are one candidate
const LEAD_IN_MS = 0; // no notes before this; the Activity adds silence before the song, so the first sound can be played
const SILENCE_ENERGY = 0.08; // no notes where the energy curve is below this
const MIN_NOTES = 20; // fewer notes than this means "not chartable"

const DENSITY_WINDOW_MS = 2000; // candidates are thinned per window of this size
// Target notes/s = maxNps * busy * energy^ENERGY_EXPONENT. Below 1.5 so a mid-energy passage (a drum section
// at half the song's peak) is not charted as if it were nearly silent. phrases.js scores layers by it too.
const ENERGY_EXPONENT = 1.0;

// Busyness: the energy curve is normalised per song, so without this every
// song's loud parts get the same density. A song's strong-onset rate scales the
// density cap instead (see busyness.js), within an absolute per-difficulty ceiling.
const BUSY_ONSET_STRENGTH = 0.5; // an onset at/above this strength counts towards busyness
const BUSY_MEDIAN_RATE = 14; // strong onsets per second of non-silent audio of a typical song (busy factor 1)
const BUSY_MIN_FACTOR = 0.8; // the calmest song gets 80 % of the difficulty's maxNps
const BUSY_MAX_FACTOR = 1.6; // the busiest gets 160 % (until the difficulty's ceiling)

const CONFIDENT_TEMPO = 0.5; // snap to the beat grid at/above this confidence
const FALLBACK_BEAT_MS = 500; // 120 BPM, used for gaps when tempo is not trusted
const BEAT_TOLERANCE_MS = 35; // a note this close to a beat counts as "on" it
const GAP_TOLERANCE_MS = 1; // rounding slack on the same-lane gap check
const MAX_SNAP_DISTANCE_MS = 35; // an onset further than this from the grid stays at its raw time (inside the perfect window)
const BEAT_INTERVAL_TOLERANCE = 0.25; // local beat length must be within +-25% of the median
const SNAPPED_FLOOR_SLACK = 0.98; // snapped notes may sit this much under the tempo-relative gap floor

const LOCAL_THIN = { reach: 6, power: 1, floor: 0.5, knee: 0.6 }; // localThin.js: the slower seconds inside a phrase
// calm.js: the holds follow the calm stretches. gapShare and maxShare stand in for gapHoldShare and maxHoldShare.
const holdsByCalm = (gapShare, maxShare) => ({ quietBelow: 0.25, loudAbove: 0.6, quietEnergy: 0.15, gapShare, maxShare });
// laneSearch.js: the lanes come from a search over the whole song. Hard stays closer to the figures it already plays.
const LANE_SEARCH = { beam: 8, tau: 1, handPull: 3, lanePull: 2, melody: 0, echoBeta: 6, echoNone: 3, echoMirror: 0, restrike: 1.5, overChord: 1.5, oneHand: 0.75 };
const HARD_LANE_SEARCH = { ...LANE_SEARCH, tau: 0.6, handPull: 1, lanePull: 1, restrike: 0, overChord: 0, oneHand: 0 };
// chords.js: the chords of Normal move out of the fast runs. Only Normal plays them differently from people there.
const CHORD_FLOW = { fastBeats: 0.62, nearBeats: 1.25, betweenFast: 0.45, withRoom: 3, holdIntoRun: 0.15, besideChord: 1.6 };
// figures.js, selection.js: what the drums and bass keep repeating, for Normal: the least share of the same places a bar or
// two away where the layer sounds too, on beats and half beats. On the train songs people have a note on 66% of the
// moments this adds, on 55% of the few it costs, and on a third of an unrepeated onset at the same place. A phrase whose
// lead plays fewer than weakLead notes a beat may go extra over its budget for them; none of it drops a note of the foreground.
const FIGURES = { layers: { snare: 0.7, kick: 0.7, bass: 0.7, low: 0.85 }, restBeats: 0.45, weakLead: 0.5, extra: 0.2 };
// sections.js openWithFirstSound: the song opens on its first very strong sound, on the beat beside it (Hopes And Dreams
// 0:00.139). Asked for by ear: where v32 missed such a sound people play it about a third of the time.
const FIRST_SOUND = { strong: 0.8, nearBeats: 1 / 8 };
// selection.js meterTimingOf: Normal reads a song under belowBpm at twice its tempo, so its quarter beats count as half
// beats. People's Normal plays about 4.3 notes a second at any tempo, a third of them on quarter beats under 115 BPM. A
// place in the beat keeps the song's own tolerance in ms (keepTolerance), so a piano slowing down a little off the grid
// stays on the beat (ASGORE 1:47.7). Under 145 BPM, not 115, from v42 (flag feltTempoUp, played): train 115-145 BPM
// quarter-beat gaps 1.3 -> 27% (people 20%), 3.65 -> 4.09 moments a second (4.32), F1 .8005 -> .7970, test .8310 -> .8248.
const FELT_TEMPO = { belowBpm: 145, keepTolerance: true };
// generate.js copiedRepeat: a repeat phrase copies its source's notes only when at least this similar (phrases.js counts
// one from 0.85); else it is charted from its own music, where people often play other notes. Hard, from v37 (train F1
// 0.7678 -> 0.7712); Easy, cut from v26's Normal and so from Hard, moved 0.7166 -> 0.7167 on train, 0.7576 -> 0.7554 on test.
const COPY_FROM = 0.95;
// laneRules.js stairSteps, laneSearch.js: Normal's lanes climb or come down a lane a note where the lead (or bass) line goes
// up or down over at least minNotes single notes, each within maxGapBeats. Asked for by ear (v38): people follow such a
// run no more than chance does (40-50% of the steps go the melody's way on the train songs, random lanes 42%).
const STAIRS = { minNotes: 3, maxGapBeats: 1, weight: 3 };
// melodyPick.js, generate.js: Normal's lanes follow a melody from a second detector (Basic Pitch, decoded offline into
// helpers/data/mewbeat/melody/<audio key>.json, its tuned line from scripts/mewbeat-melody/line.js), and a moment where it
// hears a melody note begin scores `bonus` more. Played and approved in v39 (H&D "o wiele lepiej"). Train Normal: F1
// .8018 -> .8036, moments on the melody 27.1 -> 36.6% (people 37.0%), a melody direction on 74% of single notes (65%).
// A song with no melody file is charted as before.
const MELODY_PICK = { bonus: 1.25, minStrength: 0 };
// generate.js melodyMoments (flag melodyKeep): the moments on a note of the decoded melody are the last a slower stretch
// gives up (localThin.js), stay through an energy dip (dips.js thinDips) and come right after the held ones in the fade-out
// (fades.js thinFadeOut). The bot's songs: the melody's notes lost to those three stages 5.3 -> 1.0% (dips 2.1 -> 0), Normal
// plays 61.9 -> 66.1% of the melody, 12.8 -> 15.8 points over the same melody moved in time, with 0.9% more moments. The 80
// corpus songs: F1 against people .805 -> .807 on Normal (recall .858 -> .863), .736 -> .734 on Easy.
const MELODY_KEEP = true;
// generate.js pickedMelodyShift (flag melodyShiftPick): the decoded melody is moved to where the most of its notes meet a sound
// Normal scores, looked for within reachMs of the file's times in steps of stepMs; a note meets a sound within matchMs. The
// shift of the melody file stays unless another one matches `margin` more of the notes.
const MELODY_SHIFT_PICK = { reachMs: 60, stepMs: 2, matchMs: 25, margin: 0.03 };
// generate.js plusNotes (flag plusMelody): Hard and Hell, built on Normal, choose their extras by the sound alone; with this
// an extra where the decoded melody begins a note scores `bonus` more, as a moment of Normal does (MELODY_PICK). On the 80
// corpus songs Hard's moments on the melody, over a shifted control, went 6.5 -> 10.4 points with 7.7% of its moments moved and
// F1 against people .813 -> .812; at bonus 2 F1 fell to .810.
const PLUS_MELODY = { bonus: 1.25, minStrength: 0 };
// generate.js copiedRepeat (flag copyMelody): a repeat with at least `min` moments on the decoded melody is charted fresh
// when its copy plays (within `nearMs`) under `share` of the melody's share its source plays: the phrase repeats, the
// melody over it does not. The bot's songs: the melody's notes lost to a copy 6.2 -> 3.7% at share .75, Normal 12.8 -> 13.9
// points over the same melody moved in time at .9 (13.6 at .75, 14.0 at 1) with as many moments; the 80 corpus songs: F1
// against people .805 -> .806 on Normal, .736 -> .735 on Easy at each of the three. At 1 a third more moments change for .1.
const COPY_MELODY = { min: 4, share: 0.9, nearMs: 30 };
// chords.js heardPitches (flag heardChords): in a phrase where at least `pitched` of the moments (and `minMoments` of them) have
// a decoded pitch begin within `nearMs`, a moment plays no more notes than pitches begin on it. The decoder's notes are read at
// the shift generate.js pickedMelodyShift finds with `shift`. Chords on a moment with one pitch: Finale Normal 20.8 -> 2.0%,
// Hard 44.6 -> 3.7%, Rush E Hard 32.2 -> 11.7% (the rest open a phrase or sit where drums lead), triples on one or two
// pitches near none. The 80 corpus songs: Normal's chords 26.3 -> 24.6% of its moments, F1 against people the same on every
// level (.805 Normal, .813 Hard). Easy, cut from Normal, keeps other moments where Normal's chords went (Finale).
const HEARD_CHORDS = { nearMs: 60, pitched: 0.8, minMoments: 6, shift: MELODY_SHIFT_PICK };
// chords.js loudnessScale: Normal's chord rate scales with how loud the music is ([energy, factor] steps); bars were
// ranked against the song only, so a near-silent opening chorded like its middle. Train, chords by energy 0.1-0.2 / -0.3 /
// -0.45 / -0.6 / louder: people 6 / 7 / 15 / 19 / 33%, v38 23 / 31 / 35 / 30 / 27%, this 8 / 8 / 15 / 21 / 29%. F1
// unchanged. Played and approved in v40, with the three below.
const CHORD_LOUDNESS = [[0.2, 0.1], [0.3, 0.12], [0.45, 0.35], [0.6, 0.6], [0.75, 1.4]];
// laneRules alternateSteps: Normal's lanes trill on two keys where the lead (or the bass) alternates two pitches fast. The
// user's wish, not the corpus: people trill only 7% of such notes on Normal, and it fires in 4 of the 80 train songs.
const TWO_KEY_TRILL = { minNotes: 4, maxGapBeats: 0.6, weight: 3 };
// melodyPick.js withRunNotes: a short burst of notes on top of Normal's stream where the decoded melody runs fast; asked
// for by ear, as Normal hardly sped up with the music (train speed-ups per minute: people 26, Normal 17). Train F1 .8035
// -> .8041.
const MELODY_RUNS = { fastMs: 200, streamBeats: 1.1, minGapMs: 100, maxRun: 3 };
// generate.js finish (generator flag fastRuns, Normal only, with melodyRuns): over about 150 BPM a quarter beat is under the
// 100 ms of MELODY_RUNS.minGapMs and of Normal's minNoteGapMs (Rush E 93 ms, Finale 79 ms; 36 of 75 songs), so the bursts of
// melodyRuns could never appear there: withRunNotes asks `minGapMs` of its notes instead, and spacedMoments and the final
// floors let a gap that short stand next to a note of a burst. Any other two notes of Normal keep 100 ms. Asked for by ear
// (Rush E: "no grouping of notes in the faster runs"; its Normal goes from 511 to 615 moments, the melody's notes played from
// 49% to 62%). People's Normal does not play these: corpus F1 .805 -> .791, precision .772 -> .743, moments +4.5%.
// A sound of the melody dropped for being 35-60 ms off the grid was tried too (melodySnap) and removed: it changed 0.2-0.4%
// of the moments and no measure.
const FAST_RUNS = { minGapMs: 70 };
// selection.js selectMoments (generator flag loudHoles, Normal only): a stretch of `beats` (and `minMs`) or more between two
// notes that a phrase left empty takes the best moment in it whose strength is of rank `minLoud` or more in the song, on top
// of the budget, up to `room` of it (rounded up). Asked for by ear (Rush E with the melody flags: "gaps although notes are
// playing"): there the sounds in a hole were loud ones under the foreground (a quarter beat scores low) in a phrase whose
// budget was spent, with no weaker note for the long stretches to swap out. Rush E, holes of a beat or more with 2+ decoded
// notes inside and no hold over them: 14 (11.7 s) -> 8 (4.4 s), 538 -> 550 moments; what is left has no snapped moment or
// lies inside the gap of a chosen note. Over the bot's 74 songs such holes (1.5 beats, 500 ms) are rare with or without it:
// 2.2 -> 2.0 a song, fewer than a chart moved two beats has (3.4). On top of the melody flags and melodyLines: corpus F1
// .807 -> .807, precision .766 -> .765, recall .868 -> .870, moments +0.4% (bot +0.9%); minLoud .33, 2 beats and room .5
// give the same within .001. Before the first note and after the last nothing is filled: a first version did, and put a
// lone note nine seconds into the Camellia remix's fade-out.
const LOUD_HOLES = { beats: 1.5, minMs: 500, minLoud: 0.5, room: 0.25 };
// laneRules.js pitchTrack, pitchCost, recallLane, laneSearch.js (generator flag pitchLanes, Normal only): where consecutive
// single moments sit on lead (or decoded melody) notes the lane moves the way the pitch moves, higher = right. A pitch step
// asks for one lane (a step of the scale), two from `twoLanes` semitones, three from `threeLanes` (and a beat for the leap);
// near an edge it takes what room is left, at the edge it starts over like melodyPull. A repeated pitch keeps its lane when
// slow enough for a jack, else goes back to the lane it had `recallMoments` moments back. Costs are nats: `offTarget` per lane
// away from the lane asked for, `wrongSide` for a lane against the pitch (or the same one), `recall` for missing the lane
// a repeated pitch goes back to; `weight` scales all three; `maxGapBeats` is the longest gap a pair counts across. `room`
// (nats per lane short) looks ahead: a lane that leaves less room than the climb or fall coming in the next `lookMoments`
// moments (each within `lookBeats`) costs that much, so a rise starts left of the right edge instead of hitting it and
// turning back against the pitch (that was most of the 28% opposed pairs at weight 3 without it: Rush E 59 -> 66 of 82
// pairs with it, MEGALOVANIA 121 -> 145 of 212). People follow the pitch no more than chance does (47% with it, 41%
// against), so this is the user's wish, not the corpus.
const PITCH_LANES = { weight: 3, maxGapBeats: 2, twoLanes: 4, threeLanes: 8, offTarget: 0.8, wrongSide: 2.5, recall: 2, recallMoments: 4, room: 2, lookMoments: 4, lookBeats: 1 };
// laneRules.js runCost, runStartCost (generator flag runLanes, Normal only): a fast run (at least minNotes single notes on
// the melody, each within maxGapBeats of the last and a semitone or more above or below it) is laid as one staircase, a lane a
// note the way the pitch goes, and at the edge wraps to the far end (a roll, 1234 1234) instead of turning back against the
// pitch. A lane on the right side that is not the neighbour costs `nearMiss`, any other `miss`, times `weight`; the first note
// pays `startRoom` for each step of the staircase (up to three) its lane has no room for. It stands in for stairs and the
// weak melody term on the notes it covers. At weight 3 it lost to pitchLanes' own pull on the same notes (run pairs on a
// neighbouring lane 40.5% against 45.3% for pitchLanes alone); at 6 together they reach 46.0% and the pitch agreement holds.
const RUN_LANES = { minNotes: 3, maxGapBeats: 0.6, weight: 6, nearMiss: 1.4, miss: 3.9, startRoom: 1.5 };
// melodyLines.js heldLineMoments, selection.js selectMoments (flag melodyLines, Normal only): the decoded melody held as lines.
// A line is a run of at least `minNotes` melody notes, each within the larger of `joinBeats` beats and `joinMs` of the last. Only
// 6% of the melody's notes sit in a line Normal plays whole (72 songs): one by one the budget, a louder neighbour inside the gap
// or a sound too weak for the foreground takes a note out of the line. A line is held when `heard` of its notes have a sound
// (a scored moment within melodyPick.js ONSET_MS) and those moments' mean loudness rank (a rank of the strength over the song's
// moments, 0 the quietest) is at least `minLoud`: the listening test of 2026-11, where the melody picked the moments alone, lost
// because quiet melody notes took the place of loud, full ones and left holes, so a quiet line is not held. A moment off the line
// closer than the level's gap and `louder` of a rank louder keeps its place and the line's moment gives way. What is left of the
// line is thinned to the level's step (every second note of a fast run, on beats and half beats first). The held moments are
// played on top of what a phrase chose, where they fit, up to `room` of its budget: no note gives its place to a line. On top
// of the night's melody flags (melodyKeep, copyMelody, melodyShiftPick), the melody's notes played over what a line moved two
// beats gets: bot 18.2 -> 19.8 points, corpus 10.8 -> 12.2; corpus F1 .807 -> .807, recall .864 -> .868, moments +1.1%.
const MELODY_LINES = { joinBeats: 1, joinMs: 450, minNotes: 4, heard: 0.6, minLoud: 0.3, louder: 0.3, room: 0.3 };
// The same lines chosen before the foreground (flag melodyLinesFirst, Normal only), which then takes what they leave of the
// budget, `room` of it over: a line wins its place from a sound that is not clearly louder. More of the melody (bot 18.2 ->
// 21.9, corpus 10.8 -> 15.8) for notes people play (corpus F1 .807 -> .795, recall .864 -> .847; Easy, cut from Normal, .733 ->
// .718): one for the ear. A melody moment winning single close calls in the foreground (melodyDuel) was tried and removed: it
// cost the same F1 for half the melody.
const MELODY_LINES_FIRST = { ...MELODY_LINES, room: 0.15, first: true };
// dips.js thinDips: Normal slows down where the music dips for a moment inside a loud passage; asked for by ear
// (MEGALOVANIA, Camellia remix, 2:18-2:23). Train, audio dips of 400 ms+: people thin 35% of them to under half the density
// around, v39 21%, this 41%. Dropping every off-beat moment where the energy falls under `deep` of the level around, as
// the user heard it, costs train F1 .8018 -> .8005 and test .8337 -> .8309.
const DIP_THIN = { drop: 0.7, level: 0.3, below: 0.7, offBeatBelow: 0.9, deep: 0.6 };
// sustain.js holdSustains: Normal holds the decoder's long notes where no drum kit plays (REVOLVANIA's opening brass, one
// hold per sound), and the chords of a quiet pad where the hats and cymbals stop though something still beats, the lane
// moving with the pitch (padWindows, padLine, padLanes: GHOST 2:06-2:16 organs). Both asked for by ear; the corpus does
// not back the pads (in their windows people hold 18% of the time, and play more taps). Train F1 .8024 -> .8020, 16 of 78
// songs changed, Easy, Hard and Hell none. Songs with no melody file (no decoded notes) are charted as before. Played and approved in
// v41 (flags sustainHolds and sustainPads).
const SUSTAIN_HOLDS = {
  longMs: 800,
  minVel: 0.35,
  joinMs: 250,
  headMs: 150,
  releaseBeats: 0.25,
  minBeats: 1,
  drumless: { windowMs: 2000, highBelow: 1, highmidBelow: 4 },
  pad: { highBelow: 1, quietBelow: 0.6 },
};
// drumless.js: Normal drops what only the drums layer's "kicks" gave it where no cymbals or hats play: REVOLVANIA's opening
// brass read as kicks. Train Normal F1 .8005 -> .8007, 11 songs changed, the dropped moments people's 14%. From v42.
const DRUMLESS = { windowMs: 2000, highBelow: 1, highmidBelow: 4 };
// sustain.js keepMelodyOnly: Normal plays the decoder's short-note line alone where it runs over a held bed in a loud
// passage of 8 s or more (REVOLVANIA 0:20-0:42, the MEGALOVANIA motif on a low synth, by ear), not in a phrase the drums
// lead. The line comes from the decoder's low-threshold run where the melody file has one. It fires on 5 of 36 bot songs
// and 1 of 78 train songs. From v42.
const MELODY_ONLY = { windowMs: 4000, lowBelow: 52, longMs: 1000, minVel: 0.3, cover: 0.4, loudAbove: 0.7, shortMs: 600, sameMs: 60, linePerSec: 1.5, chordShare: 0.25, minRun: 2, snapMs: 80, notLedBy: "drums" };
// dips.js silentUpper: Normal drops the moments in an energy dip where the upper bands go quiet for a second or more:
// REVOLVANIA 0:41.5-0:43, a low rumble after the bass drum that the low band hears on every beat, by ear. From v42.
const DIP_SILENCE = { drop: 0.7, level: 0.3, gapMs: 1000, maxGapMs: 4000, bands: ["highmid", "high"] };
// chords.js slowChords: people play more chords the slower the song, Normal's rates did not follow. Train, chord against
// tap at the moments both play: under 115 BPM 68.1% -> 72.9% agree (chords 16% -> 33%, people 42%), 115-145 BPM 63.2% ->
// 66.8% (22% -> 30%, people 44%). From v43 (flag chordSlow, played).
const CHORD_SLOW = { refBpm: 145, power: 3, max: 3.5, maxShare: 0.5 };
// holds.js slowHolds: the shortest hold of a song under belowBpm is at most minMs, not a beat (460 ms at 130 BPM, 600 ms
// at 100); people's median there is half a beat. From v43 (flag holdSlow, played).
const HOLD_SLOW = { belowBpm: 145, minMs: 300 };
// selection.js phraseBudget: the quiet parts of a song under belowBpm get more notes against the loud ones (people 3.26
// moments a second in the quiet ones and 4.68 in the loud, Normal 2.00 and 4.79). From v43 (flag slowDynamics, played).
const SLOW_DYNAMICS = { belowBpm: 145, delta: 1 };
// selection.js budgetModelOf, isFlatLoud: a song from fromBpm loud all through (mean energy over ref) reads its loudness
// against ref, not its own mean, and skips localThin: Coffin Dance (Camellia Remix) played 5.0-5.6 moments a second in its
// loud parts, GHOST 6.3-6.8, over music as busy. Set by ear, not by people (they play loud phrases at about 4.8 a second
// however loud the song); train F1 .7984 -> .8039. From v43 (flag flatLoud, played).
const FLAT_LOUD = { fromBpm: 145, ref: 0.7 };
// fades.js: the fade-out at the end of a song, from where it falls under `from`, keeps `keep` of every bar's moments, the
// ones on the beat first, and a lone tap with room is held. People's Normal plays 1.27 notes a second there, v37 2.48,
// this 1.60. Thinned over the whole fade-out at once, a slow, still busy start lost most of its notes (Bad Piggies).
const FADE_OUT = { loud: 0.6, from: 0.5, quiet: 0.35, minSec: 4, keep: 0.5, barBeats: 4, hold: { minBeats: 1, releaseBeats: 0.5, lastBeats: 2 } };
// chords.js: a moment of Normal after 2 beats of nothing in quiet music plays one note, held until half a beat before the
// next moment (Rebel Path 1:42.5, asked for by ear; people play one tap there 68% of the time, hold it 5%).
const QUIET_LONE = { gapBeats: 2, below: 0.25, hold: { minBeats: 1, releaseBeats: 0.5 } };
// selection.js soloLeadRates, chords.js: a quiet phrase after the song's first loud one, drums hardly there and the lead
// sure of itself (a piano alone, ASGORE 1:49), keeps this share of its lead line in its budget and plays one note at a time.
const SOLO_LEAD = { drumsBelow: 0.3, leadFrom: 0.8, share: 0.6 };
// bridges.js: a rest of Normal at least minBeats long where the music plays on keeps its best moment (a mini rest); one
// where the music holds no moment that strong stays empty (a full rest).
const MINI_RESTS = { minBeats: 1.5, playing: 0.25, score: 0, edgeBeats: 0.5 };

// generate.js plusNotes, selection.js plusMoments (flag hardPlus): Hard starts from the moments of Normal and adds its own.
// Train sweep (train): budgetScale 1.2 / 1.3 / 1.4 gave Hard 5.95 / 6.17 / 6.24 moments/s (people 6.0) and median
// F1 .826 / .828 / .823 (old Hard .767); plusFloor (the extras a dense Normal still gets, as a share of its moments) 0.1 / 0.18 / 0.28
// gave 5.91 / 6.17 / 6.42 moments/s at 1.3. chordRates: Normal's chords stay chords (keepSizes) and these only add, 0.42 chord share
// (people .42; Hard's own rates gave .54 on top of Normal's chords).
const HARD_PLUS = {
  buildOn: "normal",
  scoreLevel: "hard",
  keepSizes: true,
  budgetScale: 1.3,
  plusFloor: 0.18,
  chordRates: [0.9, 0.8, 0.18, 0.21],
};

// selection.js plusFigures (flag plusFigures, with hardPlus): the extras follow the figures of the bars. Train against people's
// Hard: where Normal repeats a bar, the same extras in 6% of those bars with hardPlus alone, 40% with figures (people 50%), the
// bar rhythm repeating 1, 2 or 4 bars back 16.5% -> 32% (people 44%). familyBonus 0 / .15 / .3 / .5 / 1: bars with no extra
// 16 / 24 / 33 / 40 / 46% and with four or more 9 / 12 / 14 / 16 / 18% (people 29% and 34%), F1 .8073 / .8069 / .8056 / .8022 /
// .7981 (hardPlus alone .8097). A bonus for places next to filled ones (runs) lowered F1 and gathered nothing.
const PLUS_FIGURES = { plusFigures: true, plusFamilyBonus: 0.3 };

// rhythm.js figureMoments (flag easyFigures, with easyFromNormal): the bars Normal plays alike keep the same moments in Easy.
// Train against people's Easy: where Normal repeats a bar, the same moments dropped in 26% of those bars before, 29% with the
// figures alone (the density floor after the budget drops the rest one by one), 38% / 50% with easyFromNormal's keepShare times
// .85 / .75 (people 65%); Easy F1 .7305 -> .7332 / .7320, Easy/Normal moments .603 -> .584 / .558 (people .648).
// keepShareScale scales keepShare, so the flag holds whatever keepShare easyFromNormal sets.
const EASY_FIGURES = { keepFigures: true, keepShareScale: 0.85 };

// rhythm.js (flag easyFromNormal, from v44): Easy is cut from Normal, keeping keepShare of its moments per phrase by tempo
// (in BPM), the beats scoring keepBeatBonus over the half beats; chordKeep and chordNew set its chords. The sweep is in the
// comment under easyV26.
const EASY_FROM_NORMAL = { cutFrom: "normal", keepShare: [[145, 0.66], [190, 0.8], [Infinity, 0.85]], keepBeatBonus: 0.6, chordKeep: [0.6, 0.14, 0, 0], chordNew: [0.14, 0, 0, 0] };

// holds.js keptHolds (flag normalHolds): Easy and Hard keep Normal's holds of at least minBeats.
const NORMAL_HOLDS = { keepNormalHolds: { minBeats: 2 } };

// rhythm.js sameCuts (flag easySameCuts): the bars Normal plays alike keep the same moments in Easy after the floors too, a
// place kept where at least keep of the family's bars still play it. Train against people's Easy (65% same drops where Normal
// repeats a bar, 2.39 / 2.88 / 2.97 moments/s under 145 / 145-190 / over 190 BPM): v44 39.1%, 2.07 / 2.81 / 3.18, F1 .7332;
// keep .34 / .4 / .5 alone 68.7 / 73.5 / 79.4%, F1 .7381 / .7392 / .7395, but 2.58 moments/s at 145-190 (the cuts are half
// beats); keep .4 with keepShare .72 / .9 / .85 (v44 .66 / .8 / .85): 65.8%, 2.13 / 2.68 / 2.97, F1 .7374. Less beat bonus, to
// bring the share of Easy on the beat (87%) to people's (74%), cost F1 (.7332 -> .6980 at no bonus) and was dropped.
const EASY_SAME_CUTS = { sameCuts: { keep: 0.4 }, keepShare: [[145, 0.72], [190, 0.9], [Infinity, 0.85]] };

// generate.js plusNotes (flag hardHolds): Hard built on Normal laid no holds of its own and let go of Normal's on its extras:
// train, holds 4.6% of its notes against people's 11.6%, held 12% of the song against 27%. plusHolds lays its sustain and gap
// holds as a Hard charted from the music did, holdRelease "free" lets a hold go with its sound as Normal's do, and the hold
// shares go up. Under 145 / 145-190 / over 190 BPM: holds .042 / .046 / .050 -> .101 / .089 / .090 of the notes (people .120 /
// .116 / .079), held time .10 / .12 / .14 -> .30 / .23 / .24 (people .34 / .27 / .24), F1 unchanged (.808 / .816 / .805). Shares
// .25 / .4 went past people (.19 holds), without "free" .12 holds but shorter.
const HARD_HOLDS = { plusHolds: { gaps: true }, holdRelease: "free", holdsByCalm: holdsByCalm({ loud: 0.18, quiet: 0.3 }, { loud: 0.2, quiet: 0.4 }) };

// generate.js plusNotes (flag hellPlus): Hell starts from the moments of Hard and adds its own, as Hard does on Normal. There are
// no people's Hell maps, so the targets are the user's: about Hard x1.4 moments in the median, only +15-20% on dense songs, and
// where the room runs out half the extra notes as sixteenth bursts, half as chords of 2-3 keys on strong hits.
// Train (78 songs, with the bot's flags), Hell/Hard moments in the median: budgetScale 1.8 / 2.0 / 2.2 gave 1.29 / 1.40 / 1.48,
// but as much on fast songs as on slow ones, and 66-76% of the extra notes were moments. plusDense (generate.js plusNotes) cuts
// a phrase's new moments from sparseShare of its Hard moments at fromNps Hard moments/s to denseShare at toNps, and gives the
// rest of its room to chord keys: with 2.2 and 5-9 / .7-.17, phrases under 5/s x1.44, 5-7 x1.42, 7-9 x1.32 (51% of the extra
// notes chord keys), 9 and up x1.17 (64%); median 1.39, 8.2 moments/s (Hard 6.0), 12.7 notes/s (Hard 8.7). Where Hard already
// plays every sixteenth (slow songs) no moment fits and the room goes to chords. No Hard moment is lost.
const HELL_PLUS = {
  buildOn: "hard",
  scoreLevel: "hard",
  keepSizes: true,
  budgetScale: 2.2,
  plusFloor: 0.15,
  plusDense: { fromNps: 5, toNps: 9, sparseShare: 0.7, denseShare: 0.17 },
  chordRates: [1.0, 0.9, 0.3, 0.3],
  copyFrom: COPY_FROM,
  ...PLUS_FIGURES,
  ...NORMAL_HOLDS,
};

// --- Per-difficulty parameters ---------------------------------------------

// Levels the generator charts but does not offer: DIFFICULTIES (and generateAll) stay the public ones.
// normalV26 is the Normal of generator v26, kept as what Easy is cut from.
const INTERNAL_LEVELS = {
  normalV26: {
    grammar: "normal",
    chordKeep: [0.66, 0.64, 0.38, 0.38],
    chordNew: [0.04, 0.04, 0.04, 0],
    maxNps: 6.5,
    maxNpsCeiling: 7.5,
    baseDiv: 2,
    energyDiv: 2,
    highEnergyFrom: 0.6,
    fineDiv: null,
    fineMinStrength: 0.9,
    laneGapBeats: 1 / 2,
    minLaneGapMs: 150,
    minGapBeats: 1 / 4,
    minNoteGapMs: 100,
    maxJack: 2,
    cutFrom: "hardBase", // Hard as it is without the flag hardPlus, so Easy (cut from this level) does not move with that flag
    cutLevel: 2,
    maxLevel: 1,
    halfBudget: [[110, 0.74], [135, 0.82], [160, 0.73], [185, 0.62], [Infinity, 0.46]],
    quarterBudget: [[110, 0.27], [135, 0.11], [160, 0.064], [185, 0.025], [Infinity, 0.008]], // ...and quarter beats, per quarter-beat place
    fillRestBeats: 2,
    holdMinBeats: 1, // a half-beat hold reads as noise
    pulseNotesPerBeat: 1,
    holdOtherHand: "spaced",
    bandBias: [1, 1, 0.9, 0.8],
    beatBias: 0.2,
    // Second note on a beat with some weight, unless the part is quiet.
    chord: { minStrength: 0.4, onDownbeat: false, minEnergy: 0.45 },
    drumChords: true, // a drum hit under a lone note of the tune is that note's other hand
    maxChordShare: 1 / 3, // chords may run up to this share of the moments, a downbeat may always be one
    alternation: null,
    // What makes a chart readable rather than merely playable (Hard and Hell have none of these).
    gapBeats: 1 / 4, // any-lane gap on the pattern path, in beats
    chordGapBeats: 1 / 4, // ...around a chord
    leaderFirst: true, // the leading layer picks its notes before the layers backing it, on-beat moments before off-beat ones
    thinChords: true, // a chord only where diff.chord allows it, in both hands and clear of its neighbours
    densityByMoment: true, // the density cap counts moments (a chord is one thing to read)
    maxHoldShare: 0.15,
    gapHoldShare: 0.14,
    sectionChordRise: 0.7,
    sectionChordEnergy: 0.3,
    motifPull: 6,
    echoMirror: 0.3,
    sustainMinBeats: 1,
    laneSearch: LANE_SEARCH,
    firstSound: FIRST_SOUND, // so Easy, cut from it, keeps it
  },
};

const DIFFICULTIES = {
  easy: {
    grammar: "easy", // which human lane patterns the level draws from (lanes.js)
    chordKeep: [0.5, 0.14, 0, 0], // how many of the level above's chords stay chords, by place in the bar (downbeat, beat, half, finer)
    chordNew: [0.08, 0, 0, 0], // ...and how many of its single notes become one
    chordGapBeats: 1 / 2,
    maxNps: 3.5, // the busy factor spreads it 2.8-4.5; a mapper plays about 3.5 notes/s at 185 BPM and up
    maxNpsCeiling: 4.5, // the busy factor never lifts the density cap above this
    // Grid divisions per beat: baseDiv normally, energyDiv at energy >= highEnergyFrom,
    // fineDiv for onsets with strength >= fineMinStrength (null = never).
    baseDiv: 2,
    energyDiv: 2,
    highEnergyFrom: 0.6,
    fineDiv: null,
    fineMinStrength: 0.9,
    laneGapBeats: 1, // same-lane gap, in beats
    minLaneGapMs: 350, // ...never below this, whatever the tempo
    minGapBeats: 1 / 2, // any-lane gap on the unsnapped path, in 120-BPM beats
    minNoteGapMs: 130, // any-lane gap between distinct times, never below this (Normal 100, Hard 60)
    maxJack: 2, // longest same-lane run of consecutive notes (1 = no jacks)
    cutFrom: "normalV26", // the level whose moments this one is cut from (rhythm.js)
    cutLevel: 1, // cut from a harder level, moments kept up to this place (0 = a beat, 1 = a half beat, 2 = a quarter beat)
    maxLevel: 0, // patterns keep events up to this level (0 = strong, 1 = grid, 2 = fine)
    halfBudget: [[110, 0.45], [Infinity, 0.19]], // half beats a mapper plays per beat, up to a tempo in BPM
    maxHalfRun: 5, // longest run of half beats; the next beat ends it
    quietBeats: 0.62, // share of its beats a phrase keeps at its quietest; a loud one keeps them all
    fillRestBeats: 2, // a rest this long while the music plays gets a note of the music there (rests.js; null = never)
    holdMinBeats: 1, // shortest sustained note that becomes a hold, in beats
    pulseNotesPerBeat: 1, // density floor in a phrase with a steady pulse (phrases.js hasSteadyPulse), notes per beat
    holdOtherHand: "blocked", // while a hold runs: "blocked" = no note in any lane, "spaced" = other hand >= 1/2 beat apart, "free"
    // Selection ranking = strength * bandBias[band] + beatBias * (1 downbeat, 0.5 beat, 0 off-beat).
    // Easy/Normal lean on the backbone (kick/snare, downbeats); Hard follows the
    // raw onset strength across all bands, so its note choice differs from Normal.
    bandBias: [1, 1, 0.85, 0.7],
    beatBias: 0.35,
    // Second note only on a strong downbeat (Easy has no 1/8s or fills to accent a bar with).
    chord: { minStrength: 0.8, onDownbeat: true, minEnergy: 0.7 },
    alternation: null,
    // What makes a chart readable rather than merely playable (Hard and Hell have none of these).
    gapBeats: 1 / 2, // any-lane gap on the pattern path, in beats
    tonalGapBeats: 1 / 2, // ...between two notes of the sung or bass line
    leaderFirst: true, // the leading layer picks its notes before the layers backing it, on-beat moments before off-beat ones
    thinChords: true, // a chord only where diff.chord allows it, in both hands and clear of its neighbours
    densityByMoment: true, // the density cap counts moments (a chord is one thing to read)
    vocalLeads: true, // in a sung song the voice leads every phrase it is heard in: it is what a beginner follows
    oneLayer: true, // the leading layer alone: a second layer in the other hand is a skill Easy does not ask for
    longNotesOnBeats: true, // a long sung note off the half-beat grid starts on the nearest beat (its hold carries the voice)
    oneHoldAtATime: true, // a hold starting under another stays a tap: two held keys are a skill Easy does not ask for
    maxHoldShare: 0.2,
    gapHoldShare: 0.13, // holds are brought up to this share where a bass or lead line plays
    sectionChordRise: 0.9, // a section this much louder than the last one opens on a chord (sections.js)...
    sectionChordEnergy: 0.35, // ...when it is at least this loud
    sustainMinBeats: 1,
    localThin: LOCAL_THIN,
    holdsByCalm: holdsByCalm({ loud: 0.15, quiet: 0.32 }, { loud: 0.2, quiet: 0.42 }),
    laneSearch: LANE_SEARCH,
    firstSound: FIRST_SOUND,
  },
  // Normal picks its notes from the music (selection.js): the moments the music puts in the foreground, as many as its
  // phrase has budget for, and not cut from Hard's. Chords come over the finished moments like Hard's (chords.js).
  normal: {
    selector: "music",
    scoreLevel: "normal", // the weights the moments are scored with (momentWeights.js K)
    foreground: 0.5, // a moment scoring at least this (a logit) is in the foreground
    budgetScale: 1.1, // the phrase budget as the music calls for it times this (selection.js phraseBudget)
    notBelow: "easyV26", // ...and never fewer moments in a phrase than this level plays there (generate.js budgetOf); Easy
    // itself is cut from Normal from v44, so the floor is the Easy before that
    grammar: "normal",
    melodyLanes: true, // the lanes follow the melody and keep the rules of Normal (laneRules.js, lanes.js)
    chordRates: [0.7, 0.6, 0.13, 0.14], // how often a moment is a chord, by place in the bar (chords.js)
    maxChordShare: 1 / 3, // chords may run up to this share of the moments (chords.js; v26's cap, which acts on this path as well)
    maxChordsPer8Beats: 6, // ...and at most this many in any 8 beats: the weakest give way, a section's opening chord never (chords.js)
    chordGapBeats: 1 / 4,
    maxNps: 6.5,
    maxNpsCeiling: 7.5,
    laneGapBeats: 1 / 2,
    minLaneGapMs: 150,
    minNoteGapMs: 100,
    maxJack: 2,
    holdMinBeats: 1, // a half-beat hold reads as noise
    holdOtherHand: "spaced",
    holdRelease: "free", // a hold lets go with its sound, not on the next moment, and may run over moments (holds.js settleHolds)
    underHold: true, // what sits under a hold keeps the Ranking Criteria (holds.js underHoldFlagged), instead of v26's half-beat spacing
    gapBeats: 1 / 4, // any-lane gap between two moments, in beats
    maxHoldShare: 0.35, // both hold caps are set to what gets the share of holds to the people's (.118): .35 gives about .116 on the train songs, .25 .10, .5 .13; with a lower cap it is the cap that holds the share back
    gapHoldShare: 0.35,
    sectionChordRise: 0.7,
    sectionChordEnergy: 0.3,
    motifPull: 2, // 6 narrowed a song to its favourites: distinct 4-block figures per 100 were 44 on the train songs, 50 at 2, 58 at 0, people 56
    echoMirror: 0.3,
    sustainMinBeats: 1,
    localThin: LOCAL_THIN,
    holdsByCalm: holdsByCalm({ loud: 0.22, quiet: 0.42 }, { loud: 0.2, quiet: 0.5 }),
    laneSearch: { ...LANE_SEARCH, melody: 0.15, oneHand: 1.25, echoBeta: 10, echoNone: 5, echoMirror: null },
    chordFlow: CHORD_FLOW,
    openingLead: 0.9, // a quiet opening plays this share of its lead line, a soloist before the song comes in (selection.js)
    figures: FIGURES,
    firstSound: FIRST_SOUND,
    feltTempo: FELT_TEMPO,
    quietLone: QUIET_LONE,
    soloLead: SOLO_LEAD,
    restBridge: MINI_RESTS,
    copyFrom: COPY_FROM, // from v38 (train F1 0.7985 -> 0.8017)
    fadeOut: FADE_OUT,
    stairs: STAIRS,
    melodyLine: true, // from v39, with melodyTuned and melodyPick
    melodyTuned: true,
    melodyPick: MELODY_PICK,
    chordLoudness: CHORD_LOUDNESS, // from v40, with twoKeyTrill, melodyRuns and dipThin
    twoKeyTrill: TWO_KEY_TRILL,
    melodyRuns: MELODY_RUNS,
    dipThin: DIP_THIN,
    sustainHolds: SUSTAIN_HOLDS, // from v41, with the pads
    melodyOnsetShift: true, // from v42: the decoded melody moved to our onsets (generate.js decodedMelodyOf), with the next three
    drumless: DRUMLESS,
    melodyOnly: MELODY_ONLY,
    dipSilence: DIP_SILENCE,
    chordSlow: CHORD_SLOW, // from v43, with the next three
    holdSlow: HOLD_SLOW,
    slowDynamics: SLOW_DYNAMICS,
    flatLoud: FLAT_LOUD,
  },
  hard: {
    grammar: "hard",
    chordRates: [1.3, 1.15, 0.26, 0.3], // how often a moment is a chord, by place in the bar (chords.js)
    chordTriples: [0.3, 0.1, 0.1, 0.1], // how many of those chords take a third note
    chordGapBeats: 1 / 8,
    chordMinGapMs: 75,
    maxNps: 9.0,
    maxNpsCeiling: 10,
    baseDiv: 4,
    energyDiv: 4,
    highEnergyFrom: 0.6,
    fineDiv: 8,
    fineMinStrength: 0.9,
    laneGapBeats: 1 / 4,
    minLaneGapMs: 150,
    minGapBeats: 1 / 8,
    minNoteGapMs: 60,
    maxJack: 3,
    maxLevel: 2,
    fillRestBeats: null, // Hard's rests are filled with the drums (seams.js fillGaps)
    holdMinBeats: 1,
    pulseNotesPerBeat: 2,
    fastQuarterMs: 90, // above about 167 BPM the half beats come first (difficultyFilter.js fastQuarterLevel)
    holdOtherHand: "free",
    restHoldBeats: 1 / 2, // the shortest hold a rest gets (the others: holdMinBeats)
    gapHoldShare: 0.09,
    sectionChordRise: 0.5,
    sectionChordEnergy: 0.25,
    motifPull: 6,
    echoMirror: 0.3,
    bandBias: [0.9, 1, 1, 1],
    beatBias: 0,
    chord: { minStrength: 0.95, onDownbeat: false, minEnergy: 0.5 },
    // Hard's own lane logic: inside a stream (notes within maxGapBeats of each
    // other) every second note takes the runner-up band's lane instead of the
    // strongest band's, so patterns alternate between the two loudest bands.
    alternation: { maxGapBeats: 2 },
    localThin: LOCAL_THIN,
    holdsByCalm: holdsByCalm({ loud: 0.1, quiet: 0.2 }, { loud: 0.12, quiet: 0.3 }),
    shortestHoldMaxMs: 225,
    laneSearch: HARD_LANE_SEARCH,
    openingLead: 1.2,
    firstSound: FIRST_SOUND,
    copyFrom: COPY_FROM,
  },
  // For fun, beyond Hard. Before v44 charted from the music like Hard (finer onsets kept at a lower strength, chords on more
  // of the loud hits, denser drum pulses); from v44 built on Hard (HELL_PLUS below the levels).
  hell: {
    grammar: "hard",
    chordRates: [1.35, 1.25, 0.38, 0.4],
    chordTriples: [0.3, 0.1, 0.1, 0.1],
    chordGapBeats: 1 / 8,
    chordMinGapMs: 60,
    maxNps: 13.0,
    maxNpsCeiling: 16,
    baseDiv: 4,
    energyDiv: 4,
    highEnergyFrom: 0.5,
    fineDiv: 8,
    fineMinStrength: 0.7,
    laneGapBeats: 1 / 4,
    minLaneGapMs: 110,
    minGapBeats: 1 / 8,
    minNoteGapMs: 45,
    maxJack: 4,
    maxLevel: 2,
    fillRestBeats: null,
    holdMinBeats: 1,
    pulseNotesPerBeat: 4,
    holdOtherHand: "free",
    restHoldBeats: 1 / 2,
    gapHoldShare: 0.07,
    sectionChordRise: 0.5,
    sectionChordEnergy: 0.25,
    motifPull: 6,
    echoMirror: 0.3,
    bandBias: [0.9, 1, 1, 1],
    beatBias: 0,
    chord: { minStrength: 0.8, onDownbeat: false, minEnergy: 0.4 },
    alternation: { maxGapBeats: 2 },
    localThin: LOCAL_THIN,
    holdsByCalm: holdsByCalm({ loud: 0.07, quiet: 0.2 }, { loud: 0.12, quiet: 0.3 }),
    shortestHoldMaxMs: 225,
    laneSearch: HARD_LANE_SEARCH,
    openingLead: 1.2,
    firstSound: FIRST_SOUND,
  },
};

// What normalV26, and so easyV26, is cut from: Hard as generator v43 charted it without hardPlus.
INTERNAL_LEVELS.hardBase = DIFFICULTIES.hard;
// easyV26 is Easy as v43 charted it without easyFromNormal: Normal never plays fewer moments in a phrase than it does
// (notBelow), so Normal stays as it was now that Easy is cut from Normal.
//
// EASY_FROM_NORMAL, the settings easyFromNormal put on Easy, tuned on the 65 train songs that have a human Easy, never on
// the test songs. Targets from people's Easy: 99% of its moments are Normal's, Easy/Normal 0.55 under 145 BPM, 0.66 at 145-190,
// 0.69 above. keepShare is the share of Normal's moments Easy keeps per phrase, by tempo. Easy's own gaps, jacks and NPS cut
// further, so the ratio that comes out is lower than the share, most above 190 BPM where it stays near 0.62 whatever the share:
//   cutFrom "normal" alone (beats stay, half-beat budget as before): F1 .7327, ratio .589
//   keepShare .60/.68/.70, keepBeatBonus 0:    F1 .6817   bonus .25: .7269   bonus .6: .7340   bonus -.15: .6346
//   keepShare .66/.76/.80, keepBeatBonus .25:  F1 .7275, ratio .617   bonus .6: .7318   bonus 1: .7319 (flat above .6)
//   keepShare .66/.85/.90, keepBeatBonus .6:   F1 .7285, ratio .622 (more share, no more F1: people drop the weak moments)
//   a loudness scale on the share (what halfBudget has) lost F1, .7260, and was dropped.
//   chosen .66/.80/.85, bonus .6: F1 .7305 (old Easy .7175), ratio .619 (people .648), 2.96 moments/s (people 2.89)
// People keep the beats over the weak half beats, hence a beat bonus above 0; below 0 F1 falls by .09. Normal's moments alone
// took Easy's chord share from .109 to .087 (people .102), so chordKeep .6 on the downbeat and chordNew .14 bring it to .102 at
// the same F1; they are the third tuned setting.
INTERNAL_LEVELS.easyV26 = DIFFICULTIES.easy;

// From v44 the levels are built on Normal, played with the flags on in the bot and kept by the user: Hard is every moment of
// Normal plus extras that follow the figures of the bars (hardPlus, plusFigures), Easy is cut from Normal with the same cuts in
// the bars Normal plays alike (easyFromNormal, easyFigures), both keep Normal's long holds (normalHolds), and Hell is every
// moment of Hard plus extras and chords (hellPlus; "za dużo dla mnie", but the patterns made sense).
DIFFICULTIES.easy = { ...DIFFICULTIES.easy, ...EASY_FIGURES, ...EASY_FROM_NORMAL, ...NORMAL_HOLDS };
DIFFICULTIES.hard = { ...DIFFICULTIES.hard, ...HARD_PLUS, ...NORMAL_HOLDS, ...PLUS_FIGURES };
DIFFICULTIES.hell = { ...DIFFICULTIES.hell, ...HELL_PLUS };

// A level by name, public or internal.
const levelOf = (name) => INTERNAL_LEVELS[name] ?? DIFFICULTIES[name];

module.exports = {
  BANDS,
  CHORD_LOUDNESS,
  CHORD_SLOW,
  COPY_FROM,
  COPY_MELODY,
  DIP_SILENCE,
  DIP_THIN,
  DRUMLESS,
  EASY_FIGURES,
  EASY_FROM_NORMAL,
  EASY_SAME_CUTS,
  FADE_OUT,
  FAST_RUNS,
  FELT_TEMPO,
  FIGURES,
  FLAT_LOUD,
  HARD_HOLDS,
  HEARD_CHORDS,
  HARD_PLUS,
  HELL_PLUS,
  HOLD_SLOW,
  LOUD_HOLES,
  MELODY_KEEP,
  MELODY_LINES,
  MELODY_LINES_FIRST,
  MELODY_ONLY,
  MELODY_PICK,
  MELODY_RUNS,
  MELODY_SHIFT_PICK,
  MINI_RESTS,
  NORMAL_HOLDS,
  PITCH_LANES,
  PLUS_FIGURES,
  PLUS_MELODY,
  QUIET_LONE,
  RUN_LANES,
  SLOW_DYNAMICS,
  SOLO_LEAD,
  STAIRS,
  SUSTAIN_HOLDS,
  TWO_KEY_TRILL,
  BEAT_INTERVAL_TOLERANCE,
  BEAT_TOLERANCE_MS,
  BUSY_MAX_FACTOR,
  BUSY_MEDIAN_RATE,
  BUSY_MIN_FACTOR,
  BUSY_ONSET_STRENGTH,
  CONFIDENT_TEMPO,
  DENSITY_WINDOW_MS,
  DIFFICULTIES,
  ENERGY_EXPONENT,
  FALLBACK_BEAT_MS,
  GAP_TOLERANCE_MS,
  GENERATOR_VERSION,
  INTERNAL_LEVELS,
  LEAD_IN_MS,
  levelOf,
  MAX_SNAP_DISTANCE_MS,
  MERGE_WINDOW_MS,
  MIN_NOTES,
  SILENCE_ENERGY,
  SNAPPED_FLOOR_SLACK,
};
