# Task 4: where the detector loses the melody (lead-gaps)

Frozen code (v36), 78 train songs (Normal) / 75 (Hard), read-only. Scripts: `scratchpad/research/lead/` (probe.js, run.js, agg.js, null1.js, off1.js, finale2.js).

## Definition

A "dense melodic stretch" is a run of 4-beat windows (2-beat step) where the human chart has:
- at least 3 notes/s and at least 4 distinct times,
- at least 60% of notes NOT within 35 ms of a strong percussive onset (drums event of kind kick, snare or perc with s >= 0.6; hats ignored),
- at least 3 lanes in use, and no lane above 60%.

The first version ("any drums event within 35 ms") was non-discriminating (drums are ~10 events/s, human share 0.96 vs 0.70 for time-shifted null). The strong-percussion filter separates human from null (non-hat s>=0.6: 0.61 vs 0.32).
Result: 883 stretches / 9,165 melodic human notes (Normal), 999 / 17,015 (Hard).
A human note is "lost" when no final note of ours is within 40 ms. 36% of melodic notes are lost on Normal (3,322), 39% on Hard (6,607).

Classes:
- (a) no lead or bass feature note within 40 ms,
- (b) pitched note exists but a threshold drops it,
- (c) pitched note exists, was scored/considered, and was cut later (budget, copy, floors, thin, collision).

## Controls

