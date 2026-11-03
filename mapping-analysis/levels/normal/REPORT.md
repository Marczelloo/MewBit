# Normal: profil mapowania ludzi i porównanie z generatorem v19 (etap 2, metryki v2)

**Zakres.** Tylko poziom Normal (SR osu!mania 4K w [1,65; 2,7)).

**Dane.**
- `shared/data/normal/*` i `shared/data/songs/*` w wersji metryk v2.
- Kolumny ogólne oraz `normal_*` z korpusu.
- Kod `helpers/mewbeat/charts/*.js` i DSP pluginu.

Tabele szczegółowe są w `results/`, a skrypty w tym katalogu (część 10).

**Liczności.**
- Trening: **78 map ludzi od 61 mapperów** (`normal_owners`; 14 mapperów ma po 2–3 mapy).
- Test: **20 map od 20 mapperów** i 20 chartów generatora na tych samych utworach. Mapperzy testu nie występują w treningu.
- 2 ze 100 zestawów nie mają dyfficulty Normal.

**Klasyfikacja na mapach treningowych.**
- **Twarda zasada:** spełnia ją ≥ 95% map.
- **Silna tendencja:** 75–95%.
- **Styl / zależna:** poniżej 75%.

„Sprawdzenie na teście” to ten sam udział liczony na 20 mapach testowych. Czasy są na osi zdekodowanego audio.

---

## 1. Podsumowanie

1. Ludzki Normal to przede wszystkim **ciągły puls na siatce**.
 - Chwila stoi na 89% beatów (`coverage.beat`, p10–p90 0,74–0,97), na 61% półbeatów i tylko na 3% ćwierćbeatów.
 - Sama pozycja w siatce przewiduje decyzję mappera z AUC 0,977.
 - Dźwięk (onset perkusyjny, głośność) decyduje głównie o półbeatach. Klasa instrumentu prawie się nie liczy.
2. Gęstość u ludzi prawie nie zależy od tempa: **ok. 6 nut/s** (5,0–7,3) w zakresie 100–284 BPM. Od tempa zależy podział:
 - poniżej 150 BPM pojawia się 1/4;
 - w zakresie 150–230 BPM dominuje 1/2;
 - od ok. 240 BPM przeważa 1/1.

 To zgadza się ze skalą BPM z Ranking Criteria, ale 1/2 trzyma się do wyższego tempa, niż RC sugeruje.
3. Generator jest na Normal **o 40% za rzadki**: 3,7 nut/s wobec 6,0, niżej w 20/20 utworów.
 - Gubi strumień 1/2: pokrycie półbeatów 0,23 wobec 0,58, najdłuższa seria 1/2 ma 4 nuty wobec 31.
 - Gdy już stawia nutę, zwykle trafia w ludzką chwilę (precyzja 0,85), ale pomija 42% ludzkich chwil (recall 0,58).
 - Przyczyny to limit gęstości (`maxNps` 5) i reguły „czytelności” Normal liczone w „odczuwanych beatach”.
4. W 12 z 19 utworów z siatką odczuwany beat algorytmu to **dwa beaty ludzkie**.
 - Beat tracker łapie połowę tempa albo `foldTempo` podwaja siatkę, a `feltBeatMs` mnoży beat przez `foldFactor`. Wszystkie progi Normal działają wtedy dwa razy za mocno.
 - Faza taktu algorytmu zgadza się z ludzką tylko w 3/19 utworów.
5. Holdy algorytmu są innego rodzaju niż ludzkie.
 - U ludzi przeważają krótkie holdy (< 1½ beatu). Te krótkie są puste, a puszczenie w 96% wypada na następnej chwili.
 - U algorytmu przeważają holdy ≥ 1½ beatu. Holdy 1-beatowe mają w 78% nuty w środku, puszczenie trafia w następną chwilę w 10%, a głowa holda nigdy nie jest w akordzie.
6. Akordów jest za mało i stoją w złych miejscach.
 - 14% chwil wobec 32%.
 - W strumieniu 1/2: 0 na minutę wobec 25.
 - Na granicy sekcji: 0,13 wobec 0,71.
 - Na starcie kiai: 0 wobec 1,00; u ludzi to twarda zasada.

 Rytm nie powtarza się, gdy powtarza się muzyka: 0,41 wobec 0,91.
7. Gatunek prawie nie zmienia reguł. Po korekcie na wielokrotne testy różnią się tylko tempo i trafianie w wokal (anime 0,39 wobec electronic 0,20). Udział holdów i stosunek gęstości kiai do reszty algorytm ma już zbliżone do ludzi. Zgodność statystyk nie dowodzi dobrej gry; to trzeba sprawdzić, grając (część 7).

### 1.1 Zmiany po metrykach v2

| wniosek | przed v2 | po v2 | co z wnioskiem |
|---|---|---|---|
| nuta algorytmu na downbeacie granicy sekcji (`sections.boundary_note_share`, tolerancja 3 ms → ±25 ms) | 0,23 (≥ 80% granic: 0/20) | **0,78** (9/20) | „brak nuty na granicy” **wycofany**; algorytm jest tu tylko nieco gorszy od ludzi (1,00, 19/20) |
| akord algorytmu na granicy sekcji | 0,00 | 0,13 (≥ 50% granic: 0/20) | bez zmian (P4) |
| rytm w powtórzeniu muzyki / linia bazowa (`repetition.*`, skwantowane) | 0,33 / 0,22 | **0,41 / 0,29** | różnica zmalała, ale zostaje (ludzie 0,91 / 0,63); P7 dalej średni |
| odstępy algorytmu (`gap_share`) | 1/2 0,29; 1/1 0,46; inne 0,06 | 1/2 **0,25**; 1/1 0,42; inne **0,12** | wniosek bez zmian; drgania czasu kwantują się teraz do 1/12–1/16, stąd więcej „innych” (część 8) |
| najdłuższa seria 1/2 algorytmu | 4 | 4 (seria ≥ 9 nut: 6/20 → 5/20) | bez zmian (P1, P2) |
| hold ≥ 1/2 beatu (RC) u ludzi (`hold_short_share.lt_1_2`) | 29/78 map bez krótszych | **77/78** | potwierdzone oficjalnie: twarda zasada |
| holdy: nuty w środku | „u ludzi hold jest pusty” | holdy < ¾ beatu puste (56/57 map), ¾–1½: 0,06, ≥ 1½: **0,42** | P3 **doprecyzowany**: chodzi o długie holdy algorytmu i wypełnione holdy 1-beatowe (0,78 wobec 0,06) |
| sloty (`mapped` → `chosen`): algorytm na 1/8 / 1/6 | 0,038 / 0,020 | 0,011 / 0,003 | wcześniej zawyżone podwójnym liczeniem |
| AUC modelu ludzkiego na slotach algorytmu | 0,897 (sama pozycja 0,849) | **0,945** (0,935) | różnica wobec ludzi (0,989) mniejsza; P9 słabszy |
| AUC modelu ludzkiego na ludziach z testu | 0,985 (sama pozycja 0,970) | 0,989 (0,977) | bez zmian |

**Nowe wnioski z metryk v2:**
- Na starcie kiai ludzie stawiają nutę w 70/70 map i akord w 68/70 (twarda zasada). Algorytm: nuta p50 0,55, akord 0,00; akord na ≥ 50% startów kiai ma w 4/20 utworów.
- U ludzi liczba akordów w takcie rośnie z głośnością (ρ = 0,33); u algorytmu nie (ρ = −0,01).
- Ręce w oknach 4-taktowych: p90 ≤ 0,10 ma 77/78 map ludzi i tylko 5/20 chartów algorytmu.
- Względem mapy człowieka (`versus_human`): precyzja 0,85, recall 0,58.
- W 5 utworach nuty algorytmu są systematycznie przesunięte o −8…−10 ms.
- Shieldy i anchory wg RC dało się teraz sprawdzić: dane są zgodne z RC.

---

## 2. Profil mapowania ludzi na Normal

**Odporność wyniku.**
- Zakres SR Normal obejmuje też dyfficulty nazwane „Hard” (10/78 w treningu, mediana 7,1 nut/s).
- Ograniczenie do 65 map o nazwach Normal/Novice (52 mapperów) prawie nic nie zmienia: nps p50 5,93 (4,97–6,83), odstępy 1/2 0,63, akordy 0,33, holdy 0,10.
- 5 utworów oznaczonych w `alignment.md` jest w treningu. Ich wyłączenie zmienia mediany metryk dopasowania o ≤ 0,01 (`results/numbers.md`).

### 2.1 Co ludzie mapują, a co pomijają (tabele slotów, cel `chosen`, `results/slots.md`)

**Pokrycie siatki** (oficjalne `coverage.*`, na mapę, p10 / p50 / p90):

| | ludzie trening | ludzie test | algorytm test |
|---|---|---|---|
| beaty | 0,74 / **0,89** / 0,97 | 0,77 / 0,92 / 0,96 | 0,32 / **0,63** / 0,73 |
| półbeaty | 0,37 / **0,61** / 0,86 | 0,34 / 0,58 / 0,84 | 0,06 / **0,23** / 0,43 |
| 1/4 | 0,00 / 0,03 / 0,13 | 0,00 / 0,03 / 0,05 | 0,00 / 0,02 / 0,05 |
| beaty w kiai | 0,82 / 0,98 / 1,00 | 0,89 / 0,99 / 1,00 | 0,37 / 0,67 / 0,93 |
| beaty poza kiai | 0,71 / 0,86 / 0,97 | 0,68 / 0,88 / 0,95 | 0,30 / 0,58 / 0,72 |

W slotach `chosen` (pula): na 1/8 stoi 0,001 chwil ludzi wobec 0,011 algorytmu, na 1/3 po 0,005, na 1/6 0,000 wobec 0,003.

**Co decyduje o nucie.** P(slot `chosen`) wg pozycji, dźwięku i tercyla RMS w utworze (cichy / średni / głośny), ludzie trening:

| pozycja | onset perkusyjny w slocie | tylko inne onsety lub zdarzenia | bez dźwięku |
|---|---|---|---|
| 1/1 | 0,83 / 0,94 / 0,97 | 0,37 / 0,61 / 0,78 | 0,07 / 0,17 / 0,24 |
| 1/2 | 0,58 / 0,71 / 0,81 | 0,21 / 0,36 / 0,54 | 0,03 / 0,08 / 0,14 |
| 1/4 | 0,21 / 0,27 / 0,28 | 0,02 / 0,04 / 0,04 | 0,00 |

Test daje to samo: 1/1 z onsetem perkusyjnym 0,86 / 0,96 / 0,99, 1/2 z onsetem 0,60 / 0,71 / 0,77.

**Regresja logistyczna `chosen`** (L2, cechy standaryzowane, uczona na 78 utworach).
- Sama pozycja (podział, downbeat, kiai, takt w bloku 4): AUC 0,972 na treningu, **0,977 na teście**.
- Pełny model: 0,986 / **0,989**; mediana AUC w utworze 0,992.
- Najsilniejsze cechy poza pozycją: RMS (+0,31), zdarzenia pasm `highmid`/`high` (+0,31, +0,28), obwiednia stemu perkusji (+0,24).
- Obwiednia części harmonicznej ma wagę ujemną (−0,50).
- **Klasy perkusji pluginu (`kick`, `snare`, `perc`) mają u ludzi wagę ≈ 0** (−0,03…+0,11). W modelu dopasowanym do algorytmu mają +0,48…+0,52.

**Recall zdarzeń pluginu** na 1/1 i 1/2: kick 0,71, snare 0,80, hat 0,76, perc 0,72, bass 0,70, lead 0,78; na samych półbeatach 0,59–0,73. Recall stemów na 1/1 i 1/2 (p50) wynosi 0,81–0,88.

**Nuty bez dźwięku.** U ludzi 0,2% slotów `chosen`, u algorytmu 0,5%. `alignment.no_sound_share`: ludzie 0,04, algorytm 0,06.

**Kiai.** W kiai zmapowane są 94% beatów (poza kiai 82%) i 66% półbeatów (poza kiai 53%).

**Klasyfikacja.**
- Pokrycie beatów ≥ 0,75: 69/78 map, test 18/20, algorytm 2/20. To **silna tendencja**; w głośnych częściach z onsetem pokrycie wynosi 0,97, czyli praktycznie twarda zasada.
- Pokrycie półbeatów ≥ 0,35: 71/78, test 17/20, algorytm 4/20 (**silna tendencja**).
- Pokrycie 1/4 ≤ 0,10: 64/78, test 19/20 (**silna tendencja**).
- Wybór instrumentu nie jest regułą ludzi.

### 2.2 Gęstość, podziały, limity (`results/profile_metrics.md`, `results/bpm.md`)

| metryka | trening p10 / p50 / p90 | test p10 / p50 / p90 |
|---|---|---|
| nuty/s (`nps`) | 5,03 / **6,08** / 7,30 | 5,12 / 6,00 / 6,93 |
| chwile/s | 3,70 / 4,49 / 5,36 | 4,02 / 4,46 / 5,27 |
| nuty/beat | 1,55 / 2,03 / 2,94 | 1,66 / 2,02 / 2,45 |
| okno 2 s p50 / p90 / max (mediany) | 6,0 / 8,0 / 9,0 | 6,5 / 7,5 / 9,25 |
| odstępy 1/2 | 0,44 / **0,63** / 0,80 | 0,46 / 0,64 / 0,81 |
| odstępy 1/1 | 0,05 / 0,19 / 0,41 | 0,06 / 0,23 / 0,47 |
| odstępy 1/4 | 0,00 / 0,05 / 0,22 | 0,00 / 0,03 / 0,10 |
| triole | 0,00 / 0,00 / 0,01 | 0,00 / 0,00 / 0,01 |
| najdłuższa seria 1/2 [nuty] | 11,7 / **25** / 63,9 | 12,7 / 31 / 67,5 |
| najdłuższa seria 1/4 [nuty] | 0 / 3 / 7 | 0 / 3,5 / 6,1 |
| min. odstęp [ms] | 71 / 88 / 156 | 65 / 82 / 162 |
| p5 odstępu [ms] | 83 / 137 / 173 | 85 / 157 / 196 |
| downbeaty z nutą | 0,81 / 0,94 / 1,00 | 0,80 / 0,96 / 1,00 |

**BPM** (trening, `song.main_bpm`).
- **Nuty/s nie zależą od tempa:** ρ = −0,17, p = 0,13. OLS przewiduje 6,4 / 6,1 / 5,7 nut/s przy 120 / 180 / 240 BPM.
- Nuty na beat zależą silnie: ρ = −0,74, R² = 0,61.

| BPM | n | nuty/s | 1/2 | 1/1 | 1/4 | seria 1/4 maks. | odstęp p50 [ms] |
|---|---|---|---|---|---|---|---|
| < 150 | 12 | 6,15 | 0,68 | 0,05 | 0,18 | 9 | 226 |
| 150–180 | 30 | 6,17 | 0,69 | 0,18 | 0,06 | 3 | 179 |
| 180–210 | 28 | 5,85 | 0,59 | 0,27 | 0,01 | 3 | 160 |
| ≥ 210 | 8 | 6,47 | 0,56 | 0,33 | 0,04 | 3 | 143 |

- Mapy przy 100 BPM (zapisane w połowie tempa) mają 1/4 jako główny podział, czyli 150 ms.
- Przy 210–230 BPM nadal dominuje 1/2. 1/1 przeważa dopiero przy 240 i 284 BPM (po 1 mapie).
- Test: te same kierunki (nuty/beat ρ = −0,65; nps bez związku z tempem).

**Serie.**
- „≤ 5 kolejnych 1/4” przy ≥ 150 BPM: 62/66 map (test 16/18), **silna tendencja**. Poniżej 150 BPM tylko 3/12, zgodnie ze skalą RC.
- Seria 1/2 ≥ 9 nut: 74/78, **twarda zasada** (test 19/20).
- Seria 1/2 > 33 nut: 25/78, styl.
- Brak serii 1/6: 75/78, twarda zasada.
- Odstępy ≥ 3/2 beatu ≤ 5%: 65/78 (test 19/20).
- 1/2 najczęstszym odstępem: 70/78 (test 18/20).

**Akordy.**
- Udział: 0,34 (0,19–0,49); ≥ 15% w 73/78 map (test 19/20).
- Akordy 3+ nut: zero w 71/78 map, ≤ 1% chwil w 73/78.
- Położenie: downbeat 0,26, inny beat 0,58, poza beatem 0,09. Akordy w obu rękach: 0,54.
- Akord stoi na **51% zmapowanych beatów** (`chord_rate_on_mapped_beats`, 0,29–0,73); ≥ 0,25 w 72/78 map (test 18/20).
- **Akordy wewnątrz strumienia 1/2** (`chords_in_half_runs_per_min`): 25,3/min (3,8–69,7); ≥ 3/min w 71/78 (test 18/20).
- Akordy w strumieniu 1/4: zero w 67/78; par akordów w strumieniu 1/4 brak.

**Jacki.**
- Minijacki 1/4: 0 w 78/78 i 20/20 (**twarda zasada**).
- Wolniejsze minijacki są zwykłe: 0,09, odstęp p50 1 beat. Jack z 3 nut przy ≥ 1/2 beatu ma 58/78 map (styl).
- Anchor RC (`anchor_rc_max_notes`): p50 0, p90 3; ≤ 2 nuty w 69/78 (test 18/20), **silna tendencja**.

**Ręce.**
- Lewa ręka: 0,50 w 78/78 map.
- W oknach 4-taktowych |lewa − 0,5| ma p50 0,02 i p90 0,05 (`hand_balance_4bar`). p90 ≤ 0,10 ma 77/78 map (test 19/20): **twarda zasada**.
- Kroki pojedynczych nut: 0 torów 0,03, 1 tor 0,50, 2 tory 0,31, 3 tory 0,13. Zmiana ręki: 0,67.

### 2.3 Holdy (oficjalne `hold_*`, `holds_context.*`; pomocniczo `04_holds.py`)

| cecha (p10 / p50 / p90 na mapę) | ludzie trening (70 map z holdami) | ludzie test (18) | algorytm test (20) |
|---|---|---|---|
| udział holdów (wszystkie mapy) | 0,00 / 0,10 / 0,26 | 0,01 / 0,08 / 0,23 | 0,05 / 0,12 / 0,19 |
| hold < 0,45 beatu (`hold_short_share.lt_1_2`) | 0 / 0 / 0 (77/78 map bez) | 0 / 0 / 0 | 0 / 0 / 0 |
| hold < 0,95 beatu (`lt_1`) | 0,00 / 0,29 / 0,78 | 0,00 / 0,30 / 0,68 | 0 / 0 / 0 |
| liczba holdów < ¾ / ¾–1½ / ≥ 1½ beatu na mapę (p50) | 12,5 / 27 / 7 | 16 / 22 / 6 | **0 / 18,5 / 34,5** |
| z nutą w trakcie (wszystkie) | 0,00 / 0,10 / 0,39 | 0,00 / 0,13 / 0,36 | 0,71 / **0,90** / 0,96 |
| … holdy < ¾ beatu | 0 / 0 / 0 (57 map) | 0 / 0 / 0 (14) | 1,00 (1 mapa) |
| … holdy ¾–1½ beatu | 0,00 / **0,06** / 0,53 | 0,00 / 0,04 / 0,42 | 0,50 / **0,78** / 0,99 |
| … holdy ≥ 1½ beatu | 0,00 / 0,42 / 1,00 | 0,00 / 0,67 / 1,00 | 0,76 / 0,90 / 0,97 |
| głowa holda w akordzie | 0,16 / 0,42 / 0,66 | 0,07 / 0,30 / 0,83 | 0 / 0 / 0 |
| start na beacie | 0,50 / 0,74 / 0,96 | 0,46 / 0,89 / 1,00 | 0,22 / 0,45 / 0,68 |
| puszczenie na następnej chwili (±1/16 beatu) | 0,80 / **0,96** / 1,00 | 0,84 / 0,97 / 1,00 | 0,02 / **0,10** / 0,20 |
| puszczenie na 1/1 / na 1/2 (p50) | 0,74 / 0,24 | 0,69 / 0,28 | 0,08 / 0,04 |
| shield 1/4 na minutę | 0 | 0 | 0 |
| *pomocniczo:* przy puszczeniu gra druga ręka / ta sama ręka | 0,85 / 0,32 (p50) | 0,89 / 0,30 | — |

