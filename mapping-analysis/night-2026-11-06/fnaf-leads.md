# FNAF 2 leads: highmid beat phase and bass leading loud phrases (task 5)

2026-11-06. This is a read-only study on the frozen generator, using the 80 train songs (79 Easy, 78 Normal, 75 Hard human charts). I did not read the test songs. Scripts and raw JSON are in the session scratchpad at `research/fnaf/`. The simulations ran on a copy of `charts/` with environment switches (`sim/`). With no switch set, the copy's charts are byte-identical to the frozen ones.

**Matching:** I compare moments, meaning distinct note times, ours against people's. A match is one-to-one greedy (closest pairs first) within 35 ms. F1 is given as the mean over songs and as a pooled figure.

## A. Half-beat phase from the highmid band

**The premise is already the code.** `beatFit.js` (`fitBeats` → `beatRuns`) fits the quarter grid from all bands, but it picks which quarter is the beat from **highmid alone** (`BEAT_BAND = 2`). The FNAF 2 note ("beatFit picks phase from highmid alone") was raising a doubt about that choice. So I tested the opposite question: does any other source (full mix, mix without highmid, low, lowmid, high) give the phase people play where it disagrees with highmid?

**Method.**
- I re-fitted each song with each source and labelled every beat of the current grid as same, quarter-off or half-off relative to the alternative.
- Probe: the share of people's moments within 25 ms of each grid's beats, counted only inside the beat intervals where the two grids are half a beat apart. The grid with more human notes on its beats is the one people play.

**Controls (both pass).**
- People's notes shifted by half a beat: the whole-song probe calls the current grid off-phase on 77/77 Easy songs that were on-phase, 74/74 Normal and 71/71 Hard. On-beat share goes from 0.750 to 0.223 (Easy).
- In every pairwise comparison, the half-beat shift flips the winner (for example mix 4/4 and low 39/39).
- A deliberately flipped grid (current phase + 2 quarters) drops F1 to Easy .716→.311, Normal .798→.775 and Hard .769→.760, with 76, 58 and 47 songs down. F1 does see a half-beat error, strongly on Easy and mildly on Hard.

**Where the sources disagree with highmid, and whom people follow** (people-on-beat share pooled over the disagreeing intervals):

| source | songs ≥10% half-off | Easy: highmid wins / alt wins | Normal | Hard | Easy on-beat, highmid vs alt |
|---|---|---|---|---|---|
| full mix | 4 | 4 / 0 | 3 / 0 | 3 / 0 | .885 vs .101 |
| mix without highmid | 8 | 8 / 0 | 7 / 0 | 7 / 0 | .856 vs .119 |
| low | 39 | 39 / 0 | 37 / 1 | 37 / 1 | .767 vs .205 |
| lowmid | 6 | 6 / 0 | 5 / 0 | 5 / 0 | .820 vs .158 |
| high | 13 | 11 / 2 | 10 / 2 | 9 / 2 | .677 vs .307 |

**F1 if the beat came from another source** (mean over songs, then pooled):

| variant | Easy | Normal | Hard | songs changed (Easy) |
|---|---|---|---|---|
| current (highmid) | .7164 / .7166 | .7983 / .7985 | .7694 / .7677 | – |
| full mix | .6869 / .6871 | .7961 / .7957 | .7689 / .7667 | 6 (1 up, 5 down) |
| high | .6529 / .6697 | .7877 / .7888 | .7677 / .7659 | 17 (3 up, 13 down) |
| high on Borealis + Made Of Fire only (oracle) | +.011 on the mean | +.0008 | +.0004 | 2 (2 up) |

The full mix breaks Help me, ERINNNNNN!! (Easy .859→.146), Angel Of Darkness (.817→.198), Burst The Gravity (.711→.213) and RUNNING IN THE 90'S (.737→.336). The high band breaks Hold On Tight (.761→.003), I Can't Wait (.859→.118) and blu (.876→.165).

**Remaining errors.** Highmid is off-phase by the probe on only 2/79 Easy songs: Borealis (on-beat .17 vs half-beat .83) and Made Of Fire (.25/.73). On both, only the high band is right. Easy F1 would rise .269→.725 and .398→.802.
- These two have the weakest highmid margin of all 80 songs: its onset energy on the beat vs the half beat is .51.
- But LegenD. and M@GICAL*CURE! sit at .51-.52 and are right. I Can't Wait sits at .53, has high disagreeing, and would be broken by switching (Easy .859→.118).
- Any rule that catches the two songs is a threshold fitted on those same 2 songs, one song away from a large break.

**FNAF 2.** All five other sources (mix, mix without highmid, low, lowmid, high) put its beat exactly half a beat from highmid. The one train song like that is Burst The Gravity (all bands against highmid), and there people follow highmid (.93 vs .07 on Easy). So the train data back the current phase on FNAF 2. I cannot confirm it without a human chart.

