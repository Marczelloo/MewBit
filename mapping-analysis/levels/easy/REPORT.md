# Easy: jak mapują ludzie i czym różni się generator v19 (etap 2, metryki v2)

Poziom Easy = dyfficulty osu!mania 4K o SR w [0; 1,65) (`shared/levels.md`). Dane:
- 99 ludzkich map Easy: 79 w treningu, 20 w teście;
- 80 różnych mapperów dyfficulty (`easy_owners`) i 83 hostów zestawów; w treningu 60 mapperów, w teście 20, a żaden mapper testu nie występuje w treningu;
- 20 chartów Easy generatora v19 dla utworów testowych.

Zasady ludzi wyprowadzam na treningu i sprawdzam na teście. Generator porównuję z ludźmi tylko na teście.
Wszystkie czasy są na osi zdekodowanego audio. Format p10 / p50 / p90 to kwantyle po mapach.
Wersja metryk: v2 (`shared/metrics.md`, sekcja „Dodane i poprawione po etapie 2”). Skrypty i wyniki: `mapping-analysis/levels/easy/` (pkt 10).

Klasy wniosków:
- **Z**: twarda zasada, spełnia ją ≥ ~95% map;
- **T**: silna tendencja, ~75–95% map;
- **S**: styl mappera lub gatunku (szeroki rozrzut, brak wspólnej normy).

## 1. Podsumowanie

Ludzkie mapy Easy mają stały szkielet:
- nuta na prawie każdym beacie głośnych fragmentów (81% beatów, 90% downbeatów);
- okazjonalne 1/2 (18% półbeatów, serie zwykle ≤ 5 nut);
- około 3,4 nuty/s niezależnie od BPM i równo obciążone ręce, także w oknach 4 taktów;
- holdy zwykle 1-beatowe, kończone w chwili następnej nuty i bez nut w trakcie;
- nuta, a na wejściu kiai zwykle akord, na początku sekcji.

Generator v19 daje na 20 utworach testowych mapy o połowę rzadsze: 1,87 vs 3,64 nuty/s, a gęstszy od człowieka jest tylko 1 z 20 chartów.
Ma nutę na 36% beatów (43% w ±25 ms) i 35% downbeatów, powyżej 150 BPM nie ma ani jednego odstępu 1/2, a 26% jego odstępów to 2 beaty.
W 8 utworach śledzonych w połowie tempa odstępy 2-beatowe to 52–88%.

Jego nuty w 84% leżą na nutach ludzi, ale pokrywają tylko 43% ludzkich chwil, choć pod 95% ludzkich nut plugin wykrywa zdarzenie perkusji.
Nuty gubią się w filtrze Easy (poziom 0 = uderzenie ≥ mediana frazy), w limicie gęstości, w sztywnym odstępie 200 ms i przez błędy siatki: połowa tempa w 8/20 utworów, zła faza taktu w 13/19.

Holdy generatora są odwrotnością ludzkich:
- 99% trwa ≥ 1,5 beatu (u ludzi 22%);
- 73% ma w środku nutę drugiej ręki (u ludzi 0%);
- puszczenie wypada w chwili następnej nuty w 35% (u ludzi 99%).

Generator nie reaguje na strukturę utworu:
- nutę na granicy sekcji ma 41% granic (ludzie 100%);
- akord na wejściu kiai ma 4% wejść (ludzie 75%);
- gęstość w kiai wynosi 0,98× gęstości poza kiai (ludzie 1,23×);
- w powtórzeniach muzyki powtarza tory zamiast rytmu (rytm 0,31 vs 0,90).

Reguły ludzi potwierdziły się na teście. Gatunek zmienia głównie ilość 1/2 (przez BPM), podążanie za wokalem i liczbę pauz.
Liczby nie mówią, czy mapa jest przyjemna. O tym rozstrzygną testy z graczami, tym bardziej że docelowy gracz Easy tej gry może potrzebować mniejszej gęstości niż gracz osu! Easy.

### Zmiany po metrykach v2

| Wniosek | Przed (v1) | Po (v2) | Ocena |
|---|---|---|---|
| Wybór dźwięków (tabele slotów, regresja) | cel `mapped` | cel `chosen`: wyniki ludzi identyczne (beaty 0,81, półbeaty 0,18; AUC na teście 0,82 / 0,77); model ludzi na chartach generatora AUC 0,64 / 0,73 | bez zmian |
| Pokrycie beatów przez generator | 0,44 | oficjalne `coverage.beat` 0,36 (tolerancja źródła 10 ms); w ±25 ms (`chosen`) 0,43 | różnica wobec ludzi (0,86) nieco większa |
| Rytm generatora (skwantowany) | odstępy 1/1 0,41, 1/2 0,00, 2 beaty 0,26 | 1/1 0,35, 1/2 0,00, 2 beaty 0,26, `other` 0,06 → 0,10 | bez zmian |
| Rytm w powtórzeniach muzyki | 0,29 vs 0,90, z zastrzeżeniem o drganiu siatki | 0,31 vs 0,90; zysk nad bazą 0,16 vs 0,33 | wniosek mocniejszy, zastrzeżenie usunięte |
| Granice sekcji z nutą (tolerancja ±25 ms zamiast 3 ms) | 0,13 vs 1,00 | 0,41 vs 1,00 (0/20 par); akordy 0,00 vs 0,40 | problem mniejszy, ale zostaje |
| Wejścia kiai | ad hoc: nuta 52% / akord 8% vs 100% / 72% | oficjalne `kiai_start`, 68 wejść: generator 41% / 4%, ludzie 96% / 75% | bez zmian |
| Pusty ostatni beat przed granicą | – | nowa metryka: generator 0,35, ludzie 0,11 (trening 0,17) | nowy problem |
| Profil gęstości wokół granic | ad hoc, mediana po granicach: skok do 1,20 na granicy „w górę” | oficjalny (mediany po mapach): przed granicą „w górę” 0,75–0,87, na granicy 1,00; skoku 1,20 nie ma | poprawione |
| Holdy krótsze niż 1 beat | `lt_1` 0,17 u ludzi (artefakt zaokrąglenia) | `lt_1` < 0,95 beatu: 0 / 0 / 0,05 | artefakt usunięty |
| Puszczenie w chwili następnej nuty | ad hoc: 0,29 vs 0,99 | oficjalne: 0,35 vs 0,99; start na beacie 0,68 vs 0,95 | bez zmian |
| Długość holdów | – | generator 99% holdów ≥ 1,5 beatu, ludzie 22%; ludzie nie kładą nut w holdach 1-beatowych, w dłuższych robi to 22/67 map (styl) | doprecyzowane |
| Tryle | `trill_share` 0,23 vs 0,08 (generator „za dużo tryli”) | `trills.*` (odstęp ≤ 1 beat): generator 4,5 vs 11,6 serii na minutę; wysokie `trill_share` to wolne przeskoki co 2 beaty | wniosek poprawiony |
| Ręce lokalnie | – | `hand_balance_4bar` p50 0,08 vs 0,03; okna > 0,2 w 12/20 chartów vs 1/20 map | nowy problem |
| Pauzy | – | `rest_context`: pauzy ≥ 4 beaty generatora wypadają w głośnej muzyce (udział głośnych 1,00 vs 0 w treningu, 0,62 w teście) | nowy, częściowo potwierdzony |

## 2. Profil mapowania ludzi na Easy

### 2.1 Co ludzie mapują, a co pomijają (tabele slotów, cel `chosen`, `02_slots.py`)

Udział punktów siatki z chwilą, po mapach (oficjalne `coverage.*`; trening n=79, 60 mapperów; test n=20, 20 mapperów):

| Pozycja na siatce | Trening p10 / p50 / p90 | Test p50 | Klasa |
|---|---|---|---|
| beat (`coverage.beat`) | 0,62 / 0,81 / 0,93 | 0,86 | T (≥ 0,6 w 74/79 i 19/20) |
| downbeat | 0,75 / 0,90 / 0,99 | 0,95 | T |
| inne beaty | 0,54 / 0,79 / 0,93 | 0,82 | T |
| półbeat (`coverage.half`) | 0,07 / 0,18 / 0,43 | 0,19 | T (rzadko, ale prawie zawsze obecne) |
| 1/4 (`coverage.quarter`) | 0 / 0 / 0,02 | 0,001 | Z (praktycznie nigdy) |
| 1/3, 1/6, 1/8 | 0 / 0 / ≤ 0,001 | 0 | Z |