**Jak ludzie używają holdów.**
- Większość holdów jest krótka (< ¾ beatu albo ok. 1 beatu).
- Taki hold jest **łącznikiem**: trwa do następnej chwili i nic się w nim nie dzieje.
- W długich holdach (≥ 1½ beatu, ok. 7 na mapę) druga ręka gra mniej więcej w połowie przypadków.
- Przy puszczeniu następną nutę gra druga ręka (85%) albo ta sama ręka na innym torze (32%), nigdy ten sam tor.

**Pozostałe liczby.**
- 8/78 map nie ma holdów. Dwa holdy naraz występują w 42/78 map, więcej niż dwa w 3/78.
- Odstęp puszczeń ≥ 1/2 beatu: 77/78.
- W regresji `chosen_hold_start` start holda wiąże się z beatem (+1,04) i z wokalem (+0,13); kierunek ten sam na teście.

**Klasyfikacja.**

| reguła | trening | test | klasa |
|---|---|---|---|
| hold ≥ 0,45 beatu | 77/78 | 19/20 | twarda |
| brak shieldów 1/4 | 78/78 | 20/20 | twarda |
| krótkie holdy puste | 56/57 | 14/14 | twarda |
| puszczenie na następnej chwili ≥ 0,75 | 65/70 | 17/18 | silna |
| start na beacie ≥ 0,5 | 63/70 | 15/18 | silna |
| głowa w akordzie ≥ 0,2 | 59/70 | 13/18 | silna |
| holdy 1-beatowe z nutą ≤ 0,2 | 47/69 | 11/16 | styl |
| długie holdy z nutą ≤ 0,5 | 39/66 | 6/16 | styl |

### 2.4 Wzorce i powtarzalność

**Tryle.**
- Trójki x-y-x: 0,05 (0,02–0,12); ≤ 0,10 w 67/78 map (test 17/20), **silna tendencja**.
- Najdłuższy tryl ma 4 nuty (3–5,3); tryli ≥ 10 nut nie ma.
- Tryle na minutę: 7,3.
- Tryle w jednej ręce: 0,15 (test 0,09); ≤ 0,3 w 57/76 map, **silna tendencja**.

**Inne wzorce.** Schody 0,05; entropia 4-chwil 7,94 bitu; 56 różnych układów na 100.

**Ręka nie zależy od dźwięku** (`hand_by_class`). Udział lewej ręki: kick 0,50 (0,45–0,55), snare 0,50, bass 0,50, lead 0,50, hat 0,50 (z dużym rozrzutem). Pomocniczo: kick trafia na tory zewnętrzne w 0,41 przypadków, snare w 0,43. Pitch relevancy nie występuje.

**Powtórzenia** (pary okien o podobieństwie audio ≥ 0,75 ma 62/78 map; pozycje skwantowane):

| | rytm | tory | tory lub lustro |
|---|---|---|---|
| powtórzenie muzyki | 0,92 (0,82–0,98) | 0,24 (0,14–0,47) | 0,46 (0,28–0,89) |
| linia bazowa | 0,60 (0,41–0,74) | 0,16 | 0,22 |

- Rytm ≥ 0,8 w powtórzeniu: 57/62 map (50 mapperów), **silna tendencja**; test 17/19.
- Tory w powtórzeniu powyżej bazy: 52/62.
- Pełne kopiowanie torów: 9/62, test 0/19 (**styl**; na teście lustro rzadsze: 0,39 wobec 0,46, MW p = 0,035).

### 2.5 Intro, sekcje, przejścia, kiai (`results/sections.md`, `sections.*`, `kiai_start.*`)

Gęstość taktów wokół granic (nuty w takcie / mediana taktu chartu; mediana median utworów; takt 0 = pierwszy takt nowej sekcji):

| grupa | RMS | granic / utworów | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|---|---|---|---|
| ludzie trening | w górę | 136 / 65 | 0,67 | 0,67 | 0,67 | 0,76 | **1,00** | 1,00 | 1,00 | 1,09 |
| ludzie trening | w dół | 127 / 55 | 1,00 | 1,08 | 1,00 | 1,00 | **0,69** | 0,67 | 0,62 | 0,64 |
| ludzie test | w górę | 36 / 17 | 0,83 | 0,83 | 0,75 | 0,70 | 1,00 | 1,11 | 1,00 | 1,06 |
| ludzie test | w dół | 29 / 15 | 1,17 | 1,19 | 1,08 | 1,12 | 0,78 | 0,81 | 0,80 | 0,86 |
| algorytm test | w górę | 35 / 16 | 0,85 | 0,87 | 0,75 | **1,00** | 0,90 | 1,00 | 1,05 | 1,00 |
| algorytm test | w dół | 29 / 15 | 1,00 | 1,10 | 1,00 | 1,00 | 0,80 | 0,80 | 0,90 | 0,80 |

Oficjalne `sections.boundary_profile_rising` (mediana na mapę) daje ten sam obraz. U ludzi takty −4…−1 mają 0,67–0,78, a takt 0 1,00. U algorytmu takt −1 ma 1,00, a takt 0 0,90.

**Granice sekcji.**
- Ludzie zmieniają gęstość **skokiem na granicy**. Stosunek 4 taktów po do 4 przed wynosi 1,38 przy wzroście RMS (0,94–3,73) i 0,63 przy spadku (0,42–1,00).
- Buildupu nie ma: ostatni takt / 3 wcześniejsze = 1,04.
- Pusty ostatni beat przed granicą: 0,04 (p90 0,22).
- Nuta na downbeacie granicy (±25 ms) w ≥ 80% granic: 71/78 map (test 19/20), **silna tendencja**.
- Akord na granicy w ≥ 50% granic: 64/78 (test 17/20); mediana 0,75.

**Kiai.**
- **Na starcie kiai zawsze stoi nuta** (70/70, test 20/20) **i prawie zawsze akord** (≥ 50% startów: 68/70, test 19/20). To **twarda zasada**.
- Gęstość kiai / reszta: 1,22; ≥ 1 w 64/70 map.
- Liczba akordów w takcie rośnie z RMS (ρ 0,33; > 0 w 69/77 map), liczba nut też (ρ 0,40; > 0 w 73/78).

**Intro i outro.** Intro ma 0,75 mediany taktu, outro 0,86. Pierwsza nuta pada w 0,89 s (0,19–4,17).

### 2.6 Pauzy i kontrast

- Przerwy ≥ 2 beaty: 0,64/min. 29/78 map nie ma żadnej. Najdłuższa przerwa p50 to 2 beaty.
- Puste takty: 0,01; ≤ 5% w 67/78 map.
- Przerwy ≥ 4 beaty (`rest_context`) to styl: 66 przerw w 18/78 map.
- Leżą w **cichych miejscach**: RMS 0,29 p95 (0,09–0,50); w 16/18 map większość jest cicha.
- Często przy granicy sekcji: mediana udziału 0,50, na teście 0,75 (13 przerw w 6 mapach).
- CV nut na takt: 0,32. Kontrast bloków 4-taktowych p90/p10: 1,87.
- Normal ludzi jest **prawie ciągły**. Kontrast budują skoki gęstości na granicach i akordy w głośnych taktach, nie przerwy.

### 2.7 Zestawienie reguł (pełne: `results/rules.md`, `results/numbers.md`)

| reguła ludzi | trening | test | algorytm | klasa |
|---|---|---|---|---|
| brak minijacków 1/4 | 78/78 | 20/20 | 20/20 | twarda |
| brak shieldów 1/4 | 78/78 | 20/20 | 20/20 | twarda |
| ręce 0,4–0,6 (cały chart) | 78/78 | 20/20 | 20/20 | twarda |
| ręce w 4 taktach, p90 ≤ 0,10 | 77/78 | 19/20 | **5/20** | twarda |
| hold ≥ 0,45 beatu | 77/78 | 19/20 | 20/20 | twarda |
| krótkie holdy puste | 56/57 | 14/14 | — | twarda |
| nuta na starcie kiai | 70/70 | 20/20 | **6/20** | twarda |
| akord na ≥ 50% startów kiai | 68/70 | 19/20 | **4/20** | twarda |
| brak serii 1/6 | 75/78 | 19/20 | 20/20 | twarda |
| puszczenia ≥ 1/2 beatu od siebie | 77/78 | 19/20 | 19/20 | twarda |
| ≤ 2 holdy naraz | 75/78 | 20/20 | 20/20 | twarda |
| seria 1/2 ≥ 9 nut | 74/78 | 19/20 | **5/20** | twarda / silna |
| akordy ≤ 2 nuty | 73/78 | 20/20 | 20/20 | silna |
| nps 4,5–8 | 72/78 | 20/20 | **3/20** | silna |
| akordy ≥ 15% chwil | 73/78 | 19/20 | **8/20** | silna |
| akord na ≥ 25% zmapowanych beatów | 72/78 | 18/20 | **4/20** | silna |
| akordy w strumieniu 1/2 ≥ 3/min | 71/78 | 18/20 | **3/20** | silna |
| pokrycie półbeatów ≥ 0,35 | 71/78 | 17/20 | **4/20** | silna |
| pokrycie beatów ≥ 0,75 | 69/78 | 18/20 | **2/20** | silna |
| 1/2 najczęstszym odstępem | 70/78 | 18/20 | **6/20** | silna |
| downbeaty z nutą ≥ 0,8 | 70/78 | 18/20 | **2/20** | silna |
| odstępy ≥ 3/2 beatu ≤ 5% | 65/78 | 19/20 | **5/20** | silna |
| nuta na ≥ 80% granic (±25 ms) | 71/78 | 19/20 | 9/20 | silna |
| akord na ≥ 50% granic | 64/78 | 17/20 | **0/20** | silna |
| akordy w takcie rosną z RMS | 69/77 | 16/20 | 9/19 | silna |
| rytm powtórzenia ≥ 0,8 | 57/62 | 17/19 | **1/16** | silna |
| tryle x-y-x ≤ 0,10 | 67/78 | 17/20 | **2/20** | silna |
| tryle w jednej ręce ≤ 0,3 | 57/76 | 14/20 | 9/20 | silna |
| anchor RC ≤ 2 | 69/78 | 18/20 | 20/20 | silna |
| puszczenie na następnej chwili ≥ 0,75 | 65/70 | 17/18 | **0/20** | silna |
| hold startuje na beacie ≥ 0,5 | 63/70 | 15/18 | 9/20 | silna |
| głowa holda w akordzie ≥ 0,2 | 59/70 | 13/18 | **0/20** | silna |
| ≤ 5 kolejnych 1/4 (≥ 150 BPM) | 62/66 | 16/18 | 20/20 | silna |
| kiai gęstsze | 64/70 | 18/20 | 17/20 | silna |
| przerwy ≥ 4 beaty | 18/78 | 6/20 | 3/20 | styl |
| kopiowanie torów | 9/62 | 0/19 | 1/16 | styl |
| jack z 3 nut przy ≥ 1/2 beatu | 58/78 | 15/20 | 4/20 | styl |

