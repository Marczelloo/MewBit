### 1. Ludzie (test, n=20 map, 20 mapperów) vs algorytm (te same 20 utworów), p10 / p50 / p90

| metryka | klucz | ludzie trening (78) | ludzie test | algorytm test | algo < / > człowiek (utwory) | Wilcoxon p |
|---|---|---|---|---|---|---|
| nuty/s | `nps` | 5.03 / 6.08 / 7.30 | 5.12 / 6.00 / 6.93 | 2.92 / 3.70 / 4.73 | 20/0 | 0.000 |
| chwile/s | `mps` | 3.70 / 4.49 / 5.36 | 4.02 / 4.46 / 5.27 | 2.61 / 3.37 / 4.04 | 19/1 | 0.000 |
| nuty/beat | `notes_per_beat` | 1.55 / 2.03 / 2.94 | 1.66 / 2.02 / 2.45 | 0.98 / 1.19 / 1.62 | 20/0 | 0.000 |
| nuty/s okno 2 s p90 | `nps_window.p90` | 6.50 / 8.00 / 9.00 | 6.95 / 7.50 / 8.50 | 4.45 / 4.50 / 5.55 | 20/0 | 0.000 |
| nuty/s okno 2 s max | `nps_window.max` | 8.00 / 9.00 / 10.0 | 7.95 / 9.25 / 10.5 | 5.00 / 5.50 / 6.55 | 20/0 | 0.000 |
| odstępy 1/2 | `gap_share.1/2` | 0.44 / 0.63 / 0.80 | 0.46 / 0.64 / 0.81 | 0.09 / 0.29 / 0.55 | 19/1 | 0.000 |
| odstępy 1/1 | `gap_share.1` | 0.05 / 0.19 / 0.41 | 0.06 / 0.23 / 0.47 | 0.19 / 0.46 / 0.71 | 2/18 | 0.000 |
| odstępy 3/2 | `gap_share.3/2` | 0.00 / 0.01 / 0.03 | 0.00 / 0.01 / 0.02 | 0.02 / 0.03 / 0.11 | 2/18 | 0.001 |
| odstępy 2 | `gap_share.2` | 0.00 / 0.00 / 0.03 | 0.00 / 0.00 / 0.02 | 0.01 / 0.04 / 0.11 | 2/18 | 0.000 |
| odstępy 1/4 | `gap_share.1/4` | 0.00 / 0.05 / 0.22 | 0.00 / 0.03 / 0.10 | 0.00 / 0.00 / 0.02 | 16/1 | 0.004 |
| odstępy poza klasami | `gap_share.other` | 0.00 / 0.01 / 0.01 | 0.00 / 0.01 / 0.01 | 0.03 / 0.06 / 0.12 | 0/13 | 0.000 |
| najdłuższa seria 1/2 [nuty] | `run_1/2.max_notes` | 11.7 / 25.0 / 63.9 | 12.7 / 31.0 / 67.5 | 3.00 / 4.00 / 10.5 | 19/1 | 0.000 |
| seria 1/2 p90 [nuty] | `run_1/2.p90_notes` | 5.00 / 9.85 / 28.0 | 5.62 / 11.1 / 26.5 | 3.00 / 3.00 / 7.00 | 19/0 | 0.000 |
| najdłuższa seria 1/4 | `run_1/4.max_notes` | 0.00 / 3.00 / 7.00 | 0.00 / 3.50 / 6.10 | 0.00 / 0.00 / 2.10 | 16/1 | 0.000 |
| chwile na beacie | `snap_share.1` | 0.46 / 0.55 / 0.69 | 0.49 / 0.58 / 0.72 | 0.28 / 0.51 / 0.74 | 13/7 | 0.076 |
| chwile na 1/2 | `snap_share.2` | 0.27 / 0.39 / 0.44 | 0.25 / 0.40 / 0.46 | 0.06 / 0.21 / 0.32 | 18/2 | 0.000 |
| chwile poza siatką | `snap_share.off` | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.01 / 0.04 / 0.09 | 0/20 | 0.000 |
| chwile na 1/3, 1/6 | `triplet_share` | 0.00 / 0.00 / 0.01 | 0.00 / 0.00 / 0.01 | 0.01 / 0.03 / 0.09 | 1/18 | 0.001 |
| downbeaty z nutą | `downbeats_carried` | 0.81 / 0.94 / 1.00 | 0.80 / 0.96 / 1.00 | 0.29 / 0.67 / 0.78 | 20/0 | 0.000 |
| min. odstęp [ms] | `gap_ms.min` | 71.0 / 88.0 / 156 | 65.0 / 82.0 / 162 | 106 / 136 / 154 | 5/15 | 0.008 |
| udział akordów | `chord_share` | 0.19 / 0.34 / 0.49 | 0.20 / 0.32 / 0.46 | 0.04 / 0.14 / 0.19 | 19/1 | 0.000 |
| akordy poza beatem | `chord_position_share.offbeat` | 0.01 / 0.09 / 0.27 | 0.01 / 0.09 / 0.28 | 0.10 / 0.28 / 0.69 | 3/16 | 0.000 |
| akordy na downbeacie | `chord_position_share.downbeat` | 0.17 / 0.26 / 0.42 | 0.16 / 0.27 / 0.36 | 0.02 / 0.11 / 0.47 | 14/5 | 0.113 |
| minijacki | `minijack_share` | 0.02 / 0.09 / 0.21 | 0.03 / 0.09 / 0.22 | 0.01 / 0.04 / 0.14 | 16/4 | 0.015 |
| odstęp minijacka p50 [beat] | `minijack_gap_beats.p50` | 0.50 / 1.00 / 1.00 | 0.50 / 1.00 / 1.00 | 1.00 / 1.99 / 2.02 | 2/15 | 0.001 |
| najdłuższy jack | `jack_max_notes` | 2.00 / 3.00 / 4.00 | 2.00 / 3.00 / 4.10 | 2.00 / 2.00 / 3.00 | 13/1 | 0.002 |
| udział holdów | `hold_share` | 0.00 / 0.10 / 0.26 | 0.01 / 0.08 / 0.23 | 0.05 / 0.12 / 0.19 | 7/13 | 0.368 |
| długość holda p50 [beat] | `hold_len_beats.p50` | 0.50 / 1.00 / 1.50 | 0.50 / 1.00 / 1.30 | 1.38 / 1.86 / 2.77 | 1/17 | 0.000 |
| holdy < 1 beat | `hold_short_share.lt_1` | 0.05 / 0.54 / 0.87 | 0.00 / 0.52 / 0.77 | 0.00 / 0.00 / 0.06 | 15/1 | 0.001 |
| holdy z nutą w trakcie | `holds_with_notes_inside_share` | 0.00 / 0.10 / 0.39 | 0.00 / 0.13 / 0.36 | 0.71 / 0.90 / 0.96 | 1/17 | 0.000 |
| nuty drugiej ręki/beat w holdzie p50 | `other_hand_notes_per_beat_in_hold.p50` | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.50 / 0.62 / 0.85 | 1/17 | 0.000 |
| puszczenie na beacie | `release_snap_share.1` | 0.53 / 0.74 / 0.95 | 0.53 / 0.69 / 1.00 | 0.00 / 0.08 / 0.20 | 18/0 | 0.000 |
| puszczenie na 1/2 | `release_snap_share.2` | 0.04 / 0.24 / 0.44 | 0.00 / 0.28 / 0.47 | 0.00 / 0.04 / 0.17 | 15/1 | 0.001 |
| maks. holdów naraz | `max_simultaneous_holds` | 0.70 / 2.00 / 2.00 | 0.90 / 1.00 / 2.00 | 1.00 / 2.00 / 2.00 | 0/8 | 0.008 |
| tryle x-y-x | `trill_share` | 0.02 / 0.05 / 0.12 | 0.03 / 0.07 / 0.11 | 0.10 / 0.14 / 0.18 | 1/19 | 0.000 |
| schody | `stair_share` | 0.01 / 0.05 / 0.11 | 0.03 / 0.05 / 0.09 | 0.04 / 0.07 / 0.11 | 6/14 | 0.021 |
| entropia 4-chwil [bit] | `pattern4_entropy_bits` | 7.32 / 7.94 / 8.35 | 7.52 / 8.07 / 8.48 | 6.72 / 7.53 / 7.94 | 15/5 | 0.001 |
| przerwy ≥ 2 beaty /min | `rests_ge_2b.per_min` | 0.00 / 0.64 / 4.33 | 0.00 / 0.57 / 5.78 | 0.63 / 2.49 / 7.05 | 4/16 | 0.021 |
| przerwy ≥ 4 beaty /min | `rests_ge_4b.per_min` | 0.00 / 0.00 / 0.69 | 0.00 / 0.00 / 0.84 | 0.00 / 0.00 / 0.40 | 5/3 | 0.093 |
| najdłuższa przerwa [beat] | `longest_rest_beats` | 1.00 / 2.00 / 6.74 | 1.00 / 2.06 / 8.30 | 1.99 / 2.55 / 4.02 | 8/11 | 0.968 |
| CV nut na takt | `bar_notes_cv` | 0.21 / 0.32 / 0.46 | 0.19 / 0.30 / 0.41 | 0.23 / 0.30 / 0.44 | 8/12 | 0.498 |
| kontrast 4 taktów p90/p10 | `phrase4_notes_p90_over_p10` | 1.32 / 1.87 / 3.45 | 1.29 / 1.68 / 2.86 | 1.28 / 1.64 / 2.24 | 11/9 | 0.729 |
| puste takty | `empty_bar_share` | 0.00 / 0.01 / 0.06 | 0.00 / 0.01 / 0.05 | 0.00 / 0.00 / 0.01 | 11/1 | 0.004 |
| gęstość kiai / reszta | `kiai_density_ratio` | 1.01 / 1.22 / 1.59 | 1.03 / 1.22 / 1.45 | 0.98 / 1.16 / 1.58 | 10/10 | 0.648 |
| chwile bez dźwięku | `alignment.no_sound_share` | 0.01 / 0.04 / 0.10 | 0.01 / 0.04 / 0.09 | 0.03 / 0.06 / 0.13 | 3/17 | 0.006 |
| chwile na onsecie perk. | `alignment.perc.share` | 0.64 / 0.83 / 0.94 | 0.64 / 0.82 / 0.94 | 0.61 / 0.76 / 0.93 | 14/6 | 0.048 |
| recall snare | `plugin_events.snare.recall` | 0.39 / 0.52 / 0.66 | 0.40 / 0.49 / 0.62 | 0.28 / 0.34 / 0.40 | 19/0 | 0.000 |
| recall kick | `plugin_events.kick.recall` | 0.12 / 0.23 / 0.42 | 0.19 / 0.30 / 0.43 | 0.15 / 0.24 / 0.37 | 15/5 | 0.006 |
| recall lead | `plugin_events.lead.recall` | 0.28 / 0.36 / 0.56 | 0.28 / 0.44 / 0.56 | 0.25 / 0.33 / 0.45 | 15/4 | 0.024 |
| recall bass | `plugin_events.bass.recall` | 0.24 / 0.34 / 0.54 | 0.25 / 0.37 / 0.52 | 0.19 / 0.27 / 0.45 | 17/3 | 0.006 |
| recall hat | `plugin_events.hat.recall` | 0.00 / 0.33 / 1.00 | 0.00 / 0.25 / 0.50 | 0.00 / 0.00 / 0.05 | 13/0 | 0.001 |
| powtórzenie: rytm | `repetition.repeat.rhythm` | 0.82 / 0.92 / 0.98 | 0.80 / 0.91 / 0.98 | 0.19 / 0.33 / 0.52 | 16/0 | 0.000 |
| baza: rytm | `repetition.baseline.rhythm` | 0.41 / 0.60 / 0.74 | 0.49 / 0.63 / 0.72 | 0.14 / 0.22 / 0.33 | 20/0 | 0.000 |
| powtórzenie: tory/lustro | `repetition.repeat.lanes_or_mirror` | 0.28 / 0.46 / 0.89 | 0.24 / 0.39 / 0.55 | 0.26 / 0.50 / 0.70 | 9/7 | 0.298 |
| akord na granicy sekcji | `sections.boundary_chord_share` | 0.35 / 0.75 / 1.00 | 0.39 / 0.71 / 1.00 | 0.00 / 0.00 / 0.20 | 19/1 | 0.000 |
| nuta na granicy (tol. siatki) | `sections.boundary_note_share` | 0.80 / 1.00 / 1.00 | 0.85 / 1.00 / 1.00 | 0.00 / 0.23 / 0.60 | 20/0 | 0.000 |
| gęstość po/przed, granice w górę | `sections.boundary_rising_density_ratio_median` | 0.94 / 1.33 / 4.30 | 0.99 / 1.28 / 2.33 | 0.89 / 1.20 / 1.54 | 11/6 | 0.107 |
| ρ nuty~RMS taktu | `sections.bar_density_vs_rms_spearman` | 0.03 / 0.40 / 0.66 | -0.07 / 0.41 / 0.65 | 0.03 / 0.24 / 0.68 | 12/8 | 0.571 |

