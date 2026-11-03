# Easy: jak mapują ludzie i czym różni się generator v19 (etap 2)

Poziom Easy = dyfficulty osu!mania 4K o SR w [0; 1,65) (`shared/levels.md`). Dane: 99 ludzkich map Easy
(79 trening, 20 test; 80 różnych mapperów dyfficulty (`easy_owners`), 83 hostów zestawów; w treningu 60 mapperów,
w teście 20 i żaden z nich nie występuje w treningu) oraz 20 chartów Easy generatora v19 dla utworów testowych.
Zasady ludzi wyprowadzam na treningu, sprawdzam na teście. Generator porównuję z ludźmi tylko na teście.
Wszystkie czasy są na osi zdekodowanego audio. Liczby w formacie p10 / p50 / p90 to kwantyle po mapach.
Skrypty i wyniki: `mapping-analysis/levels/easy/` (pkt 10).

Klasy wniosków: **Z** = twarda zasada (spełnia ją ≥ ~95% map), **T** = silna tendencja (~75–95% map),
**S** = styl mappera lub gatunku (rozrzut szeroki, brak wspólnej normy).

## 1. Podsumowanie

Ludzkie mapy Easy mają stały szkielet: nuta na prawie każdym beacie głośnych fragmentów (81% beatów, 90% downbeatów),
okazjonalne 1/2 (19% półbeatów, serie zwykle ≤ 5 nut), około 3,4 nuty/s niezależnie od BPM, równo obciążone tory,
holdy długości jednego beatu kończone w chwili następnej nuty i bez nut w trakcie, a na początku sekcji i kiai nutę,
często akord. Generator v19 daje na 20 utworach testowych mapy o połowę rzadsze (1,87 vs 3,64 nuty/s, 1 z 20 utworów
gęstszy niż człowiek). Ma nutę na 44% beatów i 35% downbeatów, nie ma żadnego 1/2 powyżej 150 BPM, a 26% jego odstępów
to 2 beaty (w 8 utworach śledzonych w połowie tempa 53–88%). Jego nuty w 84% leżą na nutach ludzi, ale pokrywają tylko 43%
ludzkich chwil, choć pod 95% ludzkich nut plugin wykrywa zdarzenie perkusji. Nuty gubią filtr Easy (poziom 0 = uderzenie
≥ mediana frazy), limit gęstości, sztywny odstęp 200 ms i błędy siatki (połowa tempa w 8/20 utworów, zła faza taktu
w 13/19). Holdy generatora są odwrotnością ludzkich: 73% ma w środku nutę drugiej ręki (ludzie 0%), trwają 2 beaty
zamiast 1, a 67% puszczeń wypada poza beatem. Generator nie reaguje też na strukturę utworu: nutę na granicy sekcji
ma 13% granic (ludzie 100%), akord na początku kiai 8% (ludzie 72%), gęstość w kiai 0,98× (ludzie 1,23×), a w powtórzeniach
muzyki powtarza tory zamiast rytmu. Reguły ludzi potwierdziły się na teście, gatunek zmienia głównie ilość 1/2 (przez BPM),
podążanie za wokalem i liczbę pauz. Liczby nie mówią jednak, czy mapa jest przyjemna; o tym rozstrzygną testy z graczami,
tym bardziej że docelowy gracz Easy tej gry może potrzebować mniejszej gęstości niż gracz osu! Easy.

## 2. Profil mapowania ludzi na Easy

### 2.1 Co ludzie mapują, a co pomijają (tabele slotów, `02_slots.py`)

Udział slotów z chwilą, po mapach (trening n=79, 60 mapperów; test n=20, 20 mapperów):

| Pozycja na siatce | Trening p10 / p50 / p90 | Test p50 | Klasa |
|---|---|---|---|
| beat | 0,62 / 0,81 / 0,93 | 0,86 | T |
| downbeat | 0,75 / 0,90 / 0,99 | 0,95 | T |
| inne beaty | 0,54 / 0,79 / 0,93 | 0,82 | T |
| półbeat (1/2) | 0,07 / 0,19 / 0,43 | 0,19 | T (rzadko, ale prawie zawsze obecne) |
| 1/4 | 0 / 0,001 / 0,02 | 0,001 | Z (praktycznie nigdy) |
| 1/3, 1/6, 1/8 | 0 / 0 / ≤ 0,005 | 0 | Z |

Co decyduje o tym, który beat ma nutę (p50 po mapach, trening; test w nawiasie):
- **Głośność fragmentu, nie siła uderzenia.** W najgłośniejszej tercji RMS utworu ludzie mapują 94% beatów (test 96%),
w najcichszej 62% (70%); więcej w głośnej części ma 74/79 map (19/20). Beat z uderzeniem perkusji pluginu silniejszym
niż mediana mapy: 93% (94%), słabszym: 75% (82%). Słabsze uderzenia dalej mają więc nutę w trzech czwartych przypadków.
- **Kiai:** 94% beatów w kiai vs 77% poza (test 97% vs 79%). Ludzie zagęszczają kiai, wypełniając każdy beat, a nie
dokładając 1/2: więcej półbeatów w kiai ma tylko 37/71 map. Akordy omawiam w 2.3.
- **Puls bez dźwięku:** beat bez żadnego onsetu librosa ma nutę w 33% przypadków (z onsetem 87%). Ludzie trzymają puls
także tam, gdzie detektory nic nie widzą. To zgodne z wyjątkiem RC „consistent, predictable snap”.
- **Półbeaty** mają nutę, gdy jest tam onset: perkusyjny (28% vs 6% bez), lowmid (36% vs 12%), harmoniczny (36% vs 18%),
wokalu ze stemu (29% vs 16%), perkusji ze stemu (29% vs 12%). Onset basu prawie nic nie zmienia (20% vs 18%).
- **Regresja logistyczna** `mapped` (trening, standaryzowane cechy; AUC na mapach testowych):
- beaty: AUC 0,82 na teście. Najsilniejsze cechy dodatnie: obwiednia stemu perkusji +0,61, RMS +0,58, stem „other” +0,50,
  downbeat +0,49, kiai +0,26; ujemne: BPM −0,22, obwiednia stemu basu −0,22. Sama pozycja w takcie daje AUC 0,59,
  same stemy 0,77, same zdarzenia pluginu 0,75;
- półbeaty: AUC 0,77. Najsilniejsze cechy: RMS +0,50, stem perkusji +0,41, obwiednie highmid +0,38 i lowmid +0,34,
  onset wokalu +0,15; BPM −0,36;
- bez 5 zestawów oznaczonych w `alignment.md` (wszystkie w treningu) AUC i kolejność cech są te same (0,821 / 0,769);
- obwiednie są ze sobą skorelowane, więc znaki pojedynczych współczynników (np. ujemny `env_perc`) nie mają osobnej interpretacji.
- **Zdarzenia pluginu.** Pod 95% zmapowanych beatów i półbeatów ludzi (p50 po mapach; test 97%) jest zdarzenie
perkusji pluginu w ±25 ms. Onsety 4 pasm pluginu są w 75–97% wszystkich slotów, więc ich obecność niczego nie rozróżnia.
Recall klas (`plugin_events.*.recall_strong`, trening p50): snare 0,57, high 0,51, highmid 0,50, lowmid 0,49, perc 0,35,
low 0,27, lead 0,25, kick 0,23, bass 0,19. Stopy pluginu są mapowane rzadziej niż werble, ale na beatach kierunek tej
różnicy nie jest stały (trening: beat ze stopą 74% vs bez 81%; test: 88% vs 83%). Klasyfikacja perkusji pluginu
jest zawodna (`algorithm.md` pkt 5.9), więc tego nie interpretuję.
- **Stemy (recall na beatach / półbeatach, trening p50):** bas 0,93 / 0,20, other 0,91 / 0,28, perkusja 0,89 / 0,29,
wokal 0,88 / 0,29. Udział chwil na onsecie wokalu zależy od gatunku (pkt 3).

### 2.2 Gęstość, podziały, odstępy i BPM (`01_profile.py`, `03_density_bpm.py`)

| Metryka | Trening p10 / p50 / p90 | Test p10 / p50 / p90 | Klasa |
|---|---|---|---|
| `nps` | 2,66 / 3,40 / 4,12 | 2,72 / 3,64 / 4,40 | T (2,5–4,5 w 74/79, 17/20) |
| `notes_per_beat` | 0,87 / 1,14 / 1,48 | 0,86 / 1,19 / 1,42 | T (≥ 0,85 w 71/79, 18/20) |
| `nps_window.p90` / `.max` | 3,5 / 4,5 / 5,5 · 4,5 / 5,5 / 6,5 | 4,0 / 4,5 / 5,5 · 4,9 / 5,5 / 6,5 | T |
| `nps_peak8s` | 3,75 / 4,75 / 5,50 | 3,96 / 4,88 / 5,28 | T |
| `snap_share.1` / `.2` | 0,60 / 0,80 / 0,92 · 0,07 / 0,20 / 0,37 | 0,69 / 0,81 / 0,89 · 0,11 / 0,19 / 0,29 | T |
| `triplet_share` | 0 / 0 / 0,006 (maks. 0,03) | 0 / 0 / 0 | Z (< 1% w 74/79, 19/20) |
| `gap_share.1` / `.1/2` / `.2` | 0,37 / 0,61 / 0,81 · 0,07 / 0,22 / 0,48 · 0 / 0,03 / 0,09 | 0,47 / 0,61 / 0,77 · 0,04 / 0,28 / 0,38 · 0 / 0,03 / 0,14 | T |
| `run_1/2.max_notes` | 3 / 5 / 9,2 | 2 / 5 / 9,9 | T (≤ 5 w 58/79, 13/20; ≤ 9 w 71/79) |
| `run_1/1.max_notes` | 8 / 32 / 71 | 8 / 24 / 49 | T (długie łańcuchy 1/1) |
| serie 1/4 i szybsze | brak w 76/79 | brak w 19/20 | Z (wyjątki tylko przy 100–130 BPM) |
| `gap_ms.min` | 137 / 168 / 216 ms | 135 / 162 / 198 ms | Z: najkrótszy odstęp = 1/2 beatu (`gap_beats.p5` = 0,50) |