---

## 3. Gatunki (`results/genres.md`)

**Grupy (trening).** anime 19 map (17 mapperów), electronic 19 (18), video game 17 (14), pop 13 (13). **Za małe do uogólnień:** rock 3, novelty 2, classical, folk, hip hop, jazz, metal i other po 1. Test ma 4–6 map na gatunek, więc to sprawdzenie tylko orientacyjne.

**Wspólne dla gatunków** (q BH > 0,1):
- nps 5,8–6,2; odstępy 1/2 0,57–0,72; akordy 0,26–0,37; holdy 0,08–0,13;
- pokrycie beatów 0,87–0,92;
- puszczenie holda na następnej chwili 0,93–0,97; akord na starcie kiai 1,00;
- ręce w 4 taktach (p90) 0,05–0,06;
- rytm w powtórzeniach 0,87–0,94; akord na granicy 0,71–0,78.

Reguły z części 2 nie zależą od gatunku.

**Zależne od gatunku.**
- **Tempo:** electronic p50 200 BPM, pop 164 (q = 0,003). Nuty na beat różnią się nominalnie (KW p = 0,007), ale po uwzględnieniu BPM różnica znika (q = 0,30).
- **Wokal:** udział chwil na onsecie wokalu w anime 0,39, w pop 0,34, w video game 0,30, w electronic 0,20. Różnica jest istotna także po BPM (q = 0,002); kierunek zgodny z testem (ρ +0,4).
- **Różnice nominalne** (p < 0,05, q ≈ 0,15), traktowane jako możliwy, **niepotwierdzony styl**:
- anime: więcej półbeatów (0,64 wobec 0,47 w electronic), więcej akordów w strumieniu 1/2 (35,9 wobec 14,1/min w video game), dłuższe serie 1/4;
- electronic: więcej przerw i większy kontrast;
- video game: więcej schodów.

Na teście kolejność gatunków zgadza się dla nut/beat, pokrycia półbeatów i akordów w strumieniu 1/2 (ρ = +0,8). Po uwzględnieniu BPM żadna z tych różnic nie jest istotna.

**Algorytm wg gatunku.** Niedobory występują w każdym gatunku (część 5.3).

---

## 4. Ranking Criteria i poradnik a dane

| zapis | dane ludzi (trening; test) | ocena |
|---|---|---|
| HP, OD ≤ 7,5 | 75/78; 20/20 | zgodne; nie przenosi się (gra ma stałe okna, PERFECT 40 ms ≈ OD 8) |
| brak serii 1/6 i drobniejszych | 75/78; 19/20 | zgodne |
| LN ≥ 1/2 beatu | 77/78; 19/20 | zgodne (twarda) |
| puszczenia ≥ 1/2 beatu od siebie | 77/78; 19/20 | zgodne |
| nic w trakcie LN 1/2; nic szybszego niż 1/2 w LN 1/1 | holdy < ¾ puste w 56/57; holdy ¾–1½ z nutą 0,06 | zgodne; w długich holdach (≥ 1½) druga ręka gra w ok. połowie |
| bez shieldów 1/4 | 0 w 78/78; 20/20 | zgodne (twarda) |
| głównie 1/1 i 1/2, okazjonalnie 1/4 | odstępy ≥ 1/2 ≥ 75% w 69/78; pokrycie 1/4 ≤ 0,10 w 64/78 | zgodne; w praktyce „głównie 1/2” |
| ≤ 5 kolejnych 1/4 | 62/66 przy ≥ 150 BPM; 3/12 poniżej 150 | zgodne ze skalą BPM |
| pauza 1/1 po każdej frazie 1/2 | seria 1/2 ≤ 33 nut w 53/78 | **dane przeczą** (RC: „where natural”) |
| bez akordów w serii 1/4 | 0 w 67/78; 19/20 | zgodne |
| bez anchorów ≥ 3 nut | `anchor_rc_max_notes` ≤ 2 w 69/78; 18/20 | zgodne (silna) |
| bez minijacków 1/4 i „innych jacków” | 1/4: brak w 78/78; jacki 3+ przy ≥ 1/2 beatu w 58/78 | pierwsza część zgodna; „inne jacki”: **dane przeczą** |
| 4K: akordy ≤ 2 nuty | 71/78 bez 3+, 73/78 ≤ 1% | zgodne |
| skala BPM: 120 BPM → prawie ciągłe 1/2 | < 150 BPM: 1/2 0,68 + 1/4 0,18 | **ludzie dają więcej 1/4** |
| skala BPM: ok. 240 BPM → minimalne 1/2 | 210–230 BPM: 1/2 0,56; 1/1 przeważa od 240 | próg przesunięty do ok. 230 BPM |
| poradnik: więcej 1/2, unikaj 1/4 | zgodne przy ≥ 150 BPM | zgodne |
| poradnik: więcej akordów, kiai z akordami | akordy na 51% zmapowanych beatów; akord na starcie kiai 68/70 | zgodne |
| poradnik: nuty w trakcie LN drugą ręką | krótkie holdy puste; w długich druga ręka w ok. połowie | ludzie ostrożniejsi |
| poradnik: pitch relevancy | lewa ręka 0,50 dla każdej klasy dźwięku | **dane przeczą** |
| poradnik: „Be consistent!” | rytm w powtórzeniach 0,92 | zgodne dla rytmu |
| RC ogólne: nuta = dźwięk | chwile bez dźwięku 0,04 | zgodne |
| RC ogólne: przerwy tylko w bardzo cichej muzyce | przerwy ≥ 4 beaty w 18/78 map, RMS 0,29 p95 | zgodne |

Nie przenosi się: SV, hitsoundy i keysoundy (audio gra bot), HP/OD. Skala BPM przenosi się jako **stała gęstość w czasie (ok. 6 nut/s) przy podziale dobranym do tempa**.

---

## 5. Algorytm a ludzie na zbiorze testowym (`results/algo_vs_human.md`)

### 5.1 Kluczowe metryki

Dane: 20 utworów. Kolumna „algo < / >” podaje, w ilu utworach algorytm ma wartość niższą / wyższą niż człowiek na tym samym utworze.

