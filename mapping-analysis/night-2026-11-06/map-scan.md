# mewbeat chart scan (night 2026-11-06)

Read-only scan of generated charts: 42 songs with usable features (47 feature files; 5 are `{uncharted:true}` stubs without `bands` and are skipped: 6534f1f0, 8513f891, 91ec42bc, d8043011, f0570cba) x 4 levels (easy, normal, hard, hell), generated without flags by the frozen generator copy. Nothing in the repo was changed except this file. Full findings as JSON: `C:/Users/moskw/AppData/Local/Temp/claude/C--Users-moskw-Documents-dev-MewBit/f7a02774-2172-40bf-be12-cc3b2f061635/scratchpad/research/scan/map-scan-findings.json` (every spot with per-level parts, plus the config and control results). Scripts live in the same folder (`detectors.js`, `scan.js`, `controls.js`, `build-report.js`).

These are spots to listen to, not verdicts: the detectors work from the analysis (energy curve, onsets, phrases, grid), so a spot can also be an analysis error.

## Method

Inputs: `analyse(features)` gives ctx (grid `timing`, `energy.at(t)`, `phrases`, merged `features`), `generateChart(features, level, key)` gives the notes. Chords are notes that share a time (within 3 ms). Beat length is `timing.beatMsAt(t)` (500 ms if the song has no snapped grid). "Moment" = a distinct note time. A hold counts as occupying time until it lets go. `energy.at(t)` is the per-song normalised loudness (median about 0.8). Onsets are drums/bass/lead events from the features with strength `s`.

Detector definitions (all thresholds are the numbers in `detectors.js` CFG):

1. **Hole under loud music.** A gap between two consecutive moments (start = latest hold release so far) that is at least N beats long, N = easy 3, normal 2, hard 1.5, hell 1.5. The mean energy in the gap is at least 0.6 and at least 3 source onsets with strength >= 0.3 (drums, bass or lead, 50 ms inside each edge) fall in it. Severity = min(3, beats/N) x energy x (0.5 + 0.5 x busy), busy = min(1, onsets / (2 x beats)).
2. **Chord in a quiet place.** A moment with 2 or more notes where `energy.at(t)` is below the song's quiet limit = clamp(the 20th percentile of the song's energy, 0.12, 0.20). Severity = 0.6 x min(3, 0.5 + 1.5 x (limit - energy)/limit) x min(1.5, size/2) (the 0.6 keeps this detector, which fires far more often, from crowding the top list).
3. **Density jump.** Windows of 8 beats (2 bars, stepped by 4 beats, two phases) compared with the next one: moments per second ratio (both sides +0.3 notes/s) at least 2, the louder-side rate at least 1 note/s, mean energy of the two windows differing by less than 0.15, and the quieter one at least 0.1 (not silence). Severity = min(3, ratio/2) x mean energy x 0.8.
4. **Hold cut short.** A hold shorter than 1 beat while a source bass or lead note with a length starts within 120 ms of the hold head and goes on at least 1 beat past the hold end (sustained sound under it), and either (a) the next note (any lane) is at least 1 beat after the hold end and the energy a beat later is within 0.15 of the energy at the hold end (>= 0.25), or (b) the hold ends within 150 ms before a new phrase of energy >= 0.6 starts.
5. **Phrase seam.** Only at seams where both neighbouring phrases have energy >= 0.6. (gap) an empty stretch spanning the seam (it must reach within a quarter beat of it) of at least easy 2.5, normal 1.5, hard 1.25, hell 1.25 beats; (density) 4 beats before vs 4 beats after the seam differ by a ratio of at least 2.5 (smoothed, at least 1 note/s on the denser side) with mean energy within 0.15.
6. **Off-grid stretch** (level free, it measures the source onsets against the fitted grid, not the chart). Onsets with strength >= 0.2 (drums, bass, lead) are measured against the nearest quarter-beat grid point (`gridPoints(4)`). Windows of 4 beats (stepped one beat, at least 6 onsets): (6a) at least 65% of the onsets are more than 35 ms from the grid; (6b, lock collapse) the circular concentration R of the onset phases within the quarter beat falls below 0.25 and is at least 0.3 lower than the median of the 13 windows before it, with at least 20 onsets and at least 30% more than 35 ms off. Overlapping windows are joined to stretches. Only songs with a snapped grid are scanned.

