### Gęstość taktów wokół granic sekcji (nuty w takcie / mediana taktu chartu; mediana median utworów)

Takt 0 = pierwszy takt nowej sekcji.

| grupa | kierunek RMS | granic / utworów | takt -4 | takt -3 | takt -2 | takt -1 | takt +0 | takt +1 | takt +2 | takt +3 |
|---|---|---|---|---|---|---|---|---|---|---|
| ludzie trening | w górę | 136 / 65 | 0.67 | 0.67 | 0.67 | 0.76 | 1.00 | 1.00 | 1.00 | 1.09 |
| ludzie trening | w dół | 127 / 55 | 1.00 | 1.08 | 1.00 | 1.00 | 0.69 | 0.67 | 0.62 | 0.64 |
| ludzie trening | płasko | 436 / 76 | 1.00 | 1.00 | 1.00 | 1.06 | 0.98 | 1.00 | 1.00 | 1.00 |
| ludzie test | w górę | 36 / 17 | 0.83 | 0.83 | 0.75 | 0.70 | 1.00 | 1.11 | 1.00 | 1.06 |
| ludzie test | w dół | 29 / 15 | 1.17 | 1.19 | 1.08 | 1.12 | 0.78 | 0.81 | 0.80 | 0.86 |
| ludzie test | płasko | 112 / 20 | 0.96 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| algorytm test | w górę | 35 / 16 | 0.85 | 0.87 | 0.75 | 1.00 | 0.90 | 1.00 | 1.05 | 1.00 |
| algorytm test | w dół | 29 / 15 | 1.00 | 1.10 | 1.00 | 1.00 | 0.80 | 0.80 | 0.90 | 0.80 |
| algorytm test | płasko | 112 / 20 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.04 | 1.00 | 1.04 |

### Granice sekcji: co dzieje się na granicy i tuż przed nią (rozrzut między utworami p10/p50/p90)

| grupa | granic / utworów | nuta na downbeacie granicy | akord na downbeacie granicy | nuty 4 takty po/przed | po/przed, granice w górę | po/przed, granice w dół | ostatni takt / 3 wcześniejsze | udział chwil ostatniego taktu w jego 2. połowie |
|---|---|---|---|---|---|---|---|---|
| ludzie trening | 699 / 78 | 0.80 / 1.00 / 1.00 | 0.35 / 0.75 / 1.00 | 0.86 / 1.00 / 1.12 | 0.94 / 1.38 / 3.73 | 0.42 / 0.63 / 1.00 | 0.87 / 1.04 / 1.13 | 0.45 / 0.50 / 0.57 |
| ludzie test | 177 / 20 | 0.85 / 1.00 / 1.00 | 0.40 / 0.71 / 1.00 | 0.92 / 1.00 / 1.10 | 0.97 / 1.33 / 2.65 | 0.27 / 0.71 / 1.07 | 0.83 / 1.03 / 1.23 | 0.49 / 0.50 / 0.60 |
| algorytm test | 176 / 20 | 0.49 / 0.81 / 1.00 | 0.00 / 0.12 / 0.27 | 0.93 / 1.00 / 1.13 | 0.90 / 1.19 / 1.55 | 0.60 / 0.78 / 0.99 | 0.89 / 1.09 / 1.20 | 0.43 / 0.50 / 0.51 |

### Intro, outro i kontrast głośności (na utwór, p10/p50/p90)

intro/outro = średnia nut w pierwszych/ostatnich 4 taktach aktywnych / mediana taktu; ρ = Spearman nut w takcie z RMS taktu; ciche/głośne = średnia nut w taktach z dolnego/górnego kwartyla RMS / mediana taktu.

| grupa | utworów | intro | outro | ρ nuty~RMS taktu | ciche takty (Q1 RMS) | głośne takty (Q4 RMS) | pierwsza nuta [s] |
|---|---|---|---|---|---|---|---|
| ludzie trening | 78 | 0.39 / 0.75 / 1.10 | 0.09 / 0.86 / 1.17 | 0.03 / 0.39 / 0.66 | 0.46 / 0.77 / 0.96 | 0.94 / 1.08 / 1.22 | 0.19 / 0.89 / 4.17 |
| ludzie test | 20 | 0.57 / 0.90 / 1.06 | 0.55 / 0.98 / 1.24 | -0.09 / 0.39 / 0.64 | 0.56 / 0.90 / 1.07 | 0.95 / 1.09 / 1.23 | 0.35 / 0.80 / 2.01 |
| algorytm test | 20 | 0.48 / 0.78 / 1.05 | 0.50 / 0.90 / 1.02 | -0.00 / 0.24 / 0.66 | 0.63 / 0.88 / 1.02 | 0.94 / 1.08 / 1.32 | 1.55 / 1.65 / 2.23 |

Granice z nutą na downbeacie, ta sama piosenka: ludzie test mediana 1.00, algorytm 0.81 (algorytm niżej w 15/20 utworach).