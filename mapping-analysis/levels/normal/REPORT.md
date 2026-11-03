# Normal: profil mapowania ludzi i porównanie z generatorem v19 (etap 2)

Zakres: tylko poziom Normal (SR osu!mania 4K w [1,65; 2,7)). Dane: `shared/data/normal/*`, `shared/data/songs/*`, kolumny ogólne i `normal_*` korpusu, kod `helpers/mewbeat/charts/*.js` i DSP pluginu. Tabele szczegółowe są w `results/`, skrypty w tym katalogu (część 10).

Liczności: zbiór treningowy to **78 map ludzi od 61 mapperów** (`normal_owners`; 14 mapperów ma po 2–3 mapy). Zbiór testowy to **20 map od 20 mapperów** i 20 chartów generatora na tych samych utworach. Mapperzy z testu nie występują w treningu. Z 100 zestawów 2 nie mają dyfficulty Normal.

Klasyfikacja na mapach treningowych:
- **twarda zasada**: spełnia ją ≥ 95% map,
- **silna tendencja**: 75–95%,
- **styl / zależna**: < 75%.

„Sprawdzenie na teście” to ten sam udział liczony na 20 mapach testowych. Wszystkie czasy są na osi zdekodowanego audio.

---

## 1. Podsumowanie

1. Ludzki Normal to przede wszystkim **ciągły puls na siatce**.
 - Nuty stoją na 85–89% wszystkich beatów i na ok. 57% półbeatów. 1/4 i drobniejsze podziały są prawie puste.
 - Sama pozycja w siatce przewiduje decyzję mappera z AUC 0,97. Dźwięk (onset perkusyjny, głośność) rozstrzyga głównie o półbeatach, a klasa instrumentu prawie nie ma znaczenia.
2. Gęstość ludzi prawie nie zależy od tempa: **ok. 6 nut/s** (p10–p90 5,0–7,3) w całym zakresie 100–284 BPM. Od tempa zależy podział:
 - poniżej 150 BPM pojawia się 1/4,
 - w zakresie 150–230 BPM dominuje 1/2,
 - od ok. 240 BPM przeważa 1/1.
 To zgadza się ze skalą BPM z Ranking Criteria, ale 1/2 utrzymuje się do wyższego tempa, niż RC sugeruje.
3. Generator jest na Normal **o 40% za rzadki**: 3,7 nut/s wobec 6,0, niżej w 20/20 utworach. **Gubi też strumień 1/2**: udział odstępów 1/2 wynosi 0,29 wobec 0,64, a najdłuższa seria 1/2 ma 4 nuty wobec 31. Przyczyny to limit gęstości (`maxNps` 5) i reguły „czytelności” Normal liczone w „odczuwanych beatach”.
4. W 12 z 19 utworów z siatką odczuwany beat algorytmu to **dwa beaty ludzkie**. Beat tracker trafia połowę tempa albo `foldTempo` podwaja siatkę, a `feltBeatMs` mnoży beat przez `foldFactor`. Wtedy wszystkie progi Normal (odstępy, serie, akordy, powtórzenia toru) działają dwa razy za mocno. Faza taktu algorytmu zgadza się z ludzką tylko w 3/19 utworach.
5. Holdy algorytmu są innego rodzaju niż ludzkie.
 - Ludzie: krótkie holdy (1/2 lub 1 beat), nic w trakcie, puszczenie dokładnie na następnej nucie.
 - Algorytm: holdy 1–4 beatów, w 90% z nutami drugiej ręki w środku, w 81% z puszczeniem poza siatką 1/1–1/2, nigdy w akordzie.
6. Akordów jest za mało i stoją w złych miejscach: 14% chwil wobec 32%, 0% na granicach sekcji wobec 75%, prawie nigdy wewnątrz strumienia 1/2. Rytm nie powtarza się, kiedy powtarza się muzyka (0,33 wobec 0,91), ale tę różnicę pomiar częściowo zawyża przez drgania czasu algorytmu.
7. Gatunek prawie nie zmienia reguł. Po korekcie na wielokrotne testy różnią się tylko tempo i trafianie w wokal (anime 0,39 wobec electronic 0,20).
 Algorytm ma już zbliżone do ludzi: udział holdów oraz stosunek gęstości w kiai do reszty utworu.
 Zgodność statystyk nie dowodzi dobrej gry. To trzeba sprawdzić grając (część 7).

---

## 2. Profil mapowania ludzi na Normal

**Odporność wyników.**
- Zakres SR Normal obejmuje też dyfficulty nazwane „Hard”: 10/78 w treningu, z medianą 7,1 nut/s.
- Ograniczenie do 65 map o nazwach Normal/Novice (52 mapperów) prawie nic nie zmienia: nps p50 5,93 (4,97–6,83), odstępy 1/2 0,63, akordy 0,33, holdy 0,10.
- 5 utworów oznaczonych w `alignment.md` jest w treningu. Ich wyłączenie zmienia mediany metryk dopasowania o ≤ 0,01 (`results/numbers.md`).

### 2.1 Co ludzie mapują, a co pomijają (tabele slotów, `results/slots.md`)

**Udział zmapowanych slotów wg pozycji** (pula slotów; w nawiasie rozrzut między utworami p10/p50/p90):

| pozycja | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|
| beat (1/1) | 0,85 (0,74/0,89/0,97) | 0,89 | 0,72 (0,53/0,76/0,84) |
| półbeat (1/2) | 0,57 (0,37/0,61/0,86) | 0,56 | 0,27 (0,08/0,26/0,48) |
| 1/4 | 0,05 (0,00/0,03/0,13) | 0,03 | 0,03 |
| 1/8 | 0,003 | 0,003 | 0,038 |
| 1/3, 1/6 | 0,014, 0,009 | 0,006, 0,003 | 0,018, 0,020 |

**Co decyduje.** P(zmapowany) wg pozycji, dźwięku i tercyla RMS w utworze (cichy / średni / głośny), ludzie trening:

| pozycja | onset perkusyjny w slocie | tylko inne onsety / zdarzenia | bez żadnego dźwięku |
|---|---|---|---|
| 1/1 | 0,84 / 0,94 / 0,97 | 0,37 / 0,61 / 0,78 | 0,07 / 0,17 / 0,24 |
| 1/2 | 0,58 / 0,71 / 0,81 | 0,21 / 0,36 / 0,54 | 0,03 / 0,08 / 0,14 |
| 1/4 | 0,21 / 0,27 / 0,29 | 0,02 / 0,04 / 0,04 | 0,00 |

Test potwierdza: 1/1 z onsetem perkusyjnym 0,86/0,96/0,99, 1/2 z onsetem 0,60/0,71/0,77.

- **Regresja logistyczna `mapped`** (L2, cechy standaryzowane, uczona na 78 utworach treningowych).
- Sama pozycja (podział, downbeat, kiai, takt w bloku 4): AUC 0,958 na treningu i **0,970 na teście**.
- Pozycja + onsety librosa + stemy + zdarzenia pluginu + RMS: 0,979 / **0,985** (mediana AUC w utworze 0,991).
- Największe dodatnie wagi poza pozycją: RMS (+0,34), zdarzenia pasm `highmid`/`high`/`lowmid` (+0,19…+0,33), obwiednia stemu perkusji (+0,23).
- Waga ujemna: obwiednia części harmonicznej (−0,48). Trwający dźwięk bez ataku nie dostaje nuty.
- **Klasy perkusji pluginu (`kick`, `snare`, `perc`) mają u ludzi wagę ≈ 0** (−0,03…+0,09). W modelu dopasowanym do algorytmu mają +0,51…+0,55.
- Recall zdarzeń pluginu na 1/1 i 1/2 jest podobny dla wszystkich klas: kick 0,71, snare 0,80, hat 0,76, perc 0,72, bass 0,70, lead 0,78. Na samych półbeatach wynosi 0,59–0,73 dla każdej klasy. Ludzie mapują to, co słychać na siatce, a nie konkretny instrument. Recall wszystkich stemów na 1/1 i 1/2: p50 0,81–0,88.
- Nuty bez żadnego dźwięku: ludzie 0,3% zmapowanych slotów, algorytm 0,7%. `alignment.no_sound_share`: ludzie p50 0,04 (0,01–0,10), algorytm 0,06.
- Kiai: beaty zmapowane w 94% (poza kiai 82%), półbeaty w 66% (poza kiai 53%).
- **Klasyfikacja i test.**
- Zmapowany prawie każdy głośny beat z onsetem: **twarda zasada** (pula 0,97 w głośnych częściach; na utwór p10 0,74 wszystkich beatów).
- Około 60% półbeatów z onsetem oraz prawie puste 1/4 przy ≥ 150 BPM: **silna tendencja**.
- Wybór instrumentu nie jest regułą ludzi na Normal.
- **Test:** wszystkie liczby się powtarzają (AUC 0,985, udziały w granicach ±0,04).

### 2.2 Gęstość, podziały i limity trudności (`results/profile_metrics.md`, `results/bpm.md`)

