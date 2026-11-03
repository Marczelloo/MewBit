### 1. Udział zmapowanych slotów wg pozycji (pula slotów; w nawiasie rozrzut między utworami)

| pozycja | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|
| 1/1 | 0.853 (utwory p10/p50/p90 0.74/0.89/0.97) | 0.887 (utwory p10/p50/p90 0.77/0.92/0.96) | 0.716 (utwory p10/p50/p90 0.53/0.76/0.84) |
| 1/2 | 0.569 (utwory p10/p50/p90 0.37/0.61/0.86) | 0.560 (utwory p10/p50/p90 0.34/0.58/0.84) | 0.272 (utwory p10/p50/p90 0.08/0.26/0.48) |
| 1/4 | 0.051 (utwory p10/p50/p90 0.00/0.03/0.13) | 0.032 (utwory p10/p50/p90 0.00/0.03/0.05) | 0.028 (utwory p10/p50/p90 0.00/0.02/0.06) |
| 1/8 | 0.003 (utwory p10/p50/p90 0.00/0.00/0.01) | 0.003 (utwory p10/p50/p90 0.00/0.00/0.01) | 0.038 (utwory p10/p50/p90 0.00/0.01/0.11) |
| 1/3 | 0.014 (utwory p10/p50/p90 0.00/0.00/0.04) | 0.006 (utwory p10/p50/p90 0.00/0.00/0.03) | 0.018 (utwory p10/p50/p90 0.00/0.01/0.04) |
| 1/6 | 0.009 (utwory p10/p50/p90 0.00/0.00/0.02) | 0.003 (utwory p10/p50/p90 0.00/0.00/0.01) | 0.020 (utwory p10/p50/p90 0.00/0.01/0.04) |
| downbeat | 0.902 | 0.923 | 0.733 |
| beat 1 lub 3 taktu (nie downbeat) | 0.839 | 0.867 | 0.706 |
| beat 2 lub 4 taktu | 0.846 | 0.889 | 0.705 |

### 2. P(slot zmapowany | zdarzenie / onset w slocie), wg pozycji