**Zależność od BPM.** Nps prawie nie zależy od BPM: elastyczność log-log +0,19, 95% CI [−0,05; +0,44], R² 0,03.
Liczba nut na beat maleje proporcjonalnie: −0,81 [−1,05; −0,57], R² 0,37. Ludzie trzymają więc mniej więcej stałą liczbę
nut na sekundę, a nie stały rytm na beat. Model daje 3,1 / 3,3 / 3,5 nuty/s i 1,55 / 1,11 / 0,88 nuty/beat przy
120 / 180 / 240 BPM. W przedziałach (trening, p50; n map / mapperów):

| BPM | n | nuty/s | nuty/beat | beaty z nutą | półbeaty z nutą | `gap_share.1/2` | najdł. seria 1/2 | min. odstęp | 1/2 beatu |
|---|---|---|---|---|---|---|---|---|---|
| < 150 | 13 / 12 | 2,89 | 1,39 | 0,87 | 0,33 | 0,34 | 5 (p90 23) | 214 ms | 231 ms |
| 150–180 | 30 / 29 | 3,45 | 1,20 | 0,82 | 0,21 | 0,26 | 5 | 176 ms | 176 ms |
| 180–210 | 28 / 22 | 3,42 | 1,10 | 0,80 | 0,17 | 0,23 | 5 | 155 ms | 156 ms |
| ≥ 210 | 8 / 7 | 2,96 | 0,79 | 0,68 | 0,14 | 0,13 | 3,5 | 140 ms | 140 ms |

- W każdym przedziale ≥ 150 BPM najkrótszy odstęp to dokładnie 1/2 beatu, także przy 210–240 BPM (ok. 140 ms).
Ludzie nie mają minimalnego odstępu w ms, mają minimalny podział: 1/2 (**Z**).
- Udział 1/2 maleje z BPM (Spearman ρ = −0,32 w treningu, −0,42 w teście). Jedyny utwór > 240 BPM (363594, 284 BPM, test)
nie ma żadnego odstępu 1/2. To zgodne ze skalą RC (pkt 4).
- Serie 1/4 (3 mapy w treningu, 1 w teście) występują tylko przy 100–130 BPM.

### 2.3 Akordy, jacki, holdy

**Akordy.**
- Nigdy więcej niż 2 nuty naraz: 99/99 map (**Z**). Akordy to 0,03 / 0,10 / 0,28 chwil (test 0,01 / 0,16 / 0,22), **S**.
- Położenie akordów (**T**):
- 58% akordów leży na downbeacie (p50 po mapach; p10 0,25), 35% na innych beatach, 0% poza beatem (p90 0,19);
- akord ma 23% zmapowanych downbeatów i 6% pozostałych beatów (test 26% / 14%);
- akord ma 12% chwil w głośnej połowie utworu i 2% w cichej (test 20% / 3%);
- akord stoi na 73% początków kiai (167 początków w 71 mapach; test 72%, 61 w 20 mapach) i na 43% granic sekcji (test 40%).
- Akordy w środku serii 1/2 (sprawdzenie pomocnicze, `12_rc_checks.py`): brak w 64/79 map, p90 to 3% akordów (**T**).
- Akordy 2-nutowe w dwóch rękach to 0,17 / 0,52 / 0,75. Połowa akordów jest więc jednoręczna (tory 0+1 albo 2+3), **S**.

**Jacki.**
- Brak minijacków ≤ 1/4 beatu: 99/99 map (**Z**). Minijacki to 0,6 / 4,4 / 12,5% par chwil, w odstępie 1 beatu (p50).
- Kolejne nuty na tym samym torze bliżej niż 1 beat: 0% (p90 1%, **Z**). Odstęp na torze < 350 ms: 1% (p90 9%).
- `jack_max_notes` 2 / 2 / 4 (≤ 4 w 76/79), `anchor_max_notes` 3 / 4 / 7.

**Holdy** (`08_holds_floors.py`; dotyczy 71 map treningu i 18 testu, które mają holdy).
- Udział holdów 0,002 / 0,13 / 0,28 (test 0,03 / 0,10 / 0,25). 10/79 map ma < 2% holdów, a 7/79 (7 mapperów) > 30%. To **S**.
- Długość p50 dokładnie 1 beat (p90 map: 2 beaty). Holdów < 0,9 beatu: 0% (p90 5%), **Z**. Metryka
`hold_short_share.lt_1` (p50 0,17) jest zawyżona przez zaokrąglenie do ms: 1-beatowy hold wychodzi 0,998 beatu.
- Hold zaczyna się na beacie w 92% przypadków (test 95%), **T**.
- **Puszczenie wypada dokładnie w chwili następnej nuty** w 98% holdów (p10 0,89; test 99%), **T/Z**.
Ludzki hold na Easy wypełnia odstęp do następnej nuty, a nie oznacza osobnego dźwięku. W efekcie powstają łańcuchy
1-beatowych holdów, np. 1894317 w 00:52–01:00.
- Puszczenie na beacie: 0,73 / 0,92 / 1,00 (≥ 0,7 w 73/79; test 0,97). Odstęp między puszczeniami ≥ 1 beat w 74/79.
- **W trakcie holda nie ma innych nut:** `holds_with_notes_inside_share` 0 / 0,02 / 0,17; ≤ 0,2 w 75/79 (wyjątki
u 4 mapperów) i w 20/20 testu (**Z** z nielicznymi wyjątkami). Nuty drugiej ręki na beat holda: p90 map 0.
- Dwa holdy naraz w 24/79 mapach (**S**); trzy nigdy.
- Początki holdów są w miejscach o słabszej obwiedni stemu perkusji niż zwykłe nuty na beatach (−0,10 w treningu
i w teście). Przewagi dźwięków ciągłych (wokal, other) nie widać wyraźnie (+0,02, test +0,10). To słaba tendencja:
hold częściej wypada tam, gdzie nie ma uderzenia, a jego długość nie wynika z długości dźwięku.

### 2.4 Wzorce i ich powtarzanie (`04_patterns_repetition.py`)

- **Tory.** Każdy tor ma ≥ 19% nut w 99/99 map, a środkowe tory 1+2 mają 0,47 / 0,51 / 0,54 nut. Lewa ręka ma 0,49–0,51
nut (**Z**, zgodne z poradnikiem: „balance the hands”).
- **Kroki między pojedynczymi nutami:**
- ten sam tor 0,02 (p90 0,11), sąsiedni 0,47, o dwa tory 0,34, o trzy 0,16;
- zmiana ręki 0,63 / 0,71 / 0,82;
- tryle 0,03 / 0,07 / 0,15, schody 0,04 / 0,09 / 0,19;
- entropia 4-chwilowych układów 6,18 / 6,95 / 7,42 bita.
- Klasa **T**: dużo skoków i zmian ręki, mało tryli i powtórzeń toru.
- **Powtórzenia muzyki** (pary okien 4 taktów o podobieństwie audio ≥ 0,75; mapy z ≥ 3 parami: trening 48 map / 41 mapperów,
test 10 / 10):
- rytm w powtórzeniach ma identyczność 0,72 / 0,90 / 0,98, a linia bazowa 0,37 / 0,53 / 0,76;
- zysk powtórzenie − baza wynosi 0,14 / 0,35 / 0,51 i przekracza 0,15 w 85% map (test 90%). Klasa **T**: przy
  powtórzeniu muzyki ludzie powtarzają rytm;
- tory powtarzają się słabo: 0,15 / 0,30 / 0,42, zysk nad bazą +0,09 (test +0,01). Z lustrem 0,42. Ludzie zmieniają
  układ torów przy tym samym rytmie, to **S**.

### 2.5 Sekcje, przejścia, kiai, intro i outro (`05_sections.py`, `11_chords_kiai.py`)

Granice struktury pochodzą z audio (`structure_boundaries_ms`). W treningu jest ich 529 w 77 mapach (59 mapperów),
w teście 127 w 20 mapach. Gęstość podaję jako nuty w takcie / mediana taktu utworu (mediana po granicach).

| | takty −4…−1 | takt granicy | takty +1…+3 | nuta na downbeacie granicy | akord | ostatni beat przed granicą zmapowany |
|---|---|---|---|---|---|---|
| wszystkie (trening) | 1,00 | 1,00 | 1,00 | 0,91 | 0,43 | 0,75 |
| „w górę” (RMS po/przed ≥ 1,25; 92 granice, 51 map) | 0,67–0,80 | **1,20** | 1,00 | 0,96 | 0,53 | **0,63** |
| „w dół” (≤ 0,8; 91 granic, 47 map) | 1,00 | 0,80 | **0,60–0,75** | 0,87 | 0,36 | 0,70 |
| test, wszystkie / w górę / w dół | 1,00 | 1,00 / 1,20 / 1,00 | 0,86–1,00 / 0,86–1,00 / 0,50–0,60 | 0,93 | 0,38 | 0,81 / 0,76 / 0,81 |

