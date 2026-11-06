# Tempo changes: is a tempo-following grid worth building?

Train songs only (80, 79 with a grid). Frozen generator, default flags. Nothing in the repo was changed. Scripts are in
`scratchpad/research/tempo/` of session f7a02774 (`lib.js`, `audio.js`, `controls.js`, `main.js`, `summary.js`,
`oracle-in.js`, `offruns.js`, `variable.js`).

## Question

How many train songs change tempo (ritardando, rubato, accelerando, sections at another BPM), and by how much? Do
mappers follow the music there or keep one grid? What could a grid that follows the tempo gain per level, compared with
our grid (beatFit's fitted grid, which in practice has one BPM on every train song)?

## Method

- **People's local tempo.** Notes from all three levels are merged, since one set shares its red lines. In 8-beat
  windows (hop 2 beats, at least 8 notes) I fit the best quarter grid. The period may move ±12% from our local beat and
  the phase is free. Points on the 1/6-beat grid count too, so that triplets cannot pass for another tempo. Hits are
  counted within 6 ms (human notes sit exactly on their snap), then a least-squares refit on the hits.
- **A window departs** when its period is more than 3% off ours, it explains at least max(2, 15%) more notes than our
  period does, and its hits make up at least 60% of its notes. A **stretch** is two or more departing windows in a row
  with the same sign, so 10 or more beats.
- **Audio signals.** A1: the tracker's raw beats (before the fit) over 8-beat spans against our grid, flagged above 4%.
  A2: an onset comb (all bands, weighted as in beatFit) in 8-beat windows.
- **F1** uses moments (distinct times) with greedy one-to-one matching within 35 ms. A note counts as "in a stretch" by
  its own time.
- **Gain estimates.** (a) Our notes in a stretch moved to the nearest point of people's local grid. (b) Timing oracle:
  our notes in a stretch moved to the nearest human note within 80 ms (or 130 ms), a ceiling for any timing fix.
  (c) A realistic version: notes inside tracker stretches snapped to the tracker's 16th grid.
- **Cross-check against osu red lines.** `shared/data/songs/<id>.json` has `variable_bpm`, which means more than one
  beat length among the red lines.

## Controls

| check | result |
|---|---|
| Synthetic: people's notes slowed 10% over 16 beats (2 places × 63 steady songs) | people detector finds 122/126 (mean +9.6%) and adds 2 other stretches; A1 126/126; A2 126/126 |
| Quiet on the 63 songs with one human BPM | people detector: **0 songs**, 0.0% of beats. A1: 47/63 songs, 10.5% of beats. A2: 39/63 songs, 4.9% of beats |
| Without the 1/6 grid (first run) | 2 false songs (Armageddon, Hana ni Natte), both at exactly −11.1% = 8/9, a triplet alias. Fixed with the 1/6 grid |
| Off-grid pool measure (people's notes > 20 ms off our 1/4 and 1/6 grid) | 21.4% of the synthetic stretch's notes vs 0.8% of the same notes unwarped |
| ASGORE (played song, no human chart) | A1 flags 1:46.4–1:52.9 (+5.9%). A2 does **not**. Our grid stays at 522.4 ms there |
| Precision against osu red lines | all 7 songs the people detector flags have `variable_bpm`, and so do all 10 stretches |

**What ASGORE is (from the onsets and tracker beats).** The music is on our grid up to 1:47.45. Between 1:47.5 and
1:48.7 the sounds run late, by +23, +29, +62 ms, and one is −54 ms. Over about 2.5 beats the music stretches by about
half a beat. Then it carries on at **the same 522 ms**, but half a beat shifted: the tracker's beats land on our offbeats
from there on. After 1:48.7 every sound is back within 15 ms of our 16th grid. So this is a short fermata plus a
half-beat phase flip, not a lasting slowdown. That is the half-beat phase problem already noted in
`mewbeat-v29-research-findings`. A1 flags it only because the half-beat shift accumulates over its span. The people
detector could not see an event this short (it needs 8 beats with 8 notes).

## Results per level

| level | songs (with a stretch) | people's notes in stretches | F1 in stretches | F1 rest | F1 whole | (a) moved to local grid | (b) oracle 80 ms | (b) oracle 130 ms | (c) tracker snap |
|---|---|---|---|---|---|---|---|---|---|
| Easy | 78 (7) | 80 / 29 578 = **0.3%** | 0.266 | 0.722 | 0.7206 | −0.0001 | **+0.0006** (in: 0.47) | +0.0012 | **−0.0017** |
| Normal | 77 (7) | 146 / 44 037 = **0.3%** | 0.380 | 0.803 | 0.8017 | −0.0001 | **+0.0007** (in: 0.62) | +0.0009 | **−0.0015** |
| Hard | 74 (6) | 106 / 60 354 = **0.2%** | 0.458 | 0.770 | 0.7696 | 0.0000 | **+0.0003** (in: 0.60) | +0.0004 | **−0.0013** |

- **On which grid people's notes sit.** Inside the stretches (186 notes), 53% are within 20 ms of our 16th grid and 62%
  are on the fitted local quarter grid. Elsewhere 97.4% are on our 16th grid.
- **Where our F1 is lost inside the stretches.** It is mostly selection, not timing. Of our unmatched notes there,
  64/83 (Easy), 43/76 (Normal) and 44/68 (Hard) are more than 80 ms from any human note.
- **The whole pool a better grid could reach.** People's notes more than 20 ms off both our 16th and our 1/6 grid are
  0.2% (Easy), 0.4% (Normal) and 0.7% (Hard). Between 87% and 97% of them lie *outside* the tempo stretches, and we already match
  41–53% of them at 35 ms. Notes more than 35 ms off both grids: at most 0.1%.
- **Do mappers follow the music?** Yes, where the tempo really changes: they place a new red line. All 10 stretches are
  on osu-variable songs, and the tracker sees 8 of the 10. Most tracker departures, however, are not tempo changes: in
  211 of its 256 stretches, people's notes stay flat on our grid (|r| < 1.5%). That is tracker slips and half-beat
  flips, not mappers ignoring a change.
- **How many songs change tempo?** 17/80 train songs have more than one BPM in osu. Only 7 change by 3% or more for 10+
  beats. The other 10 have changes that are short or small, and people's notes there are still 95.6–99.9% on our
  single-BPM grid. Our fitted grid has one BPM on all 16 variable songs that have a grid.

## Songs with a stretch (people's local tempo against our grid)

| song | our BPM | stretch | change | people's notes in / all (Normal) | F1 in / rest (Normal) |
|---|---|---|---|---|---|
| 2006713 Hold On Tight | 120 | 0:04.3–0:09.3 (intro) | −10.9% | 11 / 567 | 0.27 / 0.81 |
| 1864421 KICK BACK (TV Size) | 204 | 1:23.5–1:26.4 (outro, song is 1:30) | −6.3% (max −9.0%) | 6 / 440 | 0.71 / 0.82 |
| 1664904 Euphoria (Cut Ver.) | 200 | 2:17.4–2:23.8 | −8.5%, then −7.7% | 26 / 934 | 0.48 / 0.79 |
| 650415 Mazare Party | 200 | 3:50.4–3:53.4 (outro, song is 4:02) | −6.4% | 4 / 1013 | 0.50 / 0.86 |
| 2515787 Tracen Ondo | 165 | 1:11.2–1:14.8 | −3.5% | 12 / 744 | 0.40 / 0.72 |
| 1224013 Ascension to Heaven | 200 | 4:56.3–5:00.5 (outro, song is 5:12) | +7.4% | 10 / 1207 | 0.35 / 0.78 |
| 897547 Resurrection Spell | 180 | 1:59.4–2:02.8, 2:00.8–2:07.4, 2:09.4–2:17.4 | +3.9%, −6.8%, −9.4% (max −10%) | 77 / 666 | 0.32 / 0.79 |

Most are rits in an intro or outro, 3–8 s long, slowing 6–11%. Resurrection Spell is the only song with a longer
middle section, and its Hard is missing.

## Recommendation

**No tempo-following grid, and no flag for it now.** The ceiling is below +0.001 F1 on every level: 0.3% of people's
notes lie in such stretches, and even a perfect timing oracle there gains +0.0003 to +0.0007. A grid fitted to people's
local tempo gains nothing (±0.0001), because our misses there are mostly the choice of moments. The only signal we
would have in the plugin, the tracker, false-flags three quarters of the steady songs (10.5% of beats). Its realistic
version *loses* 0.0013–0.0017 F1 per level.

What ASGORE shows is a **short fermata and then a half-beat phase flip**, and that is where to look instead. A
per-stretch beat-phase fix, or keeping raw onset times in the 1–2 s of a fermata, fits better than a tempo curve.

If it is ever built (for example if the user keeps hearing outro rits as wrong), here is a sketch:

- **Where it hooks in.** `beatFit.js` `fitBeats`: allow a smooth period curve inside a stretch, for example a
  per-8-beat-window period from the onset comb, with `MIN_STRETCH_MS` lowered for the last and first 10 s. `timing.js`
  `gridPoints` already interpolates uneven beats, so nothing downstream changes.
- **Gating.** Allow a curve only where the comb gain is clear and the tracker agrees. Keep a constant period elsewhere.
- **Risks.** False curves on steady songs, which would break the equal gaps of Easy and the copied repeats
  (`repeats.js` copies by time offset). Interplay with `keepMainTempo`, `mergeParts` and `feltTempo`. And the Pi's time
  budget.

## Caveats

- The people detector needs 8 notes in 8 beats and searches only ±12%. It cannot see sparse rubato (fermatas, Easy-only
  passages), changes shorter than about 10 beats, or jumps to 3/4 or 4/3. The off-grid pool (at most 0.7% of notes, 87–97%
  of it outside the stretches) bounds what all of these could still add.
- F1 at 35 ms is blind to timing errors under 35 ms. On fast songs a 16th is only 75 ms, so almost every note is within
  37 ms of some grid point.
- These are train songs only, with the test set unused. The user plays slower songs (anime, game music such as
  ASGORE); expressive rubato may be more common there than in this corpus.
- ASGORE's shape was read from the features, not by ear.