| metryka | trening p10 / p50 / p90 | test p10 / p50 / p90 |
|---|---|---|
| nuty/s (`nps`) | 5,03 / **6,08** / 7,30 | 5,12 / 6,00 / 6,93 |
| chwile/s (`mps`) | 3,70 / 4,49 / 5,36 | 4,02 / 4,46 / 5,27 |
| nuty/beat | 1,55 / 2,03 / 2,94 | 1,66 / 2,02 / 2,45 |
| okno 2 s: p50 / p90 / max (mediany) | 6,0 / 8,0 / 9,0 | 6,5 / 7,5 / 9,25 |
| odstępy 1/2 (`gap_share.1/2`) | 0,44 / **0,63** / 0,80 | 0,46 / 0,64 / 0,81 |
| odstępy 1/1 | 0,05 / 0,19 / 0,41 | 0,06 / 0,23 / 0,47 |
| odstępy 1/4 | 0,00 / 0,05 / 0,22 | 0,00 / 0,03 / 0,10 |
| chwile na beacie / na 1/2 (p50) | 0,55 / 0,39 | 0,58 / 0,40 |
| triole (`triplet_share`) | 0,00 / 0,00 / 0,01 | 0,00 / 0,00 / 0,01 |
| najdłuższa seria 1/2 [nuty] | 11,7 / **25** / 63,9 | 12,7 / 31 / 67,5 |
| najdłuższa seria 1/4 [nuty] | 0 / 3 / 7 | 0 / 3,5 / 6,1 |
| min. odstęp chwil [ms] | 71 / 88 / 156 | 65 / 82 / 162 |
| p5 odstępu [ms] | 83 / 137 / 173 | 85 / 157 / 196 |
| downbeaty z nutą | 0,81 / 0,94 / 1,00 | 0,80 / 0,96 / 1,00 |

**Zależność od BPM** (trening, BPM = `song.main_bpm`).
- **Nuty/s nie zależą od tempa**: ρ = −0,17, p = 0,13. OLS przewiduje 6,4 / 6,1 / 5,7 nut/s przy 120/180/240 BPM (R² = 0,03).
- Nuty na beat zależą silnie: ρ = −0,74, R² = 0,61.

Mediany wg przedziałów BPM:

| BPM | n | nuty/s | odstępy 1/2 | 1/1 | 1/4 | seria 1/4 maks. | typowy odstęp p50 [ms] |
|---|---|---|---|---|---|---|---|
| < 150 | 12 | 6,15 | 0,68 | 0,05 | 0,18 | 9 | 226 |
| 150–180 | 30 | 6,17 | 0,69 | 0,18 | 0,06 | 3 | 179 |
| 180–210 | 28 | 5,85 | 0,59 | 0,27 | 0,01 | 3 | 160 |
| ≥ 210 | 8 | 6,47 | 0,56 | 0,33 | 0,04 | 3 | 143 |

- Dwie mapy przy 100 BPM (zapisane w połowie tempa) mają 1/4 jako główny podział: 0,65 i 0,75 odstępów, po 150 ms. To w praktyce 1/2 przy 200 BPM.
- Przy 210–230 BPM 1/2 wciąż dominuje, np. 808872 przy 230 BPM ma 0,80 odstępów 1/2 i serię 64 nut.
- 1/1 przeważa dopiero przy 240 BPM (0,66) i 284 BPM (0,78); każde z tych temp to jedna mapa.
- **Test:** te same kierunki. Nuty/beat ρ = −0,65, odstępy 1/1 ρ = +0,70, nps bez związku (ρ = +0,22, p = 0,35).

**Serie.**
- „≤ 5 kolejnych 1/4” przy ≥ 150 BPM spełnia 62/66 map (łamie 4 mapperów; test 16/18): **silna tendencja**. Przy < 150 BPM spełnia tylko 3/12 map, zgodnie ze skalą RC.
- Seria 1/2 ≥ 9 nut (co najmniej takt) jest w 74/78 map: **twarda zasada** (test 19/20).
- Seria 1/2 dłuższa niż fraza (> 33 nut) jest w 25/78 map u 21 mapperów: styl.
- Brak serii 1/6: 75/78 map, **twarda zasada** (test 19/20).

**Odstępy.** Odstępy ≥ 3/2 beatu stanowią ≤ 5% odstępów w 65/78 map: **silna tendencja** (test 19/20). 1/2 jest najczęstszą klasą odstępu w 70/78 map (test 18/20).

**Akordy.**
- Udział chwil-akordów p50 0,34 (0,19–0,49); ≥ 15% chwil w 73/78 map: **silna tendencja** (test 19/20).
- Akordy 3+ nut: zero w 71/78 map, ≤ 1% chwil w 73/78.
- Położenie (p50): downbeat 0,26, inny beat 0,58, poza beatem 0,09. Na beacie stoi ≥ 70% akordów w 71/77 map.
- Akordy z nutą w każdej ręce: 0,54 (0,39–0,67).
- **80% akordów ma sąsiednią chwilę bliżej niż 0,9 beatu, a 69% w odstępie dokładnie 1/2 beatu** (`results/aux.md`). Ludzie stawiają akordy wewnątrz strumienia 1/2.
- Akordy w serii 1/4: zero w 67/78 map.
- Test potwierdza: 19/20, 20/20, 18/20.

**Jacki.**
- Minijacki 1/4 nie występują nigdzie (78/78, 20/20): **twarda zasada**.
- Minijacki wolniejsze są zwykłe: udział 0,09 (0,02–0,21), odstęp p50 1 beat (p10 0,5).
- Jack 3 nut przy ≥ 1/2 beatu jest w 58/78 map: styl, nie zakaz.

**Tory.** Ręce po 0,50 (0,49–0,51) w 78/78 map. Kroki pojedynczych nut: 0 torów 0,03, 1 tor 0,50, 2 tory 0,31, 3 tory 0,13. Zmiana ręki 0,67 (0,56–0,80).

### 2.3 Holdy i to, co dzieje się w ich trakcie (`results/holds.md`; pomiar pomocniczy z tolerancją, zob. część 8)

| cecha (mapy z ≥ 3 holdami; p10 / p50 / p90) | ludzie trening (69 map, 54 mapperów) | ludzie test (18) | algorytm test (20) |
|---|---|---|---|
| udział holdów w nutach (`hold_share`, wszystkie mapy) | 0,00 / 0,10 / 0,26 | 0,01 / 0,08 / 0,23 | 0,05 / 0,12 / 0,19 |
| hold < 0,45 beatu | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| hold ≈ 1/2 beatu (0,45–0,55) | 0,00 / 0,28 / 0,76 | 0,00 / 0,29 / 0,67 | 0 / 0 / 0 |
| hold ≈ 1 beat (0,95–1,05) | 0,16 / 0,42 / 0,77 | 0,09 / 0,41 / 0,76 | 0,00 / 0,00 / 0,07 |
| hold ≥ 1,95 beatu | 0,01 / 0,07 / 0,37 | 0,00 / 0,10 / 0,44 | 0,13 / 0,42 / 1,00 |
| z jakąkolwiek nutą w trakcie | 0,00 / **0,10** / 0,39 | 0,00 / 0,13 / 0,36 | 0,71 / **0,90** / 0,96 |
| hold startuje w akordzie | 0,16 / 0,42 / 0,66 | 0,07 / 0,30 / 0,83 | 0 / 0 / 0 |
| następna chwila < 1/2 beatu po puszczeniu | 0,82 / **0,95** / 1,00 | 0,78 / 0,98 / 1,00 | 0,23 / 0,45 / 0,72 |
| puszczenie na 1/1 / na 1/2 (p50) | 0,74 / 0,24 | 0,69 / 0,28 | 0,12 / 0,07 |
| puszczenie poza 1/1 i 1/2 | 0,00 / 0,00 / 0,06 | 0,00 / 0,00 / 0,03 | 0,47 / **0,81** / 0,97 |

- U ludzi hold jest **łącznikiem**: trwa do następnej chwili (95% puszczeń wypada dokładnie na jej start), a w trakcie nic się nie dzieje. Przy puszczeniu nutę gra druga ręka w 85% przypadków, ta sama ręka na innym torze w 32%, ten sam tor nigdy.
- Mapy bez holdów: 8/78. Dwa holdy naraz: w 42/78 map, więcej niż dwa: 3/78. Odstęp między puszczeniami ≥ 1/2 beatu: 77/78, **twarda zasada**.
- Hold startuje na beacie w 74% przypadków, na 1/2 w 24%. Według regresji `hold_start` częściej startuje przy obwiedni wokalu (+0,13) i na beacie (+0,58); test ma ten sam kierunek.
- **Klasyfikacja:**
- hold ≥ 1/2 beatu (z tolerancją): 69/70, test 17/18, **twarda zasada**;
- holdy bez nut w środku (≤ 20% holdów z nutą): 58/70, test 13/18, **silna tendencja**;
- puszczenie na 1/1 lub 1/2 (≤ 5% poza): 56/70, test 17/18, **silna tendencja**;
- puszczenie na następnej nucie (≥ 75% holdów): 64/70, test 16/18, **silna tendencja**;
- sam udział holdów to styl (p10–p90 0–0,26).

### 2.4 Wzorce i ich powtarzalność

- Tryle x-y-x: 0,05 (0,02–0,12); ≤ 0,10 w 67/78 map, **silna tendencja** (test 17/20). Schody: 0,05 (0,01–0,11). Entropia 4-chwilowych układów: 7,94 bitu (7,32–8,35). Różnych układów na 100: 56 (42–75). Tryle w jednej ręce (pary 0-1 i 2-3) to 18% trylów.
- **Ręka nie zależy od dźwięku.** Udział lewej ręki dla pojedynczych nut na kicku, snare, basie, leadzie, samym paśmie low i samym paśmie high wynosi 0,50–0,51. Kick nie trafia częściej na tory zewnętrzne (0,41) niż snare (0,43). Pitch relevancy z poradnika nie występuje na Normal (`results/aux.md`).
- **Powtórzenia.** Pary 4-taktowych okien o podobieństwie audio ≥ 0,75 ma 62/78 map.

| | rytm | tory | tory lub lustro |
|---|---|---|---|
| powtórzenie muzyki | 0,92 (0,82–0,98) | 0,24 (0,14–0,47) | 0,46 (0,28–0,89) |
| linia bazowa (różna muzyka) | 0,60 (0,41–0,74) | 0,16 (0,13–0,21) | 0,22 (0,18–0,28) |