Co decyduje o tym, który beat ma nutę (p50 po mapach, trening; test w nawiasie):
- **Głośność fragmentu, a nie siła uderzenia.**
- W najgłośniejszej tercji RMS utworu ludzie mapują 94% beatów (96%), w najcichszej 62% (70%); więcej w głośnej części ma 74/79 map (19/20).
- Beat z uderzeniem perkusji pluginu silniejszym niż mediana mapy: 93% (94%); słabszym: 75% (82%). Słabsze uderzenia też więc zwykle mają nutę.
- **Kiai.** `coverage.beat_kiai` 0,94 vs `beat_no_kiai` 0,77 (test 0,97 vs 0,79). Ludzie zagęszczają kiai, wypełniając każdy beat, a nie dokładając 1/2: więcej półbeatów w kiai ma tylko 37/71 map.
- **Puls tam, gdzie detektory nic nie słyszą.** Beat bez żadnego onsetu librosa ma nutę w 33% przypadków, z onsetem w 87%. To zgodne z wyjątkiem RC „consistent, predictable snap”.
- **Półbeaty** dostają nutę, gdy jest tam onset (z onsetem / bez):
- perkusyjny 28% / 6%; lowmid 36% / 12%; harmoniczny 36% / 18%;
- stem wokalu 29% / 16%; stem perkusji 29% / 12%;
- onset basu prawie nic nie zmienia: 20% / 18%.
- **Regresja logistyczna** celu `chosen` (trening, standaryzowane cechy; AUC liczone na mapach testowych):
- **beaty:** AUC 0,82. Cechy dodatnie: obwiednia stemu perkusji +0,61, RMS +0,58, downbeat +0,48, stem „other” +0,48, kiai +0,26. Ujemne: BPM −0,22, stem basu −0,21. Sama pozycja w takcie daje AUC 0,59, same stemy 0,77, same zdarzenia pluginu 0,75.
- **półbeaty:** AUC 0,77. Cechy dodatnie: RMS +0,50, stem perkusji +0,41, obwiednia highmid +0,38, lowmid +0,34, onset wokalu +0,15. Ujemne: BPM −0,36.
- **Ten sam model na chartach generatora:** AUC 0,64 (beaty) i 0,73 (półbeaty). Wybór beatów u generatora słabo zgadza się z ludzką logiką.
- **Bez 5 zestawów oznaczonych w `alignment.md`:** AUC 0,820 / 0,768, ta sama kolejność cech.
- Obwiednie są ze sobą skorelowane, więc znaki pojedynczych współczynników mówią o kierunku, nie o wielkości efektu.
- **Zdarzenia pluginu.**
- Pod 95% zmapowanych beatów i półbeatów ludzi (test 97%) jest zdarzenie perkusji pluginu w ±25 ms.
- Onsety 4 pasm pluginu są w 75–97% wszystkich slotów, więc same w sobie niczego nie rozróżniają.
- Recall silnych zdarzeń (`plugin_events.*.recall_strong`, trening p50): snare 0,57, high 0,51, highmid 0,50, lowmid 0,49, perc 0,35, low 0,27, lead 0,25, kick 0,23, bass 0,19.
- Na beatach różnica między beatami ze stopą i bez nie ma stałego kierunku (trening 74% vs 81%, test 88% vs 83%). Klasyfikacja perkusji pluginu jest zawodna (`algorithm.md` pkt 5.9), więc tego nie interpretuję.
- **Stemy (recall na beatach / półbeatach, trening p50):** bas 0,93 / 0,20, other 0,91 / 0,28, perkusja 0,89 / 0,29, wokal 0,88 / 0,29.
- **Ręce a instrumenty.** Ludzie nie przypisują instrumentów rękom: w lewej ręce jest 0,50 stóp, 0,50 werbli i 0,52 basu (`hand_by_class.*`, p10–p90 ok. 0,43–0,60).

### 2.2 Gęstość, podziały, odstępy i BPM (`01_profile.py`, `03_density_bpm.py`)

| Metryka | Trening p10 / p50 / p90 | Test p10 / p50 / p90 | Klasa |
|---|---|---|---|
| `nps` | 2,66 / 3,40 / 4,12 | 2,72 / 3,64 / 4,40 | T (2,5–4,5 w 74/79 i 17/20) |
| `notes_per_beat` | 0,87 / 1,14 / 1,48 | 0,86 / 1,19 / 1,42 | T (≥ 0,85 w 71/79 i 18/20) |
| `nps_window.p90` / `.max` | 3,5 / 4,5 / 5,5 · 4,5 / 5,5 / 6,5 | 4,0 / 4,5 / 5,5 · 4,9 / 5,5 / 6,5 | T |
| `nps_peak8s` | 3,75 / 4,75 / 5,50 | 3,96 / 4,88 / 5,28 | T |
| `snap_share.1` / `.2` | 0,60 / 0,80 / 0,92 · 0,07 / 0,20 / 0,37 | 0,69 / 0,81 / 0,89 · 0,11 / 0,19 / 0,29 | T |
| `triplet_share` | 0 / 0 / 0,006 (maks. 0,03) | 0 / 0 / 0 | Z (< 1% w 74/79 i 19/20) |
| `gap_share.1` / `.1/2` / `.2` | 0,37 / 0,61 / 0,81 · 0,07 / 0,22 / 0,48 · 0 / 0,03 / 0,09 | 0,47 / 0,61 / 0,77 · 0,04 / 0,28 / 0,38 · 0 / 0,03 / 0,14 | T |
| `run_1/2.max_notes` | 3 / 5 / 9,2 | 2 / 5 / 9,9 | T (≤ 5 w 58/79 i 13/20; ≤ 9 w 71/79) |
| `run_1/1.max_notes` | 8 / 32 / 71 | 8 / 24 / 49 | T (długie łańcuchy 1/1) |
| serie 1/4 i szybsze | brak w 76/79 | brak w 19/20 | Z (wyjątki tylko przy 100–130 BPM) |
| `gap_ms.min` | 137 / 168 / 216 ms | 135 / 162 / 198 ms | Z: najkrótszy odstęp = 1/2 beatu (`gap_beats.p5` = 0,50) |

**Zależność od BPM.**
- Nps prawie nie zależy od BPM: elastyczność log-log +0,19, 95% CI [−0,05; +0,44], R² 0,03.
- Liczba nut na beat maleje proporcjonalnie: elastyczność −0,81 [−1,05; −0,57], R² 0,37.
- Ludzie trzymają więc mniej więcej stałą liczbę nut na sekundę, a nie stały rytm na beat. Model daje 3,1 / 3,3 / 3,5 nuty/s i 1,55 / 1,11 / 0,88 nuty/beat przy 120 / 180 / 240 BPM.

Przedziały BPM (trening, p50; n map / mapperów):

| BPM | n | nuty/s | nuty/beat | beaty z nutą | półbeaty z nutą | `gap_share.1/2` | najdł. seria 1/2 | min. odstęp | 1/2 beatu |
|---|---|---|---|---|---|---|---|---|---|
| < 150 | 13 / 12 | 2,89 | 1,39 | 0,87 | 0,33 | 0,34 | 5 (p90 23) | 214 ms | 231 ms |
| 150–180 | 30 / 29 | 3,45 | 1,20 | 0,82 | 0,21 | 0,26 | 5 | 176 ms | 176 ms |
| 180–210 | 28 / 22 | 3,42 | 1,10 | 0,80 | 0,17 | 0,23 | 5 | 155 ms | 156 ms |
| ≥ 210 | 8 / 7 | 2,96 | 0,79 | 0,68 | 0,14 | 0,13 | 3,5 | 140 ms | 140 ms |

- W każdym przedziale ≥ 150 BPM najkrótszy odstęp to dokładnie 1/2 beatu, także przy 210–240 BPM (ok. 140 ms). Ludzie nie mają minimalnego odstępu w ms, tylko minimalny podział: 1/2 (**Z**).
- Udział 1/2 maleje z BPM (Spearman ρ = −0,32 w treningu, −0,42 w teście). Jedyny utwór > 240 BPM (363594, 284 BPM, test) nie ma żadnego odstępu 1/2.
- Serie 1/4 (3 mapy w treningu, 1 w teście) występują tylko przy 100–130 BPM.

### 2.3 Akordy, jacki, holdy

**Akordy.**
- Nigdy więcej niż 2 nuty naraz: 99/99 map (**Z**). Akordy to 0,03 / 0,10 / 0,28 chwil (test 0,01 / 0,16 / 0,22), **S**.
- Akord ma 0,03 / 0,12 / 0,35 zmapowanych beatów (`chord_rate_on_mapped_beats`; test 0,19).
- Gdzie stoją akordy (**T**):
- 58% akordów na downbeacie (p50; p10 0,25), 35% na innych beatach, 0% poza beatem (p90 0,19);
- akord ma 23% zmapowanych downbeatów i 6% pozostałych beatów (test 26% / 14%);
- akord ma 12% chwil w głośnej połowie utworu i 2% w cichej (test 20% / 3%);
- akord stoi na 72% wejść kiai (185 wejść w 71 mapach; ≥ 50% wejść w 59/71 map; test 75%, 68 wejść) i na 43% granic sekcji (test 40%).
- Akordy wewnątrz serii 1/2 (`chords_in_half_runs_per_min`): brak w 64/79 map (p90 0,61 na minutę; test 17/20), **T**.
- Akordy 2-nutowe rozłożone na obie ręce: 0,17 / 0,52 / 0,75. Połowa akordów jest jednoręczna (tory 0+1 albo 2+3), **S**.

**Jacki.**
- Brak minijacków ≤ 1/4 beatu: 99/99 map (**Z**). Minijacki to 0,6 / 4,4 / 12,5% par chwil, w odstępie 1 beatu (p50).
- Kolejne nuty na tym samym torze bliżej niż 1 beat: 0% (p90 1%), **Z**. Na tym samym torze bliżej niż 350 ms: 1% (p90 9%).
- `jack_max_notes` 2 / 2 / 4 (≤ 4 w 76/79), `anchor_max_notes` 3 / 4 / 7, `anchor_rc_max_notes` 0 we wszystkich mapach.