- Na początku sekcji jest nuta (`sections.boundary_note_share` 0,70 / 1,00 / 1,00; ≥ 0,7 w 71/79 i 18/20), **T**.
Akord stoi tam w 0,12 / 0,43 / 0,79 granic (**S/T**). Na początku kiai nuta jest w 96%, a akord w 73% (test 100% / 72%).
- **Bez narastania przed granicą.** Ostatni takt przed granicą ma tyle nut co 3 wcześniejsze (p50 1,00; test 1,05).
Przed wejściem głośniejszej sekcji ludzie raczej robią miejsce: 4 takty przed nią mają 0,67–0,80 mediany, a ostatni beat
przed nią jest pusty w 37% przypadków (sekcje płaskie: 21%). W teście ten drugi efekt jest słabszy (24% vs 18%, n=21),
więc to tendencja tylko częściowo potwierdzona.
- Po spadku energii gęstość maleje do 0,6–0,75 mediany (test 0,5–0,6), **T**. Gęstość w kiai to 1,00 / 1,22 / 1,59
gęstości poza kiai (≥ 1 w 62/71 map z kiai, w teście 20/20), **T**. Korelacja nut w takcie z RMS ma ρ −0,00 / 0,32 / 0,69.
- **Intro i outro.** Pierwsze 4 takty mają 0,37 / 0,88 / 1,19 mediany taktu, ostatnie 4 takty 0,16 / 0,83 / 1,23 (**S**).
Pierwsza nuta pada 0,21 / 0,90 / 4,6 s od początku pliku, czyli zwykle razem z pierwszym dźwiękiem.

### 2.6 Pauzy, odpoczynek, kontrast

- Pauzy ≥ 2 beaty: 0 / 2,2 / 10,3 na minutę, czyli 0 / 3,7 / 15,8% czasu (test 0 / 3,0 / 14,7 na minutę).
Pauzy ≥ 4 beaty: 0 / 0,28 / 1,84 na minutę. Pauzy ≥ 8 beatów ma tylko 8/79 map (test 4/20).
Najdłuższa pauza: 1,5 / 4 / 8 beatów.
- Puste takty: 0 / 1,7 / 7,8%. CV nut na takt: 0,23 / 0,32 / 0,50. Kontrast bloków 4-taktowych p90/p10: 1,31 / 1,76 / 3,82.
- Obraz ludzi to **ciągły puls z rzadkimi, wyraźnymi przerwami**: pauzy są krótkie i rzadkie (**T**), długie przerwy
pojawiają się tylko w części map, częściej w electronic (pkt 3), więc są **S**. Kontrast gęstości idzie za głośnością
(2.5), a nie za przypadkiem.

## 3. Gatunki (`06_genres.py`)

Trening: anime 19 map (18 mapperów), electronic 19 (17), video game 17 (14), pop 14 (14). Pozostałe gatunki to 10 map
w 8 gatunkach (rock 3, po jednej metal, classical, hip hop, jazz, novelty, folk, other), **za mało do uogólnień**.
W teście grupy mają 4–6 map, więc test sprawdza tylko kierunek różnicy. Test Kruskala-Wallisa liczę na surowych wartościach
i na resztach po regresji na log BPM, bo electronic jest szybsze (BPM p50: anime 170, electronic 200, video game 185, pop 164).

Wspólne dla gatunków (różnice nieistotne): gęstość (nps p50 3,29–3,56), beaty z nutą (0,76–0,83), akordy,
holdy (udział 0,11–0,15, nuty w holdach ≈ 0, długość 1 beat), tryle, entropia, nuta na granicy sekcji (0,89–1,00),
kiai gęstsze (1,14–1,35), powtarzanie rytmu, równowaga rąk.

Zależne od gatunku:

| Cecha | anime | electronic | video game | pop | p (KW) / p po BPM | Test (kierunek) |
|---|---|---|---|---|---|---|
| chwile na onsecie wokalu (stem) | 0,42 | 0,17 | 0,33 | 0,35 | < 0,001 / 0,001 | tak (0,30 / 0,17 / 0,30 / 0,40) |
| pauzy ≥ 2 beaty / min | 0,7 | 8,0 | 2,2 | 1,7 | 0,012 / 0,037 | tak (0,7 / 8,0 / 4,3 / 0,4) |
| półbeaty z nutą | 0,33 | 0,12 | 0,16 | 0,18 | 0,004 / 0,10 | częściowo (0,32 / 0,18 / 0,14 / 0,26) |
| `gap_share.1/2` | 0,32 | 0,12 | 0,20 | 0,31 | 0,021 / 0,39 | częściowo |
| `on_beat_share` | 0,71 | 0,84 | 0,81 | 0,82 | 0,037 / 0,14 | tak (0,72 / 0,81 / 0,85 / 0,75) |
| najdłuższa pauza (beaty) | 3,0 | 4,0 | 4,0 | 3,75 | 0,041 / 0,18 | tak (electronic najdłuższe) |

Wnioski:
- W anime i pop ludzie częściej idą za wokalem (jedyna różnica, która przetrwała kontrolę BPM). Taki wokal synkopuje,
dlatego więcej tam 1/2 i mniej nut na beacie.
- Electronic ma więcej krótkich przerw (dropy, breaki), to styl gatunku.
- Różnice w 1/2 wynikają głównie z BPM (po kontroli p = 0,10–0,39).
- Każda reguła z pkt 2 oznaczona **Z** lub **T** obowiązuje w każdym z czterech dużych gatunków.

## 4. Ranking Criteria i poradniki a dane

RC zakłada ok. 180 BPM i 4/4 (`Ranking_criteria_osu_mania.md`, sekcja Easy; skala z `Ranking_criteria_Scaling_BPM.md`).

| Wytyczna | Dane (trening; test) | Ocena |
|---|---|---|
| Bez kolejnych 1/4 i szybszych | brak serii 1/4 w 76/79 i 19/20; wyjątki tylko przy 100–130 BPM | zgodne, także ze skalą BPM („below ~120 BPM 1/4 can be introduced”) |
| „Mostly 1/1, occasional 1/2” | odstępy 1/1 61%, 1/2 22% (p90 48%); < 150 BPM 1/2 to 34% (p90 65%) | zgodne; przy < 150 BPM 1/2 częstsze, co RC dopuszcza |
| „Avoid more than 5 consecutive 1/2” | p50 dokładnie 5; > 5 w 21/79 map (21 mapperów), przy 150–210 BPM p90 6–11; test 7/20 | **sprzeczne w ~27% map**: to granica orientacyjna, nie przestrzegana reguła |
| Bez akordów w trakcie serii 1/2 | brak w 64/79, p90 3% akordów | zgodne (tendencja) |
| Akordy ≤ 2 nuty (także holdy w > 2 torach) | 99/99; najwyżej 2 holdy naraz | zgodne (twarda zasada) |
| Hold ≥ 1 beat | holdów < 0,9 beatu 0% (p90 5%) | zgodne (metryka `lt_1` myli przez zaokrąglenie) |
| Puszczenia ≥ 1 beat od siebie | 74/79 | zgodne |
| Bez obiektów w trakcie holda 1/1 („fine at beginning or end”) | nuty w holdzie 0 / 0,02 / 0,17; następna nuta dokładnie w puszczeniu 98% | zgodne. Ludzie korzystają z dozwolonego „obiektu na końcu” prawie zawsze |
| „Every note should correlate to a sound” | chwile bez dźwięku 0 / 1,3 / 6,0%; za to 33% beatów bez onsetu ma nutę | zgodne z wyjątkiem „consistent, predictable snap” (puls) |
| Breaki tylko w bardzo spokojnych częściach | pauzy ≥ 8 beatów w 8/79 map | zgodne |
| HP, OD ≤ 7 | wszystkie ≤ 7 | zgodne, ale bez znaczenia dla tej gry |
| Skala BPM: 120 BPM łagodniej, ≥ 240 bez 1/2 | nuty/beat 1,55 → 0,88 (120 → 240 BPM), nps prawie stałe; 1/2 maleje z BPM; 284 BPM: 0 odstępów 1/2 | zgodne kierunkowo. Dane precyzują skalę: stałe ok. 3,3 nuty/s i minimalny podział 1/2 do ok. 240 BPM |
| Kiai (wiki): najmocniejsza część, „typically more challenging” | gęstość 1,22×, beaty 94% vs 77% | zgodne |

Poradnik osu!mania, akapit „Easy”:
- „We don't use any 1/4 pattern, even 1/2 should be used carefully”: zgodne.
- „Use chords only to emphasise the beginning or the end of a part”: **częściowo sprzeczne**. Akordy faktycznie stoją
na 73% początków kiai i 43% granic, ale 35% akordów jest na zwykłych beatach, a w 13/79 map akordy to > 25% chwil.
- „Make sure you always balance the hands”: zgodne (twarda zasada).
- „Use a lot of LNs for the long sounds”: **sprzeczne z większością map**. Mediana udziału holdów to 13%, 10/79 map
prawie ich nie ma, a holdy trwają 1 beat niezależnie od długości dźwięku.
- „Do not use single notes while having a LN (if you do, the other hand)”: zgodne, nut w holdach prawie nie ma.
- „Second (main) beat louder … could map a chord”: dane pokazują akordy raczej na downbeatach (23%) niż na pozostałych
beatach (6%).
- „Keep it below 1,5★”: mediana 1,44★.