| źródło | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|
| plugin `kick` | 0.15 | 1/1+1/2: 0.71 | reszta: 0.02 | s≥0,5: 0.25 | 0.19 | 1/1+1/2: 0.78 | reszta: 0.01 | s≥0,5: 0.33 | 0.17 | 1/1+1/2: 0.58 | reszta: 0.05 | s≥0,5: 0.30 |
| plugin `snare` | 0.38 | 1/1+1/2: 0.80 | reszta: 0.05 | s≥0,5: 0.60 | 0.34 | 1/1+1/2: 0.78 | reszta: 0.03 | s≥0,5: 0.56 | 0.26 | 1/1+1/2: 0.52 | reszta: 0.07 | s≥0,5: 0.44 |
| plugin `hat` | 0.39 | 1/1+1/2: 0.76 | reszta: 0.04 | s≥0,5: 0.54 | 0.23 | 1/1+1/2: 0.54 | reszta: 0.02 | s≥0,5: 0.38 | 0.03 | 1/1+1/2: 0.07 | reszta: 0.01 | s≥0,5: 0.06 |
| plugin `perc` | 0.20 | 1/1+1/2: 0.72 | reszta: 0.02 | s≥0,5: 0.36 | 0.21 | 1/1+1/2: 0.75 | reszta: 0.01 | s≥0,5: 0.40 | 0.19 | 1/1+1/2: 0.56 | reszta: 0.05 | s≥0,5: 0.37 |
| plugin `bass` | 0.24 | 1/1+1/2: 0.70 | reszta: 0.03 | s≥0,5: 0.25 | 0.24 | 1/1+1/2: 0.73 | reszta: 0.01 | s≥0,5: 0.25 | 0.23 | 1/1+1/2: 0.59 | reszta: 0.07 | s≥0,5: 0.24 |
| plugin `lead` | 0.28 | 1/1+1/2: 0.78 | reszta: 0.04 | s≥0,5: 0.28 | 0.30 | 1/1+1/2: 0.84 | reszta: 0.02 | s≥0,5: 0.28 | 0.25 | 1/1+1/2: 0.64 | reszta: 0.05 | s≥0,5: 0.25 |
| plugin `low` | 0.18 | 1/1+1/2: 0.75 | reszta: 0.02 | s≥0,5: 0.24 | 0.20 | 1/1+1/2: 0.77 | reszta: 0.01 | s≥0,5: 0.30 | 0.17 | 1/1+1/2: 0.55 | reszta: 0.04 | s≥0,5: 0.26 |
| plugin `lowmid` | 0.29 | 1/1+1/2: 0.78 | reszta: 0.04 | s≥0,5: 0.45 | 0.29 | 1/1+1/2: 0.79 | reszta: 0.02 | s≥0,5: 0.48 | 0.22 | 1/1+1/2: 0.54 | reszta: 0.05 | s≥0,5: 0.38 |
| plugin `highmid` | 0.33 | 1/1+1/2: 0.78 | reszta: 0.05 | s≥0,5: 0.48 | 0.33 | 1/1+1/2: 0.79 | reszta: 0.03 | s≥0,5: 0.44 | 0.25 | 1/1+1/2: 0.54 | reszta: 0.06 | s≥0,5: 0.34 |
| plugin `high` | 0.35 | 1/1+1/2: 0.79 | reszta: 0.04 | s≥0,5: 0.56 | 0.35 | 1/1+1/2: 0.80 | reszta: 0.02 | s≥0,5: 0.54 | 0.27 | 1/1+1/2: 0.55 | reszta: 0.07 | s≥0,5: 0.42 |
| onset `full` | 0.69 | 1/1+1/2: 0.87 | reszta: 0.13 | 0.71 | 1/1+1/2: 0.87 | reszta: 0.12 | 0.52 | 1/1+1/2: 0.62 | reszta: 0.14 |
| onset `perc` | 0.64 | 1/1+1/2: 0.84 | reszta: 0.12 | 0.66 | 1/1+1/2: 0.86 | reszta: 0.09 | 0.47 | 1/1+1/2: 0.59 | reszta: 0.12 |
| onset `harm` | 0.19 | 1/1+1/2: 0.80 | reszta: 0.02 | 0.18 | 1/1+1/2: 0.75 | reszta: 0.02 | 0.18 | 1/1+1/2: 0.56 | reszta: 0.07 |
| onset `low` | 0.27 | 1/1+1/2: 0.84 | reszta: 0.02 | 0.41 | 1/1+1/2: 0.88 | reszta: 0.02 | 0.32 | 1/1+1/2: 0.65 | reszta: 0.05 |
| onset `lowmid` | 0.60 | 1/1+1/2: 0.86 | reszta: 0.10 | 0.65 | 1/1+1/2: 0.89 | reszta: 0.07 | 0.48 | 1/1+1/2: 0.62 | reszta: 0.12 |
| onset `highmid` | 0.65 | 1/1+1/2: 0.87 | reszta: 0.12 | 0.63 | 1/1+1/2: 0.86 | reszta: 0.09 | 0.46 | 1/1+1/2: 0.61 | reszta: 0.13 |
| onset `high` | 0.61 | 1/1+1/2: 0.85 | reszta: 0.08 | 0.63 | 1/1+1/2: 0.84 | reszta: 0.06 | 0.46 | 1/1+1/2: 0.60 | reszta: 0.08 |
| onset `stem_drums` | 0.44 | 1/1+1/2: 0.86 | reszta: 0.04 | 0.45 | 1/1+1/2: 0.87 | reszta: 0.02 | 0.34 | 1/1+1/2: 0.60 | reszta: 0.06 |
| onset `stem_bass` | 0.29 | 1/1+1/2: 0.77 | reszta: 0.03 | 0.34 | 1/1+1/2: 0.80 | reszta: 0.02 | 0.28 | 1/1+1/2: 0.60 | reszta: 0.06 |
| onset `stem_vocals` | 0.33 | 1/1+1/2: 0.84 | reszta: 0.04 | 0.32 | 1/1+1/2: 0.85 | reszta: 0.03 | 0.23 | 1/1+1/2: 0.55 | reszta: 0.04 |
| onset `stem_other` | 0.49 | 1/1+1/2: 0.83 | reszta: 0.08 | 0.52 | 1/1+1/2: 0.83 | reszta: 0.06 | 0.36 | 1/1+1/2: 0.55 | reszta: 0.08 |
| slot bez żadnego onsetu i zdarzenia | 0.00 | 1/1+1/2: 0.07 | 0.00 | 1/1+1/2: 0.08 | 0.01 | 1/1+1/2: 0.05 |