**Holdy** (`holds_context.*`; 71 map treningu i 18 testu ma holdy).
- Udział holdów: 0,002 / 0,13 / 0,28 (test 0,03 / 0,10 / 0,25). 10/79 map ma < 2% holdów, a 7/79 (7 mapperów) > 30%, **S**.
- Długość:
- holdy ~1-beatowe to 0,31 / 0,76 / 0,97 holdów mapy, ≥ 1,5 beatu 0,03 / 0,22 / 0,68;
- `hold_short_share.lt_1` (< 0,95 beatu): 0 / 0 / 0,05, ≤ 5% w 71/79 map; holdy ½-beatowe są w 8/79 mapach, **T**.
- Start na beacie: 0,70 / 0,92 / 1,00 (≥ 0,7 w 64/71; test 0,95), **T**.
- **Puszczenie w chwili następnej chwili** (`release_at_next_moment_share`): 0,89 / 0,98 / 1,00 (≥ 0,8 w 69/71; test 0,99, 18/18), **T/Z**. Ludzki hold na Easy wypełnia odstęp do następnej nuty. Powstają łańcuchy 1-beatowych holdów, np. 1894317 w 00:52–01:00.
- Puszczenie na beacie: 0,73 / 0,92 / 1,00 (test 0,97). Puszczenia ≥ 1 beat od siebie w 74/79 map.
- **Nuty w trakcie holda:**
- holdy ~1-beatowe są czyste: jakąkolwiek nutę w środku ma tylko 4/70 map, **Z**;
- holdy ≥ 1,5 beatu: 0 / 0,04 / 0,67 z nutą w środku, > 20% w 22/67 map (19 mapperów), **S**;
- łącznie `holds_with_notes_inside_share` 0 / 0,02 / 0,17 (test 0 / 0 / 0,09).
- Głowa holda w akordzie: 0 / 0,11 / 0,34 (test 0,07). Shield 1/4 nie występuje w żadnej mapie. Dwa holdy naraz: 24/79 map (**S**); trzy nigdy.
- Początki holdów wypadają tam, gdzie obwiednia stemu perkusji jest słabsza niż pod zwykłymi nutami na beatach (−0,10 w treningu i w teście). Przewagi dźwięków ciągłych nie widać wyraźnie (wokal +0,02, w teście +0,10). Długość holda nie wynika z długości dźwięku.

### 2.4 Wzorce, ręce i ich powtarzanie (`04_patterns_repetition.py`)

- **Tory i ręce.**
- Każdy tor ma ≥ 19% nut w 99/99 map; tory 1+2 mają 0,47 / 0,51 / 0,54 nut; lewa ręka 0,49–0,51 (**Z**).
- W oknach 4 taktów nierównowaga rąk (`hand_balance_4bar`) wynosi p50 0,02 / 0,03 / 0,05, p90 0,04 / 0,07 / 0,10. Okno z nierównowagą > 0,2 ma tylko 4/79 map (test 1/20), **Z/T**.
- **Kroki między pojedynczymi nutami:**
- ten sam tor 0,02 (p90 0,11), sąsiedni 0,47, o dwa tory 0,34, o trzy 0,16;
- zmiana ręki: 0,63 / 0,71 / 0,82;
- schody: 0,04 / 0,09 / 0,19;
- entropia 4-chwilowych układów: 6,18 / 6,95 / 7,42 bita.
- **Tryle** (`trills.*`, chwile jednonutowe x-y-x-y w odstępach ≤ 1 beat):
- 3,3 / 9,2 / 15,3 serii na minutę (test 3,9 / 11,6 / 21,3);
- najdłuższy tryl 3 / 4 / 6 nut, maksimum 8; tryli ≥ 10 nut nie ma w żadnej mapie;
- tryle w jednej ręce: 0 / 0,11 / 0,45;
- klasa **T**: krótkie tryle są częste, długich nie ma.
- **Powtórzenia muzyki** (pary okien 4-taktowych o podobieństwie audio ≥ 0,75; pozycje skwantowane):
- dotyczy map z ≥ 3 parami: 48 map / 41 mapperów w treningu, 10 / 10 w teście;
- identyczność rytmu: 0,72 / 0,90 / 0,98 w powtórzeniach, 0,37 / 0,53 / 0,76 w linii bazowej;
- zysk 0,14 / 0,35 / 0,51, większy niż 0,15 w 85% map (test 90%), **T**;
- tory powtarzają się słabo: 0,15 / 0,30 / 0,42, zysk nad bazą +0,09 (test +0,01). Ludzie zmieniają układ torów przy tym samym rytmie, **S**.

### 2.5 Sekcje, przejścia, kiai, intro i outro (`05_sections.py`, `11_chords_kiai.py`)

Granice struktury pochodzą z audio (`structure_boundaries_ms`), mediana 8 granic na mapę.
Profil gęstości (`sections.boundary_profile_*`) to nuty w taktach −4…+3 względem granicy, podzielone przez medianę taktu utworu; podaję p50 po mapach.

| Granice | takty −4…−1 | takt granicy | takty +1…+3 |
|---|---|---|---|
| wszystkie (trening, n=79) | 1,00 | 1,00 | 1,00 |
| „w górę” (RMS po/przed ≥ 1,25; n=66) | 0,75–0,87 | 1,00 | 1,00 |
| „w dół” (≤ 0,8; n=60) | 1,00–1,10 | 0,80 | 0,75–0,79 |
| test: wszystkie / w górę / w dół | 1,00 / 0,75–0,90 / 1,00–1,23 | 1,00 / 1,00 / 0,86 | 1,00 / 1,00–1,20 / 0,80–0,92 |

- **Na granicy sekcji jest nuta:** `sections.boundary_note_share` 0,70 / 1,00 / 1,00 (≥ 0,7 w 71/79 i 18/20), **T**. Akord: 0,12 / 0,43 / 0,79 granic (**S/T**). Pusty ostatni beat przed granicą: 0 / 0,17 / 0,40 (test 0,11).
- **Wejście kiai:** nuta na 99% wejść (w 70/71 map na każdym), akord na 72%. Test: 96% / 75%.
- **Bez narastania przed granicą:** ostatni takt przed granicą ma tyle nut, co 3 wcześniejsze (p50 1,00; test 1,05). Przed granicą „w górę” gęstość jest niższa (0,75–0,87), bo niższa jest głośność, a od taktu granicy wraca do mediany.
- **Po granicy „w dół”** gęstość spada do 0,75–0,80 (test 0,80–0,92), **T**.
- **Gęstość a głośność:**
- kiai 1,00 / 1,22 / 1,59 gęstości poza kiai (≥ 1 w 62/71 map i 20/20), **T**;
- korelacja nut na takt z RMS: −0,00 / 0,32 / 0,69; akordów na takt z RMS: −0,16 / 0,15 / 0,50.
- **Intro i outro** (**S**): pierwsze 4 takty mają 0,37 / 0,88 / 1,19 mediany taktu, ostatnie 0,16 / 0,83 / 1,25. Pierwsza nuta pada 0,21 / 0,90 / 4,6 s od startu pliku, zwykle razem z pierwszym dźwiękiem.

### 2.6 Pauzy, odpoczynek, kontrast

- Pauzy ≥ 2 beaty: 0 / 2,2 / 10,3 na minutę, czyli 0 / 3,7 / 15,8% czasu (test 0 / 3,0 / 14,7 na minutę).
- Pauzy ≥ 4 beaty: 0 / 0,28 / 1,84 na minutę. Pauzy ≥ 8 beatów ma tylko 8/79 map (test 4/20). Najdłuższa pauza: 1,5 / 4 / 8 beatów.
- **Gdzie wypadają pauzy ≥ 4 beaty** (`rest_context`; 40 map treningu, 33 mapperów):
- w treningu w cichej muzyce: udział głośnych pauz p50 0 (p90 1), RMS 0,21 / 0,43 / 0,59; przy granicy sekcji 62%;
- w teście (tylko 8 map) głośniej: udział 0,62, RMS 0,53;
- tendencja potwierdza się więc tylko częściowo.
- Puste takty 0 / 1,7 / 7,8%; CV nut na takt 0,23 / 0,32 / 0,50; kontrast bloków 4-taktowych p90/p10 1,31 / 1,76 / 3,82.
- Obraz ludzi to ciągły puls z rzadkimi przerwami:
- pauzy są krótkie i rzadkie (**T**);
- długie przerwy są stylem (**S**), częstszym w electronic;
- kontrast gęstości idzie za głośnością (2.5).

## 3. Gatunki (`06_genres.py`)

**Liczebność grup.**
- Trening: anime 19 map (18 mapperów), electronic 19 (17), video game 17 (14), pop 14 (14).
- Pozostałe gatunki to 10 map w 8 gatunkach: **za mało do uogólnień**.
- W teście grupy mają 4–6 map, więc test sprawdza tylko kierunek różnicy.

**Metoda.** Kruskal-Wallis na surowych wartościach i na resztach po regresji na log BPM, bo electronic jest szybsze (BPM p50: anime 170, electronic 200, video game 185, pop 164).

**Wspólne dla gatunków** (różnice nieistotne):
- gęstość (nps p50 3,29–3,56) i beaty z nutą (0,76–0,83);
- akordy i ich udział na beatach;
- holdy (udział 0,11–0,15, puszczenie w następnej chwili ≥ 0,96);
- tryle (8,2–10,2 serii na minutę), równowaga rąk w oknach 4 taktów (po kontroli BPM p = 0,20);
- nuta na granicy (0,89–1,00), pusty ostatni beat (0,17–0,25), gęstsze kiai (1,14–1,35);
- powtarzanie rytmu.

**Zależne od gatunku:**

| Cecha | anime | electronic | video game | pop | p (KW) / p po BPM | Test (kierunek) |
|---|---|---|---|---|---|---|
| chwile na onsecie wokalu (stem) | 0,42 | 0,17 | 0,33 | 0,35 | < 0,001 / 0,001 | tak (0,30 / 0,17 / 0,30 / 0,40) |
| pauzy ≥ 2 beaty / min | 0,7 | 8,0 | 2,2 | 1,7 | 0,012 / 0,037 | tak (0,7 / 8,0 / 4,3 / 0,4) |
| półbeaty z nutą | 0,33 | 0,12 | 0,16 | 0,18 | 0,004 / 0,10 | częściowo (0,32 / 0,18 / 0,14 / 0,26) |
| `gap_share.1/2` | 0,32 | 0,12 | 0,20 | 0,31 | 0,021 / 0,39 | częściowo |
| `on_beat_share` | 0,71 | 0,84 | 0,81 | 0,82 | 0,037 / 0,14 | tak (0,72 / 0,81 / 0,85 / 0,75) |
| najdłuższa pauza (beaty) | 3,0 | 4,0 | 4,0 | 3,75 | 0,041 / 0,18 | tak (electronic najdłuższe) |