Co przenieść do tej gry, a co zaadaptować:
- **Przenieść:** puls 1/1, ograniczone 1/2, akordy ≤ 2, czyste holdy, równe ręce. Mechanika jest ta sama (4 tory,
tapy i holdy, podobne okna).
- **Zaadaptować:**
- HP/OD, SV i normalizacja przewijania nie mają tu odpowiednika.
- Brak hitsoundów: w osu! część akordów i holdów może służyć hitsoundom, czego dane nie rozdzielą. W grze bez
  hitsoundów akord zostaje wyłącznie akcentem wizualnym i fizycznym.
- Kiai nie istnieje w grze. Ludzki efekt kiai trzeba odtworzyć z audio (energia, powtórzenia, granice sekcji).
- Gracz Easy tej gry to nowicjusz z Discorda, a nie gracz osu!. Docelowa gęstość może być niższa niż 3,4 nuty/s,
  ale da się ją obniżać po ludzku: mniej 1/2, rzadsze beaty w cichych częściach, a nie losowe dziury w pulsie.

## 5. Algorytm a ludzie na zbiorze testowym (`07_algo_vs_human.py`)

20 utworów, 20 par (mapa człowieka i chart generatora tego samego utworu). „algo > ludzie” to liczba par,
w których wartość generatora jest większa; p to test Wilcoxona par.

| Metryka | Ludzie p10 / p50 / p90 | Algorytm p10 / p50 / p90 | algo > ludzie | p |
|---|---|---|---|---|
| nuty/s (`nps`) | 2,72 / 3,64 / 4,40 | 1,43 / 1,87 / 2,41 | 1/20 | < 0,001 |
| nuty/beat | 0,86 / 1,19 / 1,42 | 0,45 / 0,68 / 0,82 | 1/20 | < 0,001 |
| nuty/s, okno 2 s, p90 | 3,95 / 4,50 / 5,50 | 2,00 / 2,50 / 3,00 | 1/20 | < 0,001 |
| beaty z nutą | 0,68 / 0,86 / 0,92 | 0,32 / 0,44 / 0,66 | 0/20 | < 0,001 |
| półbeaty z nutą | 0,11 / 0,19 / 0,32 | 0,00 / 0,06 / 0,19 | 2/20 | < 0,001 |
| downbeaty z nutą (`downbeats_carried`) | 0,77 / 0,95 / 1,00 | 0,05 / 0,35 / 0,71 | 0/20 | < 0,001 |
| odstępy 1/1 | 0,47 / 0,61 / 0,77 | 0,01 / 0,41 / 0,64 | 8/20 | 0,03 |
| odstępy 1/2 | 0,04 / 0,28 / 0,38 | 0,00 / 0,00 / 0,09 | 0/20 | < 0,001 |
| odstępy 2 beaty | 0,00 / 0,03 / 0,14 | 0,12 / 0,26 / 0,83 | 19/20 | < 0,001 |
| najdłuższa seria 1/2 | 2 / 5 / 9,9 | 0 / 0 / 3,1 | 0/20 | < 0,001 |
| najdłuższa seria 1/1 | 7,8 / 24 / 49 | 2 / 8 / 14 | – | – |
| najkrótszy odstęp | 135 / 162 / 198 ms | 214 / 286 / 327 ms | 19/20 | < 0,001 |
| chwile > tolerancji od siatki 1/8, 1/6 człowieka | 0 / 0 / 0 | 0,07 / 0,22 / 0,37 | 20/20 | < 0,001 |
| akordy (`chord_share`) | 0,01 / 0,16 / 0,22 | 0,00 / 0,07 / 0,13 | 5/20 | 0,016 |
| akordy na downbeacie / poza beatem | 0,34 / 0,49 / 1,00 · 0 / 0,02 / 0,14 | 0 / 0,06 / 0,80 · 0 / 0,29 / 0,64 | 3/16 · 12/16 | 0,005 · 0,002 |
| akordy 2-nutowe w dwóch rękach | 0,23 / 0,49 / 0,67 | 0,88 / 1,00 / 1,00 | 16/16 | < 0,001 |
| udział holdów | 0,03 / 0,10 / 0,25 | 0,18 / 0,21 / 0,23 | 16/20 | < 0,001 |
| długość holda p50 (beaty) | 1,00 / 1,00 / 2,00 | 1,98 / 2,00 / 3,98 | 16/18 | < 0,001 |
| holdy z nutą w środku | 0,00 / 0,00 / 0,09 | 0,50 / 0,73 / 0,93 | 18/18 | < 0,001 |
| puszczenia na beacie | 0,83 / 0,97 / 1,00 | 0,21 / 0,33 / 0,52 | 0/18 | < 0,001 |
| następna nuta w chwili puszczenia | 0,93 / 0,99 / 1,00 | 0,10 / 0,29 / 0,38 | – | – |
| tory 1+2 (środek) | 0,48 / 0,51 / 0,56 | 0,48 / 0,63 / 0,78 | 17/20 | 0,001 |
| najsłabszy tor ≥ 19% nut | 20/20 map | 7/20 | – | – |
| tryle | 0,04 / 0,08 / 0,18 | 0,11 / 0,23 / 0,31 | 17/20 | < 0,001 |
| ten sam tor (pojedyncze nuty) | 0,00 / 0,03 / 0,11 | 0,04 / 0,11 / 0,25 | 17/20 | 0,001 |
| minijacki | 0,01 / 0,05 / 0,12 | 0,05 / 0,12 / 0,33 | 18/20 | < 0,001 |
| entropia wzorców 4 (bity) | 6,16 / 7,20 / 7,62 | 6,14 / 6,66 / 6,93 | 5/20 | 0,007 |
| pauzy ≥ 2 beaty / min | 0 / 3,0 / 14,7 | 6,6 / 15,0 / 26,2 | 17/20 | < 0,001 |
| pauzy ≥ 2 beaty, udział czasu | 0 / 0,04 / 0,18 | 0,09 / 0,20 / 0,33 | 17/20 | 0,002 |
| pauzy ≥ 8 beatów / min | 0 / 0 / 0,45 | 0 / 0 / 0 | 1/20 | 0,14 |
| kontrast 4 taktów p90/p10 | 1,36 / 1,72 / 2,80 | 1,42 / 1,71 / 1,90 | 10/20 | 0,26 |
| gęstość kiai / poza kiai | 1,06 / 1,23 / 1,57 | 0,85 / 0,98 / 1,19 | 4/20 | < 0,001 |
| korelacja nut w takcie z RMS | −0,05 / 0,36 / 0,55 | −0,13 / 0,05 / 0,30 | 5/20 | 0,006 |
| granice sekcji z nutą | 0,74 / 1,00 / 1,00 | 0,00 / 0,13 / 0,45 | 0/20 | < 0,001 |
| granice sekcji z akordem | 0,11 / 0,40 / 0,72 | 0 / 0 / 0 | 0/20 | < 0,001 |
| gęstość po/przed, granice „w dół” | 0,35 / 0,77 / 1,27 | 0,69 / 1,02 / 1,58 | 12/16 | 0,016 |
| początki kiai: nuta / akord (61 początków) | 100% / 72% | 52% / 8% | – | – |
| rytm w powtórzeniach muzyki | 0,76 / 0,90 / 0,96 | 0,11 / 0,29 / 0,49 | 0/16 | < 0,001 |
| rytm: powtórzenie − baza | 0,12 / 0,33 / 0,46 | −0,01 / 0,14 / 0,30 | 4/16 | 0,013 |
| tory w powtórzeniach | 0,06 / 0,27 / 0,40 | 0,26 / 0,52 / 0,70 | 12/16 | 0,002 |
| chwile bez dźwięku | 0,00 / 0,01 / 0,04 | 0,01 / 0,03 / 0,09 | 15/20 | 0,002 |
| recall silnych werbli / stóp | 0,36 / 0,58 / 0,73 · 0,18 / 0,38 / 0,72 | 0,20 / 0,28 / 0,45 · 0,12 / 0,26 / 0,37 | 1/20 · 3/20 | < 0,001 |
| pierwsza nuta | 0,35 / 0,96 / 4,9 s | 1,55 / 1,77 / 2,41 s | 17/20 | 0,06 |
| zgodność nut (±40 ms): nuty algo na nutach ludzi / nuty ludzi na nutach algo | – | 0,55 / 0,84 / 0,91 · 0,32 / 0,43 / 0,61 | – | – |

**Według gatunku** (test; p50 ludzie / p50 algorytm; grupy 4–6 utworów, novelty 1, więc to tylko opis):