#### Recall onsetów na 1/1 i 1/2, rozrzut między utworami (p10/p50/p90)

| onset | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|
| stem_drums | 0.76 / 0.88 / 0.98 | 0.79 / 0.90 / 0.99 | 0.51 / 0.58 / 0.77 |
| stem_bass | 0.56 / 0.81 / 0.97 | 0.59 / 0.80 / 0.96 | 0.42 / 0.59 / 0.76 |
| stem_vocals | 0.69 / 0.88 / 0.96 | 0.67 / 0.85 / 0.98 | 0.41 / 0.59 / 0.71 |
| stem_other | 0.64 / 0.87 / 0.98 | 0.60 / 0.87 / 0.98 | 0.40 / 0.53 / 0.73 |
| perc | 0.72 / 0.86 / 0.98 | 0.71 / 0.88 / 0.96 | 0.50 / 0.59 / 0.70 |
| harm | 0.65 / 0.88 / 1.00 | 0.50 / 0.85 / 1.00 | 0.46 / 0.61 / 0.91 |

### 3. Regresja logistyczna `mapped` (L2, C=1, cechy standaryzowane), uczona na 78 utworach treningowych

AUC na slotach ludzi z testu mówi, jak dobrze model przewiduje ludzkie decyzje na nowych utworach; AUC na slotach algorytmu mówi, na ile algorytm wybiera to, co model ludzki uważa za warte nuty.

| model | cech | AUC trening | AUC ludzie test (pula) | AUC ludzie test (mediana na utwór) | AUC algorytm test (pula) | AUC algorytm (mediana na utwór) |
|---|---|---|---|---|---|---|
| tylko pozycja (+downbeat, kiai, takt w bloku 4) | 10 | 0.958 | 0.970 | 0.981 | 0.849 | 0.924 |
| pozycja + onsety librosa (bez stemów) | 25 | 0.976 | 0.983 | 0.990 | 0.874 | 0.933 |
| pozycja + zdarzenia pluginu | 21 | 0.975 | 0.982 | 0.990 | 0.905 | 0.947 |
| pełny (pozycja, onsety, stemy, plugin, RMS) | 43 | 0.979 | 0.985 | 0.991 | 0.897 | 0.945 |

#### Współczynniki pełnego modelu (standaryzowane; dodatni = sprzyja nucie). Kolumny 3–4: ten sam model dopasowany osobno do ludzi z testu i do algorytmu z testu (te same 20 utworów)

