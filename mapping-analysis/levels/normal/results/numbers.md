### Tendencje: ile map spełnia (trening / test / algorytm)

| warunek | ludzie trening | mapperów (tr) | ludzie test | algorytm test | mapperów łamiących (tr) |
|---|---|---|---|---|---|
| powtórzenie muzyki → rytm ≥ 0,8 (wśród map z parami) | 57/62 | 50 | 17/19 | 1/16 | 5 |
| rytm powtórzenia − baza ≥ 0,1 | 57/61 | 50 | 19/19 | 8/16 | 4 |
| tory/lustro w powtórzeniu ≥ 0,8 (kopiowanie wzorca) | 9/62 | 50 | 0/19 | 1/16 | 45 |
| tory w powtórzeniu > baza | 52/62 | 50 | 16/19 | 14/16 | 10 |
| odstępy ≥ 3/2 beatu ≤ 5% odstępów | 65/78 | 61 | 19/20 | 5/20 | 12 |
| odstępy 1/2 to najczęstsza klasa | 70/78 | 61 | 18/20 | 6/20 | 8 |
| ρ(gęstość taktu, RMS) > 0 | 73/78 | 61 | 16/20 | 18/20 | 5 |
| akord na ≥ 50% granic sekcji | 64/78 | 61 | 17/20 | 0/20 | 13 |
| nuta na ≥ 80% granic sekcji | 71/78 | 61 | 19/20 | 9/20 | 7 |
| tryle ≤ 0,10 | 67/78 | 61 | 17/20 | 2/20 | 8 |
| puste takty ≤ 5% | 67/78 | 61 | 18/20 | 20/20 | 10 |
| najdłuższa przerwa ≤ 4 beaty | 61/78 | 61 | 14/20 | 17/20 | 16 |
| akordy ≥ 15% chwil | 73/78 | 61 | 19/20 | 8/20 | 5 |
| akordy na beacie (z downbeatem) ≥ 70% akordów | 71/77 | 60 | 18/20 | 10/19 | 5 |
| seria 1/2 ≥ 9 nut (≥ 1 takt) gdzieś w mapie | 74/78 | 61 | 19/20 | 5/20 | 4 |
| nps 4,5–8 | 72/78 | 61 | 20/20 | 3/20 | 6 |
| holdy ≤ 35% nut | 77/78 | 61 | 19/20 | 20/20 | 1 |
| kiai_density_ratio ≥ 1 | 64/70 | 54 | 18/20 | 17/20 | 6 |

### 5 utworów oznaczonych w alignment.md (w treningu: 5, w teście: 0)

| metryka | trening wszystkie p10/p50/p90 | trening bez oznaczonych | wartości oznaczonych |
|---|---|---|---|
| alignment.perc.share | 0.64 / 0.83 / 0.94 | 0.65 / 0.83 / 0.94 | 0.90, 0.43, 0.64, 0.89, 0.50 |
| alignment.no_sound_share | 0.01 / 0.04 / 0.10 | 0.01 / 0.03 / 0.08 | 0.02, 0.17, 0.09, 0.07, 0.23 |
| plugin_events.snare.recall | 0.39 / 0.52 / 0.66 | 0.41 / 0.53 / 0.67 | 0.31, 0.33, 0.51, 0.55, 0.52 |
| plugin_events.lead.recall | 0.28 / 0.36 / 0.56 | 0.28 / 0.36 / 0.55 | 0.37, 0.34, 0.58, 0.54, 0.32 |
| nps | 5.03 / 6.08 / 7.30 | 5.04 / 6.09 / 7.30 | 3.95, 5.78, 6.26, 6.18, 5.23 |
| gap_share.1/2 | 0.44 / 0.63 / 0.80 | 0.42 / 0.64 / 0.80 | 0.64, 0.82, 0.57, 0.59, 0.46 |

Mapperzy w treningu: 61 na 78 map; z ≥ 2 mapami: 14 (maks. 3 mapy).