- Rytm ≥ 0,8 w powtórzeniu: 57/62 map (50 mapperów, łamie 5), **silna tendencja**; test 17/19.
- Tory w powtórzeniu zgodniejsze niż w bazie: 52/62 (test 16/19).
- Pełne kopiowanie torów (≥ 0,8): 9/62 (test 0/19), czyli **styl** pojedynczych mapperów. Tory lub lustro na teście: 0,39 wobec 0,46 w treningu, MW p = 0,035.
- Ludzie powtarzają rytm, a tory zmieniają, często przez lustro.

### 2.5 Intro, sekcje, przejścia, kiai (`results/sections.md`)

Gęstość taktów wokół granic sekcji z audio. Wartość to nuty w takcie podzielone przez medianę taktu chartu; podaję medianę median utworów. Takt 0 to pierwszy takt nowej sekcji.

| grupa | kierunek RMS | granic / utworów | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|---|---|---|---|
| ludzie trening | w górę | 136 / 65 | 0,67 | 0,67 | 0,67 | 0,76 | **1,00** | 1,00 | 1,00 | 1,09 |
| ludzie trening | w dół | 127 / 55 | 1,00 | 1,08 | 1,00 | 1,00 | **0,69** | 0,67 | 0,62 | 0,64 |
| ludzie test | w górę | 36 / 17 | 0,83 | 0,83 | 0,75 | 0,70 | 1,00 | 1,11 | 1,00 | 1,06 |
| ludzie test | w dół | 29 / 15 | 1,17 | 1,19 | 1,08 | 1,12 | 0,78 | 0,81 | 0,80 | 0,86 |
| algorytm test | w górę | 35 / 16 | 0,85 | 0,87 | 0,75 | **1,00** | 0,90 | 1,00 | 1,05 | 1,00 |
| algorytm test | w dół | 29 / 15 | 1,00 | 1,10 | 1,00 | 1,00 | 0,80 | 0,80 | 0,90 | 0,80 |

- **Ludzie zmieniają gęstość skokiem na granicy.**
- Głośniejsza sekcja: nuty w 4 taktach po / 4 przed = 1,38 (p10–p90 0,94–3,73).
- Cichsza sekcja: 0,63 (0,42–1,00).
- Buildupu w gęstości prawie nie ma: ostatni takt / 3 wcześniejsze = 1,04 (0,87–1,13). Lekki wzrost przed głośną sekcją: 0,67 → 0,76.
- W ostatnim takcie przed granicą chwile rozkładają się równo na obie połowy (0,50), więc nie ma wypełnienia pod koniec taktu.
- **Downbeat granicy.**
- Nuta na ≥ 80% granic: 71/78 map, **silna tendencja** (test 19/20).
- Akord na ≥ 50% granic: 64/78 (test 17/20); mediana udziału granic z akordem 0,75.
- **Intro, outro, głośność.**
- Intro (pierwsze 4 takty): 0,75 mediany taktu (0,39–1,10). Outro: 0,86. Pierwsza nuta: 0,89 s (0,19–4,17).
- Gęstość taktu rośnie z jego RMS (ρ = 0,39; ρ > 0 w 73/78 map), ale umiarkowanie: takty z dolnego kwartyla RMS mają 0,77 mediany, z górnego 1,08.
- Kiai: gęstość kiai / reszta = 1,22 (1,01–1,59); ≥ 1 w 64/70 map z kiai, **silna tendencja** (test 18/20).

### 2.6 Pauzy, odpoczynek, kontrast

- Przerwy ≥ 2 beaty: 0,64/min (0–4,33); 29/78 map nie ma żadnej. Przerwy ≥ 4 beaty są w 18/78 map (styl). Najdłuższa przerwa p50 2 beaty (1–6,7). Puste takty: 0,01 (0–0,06); ≤ 5% w 67/78 map.
- Długie przerwy (≥ 4 beaty; 66 w treningu w 18 mapach) wypadają w **cichych miejscach przy granicach sekcji**: RMS w przerwie to 0,41 mediany utworu, 64% leży ≤ 4 takty od granicy. Test: 13 przerw w 6 mapach, RMS 0,68, 85% przy granicy.
- CV nut na takt: 0,32 (0,21–0,46). Kontrast bloków 4-taktowych p90/p10: 1,87 (1,32–3,45).
- Normal ludzi jest **prawie ciągły**. Kontrast budują skoki na granicach sekcji, a nie długie przerwy. Przerwy ≥ 2 beaty rosną z BPM (ρ = +0,51), bo 2 beaty trwają wtedy krócej.

### 2.7 Zestawienie reguł (pełne: `results/rules.md`, `results/numbers.md`)

| reguła ludzi na Normal | trening | test | algorytm (test) | klasa |
|---|---|---|---|---|
| brak minijacków 1/4 | 78/78 | 20/20 | 20/20 | twarda |
| obie ręce 0,4–0,6 | 78/78 | 20/20 | 20/20 | twarda |
| brak serii 1/6 | 75/78 | 19/20 | 20/20 | twarda |
| puszczenia holdów ≥ 1/2 beatu od siebie | 77/78 | 19/20 | 19/20 | twarda |
| hold ≥ 1/2 beatu (tolerancja 0,45) | 69/70 | 17/18 | 20/20 | twarda |
| ≤ 2 holdy naraz | 75/78 | 20/20 | 20/20 | twarda |
| seria 1/2 ≥ 9 nut gdzieś w mapie | 74/78 | 19/20 | **6/20** | twarda/silna |
| akordy ≤ 2 nuty (≤ 1% chwil 3+) | 73/78 | 20/20 | 20/20 | silna |
| nps 4,5–8 | 72/78 | 20/20 | **3/20** | silna |
| akordy ≥ 15% chwil | 73/78 | 19/20 | **8/20** | silna |
| 1/2 najczęstszym odstępem | 70/78 | 18/20 | **6/20** | silna |
| downbeaty z nutą ≥ 0,8 | 70/78 | 18/20 | **2/20** | silna |
| chwile na 1/1 lub 1/2 ≥ 0,85 | 69/78 | 19/20 | **6/20** | silna |
| odstępy ≥ 3/2 beatu ≤ 5% | 65/78 | 19/20 | **5/20** | silna |
| nuta na ≥ 80% granic sekcji | 71/78 | 19/20 | **0/20** | silna |
| akord na ≥ 50% granic sekcji | 64/78 | 17/20 | **0/20** | silna (82%) |
| rytm powtórzenia ≥ 0,8 | 57/62 | 17/19 | **1/16** | silna |
| tryle ≤ 0,10 | 67/78 | 17/20 | **2/20** | silna |
| holdy bez nut w środku (≤ 20% holdów) | 58/70 | 13/18 | **0/20** | silna |
| puszczenie holda na 1/1 lub 1/2 | 56/70 | 17/18 | **0/20** | silna |
| ≤ 5 kolejnych 1/4 (przy ≥ 150 BPM) | 62/66 | 16/18 | 20/20 | silna |
| kiai gęstsze od reszty | 64/70 | 18/20 | 17/20 | silna |
| przerwy ≥ 4 beaty | 18/78 | 6/20 | 3/20 | styl |
| kopiowanie torów w powtórzeniu | 9/62 | 0/19 | 1/16 | styl |
| jack z 3 nut (przy ≥ 1/2 beatu) | 58/78 | 15/20 | 4/20 | styl |

---

## 3. Gatunki (`results/genres.md`)

- **Grupy wystarczające** (trening): anime 19 map (17 mapperów), electronic 19 (18), video game 17 (14), pop 13 (13).
- **Za małe do uogólnień:** rock 3, novelty 2 (w tym 1 w teście), classical, folk, hip hop, jazz, metal, other po 1.
- Test (4–6 map na gatunek) daje tylko orientacyjne sprawdzenie kierunku.

**Wspólne dla gatunków** (Kruskal–Wallis, q BH > 0,1):
- nps 5,8–6,2; odstępy 1/2 0,57–0,72; akordy 0,26–0,37;
- holdy 0,08–0,13 (długość p50 1 beat w każdym gatunku), holdy z nutą w środku 0,08–0,14;
- triole 0; jacki, tryle i entropia wzorców bez różnic;
- rytm w powtórzeniach 0,87–0,94; akord na granicy sekcji 0,71–0,78; kiai 1,11–1,31.

Reguły z części 2 nie zależą od gatunku.

**Zależne od gatunku:**
- **Tempo.** Electronic ma p50 200 BPM, pop 164, anime 170 (q = 0,002). Przez tempo różnią się też nuty na beat (anime 2,13, video game 1,76; KW p = 0,007). Po uwzględnieniu BPM różnica znika (q = 0,27): to efekt tempa, nie stylu.
- **Co jest pod nutą.** Udział chwil na onsecie wokalu: anime 0,39, pop 0,34, video game 0,30, electronic 0,20. Różnica jest istotna także po uwzględnieniu BPM (q = 0,002), a test ma ten sam kierunek (ρ kolejności +0,4). W anime mapowana jest linia wokalna, w electronic częściej część harmoniczna (0,27; q = 0,15).
- **Różnice nominalne** (p < 0,05, po korekcie q ≈ 0,15), traktowane jako możliwy, **niepotwierdzony styl gatunku**:
- electronic: więcej przerw (1,10/min wobec 0,00 w anime), większy kontrast (p90/p10 2,05);
- video game: najwięcej schodów (0,07);
- anime: najdłuższe serie 1/4 (p50 5), najwyższy recall kicka (0,33);
- pop: najwięcej 1/2 (0,72).

Na teście kolejność gatunków zgadza się dla nut na beat (ρ = +0,8), ale dla większości pozostałych metryk jest niespójna.

**Algorytm a ludzie wg gatunku (test).** Niedobór gęstości występuje w każdym gatunku:

| gatunek | nuty/s (ludzie → algorytm) | maks. seria 1/2 |
|---|---|---|
| anime | 5,82 → 4,39 | 31 → 8 |
| electronic | 6,05 → 3,90 | 34 → 4,5 |
| video game | 5,82 → 3,63 | 23 → 4 |
| pop | 6,50 → 2,94 | 56 → 4 |