| cecha | ludzie trening | ludzie test (refit) | algorytm test (fit) |
|---|---|---|---|
| pos_1/1 | +1.54 | +1.63 | +0.68 |
| pos_1/2 | +1.28 | +1.38 | +0.22 |
| pos_1/4 | +0.90 | +0.91 | -0.21 |
| pos_1/3 | +0.59 | +0.48 | -0.29 |
| pos_1/6 | +0.42 | +0.15 | -0.21 |
| rms | +0.34 | +0.18 | +0.01 |
| ev_highmid | +0.33 | +0.23 | +0.20 |
| env_highmid | +0.29 | +0.00 | -0.07 |
| ev_high | +0.27 | +0.25 | +0.25 |
| env_stem_drums | +0.23 | +0.26 | +0.05 |
| env_lowmid | +0.22 | +0.13 | -0.01 |
| ev_lowmid | +0.19 | +0.27 | +0.15 |
| env_perc | +0.17 | +0.02 | -0.14 |
| onset_perc | +0.15 | +0.15 | +0.05 |
| onset_low | +0.11 | +0.15 | +0.04 |
| ev_kick | +0.09 | +0.14 | +0.55 |
| env_high | +0.09 | -0.07 | -0.08 |
| onset_lowmid | +0.09 | +0.04 | -0.00 |
| ev_lead | +0.08 | +0.14 | +0.11 |
| ev_low | +0.07 | +0.03 | +0.02 |
| downbeat | +0.07 | +0.09 | +0.00 |
| onset_stem_vocals | +0.07 | +0.15 | -0.05 |
| kiai | +0.07 | +0.02 | +0.05 |
| env_stem_other | +0.04 | -0.08 | -0.03 |
| onset_highmid | +0.04 | -0.03 | -0.01 |
| bar4_1 | +0.04 | +0.12 | +0.00 |
| onset_harm | +0.03 | -0.02 | +0.11 |
| onset_stem_bass | +0.03 | +0.03 | +0.06 |
| bar4_3 | +0.03 | +0.03 | +0.01 |
| onset_stem_other | +0.02 | +0.09 | -0.02 |
| ev_hat | +0.01 | -0.01 | -0.04 |
| onset_stem_drums | +0.01 | +0.07 | +0.03 |
| onset_high | +0.00 | -0.12 | -0.04 |
| ev_perc | -0.00 | +0.05 | +0.51 |
| bar4_2 | -0.01 | +0.04 | -0.00 |
| env_stem_vocals | -0.03 | -0.11 | +0.03 |
| onset_full | -0.03 | -0.00 | -0.01 |
| ev_snare | -0.03 | +0.06 | +0.53 |
| ev_bass | -0.04 | -0.09 | +0.14 |
| env_low | -0.05 | -0.04 | -0.05 |
| env_stem_bass | -0.17 | -0.14 | +0.05 |
| env_full | -0.25 | +0.69 | +0.22 |
| env_harm | -0.48 | -0.70 | -0.04 |

### 4. Onsety perkusyjne na 1/1 i 1/2: zmapowane vs pominięte (mediany / udziały)

| grupa | slotów z onsetem perc | udział zmapowanych | env_perc | RMS | udział na beacie | z onsetem stemu perkusji | z onsetem stemu wokalu |
|---|---|---|---|---|---|---|---|
| ludzie trening | 40366 | 0.84 | 0.65 vs 0.50 | 0.89 vs 0.75 | 0.62 vs 0.20 | 0.69 vs 0.55 | 0.28 vs 0.22 |
| ludzie test | 10050 | 0.86 | 0.66 vs 0.51 | 0.90 vs 0.80 | 0.66 vs 0.17 | 0.70 vs 0.54 | 0.31 vs 0.24 |
| algorytm test | 10054 | 0.59 | 0.68 vs 0.57 | 0.91 vs 0.86 | 0.76 vs 0.34 | 0.71 vs 0.62 | 0.29 vs 0.31 |

### 5. Zmapowane sloty bez żadnego onsetu (librosa, stemy) ani zdarzenia pluginu

| grupa | zmapowanych slotów | udział bez dźwięku | z nich na 1/1 | z nich na 1/2 | z nich start holda |
|---|---|---|---|---|---|
| ludzie trening | 45998 | 0.003 | 0.25 | 0.27 | 0.14 |
| ludzie test | 11268 | 0.003 | 0.27 | 0.24 | 0.19 |
| algorytm test | 9329 | 0.007 | 0.10 | 0.09 | 0.25 |

### 6. Gatunki (ludzie trening): udział zmapowanych slotów wg pozycji i recall onsetów stemów na 1/1+1/2

| gatunek | utworów | 1/1 | 1/2 | 1/4 | 1/3 | stem_drums | stem_vocals | stem_bass | stem_other |
|---|---|---|---|---|---|---|---|---|---|
| anime | 19 | 0.891 | 0.656 | 0.071 | 0.006 | 0.88 | 0.88 | 0.85 | 0.90 |
| electronic | 19 | 0.838 | 0.483 | 0.037 | 0.026 | 0.83 | 0.82 | 0.68 | 0.77 |
| video game | 17 | 0.847 | 0.532 | 0.042 | 0.015 | 0.85 | 0.82 | 0.74 | 0.83 |
| pop | 13 | 0.877 | 0.632 | 0.037 | 0.005 | 0.88 | 0.83 | 0.84 | 0.85 |