Wnioski:
- W anime i pop ludzie częściej idą za wokalem. To jedyna różnica, która przetrwała kontrolę BPM.
- Electronic ma więcej krótkich przerw (dropy, breaki): to styl gatunku.
- Różnice w użyciu 1/2 wynikają głównie z BPM.
- Każda reguła **Z** i **T** z pkt 2 obowiązuje w każdym z czterech dużych gatunków.

## 4. Ranking Criteria i poradniki a dane

RC zakłada ok. 180 BPM i metrum 4/4 (`Ranking_criteria_osu_mania.md`, sekcja Easy; `Ranking_criteria_Scaling_BPM.md`).

| Wytyczna | Dane (trening; test) | Ocena |
|---|---|---|
| Bez kolejnych 1/4 i szybszych | brak serii 1/4 w 76/79 i 19/20; wyjątki tylko przy 100–130 BPM | zgodne, także ze skalą BPM |
| „Mostly 1/1, occasional 1/2” | odstępy 1/1 61%, 1/2 22% (p90 48%); przy < 150 BPM 1/2 to 34% | zgodne |
| „Avoid more than 5 consecutive 1/2” | p50 = 5; > 5 w 21/79 map (21 mapperów), przy 150–210 BPM p90 6–11; test 7/20 | **sprzeczne w ~27% map**: to orientacyjna granica |
| Bez akordów w seriach 1/2 | `chords_in_half_runs_per_min` = 0 w 64/79, p90 0,61 na minutę | zgodne (tendencja) |
| Akordy ≤ 2 nuty, holdy w ≤ 2 torach | 99/99; najwyżej 2 holdy naraz | zgodne (twarda zasada) |
| Hold ≥ 1 beat | holdy < 0,95 beatu: 0 / 0 / 0,05 (≤ 5% w 71/79); holdy ½-beatowe w 8 mapach | zgodne z nielicznymi wyjątkami |
| Puszczenia ≥ 1 beat od siebie | 74/79 | zgodne |
| Bez obiektów w trakcie holda 1/1 („fine at beginning or end”) | holdy 1-beatowe z nutą tylko w 4/70 map; puszczenie w następnej chwili 98%; dłuższe holdy z nutami w 22/67 map | zgodne z literą wytycznej. „Obiekt na końcu” to ludzka norma |
| „Every note should correlate to a sound” | chwile bez dźwięku 0 / 1,3 / 6,0%; 33% beatów bez onsetu ma nutę | zgodne z wyjątkiem „consistent, predictable snap” |
| Breaki tylko w bardzo spokojnych częściach | pauzy ≥ 8 beatów w 8/79; pauzy ≥ 4 beaty w treningu w cichej muzyce, w teście częściej w głośnej | zgodne kierunkowo |
| HP, OD ≤ 7 | wszystkie ≤ 7 | bez znaczenia dla tej gry |
| Skala BPM (120 łagodniej, ≥ 240 bez 1/2) | nuty/beat 1,55 → 0,88, nps prawie stałe; 1/2 maleje z BPM; przy 284 BPM 0 odstępów 1/2 | zgodne; dane precyzują: stałe ok. 3,3 nuty/s i najdrobniejszy podział 1/2 do ok. 240 BPM |
| Kiai: „typically more challenging” | gęstość 1,22×, beaty z nutą 94% vs 77%, akord na 72% wejść | zgodne |

Poradnik osu!mania (akapit „Easy”) a dane:
- „We don't use any 1/4 pattern, even 1/2 should be used carefully”: zgodne.
- „Use chords only to emphasise the beginning or the end of a part”: **częściowo sprzeczne**. Akordy stoją na 72% wejść kiai i 43% granic, ale 35% akordów jest na zwykłych beatach, a w 13/79 map akordy to > 25% chwil.
- „Make sure you always balance the hands”: zgodne. Ręce są równe także w oknach 4 taktów.
- „Use a lot of LNs for the long sounds”: **sprzeczne z większością map**. Mediana udziału holdów to 13%, a holdy trwają zwykle 1 beat, niezależnie od długości dźwięku.
- „Do not use single notes while having a LN”: zgodne dla holdów 1-beatowych. Dłuższe holdy z nutami w środku to styl części mapperów.
- „Second beat louder, could map a chord”: akordy stoją raczej na downbeatach (23%) niż na pozostałych beatach (6%).
- „Keep it below 1,5★”: mediana 1,44★.

**Przenieść do gry:** puls 1/1, ograniczone 1/2, akordy ≤ 2, czyste holdy kończone w następnej nucie, równe ręce.

**Zaadaptować:**
- HP/OD, SV i normalizacja przewijania nie mają odpowiednika w grze.
- Brak hitsoundów: w grze akord jest tylko akcentem wizualnym i fizycznym.
- Kiai trzeba zastąpić strukturą wykrytą z audio.
- Nowicjusz z Discorda może potrzebować mniej niż 3,4 nuty/s. Gęstość należy obniżać po ludzku: mniej 1/2 i rzadsze beaty w cichych częściach, ale nie losowe dziury w pulsie.

## 5. Algorytm a ludzie na zbiorze testowym (`07_algo_vs_human.py`)

20 utworów, 20 par. Kolumna „algo > ludzie” to liczba par, w których generator ma większą wartość; p to test Wilcoxona par.

**Gęstość i rytm**

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| nuty/s | 2,72 / 3,64 / 4,40 | 1,43 / 1,87 / 2,41 | 1/20 | < 0,001 |
| nuty/beat | 0,86 / 1,19 / 1,42 | 0,45 / 0,68 / 0,82 | 1/20 | < 0,001 |
| nuty/s w oknie 2 s, p90 | 3,95 / 4,50 / 5,50 | 2,00 / 2,50 / 3,00 | 1/20 | < 0,001 |
| beaty z nutą (`coverage.beat`) | 0,68 / 0,86 / 0,92 | 0,22 / 0,36 / 0,56 (w ±25 ms: p50 0,43) | 0/20 | < 0,001 |
| beaty z nutą w kiai / poza kiai | 0,83 / 0,97 / 1,00 · 0,52 / 0,79 / 0,89 | 0,21 / 0,40 / 0,72 · 0,19 / 0,35 / 0,51 | 0/20 · 0/20 | < 0,001 |
| półbeaty z nutą | 0,11 / 0,19 / 0,32 | 0,00 / 0,05 / 0,16 | 2/20 | < 0,001 |
| downbeaty z nutą | 0,77 / 0,95 / 1,00 | 0,05 / 0,35 / 0,71 | 0/20 | < 0,001 |
| odstępy 1/1 | 0,47 / 0,61 / 0,77 | 0,01 / 0,35 / 0,58 | 3/20 | < 0,001 |
| odstępy 1/2 | 0,04 / 0,28 / 0,38 | 0,00 / 0,00 / 0,09 | 0/20 | < 0,001 |
| odstępy 2-beatowe | 0,00 / 0,03 / 0,14 | 0,12 / 0,26 / 0,81 | 19/20 | < 0,001 |
| najdłuższa seria 1/2 | 2 / 5 / 9,9 | 0 / 0 / 3,1 | 0/20 | < 0,001 |
| najdłuższa seria 1/1 | 7,8 / 24 / 49 | 2 / 8 / 12 | – | – |
| najkrótszy odstęp | 135 / 162 / 198 ms | 214 / 286 / 327 ms | 19/20 | < 0,001 |
| chwile poza siatką 1/8 i 1/6 człowieka | 0 / 0 / 0 | 0,07 / 0,22 / 0,37 | 20/20 | < 0,001 |

**Akordy**

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| akordy (`chord_share`) | 0,01 / 0,16 / 0,22 | 0,00 / 0,07 / 0,13 | 5/20 | 0,016 |
| akordy na zmapowanych beatach | 0,01 / 0,19 / 0,26 | 0,00 / 0,06 / 0,12 | 5/20 | 0,007 |
| akordy na downbeacie / poza beatem | 0,34 / 0,49 / 1,00 · 0 / 0,02 / 0,14 | 0 / 0,06 / 0,80 · 0 / 0,29 / 0,64 | 3/16 · 12/16 | 0,005 · 0,002 |
| akordy 2-nutowe na obie ręce | 0,23 / 0,49 / 0,67 | 0,88 / 1,00 / 1,00 | 16/16 | < 0,001 |

**Holdy**

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| udział holdów | 0,03 / 0,10 / 0,25 | 0,18 / 0,21 / 0,23 | 16/20 | < 0,001 |
| długość holda, p50 (beaty) | 1,00 / 1,00 / 2,00 | 1,96 / 2,00 / 4,00 | 16/18 | < 0,001 |
| udział holdów ≥ 1,5 beatu | 0,03 / 0,22 / 0,68 (trening) | 0,80 / 0,99 / 1,00 | – | – |
| holdy z nutą w środku | 0,00 / 0,00 / 0,09 | 0,50 / 0,73 / 0,93 | 18/18 | < 0,001 |
| nuta w środku: holdy ~1 beat / ≥ 1,5 beatu | 0 / 0 / 0 · 0 / 0 / 0,33 | 0,08 / 0,30 / 0,50 · 0,56 / 0,80 / 0,93 | 6/8 · 18/18 | 0,03 · < 0,001 |
| puszczenie w chwili następnej nuty | 0,93 / 0,99 / 1,00 | 0,17 / 0,35 / 0,49 | 0/18 | < 0,001 |
| hold startuje na beacie | 0,74 / 0,95 / 1,00 | 0,29 / 0,68 / 0,85 | 0/18 | < 0,001 |
| głowa holda w akordzie | 0 / 0,07 / 0,40 | 0 / 0 / 0 | 0/18 | 0,002 |
| puszczenie na beacie | 0,83 / 0,97 / 1,00 | 0,21 / 0,33 / 0,52 | 0/18 | < 0,001 |