- Control A: delete every lead/bass note that matched a human melodic note (the probe's own "pitched" set). Result: lost notes flip to (a) 100% (Normal 3,352 of 3,352; Hard 6,567 of 6,567), b and c both 0. The classifier does find (b)/(c) on the old behaviour (base b+c: 874 Normal, 1,270 Hard) and empties them when the notes are removed.
- Note from control A: played notes barely move (Normal 5,843 -> 5,813; Hard 10,408 -> 10,448). The lead/bass notes that "match" human notes contribute nothing to what we play. Normal is lead-blind, as expected; on Hard they do not help either.
- Control B: set matched notes' conf to 0.3. Normal: unchanged (conf-blind, as expected). Hard: 1,365 notes land in b "noteConf<.45" (so the note-level TONAL_MIN_CONF 0.45 does bite when it is triggered; in real features it is not, see below).
- Null for coincidence: share of melodic human notes with ANY lead/bass note within 40 ms is 0.274 (Normal) / 0.246 (Hard); with human times shifted by +217 ms it is 0.242 / 0.219, and by -331 ms 0.235 / 0.223. Scanning shifts from -200 to +200 ms gives 0.31 at -160 ms and 0.30 at +20 ms: the match at zero offset is no better than a grid-aligned shift. The real match excess is about 0.
- Features hold no lead/bass note with conf below 0.518 (p10 = 0.735), so the note-level TONAL_MIN_CONF 0.45 never drops a note in practice.

Consequence: lead+bass notes are dense (2.9/s against 4.3 human moments/s), and a "pitched match" is mostly chance. The (b) and (c) counts below are upper bounds. The real finding is that the detected lead mostly is not the line that mappers play.

## Counts (lost melodic human notes)

| | Normal | Hard |
|---|---|---|
| melodic notes / lost | 9,165 / 3,322 | 17,015 / 6,607 |
| (a) no pitched note | 2,448 (73.7%) | 5,337 (80.8%) |
| (b) threshold | 68 (2.0%) | 214 (3.2%) |
| (c) cut later | 806 (24.3%) | 1,056 (16.0%) |

Normal, by stage (unpitched + pitched):
- budgetFull 1,638 (49%): 1,264 + 374
- copy (repeat phrase copied) 780 (23%)
- collision on snap 343
- localThin 241
- foregroundQuarter 104 (b, threshold: foreground score 0.5, quarter beats never filled)
- snapAway 106 (b, threshold: MAX_SNAP_DISTANCE_MS 35)
- gap 55, noCandidate 24, silence 9 (b, SILENCE_ENERGY 0.08)

Of the 1,638 budgetFull moments: median score -0.33, only 212 (13%) have score >= 0.5. They were scored LOW by the K model, then the phrase filled up (budget median 18 notes). So it is a scoring problem, not a budget size problem.

Hard:
- (a) 5,174 "onsetOnly" (a candidate onset exists, no pitched note), 163 "noOnset" (not even an onset candidate),
- (b) 136 "lead not leader/support" (phrase leader is another layer; SUPPORT_MIN_SHARE 0.3 / LEAD_PREFERRED_SCORE 0.5), 78 same with drums as leader,
- (c) 450 floors, 349 repeatCopy, 131 localThin, 85 noRecord (lead/bass chosen as layer but no trace record), 28 level, 13 other.

## Top 10 examples (mm:ss, stretch lost notes by class)

| # | Song | Time | Level | Lost: a / b / c | Main class, threshold |
|---|---|---|---|---|---|
| 1 | Barberia Tango | 1:05-1:36 | Normal | 72 / 1 / 34 | a; c = budget |
| 2 | Flower Dance | 1:57-2:37 | Normal | 65 / 0 / 32 | a; c = budget, copy |
| 3 | Flower Dance | 2:56-3:15 | Normal | 52 / 0 / 16 | a |
| 4 | Loonboon | 1:10-1:34 | Normal | 34 / 1 / 31 | c (pitched ok 55), budget |
| 5 | Calamity Fortune | 0:55-1:15 | Hard | 70 / 2 / 26 | a; c = floors |
| 6 | I Can't Wait feat. GUMI | 0:02-0:42 | Hard | 62 / 12 / 31 | a; b = leader/support share |
| 7 | PUPA | 1:37-1:52 | Hard | 68 / 3 / 0 | a (pitched ok 6, pure detector) |
| 8 | Angel Of Darkness (Nightcore) | 1:16-1:40 | Hard | 70 / 2 / 10 | a |
| 9 | Tomadoi Recipe (TV Size) | 0:01-0:14 | Normal | 31 / 0 / 1 | a (pitched ok 2) |
| 10 | The Vampire feat. Hatsune Miku | 1:27-1:39 | Normal | 25 / 9 / 4 | b: snapAway (35 ms), foregroundQuarter |

## Known cases (played songs, no human chart)

Probe run on the detected lead itself, as a stand-in for the human line (conf >= 0.45, dense stretches only):
- Finale (Undertale): 5 dense lead stretches, 40 lead notes, 15 lost: budgetFull 9, copy 6 (Normal); floors 8, repeatCopy 6 (Hard). All (c), none (a). This confirms the v29 result (piano lost to budget, not detection), but only where the lead was detected at all; the sample is small.
- Hopes And Dreams: 25 lead notes, 16 lost on Normal: budgetFull 8, snapAway 5 (b), collision 2.
- ASGORE: 1 stretch, 7 notes, 3 lost (budgetFull 2, collision 1).
- Musicals and voices: no train song matched, not measured.
Caveat: this only counts notes the detector DID find; it cannot see class (a).

## Fixes

- (a) detector, ~74-81% of loss, the largest class. A feature problem, not a threshold one: the detected lead/bass is not the line mappers follow (match is at chance). Needs a detector change (polyphonic onset peaks per band instead of single lead; Demucs stems were tried and failed; a harmonic-band onset candidate that is not drums). Hard "onsetOnly" shows an onset candidate exists 97% of the time, so a cheap first step is to score such onsets as melodic by their band (mid band, non-percussive) instead of needing a pitch. No flag-sized fix; needs a research task.
- (c) budget/selection on Normal, ~24%: moments are scored LOW (median -0.33), not out-budgeted. Fix is in `scoreMoments`/K weights (add a non-percussive mid-band onset term), plus the copy rule: 780 lost notes sit in repeat phrases that are copied while the human plays different notes. Flag worth trying: `copiedRepeat` off when the repeat has a non-percussive onset set that differs from its source.
- (c) Hard floors/repeatCopy/localThin: `applyDifficulty` floors cut 450. A flag that relaxes floors for stretches whose lead is dense and non-percussive is cheap; copy fix as above.
- (b), 2-3%: the thresholds are small. snapAway 35 ms and foregroundQuarter 0.5 together are 210 notes; leader/support share (0.3, 0.5) 214 on Hard. A flag is not worth it on its own.

Recommendation: do not tune thresholds (b); try one flag on the copy rule (`copiedRepeat`, 780 Normal notes, 349 Hard) and one on the K score with a non-percussive mid-band onset feature (up to 1,638 budgetFull). Retest by ear: the metric here is partly grid-dominated.
