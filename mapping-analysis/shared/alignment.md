# Dopasowanie nut do audio

Utwory: 100. Oznaczone (40% > chwil na onsecie perkusyjnym w ±25 ms, |mediana| > 8.0 ms, dryf > 8.0 ms między połowami utworu lub niezgodność z pluginem > 10.0 ms): 5.

Udział chwil dyfficulty referencyjnej w ±25 ms od onsetu perkusyjnego: p10 0.50, p50 0.73; pełnego miksu: p50 0.57 (detektor pełnego miksu w gęstych utworach wykrywa mało onsetów, więc do oceny dopasowania służy perkusyjny).

Przesunięcie osi osu! → audio (dopasowane na utwór): p10 28 ms, p50 36 ms, p90 45 ms, min 19, max 54.
Zgodność z niezależnym dopasowaniem na onsetach pluginu (lowmid): p50 3 ms, p90 6 ms.
|Dryf| między połowami utworu: p50 1.9 ms, p90 5.1 ms, max 13.1 ms.

Mediana przesunięcia (onset − nuta) po korekcie detektora: p10 -0.5 ms, p50 -0.1 ms, p90 0.5 ms.

| kodek | utwory | mediana przesunięcia |
|---|---|---|
| mp3 | 76 | -0.0 ms |
| vorbis | 24 | -0.2 ms |

## Oznaczone

| set | udział na onsecie perk. | mediana ms | bez dźwięku | przesunięcie | zgodność | dryf (1. → 2. połowa) | kodek | start | zmienne BPM | spójny timing |
|---|---|---|---|---|---|---|---|---|---|---|
| 126752 | 0.90 | 0.2 | 0.02 | 44 | 2 | -4.7 → 3.8 | mp3 | 0.025057 | False | True |
| 1957138 | 0.29 | 0.1 | 0.23 | 32 | 6 | 0.2 → 0.2 | mp3 | 0.000000 | False | True |
| 2162283 | 0.47 | -1.8 | 0.26 | 34 | 2 | -9.3 → 3.8 | mp3 | 0.023021 | True | True |
| 2219350 | 0.72 | -0.1 | 0.20 | 40 | 0 | -4.5 → 3.7 | mp3 | 0.023021 | False | True |
| 2288990 | 0.37 | -0.1 | 0.31 | 40 | 8 | -1.1 → 0.7 | mp3 | 0.025057 | False | True |

## Próbka (15 utworów): udział chwil w ±25 ms od onsetu wg detektora

| set | full | perc | harm | low | lowmid | highmid | high |
|---|---|---|---|---|---|---|---|
| 2314502 | 0.94 | 0.98 | 0.65 | 0.34 | 0.67 | 0.92 | 0.88 |
| 1329723 | 0.89 | 0.88 | 0.43 | 0.59 | 0.78 | 0.83 | 0.89 |
| 2367084 | 0.88 | 0.80 | 0.10 | 0.26 | 0.84 | 0.75 | 0.85 |
| 2184200 | 0.87 | 0.92 | 0.39 | 0.48 | 0.52 | 0.53 | 0.88 |
| 2045473 | 0.86 | 0.90 | 0.46 | 0.33 | 0.64 | 0.83 | 0.78 |
| 1981845 | 0.86 | 0.86 | 0.30 | 0.27 | 0.85 | 0.82 | 0.53 |
| 1228135 | 0.85 | 0.91 | 0.29 | 0.16 | 0.78 | 0.86 | 0.75 |
| 1638266 | 0.84 | 0.91 | 0.38 | 0.45 | 0.65 | 0.74 | 0.66 |
| 2419084 | 0.82 | 0.87 | 0.36 | 0.16 | 0.78 | 0.81 | 0.74 |
| 2200258 | 0.82 | 0.91 | 0.14 | 0.34 | 0.59 | 0.88 | 0.79 |
| 1000722 | 0.81 | 0.82 | 0.19 | 0.55 | 0.71 | 0.70 | 0.66 |
| 383929 | 0.80 | 0.82 | 0.38 | 0.54 | 0.80 | 0.69 | 0.74 |
| 2182334 | 0.80 | 0.87 | 0.41 | 0.24 | 0.77 | 0.80 | 0.79 |
| 1649250 | 0.79 | 0.90 | 0.13 | 0.25 | 0.55 | 0.78 | 0.78 |
| 2006713 | 0.78 | 0.84 | 0.31 | 0.45 | 0.69 | 0.52 | 0.65 |