| metryka | ludzie test p10 / p50 / p90 | algorytm p10 / p50 / p90 | algo < / > | Wilcoxon p |
|---|---|---|---|---|
| nuty/s | 5,12 / 6,00 / 6,93 | 2,92 / **3,70** / 4,73 | 20/0 | < 0,001 |
| nuty/beat | 1,66 / 2,02 / 2,45 | 0,98 / 1,19 / 1,62 | 20/0 | < 0,001 |
| okno 2 s p90 / max (p50) | 7,5 / 9,25 | 4,5 / 5,5 | 20/0 | < 0,001 |
| pokrycie beatów | 0,77 / 0,92 / 0,96 | 0,32 / **0,63** / 0,73 | 20/0 | < 0,001 |
| pokrycie półbeatów | 0,34 / 0,58 / 0,84 | 0,06 / **0,23** / 0,43 | 19/1 | < 0,001 |
| pokrycie beatów w kiai | 0,89 / 0,99 / 1,00 | 0,37 / 0,67 / 0,93 | 19/0 | < 0,001 |
| odstępy 1/2 | 0,46 / 0,64 / 0,81 | 0,08 / **0,25** / 0,48 | 19/1 | < 0,001 |
| odstępy 1/1 | 0,06 / 0,23 / 0,47 | 0,16 / 0,42 / 0,66 | 3/17 | 0,005 |
| odstępy 3/2 i 2 (p50) | 0,01 / 0,00 | 0,03 / 0,04 | 2/18 | ≤ 0,001 |
| odstępy poza klasami | 0,00 / 0,01 / 0,01 | 0,09 / 0,12 / 0,24 | 0/13 | < 0,001 |
| najdłuższa seria 1/2 | 12,7 / 31 / 67,5 | 3 / **4** / 10,1 | 19/1 | < 0,001 |
| chwile na 1/2 | 0,25 / 0,40 / 0,46 | 0,06 / 0,21 / 0,32 | 18/2 | < 0,001 |
| chwile poza 1/1–1/4 ludzkiej siatki | 0,00 / 0,00 / 0,01 | 0,07 / 0,20 / 0,44 | 0/20 | < 0,001 |
| downbeaty z nutą | 0,80 / 0,96 / 1,00 | 0,29 / **0,67** / 0,78 | 20/0 | < 0,001 |
| min. odstęp [ms] | 65 / 82 / 162 | 106 / 136 / 154 | 5/15 | 0,008 |
| udział akordów | 0,20 / 0,32 / 0,46 | 0,04 / **0,14** / 0,19 | 19/1 | < 0,001 |
| akordy na zmapowanych beatach | 0,30 / 0,48 / 0,65 | 0,05 / 0,16 / 0,30 | 19/1 | < 0,001 |
| akordy w strumieniu 1/2 [/min] | 5,2 / 24,5 / 54,8 | 0 / **0** / 3,5 | 19/0 | < 0,001 |
| akordy poza beatem | 0,01 / 0,09 / 0,28 | 0,10 / 0,28 / 0,69 | 3/16 | < 0,001 |
| minijacki / ich odstęp [beat] (p50) | 0,09 / 1,00 | 0,04 / **2,00** | 16/4; 0/15 | 0,015; 0,001 |
| ręce w 4 taktach, p90 | 0,04 / 0,05 / 0,08 | 0,10 / **0,13** / 0,20 | 0/20 | < 0,001 |
| lewa ręka: kick / snare (p50) | 0,51 / 0,50 | 0,61 / 0,44 | 4/16; 16/4 | 0,001; 0,003 |
| udział holdów | 0,01 / 0,08 / 0,23 | 0,05 / 0,12 / 0,19 | 7/13 | 0,37 |
| holdy ≥ 1½ beatu [na mapę] | 0 / 6 / 17 | 15 / **34,5** / 59 | 2/17 | < 0,001 |
| holdy < ¾ beatu [na mapę] | 0 / 16 / 85 | 0 / **0** / 0 | 14/0 | 0,001 |
| holdy ¾–1½ z nutą w środku | 0,00 / 0,04 / 0,42 | 0,50 / **0,78** / 0,99 | 1/9 | 0,014 |
| holdy ≥ 1½ z nutą w środku | 0,00 / 0,67 / 1,00 | 0,76 / 0,90 / 0,97 | 4/10 | 0,019 |
| puszczenie na następnej chwili | 0,84 / 0,97 / 1,00 | 0,02 / **0,10** / 0,20 | 18/0 | < 0,001 |
| głowa holda w akordzie | 0,07 / 0,30 / 0,83 | 0 / **0** / 0 | 16/0 | < 0,001 |
| hold startuje na beacie | 0,46 / 0,89 / 1,00 | 0,22 / 0,45 / 0,68 | 16/2 | < 0,001 |
| tryle x-y-x | 0,03 / 0,07 / 0,11 | 0,10 / **0,14** / 0,18 | 1/19 | < 0,001 |
| najdłuższy tryl / tryle na minutę (p50) | 4 / 10,2 | 4,5 / 13,1 | — | 0,50 / 0,13 |
| tryle w jednej ręce | 0,00 / 0,09 / 0,59 | 0,23 / **0,35** / 0,57 | 3/17 | 0,014 |
| entropia 4 chwil [bit] | 7,52 / 8,07 / 8,48 | 6,72 / 7,53 / 7,94 | 15/5 | 0,001 |
| przerwy ≥ 2 beaty [/min] | 0,00 / 0,57 / 5,78 | 0,63 / 2,49 / 7,05 | 4/16 | 0,021 |
| najdłuższa przerwa [beat] | 1,00 / 2,06 / 8,30 | 1,99 / 2,55 / 4,02 | 8/11 | 0,97 |
| CV nut na takt / kontrast 4 taktów (p50) | 0,30 / 1,68 | 0,30 / 1,64 | — | 0,50 / 0,73 |
| gęstość kiai / reszta | 1,03 / 1,22 / 1,45 | 0,98 / 1,16 / 1,58 | 10/10 | 0,65 |
| nuta na starcie kiai | 1,00 / 1,00 / 1,00 | 0,00 / **0,55** / 1,00 | 14/0 | 0,001 |
| akord na starcie kiai | 0,90 / 1,00 / 1,00 | 0,00 / **0,00** / 0,50 | 18/0 | < 0,001 |
| ρ(akordy w takcie, RMS) | −0,15 / 0,38 / 0,65 | −0,12 / **−0,01** / 0,38 | 14/5 | 0,016 |
| nuta na granicy (±25 ms) | 0,85 / 1,00 / 1,00 | 0,42 / 0,78 / 1,00 | 15/1 | 0,001 |
| akord na granicy | 0,39 / 0,71 / 1,00 | 0,00 / **0,13** / 0,34 | 19/1 | < 0,001 |
| pusty ostatni beat przed granicą | 0,00 / 0,00 / 0,23 | 0,00 / 0,13 / 0,25 | 4/11 | 0,13 |
| po/przed przy granicach w górę (`sections.md`) | 0,97 / 1,33 / 2,65 | 0,90 / 1,19 / 1,55 | — | — |
| chwile bez dźwięku | 0,01 / 0,04 / 0,09 | 0,03 / 0,06 / 0,13 | 3/17 | 0,006 |
| recall snare / kick / lead / bass / hat (p50) | 0,49 / 0,30 / 0,44 / 0,37 / 0,25 | 0,34 / 0,24 / 0,33 / 0,27 / 0,00 | 19/0 … 13/0 | ≤ 0,024 |
| powtórzenie: rytm / baza (p50) | 0,91 / 0,63 | **0,41** / 0,29 | 16/0; 20/0 | < 0,001 |
| powtórzenie: tory lub lustro | 0,39 | 0,51 | 8/8 | 0,23 |
| **względem mapy człowieka:** precyzja / recall (±40 ms) | — | 0,66 / **0,85** / 0,91; 0,49 / **0,58** / 0,77 | — | — |
| zgodność torów w trafionych chwilach | — | 0,34 / 0,39 / 0,44 | — | — |
| przesunięcie od siatki: p50 [ms] / udział > 10 ms | — | −2,6 (−7,9…0,5) / 0,13 (0,04–0,34) | — | — |
| model ludzki: AUC na slotach | 0,989 | 0,945 | — | — |

**Zgodne z ludźmi:**
- udział holdów; stosunek gęstości kiai do reszty;
- balans rąk w całym charcie i rozkład kroków;
- brak akordów 3+, minijacków 1/4, shieldów i anchorów;
- odstęp puszczeń, CV taktów, kontrast 4 taktów, długość trylu.

### 5.2 Wg relacji tempa algorytmu do siatki ludzkiej

Relacja w 20 utworach testowych:
- 8 utworów: beat algorytmu w połowie tempa;
- 4 utwory: siatka podwojona przez `foldTempo`, ale `feltBeatMs` liczy beat × 2;
- 7 utworów: 1:1;
- 1 utwór: bez siatki (`NO_TIMING`).

Faza downbeatu zgadza się w 3/19 utworów z siatką.

| ludzie p50 → algorytm p50 | „2 beaty” (n = 12) | 1:1 (n = 7) | bez siatki (n = 1) |
|---|---|---|---|
| nuty/s | 5,82 → 3,63 | 6,19 → 4,01 | 6,64 → 3,77 |
| pokrycie beatów | 0,90 → 0,61 | 0,95 → 0,64 | 0,99 → 0,37 |
| pokrycie półbeatów | 0,60 → **0,16** | 0,58 → 0,40 | 0,35 → 0,16 |
| odstępy 1/2 | 0,67 → **0,12** | 0,64 → 0,46 | 0,48 → 0,14 |
| maks. seria 1/2 | 28 → **4** | 31 → 9 | 17 → 5 |
| odstęp minijacka [beat] | 1,00 → **2,00** | 0,88 → 1,00 | 1,00 → 1,58 |
| akordy w strumieniu 1/2 [/min] | 16,0 → **0** | 45,9 → 2,9 | 15,7 → 0 |
| akordy poza beatem | 0,08 → 0,33 | 0,10 → 0,20 | 0,01 → — |
| długość holda p50 [beat] | 1,00 → 2,43 | 1,00 → 1,42 | — → 2,22 |
| rytm w powtórzeniu / baza | 0,90 / 0,62 → 0,45 / 0,29 | 0,91 / 0,67 → 0,41 / 0,31 | 0,94 / 0,71 → 0,38 / 0,09 |
| recall / precyzja względem człowieka | → 0,55 / 0,85 | → 0,68 / 0,86 | → 0,51 / 0,57 |
| chwile > 10 ms od siatki | → 0,13 | → 0,11 | → 0,23 |

Mann–Whitney dla algorytmu, grupa „2 beaty” wobec 1:1:
- istotne: seria 1/2 p = 0,002; odstępy 1/2 p = 0,002; odstęp minijacka p < 0,001; nuty/beat p < 0,001; pokrycie półbeatów p = 0,007; akordy w strumieniu 1/2 p = 0,001;
- nieistotne: recall p = 0,26.

Gęstość jest za niska w obu grupach (P1). Rytm 1/2, akordy w strumieniu i odstępy torów zależą od relacji tempa (P2).

### 5.3 Wg gatunku (mediany ludzie → algorytm; n bardzo małe)