**Tory, ręce, tryle**

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| tory 1+2 (środek) | 0,48 / 0,51 / 0,56 | 0,48 / 0,63 / 0,78 | 17/20 | 0,001 |
| najsłabszy tor ma ≥ 19% nut | 20/20 map | 7/20 | – | – |
| nierównowaga rąk w 4 taktach, p50 / p90 | 0,02 / 0,03 / 0,05 · 0,05 / 0,07 / 0,12 | 0,05 / 0,08 / 0,11 · 0,12 / 0,17 / 0,22 | 18/20 · 19/20 | < 0,001 |
| mapy z oknem nierównowagi > 0,2 | 1/20 | 12/20 | – | – |
| trójki x-y-x (`trill_share`) | 0,04 / 0,08 / 0,18 | 0,11 / 0,23 / 0,31 | 17/20 | < 0,001 |
| tryle ≤ 1 beat na minutę | 3,9 / 11,6 / 21,3 | 0 / 4,5 / 10,1 | 5/20 | 0,004 |
| ten sam tor (pojedyncze nuty) / minijacki | 0 / 0,03 / 0,11 · 0,01 / 0,05 / 0,12 | 0,04 / 0,11 / 0,25 · 0,05 / 0,12 / 0,33 | 17/20 · 18/20 | 0,001 |
| entropia wzorców 4 (bity) | 6,16 / 7,20 / 7,62 | 6,14 / 6,66 / 6,93 | 5/20 | 0,007 |

**Pauzy i struktura**

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| pauzy ≥ 2 beaty na minutę | 0 / 3,0 / 14,7 | 6,6 / 15,0 / 26,2 | 17/20 | < 0,001 |
| pauzy ≥ 2 beaty, udział czasu | 0 / 0,04 / 0,18 | 0,09 / 0,20 / 0,33 | 17/20 | 0,002 |
| pauzy ≥ 8 beatów na minutę | 0 / 0 / 0,45 | 0 / 0 / 0 | 1/20 | 0,14 |
| pauzy ≥ 4 beaty: udział w głośnej muzyce / RMS | 0,33 / 0,62 / 1,00 · 0,53 (n=8) | 0,72 / 1,00 / 1,00 · 0,72 (n=15) | 3/5 · 5/5 par | 0,25 · 0,06 |
| kontrast 4 taktów p90/p10 | 1,36 / 1,72 / 2,80 | 1,42 / 1,71 / 1,90 | 10/20 | 0,26 |
| gęstość w kiai / poza kiai | 1,06 / 1,23 / 1,57 | 0,85 / 0,98 / 1,19 | 4/20 | < 0,001 |
| korelacja nut na takt z RMS | −0,05 / 0,36 / 0,55 | −0,13 / 0,05 / 0,30 | 5/20 | 0,006 |
| korelacja akordów na takt z RMS | −0,12 / 0,14 / 0,47 | −0,19 / 0,05 / 0,29 | 6/16 | 0,13 |
| granice sekcji z nutą (±25 ms) | 0,74 / 1,00 / 1,00 | 0,12 / 0,41 / 0,81 | 0/20 | < 0,001 |
| granice sekcji z akordem | 0,11 / 0,40 / 0,72 | 0 / 0 / 0,11 | 1/20 | < 0,001 |
| pusty ostatni beat przed granicą | 0 / 0,11 / 0,34 | 0,14 / 0,35 / 0,81 | 15/20 | 0,002 |
| gęstość po/przed granicą „w dół” | 0,35 / 0,77 / 1,27 | 0,69 / 1,02 / 1,58 | 12/16 | 0,016 |
| wejścia kiai z nutą / z akordem (p50 po mapach) | 1,00 / 1,00 / 1,00 · 0,23 / 1,00 / 1,00 | 0 / 0,50 / 1,00 · 0 / 0 / 0,06 | 0/20 · 0/20 | < 0,001 |
| wejścia kiai, wszystkie 68 łącznie: nuta / akord | 96% / 75% | 41% / 4% | – | – |
| rytm w powtórzeniach muzyki | 0,76 / 0,90 / 0,96 | 0,14 / 0,31 / 0,58 | 0/16 | < 0,001 |
| rytm: powtórzenie − linia bazowa | 0,12 / 0,33 / 0,46 | −0,02 / 0,16 / 0,36 | 5/16 | 0,025 |
| tory w powtórzeniach | 0,06 / 0,27 / 0,40 | 0,26 / 0,52 / 0,70 | 13/16 | 0,004 |

**Dźwięk pod nutą i zgodność z człowiekiem**

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| chwile bez dźwięku | 0,00 / 0,01 / 0,04 | 0,01 / 0,03 / 0,09 | 15/20 | 0,002 |
| recall silnych werbli / stóp | 0,36 / 0,58 / 0,73 · 0,18 / 0,38 / 0,72 | 0,20 / 0,28 / 0,45 · 0,12 / 0,26 / 0,37 | 1/20 · 3/20 | < 0,001 |
| pierwsza nuta | 0,35 / 0,96 / 4,9 s | 1,55 / 1,77 / 2,41 s | 17/20 | 0,06 |
| `versus_human`: precision / recall (±40 ms) | – | 0,55 / 0,84 / 0,91 · 0,32 / 0,43 / 0,61 | – | – |
| `versus_human`: te same tory na dopasowanych chwilach | – | 0,23 / 0,31 / 0,36 | – | – |
| `versus_human`: przesunięcie od siatki, p50 / udział \|off\| > 10 ms | – | −8,0 / −2,5 / +0,5 ms · 0,05 / 0,14 / 0,34 | – | – |

**Według gatunku** (test; p50 ludzie / p50 algorytm). Grupy mają 4–6 utworów, novelty 1, więc tabela jest tylko opisem.

| Metryka | anime (5) | electronic (6) | video game (4) | pop (4) | novelty (1) |
|---|---|---|---|---|---|
| nuty/s | 3,85 / 2,29 | 3,13 / 1,95 | 3,30 / 1,90 | 3,83 / 1,67 | 3,43 / 1,62 |
| półbeaty z nutą | 0,32 / 0,01 | 0,18 / 0,06 | 0,14 / 0,10 | 0,26 / 0,03 | 0,13 / 0,05 |
| odstępy 1/2 | 0,36 / 0,00 | 0,28 / 0,00 | 0,19 / 0,00 | 0,34 / 0,00 | 0,23 / 0,00 |
| downbeaty z nutą | 0,93 / 0,45 | 0,93 / 0,18 | 0,90 / 0,41 | 0,98 / 0,48 | 0,98 / 0,04 |
| holdy z nutą w środku | 0,00 / 0,71 | 0,04 / 0,77 | 0,03 / 0,70 | 0,03 / 0,61 | 0,00 / 0,90 |
| puszczenie w następnej chwili | 1,00 / 0,33 | 1,00 / 0,37 | 0,96 / 0,36 | 0,96 / 0,19 | 1,00 / 0,57 |
| pauzy ≥ 2 beaty na minutę | 0,7 / 16,2 | 8,0 / 15,0 | 4,3 / 13,9 | 0,4 / 14,4 | 0,0 / 10,5 |
| gęstość w kiai / poza kiai | 1,22 / 0,92 | 1,39 / 1,16 | 1,26 / 0,97 | 1,16 / 1,05 | 1,06 / 0,96 |
| granice sekcji z nutą | 1,00 / 0,56 | 0,94 / 0,14 | 0,90 / 0,50 | 1,00 / 0,48 | 1,00 / 0,20 |
| wejścia kiai z akordem | 1,00 / 0,00 | 0,62 / 0,00 | 0,90 / 0,00 | 1,00 / 0,00 | 1,00 / 0,00 |
| rytm w powtórzeniach | 0,93 / 0,39 | 0,90 / 0,30 | 0,78 / 0,43 | 0,88 / 0,33 | 0,97 / – |
| chwile na onsecie wokalu | 0,30 / 0,33 | 0,17 / 0,15 | 0,30 / 0,25 | 0,40 / 0,43 | 0,30 / 0,18 |

Generator odstaje podobnie w każdym gatunku.
- Jedyne, co mu wychodzi, to podążanie za wokalem w anime i pop (`vocalLeads`).
- Brak 1/2 najbardziej szkodzi w anime i pop, gdzie ludzie używają go najwięcej.
- Granice sekcji gubi najczęściej w electronic: 0,14 vs 0,94.

**Według trybu śledzenia tempa przez generator** (p50 ludzie / algorytm):

| Tryb | n | nuty/s | beaty z nutą | półbeaty z nutą | odstępy 1/2 | downbeaty z nutą | pauzy ≥ 2 beaty / min |
|---|---|---|---|---|---|---|---|
| zgodne tempo | 7 | 3,56 / 1,99 | 0,86 / 0,53 | 0,22 / 0,04 | 0,33 / 0,00 | 0,96 / 0,60 | 0,8 / 7,5 |
| zgodne po podwojeniu (`foldFactor` 2) | 4 | 3,15 / 2,09 | 0,71 / 0,31 | 0,19 / 0,17 | 0,21 / 0,00 | 0,78 / 0,30 | 2,0 / 19,2 |
| połowa tempa | 8 | 3,85 / 1,63 | 0,87 / 0,33 | 0,16 / 0,02 | 0,21 / 0,00 | 0,94 / 0,09 | 6,8 / 20,6 |
| bez siatki (`NO_TIMING`) | 1 | 3,24 / 2,20 | 0,86 / 0,22 | 0,17 / 0,08 | 0,33 / 0,00 | 0,99 / 0,22 | 7,9 / 7,3 |