Najgorzej wypada pop: 2 z 4 utworów to utwory wokalne prowadzone przez `lead`, ale n = 4. Pełna tabela jest w części 5.

---

## 4. Ranking Criteria i poradnik a dane

RC zakłada ok. 180 BPM i metrum 4/4 (`Ranking_criteria_Scaling_BPM.md`). Dane zgadzają się ze skalą BPM co do kierunku, z przesunięciem progu 240 BPM.

| zapis (RC Normal / RC ogólne / poradnik) | dane ludzi (trening; test) | ocena |
|---|---|---|
| HP i OD ≤ 7,5 | 75/78; 20/20 | zgodne; gra nie ma HP/OD (stałe okna, PERFECT 40 ms ≈ OD 8), więc nie przenosi się |
| brak serii 1/6 i drobniejszych | 75/78 bez żadnego odstępu 1/6; 19/20 | zgodne (twarda) |
| LN ≥ 1/2 beatu | 69/70 bez holda < 0,45 beatu; 17/18 | zgodne; oficjalna metryka pokazuje 29/78 przez zaokrąglenie ms (część 8) |
| puszczenia ≥ 1/2 beatu od siebie | 77/78; 19/20 | zgodne |
| nic w trakcie LN 1/2; nic szybszego niż 1/2 w trakcie LN 1/1 | holdy z nutą w środku p50 0,10; nuty drugiej ręki/beat w holdzie p90 0 | zgodne, ludzie idą dalej: większość holdów jest pusta |
| bez shieldów 1/4 | brak metryki | nie da się sprawdzić (część 8) |
| głównie 1/1 i 1/2, okazjonalnie 1/4 | odstępy ≥ 1/2 ≥ 75% w 69/78; 1/2 najczęstsza w 70/78 | zgodne, w praktyce „głównie 1/2” (1/1 ok. 0,19) |
| ≤ 5 kolejnych 1/4 | 62/66 przy ≥ 150 BPM; < 150 BPM tylko 3/12 | zgodne ze skalą BPM |
| pauza 1/1 po każdej frazie 1/2 | seria 1/2 ≤ 33 w 53/78 (21 mapperów łamie); test 12/20 | **dane przeczą** jako regule (RC: „where natural”) |
| bez akordów w serii 1/4 | 0 w 67/78; 19/20 | zgodne (silna) |
| bez anchorów ≥ 3 nut | `anchor_max_notes` liczy przemienność (p50 6), spełnia 0/78 | metryka nie mierzy anchorów z RC (część 8) |
| bez minijacków 1/4 i „innych jacków” | 1/4: 78/78 brak; jacki 3+ przy ≥ 1/2 beatu w 58/78 | pierwsza część zgodna; „inne jacki” **dane przeczą** (wolne jacki są zwykłe) |
| 4K: akordy ≤ 2 nuty | 71/78 zero, 73/78 ≤ 1%; 20/20 | zgodne |
| skala BPM: 120 BPM = prawie ciągłe 1/2, poniżej rzadkie 1/4 | < 150 BPM: 1/2 0,68 + 1/4 0,18 (p90 0,74) | **ludzie dają więcej 1/4**; przy 100 BPM 1/4 jest podziałem głównym |
| skala BPM: przy ok. 240 BPM minimalne 1/2 | 210–230 BPM: 1/2 0,56 (n = 8+2); 240 i 284 BPM: 1/1 przeważa (n = 1+1) | próg przesunięty: 1/2 trzyma się do ok. 230 BPM (ok. 130 ms) |
| poradnik: Normal „więcej 1/2, unikaj 1/4” | zgodne przy ≥ 150 BPM | zgodne |
| poradnik: więcej akordów, akord na mocnym werblu, kiai z akordami | akordy 34% chwil, 84% na beatach; kiai gęstsze w 64/70 | zgodne |
| poradnik: nuty w trakcie LN drugą ręką | ludzie zwykle nie grają nic w trakcie (p50 0,10 holdów) | ludzie ostrożniejsi niż poradnik |
| poradnik: pitch relevancy (nisko lewa ręka, wysoko prawa) | lewa ręka 0,50 dla każdego dźwięku | **dane przeczą**: na Normal tego nie ma |
| poradnik: „Be consistent!” | rytm w powtórzeniach 0,92; tory 0,24 (z lustrem 0,46) | zgodne dla rytmu; tory ludzie zmieniają |
| RC ogólne: każda nuta odpowiada dźwiękowi | chwile bez dźwięku 0,04 (≤ 10% w 70/78) | zgodne |
| RC ogólne: przerwy tylko w bardzo cichej muzyce | przerwy ≥ 4 beaty w 18/78 map przy RMS 0,41 mediany | zgodne |

Co nie przenosi się na tę grę:
- zasady SV, bo gra nie ma SV;
- hitsoundy i keysoundy, bo audio gra bot;
- HP i OD.

Skala BPM przenosi się w formie, którą potwierdzają dane: **stała gęstość w czasie (ok. 6 nut/s) i podział dobierany do tempa**.

---

## 5. Algorytm a ludzie na zbiorze testowym (`results/algo_vs_human.md`)

### 5.1 Kluczowe metryki

Dane: 20 utworów. Kolumna „algo < / >” podaje, w ilu utworach algorytm wypada niżej / wyżej niż człowiek na tym samym utworze.

| metryka | ludzie test p10 / p50 / p90 | algorytm p10 / p50 / p90 | algo < / > | Wilcoxon p |
|---|---|---|---|---|
| nuty/s | 5,12 / 6,00 / 6,93 | 2,92 / **3,70** / 4,73 | 20/0 | < 0,001 |
| chwile/s | 4,02 / 4,46 / 5,27 | 2,61 / 3,37 / 4,04 | 19/1 | < 0,001 |
| nuty/beat | 1,66 / 2,02 / 2,45 | 0,98 / 1,19 / 1,62 | 20/0 | < 0,001 |
| okno 2 s p90 / max [nuty/s] (p50) | 7,5 / 9,25 | 4,5 / 5,5 | 20/0 | < 0,001 |
| odstępy 1/2 | 0,46 / 0,64 / 0,81 | 0,09 / **0,29** / 0,55 | 19/1 | < 0,001 |
| odstępy 1/1 | 0,06 / 0,23 / 0,47 | 0,19 / 0,46 / 0,71 | 2/18 | < 0,001 |
| odstępy 3/2 + 2 | 0,00 / 0,02 / 0,04 | 0,04 / 0,08 / 0,16 | 0/20 | < 0,001 |
| odstępy poza klasami | 0,00 / 0,01 / 0,01 | 0,03 / 0,06 / 0,12 | 0/13 | < 0,001 |
| najdłuższa seria 1/2 [nuty] | 12,7 / 31 / 67,5 | 3 / **4** / 10,5 | 19/1 | < 0,001 |
| chwile na 1/2 | 0,25 / 0,40 / 0,46 | 0,06 / 0,21 / 0,32 | 18/2 | < 0,001 |
| chwile poza 1/1–1/4 ludzkiej siatki | 0,00 / 0,00 / 0,01 | 0,07 / **0,20** / 0,44 | 0/20 | < 0,001 |
| downbeaty z nutą | 0,80 / 0,96 / 1,00 | 0,29 / **0,67** / 0,78 | 20/0 | < 0,001 |
| min. odstęp [ms] | 65 / 82 / 162 | 106 / 136 / 154 | 5/15 | 0,008 |
| udział akordów | 0,20 / 0,32 / 0,46 | 0,04 / **0,14** / 0,19 | 19/1 | < 0,001 |
| akordy poza beatem | 0,01 / 0,09 / 0,28 | 0,10 / 0,28 / 0,69 | 3/16 | < 0,001 |
| akordy z sąsiadem w odstępie 1/2 (pomocnicza) | 0,34 / 0,69 / 0,86 | 0,00 / 0,06 / 0,68 | — | — |
| minijacki / odstęp minijacka [beat] (p50) | 0,09 / 1,00 | 0,04 / **1,99** | 16/4; 2/15 | 0,015; 0,001 |
| udział holdów | 0,01 / 0,08 / 0,23 | 0,05 / 0,12 / 0,19 | 7/13 | 0,37 |
| długość holda p50 [beat] | 0,50 / 1,00 / 1,30 | 1,38 / 1,86 / 2,77 | 1/17 | < 0,001 |
| holdy z nutą w trakcie | 0,00 / 0,13 / 0,36 | 0,71 / **0,90** / 0,96 | 1/17 | < 0,001 |
| puszczenie na beacie | 0,53 / 0,69 / 1,00 | 0,00 / 0,08 / 0,20 | 18/0 | < 0,001 |
| tryle x-y-x | 0,03 / 0,07 / 0,11 | 0,10 / **0,14** / 0,18 | 1/19 | < 0,001 |
| entropia 4 chwil [bit] | 7,52 / 8,07 / 8,48 | 6,72 / 7,53 / 7,94 | 15/5 | 0,001 |
| przerwy ≥ 2 beaty /min | 0,00 / 0,57 / 5,78 | 0,63 / 2,49 / 7,05 | 4/16 | 0,021 |
| najdłuższa przerwa [beat] | 1,00 / 2,06 / 8,30 | 1,99 / 2,55 / 4,02 | 8/11 | 0,97 |
| CV nut na takt / kontrast 4 taktów (p50) | 0,30 / 1,68 | 0,30 / 1,64 | — | 0,50 / 0,73 |
| kiai / reszta | 1,03 / 1,22 / 1,45 | 0,98 / 1,16 / 1,58 | 10/10 | 0,65 |
| chwile bez dźwięku | 0,01 / 0,04 / 0,09 | 0,03 / 0,06 / 0,13 | 3/17 | 0,006 |
| recall snare / kick / lead / bass / hat (p50) | 0,49 / 0,30 / 0,44 / 0,37 / 0,25 | 0,34 / 0,24 / 0,33 / 0,27 / 0,00 | 19/0 … 13/0 | ≤ 0,024 |
| powtórzenie: rytm / baza (p50) | 0,91 / 0,63 | **0,33** / 0,22 (*) | 16/0; 20/0 | < 0,001 |
| powtórzenie: tory lub lustro | 0,39 | 0,50 | 9/7 | 0,30 |
| akord na granicy sekcji | 0,39 / 0,71 / 1,00 | 0,00 / **0,00** / 0,20 | 19/1 | < 0,001 |
| nuta na granicy (±30 ms, `sections.md`) (p50) | 1,00 | 0,81 | niżej w 15/20 | — |
| gęstość po/przed przy granicach w górę (`sections.md`) | 0,97 / 1,33 / 2,65 | 0,90 / 1,19 / 1,55 | — | — |
| model ludzki: AUC na slotach | 0,985 | 0,897 | — | — |