| Metryka | anime (5) | electronic (6) | video game (4) | pop (4) | novelty (1) |
|---|---|---|---|---|---|
| nuty/s | 3,85 / 2,29 | 3,13 / 1,95 | 3,30 / 1,90 | 3,83 / 1,67 | 3,43 / 1,62 |
| półbeaty z nutą | 0,32 / 0,01 | 0,18 / 0,07 | 0,14 / 0,11 | 0,26 / 0,04 | 0,13 / 0,07 |
| odstępy 1/2 | 0,36 / 0,00 | 0,28 / 0,00 | 0,19 / 0,00 | 0,34 / 0,00 | 0,23 / 0,00 |
| downbeaty z nutą | 0,93 / 0,45 | 0,93 / 0,18 | 0,90 / 0,41 | 0,98 / 0,48 | 0,98 / 0,04 |
| holdy z nutą w środku | 0,00 / 0,71 | 0,04 / 0,77 | 0,03 / 0,70 | 0,03 / 0,61 | 0,00 / 0,90 |
| pauzy ≥ 2 beaty / min | 0,7 / 16,2 | 8,0 / 15,0 | 4,3 / 13,9 | 0,4 / 14,4 | 0,0 / 10,5 |
| gęstość kiai / poza | 1,22 / 0,92 | 1,39 / 1,16 | 1,26 / 0,97 | 1,16 / 1,05 | 1,06 / 0,96 |
| granice sekcji z nutą | 1,00 / 0,44 | 0,94 / 0,06 | 0,90 / 0,21 | 1,00 / 0,07 | 1,00 / 0,20 |
| rytm w powtórzeniach | 0,93 / 0,23 | 0,90 / 0,35 | 0,78 / 0,32 | 0,88 / 0,34 | 0,97 / – |
| chwile na onsecie wokalu | 0,30 / 0,33 | 0,17 / 0,15 | 0,30 / 0,25 | 0,40 / 0,43 | 0,30 / 0,18 |

Generator odstaje od ludzi w każdym gatunku podobnie. Jedyne, co trafia, to podążanie za wokalem (anime, pop),
bo w utworach wokalnych Easy prowadzi lead (`vocalLeads`). Brak 1/2 najbardziej szkodzi w anime i pop,
bo tam ludzie używają go najwięcej.

**Według trybu beat trackingu generatora** (p50 ludzie / algorytm):

| Tryb | n | nuty/s | beaty z nutą | odstępy 1/2 | downbeaty z nutą | pauzy ≥ 2 beaty / min |
|---|---|---|---|---|---|---|
| zgodne tempo | 7 | 3,56 / 1,99 | 0,86 / 0,65 | 0,33 / 0,00 | 0,96 / 0,60 | 0,8 / 7,5 |
| zgodne po podwojeniu (`foldFactor` 2) | 4 | 3,15 / 2,09 | 0,71 / 0,42 | 0,21 / 0,00 | 0,78 / 0,30 | 2,0 / 19,2 |
| połowa tempa | 8 | 3,85 / 1,63 | 0,87 / 0,38 | 0,21 / 0,00 | 0,94 / 0,09 | 6,8 / 20,6 |
| bez siatki (`NO_TIMING`) | 1 | 3,24 / 2,20 | 0,86 / 0,26 | 0,33 / 0,00 | 0,99 / 0,22 | 7,9 / 7,3 |

## 6. Problemy algorytmu na Easy (od największego wpływu)

### 1. Rwany puls: za mało nut i nieregularnie pomijane beaty

- **Co jest nie tak.** Generator gra mniej więcej co drugi beat, a beaty pomija bez związku z muzyką. Gubi przy tym
downbeaty i robi dziury dwubeatowe, których ludzie prawie nie robią.
- **Dowód (test, 20 par).**
- Gęstość: nps 1,87 vs 3,64 (algo gęstszy w 1/20 par); nuty/beat 0,68 vs 1,19.
- Pokrycie: beaty z nutą 0,44 vs 0,86 (0/20); downbeaty z nutą 0,35 vs 0,95 (0/20).
- Odstępy 2-beatowe 0,26 vs 0,03 (19/20). W 8 utworach śledzonych w połowie tempa to 53–88% odstępów: generator gra
  tam półnuty. Najdłuższa seria 1/1: 8 vs 24.
- W najgłośniejszej tercji utworu ludzie mają nutę na 96% beatów, generator na 55%.
- Nuty generatora w 84% leżą na nutach człowieka, ale pokrywają tylko 43% chwil człowieka. Pod 95% ludzkich nut plugin
  ma zdarzenie perkusji w ±25 ms, więc DSP te beaty widzi, a odrzuca je ścieżka Easy.
- **Klasa.** T: nuty/beat ≥ 0,85 w 71/79 map treningu (60 mapperów) i 18/20 testu; puls na beatach głośnych fragmentów
w 74/79.
- **Miejsce w kodzie:**
1. `patterns.js:drumEvents` (l. 113–117): level 0 dostaje tylko uderzenie na beacie o sile ≥ mediana uderzeń frazy,
   więc z definicji ok. połowa beatów spada na level 1. `difficulty.js` easy `maxLevel: 0` (l. 53) i filtr
   w `difficultyFilter.js:applyDifficulty` odrzucają level 1 na Easy. Ludzie mapują 75% beatów ze słabszym uderzeniem.
2. `difficultyFilter.js:densityHolds` (l. 199–212): w oknie 2 s najwyżej floor(maxNps·2·max(dolna_moc, moc) + 1) chwil.
   `maxNps` to 3,0 × ruchliwość (0,8–1,6), z sufitem 3,5 (`difficulty.js` l. 39–40), a moc to średnia energii
   × intensywność (`intensity.js`, 0,6–1,3). Daje to 4–7 chwil na 2 s, a ludzkie okna p90 mają 9 nut.
3. Połowa tempa (problem 3): „na beacie” znaczy wtedy co drugi beat człowieka.
4. `rests.js:fillRests` wstawia w pauzę pojedynczą nutę, a nie przywraca pulsu.
- **Potwierdzenie na teście.** Reguła ludzi potwierdzona (18/20).
- **Wpływ na naturalność: wysoki.** Beat to pierwsza rzecz, którą nowicjusz wystukuje. Brak nuty na „raz” i dziury
2-beatowe w głośnym refrenie sprawiają, że mapa wydaje się niezwiązana z muzyką.
- **Adaptacja z osu!.** 3,4 nuty/s to gęstość osu! Easy dla graczy osu!. Dla nowicjuszy z Discorda cel może być niższy,
ale gęstość trzeba obniżać po ludzku: najpierw zabrać 1/2, potem beaty w cichych fragmentach, a beaty i downbeaty
w głośnych zostawić. Tego, czy taka mapa jest dla nich za trudna, liczby nie rozstrzygną; to sprawa testu z graczem.

### 2. Brak rytmu 1/2 powyżej ~150 BPM i w utworach w połowie tempa

- **Co jest nie tak.** Generator ma zero odstępów 1/2 w 17 z 20 utworów, a ludzie w każdym przedziale BPM używają 1/2
w krótkich seriach.
- **Dowód.**
- Odstępy 1/2: 0,00 vs 0,28 (0/20); najdłuższa seria 1/2: 0 vs 5; półbeaty z nutą 0,06 vs 0,19.
- Najkrótszy odstęp 286 ms vs 162 ms.
- Także przy zgodnym tempie (7 utworów) odstępy 1/2 to 0,00. Wyjątkiem są tylko dwa utwory 130 BPM: 1784295 (0,20)
  i 923488 (0,10). Trzecia niezerowa wartość, 1000722 (0,09), wynika z siatki 77 BPM człowieka w części utworu.
- U ludzi 18% odstępów (trening p50; p90 43%) jest krótszych niż 200 ms. Najkrótszy ludzki odstęp to 1/2 beatu
  w każdym przedziale BPM (176 / 155 / 140 ms przy 150–180 / 180–210 / ≥ 210 BPM).
- **Klasa.** T: 1/2 w ≥ 7% odstępów w 70/79 map treningu; najkrótszy odstęp = 1/2 beatu to Z.
- **Miejsce w kodzie:**
1. `difficulty.js` easy `minNoteGapMs: 200` (l. 51, „never below this”): 1/2 beatu ma mniej niż 200 ms powyżej 150 BPM,
   więc każde 1/2 odpada w `difficultyFilter.js:fits` (l. 166) i jeszcze raz w `enforceFloors` (l. 377, `finish`).
2. `difficultyFilter.js:feltBeatMs` (l. 21): `gapBeats: 1/2` (`difficulty.js` l. 68) liczone w „odczuwanych” beatach
   daje w 4 utworach z `foldFactor` 2 i w 8 w połowie tempa minimalny odstęp 0,9 beatu człowieka.
3. `patterns.js`: na półbeacie level 0 dostaje tylko lead (`tonalEvents`). Uderzenia perkusji poza beatem mają
   level 1, więc Easy ich nie widzi.
- **Potwierdzenie na teście.** Potwierdzone (test p50 0,28; 1/2 jest w 19/20 map testowych).
- **Wpływ: wysoki.** Bez 1/2 nie da się oddać synkop wokalu i podwójnych uderzeń, a razem z problemem 1 mapa zamienia się
w równe półnuty.
- **Adaptacja z osu!.** RC i dane mówią to samo: ilość 1/2 maleje z BPM (półbeaty 33% przy < 150 BPM, 14% przy ≥ 210,
brak przy 284 BPM), serie mają zwykle ≤ 5 nut, przy wolnych utworach mogą być dłuższe. Granica powinna być w beatach
(1/2), z dolnym progiem w ms bliżej 130 ms niż 200 ms. Ile 1/2 zniosą nowicjusze tej gry, trzeba sprawdzić w grze.

### 3. Siatka generatora: połowa tempa, zła faza taktu, przesunięcie o pół beatu, brak siatki