### 7. P(zmapowany) wg pozycji, dźwięku i tercyla RMS w utworze (cichy / średni / głośny), oraz kiai

| pozycja | dźwięk / kiai | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|---|
| 1/1 | z onsetem perc | 0.84 / 0.94 / 0.97 (n=22519) | 0.86 / 0.96 / 0.99 (n=5878) | 0.68 / 0.74 / 0.80 (n=5881) |
| 1/1 | tylko inne onsety/zdarzenia | 0.37 / 0.61 / 0.78 (n=6272) | 0.41 / 0.68 / 0.82 (n=1380) | 0.43 / 0.55 / 0.70 (n=1384) |
| 1/1 | bez dźwięku | 0.07 / 0.17 / 0.24 (n=344) | 0.06 / 0.31 / 0.33 (n=73) | 0.12 / 0.06 / 0.00 (n=72) |
| 1/2 | z onsetem perc | 0.58 / 0.71 / 0.81 (n=17847) | 0.60 / 0.71 / 0.77 (n=4172) | 0.20 / 0.39 / 0.39 (n=4173) |
| 1/2 | tylko inne onsety/zdarzenia | 0.21 / 0.36 / 0.54 (n=10493) | 0.26 / 0.40 / 0.48 (n=2972) | 0.11 / 0.20 / 0.22 (n=2995) |
| 1/2 | bez dźwięku | 0.03 / 0.08 / 0.14 (n=690) | 0.05 / 0.05 / 0.04 (n=177) | 0.03 / 0.03 / 0.08 (n=168) |
| 1/4 | z onsetem perc | 0.21 / 0.27 / 0.29 (n=5384) | 0.25 / 0.22 / 0.20 (n=960) | 0.04 / 0.12 / 0.11 (n=993) |
| 1/4 | tylko inne onsety/zdarzenia | 0.02 / 0.04 / 0.04 (n=46189) | 0.02 / 0.02 / 0.02 (n=11785) | 0.02 / 0.04 / 0.02 (n=11800) |
| 1/4 | bez dźwięku | 0.00 / 0.00 / 0.00 (n=6489) | 0.00 / 0.01 / 0.00 (n=1889) | 0.00 / 0.01 / 0.01 (n=1878) |
| 1/1 | poza kiai | 0.82 (n=20721) | 0.86 (n=5091) | 0.69 (n=5098) |
| 1/1 | kiai | 0.94 (n=8414) | 0.96 (n=2240) | 0.77 (n=2239) |
| 1/2 | poza kiai | 0.53 (n=20631) | 0.56 (n=5086) | 0.26 (n=5102) |
| 1/2 | kiai | 0.66 (n=8399) | 0.57 (n=2235) | 0.30 (n=2234) |

### 8. Półbeaty (1/2): P(zmapowany | zdarzenie pluginu danej klasy w slocie)

| klasa | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|
| kick | 0.60 (n=7216) | 0.60 (n=1461) | 0.35 (n=1470) |
| snare | 0.65 (n=10753) | 0.64 (n=3054) | 0.28 (n=3052) |
| hat | 0.73 (n=386) | 0.41 (n=79) | 0.08 (n=79) |
| perc | 0.59 (n=6069) | 0.59 (n=1570) | 0.33 (n=1573) |
| bass | 0.61 (n=6778) | 0.60 (n=1414) | 0.43 (n=1412) |
| lead | 0.66 (n=1962) | 0.73 (n=443) | 0.45 (n=447) |
| low | 0.62 (n=17474) | 0.61 (n=4349) | 0.32 (n=4368) |
| lowmid | 0.64 (n=21624) | 0.64 (n=5590) | 0.31 (n=5602) |
| highmid | 0.65 (n=22502) | 0.64 (n=5748) | 0.30 (n=5750) |
| high | 0.66 (n=21866) | 0.65 (n=5541) | 0.32 (n=5535) |
| 1/2 bez zdarzenia pluginu | 0.07 (n=873) | 0.07 (n=222) | 0.04 (n=211) |