(*) Zaniżone przez drgania czasu algorytmu. Po przyciągnięciu do siatki linia bazowa algorytmu rośnie z 0,23 do 0,46, a ludzi zostaje 0,64 (`results/jitter_check.md`).

**Zgodne z ludźmi:** udział holdów, kiai / reszta, balans rąk, rozkład kroków między torami, zmiana ręki, brak akordów 3+, brak minijacków 1/4, odstęp puszczeń, CV taktów, kontrast 4 taktów.

### 5.2 Wg relacji tempa algorytmu do siatki ludzkiej

Źródło: `songs/<set>.json`.
- **8 utworów:** beat algorytmu w połowie tempa (`human_beat_over_algo_beat` = 0,5). Ludzie mają 190–284 BPM, algorytm 95–142 BPM.
- **4 utwory:** siatka podwojona przez `foldTempo` (`fold_factor` 2). Tempo jest poprawne, ale `feltBeatMs` liczy beat × 2.
- **7 utworów:** relacja 1:1. **1 utwór:** bez siatki (`NO_TIMING`).
- Faza downbeatu zgadza się (≥ 0,9 downbeatów) w 3/19 utworach; w 12/19 wynosi ≤ 0,2.

| ludzie p50 → algorytm p50 | odczuwany beat = 2 beaty ludzkie (n = 12) | 1:1 (n = 7) | bez siatki (n = 1) |
|---|---|---|---|
| nuty/s | 5,82 → 3,63 | 6,19 → 4,01 | 6,64 → 3,77 |
| odstępy 1/2 | 0,67 → **0,13** | 0,64 → 0,52 | 0,48 → 0,15 |
| odstępy 1/1 | 0,23 → 0,65 | 0,16 → 0,33 | 0,44 → 0,19 |
| maks. seria 1/2 | 28 → **4** | 31 → 9 | 17 → 5 |
| odstęp minijacka p50 [beat] | 1,00 → **2,00** | 0,87 → 1,00 | 1,00 → 1,61 |
| akordy / akordy poza beatem | 0,32 / 0,08 → 0,12 / 0,33 | 0,28 / 0,10 → 0,17 / 0,20 | 0,54 → 0,00 |
| długość holda p50 [beat] | 1,00 → 2,44 | 1,00 → 1,42 | — → 2,25 |
| rytm w powtórzeniu | 0,90 → 0,30 | 0,91 → 0,39 | 0,94 → 0,36 |

Mann–Whitney dla algorytmu, grupa „2 beaty” wobec 1:1: maks. seria 1/2 p = 0,001; odstępy 1/2 p = 0,002; odstęp minijacka p < 0,001; nuty/beat p < 0,001.

Gęstość jest za niska w obu grupach, więc to osobny problem (P1). Rytm 1/2 i odstępy torów zależą od relacji tempa (P2).

### 5.3 Wg gatunku (mediany ludzie → algorytm; n bardzo małe)

| metryka | anime (5) | electronic (6) | video game (4) | pop (4) | novelty (1) |
|---|---|---|---|---|---|
| nuty/s | 5,82 → 4,39 | 6,05 → 3,90 | 5,82 → 3,63 | 6,50 → 2,94 | 5,33 → 3,62 |
| odstępy 1/2 | 0,69 → 0,41 | 0,66 → 0,22 | 0,59 → 0,23 | 0,68 → 0,35 | 0,56 → 0,22 |
| maks. seria 1/2 | 31 → 8 | 34 → 4,5 | 23 → 4 | 56 → 4 | 17 → 7 |
| akordy | 0,38 → 0,16 | 0,25 → 0,13 | 0,27 → 0,13 | 0,37 → 0,09 | 0,20 → 0,16 |
| holdy z nutą w trakcie | 0,12 → 0,90 | 0,16 → 0,89 | 0,17 → 0,90 | 0,10 → 0,83 | 0,00 → 0,94 |
| puszczenie na beacie | 0,65 → 0,04 | 0,77 → 0,11 | 0,90 → 0,09 | 0,56 → 0,12 | 1,00 → 0,00 |
| downbeaty z nutą | 0,94 → 0,67 | 0,95 → 0,50 | 0,94 → 0,68 | 0,98 → 0,66 | 0,98 → 0,71 |
| tryle | 0,04 → 0,14 | 0,06 → 0,13 | 0,08 → 0,14 | 0,08 → 0,17 | 0,04 → 0,13 |
| rytm w powtórzeniu | 0,96 → 0,26 | 0,93 → 0,33 | 0,84 → 0,42 | 0,89 → 0,33 | 0,90 → — |
| akord na granicy sekcji | 0,86 → 0,11 | 0,69 → 0,00 | 0,56 → 0,04 | 0,86 → 0,00 | 0,80 → 0,20 |
| kiai / reszta | 1,20 → 1,19 | 1,30 → 1,13 | 1,22 → 1,02 | 1,19 → 1,27 | 1,15 → 1,21 |

Wszystkie problemy występują we wszystkich gatunkach. W utworach, w których algorytm prowadzi głównie `lead` (> 50% fraz; 4 utwory, w tym 2 pop), nps algorytmu / człowieka wynosi 0,47; w pozostałych 16 utworach 0,65. To słaby sygnał (n = 4).

---

## 6. Problemy algorytmu na Normal (od największego wpływu)

### P1. Za mało nut i brak strumienia 1/2: limit gęstości Normal jest poniżej ludzkiej mediany

- **Co:** algorytm nie osiąga ludzkiej gęstości w żadnym utworze ani gatunku i prawie nie gra półbeatów.
- **Dowód:**
- nuty/s 3,70 wobec 6,00 (niżej w 20/20); okno 2 s p90 4,5 wobec 7,5, maks. 5,5 wobec 9,25;
- nps w przedziale 4,5–8: 3/20 chartów algorytmu wobec 72/78 i 20/20 map ludzi;
- sloty: beaty 0,72 wobec 0,89, półbeaty 0,27 wobec 0,56; półbeat z onsetem perkusyjnym w głośnej części 0,39 wobec 0,77–0,81;
- maks. seria 1/2: 4 wobec 31, a nawet w utworach 1:1 tylko 9; seria 1/2 ≥ 9 nut w 6/20 wobec 74/78;
- wynik nie zależy od drgań czasu: po przyciągnięciu nut do siatki seria nadal ma 4 nuty (`jitter_check.md`);
- mapy nazwane „Normal” mają p50 5,93, więc różnica nie wynika z map „Hard” w zakresie SR.
- **Klasa:** łamie silne tendencje (nps 4,5–8: 92% map; 1/2 najczęstszą klasą: 90%) i twardą zasadę (seria 1/2 ≥ 1 takt: 95%). Test potwierdza: 20/20, 18/20, 19/20.
- **Kod:**
- `difficulty.js` → `DIFFICULTIES.normal`: `maxNps: 5`, `maxNpsCeiling: 5.5`. Sam strumień 1/2 przy 180 BPM to 6 nut/s.
- `difficultyFilter.js` → `densityHolds`: limit `floor(maxNps·2·max(powerFloor, power) + 1)` chwil na 2 s. `power` to średnia energia × intensywność (`windowPower`), w zwykłych częściach < 1.
- `pulsePowerFloor` (`pulseNotesPerBeat: 1`) gwarantuje tylko 1 nutę na beat i tylko we frazach perkusyjnych ze stałym pulsem.
- `applyDifficulty`: `quarterMinEnergy: 0.75` i `capQuarters` (`maxQuarterShare: 0.1`) ograniczają zdarzenia poza siatką 1/2 algorytmu; przy P2 to właśnie ludzkie półbeaty.
- `fastRunHolds` (`maxFastRun: 3`, `FAST_GAP_BEATS = 0.3` odczuwanego beatu).
- `selectionOrder` (`leaderFirst`): beaty najpierw, półbeaty dostają resztę limitu.
- `bandPath.js` → `thin`: cel `maxNps × power`.
- **Test:** tak.
- **Wpływ: wysoki.** Ludzki Normal to puls 1/1 z gęstym 1/2. Chart z 60% nut i bez serii 1/2 brzmi jak „połowa piosenki”.
- **Adaptacja z osu!:** osu! Normal może być trudniejszy niż Normal zamierzony dla tej gry. Jeśli Normal ma być lżejszy:
- obniżać gęstość zmianą podziału zależnie od BPM (1/1 z akcentami 1/2 przy wysokim BPM, 1/2 przy średnim), a nie losowym przerzedzaniem;
- zachować puls na beatach i serie 1/2;
- liczyć cel w czasie (ludzie: ok. 6 nut/s, typowy odstęp 140–230 ms), a nie jako `maxNps × energia`.

### P2. Tempo w połowie i zła faza taktu: reguły Normal liczą się w „odczuwanych beatach” dwa razy za grubych