| metryka | anime (5) | electronic (6) | video game (4) | pop (4) | novelty (1) |
|---|---|---|---|---|---|
| nuty/s | 5,82 → 4,39 | 6,05 → 3,90 | 5,82 → 3,63 | 6,50 → 2,94 | 5,33 → 3,62 |
| pokrycie beatów | 0,88 → 0,63 | 0,89 → 0,47 | 0,88 → 0,64 | 0,95 → 0,60 | 0,95 → 0,71 |
| pokrycie półbeatów | 0,57 → 0,32 | 0,57 → 0,16 | 0,47 → 0,28 | 0,67 → 0,23 | 0,46 → 0,17 |
| maks. seria 1/2 | 31 → 8 | 34 → 4,5 | 23 → 4 | 56 → 4 | 17 → 7 |
| akordy | 0,38 → 0,16 | 0,25 → 0,13 | 0,27 → 0,13 | 0,37 → 0,09 | 0,20 → 0,16 |
| akordy w strumieniu 1/2 [/min] | 45,9 → 0 | 13,6 → 0 | 14,4 → 0 | 45,8 → 0 | 13,2 → 2,4 |
| holdy z nutą w trakcie | 0,12 → 0,90 | 0,16 → 0,89 | 0,17 → 0,90 | 0,10 → 0,83 | 0,00 → 0,94 |
| puszczenie na następnej chwili | 0,94 → 0,09 | 1,00 → 0,13 | 0,96 → 0,08 | 0,94 → 0,13 | 1,00 → 0,00 |
| akord na starcie kiai | 1,00 → 0,00 | 1,00 → 0,00 | 0,96 → 0,19 | 1,00 → 0,00 | 1,00 → 0,00 |
| ręce w 4 taktach (p90) | 0,05 → 0,10 | 0,06 → 0,15 | 0,06 → 0,13 | 0,05 → 0,17 | 0,02 → 0,11 |
| tryle | 0,04 → 0,14 | 0,06 → 0,13 | 0,08 → 0,14 | 0,08 → 0,17 | 0,04 → 0,13 |
| rytm w powtórzeniu | 0,96 → 0,37 | 0,93 → 0,34 | 0,84 → 0,49 | 0,89 → 0,44 | 0,90 → — |
| akord na granicy | 0,86 → 0,11 | 0,69 → 0,13 | 0,56 → 0,15 | 0,86 → 0,07 | 0,80 → 0,20 |
| recall / precyzja algorytmu | 0,73 / 0,80 | 0,56 / 0,78 | 0,58 / 0,80 | 0,49 / 0,89 | 0,64 / 0,89 |
| kiai / reszta | 1,20 → 1,19 | 1,30 → 1,13 | 1,22 → 1,02 | 1,19 → 1,27 | 1,15 → 1,21 |

Problemy występują we wszystkich gatunkach. Pop ma najniższy recall: 2 z 4 utworów pop są prowadzone przez `lead`. W 4 utworach prowadzonych głównie przez `lead` recall wynosi 0,49 wobec 0,60 w pozostałych, a stosunek nps algorytmu do nps człowieka 0,47 wobec 0,65 (n = 4).

---

## 6. Problemy algorytmu na Normal (od największego wpływu)

### P1. Za mało nut i brak strumienia 1/2: limit gęstości Normal leży poniżej ludzkiej mediany

**Co.** Algorytm nie osiąga ludzkiej gęstości w żadnym utworze. Gdy już stawia nutę, zwykle trafia tam, gdzie stoi też nuta człowieka. Pomija za to ludzkie chwile, głównie półbeaty.

**Dowód.**
- nuty/s 3,70 wobec 6,00 (20/20 niżej); okno 2 s p90 4,5 wobec 7,5; nps 4,5–8 tylko w 3/20 chartów (ludzie 72/78 i 20/20);
- względem mapy człowieka: precyzja 0,85, recall 0,58;
- pokrycie beatów 0,63 wobec 0,92; pokrycie półbeatów 0,23 wobec 0,58 (≥ 0,35 w 4/20 wobec 71/78);
- półbeat z onsetem perkusyjnym w głośnej części dostaje nutę w 0,38 przypadków wobec 0,77–0,81;
- najdłuższa seria 1/2 to 4 nuty wobec 31 (w utworach 1:1: 9); seria ≥ 9 nut w 5/20 wobec 74/78;
- wynik nie zależy od kwantyzacji; mapy nazwane „Normal” mają p50 5,93 nut/s.

**Klasa:** silne tendencje i twarda zasada (seria 1/2 ≥ 1 takt). **Test:** tak.

**Kod.**
- `difficulty.js` → `DIFFICULTIES.normal`: `maxNps: 5`, `maxNpsCeiling: 5.5`. Sam strumień 1/2 przy 180 BPM to 6 nut/s.
- `difficultyFilter.js`:
- `densityHolds`: limit `floor(maxNps·2·max(powerFloor, power) + 1)` chwil na 2 s, a `power` < 1 w zwykłych częściach;
- `pulsePowerFloor`: dolny limit tylko 1 nuta na beat;
- `quarterMinEnergy: 0.75` i `capQuarters` (`maxQuarterShare: 0.1`): przy P2 obcinają ludzkie półbeaty;
- `fastRunHolds` (`maxFastRun: 3`, `FAST_GAP_BEATS = 0.3`);
- `selectionOrder`.
- `bandPath.js` → `thin`.

**Wpływ: wysoki.** Ludzki Normal to puls 1/1 z gęstym 1/2. Przy wysokiej precyzji problemem jest ilość nut, nie ich wybór.

**Adaptacja.** Jeśli Normal w grze ma być lżejszy niż osu! Normal, lepiej zmieniać podział zależnie od BPM niż przerzedzać nuty. Puls i serie 1/2 trzeba zachować, a cel gęstości liczyć w czasie (ok. 6 nut/s, odstęp 140–230 ms).

### P2. Tempo w połowie i zła faza taktu: reguły w „odczuwanych beatach” dwa razy za grube

**Co.**
- W 12/19 utworów z siatką odczuwany beat algorytmu to 2 beaty ludzkie.
- 8 utworów ma połowę tempa, np. 1277503: 190 → 95 BPM.
- 4 utwory mają tempo podwojone. Ludzie mapują tam 1/2 na podwojonej siatce (odstępy 1/2 0,64–0,79), a `feltBeatMs` i tak mnoży beat przez `foldFactor`.
- Faza taktu zgadza się tylko w 3/19 utworów. Część beatów algorytmu leży na ludzkich półbeatach (1570640: 0,38).

**Dowód.**
- Grupa „2 beaty” wobec 1:1 (MW p ≤ 0,007):
- odstępy 1/2: 0,12 wobec 0,46;
- pokrycie półbeatów: 0,16 wobec 0,40;
- akordy w strumieniu 1/2: 0 wobec 2,9 na minutę;
- najdłuższa seria 1/2: 4 wobec 9 nut;
- odstęp minijacka: 2,0 wobec 1,0 beatu.
- Akordy poza beatem 0,28 wobec 0,09.
- Downbeaty z nutą 0,67 wobec 0,96 (≥ 0,8: 2/20 wobec 70/78).
- Chwile poza 1/1–1/4: 0,20.
- Przesunięcie od siatki p50 −2,6 ms; 13% chwil leży > 10 ms od siatki.
- W 5 utworach (808872, 1773164, 1570640, 310607, 2314654) mediana przesunięcia wynosi −6…−10 ms, a 27–55% chwil leży > 10 ms od siatki.

**Klasa:** błąd algorytmu, który łamie silne tendencje ludzi. **Test:** tak.

**Kod.**
- `TempoEstimator.java`: prior `PRIOR_CENTRE_BPM = 120`, `PRIOR_SIGMA_OCTAVES = 1.4` daje ~95 BPM przewagę ok. 8,5% nad 190 BPM. `downbeatPhase` wybiera indeks mod 4 z najsilniejszym niskim pasmem.
- `timing.js` → `foldTempo`: zakres 70–200 BPM; reguła half-time działa tylko poniżej 95 BPM przy ≥ 8 onsetach na beat.
- `difficultyFilter.js` → `feltBeatMs` (× `foldFactor`), używane w `beatGapMs`/`fits`, `fastRunHolds`, `spaceChords`, `spreadLanes`. Także `offHalfGrid`, `capQuarters`, `quarterMinEnergy`.
- `rests.js` → `restsOf`.
- Poza chartem: `generate.js` → `chartFrom` zapisuje `bpm` = 95, a `highway.js` → `tempoScrollFactor` daje wtedy 0,89 zamiast 1,2. Nuty spadają o ok. 26% wolniej.

**Wpływ: wysoki.** Ponad połowa utworów. Rytm 1/2 i akcenty taktu znikają albo lądują w złych miejscach. Faza przesunięta o pół beatu daje synkopę, której nie ma w muzyce.

**Adaptacja.** W osu! timing ustawia człowiek. Ludzie traktują siatkę podwojoną przez fold jako prawdziwą, więc mnożenie przez `foldFactor` przeczy ich zachowaniu.

### P3. Holdy innego rodzaju: długie, z grą drugiej ręki, puszczane poza siatką

**Dowód** (część 2.3).
- Liczba holdów < ¾ / ¾–1½ / ≥ 1½ beatu na mapę: algorytm 0 / 18,5 / 34,5, ludzie 16 / 22 / 6.
- Holdy 1-beatowe z nutą w środku: 0,78 wobec 0,04. Holdy długie z nutą: 0,90 wobec 0,67 (p = 0,019).
- Puszczenie na następnej chwili: 0,10 wobec 0,97 (≥ 0,75: 0/20 wobec 65/70).
- Puszczenie na beacie: 0,08 wobec 0,69.
- Głowa holda w akordzie: 0 wobec 0,30 (≥ 0,2: 0/20 wobec 59/70).
- Start holda na beacie: 0,45 wobec 0,89.
- Zachowane: hold ≥ 1/2 beatu, brak shieldów.

**Klasa:** silne tendencje ludzi. Twarda zasada „krótki hold jest pusty” nie ma u algorytmu zastosowania, bo nie robi on krótkich holdów (`holdMinBeats: 1`). **Test:** tak.

**Kod** (`holds.js`).
- `planHolds`: długość = min(sustain, 4 beaty, następna nuta toru − gap, koniec frazy), zaokrąglana `Math.round` bez przyciągania do siatki.
- `addGapHolds`: hold trwa do następnej nuty tej ręki minus odstęp, maks. 2 beaty (`gapHoldShare: 0.25`).
- `addSustainHolds`: długość z pitch trackera.
- `holdBlocks`: brak akordu z holdem.
- `spacedBlocked` (`"spaced"`): druga ręka może grać co 1/2 beatu.
- `gapAfterHold` / `enforceFloors`: ta sama ręka czeka ≥ 100 ms po puszczeniu.