## 6. Problemy algorytmu na Easy (od największego wpływu)

### 1. Rwany puls: za mało nut i nieregularnie pomijane beaty

- **Co jest nie tak.** Generator gra mniej więcej co drugi beat, ale pomija beaty bez związku z muzyką. Gubi przy tym downbeaty i zostawia 2-beatowe dziury.
- **Dowód (test, 20 par):**
- gęstość: 1,87 vs 3,64 nuty/s (algo wyżej w 1/20 par), 0,68 vs 1,19 nuty/beat;
- `coverage.beat` 0,36 vs 0,86 (0/20); w ±25 ms 0,43. Downbeaty z nutą 0,35 vs 0,95 (0/20);
- w kiai 0,40 vs 0,97 beatów z nutą;
- odstępy 2-beatowe 0,26 vs 0,03 (19/20). W 8 utworach śledzonych w połowie tempa to 52–88% odstępów, a 1/1 tylko 0–15%: generator gra tam półnuty;
- najdłuższa seria 1/1: 8 vs 24 nuty;
- w najgłośniejszej tercji utworu ludzie mają nutę na 96% beatów, generator na 55%;
- `versus_human`: precision 0,84, recall 0,43;
- pod 95% ludzkich nut plugin ma zdarzenie perkusji, więc DSP te beaty widzi, a odrzuca je ścieżka Easy.
- **Klasa.** T. Nuty/beat ≥ 0,85 w 71/79 map (60 mapperów) i 18/20. `coverage.beat` ≥ 0,6 w 74/79 i 19/20, u generatora w 1/20.
- **Miejsce w kodzie:**
1. `patterns.js:drumEvents` (l. 113–117): poziom 0 dostaje tylko uderzenie na beacie o sile ≥ mediana frazy. Easy ma `maxLevel: 0` (`difficulty.js`, l. 53), a `difficultyFilter.js:applyDifficulty` odrzuca resztę. Ludzie mapują 75% słabszych beatów.
2. `difficultyFilter.js:densityHolds` (l. 199–212): okno 2 s mieści najwyżej floor(maxNps·2·max(dolna_moc, moc) + 1) chwil. `maxNps` to 3,0 razy ruchliwość, przy suficie 3,5 (`difficulty.js`, l. 39–40), a moc to energia razy intensywność (`intensity.js`, 0,6–1,3). Daje to 4–7 chwil na 2 s, a ludzkie okna p90 mają 9 nut.
3. Połowa tempa (problem 3): „na beacie” oznacza wtedy co drugi beat człowieka.
4. `rests.js:fillRests` wstawia w pauzę pojedynczą nutę.
- **Potwierdzenie na teście:** tak.
- **Wpływ: wysoki.** Beat to pierwsza rzecz, którą wystukuje nowicjusz.
- **Adaptacja z osu!.** Docelowa gęstość gry może być niższa niż 3,4 nuty/s. Najpierw należy usuwać 1/2 i beaty w cichych fragmentach, a beaty i downbeaty w głośnych zostawić. Czy to jeszcze za trudne, rozstrzygnie test z graczem.

### 2. Brak rytmu 1/2 powyżej ~150 BPM i w utworach w połowie tempa

- **Dowód:**
- odstępy 1/2: 0,00 vs 0,28 (0/20), zero w 17 z 20 utworów;
- wyjątki to 1784295 (130 BPM, 0,19), 923488 (130 BPM, 0,10) i 1000722 (0,09; efekt ludzkiej siatki 77 BPM w części utworu);
- najdłuższa seria 1/2: 0 vs 5; półbeaty z nutą 0,05 vs 0,19; najkrótszy odstęp 286 vs 162 ms;
- przy zgodnym tempie, w utworach powyżej 150 BPM, 1/2 również wynosi 0,00;
- u ludzi 18% odstępów (p90 43%) jest krótszych niż 200 ms, a najkrótszy odstęp to 1/2 beatu w każdym przedziale BPM.
- **Klasa.** T: 1/2 stanowi ≥ 7% odstępów w 70/79 map. Najdrobniejszy podział 1/2 to Z.
- **Miejsce w kodzie:**
1. Easy `minNoteGapMs: 200` (`difficulty.js`, l. 51). Powyżej 150 BPM 1/2 beatu to mniej niż 200 ms, więc odpada w `difficultyFilter.js:fits` (l. 166) i ponownie w `enforceFloors` (l. 377).
2. `difficultyFilter.js:feltBeatMs` (l. 21): `gapBeats: 1/2` jest liczone w beatach „odczuwanych”. W 4 utworach z `foldFactor` 2 i w 8 utworach w połowie tempa daje to minimalny odstęp 0,9 beatu człowieka.
3. `patterns.js`: na półbeacie poziom 0 może dostać tylko lead (`tonalEvents`).
- **Potwierdzenie na teście:** tak; 1/2 jest w 19/20 map testowych.
- **Wpływ: wysoki.** Giną synkopy wokalu i podwójne uderzenia, a razem z problemem 1 powstaje mapa z samych półnut.
- **Adaptacja.** Próg powinien być wyrażony w beatach (1/2), z dolną granicą w ms bliżej 130 niż 200. Ilość 1/2 należy zmniejszać ze wzrostem BPM (33% przy < 150 BPM, 14% przy ≥ 210, brak przy 284). Serie zwykle ≤ 5 nut.

### 3. Siatka generatora: połowa tempa, zła faza taktu, przesunięcie o pół beatu, brak siatki

- **Dowód** (`songs/<set>.json` → `algo_beat_tracking`, `versus_human`):
- połowa tempa w 8/20 utworów: 190, 190, 190, 200, 200, 220, 230 i 284 BPM; `chart.bpm` to np. 95 zamiast 190;
- downbeaty zgodne z ludzkimi w < 30% w 13/19 utworów z siatką, ≥ 90% tylko w 3;
- faza przesunięta o pół beatu w 4 utworach: 1000722, 1277503, 1570640, 310607. W 1570640 precision wynosi 0,25;
- 1 utwór bez siatki (2270163);
- inne metrum niż 4/4 w 1697477, zmienne BPM w 3/20 utworów;
- skutki dalej w łańcuchu: akordy na ludzkim downbeacie 6% vs 49% i poza beatem 29% vs 2%; 22% chwil poza siatką 1/8 i 1/6 człowieka;
- przesunięcie od siatki człowieka (`versus_human.grid_offset_ms`): p50 po utworach −2,5 ms (p10 −8,0), \|off\| > 10 ms w 14% chwil (5–34%), w 808872 aż −10,1 ms.
- **Klasa.** Ludzie są zawsze na swojej siatce (Z). Ten problem to przyczyna problemów 1, 2, 4 i 5, a nie osobna reguła mapowania.
- **Miejsce w kodzie:**
1. Plugin `TempoEstimator.java`: `MAX_BPM = 200`, prior wokół `PRIOR_CENTRE_BPM = 120` (l. 12–13). `downbeatPhase` (l. 277) ustala jedną fazę mod 4 dla całego utworu.
2. `timing.js:foldTempo` (l. 37–44) podwaja tempo tylko poniżej 95 BPM i przy ≥ 8 silnych onsetach na beat. `buildTiming` (l. 117) przy pewności < 0,5 zwraca `NO_TIMING`; `halveBeats` (l. 88) dziedziczy fazę.
3. Zła faza trafia dalej do `difficultyFilter.js:slotRank`, `selectionOrder`, `thinChords` oraz `patterns.js:isBarStart` i `withChords`.
4. `generate.js:chartFrom` (l. 212): `bpm` liczony z mediany beatu skaluje prędkość spadania. To hipoteza do sprawdzenia w grze.
- **Wpływ: wysoki** w 12–13 z 20 utworów. Mapy grające na off-beacie (1570640) albo tylko na „dwa” i „cztery” (1277503) są po prostu złe. Przesunięcia o kilka ms mają niską wagę.
- **Adaptacja.** Oktawę tempa można wybierać tak, żeby dawała ok. 3 nuty/s, jak u ludzi. Zakres trackera musi sięgać ok. 300 BPM.

### 4. Holdy: za długie, z nutami w środku, puszczane poza beatem, w stałym udziale