### 2. Wg relacji tempa algorytmu do siatki ludzkiej

| metryka (ludzie p50 → algorytm p50) | odczuwany beat = 2 beaty ludzkie (n=12) | 1:1 (n=7) | bez siatki (NO_TIMING) (n=1) |
|---|---|---|---|
| nps | 5.82 → 3.63 | 6.19 → 4.01 | 6.64 → 3.77 |
| notes_per_beat | 1.84 → 1.13 | 2.17 → 1.60 | 2.15 → 1.22 |
| gap_share.1/2 | 0.67 → 0.13 | 0.64 → 0.52 | 0.48 → 0.15 |
| gap_share.1 | 0.23 → 0.65 | 0.16 → 0.33 | 0.44 → 0.19 |
| run_1/2.max_notes | 28.0 → 4.00 | 31.0 → 9.00 | 17.0 → 5.00 |
| minijack_gap_beats.p50 | 1.00 → 2.00 | 0.87 → 1.00 | 1.00 → 1.61 |
| chord_share | 0.32 → 0.12 | 0.28 → 0.17 | 0.54 → 0.00 |
| chord_position_share.offbeat | 0.08 → 0.33 | 0.10 → 0.20 | 0.01 → — |
| downbeats_carried | 0.93 → 0.62 | 0.97 → 0.68 | 1.00 → 0.32 |
| snap_share.off | 0.00 → 0.05 | 0.00 → 0.03 | 0.00 → 0.01 |
| triplet_share | 0.00 → 0.03 | 0.00 → 0.03 | 0.00 → 0.20 |
| hold_len_beats.p50 | 1.00 → 2.44 | 1.00 → 1.42 | — → 2.25 |
| repetition.repeat.rhythm | 0.90 → 0.30 | 0.91 → 0.39 | 0.94 → 0.36 |