- **Co jest nie tak.** W dużej części utworów generator mapuje na złym tempie albo w złej fazie taktu.
- **Dowód (`songs/<set>.json` → `algo_beat_tracking`, test):**
- Połowa tempa w 8/20 utworów (190, 190, 190, 200, 200, 220, 230 i 284 BPM; `chart.bpm` np. 95 zamiast 190).
- Downbeaty generatora zgodne z ludzkimi w < 30% w 13/19 utworów z siatką; ≥ 90% tylko w 3.
- Faza przesunięta o pół beatu: 23–38% beatów generatora na półbeatach człowieka w 4 utworach (1000722, 1277503,
  1570640, 310607). W 1570640 tylko 25% nut generatora trafia w nuty człowieka.
- 1 utwór bez siatki (2270163, pewność tempa 0,497): nuty w surowych czasach, 22% chwil poza siatką człowieka.
- Metrum inne niż 4/4 w 1697477 (3, 4, 6, 7), zmienne BPM w 3/20 (1000722, 1277503, 1329723).
- Skutki widać dalej:
  - akordy na ludzkim downbeacie 6% vs 49%, poza beatem 29% vs 2%;
  - chwile dalej niż tolerancja od siatki 1/8 i 1/6 człowieka 22% vs 0%;
  - przesunięcie od najbliższego slotu człowieka (mediana po utworach): |Δ| p50 4,7 ms, p90 12 ms, ze znakiem −2,8 ms
    (generator wcześniej), w 808872 aż −10 ms.
- **Klasa.** Ludzie są zawsze na swojej siatce (poza siatką 0%), więc to Z. Problem 3 nie jest regułą mapowania, tylko
przyczyną problemów 1, 2, 4 i 5.
- **Miejsce w kodzie:**
1. Plugin `TempoEstimator.java`: `MAX_BPM = 200`, prior log-Gauss wokół `PRIOR_CENTRE_BPM = 120` (l. 12–13).
   Utwór > 200 BPM musi zostać zmapowany w połowie tempa, a 180–200 BPM często też.
   `downbeatPhase` (l. 277) wybiera jedną fazę mod 4 z energii pasma niskiego na cały utwór, przy założeniu 4/4.
2. `timing.js:foldTempo` (l. 37–44): składa do 70–200 BPM i podwaja z powrotem tylko poniżej 95 BPM przy ≥ 8 silnych
   onsetach na beat (`HALF_TIME_ONSETS_PER_BEAT`), więc 95 BPM dla utworu 190 BPM zostaje.
3. `timing.js:buildTiming` (l. 117): `NO_TIMING` przy pewności < 0,5 (0,35 przy regularnych beatach).
   `halveBeats` (l. 88) dziedziczy fazę.
4. Zła faza trafia dalej do `difficultyFilter.js:slotRank`, `selectionOrder` i `thinChords` (`onDownbeat`) oraz do
   `patterns.js:isBarStart` i `withChords`.
5. `generate.js:chartFrom` (l. 212): `bpm` wynika z mediany beatu, więc gra skaluje prędkość spadania wg 95 zamiast
   190 BPM. To hipoteza do sprawdzenia w grze, nie wynik.
- **Potwierdzenie na teście.** Nie dotyczy, to cecha algorytmu zmierzona na teście.
- **Wpływ: wysoki** w 12–13 z 20 utworów. Mapa „na off-beacie” (1570640) albo grająca tylko „dwa” i „cztery” (1277503)
jest dla gracza po prostu zła. Przesunięcia o kilka ms są niskiej wagi (mieszczą się w oknie PERFECT 40 ms), ale część
utworów ma stałe −8 do −10 ms.
- **Adaptacja z osu!.** W osu! timing ustawia człowiek, a tu siatka musi pochodzić z audio. Ludzkie dane (stałe ok. 3 nuty/s
przy każdym BPM) pozwalają wybrać oktawę tempa po gęstości nut, której oczekuje gracz. Zakres trackera musi sięgać
ok. 300 BPM, bo korpus ma Easy przy 284 BPM.

### 4. Holdy: nuty w trakcie, puszczenia poza beatem, zła długość, stały udział

- **Co jest nie tak.** Holdy generatora są niemal odwrotnością ludzkich holdów Easy.
- **Dowód (test, pary z holdami):**
- holdy z nutą w środku 0,73 vs 0,00 (18/18); nuty drugiej ręki na beat holda 0,31 vs 0;
- puszczenie na beacie 0,33 vs 0,97 (0/18); następna nuta w chwili puszczenia 29% vs 99%; początek holda na beacie
  66% vs 95%;
- długość p50 2,0 vs 1,0 beatu;
- udział holdów 0,21 (0,18–0,23) vs 0,10 (0,03–0,25), w 16/20 utworów wyższy. Rozrzut generatora jest stały niezależnie
  od utworu: działa budżet, a nie muzyka.
- **Klasa.** Nuty w holdach ≤ 0,2: Z/T (75/79 map, 4 mapperów z wyjątkami; test 20/20). Puszczenie w następnej nucie:
T (p10 0,89). Puszczenie na beacie ≥ 0,7: T (73/79). Udział holdów: S.
- **Miejsce w kodzie:**
1. `difficulty.js` easy `holdOtherHand: "spaced"` (l. 58) i `holdSpacingBeats: 1` (l. 78) pozwalają drugiej ręce grać
   w trakcie holda co beat (`holds.js:spacedBlocked`, `holdBlocks`). Nagłówek `holds.js` (l. 3) twierdzi, że na Easy
   druga ręka jest zablokowana („blocked (Easy)”): komentarz i konfiguracja są niespójne.
2. `holds.js:addGapHolds` (l. 277–308): hold trwa do `next − gapAfterHold` (l. 292), czyli 200 ms przed następną
   nutą tej samej ręki (350 ms na tym samym torze), albo kończy się po `GAP_MAX_BEATS = 2`. Puszczenie wypada więc poza
   siatką i zwykle nie w chwili następnej nuty, a druga ręka w tym czasie gra.
3. `holds.js:planHolds` (l. 145) i `addSustainHolds` (l. 211): długość z `sustainMs` trackera wysokości albo z odstępu
   do nuty na tym torze minus `minLaneGapMs`. Żadna funkcja nie przyciąga puszczenia do beatu.
4. `holdMinBeats: 1` w połowie tempa oznacza 2 beaty człowieka.
5. Budżety `gapHoldShare: 0,3`, `maxHoldShare: 0,4` (`difficulty.js` l. 80–81; `holds.js:limitHoldShare` na frazę).
- **Potwierdzenie na teście.** Potwierdzone.
- **Wpływ: wysoki.** RC opisuje nuty drugiej ręki w trakcie holda jako umiejętność poza zasięgiem gracza Easy. Puszczenia
w przypadkowych miejscach brzmią i czują się losowo.
- **Adaptacja z osu!.** Gra ocenia puszczenie z oknem ×1,5, więc błąd puszczenia kosztuje mniej niż w osu!, ale dalej
jest niemuzyczny. Ludzka konwencja „puść w chwili następnej nuty” wymaga koordynacji puść-naciśnij. RC na to pozwala
(„object at the end is fine”), ale czy nowicjusze tej gry sobie z tym radzą, trzeba sprawdzić w grze. Alternatywa to
puszczenie na beacie i wolna druga ręka.

### 5. Brak reakcji na strukturę: granice sekcji, kiai, spadki energii

- **Co jest nie tak.** Generator nie zaznacza początków sekcji i nie zmienia gęstości razem z muzyką.
- **Dowód (test):**
- granice sekcji z nutą 0,13 vs 1,00 (0/20), z akordem 0,00 vs 0,40 (0/20);
- początek kiai z nutą 52% vs 100%, z akordem 8% vs 72% (61 początków w 20 utworach);
- gęstość w kiai 0,98× vs 1,23× (4/20); beaty z nutą w kiai 45% vs 97%;
- po granicy „w dół” gęstość 1,02 vs 0,77 (12/16); korelacja nut w takcie z RMS 0,05 vs 0,36 (5/20);
- zmienność gęstości jest podobna (CV 0,36 vs 0,33), ale niezwiązana z głośnością: to szum, a nie forma.
- **Klasa.** T: nuta na granicy ≥ 0,7 w 71/79 i 18/20; kiai gęstsze w 62/71 i 20/20; akord na starcie kiai 73% / 72%.
- **Miejsce w kodzie:**
1. Nie ma kroku, który daje nutę lub akord na początku sekcji. `patterns.js:withChords` (l. 339) dodaje akcent tylko
   na `isBarStart` (downbeat generatora albo start frazy), i tylko przy pojedynczym zdarzeniu level 0.
   `difficultyFilter.js:thinChords` (l. 261) zostawia akord tylko na downbeacie generatora przy s ≥ 0,8 i energii frazy
   ≥ 0,7 (`difficulty.js` l. 65).
2. Sekcje pochodzą wyłącznie z energii (plugin `Highlight.sections`), a frazy mają 16 beatów generatora.
3. `intensity.js` (0,6–1,3) mnoży limit gęstości, ale wiążą inne ograniczenia (problemy 1 i 2), więc gęstość
   nie idzie za głośnością.