- **Dowód (test):**
- 99% holdów generatora (p10 80%) trwa ≥ 1,5 beatu; u ludzi to 22% holdów (trening). Długość p50: 2,0 vs 1,0 beatu;
- holdy z nutą w środku 0,73 vs 0,00 (18/18), w tym holdy ~1-beatowe 0,30 vs 0 i holdy ≥ 1,5 beatu 0,80 vs 0;
- nuty drugiej ręki na beat holda: 0,31 vs 0;
- puszczenie w chwili następnej nuty 0,35 vs 0,99 (0/18); start na beacie 0,68 vs 0,95; puszczenie na beacie 0,33 vs 0,97;
- głowa holda w akordzie: 0 vs 0,07;
- udział holdów 0,21 (0,18–0,23) vs 0,10 (0,03–0,25), w 16/20 par wyższy u generatora i stały między utworami.
- Holdów krótszych niż 0,95 beatu nie ma u nikogo (`lt_1` 0 vs 0), więc nie ma tu żadnego problemu.
- **Klasa:**
- czyste holdy 1-beatowe: Z (66/70 map);
- puszczenie w następnej chwili: T (69/71);
- start na beacie: T (64/71);
- nuty w długich holdach: S (22/67 map);
- udział holdów: S.
- **Miejsce w kodzie:**
1. Easy `holdOtherHand: "spaced"` (`difficulty.js`, l. 58) i `holdSpacingBeats: 1` (l. 78): druga ręka gra w trakcie holda (`holds.js:spacedBlocked`). Nagłówek `holds.js` (l. 3) twierdzi, że na Easy jest „blocked”, więc komentarz i konfiguracja są niespójne.
2. `holds.js:addGapHolds` (l. 277–308): hold trwa do `next − gapAfterHold` (l. 292), czyli kończy się 200 ms (na tym samym torze 350 ms) przed następną nutą tej samej ręki albo po `GAP_MAX_BEATS = 2`. Puszczenie wypada więc zwykle poza siatką i nie razem z następną nutą, a do tego `GAP_MIN_BEATS = 1,25` z góry wyklucza holdy 1-beatowe.
3. `holds.js:planHolds` (l. 145) i `addSustainHolds` (l. 211): długość brana z trackera wysokości albo z odstępu do następnej nuty minus `minLaneGapMs`, bez przyciągania do beatu.
4. `holdMinBeats: 1` w połowie tempa oznacza 2 beaty człowieka.
5. Budżety `gapHoldShare: 0,3` i `maxHoldShare: 0,4` (`difficulty.js`, l. 80–81).
- **Potwierdzenie na teście:** tak.
- **Wpływ: wysoki.** RC uznaje nuty drugiej ręki w trakcie holda za umiejętność ponad poziom Easy, a losowe puszczenia nie mają oparcia w muzyce.
- **Adaptacja.** Gra ocenia puszczenie z oknem ×1,5, więc błąd mniej kosztuje, ale nadal brzmi niemuzycznie. Ludzki wzorzec „hold do następnej nuty” wymaga skoordynowania puszczenia z naciśnięciem. RC na to pozwala; czy nowicjusze tej gry dadzą radę, trzeba sprawdzić w grze.

### 5. Brak reakcji na strukturę: granice sekcji, kiai, spadki energii

- **Dowód (test):**
- granice sekcji z nutą 0,41 vs 1,00 (0/20); z akordem 0 vs 0,40 (1/20);
- pusty ostatni beat przed granicą 0,35 vs 0,11 (15/20);
- wejścia kiai: nuta 41% vs 96%, akord 4% vs 75% (68 wejść); per mapa p50: nuta 0,50 vs 1,00, akord 0 vs 1,00;
- gęstość w kiai 0,98× vs 1,23× (4/20), beaty z nutą w kiai 0,40 vs 0,97;
- po granicy „w dół” gęstość się nie zmienia: profil po granicy 1,00 vs 0,80–0,92, stosunek po/przed 1,02 vs 0,77 (12/16);
- korelacja nut na takt z RMS 0,05 vs 0,36 (5/20);
- spadek gęstości przed granicą „w górę” generator ma (0,83), ale wynika on tylko z cichszej muzyki.
- **Klasa.** T: nuta na granicy w 71/79 i 18/20 map; nuta na każdym wejściu kiai w 70/71; kiai gęstsze w 62/71 i 20/20.
- **Miejsce w kodzie:**
1. Żadna reguła nie daje nuty ani akordu na początku sekcji. `patterns.js:withChords` (l. 339) dodaje akcent tylko na `isBarStart`, czyli na downbeacie generatora albo na starcie frazy. `difficultyFilter.js:thinChords` (l. 261) zostawia akord tylko na downbeacie generatora przy sile ≥ 0,8 i energii ≥ 0,7 (`difficulty.js`, l. 65).
2. Sekcje pochodzą wyłącznie z energii (plugin `Highlight.sections`), a frazy mają stałe 16 beatów.
3. `intensity.js` nie przebija się przez progi z problemów 1 i 2.
4. `rests.js:fillRests` i `pulsePowerFloor` wypełniają ciche fragmenty.
- **Potwierdzenie na teście:** tak.
- **Wpływ: średnio-wysoki.**
- **Adaptacja.** W grze nie ma kiai, więc refren trzeba wykryć z audio. Ludzki efekt refrenu na Easy to nuta na każdym beacie i akord na pierwszym downbeacie.

### 6. Kontrast i pauzy: dużo krótkich dziur w głośnej muzyce, brak prawdziwych przerw

- **Dowód:**
- pauzy ≥ 2 beaty: 15,0 vs 3,0 na minutę (17/20), 0,20 vs 0,04 czasu;
- pauzy ≥ 8 beatów: 0 w 19/20 chartów, u ludzi w 4/20 map;
- pauzy ≥ 4 beaty wypadają w głośnej muzyce: udział głośnych 1,00 (0,72–1,00), RMS 0,72 (15 chartów). U ludzi w treningu udział 0, RMS 0,43 (40 map), w teście 0,62 / 0,53 (8 map);
- kontrast bloków 4-taktowych: 1,42–1,90 vs 1,36–2,80.
- **Klasa.** Rzadkie krótkie pauzy: T. Pauzy w cichych miejscach: T tylko w treningu, w teście słabiej. Długie przerwy: S.
- **Miejsce w kodzie:**
1. `rests.js:restsOf` (l. 61) i `fillRests` (l. 79): próg 2 × `beatMsOf`, czyli 4 beaty człowieka w połowie tempa. Wypełnienie to jedna nuta na rest, tylko na siatce `baseDiv`.
2. 2-beatowe odstępy z połowy tempa są poniżej progu, więc nie są wypełniane.
3. Żadna reguła nie robi celowej przerwy w cichym fragmencie: za ciszę uchodzi tylko energia < 0,08.
- **Potwierdzenie na teście:** krótkie pauzy tak; położenie długich pauz częściowo.
- **Wpływ: średni.**

### 7. Powtórzenia: rytm się nie powtarza, gdy powtarza się muzyka, a tory tak

- **Dowód** (`repetition.*` na skwantowanych pozycjach):
- rytm w powtórzeniach muzyki 0,31 (0,14–0,58) vs 0,90 (0/16);
- zysk nad linią bazową 0,16 vs 0,33 (5/16);
- tory w powtórzeniach 0,52 vs 0,27 (13/16).
- Po kwantyzacji wartości generatora prawie się nie zmieniły (rytm 0,29 → 0,31), więc to nie artefakt drgania siatki.
- **Klasa.** T: zysk > 0,15 w 85% map z ≥ 3 parami (41 mapperów), w teście 90%.
- **Miejsce w kodzie:**
1. `generate.js:copiedRepeat` (l. 71) i `repeats.js:copyRepeat` kopiują tylko frazy, które plugin uznał za powtórzenia (16 beatów, podobieństwo ≥ 0,85), i gubią przy tym nuty bez zdarzenia w ±60 ms.
2. Pozostałe frazy są mapowane od nowa z progu mediany frazy (`patterns.js:drumEvents`) i limitu gęstości, więc za każdym razem inaczej.
3. `barRepeats.js:repeatBarLanes` przenosi tory, a nie rytm.
- **Potwierdzenie na teście:** tak.
- **Wpływ: średni.** Gracz rozpoznaje refren po rytmie.

### 8. Ręce i wzorce: przeciążony środek, lokalna nierównowaga rąk, wolne przeskoki zamiast tryli, akordy tylko na obie ręce

- **Dowód:**
- tory 1+2 mają 0,63 vs 0,51 nut (17/20); najsłabszy tor ma ≥ 19% nut tylko w 7/20 chartów, u ludzi w 99/99;
- nierównowaga rąk w oknach 4 taktów: p50 0,08 vs 0,03 (18/20), p90 0,17 vs 0,07 (19/20); okna > 0,2 w 12/20 chartów vs 1/20 (w treningu 4/79). W skali całego utworu ręce są równe (0,51 vs 0,50);
- trójki x-y-x (`trill_share`) 0,23 vs 0,08, ale prawdziwych tryli (≤ 1 beat) generator ma mniej: 4,5 vs 11,6 serii na minutę (5/20). Jego x-y-x to wolne przeskoki co 2 beaty;
- ten sam tor między pojedynczymi nutami 0,11 vs 0,03; minijacki 0,12 vs 0,05, w odstępie 2 beatów;
- akordy na obie ręce 1,00 vs 0,49; entropia wzorców 6,66 vs 7,20 bita.
- **Klasa.** Równe tory: Z. Równe ręce w 4 taktach: Z/T (75/79, 19/20). Mało powtórzeń toru: T. Akordy jednoręczne: S.
- **Miejsce w kodzie:**
1. `patterns.js:hitsOf` (l. 65–78): stopa na torach 0/3, werbel i perc na 1/2 naprzemiennie (`seen[cls]++ % 2`). Werbel na „dwa” i „cztery” daje 1-2-1-2 co 2 beaty.
2. `CONTOUR_START_LANE = 1` w `patterns.js`.
3. `seams.js:balanceHands` odbija lustrzanie całą frazę, żeby wyrównać ręce w całym utworze, nie w krótkich oknach.
4. `difficultyFilter.js:thinChords` (l. 273) wymaga partnera akordu w drugiej ręce.
5. `spreadLanes` (l. 404).
- **Potwierdzenie na teście:** tak.
- **Wpływ: średnio-niski.** Kilka taktów jedną ręką i przeciążony środek męczą.
- **Adaptacja:** nie jest potrzebna, ergonomia 4K jest taka sama.

### 9. Początek utworu: stałe 1,5 s bez nut

- **Dowód.** Pierwsza nuta 1,55–2,41 s vs 0,35 / 0,96 / 4,9 s (17/20). Pierwsze 4 takty generatora mają 1,00× mediany, ludzi 0,88× (p10 0,37).
- **Klasa:** S.
- **Kod:** `LEAD_IN_MS = 1500` (`difficulty.js`, l. 10).
- **Wpływ: niski.** Bot może grać upload z innym początkiem, więc jakiś lead-in jest w grze uzasadniony.

## 7. Kandydaci do testów odsłuchowych i gry

