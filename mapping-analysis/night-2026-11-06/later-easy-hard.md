# Easy, Hard and Hell: findings kept for later

The user's order of work: Normal is the base, and Easy, Hard and Hell are tuned on it at the very end. Until then,
what turns up about the other levels is only written down here, not changed. Numbers are from the train songs unless
marked test.

## Chords against loudness (Hard)

Share of moments played as a chord, by the music's energy (the same measure as the `chordLoudness` flag on Normal):

| Energy | Hard people | Hard ours (v38) |
|---|---|---|
| 0.1-0.2 | 5% | 38% |
| 0.2-0.3 | 13% | 43% |
| 0.3-0.45 | 19% | 47% |
| 0.45-0.6 | 28% | 50% |
| 0.6 and up | 42% | 42% |

Hard chords nearly as often in near-silence as in its loudest parts. People follow loudness. The `chordLoudness`
curve (chords.js loudnessScale) is the likely fix once Hard is tuned, with its own curve, since people's Hard rates
are higher in every band. Easy is cut from Normal v26, which is cut from Hard, so a change on Hard reaches Easy.

## Holes at phrase seams (Easy, Hard, Hell)

Map scan (map-scan.md), empty stretches across seams between two loud phrases, on levels other than Normal:

- Hopes And Dreams 2:26-2:35 and 2:37-2:45 (Hard, Hell)
- Exit This Earth's Atomosphere 2:27 (Easy, Hard)
- Finale 0:30 (Easy, Hard, Hell)
- youtube mD3v1B_aXw0 1:03 (Easy, Hard, Hell)

Normal had the same holes until `phraseGrid` (memory: mewbeat-phrase-grid-result); the other levels never got it.

## Short holds on long sounds (Hard, Hell)

0.5-beat holds on bass or lead sounds that go on 2-8 beats: M@GICAL CURE 2:39, HEARTSTEEL Live My Life 0:30,
Devourer of Gods 8:51, Hamilton 0:40, FIRESTARTER 2:06 (Hell). The hold length on Hard and Hell does not follow how
long the sound is.

## Easy fell a little with copyStrictHard (v37)

Test songs (TEST_USAGE 18): Easy 0.7576 -> 0.7554 when Hard copies repeats more strictly, through the cut chain.
Accepted at the time with v37, because the Easy levels will be retuned anyway.

## Alternating notes (Hard)

Where the lead or bass alternates two pitches (A B A B, half a beat or faster), people trill on two keys 29% of the
time on Hard (14 moments only), against 12% elsewhere. Ours: 2 such moments, because Hard rarely plays these notes
as single notes. Too few to decide; the `twoKeyTrill` flag is Normal's only.