4. `rests.js:fillRests` (`FILL_MIN_ENERGY = 0,2`) i `difficultyFilter.js:pulsePowerFloor` wypełniają ciche fragmenty.
- **Potwierdzenie na teście.** Potwierdzone.
- **Wpływ: średnio-wysoki.** Refren i drop grają się tak samo jak zwrotka, a pierwszy beat refrenu często jest pusty.
- **Adaptacja z osu!.** Kiai w grze nie istnieje: początek refrenu trzeba wykryć z audio (granice struktury, powtórzenia,
skok energii). Ludzki efekt kiai na Easy to „nuta na każdym beacie” i akord na pierwszym downbeacie,
a nie trudniejsze wzorce.

### 6. Kontrast i pauzy: dużo krótkich dziur, brak prawdziwych przerw

- **Co jest nie tak.** Odwrotny układ pauz niż u ludzi.
- **Dowód:**
- pauzy ≥ 2 beaty 15,0 (6,6–26,2) vs 3,0 na minutę (17/20); udział czasu 0,20 vs 0,04;
- pauz ≥ 8 beatów nie ma w 19/20 chartów, ludzie mają je w 4/20 (8/79 w treningu);
- kontrast bloków 4-taktowych ma węższy zakres: 1,42–1,90 vs 1,36–2,80.
- **Klasa.** T (rzadkie krótkie pauzy). Długie przerwy to S (electronic).
- **Miejsce w kodzie:**
1. `rests.js:restsOf` (l. 61) i `fillRests` (l. 79): próg `fillRestBeats: 2` × `beatMsOf` (beat generatora), czyli
   4 beaty człowieka w połowie tempa. Wypełnienie to jedna nuta po środku, tylko na siatce `baseDiv` z dźwiękiem w 35 ms,
   poza torami sąsiadów i przy odstępie 350 ms na torze, więc wiele pauz zostaje.
2. Odstępy 2-beatowe z połowy tempa są poniżej progu.
3. Celowej długiej przerwy kod nie robi: cisza to tylko energia < 0,08 (`SILENCE_ENERGY`).
- **Potwierdzenie na teście.** Potwierdzone.
- **Wpływ: średni.** Dziury 2–4 beaty w środku frazy brzmią jak zgubione nuty, a brak przerw zabiera oddech
w długich utworach.
- **Adaptacja z osu!.** Breaki osu! (`[Events]`) nie mają tu znaczenia, liczy się sam brak nut.

### 7. Powtórzenia: rytm nie powtarza się, gdy powtarza się muzyka; powtarzają się tory

- **Dowód:**
- identyczność rytmu w powtórzeniach muzyki 0,29 (0,11–0,49) vs 0,90 (0/16); zysk nad bazą 0,14 vs 0,33 (4/16);
- tory w powtórzeniach 0,52 vs 0,27 (12/16): generator kopiuje tory, ludzie kopiują rytm i zmieniają tory.
- **Zastrzeżenie.** 39% chwil generatora leży dalej niż 1/48 beatu od siatki człowieka, więc Jaccard na siatce 1/24
(`repetition.*.rhythm`) zaniża jego identyczność, a skala różnicy jest niepewna. Kierunek wspierają osobne obserwacje:
wybór beatów według siły względem mediany frazy i limitu gęstości (problem 1) z natury zmienia się między powtórzeniami.
Proszę o wariant metryki z tolerancją (pkt 8).
- **Klasa.** T (zysk > 0,15 w 85% map treningu z ≥ 3 parami, 41 mapperów; test 90%).
- **Miejsce w kodzie:**
1. `generate.js:copiedRepeat` (l. 71) i `repeats.js:copyRepeat` kopiują tylko frazy, które plugin (`Repetition`, bloki
   16 beatów generatora, podobieństwo ≥ 0,85) uznał za powtórzenie, i wyrzucają nuty bez zdarzenia w ±60 ms.
2. Frazy mapowane od nowa wybierają nuty przez `patterns.js:drumEvents` (próg mediany frazy) i limit gęstości, więc
   za każdym razem inne.
3. `barRepeats.js:repeatBarLanes` (≥ 65% wspólnych slotów 1/4) przenosi tory, nie rytm.
- **Potwierdzenie na teście.** Reguła ludzi potwierdzona.
- **Wpływ: średni.** Gracz rozpoznaje refren po rytmie: inny rytm tego samego refrenu nie pozwala się go nauczyć.

### 8. Tory i wzorce: przeciążony środek, tryle, akordy tylko oburęczne

- **Dowód:**
- tory 1+2 mają 0,63 (0,48–0,78) vs 0,51 nut (17/20), w utworach prowadzonych perkusją do 0,79;
- najsłabszy tor ma ≥ 19% nut tylko w 7/20 chartów, a u ludzi w 99/99 map;
- tryle 0,23 vs 0,08 (17/20); ten sam tor między pojedynczymi nutami 0,11 vs 0,03; minijacki 0,12 vs 0,05,
  w odstępie 2 beatów;
- akordy w dwóch rękach 1,00 vs 0,49 (16/16); entropia 6,66 vs 7,20 bita; `anchor_max_notes` 5,5 vs 4.
- **Klasa.** Równe tory: Z. Mało tryli i powtórzeń toru: T. Akordy jednoręczne: S.
- **Miejsce w kodzie:**
1. `patterns.js:hitsOf` (l. 65–78): stopy na torach 0/3, werbel i perc na 1/2 naprzemiennie wg licznika
   (`seen[cls]++ % 2`). Werbel na 2 i 4, zwykle najsilniejszy, czyli level 0 na Easy, daje 1-2-1-2: tryl w środku.
2. `patterns.js` `CONTOUR_START_LANE = 1` dla wokalu w wąskim zakresie.
3. `difficultyFilter.js:thinChords` (l. 273) wymaga partnera w drugiej ręce.
4. `spreadLanes` (l. 404) przenosi powtórzenie toru najpierw na drugą rękę.
- **Potwierdzenie na teście.** Potwierdzone.
- **Wpływ: średnio-niski.** To kwestia „ręki”, nie rytmu, ale przeciążony środek i tryle męczą dwa palce.
- **Adaptacja z osu!.** Ergonomia 4K jest ta sama, adaptacji nie trzeba.

### 9. Początek utworu: stałe 1,5 s bez nut

- **Dowód.** Pierwsza nuta 1,55–2,41 s vs 0,35 / 0,96 / 4,9 s (17/20). Pierwsze 4 takty generatora mają 1,00× mediany,
u ludzi 0,88× (p10 0,37).
- **Klasa.** S. **Kod:** `difficulty.js` `LEAD_IN_MS = 1500` (l. 10), filtr w `applyDifficulty`.
- **Wpływ: niski.** **Adaptacja:** bot może grać inny upload z innym początkiem, więc pewien lead-in jest w tej grze
uzasadniony. Ludzki sygnał to raczej spokojniejsze intro niż brak nut.

## 7. Kandydaci do testów odsłuchowych i gry

Czasy są na osi audio z map (mm:ss). Bot może grać inny upload, więc są przybliżone. Podgląd nut:
`10_window.py <set> <od> <do>`.

1. **1894317, kessoku band – Seishun Complex (TV Size)**, 00:38–01:12 (anime, 190 BPM, generator w połowie tempa).
 - U człowieka cztery początki kiai (00:40, 00:50, 01:00, 01:10) mają akord, u generatora żaden nie ma nuty.
 - W 00:52–01:00 człowiek gra łańcuch 1/1 z holdami 1-beatowymi kończonymi w następnej nucie (ok. 30 chwil).
   Generator ma ok. 9 nut co 2–4 beaty, bez downbeatów.
 - Sprawdzić: czy refren „gra się” jak refren.
2. **2224035, JINGBURGER – Konton Boogie**, 01:38–01:47 (pop, 190 BPM, połowa tempa). Wejście kiai 01:41: człowiek daje
 akord, potem 1/1 z parami 1/2. Generator ma 3 tapy i 2 holdy w 5 s. Sprawdzić odczucie „pustego” refrenu.
3. **1570640, Lime – 8bit Voyager**, 00:30–00:36 i 01:24–01:34 (electronic, 182 BPM, podwojone tempo z 90,9).
 - Nuty generatora leżą na półbeatach człowieka i 5–14 ms wcześniej, człowiek gra na beatach.
 - W całym utworze tylko 25% nut generatora pokrywa się z ludzkimi.
 - Sprawdzić, czy gracz odbiera to jako granie „pod prąd”.
4. **1277503, Umeboshi Chazuke – Panic! Pop'n! Picnic! (2019 REMASTER)**, 01:59–02:06 (video game, 190 BPM, połowa tempa,
 9 czerwonych linii).
 - W kiai człowiek gra każdy beat z akordami na „dwa” i „cztery”.
 - Generator gra wyłącznie „dwa” i „cztery”, bez downbeatów (połowa tempa w fazie backbeatu); jego 1-sekundowe holdy
   mają po 2 nuty w środku.
5. **1697477, cosMo@BousouP – Hatsune Miku no Gekishou**, 02:16–02:24 (video game, 200 BPM, połowa tempa, metrum 3/4/6/7).
 W ostatnim kiai (od 02:20) człowiek gra akord na każdym beacie. Generator gra nutę co 2–3 beaty i 1,2-sekundowe holdy
 z nutą w środku. Sprawdzić też fragmenty ze zmianą metrum: frazy 16-beatowe i downbeaty generatora są tam w złych miejscach.