Merging and score: findings of one level within 2 s of each other become one spot (severity = the strongest + 0.1 x each other, each capped at 1.5, the extra at most 0.6). The final list then merges the levels too (same song, within 2 s): severity = the strongest item + 0.1 x each other item (extra at most 0.6) + 0.15 per extra level (at most +0.45). Severity is about 0 to 3: 1 = just over the threshold at a loud place. The scales of the detectors are only roughly comparable, so look at the table per detector as well as the top list.

Deviations from the first plan, all made to keep the lists manageable or to make the detector fire on a known case:
- Detector 4 asks for the next note 1 beat after the hold end (not 2): with 2 beats it found almost nothing.
- Detector 2's quiet limit is clamped to 0.12-0.20 (an unclamped 20th percentile gave hundreds of findings on songs that are quiet throughout). Even so it is the biggest list on hard and hell (278 and 243 chords), so it is the weakest detector as a list. Hard and hell simply play chords more often.
- Detector 5 on hard and hell uses 1.25 beats (1.5 gave 158 findings on hard).
- Detector 6b was added because the pure share criterion (6a) does not fire on the known ASGORE case: the grid there is perfectly regular (522 ms) and the strong onsets keep sitting within a few ms of it, but at about 1:47 the onsets drift apart in phase and the beat lock collapses (R 0.16 against 0.50 before).
- Titles come from history.json (sha1 of the audioKey); songs not in history are labelled by video id. The same K/DA FIRESTARTER song is in two feature files (83eea9 and c0b135) and is counted twice.

### Controls (planted defects)

Each defect was planted in a copy of the notes (or of the features for detector 6) of a real song, at a place where the detector did not fire before; the detector had to fire at the planted spot. Normal-level notes were used for the chart detectors.

| Control | Detector | Song | Planted | Fired before? | Result |
|---|---|---|---|---|---|
| 1 | 1 hole under loud music | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | deleted 6 notes in 00:30.3-00:32.2 (3 beats, energy 0.81) | no | **PASS**: 3.5 beats empty, energy 0.82, drums+bass+lead present (25 onsets) |
| 2 | 2 chord in a quiet place | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | 2-note chord at 01:38.5 (energy 0.15, limit 0.20) | no | **PASS**: 2-note chord at energy 0.15 (quiet limit 0.20) |
| 3 | 3 density jump | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | kept every 4th moment in 00:35.0-00:40.0 (3.8 -> about 0.9 notes/s, energy flat 0.83/0.87/0.88) | no | **PASS**: notes/s 3.4 -> 1.0 (down, x2.8) at a boundary, energy 0.83 -> 0.87 |
| 4a | 4 hold cut short | untitled 10d1b695 | 0.5-beat hold at 00:49.0 on a 4.3-beat bass sound, no notes for the next 3 beats | no | **PASS**: 0.50-beat hold on a 4.3-beat bass sound; sound goes 3.8 beats on, next note 4.4 beats later, energy 0.98 |
| 4b | 4 hold cut short (ends at a phrase start) | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | 0.5-beat hold ending 40 ms before loud phrase 3 at 00:30.2, a 3-beat sound planted under it | no | **PASS**: 0.50-beat hold ends 39 ms before loud phrase 3 (energy 0.86); lead sound goes 2.5 beats on |
| 5a | 5 phrase seam (gap) | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | emptied 2.4 beats around the seam of phrase 4 at 00:40.2 (phrase energies 0.86 / 0.87) | no | **PASS**: 2.8 beats empty across phrase seam 4 (phrase energies 0.86 / 0.87, gap energy 0.87) |
| 5b | 5 phrase seam (density) | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | kept every 5th moment in the 4 beats after the seam of phrase 4 at 00:40.2 (3.2 -> about 0.6 notes/s) | no | **PASS**: density 4.4 -> 0.8 notes/s (x4.3) exactly at phrase seam 4, energy 0.85 -> 0.87 |
| 6a | 6 off-grid stretch | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) | onsets in 00:30.5-00:34.2 (6 beats) moved to 55 ms (or 0.45 of a quarter beat if shorter) either side of the nearest quarter-beat grid point, alternating | no | **PASS**: 10 beats where 88% of onsets sit >35 ms off the quarter grid (mean 50 ms), energy 0.78 |
| 6b | 6 off-grid stretch (real example) | Toby Fox - ASGORE | none (real song): music slows from about 1:47.5 | yes (real) | **PASS**: 6 beats where the onsets lose the beat lock (phase concentration 0.16 vs 0.50 before; 33% >35 ms off the grid), energy 0.72 |