Czasy podaję na osi audio map (mm:ss). Bot może grać inny upload, więc są przybliżone. Podgląd nut w oknie: `10_window.py <set> <od> <do>`.

1. **1894317, kessoku band – Seishun Complex (TV Size)**, 00:38–01:12 (anime, 190 BPM, generator w połowie tempa).
 - Na czterech wejściach kiai (00:40, 00:50, 01:00, 01:10) człowiek ma akord, generator nie ma żadnej nuty.
 - W 00:52–01:00 człowiek gra łańcuch 1/1 z 1-beatowymi holdami kończonymi w następnej nucie (ok. 30 chwil). Generator ma ok. 9 nut co 2–4 beaty, bez downbeatów.
2. **2224035, JINGBURGER – Konton Boogie**, 01:38–01:47 (pop, 190 BPM, połowa tempa).
 - Wejście kiai 01:41: człowiek daje akord, potem 1/1 z parami 1/2.
 - Generator ma 3 tapy i 2 holdy w 5 s.
3. **1570640, Lime – 8bit Voyager**, 00:30–00:36 i 01:24–01:34 (electronic, 182 BPM, tempo podwojone z 90,9).
 - Nuty generatora leżą na półbeatach człowieka, 5–14 ms wcześniej.
 - Precision 0,25 w całym utworze.
4. **1277503, Umeboshi Chazuke – Panic! Pop'n! Picnic! (2019 REMASTER)**, 01:59–02:06 (video game, 190 BPM, połowa tempa, 9 czerwonych linii).
 - Człowiek gra każdy beat, z akordami na „dwa” i „cztery”.
 - Generator gra tylko „dwa” i „cztery”, bez downbeatów. Jego holdy ok. 1,2 s mają po 2 nuty w środku.
5. **1697477, cosMo@BousouP – Hatsune Miku no Gekishou**, 02:16–02:24 (video game, 200 BPM, połowa tempa, metrum 3/4/6/7).
 - W ostatnim kiai (od 02:20) człowiek gra akord na każdym beacie.
 - Generator gra nutę co 2–3 beaty plus 1,2-sekundowe holdy z nutą w środku.
 - Warto też sprawdzić fragmenty ze zmianą metrum.
6. **923488, HyuN – Grin**, 00:42–00:50 (electronic, 130 BPM, tempo zgodne). Ten fragment izoluje problem holdów.
 - Pięć 2-beatowych holdów generatora ma po 1–2 nuty drugiej ręki w środku, puszczenia 7–18 ms od beatu.
 - Człowiek gra 1/1 z 1/2 i jednym holdem.
7. **1784295, Rokudenashi – Tada Koe Hitotsu**, 02:10–02:18 (pop, 130 BPM, utwór wokalny).
 - Człowiek gra 1/1 + 1/2 z akordami na „trzy” i 1-beatowymi holdami kończonymi w następnej nucie.
 - Generator gra mniej więcej co 2 beaty. Holdy kończą się 16–28 ms od beatu, 3 z 4 mają po 1–2 nuty w środku.
8. **2270163, ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasavitsa**, 01:58–02:04 (electronic, 185 BPM, bez siatki).
 - Nuty generatora leżą na pozycjach 1/4, holdy kończą się na 1/6–1/8.
 - Człowiek gra równe 1/1 + 1/2.
9. **808872, Kobaryo – Perfect Neglect**, 00:15–00:21 oraz wejścia kiai 00:56, 01:30, 02:07 (electronic, 230 BPM, połowa tempa).
 - Człowiek gra każdy beat, generator co drugi, ok. 10 ms za wcześnie (`grid_offset` p50 −10,1 ms).
 - Na wejściach kiai generator nie ma nuty. Pauz ≥ 2 beaty jest 48 na minutę.

## 8. Prośby o nowe metryki

Prośby z wersji v1 spełnione w metrykach v2:
- kwantyzacja `repetition.*`;
- `holds_context` i nowe progi `hold_short_share`;
- `chords_in_half_runs_per_min`;
- `coverage.*`;
- `kiai_start.*`;
- profile i pusty ostatni beat przy granicach;
- `versus_human`.

Niespełnione zostają:
1. **Pokrycie beatów w tercjach głośności** (`coverage.beat_loud`, `coverage.beat_quiet`, wg RMS utworu) oraz według siły uderzenia pluginu. To główna ludzka reguła wyboru: 94% beatów w głośnej tercji vs 62% w cichej. Na razie liczę ją ad hoc z tabel slotów (`02_slots.py`).
2. **Gęstość intro i outro**: nuty w pierwszych i ostatnich 4 taktach do mediany taktu utworu, opcjonalnie z opóźnieniem pierwszej nuty względem pierwszego silnego onsetu. Na razie ad hoc w `05_sections.py`.
3. **`coverage.*` dla generatora z tolerancją ±25 ms**, jako dodatkowa wersja obok obecnej. Obecna używa tolerancji źródła (10 ms), więc beaty trafione o 10–25 ms obok, czyli w oknie PERFECT gry, liczą się jako puste: 0,36 vs 0,43.

## 9. Ograniczenia

- **Co oznacza poziom.** Easy to Easy osu!mania dla graczy osu!. Dane mówią, jak mapuje człowiek, a nie co jest dobre dla nowicjusza z Discorda.
- **Mały test.** 20 utworów, po 4–6 na gatunek: porównania generatora według gatunków to tylko opis. Grupa „inne” (10 map) nie nadaje się do wniosków. `rest_context` ma w teście tylko 8 map ludzi i 5 par.
- **Charty generatora** powstały z audio z `.osz`. W grze plugin analizuje to, co faktycznie gra bot.
- **Metryki v2:**
- rytm generatora jest liczony na pozycjach skwantowanych do sklasyfikowanego punktu siatki;
- chwila sklasyfikowana jako 1/12 lub 1/16 (10–20 ms obok) zostaje tam przesunięta, więc część jego odstępów trafia do `other` (0,06 → 0,10), a 1/1 spada z 0,41 do 0,35;
- `coverage.*` używa tolerancji źródła (pkt 8.3);
- granice sekcji są liczone w ±25 ms;
- wybór dźwięków badam na `chosen`.
- **Granice struktury** pochodzą z detektora Foote'a. Kiai to znacznik mappera: ma go 71/79 map treningu i 20/20 testu.
- **Regresja logistyczna** łączy sloty wszystkich map i nie ma efektów losowych mappera; cechy są współliniowe. Wyniki są stabilne bez 5 oznaczonych zestawów (AUC zmienia się o ≤ 0,002).
- **Przyczyny w kodzie** wskazuję z kodu i z wzorca danych. Ilościowego rozkładu „ile nut gubi każdy mechanizm” nie liczyłem, bo wymagałoby to uruchamiania generatora z wyłączanymi regułami.
- **Popularność** map nie służy tu za miarę jakości.
- **Czego liczby nie potwierdzą:** wygody wzorców, czytelności holdów puszczanych razem z następną nutą dla nowicjusza ani wpływu prędkości spadania z `chart.bpm` w połowie tempa. To musi ocenić gracz (pkt 7).

## 10. Jak odtworzyć

Środowisko: Python z numpy, pandas, scipy, scikit-learn i statsmodels. Skrypty czytają wyłącznie dane Easy (metryki v2, tabele slotów z celem `chosen`) oraz `shared/data/songs/`. Wyniki zapisują do `mapping-analysis/levels/easy/out/`.

```bash
PY=/ścieżka/do/venv/bin/python bash mapping-analysis/levels/easy/run_all.sh
```

Całość trwa ok. 1 minuty. Wyjście każdego skryptu trafia do `out/<skrypt>.txt`, tabele do `out/*.csv`.

| Skrypt | Co liczy |
|---|---|
| `common.py` | ścieżki, wczytywanie (tylko dozwolone kolumny `corpus.csv`), kwantyle; `slots()` domyślnie podstawia cele `chosen`, `chosen_n_notes`, `chosen_hold_start` |
| `01_profile.py` | kwantyle wszystkich metryk: ludzie (trening, test) i algorytm (`out/profile_all.csv`) |
| `02_slots.py` | tabele slotów: pozycje, recall klas pluginu, detektorów i stemów, regresja logistyczna, pokrycie zdarzeniami, siła uderzenia a głośność, czułość bez oznaczonych zestawów |
| `03_density_bpm.py` | gęstość, podziały i `coverage.*` a BPM; kandydaci na twarde zasady (`out/limits.csv`) |
| `04_patterns_repetition.py` | tory, kroki, `trills.*`, `hand_balance_4bar`, `hand_by_class`, entropia, `repetition.*`; pary człowiek–algorytm |
| `05_sections.py` | oficjalne metryki sekcji, `kiai_start`, `rest_context`; intro i outro z tabel slotów |
| `06_genres.py` | gatunki: Kruskal-Wallis na surowych wartościach i po kontroli BPM, kierunek na teście |
| `07_algo_vs_human.py` | tabela algorytm vs ludzie (test) według gatunku, trybu śledzenia tempa i utworu, z `versus_human` |
| `08_holds_floors.py` | jaki ułamek ludzkich odstępów łamie stałe progi Easy generatora; dźwięk pod startem holda |
| `09_fragments.py` | `versus_human` na utwór i okna 4-taktowe do wyboru fragmentów (`out/fragment_windows.csv`) |
| `10_window.py` | podgląd nut w oknie, np. `python -I 10_window.py 1894317 00:52 01:00` |
| `11_chords_kiai.py` | akordy i holdy w kiai i poza nim, na downbeatach, w głośnych i cichych miejscach |

Skrypty `12_rc_checks.py` i `13_timing.py` z wersji v1 usunąłem. Zastąpiły je oficjalne `chords_in_half_runs_per_min` i `versus_human.grid_offset_ms`.