6. **923488, HyuN – Grin**, 00:42–00:50 (electronic, 130 BPM, tempo zgodne). Izoluje problem holdów.
 - Pięć 2-beatowych holdów generatora (limit `GAP_MAX_BEATS`) ma po 1–2 nuty drugiej ręki w środku; puszczenia
   wypadają 7–18 ms od beatu.
 - Człowiek gra 1/1 z 1/2 w kiai od 00:45 i ma jeden hold.
 - Sprawdzić czytelność i wygodę dla nowicjusza.
7. **1784295, Rokudenashi – Tada Koe Hitotsu**, 02:10–02:18 (pop, 130 BPM, utwór wokalny, lead prowadzi wszystkie 22 frazy).
 - Człowiek gra 1/1 + 1/2 z akordami na „trzy” i holdami 1-beatowymi kończonymi w następnej nucie.
 - Generator gra mniej więcej co 2 beaty; holdy kończą się 16–28 ms obok beatu (pozycje 1/8, 1/4), a 3 z 4 mają po
   1–2 nuty w środku.
 - Sprawdzić, czy linia wokalu jest czytelna.
8. **2270163, ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasavitsa**, 01:58–02:04 (electronic, 185 BPM, bez siatki).
 Nuty generatora na pozycjach 1/4, holdy kończone na 1/6–1/8, a człowiek gra równe 1/1 + 1/2. Sprawdzić odczucie
 „pływającego” rytmu.
9. **808872, Kobaryo – Perfect Neglect**, 00:15–00:21 oraz początki kiai 00:56, 01:30, 02:07 (electronic, 230 BPM,
 połowa tempa).
 - Człowiek gra każdy beat (ok. 3,8 nuty/s), generator co drugi, 10–16 ms za wcześnie.
 - Na żadnym z trzech początków kiai generator nie ma nuty; pauzy ≥ 2 beaty 48 na minutę.

## 8. Prośby o nowe metryki

1. **`repetition.*.rhythm` z tolerancją czasu.** Chwile dopasowywane w ±25 ms albo po przyciągnięciu do najbliższego
 slotu 1/8 lub 1/6 siatki referencyjnej. Powód: 39% chwil generatora leży dalej niż 1/48 beatu od siatki człowieka,
 a Jaccard na siatce 1/24 karze to jak inny rytm (problem 7).
2. **Holdy względem siatki i następnej nuty:**
 - `release_at_next_moment_share`: puszczenie ±1/16 beatu od następnej chwili; ludzie 98%, generator 29%;
 - `hold_start_on_beat_share`;
 - `hold_short_share` z progiem 0,9 beatu zamiast 1 − 1e-6. Obecne `lt_1` (p50 0,17) mierzy zaokrąglenia ms, nie krótkie
   holdy.
3. **`chords_in_half_runs_per_min`.** Akord, którego oba sąsiednie odstępy to 1/2 beatu. To wytyczna RC Easy, analogiczna
 do istniejącego `chords_in_fast_stream_per_min` dla 1/4 (tu policzone pomocniczo w `12_rc_checks.py`).
4. **Pokrycie siatki:** `beat_coverage`, `half_beat_coverage`, `downbeat_coverage` (udział beatów, półbeatów i downbeatów
 czasu aktywnego z chwilą), także w kiai i poza nim oraz w tercjach RMS. Tutaj liczone z tabel slotów
 (`02_slots.py`, `11_chords_kiai.py`); to najprostszy opis ludzkiego Easy.
5. **Początki kiai:** `kiai_start_note_share`, `kiai_start_chord_share` (pierwszy downbeat sekcji kiai); ludzie 96–100% / 72–73%.
6. **Profil granic:** nuty w taktach −4…+3 względem granicy (do mediany taktu) i udział granic z pustym ostatnim beatem
 przed granicą, osobno dla granic „w górę” i „w dół” (`05_sections.py`).
7. **Tylko dla algorytmu, względem mapy człowieka tego samego utworu i poziomu:**
 - precision i recall chwil (±40 ms);
 - `grid_offset_ms` ze znakiem, czyli odległość do najbliższego slotu siatki referencyjnej (`13_timing.py`).
   Istniejące `grid_error_ms` mierzy odległość od podziału, na którym chwilę sklasyfikowano, więc nuta 10–20 ms obok
   beatu trafia do 1/16 z małym błędem i systematyczne przesunięcie znika.

## 9. Ograniczenia

- **Co oznacza Easy.** Easy to Easy osu!mania (SR < 1,65★) dla graczy osu!. Docelowy gracz tej gry może potrzebować mniej.
Dane opisują, jak mapuje człowiek, a nie co jest dobre dla nowicjusza z Discorda.
- **Liczebność.** Test ma 20 utworów i po 4–6 na gatunek, więc porównania generatora w gatunkach to tylko opis.
Grupy „inne” (10 map w treningu) nie nadają się do wniosków.
- **Co mierzą metryki:**
- Charty generatora powstały z audio z `.osz`; w grze plugin analizuje to, co gra bot.
- Metryki generatora liczę na siatce człowieka, więc jego błędy siatki przenikają do metryk rytmu (`snap_share`,
  `repetition.*`). Rozdzielam to w problemie 3 i w `13_timing.py`.
- `hold_short_share.lt_1` jest zawyżone przez zaokrąglenie do ms (pkt 2.3).
- Granice struktury pochodzą z detektora Foote'a, a nie z ręcznych etykiet. Kiai to znacznik mappera; ma go 71/79 map
  treningu i 20/20 testu.
- **Statystyka:**
- Regresja logistyczna łączy sloty wszystkich map (mapy z większą liczbą slotów ważą więcej) i nie ma efektów losowych
  mappera. Cechy audio są współliniowe, więc pojedyncze współczynniki opisują kierunek, nie wielkość efektu.
- Wyniki są stabilne po usunięciu 5 zestawów oznaczonych w `alignment.md`: wszystkie są w treningu, mediany kluczowych
  metryk się nie zmieniają, a AUC zmienia się o ≤ 0,002.
- **Przyczyny w kodzie** wskazuję z kodu i z wzorca w danych (np. 1/2 znika dokładnie powyżej 150 BPM, a odstępy
2-beatowe dominują dokładnie w utworach w połowie tempa). Ilościowego podziału „ile nut gubi każdy mechanizm” nie liczyłem.
Wymaga to przebiegu generatora z wyłączanymi regułami, którego tu nie robiłem, bo zakres wyklucza zmiany generatora.
- **Popularność** (plays, ulubione, oceny) nie została użyta jako miara jakości.
- **Czego liczby nie potwierdzą.** Zgodność rozkładów z ludźmi nie dowodzi, że mapa jest dobra. Czy wzorzec jest wygodny,
czy holdy z puszczeniem w następnej nucie są dla nowicjusza czytelne, czy rzadsza mapa jest przyjemniejsza i czy
prędkość spadania z `chart.bpm` w połowie tempa przeszkadza, musi ocenić człowiek grający (pkt 7).

## 10. Jak odtworzyć

Środowisko: Python z numpy, pandas, scipy, scikit-learn i statsmodels. Wszystkie skrypty czytają tylko dane Easy
i dane utworów niezależne od poziomu (`shared/data/songs/`), a wyniki zapisują do `mapping-analysis/levels/easy/out/`.

```bash
PY=/ścieżka/do/venv/bin/python bash mapping-analysis/levels/easy/run_all.sh
```

Wszystko trwa ok. 1 minuty. Wyjście każdego skryptu trafia do `out/<skrypt>.txt`, tabele do `out/*.csv`. Kolejność ma
znaczenie: `03` zapisuje pokrycie beatów, z którego korzystają `06` i `07`.

| Skrypt | Co liczy |
|---|---|
| `common.py` | ścieżki, wczytywanie (tylko dozwolone kolumny `corpus.csv`), kwantyle |
| `01_profile.py` | kwantyle wszystkich metryk: ludzie trening i test, algorytm (`out/profile_all.csv`) |
| `02_slots.py` | tabele slotów: pokrycie pozycji, recall klas pluginu, detektorów i stemów, regresja logistyczna, pokrycie zdarzeniami, siła uderzenia a głośność, czułość bez oznaczonych zestawów |
| `03_density_bpm.py` | gęstość i podziały a BPM (Spearman, elastyczność, przedziały), kandydaci na twarde zasady (`out/limits.csv`) |
| `04_patterns_repetition.py` | tory, kroki, tryle, entropia, powtarzalność; pary człowiek–algorytm |
| `05_sections.py` | profil gęstości wokół granic struktury, początki kiai, intro i outro |
| `06_genres.py` | gatunki: Kruskal-Wallis surowo i po kontroli BPM, kierunek na teście |
| `07_algo_vs_human.py` | tabela algorytm vs ludzie (test), wg gatunku, wg trybu beat trackingu, per utwór |
| `08_holds_floors.py` | holdy (długość, start na beacie, następna nuta w puszczeniu, cechy pod startem) i jaki ułamek ludzkich odstępów łamie progi Easy generatora |
| `09_fragments.py` | zgodność nut (±40 ms) i okna 4-taktowe do wyboru fragmentów (`out/fragment_windows.csv`) |
| `10_window.py` | podgląd nut człowieka i generatora w oknie: `python -I 10_window.py 1894317 00:52 01:00` |
| `11_chords_kiai.py` | akordy i holdy w kiai i poza nim, na downbeatach, w głośnych i cichych miejscach |
| `12_rc_checks.py` | pomocniczo: akordy w seriach 1/2 (wytyczna RC Easy) |
| `13_timing.py` | odległość chwil generatora od siatki człowieka (ms, ze znakiem) |