- **Co:** 12/19 utworów z siatką ma odczuwany beat algorytmu równy 2 beatom ludzkim.
- 8 utworów to połowa tempa, np. 1277503: 190 → 95 BPM, 363594: 284 → 142.
- 4 utwory mają tempo podwojone przez `foldTempo` (np. 1000722: 77 × 2 = 154, zgodnie z człowiekiem), ale `feltBeatMs` mnoży beat przez `foldFactor`. Ludzie w tych utworach mapują 1/2 na podwojonej siatce (odstępy 1/2: 0,78; 0,75; 0,79; 0,64).
- Faza taktu zgadza się w 3/19 utworach. W części utworów beaty algorytmu leżą na ludzkich półbeatach (`on_human_half_not_beat_share` do 0,38 w 1570640).
- **Dowód:**
- grupa „2 beaty” wobec 1:1: odstępy 1/2 0,13 wobec 0,52; seria 1/2 4 wobec 9; odstęp minijacka 2,0 wobec 1,0 beatu (MW p ≤ 0,002);
- akordy poza beatem 0,28 wobec 0,09 u ludzi;
- downbeaty z nutą 0,67 wobec 0,96 (≥ 0,8 w 2/20 wobec 70/78 i 18/20);
- chwile na 1/1 lub 1/2 ≥ 0,85 w 6/20 wobec 69/78;
- chwile poza 1/1–1/4 ludzkiej siatki: p50 0,20 wobec 0. Większość leży 10–30 ms od punktu siatki (klasy 1/12 i 1/16: 0,02 i 0,11; off: 0,04). Ok. 2% leży na 1/3, 1/6 lub 1/8.
- **Klasa:** błąd algorytmu, który łamie silne tendencje ludzi (downbeaty, siatka 1/1–1/2). **Test:** tak.
- **Kod:**
- `lavalink-plugins/.../dsp/TempoEstimator.java`:
  - prior log-Gauss `PRIOR_CENTRE_BPM = 120`, `PRIOR_SIGMA_OCTAVES = 1.4` daje około 95 BPM przewagę ok. 8,5% nad 190 BPM;
  - `downbeatPhase` wybiera indeks beatu mod 4 z największą energią niskiego pasma, więc stopa na 1 i 3 łatwo przesuwa takt o pół.
- `timing.js` → `foldTempo`: zakres 70–200 BPM zostawia 95 BPM bez zmian; reguła half-time działa tylko < 95 BPM i przy ≥ 8 silnych onsetach na beat.
- `difficultyFilter.js` → `feltBeatMs` (× `foldFactor`), używane przez `beatGapMs`/`fits` (`gapBeats` 1/4), `fastRunHolds`, `spaceChords` (`chordGapBeats` 1/2) i `spreadLanes` (`laneGapBeats` 1).
- `offHalfGrid`, `capQuarters` i `quarterMinEnergy` działają na siatce algorytmu.
- `rests.js` → `restsOf` liczy `fillRestBeats` w beatach algorytmu.
- Poza chartem: `generate.js` → `chartFrom` zapisuje `bpm` = 95 zamiast 190. `activity/src/mewbeat/highway.js` → `tempoScrollFactor` daje wtedy √(95/120) = 0,89 zamiast 1,2, czyli nuty spadają ok. 26% wolniej.
- **Wpływ: wysoki.** Ponad połowa utworów. Rytm ludzki (1/2) i akcenty taktu (akordy, granice) znikają albo lądują w złym miejscu. Faza przesunięta o pół beatu daje odczucie synkopy, której w muzyce nie ma.
- **Adaptacja:** w osu! timing ustawia człowiek. Zasady RC odnoszą się do tempa, w którym zapisano mapę. Ludzie traktują siatkę podwojoną przez fold jako prawdziwą, a mnożenie przez `foldFactor` temu przeczy.

### P3. Holdy innego rodzaju niż ludzkie: długie, z grą drugiej ręki w trakcie, puszczane poza siatką

- **Dowód (część 2.3):**
- holdy z nutą w trakcie 0,90 wobec 0,10; puszczenie poza 1/1 i 1/2 0,81 wobec 0,00; puszczenie na beacie 0,08 wobec 0,69;
- hold ≈ 1/2 beatu 0 wobec 0,28, hold ≈ 1 beat 0 wobec 0,42; długość p50 1,86 wobec 1,00 beatu;
- hold w akordzie 0 wobec 0,42; następna chwila tuż po puszczeniu 0,45 wobec 0,95;
- reguły ludzi z części 2.3 spełnia **0/20** chartów algorytmu, wobec 58–64/70 map ludzi (test 13–17/18).
- **Klasa:** silne tendencje. Twarda zasada „hold ≥ 1/2 beatu” jest zachowana nadgorliwie, bo `holdMinBeats: 1`. **Test:** tak.
- **Kod (`holds.js`):**
- `planHolds`: `len = min(sustainMs, 4 beaty, następna nuta toru − minLaneGapMs, koniec frazy − minLaneGapMs)`, zaokrąglane `Math.round` bez przyciągania do siatki;
- `addGapHolds`: tap, po którym ręka odpoczywa ≥ 1,25 beatu, trzymany do „następna nuta ręki − odstęp” (`gapHoldShare: 0.25` w `difficulty.js`);
- `addSustainHolds`: długość z pitch trackera;
- `holdBlocks`: przy `holdOtherHand !== "free"` blokuje nutę w tej samej chwili, więc hold nigdy nie jest w akordzie;
- `spacedBlocked` (`"spaced"`): pozwala drugiej ręce grać co 1/2 beatu w trakcie holda;
- `gapAfterHold` / `enforceFloors`: każą tej samej ręce czekać ≥ 100 ms po puszczeniu.
- **Wpływ: wysoki do średniego.** Holdy to 12% nut. 90% z nich wymaga niezależności rąk, której RC Normal nie zakłada. Puszczenia poza siatką są oceniane (okno × 1,5) i nie odpowiadają żadnemu dźwiękowi.
- **Adaptacja:** koniec holda jest oceniany jak w osu!, więc ludzki wzorzec „hold do następnej nuty” przenosi się wprost. Zastrzeżenie: u ludzi 32% puszczeń zbiega się z nutą tej samej ręki na innym torze, a reguła gry (≥ 100 ms) to blokuje. Trzeba dopuścić inny tor tej ręki albo kończyć hold na poprzednim punkcie siatki. Wygodę obu wariantów musi ocenić gracz.

### P4. Za mało akordów i w złych miejscach

- **Dowód:**
- akordy 0,14 wobec 0,32 (niżej w 19/20; ≥ 15% chwil w 8/20 wobec 73/78);
- akordy z sąsiadem w odstępie 1/2 beatu 0,06 wobec 0,69; poza beatem 0,28 wobec 0,09;
- na granicy sekcji 0,00 wobec 0,71 (≥ 50% granic: 0/20 wobec 64/78); hold w akordzie 0 wobec 0,42;
- w utworze `NO_TIMING` (2270163) 0 akordów wobec 0,54.
- **Klasa:** silna tendencja. **Test:** tak (19/20; 17/20).
- **Kod:**
- `difficultyFilter.js` → `thinChords`: akord tylko na beacie algorytmu, przy s ≥ 0,4, energii frazy ≥ 0,45 i z budżetem `maxChordShare: 1/3`;
- `spaceChords`: `chordGapBeats: 1/2` odczuwanego beatu, przy P2 0,9 beatu ludzkiego, więc akord nie może mieć sąsiada w odstępie 1/2;
- `patterns.js` → `withChords`: akcent tylko na początku taktu algorytmu pod pojedynczym zdarzeniem level 0 lidera;
- `drumChordEvents`: tylko przy liderze tonalnym i energii ≥ 0,6;
- w `mixedEvents` stopa na początku taktu pod liderem ma `CHORD_LEVEL = 2`, czyli trafia tylko do Hard;
- `holds.js` → `holdBlocks` wyklucza akord z holdem; złe downbeaty (P2) przesuwają akcenty.
- **Wpływ: średni do wysokiego.** Akordy to u ludzi główny akcent Normal (co trzecia chwila). Akordy poza beatem i brak akordu na wejściu refrenu są słyszalne.
- **Adaptacja:** 4 tory pozwalają na te same akordy 2-nutowe co osu! 4K. Ludzie robią je w 46% w jednej ręce ([01], [23]), więc wymóg „nuta w każdej ręce” z `thinChords` jest ostrzejszy niż u ludzi.

### P5. Dziury w pulsie i nieregularne długie odstępy

- **Dowód:**
- beaty z nutą 0,72 wobec 0,89 (sloty); głośny beat z onsetem perkusyjnym 0,80 wobec 0,99; downbeaty 0,67 wobec 0,96;
- odstępy 3/2 i 2 beaty 0,08 wobec 0,02 (wyżej w 20/20); odstępy ≥ 3/2 ≤ 5% w 5/20 wobec 65/78 i 19/20;
- przerwy ≥ 2 beaty 2,49/min wobec 0,57.
- **Klasa:** silna tendencja. **Test:** tak.
- **Kod:**
- `rests.js` → `fillRests`:
  - wypełnia tylko przerwy ≥ `fillRestBeats` (2) × `beatMsOf`, co przy P2 daje 4 beaty ludzkie;
  - wstawia **jedną** nutę najbliżej środka, więc przerwa 4 beatów zmienia się w 2 + 2;
  - działa tylko przy energii ≥ `FILL_MIN_ENERGY` 0,2.
- `difficultyFilter.js` → `selectByFloors` (kolejność `leaderFirst` i limit z P1).
- `phrases.js` → `chooseLeaders` / `supportLayers`: w utworze wokalnym prowadzi `lead` bez warstw wsparcia, a sylaby nie padają na każdy beat (nps algorytm / człowiek 0,47 wobec 0,65; n = 4).
- **Wpływ: wysoki.** Puls na beatach to szkielet ludzkiego Normal. Dziura 1,5–2 beatów w grającej muzyce brzmi jak zgubiona nuta.
- **Adaptacja:** bez zmian względem osu!.