All controls passed. The first version of the detector 6 control (plain +-50 ms jitter) did not fire: the jitter partly cancelled the real offsets of the onsets, so the control was changed to place the onsets a fixed 55 ms either side of the grid points (a real defect would look like that). 6b is the real ASGORE case, not a planted one, and is only found by the lock-collapse variant.

## Summary

Findings per detector and level (raw detections, before merging):

| Detector | easy | normal | hard | hell | all levels (level-free) | total |
|---|---:|---:|---:|---:|---:|---:|
| 1 hole under loud music | 33 | 10 | 48 | 16 | - | 107 |
| 2 chord in a quiet place | 25 | 103 | 278 | 243 | - | 649 |
| 3 density jump | 56 | 55 | 40 | 46 | - | 197 |
| 4 hold cut short | 1 | 0 | 15 | 9 | - | 25 |
| 5 phrase seam | 30 | 7 | 27 | 16 | - | 80 |
| 6 off-grid stretch | 0 | 0 | 0 | 0 | 81 | 81 |
| **sum** | 145 | 175 | 408 | 330 | 81 | 1139 |

Spots per detector and level (after merging within 2 s in a level; a spot with two detectors counts for both):

| Detector | easy | normal | hard | hell | all levels (level-free) | total |
|---|---:|---:|---:|---:|---:|---:|
| 1 hole under loud music | 33 | 10 | 39 | 11 | - | 93 |
| 2 chord in a quiet place | 20 | 58 | 94 | 102 | - | 274 |
| 3 density jump | 41 | 38 | 33 | 36 | - | 148 |
| 4 hold cut short | 1 | 0 | 15 | 9 | - | 25 |
| 5 phrase seam | 26 | 7 | 25 | 15 | - | 73 |
| 6 off-grid stretch | 0 | 0 | 0 | 0 | 78 | 78 |
| **sum** | 121 | 113 | 206 | 173 | 78 | 691 |

After the cross-level merge there are **307 spots** in total (119 on a single level only, 71 on 3 or more levels).

Spots flagged by the same detector on 3 or more levels at once (a sign of an analysis cause rather than a generator one): hole 2, quiet chord 43, density jump 17, short hold 0, seam 4. The quiet chords are the clear case (43 of 102 quiet-chord spots have a chord on 3 or more levels at the same place): the chart builds chords at the same quiet moments on every level, so the cause sits in the shared analysis (an energy dip or intro/outro where the lead still plays), not in one level's thinning. Density jumps repeat across levels in 17 of 87 spots, seams in 4 of 56; holes (2 of 73) and short holds (0 of 22) are level specific, so those come from how each level thins the notes.

## TOP 40 by severity