**Wpływ: wysoki do średniego.** Holdy to 12% nut algorytmu. Większość z nich jest długa i wypełniona, a puszczenia nie odpowiadają żadnemu dźwiękowi.

**Adaptacja.** Wzorzec „hold do następnej nuty” przenosi się wprost. W 32% puszczeń u ludzi gra potem ta sama ręka na innym torze, a reguła gry (≥ 100 ms) to blokuje. Czy to wygodne, oceni gracz.

### P4. Za mało akordów i w złych miejscach: granice, start kiai, głośne takty, strumień 1/2

**Dowód.**
- Udział akordów: 0,14 wobec 0,32.
- Akordy na zmapowanych beatach: 0,16 wobec 0,48 (≥ 0,25: 4/20 wobec 72/78).
- Akordy w strumieniu 1/2: 0 wobec 24,5 na minutę (≥ 3/min: 3/20 wobec 71/78).
- Akord na granicy: 0,13 wobec 0,71 (≥ 50%: 0/20 wobec 64/78).
- **Akord na starcie kiai: 0,00 wobec 1,00** (≥ 50%: 4/20 wobec 68/70).
- ρ(akordy w takcie, RMS): −0,01 wobec 0,38 (> 0: 9/19 wobec 69/77).
- Akordy poza beatem: 0,28 wobec 0,09.

**Klasa:** silna tendencja; akord na starcie kiai to twarda zasada. **Test:** tak.

**Kod.**
- `difficultyFilter.js` → `thinChords`: akord tylko na beacie algorytmu, przy s ≥ 0,4 i energii ≥ 0,45, z budżetem `maxChordShare` 1/3 i z nutą w każdej ręce. Nie bierze pod uwagę głośności taktu względem utworu.
- `difficultyFilter.js` → `spaceChords` (`chordGapBeats` 1/2 odczuwanego beatu): przy P2 akord nie może mieć sąsiada w odstępie 1/2.
- `patterns.js`:
- `withChords` stawia akord tylko na początku taktu;
- `drumChordEvents` działa tylko przy liderze tonalnym i energii ≥ 0,6;
- `mixedEvents` ma `CHORD_LEVEL = 2`, czyli akordy tylko na Hard.
- `holds.js` → `holdBlocks`.
- Generator nie zna kiai: `phrases.js` → `buildPhrases` buduje sekcje tylko z energii.

**Wpływ: średni do wysokiego.** Akord to główny akcent ludzkiego Normal. Brak akordu na wejściu refrenu słychać.

**Adaptacja.** Gra nie ma kiai. Najbliższym odpowiednikiem w generatorze jest granica sekcji ze wzrostem RMS. Ludzie w 46% przypadków stawiają akord w jednej ręce, więc wymóg „nuta w każdej ręce” jest surowszy niż u nich.

### P5. Dziury w pulsie i nieregularne długie odstępy

**Dowód.**
- Pokrycie beatów: 0,63 wobec 0,92 (≥ 0,75: 2/20 wobec 69/78). W kiai: 0,67 wobec 0,99.
- Odstępy 3/2 i 2 beaty są częstsze w 18/20 utworów. Odstępy ≥ 3/2 beatu ≤ 5% ma 5/20 chartów wobec 65/78 map.
- Przerwy ≥ 2 beaty: 2,49 wobec 0,57 na minutę.

**Klasa:** silna tendencja. **Test:** tak.

**Kod.**
- `rests.js` → `fillRests`: łata tylko przerwy ≥ 2 beaty algorytmu, czyli 4 ludzkie przy P2. Wstawia jedną nutę w środek, więc z 4 beatów robi 2 + 2. Pomija przerwy, gdzie energia < 0,2.
- `difficultyFilter.js` → `selectByFloors`.
- `phrases.js` → `chooseLeaders` / `supportLayers`: w utworach wokalnych bez wsparcia recall spada do 0,49 wobec 0,60 (n = 4).

**Wpływ: wysoki.** Puls jest szkieletem ludzkiego Normal.

**Adaptacja:** bez zmian.

### P6. Przerwy i kontrast sekcji

**Dowód.**
- Algorytm gra w 11/13 ludzkich przerw ≥ 4 beaty na teście (0,67 nuty/beat; pomiar pomocniczy). Sam ma 4 takie przerwy w 3 utworach, żadnej przy granicy.
- Najdłuższa przerwa p90: 4,0 wobec 8,3 beatu.
- Granica w górę: po/przed 1,19 wobec 1,33 (test) i 1,38 (trening). Algorytm zagęszcza takt przed granicą (1,00), a w takcie 0 ma 0,90.
- Nuta na starcie kiai: 0,55 wobec 1,00 (≥ 0,8: 6/20 wobec 70/70).
- Nuta na granicy (±25 ms): 0,78 wobec 1,00 (≥ 80%: 9/20 wobec 71/78). To mniejszy problem, niż pokazywały metryki przed v2.

**Klasa:** silna tendencja; nuta na starcie kiai to twarda zasada; długie przerwy to styl. **Test:** tak.

**Kod.**
- `intensity.js` → `sectionIntensity`: zakres 0,6–1,3.
- `phrases.js` → `buildPhrases`: frazy 16-beatowe, sekcje z energii, przyciągane do błędnych downbeatów.
- `difficultyFilter.js` → `windowPower`: okna 2 s przechodzą przez granicę.
- `rests.js` → `fillRests`.

**Wpływ: średni.**

**Adaptacja.** Przerwy opierać na RMS audio, z którego powstaje chart. Bot może grać inny upload, więc nie wolno zakładać tych samych czasów.

### P7. Rytm nie powtarza się, kiedy powtarza się muzyka

**Dowód (v2).**
- Rytm w powtórzeniu: 0,41 wobec 0,91 (≥ 0,8: 1/16 wobec 57/62 i 17/19).
- Przewaga powtórzenia nad bazą: 0,10 wobec 0,28 (≥ 0,1: 8/16 wobec 57/61).
- Linia bazowa: 0,29 wobec 0,63.
- Kontrola (`jitter_check.md`): po przyciągnięciu do slotu 1/8–1/6 w ±40 ms baza algorytmu rośnie do 0,46, ludzi zostaje 0,64. Część różnicy to pomiar, ale nie cała.
- Tory algorytm powtarza częściej niż ludzie (0,51 wobec 0,39).

**Klasa:** silna tendencja. **Test:** tak.

**Kod.**
- `generate.js` → `copiedRepeat`, `repeats.js` → `copyRepeat`: kopiuje tylko przy similarity ≥ 0,85, w frazach 16 beatów algorytmu. Nuta bez zdarzenia w ±60 ms przepada; poniżej 50% skopiowanych nut fraza jest mapowana od nowa.
- `barRepeats.js` → `repeatBarLanes`: kopiuje tylko tory, nie rytm.

**Wpływ: średni.**

**Adaptacja:** bez zmian.

### P8. Ręce i wzorce torów: lokalna nierównowaga, tryle w jednej ręce, tor zależny od instrumentu

**Dowód.**
- **Ręce w 4 taktach:** p90 0,13 wobec 0,05 (20/20 wyżej; ≤ 0,10: 5/20 wobec 77/78 i 19/20).
- Lewa ręka: kick 0,61 wobec 0,51, snare 0,44 wobec 0,50.
- Tryle x-y-x: 0,14 wobec 0,07 (≤ 0,10: 2/20 wobec 67/78).
- Tryle w jednej ręce: 0,35 wobec 0,09.
- Długość trylu bez różnicy (4,5 wobec 4).
- Minijacki: 0,04 wobec 0,09, przy odstępie 2 wobec 1 beatu.
- Entropia: 7,53 wobec 8,07.

**Klasa:** lokalny balans rąk to twarda zasada; tryle to silna tendencja. **Test:** tak.

**Kod.**
- `patterns.js`:
- `mixedEvents`: stopa na torach 0/1, werbel i hat na 2/3;
- `hitsOf`: tor `n % 2`;
- `tonalLanes`.
- `seams.js` → `balanceHands`: lustro całej frazy wg skumulowanego bilansu, więc nie poprawia nierównowagi lokalnej.
- `difficultyFilter.js` → `spreadLanes`, `limitJacks`.

**Wpływ: średni.** Kilka taktów na jedną rękę to fizyczne zmęczenie, którego ludzie na Normal unikają.

**Adaptacja.** Nie wymuszać pitch relevancy: ludzie na Normal jej nie stosują.

### P9. Wybór dźwięku wg klasy perkusji pluginu; hi-haty pominięte

**Dowód.**
- W modelu dopasowanym do algorytmu kick, snare i perc mają wagi +0,48…+0,52; u ludzi ≈ 0.
- Recall hat: 0,00 wobec 0,25; na półbeatach 0,08 wobec 0,73.
- Recall snare: 0,34 wobec 0,49.
- AUC modelu ludzkiego na slotach: 0,945 dla algorytmu wobec 0,989 dla ludzi.

**Klasa:** silna tendencja ludzi. **Test:** tak.

**Kod.**
- `patterns.js` → `hatsOf`, `drumEvents`: hat dostaje level 2, a Normal ma `maxLevel: 1`.
- `DrumDetector.java`.

**Wpływ: średni do niskiego** (po v2 słabszy). Hi-haty to część niedoboru półbeatów z P1.

**Adaptacja:** brak.

### P10. Drobne

- `LEAD_IN_MS = 1500`: pierwsza nuta algorytmu po 1,65 s wobec 0,89 s u ludzi. Wpływ niski.
- `minNoteGapMs: 100`: ludzie mają pojedyncze krótsze odstępy (min. p50 88 ms). Wpływ niski.
- Systematyczne przesunięcie −6…−10 ms w 5 utworach (P2). Mieści się w oknie PERFECT, ale wrażliwy gracz może je poczuć. Wpływ niski do średniego.
- `NO_TIMING` (2270163): brak siatki, 0 akordów, precyzja 0,57. Rzadkie, ale dla takiego utworu wpływ wysoki.