### P6. Przerwy i kontrast sekcji: algorytm gra w ludzkich przerwach i nie zmienia gęstości na granicy

- **Dowód:**
- algorytm gra w 11/13 ludzkich przerw ≥ 4 beaty na teście (0,67 nuty/beat); najdłuższa przerwa p90 4,0 wobec 8,3 beatu;
- granice w górę, po/przed: algorytm 1,19 (0,90–1,55), ludzie test 1,33 (0,97–2,65), trening 1,38 (0,94–3,73); oficjalna metryka daje ten sam obraz (1,20 wobec 1,28);
- profil taktów: ludzie skaczą w takcie 0 (0,70–0,76 → 1,00), algorytm rośnie już w takcie −1 (1,00) i spada w takcie 0 (0,90);
- akord na granicy 0 (P4).
- **Klasa:**
- Skok gęstości i nuta na granicy to silna tendencja.
- Długie przerwy są stylem (18/78 map). Tam, gdzie się pojawiają, wypadają w cichych miejscach przy granicach sekcji.
- **Test:** kierunek ten sam (35 granic w górę, 29 w dół).
- **Kod:**
- `intensity.js` → `sectionIntensity`: wykładnik 0,6, wynik obcięty do 0,6–1,3;
- `phrases.js` → `buildPhrases`: frazy po 16 beatów algorytmu; sekcje z samej energii (`Highlight.sections`: mediana ±0,15, wygładzanie 4 s), przyciągane do błędnych downbeatów;
- `difficultyFilter.js` → `windowPower`: okna 2 s przechodzą przez granicę;
- `rests.js` → `fillRests`: wypełnia każdą przerwę ≥ 2 beaty przy energii ≥ 0,2.
- **Wpływ: średni.** Stosunek gęstości kiai do reszty jest podobny jak u ludzi (1,16 wobec 1,22). Brakuje wyraźnego wejścia nowej sekcji i oddechu w cichych przejściach.
- **Adaptacja:** w osu! przerwy oznacza się breakami. Tutaj warto oprzeć je na RMS audio, z którego powstaje chart, bo bot może grać inny upload.

### P7. Rytm nie powtarza się, kiedy powtarza się muzyka (wynik częściowo zawyżony przez pomiar)

- **Dowód:**
- rytm w powtórzeniu 0,33 wobec 0,91 (≥ 0,8 w 1/16 wobec 57/62 i 17/19); przewaga nad bazą 0,11 wobec 0,31 (≥ 0,1 w 9/16 wobec 57/61);
- kontrola czułości (`results/jitter_check.md`): po przyciągnięciu nut do siatki linia bazowa algorytmu rośnie z 0,23 do 0,46, a ludzi zostaje 0,64. Część różnicy to drgania czasu (P2), ale nawet po korekcie rytm algorytmu jest mniej regularny;
- tory algorytm powtarza nawet częściej niż ludzie (0,50 wobec 0,39).
- **Klasa:** silna tendencja („Be consistent!”). **Test:** tak, wielkość efektu niepewna.
- **Kod:**
- `generate.js` → `copiedRepeat` i `repeats.js` → `copyRepeat`:
  - kopiują tylko frazy pluginu z `repeatOf` przy `similarity ≥ 0,85`, a fraza to 16 beatów algorytmu (przy P2 8 taktów ludzkich);
  - nuta bez zdarzenia w ±60 ms przepada; przy < 50% zachowanych nut fraza jest mapowana od nowa, a okna 2 s i ogon poprzedniej frazy dają wtedy inny rytm.
- `barRepeats.js` → `repeatBarLanes` kopiuje tylko tory, i tylko w obrębie frazy.
- **Wpływ: średni, niepewny.** Ten sam refren grany inaczej, groove się nie układa.
- **Adaptacja:** bez zmian względem osu!.

### P8. Wzorce torów: za dużo trylów, za mało minijacków, tor zależny od instrumentu

- **Dowód:**
- tryle 0,14 wobec 0,07 (wyżej w 19/20; ≤ 0,10 w 2/20 wobec 67/78); tryle w jednej ręce 39% wobec 18%;
- minijacki 0,04 wobec 0,09, odstęp minijacka 2 beaty wobec 1; entropia wzorców 7,53 wobec 8,07;
- lewa ręka: kick 0,62 (tory zewnętrzne 0,59), snare 0,45; u ludzi 0,50 dla każdego dźwięku.
- **Klasa:** silna tendencja (tryle). Tor zależny od instrumentu to styl kodu, który nie występuje u ludzi. **Test:** tak.
- **Kod:**
- `patterns.js` → `hitsOf`: tor `n % 2` z pary (snare 1↔2, kick 0↔3), więc same werble dają tryl;
- `mixedEvents`: stopa w lewej ręce (0/1), werbel i hi-hat w prawej (2/3), hi-haty naprzemiennie, więc tryl w jednej ręce;
- `tonalLanes`: szybko powtarzana wysokość dźwięku daje tryl z sąsiednim torem;
- `difficultyFilter.js` → `spreadLanes`: powtórzenie toru bliżej niż `laneGapBeats` (1 odczuwany beat) przenosi nutę na drugą rękę; `limitJacks` (`maxJack: 2`).
- **Wpływ: średni do niskiego.** Rozstrzygnie gra.
- **Adaptacja:** pitch relevancy z poradnika osu! (pisanego z myślą o 7K) nie występuje w ludzkim Normal 4K i nie warto jej wymuszać.

### P9. Wybór dźwięku wg klasy perkusji pluginu; hi-haty pominięte

- **Dowód:**
- w modelu algorytmu klasy kick/snare/perc mają +0,51…+0,55, u ludzi ≈ 0;
- recall hi-hatu 0,03 wobec 0,39 (na 1/1 i 1/2: 0,07 wobec 0,76; na 1/2: 0,08 wobec 0,73); recall snare 0,34 wobec 0,49;
- model ludzki przewiduje sloty algorytmu z AUC 0,897 wobec 0,985 dla ludzi.
- **Klasa:** silna tendencja ludzi. **Test:** tak.
- **Kod:**
- `patterns.js` → `hatsOf` (level 2) i `drumEvents` (uderzenia na 1/8: level 2). Normal ma `maxLevel: 1` w `applyDifficulty`, więc hi-haty nie wchodzą nigdy.
- `DrumDetector.java`: na sygnale kalibracyjnym 112/266 hi-hatów jest oznaczanych jako snare.
- **Wpływ: średni do niskiego.** To część niedoboru półbeatów z P1.
- **Adaptacja:** brak, to sprawa detekcji.

### P10. Drobne

- **`LEAD_IN_MS = 1500`.** Pierwsza nuta algorytmu: p50 1,65 s wobec 0,89 s u ludzi (p10 0,19 s). Wpływ niski.
- **`minNoteGapMs: 100`.** Ludzie mają rzadkie odstępy krótsze (min. p50 88 ms). Wpływ niski.
- **Drgania czasu.** Ok. 17% chwil algorytmu leży 10–30 ms od ludzkiej siatki (`grid_error_ms` p50 4,1 ms, p90 8,0 ms). W 808872 przesunięcie jest systematyczne: 13–15 ms przed siatką. Mieści się to w oknie PERFECT, ale psuje metryki rytmu (P7) i może być wyczuwalne. Wpływ niski do średniego.
- **`NO_TIMING`** (1/20 utworów; 2270163, pewność 0,497 < 0,5): brak siatki oznacza brak akordów i nuty „pływające” poza siatką (`triplet_share` 0,20). Wpływ wysoki dla takiego utworu, ale przypadek rzadki.

**Hipotezy z `algorithm.md` (część 5), sprawdzone na Normal:**

1. Triole: ludzie ich nie używają (twarda zasada), więc brak trioli **nie jest problemem Normal**. „Triole” w pomiarze algorytmu to błędy siatki.
2. Zmienne BPM (20/98 map) i metrum inne niż 4/4 (5/98): nie da się oddzielić od P2 na 20 utworach testowych.
3. Brak pojęcia buildupu: ludzie na Normal też go nie budują (1,04), ale skaczą gęstością na granicy. Potwierdzona częściowo (P6).
4. `fillRests` zabiera kontrast: potwierdzona częściowo (P5, P6).
5. Reguły Normal kolidują ze sobą: potwierdzona, szczególnie przy P2.
7. Udział holdów: nie jest problemem. Problemem jest rodzaj holdów (P3).
8. Stały przydział torów perkusji: potwierdzona (P8).
9. Klasy perkusji pluginu: algorytm wybiera według nich, ludzie nie (P9).

---

## 7. Kandydaci do testów odsłuchowych i gry

Czasy są na osi audio z map. Bot może grać inny upload, więc czasy są przybliżone (±1–2 s). Nuty z pozycjami na siatce pokazuje `07_window.py <set> <od> <do>`.