| # | Song | Level(s) | Time | Detector | What | Sev |
|---|---|---|---|---|---|---:|
| 1 | untitled youtube:mD3v1B_aXw0 (94898d) | easy, hard, hell | 01:03.7 - 01:06.2 | hole + seam | 3.3 beats empty, energy 0.91, drums+lead present (11 onsets) | 2.84 |
| 2 | Camellia Official - Camellia - Exit This Earth's Atomosphere (from PLANET//SHAPER) (62f7f8) | easy, normal, hard, hell | 00:03.6 - 00:19.8 | quiet chord | 3-note chord at energy 0.10 (quiet limit 0.20) | 2.81 |
| 3 | SAWTOWNE - M@GICAL☆CURE! LOVE SHOT! (feat. Hatsune Miku) (34ebbb) | easy, normal, hard, hell | 02:39.3 - 02:46.5 | hole + quiet chord + density jump + short hold | 0.50-beat hold on a 4.1-beat lead sound; sound goes 3.5 beats on, next note 1.0 beats later, energy 0.75 | 2.78 |
| 4 | DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | easy, normal, hard, hell | 13:15.6 - 13:22.5 | quiet chord | 3-note chord at energy 0.08 (quiet limit 0.20) | 2.75 |
| 5 | Leslie Odom, Jr. - Alexander Hamilton (27635f) | easy, normal, hard, hell | 00:04.7 - 00:22.1 | quiet chord + density jump | 3-note chord at energy 0.12 (quiet limit 0.20) | 2.36 |
| 6 | Original Soundtrack - Hyper - Spoiler / Cyberpunk 2077 OST (29f6b0) | easy, normal, hard, hell | 04:33.0 - 04:46.4 | quiet chord + off-grid | 3-note chord at energy 0.12 (quiet limit 0.20) | 2.33 |
| 7 | Camellia - GHOST (4cddf7) | easy, normal, hard, hell | 05:23.3 - 05:36.2 | quiet chord + density jump | 3-note chord at energy 0.15 (quiet limit 0.20) | 2.23 |
| 8 | DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | easy, normal, hard, hell | 00:06.3 - 00:26.3 | quiet chord + density jump | 2-note chord at energy 0.10 (quiet limit 0.20) | 2.20 |
| 9 | HEARTSTEEL - Live My Life (9b7482) | easy, hard | 00:30.6 - 00:35.8 | hole + short hold | 0.50-beat hold ends 123 ms before loud phrase 5 (energy 0.88); bass sound goes 4.0 beats on | 2.14 |
| 10 | Camellia Official - Camellia - Exit This Earth's Atomosphere (from PLANET//SHAPER) (62f7f8) | easy, normal, hard, hell | 02:54.0 - 03:04.6 | quiet chord + density jump | 3-note chord at energy 0.14 (quiet limit 0.20) | 2.10 |
| 11 | The Living Tombstone - Five Nights at Freddy's (22dbb2) | easy, hard, hell | 00:56.0 - 01:00.4 | hole + density jump + short hold | 4.0 beats empty, energy 0.94, drums+lead+bass present (11 onsets) | 2.06 |
| 12 | Toby Fox - Hopes And Dreams (2a3912) | hard, hell | 02:37.6 - 02:45.0 | hole + seam | 2.0 beats empty across phrase seam 28 (phrase energies 0.94 / 0.90, gap energy 0.85) | 2.05 |
| 13 | Toby Fox - Finale (cae199) | easy, normal, hard, hell | 01:47.2 - 01:48.9 | quiet chord | 3-note chord at energy 0.10 (quiet limit 0.20) | 1.98 |
| 14 | Toby Fox - Hopes And Dreams (2a3912) | hard, hell | 02:26.3 - 02:35.5 | hole + seam + off-grid | 2.0 beats empty, energy 0.87, drums present (6 onsets) | 1.92 |
| 15 | SAWTOWNE - M@GICAL☆CURE! LOVE SHOT! (feat. Hatsune Miku) (34ebbb) | easy, normal, hard | 03:14.3 - 03:17.6 | density jump | notes/s 2.4 -> 0.0 (down, x9.0) at a boundary, energy 0.56 -> 0.58 | 1.89 |
| 16 | The Living Tombstone - Five Nights at Freddy's (22dbb2) | easy, normal, hard, hell | 00:01.9 - 00:07.8 | quiet chord + density jump | 2-note chord at energy 0.09 (quiet limit 0.20) | 1.87 |
| 17 | DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | easy, hard, hell | 08:51.5 - 09:04.5 | hole + density jump + short hold + seam | 0.50-beat hold on a 2.4-beat bass sound; sound goes 1.9 beats on, next note 1.0 beats later, energy 0.74 | 1.83 |
| 18 | Original Soundtrack - Hyper - Spoiler / Cyberpunk 2077 OST (29f6b0) | normal, hard, hell | 04:49.4 - 04:57.1 | quiet chord + density jump | 3-note chord at energy 0.12 (quiet limit 0.20) | 1.79 |
| 19 | Leslie Odom, Jr. - Alexander Hamilton (27635f) | normal, hard, hell | 01:26.5 - 01:37.9 | quiet chord + off-grid | 3-note chord at energy 0.13 (quiet limit 0.20) | 1.77 |
| 20 | Leslie Odom, Jr. - Alexander Hamilton (27635f) | normal, hard, hell | 00:40.4 - 00:44.1 | quiet chord + short hold | 0.50-beat hold on a 7.8-beat bass sound; sound goes 7.4 beats on, next note 1.0 beats later, energy 0.27 | 1.77 |
| 21 | K/DA - FIRESTARTER (83eea9) | hell | 02:06.4 - 02:08.0 | short hold | 0.50-beat hold on a 3.6-beat bass sound; sound goes 3.1 beats on, next note 1.0 beats later, energy 0.88 | 1.74 |
| 22 | K/DA - FIRESTARTER (c0b135) | hell | 02:06.4 - 02:08.0 | short hold | 0.50-beat hold on a 3.6-beat bass sound; sound goes 3.1 beats on, next note 1.0 beats later, energy 0.88 | 1.74 |
| 23 | Camellia Official - Camellia - Exit This Earth's Atomosphere (from PLANET//SHAPER) (62f7f8) | easy, hard | 02:27.6 - 02:29.4 | hole + seam | 4.0 beats empty across phrase seam 26 (phrase energies 0.91 / 0.83, gap energy 0.88) | 1.65 |
| 24 | DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | easy, hard, hell | 09:11.7 - 09:19.7 | hole + density jump | 2.0 beats empty, energy 0.76, drums+lead present (7 onsets) | 1.65 |
| 25 | DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | easy, normal, hard, hell | 10:34.8 - 10:39.5 | quiet chord + density jump | 2-note chord at energy 0.10 (quiet limit 0.20) | 1.63 |
| 26 | untitled youtube:NMA_isZYsYQ (10d1b6) | easy, normal | 00:48.9 - 00:52.7 | hole + density jump | 5.0 beats empty, energy 0.77, bass+drums+lead present (19 onsets) | 1.60 |
| 27 | Toby Fox - Finale (cae199) | easy, hard, hell | 00:30.1 - 00:31.1 | hole + seam | 2.0 beats empty across phrase seam 6 (phrase energies 0.71 / 0.73, gap energy 0.73) | 1.59 |
| 28 | Leslie Odom, Jr. - Alexander Hamilton (27635f) | easy, hard, hell | 01:44.9 - 01:46.3 | quiet chord | 3-note chord at energy 0.12 (quiet limit 0.20) | 1.59 |
| 29 | DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | easy, hard, hell | 05:49.1 - 05:57.3 | hole + density jump | notes/s 3.2 -> 0.8 (down, x3.2) at a boundary, energy 0.88 -> 0.79 | 1.59 |
| 30 | Marcin - Carmen (69ffbb) | normal, hard, hell | 01:48.5 - 01:57.9 | hole + quiet chord + density jump | 3.5 beats empty, energy 0.63, drums+lead+bass present (10 onsets) | 1.58 |
| 31 | Toby Fox - Hopes And Dreams (2a3912) | easy, normal, hard, hell | 00:19.1 - 00:22.6 | hole + quiet chord | 4.0 beats empty, energy 0.71, drums+bass present (20 onsets) | 1.56 |
| 32 | Camellia - GHOST (4cddf7) | easy, normal, hard, hell | 02:06.8 - 02:16.4 | density jump | notes/s 3.2 -> 0.5 (down, x4.6) at a boundary, energy 0.49 -> 0.41 | 1.54 |
| 33 | Pinkpantheress - PinkPantheress - Stateside + Zara Larsson (Official Video) (478513) | normal, hard, hell | 03:09.9 - 03:12.1 | quiet chord | 2-note chord at energy 0.09 (quiet limit 0.20) | 1.52 |
| 34 | Leslie Odom, Jr. - Alexander Hamilton (27635f) | easy, hard, hell | 00:27.2 - 00:32.8 | quiet chord + density jump + off-grid | 3-note chord at energy 0.13 (quiet limit 0.20) | 1.50 |
| 35 | The Living Tombstone - Five Nights at Freddy's (22dbb2) | easy | 02:10.5 - 02:14.9 | hole + density jump | 4.0 beats empty, energy 0.95, drums+lead+bass present (11 onsets) | 1.50 |
| 36 | Ilmari Hakkola - Bad Piggies Theme (603a46) | normal, hard, hell | 02:33.0 - 02:36.2 | quiet chord + density jump | 2-note chord at energy 0.08 (quiet limit 0.20) | 1.49 |
| 37 | Alex Brightman - Say My Name (daa480) | normal, hard, hell | 03:02.2 - 03:10.3 | hole + quiet chord + density jump | 1.5 beats empty, energy 0.95, drums present (6 onsets) | 1.46 |
| 38 | The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) (0045dd) | easy, normal, hard, hell | 00:09.0 - 00:13.5 | quiet chord + density jump | 2-note chord at energy 0.12 (quiet limit 0.20) | 1.45 |
| 39 | Camellia - GHOST (4cddf7) | easy, normal, hard, hell | 00:11.4 - 00:16.7 | quiet chord + density jump | 2-note chord at energy 0.10 (quiet limit 0.20) | 1.45 |
| 40 | untitled youtube:NabNBUDelmk (432f3b) | easy, normal, hard, hell | 02:47.0 - 02:49.0 | density jump | notes/s 2.0 -> 5.7 (up, x2.6) at a boundary, energy 0.73 -> 0.79 | 1.45 |

