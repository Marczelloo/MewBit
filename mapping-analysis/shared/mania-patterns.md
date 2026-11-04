# 4K mania patterns: what good looks like (durable reference for the chart generator)

Purpose: so nobody (human or model) forgets what a pattern is and why it plays well. Read before touching lane choice,
chords, holds or `lanes.js`. Written 2026-11-04 from the osu! wiki and forum plus our own corpus reports.

Tags: `[RC]` Ranking Criteria (hard rule or guideline, exact numbers), `[MG]` osu!mania Mapping Guide (guidelines, not
rules), `[GL]` RC glossary, `[WIKI]` osu! wiki pattern pages, `[FORUM]` forum thread (opinion, not rule), `[CORPUS]`
our human-chart reports in `mapping-analysis/levels/*/REPORT.md` (78-99 maps per level), `[CODE]` this repo,
`[INF]` my own inference, not sourced. Notation: one row per moment, time runs DOWN, lanes 1 2 3 4 (keys D F J K,
left hand 1-2, right hand 3-4), `#` tap, `|` hold body, `H` hold head, `T` hold tail, `.` empty.

## 1. Rules per level

Hard limits come from `[RC]` (https://osu.ppy.sh/wiki/en/Ranking_criteria/osu!mania). "Beat" = 1/1.

| | Easy | Normal | Hard |
|---|---|---|---|
| Snap | mostly 1/1, occasional 1/2, or slower; no consecutive 1/4 or faster | mostly 1/1 and 1/2, occasional 1/4, or slower; no consecutive 1/6 or faster | no consecutive 1/8 or faster, except 3 grace notes at 1/8, 1/12 or 1/16 |
| Runs | max 5 consecutive 1/2 notes | max 5 consecutive 1/4; long 1/2 streams need a 1/1 pause after each phrase, where natural | long 1/4 streams need a 1/2 pause after each phrase, where natural |
| Chord size | max 2 | max 2 (exception: a double played by the other hand from a long note) | max 3 |
| Chords in runs | none inside consecutive 1/2, except one starting or ending the run | none inside consecutive 1/4 (same exception) | in 1/4 streams chords at least 1/1 apart; none in the middle of 1/6 streams (start/end fine) |
| Jacks | no rule written | no 1/4 minijacks or other jacks; no 1/4 shields; anchors of 3+ notes avoided | 1/4 jacks discouraged (minijack with ample rest may pass); anchors of 5+ avoided |
| Trills | no rule | no rule | max 9 consecutive trill notes |
| Hold min length | 1 beat | 1/2 beat | 1/4 beat |
| Hold releases apart | at least 1 beat | at least 1/2 beat | no rule |
| Objects during a hold | none (1/1 hold), only at its start or end | none during a 1/2 hold; nothing faster than 1/2 during a 1/1 hold | no rule |
| HP / OD | max 7 / 7 | max 7.5 / 7.5 | max 8 / 8 |
| Star cap [MG] | below 1.5 (Easy icon) | lowest difficulty must be below 2.0 stars | n/a |

Global `[RC]`: no two notes on one column at one time, no empty column, Insane or lower presses at most 6 at once.
Not in the RC for 4K: any minimum gap, any handstream rule, any Easy jack rule.

Preferences (guidelines `[MG]`, https://osu.ppy.sh/wiki/en/Osu!mania_Mapping_Guide):
- Easy: almost only single notes; chords only to mark the start or end of a section or the louder beats (heavy drum,
  kick, clap); balance the hands; give the player a full beat (1/1) to react to a kiai chord; no single notes during
  a long note (if unavoidable, the other hand); long notes for sustained sounds.
- Normal: slightly denser than Easy through more 1/2 patterns; 1/4 only for low BPM or very short stairs; more chords
  (heavy snare or cymbal mid-section); singles may play during a long note, mostly on the other hand, a few on the
  same hand are acceptable; higher sounds right, deeper sounds left; in kiai chords and singles but do not overuse.
- Hard: longer 1/4 bursts, stairs, short jumpstreams where the song gets faster; 3-note chords for heavy cymbals at a
  section start or end; short jacks acceptable; avoid chord trills (they inflate star rating; short 3-note triples are
  fine); kiai the densest part where possible; 1/6 bursts under half a beat, 1/8 bursts under a quarter beat.
- Every note should correlate with a sound in the music `[RC]`. Judge a spread by pattern density, not stars `[MG]`.

What human mappers actually did `[CORPUS]` (values as p10 / p50 / p90 over maps where given):
- Easy: chords are 0.03 / 0.10 / 0.28 of moments; never more than 2 notes (99/99 maps); 58% of chords on a
  downbeat (p50); half the chords are one-handed (lanes 1+2 or 3+4); a chord opens 72% of kiai starts; holds are
  0.002 / 0.13 / 0.28 of notes, about 1 beat long, start on a beat, release exactly on the next moment (0.98); a note
  inside a ~1-beat hold appears in only 4/70 maps; no 1/4 minijack or shield in any map.
- Normal: chords 0.34 of moments (0.19-0.49), 3-note chords in only 7/78 maps; downbeat 0.26, other beat 0.58,
  off-beat 0.09; no 1/4 minijack or shield in 78/78; anchor of at most 2 notes in 69/78; 1/2 is the commonest gap in
  70/78; a 3-note same-lane run at 1/2 beat or slower exists in 58/78 (style, so allowed).
- Hard: 3-note chords exist in 95% of maps; 0.29 / 0.50 / 0.56 of moments are chords; minijack at 1/4 or faster almost
  never (96% of maps).
- Hands, all levels: left hand about 0.50 of notes; in 4-bar windows imbalance is p50 0.02, p90 0.05-0.10.
- Steps between consecutive single notes (same lane / 1 lane / 2 lanes / 3 lanes): Easy 0.02 / 0.47 / 0.34 / 0.16,
  Normal 0.03 / 0.50 / 0.31 / 0.13, Hard 0.02 / 0.62 / 0.25 / 0.10. The hand changes on 0.63-0.82 (Easy), 0.67
  (Normal), 0.62 (Hard) of steps. Staircase steps are 0.04 / 0.09 / 0.19 of Easy steps.
  So: a single note almost never repeats its lane, and usually goes to a neighbour or the other hand.

## 2. Glossary with figures

Definitions `[WIKI]`/`[GL]` unless tagged. Level column is `[RC]` where a rule exists, otherwise `[INF]`.

**Stream.** Notes at a constant interval for at least a beat, not forming minijacks `[GL]`. Singles only.
**Roll / staircase.** Single-note stream sweeping columns in order, 1234 or 4321 `[GL][MG]`. In 4K these are the
same shape; a "stair" is the slow, readable version (Normal allows only very short stairs `[MG]`).
```
1234   roll up      4321   roll down      1324   split roll (harder, alternates hands)
#...   ##          ...#
.#..               ..#.
..#.               .#..
...#               #...
```
Feel `[INF]`: both hands alternate 12 / 34 in a roll, so it is comfortable; a split roll crosses hands and needs
more control `[FORUM]`. Easy: only short, slow (1/1-1/2). Normal: very short at 1/2. Hard: bursts and stairs fine.

**Trill.** More than two notes alternating between two columns `[GL]`; one-handed (1-2) or two-handed (1-3) `[WIKI]`.
```
1-hand 1212   2-hand 1313   (also 2424, 1414)
#...          #...
.#..          ..#.
#...          #...
.#..          ..#.
```
Feel: 2-hand trills act like a controlled jack; the hard part is entering and leaving them `[FORUM 8681787]`.
One-handed trills drain fast `[FORUM]`. Limit: 9 consecutive notes on Hard `[RC]`; below Hard no rule, so keep
them to 3-4 notes `[INF]` (our grammar code leaves 4 free, then halves odds per extra note `[CODE]`).

**Jump / hand / quad.** 2 / 3 / 4 simultaneous notes `[WIKI]`. Jump is the commonest 4K chord.
```
12: one-hand jump   14: outer jump   23: inner jump   13: split jump (one finger per hand)
##..                #..#              .##.             #.#.
```
Humans' doubles `[CORPUS]` (learned grammar `[CODE]`): one-hand pairs 12 and 34 about 22-28% each, outer 14 about
20-28%, inner 23 only 6-11%, split 13 / 24 about 5-13%. Easy 3+ never; Normal never (except the hold exception);
Hard 3 max.

**Jumpstream / handstream / quadstream / chordstream.** A 1/4 stream with jumps (hands, quads) landing on slower
snaps, usually 1/1-1/2 `[WIKI]`; jumpstream is the commonest 4K stream. Not for Easy or Normal (1/4 runs and
chords in 1/4 runs are barred at Normal); Hard allows short jumpstreams `[MG]`.
```
jumpstream: 1/4 singles, a jump on the beat
#...  .#..  ..#.  ##..  ...#  ..#.
```

**Jumptrill / split-jumptrill / chordtrill.** Alternating two jumps: one hand each (12 / 34 = split, both hands busy)
or one hand playing both chords `[WIKI][GL]`.
```
##..  ..##  ##..  ..##     split-jumptrill: 12, 34, 12, 34
```
Split ones are tiring and awkward `[FORUM]`; a jumptrill that ends into a single note can create a minijack in 4K
`[FORUM]`. Insane only; Hard avoids chord trills `[MG]`.

**Jack / minijack / longjack.** 3+ notes in one column / exactly 2 / 4+ `[GL][WIKI]`. Fits two identical sounds `[MG]`.
```
#...   same column again and again. Normal: no 1/4 jacks. Hard: discouraged. Easy: avoid [INF].
#...
#...
```
**Anchor.** One column carries many more notes than the others, usually inside a stream `[GL]`; a finger tied to
one key by evenly spaced presses `[WIKI]`. Easy to read, strenuous when long `[RC]`. A "runningman" is a jack
under a stream `[FORUM 8681787]`.
```
#...   column 1 anchors a stream: 1 2 1 3 1 4 1 3
.#..
#...
..#.
```
Limit: under 3 notes on Normal, under 5 on Hard `[RC]`. Human Normal maps: at most 2 in 69/78 `[CORPUS]`.

**Chordjack.** Jacks made of chords (repeated jumps/hands) `[WIKI][MG]`. Not for Easy/Normal/Hard.
**Burst.** Short density spike, not necessarily 1/4 `[MG]`; a stream burst is under one beat `[WIKI]`.
**Grace.** Two or more notes in different columns in quick succession, usually 1/6 or faster `[GL]`; looks like a
chord. Hard allows 3 grace notes at 1/8, 1/12, 1/16.

**Long note (LN, hold).** Press, hold, release; for sustained sounds `[WIKI][MG]`. The release is judged on its own.
```
H.     single note allowed in the OTHER hand's lanes (3 or 4) while 1 is held
|#     (Easy: avoid entirely; Normal: mostly other hand, a few same-hand ok)
|.
T.
```
**Shield.** A note right before an LN in the same column (reverse shield: right after the release); plays like a
minijack `[WIKI][GL]`. `1/4 shield` barred at Normal; absent in all human Easy/Normal maps `[CORPUS]`.
```
#.   shield: tap, then hold head in the same column
H.
|.
T.
```
**Inverse.** Every note is a hold ending just before the next in its column: a wall of holds, needs strong reading
and finger independence `[WIKI][FORUM]`. Not for Easy/Normal `[INF]`.
**Glut** (forum slang): repeated chords never hitting the same column set twice `[FORUM 7817784]`. Bracket needs 5K+.

## 3. Music to figure

All `[MG]` unless tagged. Source: https://osu.ppy.sh/wiki/en/Osu!mania_Mapping_Guide, RC, forum posts listed in section 6.
- Strong sounds (heavy drum, kick, snare, clap, cymbal) get chords; softer sounds get single notes. Easy: only for
  section starts/ends and the loudest beats. Section starts and ends: 2-note chord (Easy/Normal), 3-note (Hard).
- Sustained sound (held note, pad, long vocal) gets a long note; each LN should follow a sound, never random.
  Easy also uses LNs for heavy sounds at 1/4 or faster, as a way to avoid 1/4 taps.
- Identical sounds get jacks (Hard and above only); different sounds get different lanes `[INF]`.
- Pitch to lane: low sounds left, high sounds right, like a piano. Best in calm single-note passages and at audible
  pitch changes; do NOT map the whole song this way, it unbalances the hands. Required on Normal ("higher right,
  deeper left"), optional elsewhere.
- Layering `[FORUM 2204305]`: one commenter layers by container, doubles for bass and triples for snares, then
  alternates single and double on each bass hit. A single opinion, but it is the "hand for each sound" idea `[INF]`.
- Repetition: "Be consistent": the same sound gets the same pattern across the map; changing the note count for
  identical sounds feels wrong. `[CORPUS]` caveat: real mappers repeat rhythm much more than lanes; our lane code
  copies source lanes only about 13.5% of repeated phrases and mirrors about 13.5-30% `[CODE]`. Use identical rhythm
  and chord positions in repeats, lanes may vary but should keep the same hand and shape `[INF]`.
- Intensity: density follows energy (quiet sparse, drops dense) `[CODE spec]`; Normal adds 1/2 patterns over Easy; Hard adds
  1/4 bursts, stairs and short jumpstreams where the song gets faster; kiai is the densest part; SV changes match
  intensity; breaks only in very calm or silent parts `[MG][RC]`. Humans open a kiai with a chord (72% Easy `[CORPUS]`).
- Room: Easy kiai chords need a full beat before them `[MG]`; pause after each phrase in a long 1/2 stream (Normal
  1/1; Hard 1/2 in a 1/4 stream) `[RC]`; natural rests in the music beat artificial caps `[FORUM 7817784]`.
- Example worth studying `[FORUM 7545774]`: Mazare Party 4K Extra puts jumps and hands on heavy beats and avoids 1/4
  minijacks; how to place the singles between jumps is a "make it consistent and comfortable" call, no formula.

## 4. What makes a pattern awkward or unplayable at low levels

Sourced facts:
- Speed matters more than pattern type: BPM and snap decide difficulty; slow minijacks are easy, fast ones are hard `[FORUM 7817784]`.
- Jacks demand finger speed: new players can tap one key at about 150 BPM but cannot read the pattern; jack speed is
  a distinct skill `[FORUM 8681787]`. A single-note stream at 340 BPM needs a one-hand trill at about 170 `[FORUM 8681787]`.
- Dense jumpstream difficulty comes mostly from the trills and anchors layered inside it `[FORUM 8681787]`.
- Anchors are easy to read but tiring; hence caps 3 (Normal) and 5 (Hard) `[RC]`.
- A hold occupies one hand; a single note during it belongs on the other hand `[MG]`; Normal allows a double from the
  other hand `[RC]`. Release timing is judged, so releases need room: 1 beat (Easy), 1/2 beat (Normal) `[RC]`.
- Long 1/2 runs need pauses; a long run without rest is a stamina wall (5 in a row at Easy, 5 consecutive 1/4 at
  Normal, then rest) `[RC]`. Chords in the middle of a stream break the hand rhythm; barred or spaced at every level `[RC]`.
- Trills over 9 notes are too hard to coordinate for Hard players `[RC]`. No consensus whether one-hand or two-hand
  chords are easier; simple rolls beat split rolls `[FORUM 7817784]`.

Finger and hand reasoning (`[INF]`, derived; the numbers marked `[CODE]` are our generator's floors):
- Same-finger repeat is the real cost. At 120 BPM 1/2 beat is 250 ms and 1/4 beat is 125 ms. Repeating a lane
  inside 1/2 beat is a jack at that speed; our floors are Easy 1 beat / 350 ms, Normal 1/2 beat / 150 ms,
  Hard 1/4 beat / 150 ms `[CODE difficulty.js]`. Humans reach the same lane in 2-3% of single-note steps `[CORPUS]`.
- One-hand overload: three notes in a row on one hand's two fingers is already a trill; after 4 the second hand
  should take over. Both hands should alternate (humans change hand on 62-82% of steps `[CORPUS]`).
- A chord right after a jack or on a lane just used is a re-strike on the same finger plus new finger: avoid. A
  chord right after another chord on the same pair (12 then 12) is a 2-note jack; alternate pairs (12 then 34) or
  place one chord per beat.
- Chord next to a hold: the held hand cannot join; the chord must come from the free hand only (a split jump with a
  held finger is not a jump). Easy therefore blocks all notes while any hold runs `[CODE holdOtherHand: "blocked"]`.
- Reading is the first wall on Easy/Normal: lanes that change shape every note are unreadable even when slow; small
  repeated figures (2-4 notes) are what players parse `[INF]`. Wide jumps (14, 13) need about a beat of room `[INF]`.

## 5. Normal vs Easy: character, not just density

Rules and guidelines are in section 1. In short: Easy is single notes on 1/1 (occasional 1/2), holds stand alone;
Normal adds 1/2 density, mid-section chords, singles during holds and pitch-following lanes. `[CORPUS]` made concrete:
| | Easy | Normal |
|---|---|---|
| chord share of moments | 0.10 (0.03-0.28) | 0.34 (0.19-0.49) |
| 3-note chords | never | rare (7/78 maps) |
| holds | ~1 beat, release on next moment, nothing inside | down to 1/2 beat `[RC]`; singles inside on the other hand `[MG]` |
| hand change per single step | 0.71 | 0.67 |
| jacks | essentially none (0.02 same lane) | none at 1/4; 3-note runs only at 1/2 beat or slower |
| stairs | 0.09 of steps (p50) | not measured in the cited lines |
Character `[INF]` from the above: Easy reads like a metronome with a melody (one thing happens per beat, the hands
alternate, chords are events). Normal is a rhythm with ornaments: pairs on beats, half-beat fills in short phrases,
and holds that let a free hand play offbeats. Normal is where "follow the sound" starts to show in the lanes.

## 5b. Generator history (the lane decision)

**Before v26 (`6df7b55~1`, `helpers/mewbeat/charts/patterns.js` + `difficultyFilter.js` + `barRepeats.js`).**
The lane was a property of the sound `[CODE]`:
| figure / rule | how |
|---|---|
| pitch to lane | `pitchLane` splits the line's pitch range over lanes (new range after a 1-beat rest plus a 7-semitone jump); under 3 semitones it follows the contour from lane 1 |
| stairs | a run of 3+ steps in one direction climbs one lane per step, bouncing at the edges (`bounce`) |
| trill | a repeated pitch holds its lane; if closer than max(1/2 beat, 250 ms) it alternates with the neighbour toward the centre |
| kick / snare / hat lanes | kick on [0,3], snare on [1,2], the n-th hit alternates the pair; a hat goes to the opposite hand of the previous event |
| hands (mixed phrase) | low sounds (bass, kick) left lanes 0-1, high ones (snare, hats, lead) right lanes 2-3; pitch rises left to right inside a hand |
| chords | `withChords`: mirror note on bar starts under a lone strong event; `drumChordEvents`: kick under a lead note on a beat as the other hand; `CHORD_LEVEL` kick chord only on Hard; max 2 per moment |
| jacks | `limitJacks` moved a note out of a same-lane run longer than `maxJack` to `lane ^ 1` / role partner |
| spread | `spreadLanes` moved a same-lane repeat closer than `laneGapBeats` to a free lane, other hand first |
| bar repeats, holds | `barRepeats.js` filled drum fills (kicks outer, snares inner); long confident bass/lead notes became holds at their pitch lane |

**In v26 (`lanes.js` + `laneGrammar.json` + `chords.js`).** Moment times and sizes are settled first
(`planChords`), then `assignLanes` ignores the incoming lane and draws a mask from an order-3 Markov table learned
from human charts (key: gap class | size | previous masks), multiplied by: hand-balance pull (16 beats), lane share
pull, trill decay (free 4, max 9), per-song motif pull (Normal/Hard 6), a pull toward the level above's lanes
(x3), and a repeat echo (same 13.5% of repeated phrases, mirrored 13.5%, 30% on Normal/Hard). Legality: lane gap, `maxJack`, hold hands.
A hold takes a random free "lonely" lane in its hand.

Status of the old figures in v26 `[CODE]`:
| old figure | v26 |
|---|---|
| pitch to lane, contour, register parts | DEAD: still computed in `patterns.js`, the lane is overwritten (only time, level, source, `sustainMs` survive) |
| stairs | DEAD as a rule; a stair can only arise by chance from the grammar |
| repeated-pitch trill | DEAD as a rule; replaced by a generic, level-independent trill decay (free 4, over 9 near-forbidden) |
| kick / snare lane roles | DEAD |
| hand split bass/kick left, lead/snare/hats right | DEAD; replaced by 50/50 balance pull, blind to sound |
| mixed-phrase layering | partly alive: `mixedEvents` still decides which events exist and their level, not where they sit |
| chords from `withChords` / `drumChordEvents` | BYPASSED: `planChords` re-decides size by place in the bar, bar loudness and sound strength; extra pattern-level chord notes are truncated and re-filled with free lanes |
| `limitJacks`, `spreadLanes` | REPLACED by `maxJack` and lane gap inside `lanes.js` |
| `barRepeats.js` | DELETED; repeats now echo source lanes at a low rate |
| long note at its pitch lane | alive in rhythm (hold decision), dead in lane (random free hand lane) |
Missing altogether in v26: an explicit anchor cap (RC Normal under 3, Hard under 5), level-specific trill limits
below Hard, shield avoidance as a named rule (only implied by the lane gap), pitch contour on Normal ("higher
right") and any link between a repeated sound and the same figure.

Spec intent (`docs/superpowers/specs/2026-10-31-mewbeat-rhythm-game-design.md`): lane from the band with the strongest
onset (low outer-left) plus a smoothing pass against long single-lane runs; same-lane gap 1 beat / 1/2 / 1/4; chords
none / 2 on strong downbeats / 2 max. The intent that a lane follows the sound is no longer implemented.

## 6. Sources

Read: https://osu.ppy.sh/wiki/en/Ranking_criteria/osu!mania (rules, glossary, guidelines);
https://osu.ppy.sh/wiki/en/Osu!mania_Mapping_Guide (guide, per-difficulty);
https://osu.ppy.sh/wiki/en/Beatmap/Pattern/osu!mania/Stream, .../Chord, .../Trill, .../Jack, .../Anchor, .../Hold_note
(each marked incomplete on the wiki; Stair and Long_note URLs returned 404);
https://osu.ppy.sh/community/forums/posts/8681787 (4K improvement guide, jacks/streams/trills/LN);
https://osu.ppy.sh/community/forums/posts/7817784 (RC discussion thread: first 100k of 119k characters read);
https://osu.ppy.sh/community/forums/topics/2204305 (mapping tips, layering); https://osu.ppy.sh/community/forums/posts/7545774
(jumpstream placement question; visible posts only); https://osu.ppy.sh/community/forums/posts/6568335 and
https://osu.ppy.sh/community/forums/posts/8614125 (player practice threads, little mapping content).
Could NOT read: https://knowledge.etternaonline.com/en/etterna/terminology (body did not render; only the title came back; the
search snippet gave chordjack, trill, jumptrill, runningman, anchor, handstream). Etterna/StepMania glossary entries
here are therefore second-hand. Not found: a dedicated osu! forum "4K pattern guide" with lane-by-lane advice; no
source gave exact numbers for comfortable chord spacing, so those are `[INF]`.
Our data: `mapping-analysis/levels/{easy,normal,hard}/REPORT.md`, `helpers/mewbeat/charts/{lanes,patterns,chords,
difficulty}.js`, `laneGrammar.json`, git `6df7b55` (v26) and `6df7b55~1`.