| # | set | utwór | czas | relacja tempa | na co zwrócić uwagę |
|---|---|---|---|---|---|
| 1 | 2224035 | JINGBURGER – Konton Boogie | 01:44–01:49 (kiai) | 2 beaty | Człowiek: 39 nut, akordy na każdym beacie, 1/2. Algorytm: 10 nut na ludzkich 1/3, 1/6, 1/8. Czy nuty „pływają” względem bitu? |
| 2 | 1894317 | kessoku band – Seishun Complex (TV Size) | 01:16–01:21 (kiai) | 2 beaty | Człowiek: strumień 1/2 z akordami i holdami 1/2. Algorytm: ćwierćnuty na beatach (17 nut wobec 43). Czy refren brzmi jak „połowa piosenki”? |
| 3 | 2200258 | Kashii Moimi feat. KAFU – Cat Loving (kageminori bootleg) | 00:19–00:23 (kiai) | 2 beaty | Człowiek: jump na każdym beacie przy 220 BPM. Algorytm: pojedyncze nuty i 2 długie holdy (12 wobec 32 nut, 2 wobec 13 akordów). Czy brak akcentów jest odczuwalny? |
| 4 | 1784295 | Rokudenashi – Tada Koe Hitotsu | 00:45–00:53 (wejście sekcji) | 1:1 | Człowiek: strumień 1/2 z akordem co beat (20 akordów). Algorytm: strumień bez akordów, potem nuty poza siatką i nakładające się holdy. Czy wejście sekcji jest zaznaczone? |
| 5 | 2270163 | ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasavitsa | 00:34–00:39 | bez siatki | Człowiek: akord na każdym beacie. Algorytm: 0 akordów, holdy z nutami drugiej ręki. Jak gra się chart bez siatki? |
| 6 | 1570640 | Lime – 8bit Voyager | 00:44–00:50 | 2 beaty, faza na półbeatach | Człowiek: przerwa ok. 2,5 s (44,9–47,3 s). Algorytm: seria holdów na półbeatach z nutami w środku. Czy przerwa była potrzebna i czy synkopa holdów pasuje do muzyki? |
| 7 | 1773164 | TUYU – Itsuka Otona ni Nareru to Ii ne. | 01:06–01:12 | 2 beaty | Człowiek: łańcuch holdów 1/2, każdy puszczany na następnej nucie. Algorytm: nuty na 1/8 i 1/3, holdy puszczane poza siatką. Czy puszczenia są czytelne? |
| 8 | 2314654 | Laur – PRAGMATISM -RESURRECTION- | 02:27–02:33 | 1:1 | Człowiek: długi trzymany akord (breakdown, ok. 2,8 s). Algorytm: 14 nut na 1/8, 1/3, 1/6 z holdami. Czy spokojny fragment powinien być gęsty? |
| 9 | 808872 | Kobaryo – Perfect Neglect | 00:51–00:55 | 2 beaty | Człowiek: strumień 1/2 przy 230 BPM. Algorytm: 1 nuta na beat, 13–15 ms przed siatką. Czy przesunięcie i wolniejsze spadanie (BPM 115 w chartcie) przeszkadzają? |

Liczby nie rozstrzygną:
- czy ok. 6 nut/s jest właściwe dla gracza Normal w tej grze;
- czy „hold do następnej nuty” tą samą ręką jest wygodny;
- czy brak akordu na wejściu refrenu jest słyszalny;
- czy tryle męczą.

To muszą ocenić testerzy w grze.

---

## 8. Prośby o nowe metryki (dla agenta głównego, nie są to metryki oficjalne)

1. **`hold_short_share` z tolerancją.** Dziś próg to `< 0,5 − 1e-6`, więc holdy dokładnie 1/2 beatu zapisane w całych ms (np. 166 ms przy 180 BPM) liczą się jako krótsze. Efekt: 29/78 map bez holdów < 1/2 beatu, a przy progu 0,45 jest ich 69/70. Propozycja: progi 0,45 i 0,95 beatu albo klasy długości z tolerancją ±6%, jak w `gap_share`.
2. **Kontekst holdu:**
 - `hold_chord_start_share` (ludzie 0,42, algorytm 0);
 - `release_to_next_moment_beats` (ludzie p50 0), osobno dla tej samej i drugiej ręki (druga 85%, ta sama 32%);
 - `hold_len_class_share` (≈ 1/2, ≈ 1, ≈ 2, inne).

 Powód: P3 widać dziś tylko pośrednio.
3. **Shield** (RC: „avoid any form of 1/4 shield”): nuta na tym samym torze tuż przed startem holda, w odstępie ≤ 1/4 i ≤ 1/2 beatu, na minutę.
4. **Anchor zgodny z RC:** w strumieniu (odstępy ≤ 1/2 beatu) udział najczęstszego toru w oknie N chwil, z wyłączeniem trylów. Obecny `anchor_max_notes` daje p50 6 i spełnia go 0/78 map, więc nic nie mówi.
5. **Pokrycie siatki:** `beat_coverage` i `half_coverage` w czasie aktywnym, liczone ze slotów (ludzie 0,89 / 0,56, algorytm 0,72 / 0,27). To najbardziej informatywna pojedyncza liczba dla Normal.
6. **Akordy w strumieniu:** udział akordów z sąsiednią chwilą ≤ 1/2 beatu (ludzie 0,69, algorytm 0,06).
7. **Odstępy w klasach ms** (< 120, 120–180, 180–260, > 260 ms), żeby porównywać mapy różnego BPM tak, jak robi to skala RC.
8. **Powtarzalność rytmu po przyciągnięciu do siatki** (`grid.snap` albo ±1/48 beatu). Obecne biny 1/24 zaniżają algorytm: jego baza po przyciągnięciu rośnie z 0,23 do 0,46, ludzi zostaje 0,64.
9. **`sections.boundary_note_share` z tolerancją ±25 ms**, jak `alignment`. Dla algorytmu wychodzi 0,23 przy tolerancji siatki, a 0,81 przy ±30 ms.
10. **Przerwy w kontekście:** udział przerw ≥ 4 beaty przy RMS < 0,5 mediany i ≤ 4 takty od granicy sekcji.
11. **Ręka wg dźwięku:** lewa ręka dla nut na `kick`, `bass`, `lead`, `high` (ludzie 0,50 wszędzie, algorytm kick 0,62).
12. **Tryl w jednej ręce:** udział trylów na parach torów 0-1 i 2-3 (ludzie 18%, algorytm 39%).

---

## 9. Ograniczenia

- **Liczności.** Test ma 20 utworów, czyli 4–6 na gatunek: porównania gatunków na teście są anegdotyczne. Trening to 78 map od 61 mapperów, z tego 14 mapperów ma po 2–3 mapy. Korpus składa się z map Ranked i popularnych, więc już przeszedł przez filtr RC.
- **Zakres SR to nie „Normal gry”.** 10/78 map w zakresie nazywa się Hard. Wyniki sprawdziłem na 65 mapach nazwanych Normal i się nie zmieniają, ale docelowa trudność Normal w grze może być niższa niż w osu!.
- **Pomiar algorytmu na ludzkiej siatce.**
- Tolerancja to min(10 ms; 0,03 beatu), a ok. 17% chwil algorytmu leży 10–30 ms od siatki. To zawyża udziały 1/16 i off, zaniża `boundary_note_share` i rytm w powtórzeniach (P7).
- Serie 1/2 kontrola czułości potwierdziła (4 → 4 po przyciągnięciu).
- P1, P3 i P4 (gęstość, długości holdów, nuty w trakcie holdów, liczba akordów) nie zależą od tolerancji.
- **Przyczyny w kodzie.** Nie miałem cech pluginu (`features`), więc przypisanie do funkcji opiera się na lekturze kodu i zgodności wzorców. Przykłady:
- odstęp minijacka 2,0 zgodny z `laneGapBeats` w odczuwanych beatach;
- maks. seria 1/2 = 4 zgodna z `maxFastRun: 3`;
- zero akordów z holdem zgodne z `holdBlocks`.

Nie odtwarzałem decyzji nuta po nucie. Grupy relacji tempa (12 / 7 / 1) są małe.
- **Regresja slotów.** Sloty nie są niezależne, a cechy są współliniowe, więc współczynniki to wskazówki, a nie efekty przyczynowe. AUC z puli zawyża wpływ różnic gęstości między utworami, dlatego podaję też medianę AUC na utwór.
- **Oś czasu.** Przesunięcie osi ludzi dopasowano na ich nutach, co lekko zawyża ich trafienia w onsety. Stemy pochodzą z separacji opisanej w `metrics.md` i nie były osobno walidowane.
- **Pomiary pomocnicze.** Holdy z tolerancją, akordy z sąsiadem, ręka wg dźwięku, przerwy w kontekście i kontrola drgań nie są oficjalnymi metrykami. Opisuje je część 8, liczą je `04_holds.py`, `08_aux.py` i `10_jitter_check.py`.
- **Granice sekcji z audio** (Foote) nie zawsze pokrywają się z granicami, które słyszy mapper.
- Popularność i oceny map nie są tu miarą jakości.

---

## 10. Jak odtworzyć

```sh
PY=/tmp/claude-0/-home-user-MewBit/4930cd9b-e13e-5233-b473-de00f0007e62/scratchpad/venv/bin/python
cd mapping-analysis/levels/normal
$PY -I 01_profile.py       # profil metryk, reguły, BPM → results/profile_metrics.{csv,md}, rules.md, bpm.md
$PY -I 02_slots.py         # sloty: pozycje, recall klas i stemów, regresja → results/slots.md, slots_coefs.csv
$PY -I 03_sections.py      # granice sekcji, intro/outro, kontrast → results/sections.md, sections_*.csv
$PY -I 04_holds.py         # holdy z tolerancją, nuty w trakcie, puszczenia → results/holds.md, holds_per_chart.csv
$PY -I 05_genres.py        # gatunki: KW + BH, OLS z BPM, test, algorytm wg gatunku → results/genres.md
$PY -I 06_algo.py          # algorytm vs ludzie, relacja tempa, per utwór, okna → results/algo_vs_human.md, windows.csv, candidates.md
$PY -I 08_aux.py           # akordy z sąsiadem, ręka wg dźwięku, długie przerwy → results/aux.md
$PY -I 09_numbers.py       # liczności tendencji, wpływ oznaczonych utworów → results/numbers.md
$PY -I 10_jitter_check.py  # czułość rytmu na drgania czasu algorytmu → results/jitter_check.md
$PY -I 07_window.py 2224035 1:44 1:49   # podgląd fragmentu z pozycjami na siatce ludzkiej
```

Wspólny kod jest w `common.py`. Skrypty czytają tylko dane Normal, `shared/data/songs/` oraz kolumny ogólne i `normal_*` z `shared/corpus.csv`. Piszą wyłącznie do `levels/normal/results/`. Wyniki są deterministyczne.