**Hipotezy z `algorithm.md` na Normal.**
1. Triole: **nie są problemem**, ludzie ich nie używają.
2. Zmienne BPM i metrum: nie da się ich oddzielić od P2.
3. Brak buildupu: potwierdzona częściowo (P6). Ludzie też nie budują gęstości przed granicą, ale skaczą na niej.
4. `fillRests`: potwierdzona częściowo (P5, P6).
5. Kolizje reguł Normal: potwierdzona (P2).
7. Udział holdów: nie jest problemem; problemem jest ich rodzaj (P3).
8. Stałe tory perkusji: potwierdzona, wzmocniona przez balans rąk (P8).
9. Klasy perkusji pluginu: potwierdzona (P9).

---

## 7. Kandydaci do testów odsłuchowych i gry

Czasy są na osi audio z map (±1–2 s); bot może grać inny upload. Szczegóły fragmentu pokazuje `07_window.py <set> <od> <do>`.

| # | set | utwór | czas | relacja tempa | na co zwrócić uwagę |
|---|---|---|---|---|---|
| 1 | 2224035 | JINGBURGER – Konton Boogie | 01:44–01:49 (kiai) | 2 beaty | Człowiek: 39 nut, akordy na beatach, 1/2. Algorytm: 10 nut na 1/3, 1/6, 1/8. Czy nuty „pływają”? |
| 2 | 1894317 | kessoku band – Seishun Complex (TV Size) | 01:16–01:21 (kiai) | 2 beaty | Człowiek: strumień 1/2 z akordami i holdami 1/2. Algorytm: ćwierćnuty (17 wobec 43 nut). |
| 3 | 2200258 | Kashii Moimi feat. KAFU – Cat Loving (kageminori bootleg) | 00:19–00:23 (kiai) | 2 beaty | Człowiek: jump na każdym beacie przy 220 BPM. Algorytm: pojedyncze nuty i 2 długie holdy (12 wobec 32 nut, 2 wobec 13 akordów). |
| 4 | 1784295 | Rokudenashi – Tada Koe Hitotsu | 00:45–00:53 (wejście sekcji) | 1:1 | Człowiek: 1/2 z akordem co beat (20 akordów). Algorytm: bez akordów, potem nuty poza siatką i nakładające się holdy. |
| 5 | 2270163 | ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasavitsa | 00:34–00:39 | bez siatki | Człowiek: akord na każdym beacie. Algorytm: 0 akordów, holdy z nutami drugiej ręki. |
| 6 | 1570640 | Lime – 8bit Voyager | 00:44–00:50 | 2 beaty, faza, −7,8 ms | Człowiek: przerwa ok. 2,5 s. Algorytm: holdy na półbeatach z nutami w środku. |
| 7 | 1773164 | TUYU – Itsuka Otona ni Nareru to Ii ne. | 01:06–01:12 | 2 beaty, −8,3 ms | Człowiek: łańcuch holdów 1/2, każdy puszczany na następnej nucie. Algorytm: nuty na 1/8 i 1/3, puszczenia poza siatką. |
| 8 | 2314654 | Laur – PRAGMATISM -RESURRECTION- | 02:27–02:33 | 1:1 | Człowiek: długi trzymany akord (breakdown). Algorytm: 14 nut na 1/8, 1/3, 1/6. |
| 9 | 808872 | Kobaryo – Perfect Neglect | 00:51–00:55 | 2 beaty, −10 ms | Człowiek: 1/2 przy 230 BPM. Algorytm: 1 nuta na beat, 55% chwil > 10 ms przed siatką, BPM 115 w chartcie (wolniejsze spadanie). |

Warto też posłuchać startów kiai w dowolnych utworach testowych: człowiek zawsze stawia tam akord, algorytm prawie nigdy.

**Czego liczby nie rozstrzygną:**
- czy ok. 6 nut/s pasuje do gracza Normal w tej grze;
- czy „hold do następnej nuty” w tej samej ręce jest wygodny;
- czy brak akordu na wejściu refrenu słychać;
- czy lokalna przewaga jednej ręki męczy.

---

## 8. Prośby o nowe metryki (tylko niespełnione po v2)

1. **Kwantyzacja chwil generatora do najgrubszego podziału w ±25 ms** (tak jak w `chosen`), a nie do podziału z klasyfikacji o tolerancji min(10 ms; 0,03 beatu). Dotyczy `gap_share`, `run_*` i `repetition.*`; można też raportować oba warianty.
 - 13% chwil algorytmu leży > 10 ms od siatki i trafia do klas 1/12–1/16.
 - Po v2 udział odstępów algorytmu „poza klasami” wzrósł z 0,06 do 0,12.
 - Przyciągnięcie do slotu 1/8–1/6 podnosi bazę rytmu z 0,29 do 0,46.
 - Bez tej poprawki wielkość P7 pozostaje niepewna.
2. **`holds_context.release_at_next_moment` z podziałem na rękę:** druga ręka czy ta sama ręka na innym torze. Z pomiaru pomocniczego u ludzi wychodzi 85% i 32%. Gra wymaga ≥ 100 ms przerwy dla tej samej ręki, więc od tego zależy, jak przenieść ludzki wzorzec (P3).
3. **`versus_human` wg pozycji i kontekstu:**
 - recall ludzkich chwil osobno na beatach, półbeatach i w kiai;
 - liczba nut generatora w ludzkich przerwach ≥ 4 beaty (pomiar pomocniczy: 11/13 przerw, 0,67 nuty/beat).
 Sam recall 0,58 nie mówi, które ludzkie chwile algorytm pomija.

**Spełnione przez v2:** tolerancja `hold_short_share`, kontekst holdów, shield, anchor RC, pokrycie siatki, akordy w strumieniu 1/2, kwantyzacja rytmu i powtórzeń (częściowo, zob. pkt 1), ±25 ms na granicach, kontekst przerw, ręka wg klasy, tryle w jednej ręce. Prośbę o klasy odstępów w ms agent główny odrzucił z uzasadnieniem; nie ponawiam jej.

---

## 9. Ograniczenia

- **Liczności.** Test ma 20 utworów, czyli 4–6 na gatunek: wnioski gatunkowe na teście są anegdotyczne. Trening to 78 map od 61 mapperów. Korpus Ranked był już filtrowany przez RC.
- **Zakres SR to nie „Normal” w grze.** 10/78 map nosi nazwę Hard. Na 65 mapach nazwanych Normal wnioski są takie same.
- **Pomiar na siatce ludzkiej.** v2 kwantuje pozycje do sklasyfikowanego podziału. Chwile algorytmu przesunięte o 10–30 ms (13% chwil) lądują wtedy na 1/12–1/16. To zawyża odstępy „poza klasami” i zaniża rytm w powtórzeniach (P7; prośba 1). Nie wpływa na serie 1/2, gęstość, pokrycie, akordy ani holdy.
- **Przyczyny w kodzie.** Nie miałem cech pluginu, więc przypisanie przyczyn opiera się na czytaniu kodu i zgodności wzorców. Przykłady: odstęp minijacka 2,0 ↔ `laneGapBeats`; seria 1/2 = 4 ↔ `maxFastRun`; zero akordów z holdem ↔ `holdBlocks`. Grupy relacji tempa (12 / 7 / 1) są małe.
- **Regresja slotów** (`chosen`). Sloty nie są niezależne, a cechy są współliniowe: współczynniki to wskazówki, nie efekty. Obok AUC z puli podaję medianę AUC w utworze.
- **Oś czasu.** Przesunięcie dopasowano na nutach ludzi. Stemy nie były walidowane.
- **Pomiary pomocnicze** (`04_holds.py`, `08_aux.py`, `10_jitter_check.py`) nie są oficjalnymi metrykami: klasy holdów ≈ 1/2 i ≈ 1, ręka przy puszczeniu, tory zewnętrzne, nuty algorytmu w ludzkich przerwach, kontrola drgań.
- **Granice sekcji z audio** (Foote) nie zawsze odpowiadają granicom, które słyszy mapper.
- Popularność nie służy jako miara jakości.

---

## 10. Jak odtworzyć

```sh
PY=/tmp/claude-0/-home-user-MewBit/4930cd9b-e13e-5233-b473-de00f0007e62/scratchpad/venv/bin/python
cd mapping-analysis/levels/normal
$PY -I 01_profile.py       # profil metryk (z v2), reguły, BPM → results/profile_metrics.{csv,md}, rules.md, bpm.md
$PY -I 02_slots.py         # sloty (`chosen`): pozycje, recall, regresja → results/slots.md, slots_coefs.csv
$PY -I 03_sections.py      # granice sekcji, intro/outro, kontrast → results/sections.md, sections_*.csv
$PY -I 04_holds.py         # holdy: klasy, ręka przy puszczeniu, regresja `chosen_hold_start` → results/holds.md, holds_per_chart.csv
$PY -I 05_genres.py        # gatunki: KW + BH, OLS z BPM, test, algorytm wg gatunku → results/genres.md
$PY -I 06_algo.py          # algorytm vs ludzie (z versus_human), relacja tempa, per utwór, okna → results/algo_vs_human.md, windows.csv, candidates.md
$PY -I 08_aux.py           # pomocnicze: tory zewnętrzne, nuty algorytmu w ludzkich przerwach → results/aux.md
$PY -I 09_numbers.py       # liczności tendencji, wpływ oznaczonych utworów → results/numbers.md
$PY -I 10_jitter_check.py  # czułość rytmu na drgania czasu → results/jitter_check.md
$PY -I 07_window.py 2224035 1:44 1:49   # podgląd fragmentu
```

Wspólne funkcje są w `common.py`. Skrypty czytają tylko dane Normal, `shared/data/songs/` oraz kolumny ogólne i `normal_*` z `shared/corpus.csv`. Zapisują wyłącznie do `levels/normal/results/`. Wyniki są deterministyczne.