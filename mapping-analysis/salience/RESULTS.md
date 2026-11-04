# Which audio signals predict where humans put notes (train only, 80 songs)
Setup. Candidates = union of onsets of all bands + drums + bass + lead, merged within 30 ms (~16.8/s, recall of human
notes 99.5-100%). Label = human note within +-35 ms. Easy 79 songs, Normal 78, Hard 75. Medians over songs.
Positive rate (share of candidates a human used): Easy .225, Normal .343, Hard .484 (median per song .232/.348/.480);
humans place 2.9 / 4.3 / 6.0 notes/s. Random top-k F1: .240 / .346 / .452. F1 = top-k per 8 s window, k = human count there.
Held-out 20 ids never loaded. Generator output not used. Scripts and logs: same folder (a_single, b_models, c_hd, d_subset).
## 1. Single signals (AUC / F1, E N H). AUC<.5 = anti-predictive (1-AUC in brackets)
| signal | AUC E | N | H | F1 E | N | H |
|---|---|---|---|---|---|---|
| rel_os (mel onset strength / 2 s local mean) | .888 | .900 | .878 | .590 | .667 | .695 |
| os_broad (mel onset strength) | .873 | .898 | .882 | .578 | .658 | .691 |
| flux_full_mid (STFT, mid band) | .862 | .875 | .860 | .572 | .645 | .677 |
| flux_P_all (percussive part, HPSS) | .856 | .875 | .875 | .558 | .648 | .691 |
| dist_Pall (percussive energy vs 2 s) | .855 | .803 | .731 | .520 | .542 | .567 |
| flux_P_low | .812 | .804 | .769 | .515 | .592 | .624 |
| plugin p_max | .785 | .796 | .788 | .540 | .649 | .701 |
| plugin p_highmid | .745 | .753 | .754 | .678 | .773 | .821 |
| plugin p_drums | .708 | .719 | .721 | .572 | .688 | .749 |
| flux_H_all (harmonic part) | .714 | .715 | .696 | .414 | .495 | .566 |
| flux_H_mid (harmonic mid band) | .663 | .665 | .648 | .356 | .434 | .518 |
| hcqt_flux (CQT harmonic change) | .597 | .582 | .561 | .269 | .348 | .424 |
| tv_rise (top-voice rises) | .573 | .558 | .542 | .267 | .343 | .422 |
| chroma_change | .532 | .518 | .505 | .234 | .299 | .397 |
| plugin p_bass / p_lead | .50/.51 | .51/.51 | .52/.50 | .23/.26 | .37/.36 | .48/.47 |
| m_beat (on a beat) | .745 | .691 | .655 | .642 | .598 | .602 |
| d_grid (distance to beat/half/quarter grid) | .305 [.695] | .306 [.694] | .287 [.713] | .116 | .196 | .341 |
| m_quarter (on a 16th position only) | .323 [.677] | .310 [.690] | .344 [.656] | .012 | .074 | .295 |
What wins on AUC: the broadband mel onset strength, relative to the local average. Percussive-part flux is next
(.86-.88); harmonic-part flux is poor (.65-.72), and top voice, chroma, CQT change are near chance (.50-.60).
Plugin lead/bass lines carry nothing. The plugin band values rank low on AUC (they are zero for most candidates) but
p_highmid has the best single F1 (.68/.77/.82, above every audio flux). Do not read that as "better signal":
see caveats. Metrical class (positive rate E/N/H): beat .66/.79/.88, half .30/.60/.79, 16th-position .02/.08/.26,
off-grid .14/.21/.31. On good-grid songs (tempo.confidence >= .7, 40-43 songs) m_beat AUC is .767/.699/.660,
i.e. +.005..+.022 over all songs; the grid effect is not just a bad-grid artefact.
## 2. Combination (5-fold group CV by song, medians; LR = logistic, HGB = gradient boosting, all 83 features)
| level | best single AUC / F1 | best single F1 (p_highmid) | LR all AUC / F1 | HGB all AUC / F1 | 4-signal subset AUC / F1 |
|---|---|---|---|---|---|
| Easy | .888 / .590 | .678 | .935 / .707 | .941 / .710 | .932 / .716 |
| Normal | .900 / .667 | .773 | .935 / .772 | .940 / .764 | .932 / .771 |
| Hard | .882 / .691 | .821 | .913 / .791 | .920 / .790 | .902 / .783 |
4-signal subset (LR) = rel_os + metrical position (m_beat, m_half, m_quarter, d_grid) + flux_P_low + dist_Pall.
So combining beats the best single AUC by +.03-.05 (HGB +.04-.05). On F1 it adds nothing over p_highmid alone
(Easy +.03, Normal 0, Hard -.03), but +.10-.12 over the best audio signal (rel_os / os_broad).
Share of the LR gain over rel_os reached: subset 94% / 91% / 68% (E/N/H); rel_os + meter only 59% / 56% / 61%.
Greedy forward selection (LR): Normal rel_os .900 -> +m_quarter .910 -> +d_grid .919 -> +flux_P_low .927 (all .935).
Easy rel_os -> +m_beat -> +dist_Pall -> +m_quarter = .930. Hard os_broad -> +d_grid -> +flux_P_low -> +flux_P_all = .902.
Cheap variant, no HPSS (rel_os + meter + flux_full_low): AUC .920 / .926 / .899, F1 .701 / .761 / .778.
Group view (LR, AUC): only meter .862/.859/.800; only dist .909/.908/.881; only fluxP .887/.902/.896; only fluxH
.724/.716/.701; only tv+chroma .60/.58/.57; only plugin .83/.84/.85. Dropping a group from all features costs:
meter -.019/-.014/-.006, plugin +.001/-.002/-.004 (<= .004), everything else <= .003. HGB permutation importance (Normal, AUC drop):
meter .074, dist .031, fluxP .012, fluxfull .011, plugin .009, repeat .008, fluxH .002, tv+chroma .0004.
Largest LR coefficients (standardised, non-repeat): Easy dist_Pall +.62, m_quarter -.62, rel_os +.60; Normal m_quarter -.51,
m_beat +.40, rel_os +.32; Hard p_n -.46, p_high +.35, p_highmid +.31 (rel_fluxHmid and flux_H_mid have opposite
signs: a collinear pair, do not interpret them separately).
Repeat consensus (phrases.list): 64/80 songs have repeat links, but only 29.8% of candidates are covered. On those rows
the repeat-averaged version of a signal is WORSE than the plain one (rel_os .906 -> .891 Normal, .900 -> .858 Hard);
adding all 34 rc features to LR changes AUC by +.001. Verdict: not worth it as a salience signal.
## 3. Do the levels choose by different criteria?
Nesting (share of the lower level's notes with an upper-level note within 35 ms; shifted-chance in brackets):
Easy in Normal .991 [.35], Normal in Hard .996 [.48], Easy in Hard .998 [.45]. Reverse: Normal in Easy .645, Hard in Normal .720.
Train on row, test on column (AUC; 73 songs with all three levels):
| | E | N | H |
|---|---|---|---|
| E | .936 | .919 | .861 |
| N | .929 | .933 | .897 |
| H | .899 | .919 | .912 |
Transfer cost vs own level: E->N -.015, N->E -.006, N->H -.015, H->N -.015, H->E -.037, E->H -.051. F1 at the test level's own k:
a model trained on a deeper level is as good or better on a shallower one (H->N .793 vs own .774, N->E .735 vs own .701),
while E->H is clearly worse (.689 vs .792). Conclusion: mostly the SAME ranking cut at different depths (near-perfect nesting,
a Normal-trained model is within .015 AUC on both neighbours). What differs is mainly grid weight: LR coefficient cosine
E-N .88, N-H .76, E-H .59, and the 16th-position / half-beat rates above (Hard accepts off-beat moments, Easy almost never).
## 4. Hopes and Dreams (HGB trained on all Normal train songs, AUC .940 in CV)
Normal density from train: median 1.485 notes per beat = 24 notes per 16-beat phrase. Dominant = which of H (harmonic mid flux),
P (percussive flux) or L (low flux) has the highest rank percentile for the most top-scored moments; beat% = top moments on a beat.
Table: phrase #, start s, dominant, (H/P/L %), beat%, beat+half%.
| # | s | dom | H/P/L | b | b+h | # | s | dom | H/P/L | b | b+h |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.0 | P | 38/62/0 | 33 | 79 | 16 | 90.1 | P | 17/54/29 | 71 | 100 |
| 1 | 5.8 | P | 46/54/0 | 42 | 88 | 17 | 95.8 | P | 25/71/4 | 75 | 96 |
| 2 | 11.4 | P | 25/75/0 | 33 | 92 | 18 | 101.4 | P | 0/71/29 | 75 | 96 |
| 3 | 17.1 | H | 50/42/8 | 46 | 79 | 19 | 107.0 | P | 4/83/12 | 71 | 100 |
| 4 | 22.6 | P | 8/62/29 | 71 | 100 | 20 | 112.6 | P | 4/62/33 | 75 | 100 |
| 5 | 28.3 | P | 33/58/8 | 71 | 88 | 21 | 118.3 | P | 12/50/38 | 67 | 92 |
| 6 | 33.9 | P | 17/54/29 | 67 | 96 | 22 | 123.9 | P | 29/50/21 | 75 | 96 |
| 7 | 39.5 | P | 21/67/12 | 75 | 92 | 23 | 129.5 | P | 25/54/21 | 67 | 100 |
| 8 | 45.1 | P | 38/42/21 | 67 | 79 | 24 | 135.1 | P | 4/79/17 | 50 | 83 |
| 9 | 50.8 | P | 17/67/17 | 71 | 88 | 25 | 140.8 | P | 17/62/21 | 54 | 92 |
| 10 | 56.4 | P | 17/46/38 | 75 | 92 | 26 | 146.4 | P | 12/62/25 | 71 | 100 |
| 11 | 62.0 | P | 12/67/21 | 75 | 88 | 27 | 152.0 | P | 8/50/42 | 71 | 100 |
| 12 | 67.6 | P | 29/42/29 | 67 | 100 | 28 | 157.6 | P | 21/50/29 | 67 | 100 |
| 13 | 73.3 | P | 33/54/12 | 67 | 100 | 29 | 163.3 | P | 8/54/38 | 71 | 100 |
| 14 | 78.9 | P/L | 17/42/42 | 71 | 92 | 30 | 168.9 | H | 46/33/21 | 58 | 92 |
| 15 | 84.5 | P | 25/54/21 | 71 | 96 | 31 | 174.5 | P | 29/46/25 | 42 | 79 |
Zones (mean over phrases): solo melody 0-22 s (4 phrases): H/P/L 40/58/2, beat 39%, beat+half 84%; full band 23-135 s (19): 20/57/23,
beat 71%, beat+half 94%; quiet 135-146 s (3): 11/68/21, beat 58%, beat+half 92%; after 147 s (5): 22/47/31. Only the solo
phrases and the two sparse ones (3, 30) lean harmonic; the model's dominant group is percussive almost everywhere, and
it matches plain os_broad top-k (H/P/L 26/58/17 overall). The solo opening has the lowest beat share (39%), full band the highest (71%).
Derived from train means (share x positive rate / base rate): human Normal notes are ~42% beat, ~30% half, ~7% 16th, ~21% off-grid
(beat+half ~72%); the model on H&D puts 93% of top moments on beat/half, i.e. more grid-bound than humans (H&D has an exact grid).
## 5. Compute cost (seconds per audio minute, 3 songs, 6.22 min, Python/librosa in docker, one process, not pinned to a core)
load/decode .79, STFT .17, full-band flux .16, mel onset strength (os_broad / rel_os) .09, distinctiveness .12, CQT .18,
top voice .17, chroma .02, HPSS 4.44 (69% of the 6.45 s total), flux of H/P parts .31.
Cheap for Java on a Pi (a plain STFT + per-band flux + 2 s local mean, plus the plugin's beats for metrical class): rel_os, m_beat/m_half/
m_quarter/d_grid, flux_full_*, dist_*. The 4-signal subset needs flux_P_low and dist_Pall, which need HPSS (median filtering of the
spectrogram in both directions): heavy, and not measured on a Pi. The no-HPSS subset gives .920/.926/.899 AUC (-.01 vs the HPSS subset on Easy/Normal).
Pi speed was not measured, so no Pi figure is given.
## 6. Caveats and what was skipped
- Human charts are one reference. A good AUC/F1 says "matches where humans put notes", not "sounds melodic": harmonic and top-voice
  signals do poorly here, yet the corpus charts are beat/percussion-driven, so this may only show what these mappers rewarded.
- F1 ties: plugin band values are zero for most candidates and ties are randomised, so p_highmid's F1 advantage over its AUC
  is partly the plugin pre-selecting the same peaks humans use. Treat p_highmid F1 as "candidate already exists", not a salience score.
- Alignment: per-family frame-lag calibration; candidate-to-human offset mean 2.1 ms, std 8.9 ms. The training mp3s carry ~35 ms extra
  decoder delay vs the plugin-decoded H&D wav; H&D lags are consistent with that, not separately verified against a human chart.
- Rank-percentile features per song; LR coefficients are collinear; group CV is 5 folds with one seed; no confidence intervals.
- "Good grid" = tempo.confidence >= .7. Percussive vs harmonic dominance on H&D is by rank percentile, and the HPSS "percussive" part also
  captures sharp plucked/struck melody notes, so P does not mean drums.
- Skipped: stems as a ceiling (no stems exist); Pi timing; held-out test ids; the generator's output; HGB subset search (greedy was LR only).