Mann–Whitney (algorytm, grupa „2 beaty” vs „1:1”): run_1/2.max_notes: p=0.001; gap_share.1/2: p=0.002; minijack_gap_beats.p50: p=0.000; notes_per_beat: p=0.000

### 3. Per utwór (człowiek / algorytm)

| set | utwór | gatunek | BPM ludzi | BPM algo × fold | relacja | downbeat algo na ludzkim | nps | gap 1/2 | maks. seria 1/2 | akordy | holdy z nutą w środku | powt. rytm | liderzy fraz |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000722 | Ohara Yuiko – Zero Centimeters (TV Size) | anime | 154 | 77×2 | 2 beaty | 0.14 | 5.82 / 2.65 | 0.78 / 0.41 | 62 / 8 | 0.38 / 0.01 | 0.14 / 0.73 | — / — | lead:8 |
| 1277503 | Umeboshi Chazuke – Panic! Pop'n! Picnic! (2019 R | video game | 190 | 95×1 | 2 beaty | 0.02 | 5.81 / 3.59 | 0.49 / 0.13 | 13 / 4 | 0.44 / 0.18 | 0.31 / 0.95 | 0.82 / 0.49 | drums:14 |
| 1329723 | saradisk – 083 - nekomimi | novelty | 200 | 100×1 | 2 beaty | 0.17 | 5.33 / 3.62 | 0.56 / 0.22 | 17 / 7 | 0.20 / 0.16 | 0.00 / 0.94 | 0.90 / — | drums:9 |
| 1570640 | Lime – 8bit Voyager | electronic | 182 | 91×2 | 2 beaty | 0.02 | 5.58 / 3.63 | 0.75 / 0.30 | 51 / 4 | 0.24 / 0.08 | — / 0.93 | 0.73 / 0.15 | drums:14 |
| 1697477 | cosMo@BousouP – Hatsune Miku no Gekishou | video game | 200 | 100×1 | 2 beaty | 0.48 | 5.82 / 3.28 | 0.54 / 0.12 | 21 / 3 | 0.32 / 0.12 | 0.16 / 0.85 | 0.93 / 0.56 | lead:9,drums:8 |
| 1773164 | TUYU – Itsuka Otona ni Nareru to Ii ne. | pop | 176 | 88×2 | 2 beaty | 0.00 | 6.58 / 3.73 | 0.79 / 0.41 | 65 / 4 | 0.29 / 0.05 | 0.05 / 0.91 | 0.86 / 0.23 | drums:16 |
| 1784295 | Rokudenashi – Tada Koe Hitotsu | pop | 130 | 130×1 | 1:1 | 0.00 | 6.42 / 2.76 | 0.64 / 0.47 | 31 / 15 | 0.32 / 0.10 | 0.39 / 0.59 | 0.98 / 0.45 | lead:22 |
| 1894317 | kessoku band – Seishun Complex (TV Size) | anime | 190 | 95×1 | 2 beaty | 0.00 | 7.05 / 3.59 | 0.71 / 0.11 | 31 / 3 | 0.32 / 0.16 | 0.12 / 1.00 | 1.00 / — | drums:10 |
| 2200258 | Kashii Moimi feat. KAFU – Cat Loving (kageminori | electronic | 220 | 110×1 | 2 beaty | 0.05 | 6.92 / 4.00 | 0.29 / 0.12 | 10 / 3 | 0.46 / 0.12 | 0.00 / 0.96 | 0.84 / 0.31 | drums:9,lead:2 |
| 2224035 | JINGBURGER – Konton Boogie | pop | 190 | 95×1 | 2 beaty | 0.18 | 7.26 / 2.94 | 0.72 / 0.08 | 72 / 3 | 0.44 / 0.09 | 0.00 / 0.91 | 0.91 / 0.23 | drums:8,bass:8 |
| 2270163 | ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasav | electronic | 185 | 93×— | brak | — | 6.64 / 3.77 | 0.48 / 0.15 | 17 / 5 | 0.54 / 0.00 | — / 0.84 | 0.94 / 0.36 | drums:10,bass:3 |
| 2314654 | Laur – PRAGMATISM -RESURRECTION- | electronic | 174 | 174×1 | 1:1 | 0.93 | 4.83 / 3.93 | 0.56 / 0.32 | 17 / 9 | 0.23 / 0.20 | 0.28 / 0.73 | 0.91 / 0.15 | drums:24,lead:3,bass:1 |
| 2515207 | TAK – PPPP feat. Hatsune Miku, Kasane Teto | pop | 152 | 152×1 | 1:1 | 0.93 | 6.19 / 2.94 | 0.63 / 0.28 | 47 / 4 | 0.43 / 0.17 | 0.14 / 0.75 | 0.86 / 0.43 | lead:16,drums:7,bass:1 |
| 310607 | t+pazolite – Electric "Sister" Bitch | video game | 185 | 93×2 | 2 beaty | 0.45 | 5.08 / 3.67 | 0.64 / 0.34 | 25 / 4 | 0.17 / 0.07 | 0.03 / 0.86 | 0.77 / 0.25 | drums:12 |
| 363594 | THE ORAL CIGARETTES – Kyouran Hey Kids!! | anime | 284 | 142×1 | 2 beaty | 0.98 | 5.38 / 4.39 | 0.02 / 0.08 | 3 / 4 | 0.40 / 0.14 | 0.00 / 0.78 | 0.97 / 0.30 | drums:13 |
| 563569 | P*Light feat. mow*2 – OVERDRIVERS | video game | 177 | 177×1 | 1:1 | 0.48 | 6.41 / 4.72 | 0.84 / 0.55 | 67 / 10 | 0.22 / 0.14 | 0.19 / 0.95 | 0.86 / 0.34 | drums:18,lead:4 |
| 636959 | Kiyoshi Hikawa – Genkai Toppa x Survivor (TV Siz | anime | 188 | 188×1 | 1:1 | 0.00 | 6.60 / 5.06 | 0.64 / 0.55 | 31 / 9 | 0.47 / 0.19 | 0.35 / 0.90 | 0.96 / — | drums:15,lead:2 |
| 808872 | Kobaryo – Perfect Neglect | electronic | 230 | 115×1 | 2 beaty | 0.27 | 6.51 / 3.87 | 0.80 / 0.09 | 64 / 3 | 0.09 / 0.15 | 0.04 / 0.97 | 0.94 / 0.47 | drums:18 |
| 859248 | Nanawo Akari – One Room Sugar Life (TV Size) | anime | 180 | 180×1 | 1:1 | 0.00 | 5.76 / 4.87 | 0.69 / 0.52 | 31 / 9 | 0.28 / 0.21 | 0.00 / 0.94 | 0.81 / 0.22 | drums:16,lead:1 |
| 923488 | HyuN – Grin | electronic | 130 | 130×1 | 1:1 | 0.00 | 5.12 / 4.01 | 0.95 / 0.70 | 190 / 24 | 0.25 / 0.15 | 1.00 / 0.52 | 0.99 / 0.87 | lead:12,bass:11 |