## Findings per song

"Spots" are after the cross-level merge; "raw" is the number of raw detections; D1-D6 are the spots in which that detector appears. The grid column says whether the song has a snapped beat grid (detector 6 only works on those).

| Song | Grid | Spots | Raw | D1 | D2 | D3 | D4 | D5 | D6 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DM DOKURO - Terraria Calamity Mod Music - The Devourer of Gods (Nonstop Mix) (31758f) | yes | 33 | 201 | 9 | 4 | 22 | 4 | 7 | 1 |
| Camellia - GHOST (4cddf7) | yes | 21 | 85 | 9 | 4 | 7 | 2 | 6 | 0 |
| Camellia Official - Camellia - Exit This Earth's Atomosphere (from PLANET//SHAPER) (62f7f8) | yes | 17 | 157 | 3 | 4 | 7 | 3 | 4 | 5 |
| Toby Fox - Hopes And Dreams (2a3912) | yes | 16 | 49 | 12 | 3 | 2 | 1 | 9 | 1 |
| Alex Brightman - Say My Name (daa480) | yes | 14 | 39 | 5 | 5 | 4 | 1 | 4 | 0 |
| Leslie Odom, Jr. - Alexander Hamilton (27635f) | yes | 12 | 98 | 1 | 11 | 2 | 1 | 0 | 2 |
| Camellia Official - Rude Buster (Camellia Remix) [Deltarune Battle Theme] (241ccb) | yes | 12 | 13 | 1 | 0 | 0 | 0 | 1 | 10 |
| Marcin - Carmen (69ffbb) | yes | 10 | 27 | 4 | 2 | 5 | 0 | 4 | 3 |
| K/DA - FIRESTARTER (83eea9) | yes | 10 | 15 | 0 | 4 | 0 | 1 | 0 | 5 |
| K/DA - MORE (8441ce) | yes | 10 | 15 | 2 | 1 | 3 | 2 | 2 | 2 |
| K/DA - FIRESTARTER (c0b135) | yes | 10 | 15 | 0 | 4 | 0 | 1 | 0 | 5 |
| Pinkpantheress - PinkPantheress - Stateside + Zara Larsson (Official Video) (478513) | yes | 9 | 20 | 3 | 3 | 1 | 0 | 1 | 4 |
| Toby Fox - Finale (cae199) | yes | 8 | 44 | 2 | 4 | 1 | 0 | 2 | 0 |
| RetroSpecter - DELTARUNE - REVOLVANIA (THE WORLD REVOLVING x Megalovania Remix) (8df466) | yes | 8 | 24 | 3 | 1 | 3 | 1 | 3 | 0 |
| K/DA - GIRLS (d786d0) | yes | 8 | 23 | 0 | 6 | 0 | 0 | 2 | 0 |
| The Living Tombstone - Five Nights at Freddy's 2 Song - The Living Tombstone (FNAF2) (0045dd) | yes | 8 | 22 | 0 | 5 | 2 | 1 | 0 | 2 |
| The Living Tombstone - Five Nights at Freddy's (22dbb2) | yes | 7 | 35 | 4 | 2 | 3 | 1 | 1 | 0 |
| untitled youtube:oZdO3yHSYYw (098a2e) | yes | 7 | 20 | 0 | 5 | 1 | 0 | 0 | 3 |
| HEARTSTEEL - Live My Life (9b7482) | yes | 7 | 18 | 5 | 1 | 1 | 1 | 2 | 2 |
| K/DA - POP/STARS (e1d58c) | yes | 7 | 17 | 1 | 3 | 4 | 1 | 2 | 0 |
| P.T. Adamczyk - The Rebel Path (c353ab) | yes | 7 | 14 | 0 | 3 | 2 | 0 | 0 | 4 |
| untitled youtube:NabNBUDelmk (432f3b) | yes | 6 | 9 | 2 | 1 | 1 | 0 | 0 | 2 |
| Hazbin Hotel - Gravity (7d29af) | yes | 6 | 8 | 0 | 3 | 0 | 0 | 0 | 3 |
| Original Soundtrack - Hyper - Spoiler / Cyberpunk 2077 OST (29f6b0) | yes | 5 | 46 | 0 | 4 | 2 | 0 | 0 | 4 |
| Strada - Skarazula Marazula (b9488c) | yes | 5 | 14 | 2 | 3 | 1 | 0 | 1 | 0 |
| Camellia Official - Coffin Dance (Camellia Remix) (b7aba8) | yes | 5 | 10 | 1 | 1 | 1 | 0 | 3 | 0 |
| untitled youtube:FXovf5dsRTw (953d2b) | yes | 4 | 11 | 0 | 2 | 3 | 0 | 0 | 1 |
| Creepy Nuts - Bling-Bang-Bang-Born (642b9f) | yes | 4 | 4 | 0 | 1 | 0 | 0 | 0 | 3 |
| SAWTOWNE - M@GICAL☆CURE! LOVE SHOT! (feat. Hatsune Miku) (34ebbb) | yes | 3 | 19 | 2 | 1 | 2 | 1 | 0 | 0 |
| The Living Tombstone - Die In a Fire (feat. EileMonty & Orko) (476f5b) | yes | 3 | 11 | 0 | 2 | 1 | 0 | 0 | 2 |
| royaltyfreesfx - Chainsaw Sound Effect (3fdec5) | no | 3 | 8 | 0 | 3 | 1 | 0 | 0 | 0 |
| untitled youtube:NMA_isZYsYQ (10d1b6) | yes | 3 | 5 | 1 | 0 | 2 | 0 | 0 | 1 |
| Toby Fox - ASGORE (fbe1c8) | yes | 3 | 5 | 0 | 1 | 1 | 0 | 0 | 3 |
| Kenshi Yonezu - IRIS OUT (9eb8d8) | yes | 3 | 3 | 0 | 0 | 0 | 0 | 1 | 2 |
| Ilmari Hakkola - Bad Piggies Theme (603a46) | yes | 2 | 12 | 0 | 1 | 1 | 0 | 0 | 1 |
| K/DA - Topic - WATCH ME (bdf083) | yes | 2 | 4 | 0 | 1 | 0 | 0 | 0 | 1 |
| Tymek TM - Coffin Dance (Astronomia) - Camelia / Beat Saber / TymekTM (8b8e0a) | yes | 2 | 2 | 0 | 1 | 0 | 0 | 0 | 1 |
| untitled youtube:ooLulWlMCEk (90eb65) | yes | 2 | 2 | 0 | 1 | 0 | 0 | 0 | 1 |
| K/DA - NEVER GOING BACK (e767ab) | yes | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| untitled youtube:mD3v1B_aXw0 (94898d) | yes | 1 | 9 | 1 | 0 | 0 | 0 | 1 | 0 |
| untitled youtube:xCIoeUlAnl4 (aa03cc) | no | 1 | 3 | 0 | 1 | 0 | 0 | 0 | 0 |
| Toby Fox - 32. Cutie Mew Mew Magic (DELTARUNE Chapter 5 Soundtrack) - Toby Fox & @Cametek.CamelliaOfficial (6132d1) | yes | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