**Recommendation A: not worth a flag.**
- Highmid is already the rule, and it beats every alternative wherever they disagree: 0 losses to the mix on 4 songs, 1 loss to low on 39 songs.
- Switching to the full mix costs Easy .030 F1 on 4-6 songs.
- The only real gain is 2 songs (Borealis, Made Of Fire), and no audio signal separates them from songs a switch would break.
- If FNAF 2 still feels half a beat off by ear, that is a listening question for that song, not a generator rule.

## B. Bass leading loud phrases

**Method.**
- Loud phrase: `phrase.energy ≥ 0.9`, which is 585 of 1960 phrases (the top ~30%). In those phrases, `chooseLeaders` picks drums 476, lead 67 and bass 42 times, while the bass line is present (conf ≥ .45) in nearly all of them.
- For moments in loud phrases, I measured the share within 35 ms of a bass onset (conf ≥ .45), a lead onset (merged lead, conf ≥ .45) and a kick or snare. The "only" columns count a moment explained by one layer alone.
- As a chance reference I used the 16th-grid points of the same phrases.

**Controls (pass).**
- Our notes replaced by the bass onsets: bass 100%, only-bass 35%.
- One in five of our Normal moments swapped for uncharted bass onsets: bass share 21.1%→34.0%, only-bass 5.8%→11.9%. Hard: 21.5%→28.0%.
- The probe moves by about 13 points for a 20% change, so a real bass preference would show.

**Shares in loud phrases (%):**

| set | n | bass | lead | kick/snare | only bass |
|---|---|---|---|---|---|
| 16th grid (chance) | 36527 | 16.9 | 3.9 | 61.1 | 5.6 |
| people Easy / ours | 10226 / 10155 | 13.2 / 15.2 | 5.2 / 5.7 | 80.1 / 77.8 | 2.7 / 3.9 |
| people Normal / ours | 15059 / 16156 | 18.4 / 21.1 | 5.1 / 4.9 | 77.0 / 75.3 | 4.6 / 5.8 |
| people Hard / ours | 21172 / 22673 | 20.3 / 21.5 | 5.0 / 5.3 | 72.7 / 71.9 | 5.4 / 6.5 |

People's notes follow the bass close to chance: below chance on Easy (13.2 vs 16.9) and only slightly above it on Normal and Hard. We are already **more** bass-heavy than people at every level.
- Per song (n ≥ 50 moments), the number of songs where people's bass share is at least 5 points above ours vs the reverse: Easy 6 vs 16, Normal 2 vs 16, Hard 4 vs 11.
- Biggest songs where people follow bass more: Vitality (t+pazolite Remix) (Easy 22% vs 0%), Cagayake!GIRLS (58 vs 44), I Can't Wait (Normal 22 vs 13), ischezayu (Hard 40 vs 34).

**Simulation.** I set `leaders[i] = "bass"` in loud phrases where bass conf ≥ .45 (`analyse`, after `chooseLeaders`), and recomputed the supports.

| rule | phrases / songs changed | Easy F1 (mean, pooled) | Normal | Hard | Easy up/down | Hard up/down |
|---|---|---|---|---|---|---|
| base | – | .7164 / .7166 | .7983 / .7985 | .7694 / .7677 | – | – |
| bass in loud ≥ .9 (any leader) | 540 / 72 | .7115 / .7111 | .7981 / .7983 | .7651 / .7628 | 15 / 39 | 13 / 36 |
| ≥ .9, only where drums led | 473 / 64 | .7116 / .7111 | .7981 / .7984 | .7656 / .7633 | 13 / 36 | 9 / 32 |
| ≥ .9, only where lead led | 67 / 20 | .7168 / .7169 | .7983 / .7985 | .7690 / .7673 | 8 / 5 | 6 / 8 |
| bass in loud ≥ .8 (any leader) | 1118 / 80 | .7071 / .7064 | .7981 / .7984 | .7607 / .7590 | 14 / 53 | 11 / 52 |

- Normal hardly moves because it selects from the music and does not read `leaders`.
- The worst losses are Rise Of The Chaos Wizards (Easy .837→.787, Hard .802→.762), Part Of Me (Easy .875→.825), Koi Kou Enishi (Hard .753→.720) and FLOP ERA (Hard .812→.784). Shelter gains on Hard (.637→.659).
- The lead→bass variant is ±.0004, split 8/5 and 6/8 songs: noise.
- FNAF 2: its 2 loud phrases already have bass as the leader, so the rule changes nothing there.

**Recommendation B: not worth a flag.**
- In loud phrases, people do not follow the bass more than we do. We already sit above them, and they sit near chance.
- Making bass the leader lowers Easy (−.005) and Hard (−.004 to −.009), with losses on about 3 times as many songs as gains. Normal is unchanged.
- The only harmless variant (lead→bass) changes 20 songs with no net effect.

## Summary

Neither lead earns a flag.
- A: highmid is the current rule and the best source. The 2 songs it gets wrong (Borealis, Made Of Fire) cannot be told apart from audio.
- B: bass is already over-represented relative to people, and a bass leader hurts Easy and Hard.
