# Hard: jak mapują ludzie i jak wypada generator (etap 2)

Zakres: tylko poziom Hard (osu!mania 4K, SR [2,7; 3,4)), generator v19. Dane: `shared/data/hard/` (95 map ludzi, w tym 75 treningowych i 20 testowych, oraz 20 chartów algorytmu dla utworów testowych), `shared/data/songs/`, kolumny ogólne i `hard_*` z `shared/corpus.csv`. Zestawów z mapą Hard jest 95, a nie 100: w treningu jest 75 utworów, nie 80. Mapperzy liczeni są po właścicielu dyfficulty (`hard_owners`): w treningu jest ich 62, w teście 20. Profil i reguły wyznaczyłem na treningu, a potem sprawdziłem na teście. Algorytm porównuję z ludźmi wyłącznie na teście. Wszystkie tabele pośrednie są w `levels/hard/tables/`, a skrypty opisuje sekcja 10.

Oznaczenia: „p10/p50/p90” to kwantyle po mapach. „n” to liczba map, „m” liczba różnych mapperów. „Sloty” to tabele slotów, w których każda chwila jest przypisana do jednego, najbliższego slotu (±25 ms), opis w sekcji 8, prośba 1. „(pomocn.)” oznacza miarę policzoną tutaj z nut, która nie jest oficjalną metryką z `metrics.md` (zob. sekcja 8).

## 1. Podsumowanie

Hard u ludzi to niemal ciągły szkielet półbeatów: beaty mają nutę w 93% przypadków, półbeaty w 83%. Na beatach leżą akordy (76% zmapowanych beatów), a 1/4 pojawia się tam, gdzie słychać perkusję. Gęstość wynosi około 9,4 nuty/s niezależnie od BPM, więc liczba nut na beat spada z tempem, zgodnie ze skalą RC wokół 180 BPM. Twarde zasady (≥ 95% map treningowych, potwierdzone na teście):
- brak nut poza siatką i prawie pustych slotów 1/8;
- balans rąk 50 ± 2%, także w każdych 4 taktach;
- akordy w ≥ 25% chwil, z czego połowa to skoki jednej ręki;
- puszczenia holdów na siatce 1/4;
- akord na downbeacie granicy sekcji;
- tryle nie dłuższe niż 9 nut.

Generator na Hard ma tyle samo chwil na beat co ludzie (2,01 wobec 2,02), a makrodynamika sekcji, kiai i kontrast są zbliżone. Mimo to jego Hard odbiega od ludzkiego niemal we wszystkim, co gracz czuje w ręce. Największe różnice:
1. Rytm nie ma szkieletu: najdłuższy ciąg odstępów ≤ 1/2 to 28,5 chwili wobec 130 u ludzi, ma nuty na 1/8 i odstępy 3/8, 5/8 i 3/4.
2. Akordów prawie nie ma: 11% chwil wobec 50%, zawsze na dwie ręce i nie tam, gdzie muzyka jest głośna.
3. Siatka ma drganie i błędy fazy: 12% chwil na 1/16 i 3,5% poza siatką; w 8 z 19 utworów tempo jest połówkowe, w 12 z 19 downbeaty są w złej fazie.
4. Holdy trwają 1,7 beatu zamiast 0,5, a 2/3 z nich puszcza się poza siatką 1/4 (u ludzi prawie nigdy).
5. Gęstość jest niższa: 7,0 wobec 9,1 nuty/s. Prawa ręka jest przeciążona, a tryli jest pięć razy więcej niż u ludzi.

Różnice występują w każdym z czterech dużych gatunków. Liczby nie rozstrzygną, czy chart dobrze się gra. Kandydaci do sprawdzenia na żywo są w sekcji 7.

## 2. Profil mapowania ludzi na Hard

Klasy: **twarda zasada** spełnia ≥ 95% map treningowych, **silna tendencja** 80–95%, a **styl** mniej (zależy od mappera lub gatunku). Pełna lista reguł z udziałami na treningu, teście i u algorytmu jest w `tables/rules.csv` (zob. też 2.6).

### 2.1 Co ludzie mapują, a co pomijają (tabele slotów, `a3_slots.py`)

**Siatka decyduje najpierw.** Udział slotów z chwilą, po mapach treningowych (n = 75, m = 62), p10/p50/p90:

| slot | trening | test (n = 20, m = 20) | zależność od BPM (trening, mediana po mapach) |
|---|---|---|---|
| beat 1/1 | 0,82 / 0,93 / 0,98 | 0,85 / 0,95 / 0,99 | < 150: 0,97; 150–180: 0,94; 180–210: 0,92; ≥ 210: 0,80 |
| półbeat 1/2 | 0,65 / 0,83 / 0,95 | 0,65 / 0,82 / 0,93 | 0,89 / 0,84 / 0,78 / 0,70 |
| 1/4 | 0,04 / 0,17 / 0,42 | 0,04 / 0,10 / 0,24 | 0,31 / 0,17 / 0,14 / 0,10 |
| 1/8 | 0 / 0 / 0,003 | 0 / 0 / 0,003 | prawie zawsze 0 |
| downbeat | 0,85 / 0,96 / 1,00 | 0,78 / 0,96 / 1,00 | – |
| triole 1/3 / 1/6 (zbiorczo) | 1,7% / 0,5% slotów | 1,4% / 0,1% | – |

- **Twarda zasada w praktyce**: sloty 1/8 prawie puste, bo ≤ 1% w 92% map treningowych i 100% testowych.
- **Silna tendencja**: beaty zmapowane w ≥ 80% (92% map, test 100%) i półbeaty w ≥ 60% (93%, test 95%).
- **Styl**: 1/4. Rozrzut 0,04–0,42 zależy od BPM i od mappera.

**W slotach 1/4 i 1/2 decyduje perkusja, nie melodia.** Slot 1/4 z onsetem perkusyjnym (librosa) dostaje nutę w 66% przypadków (p10 0,26, p90 0,95), slot bez takiego onsetu w 14% (p10 0,03, p90 0,33). Regresja logistyczna wybrania slotu (cechy standaryzowane, model z treningu oceniany na teście):

| podzbiór slotów | AUC test | tylko siatka | tylko onsety librosa | tylko zdarzenia pluginu | tylko stemy | tylko energia i kiai |
|---|---|---|---|---|---|---|
| 1/1 + 1/2 + 1/4 | 0,957 | 0,900 | 0,927 | 0,915 | 0,916 | 0,642 |
| tylko 1/4 | 0,862 | 0,670 | 0,808 | 0,815 | 0,756 | 0,521 |
| tylko 1/2 | 0,871 | 0,624 | 0,831 | 0,819 | 0,830 | 0,713 |

Najsilniejsze współczynniki (std., zbiór 1/1 + 1/2 + 1/4):
- dodatnie: obwiednia stemu perkusji +0,72, zdarzenia pasm high +0,58 i highmid +0,45, obwiednia lowmid +0,59, stem „other” +0,44, RMS +0,30, downbeat +0,27;
- ujemne: obwiednia harmoniczna −0,61 (długi dźwięk tonalny bez ataku) i BPM −0,31.

Klasa `kick` z pluginu ma tylko +0,12…0,19. Model z całego zbioru slotów osiąga AUC 0,986, ale to głównie efekt tego, że sloty 1/8 i triolowe prawie nigdy nie są mapowane.

**Recall zdarzeń pluginu** (`plugin_events.*.recall`, trening p50; w nawiasie `recall_strong` dla s ≥ 0,5):

| klasa | recall p50 (recall_strong p50) |
|---|---|
| snare | 0,68 (0,91) |
| high | 0,65 (0,88) |
| highmid | 0,63 (0,88) |
| lowmid | 0,58 (0,84) |
| bass | 0,49 (0,52) |
| lead | 0,48 (0,49) |
| perc | 0,44 (0,74) |
| low | 0,40 (0,51) |
| kick | 0,33 (0,50) |
| hat | 0,50 (0,67), tylko 64 mapy mają hi-haty w pluginie |

Na teście kolejność jest ta sama. Ze slotów wynika recall onsetów stemów: perkusja 0,51, other 0,61, wokal 0,39, bas 0,42.

**Silna tendencja**: ludzie biorą prawie każdy mocny werbel i jasny, perkusyjny atak, a linię basu i wokalu tylko w połowie.

**Akordy stawiane są tam, gdzie jest głośno i gra perkusja.** Akord ma 76% zmapowanych beatów (p10 0,52) i 21% półbeatów. Model „akord czy pojedyncza nuta” na wybranym beacie osiąga AUC 0,74 na teście. Decydują RMS (+0,87), stem perkusji (+0,74), downbeat (+0,54) i BPM (−0,46).

**Holdy to raczej styl niż reakcja na dźwięk.** Model startu holda na wybranych slotach osiąga AUC tylko 0,65 na teście (`a14_hold_placement.py`). Holdy zaczynają się w 58% na beacie i w 37% na półbeacie, ze słabym związkiem z wokalem i basem (współczynniki +0,10).

### 2.2 Gęstość, podziały i limity trudności (`a1_profile.py`, `a5_bpm.py`)

| metryka | trening p10 / p50 / p90 | test p50 | klasa |
|---|---|---|---|
| `nps` | 8,0 / 9,4 / 10,6 | 9,1 | silna tendencja (92% map w 7,5–11), wynika też z zakresu SR |
| `notes_per_beat` | 2,56 / 3,12 / 4,04 | 3,10 | zależy od BPM (niżej) |
| `moments_per_beat` | 1,73 / 2,15 / 2,67 | 2,02 | – |
| `nps_window` p50 / p90 / max | 9,5 / 12 / 14 (mediany) | 9,5 / 11,5 / 14 | – |
| `nps_peak8s` | 10,7 / 12,2 / 13,8 | 11,7 | – |
| `gap_share` 1/2 / 1/4 / 1/1 | 0,59 / 0,28 / 0,05 (p50) | 0,64 / 0,19 / 0,07 | 1/2 dominuje |
| `snap_share.off` | 0 w 96% map | 0 | twarda zasada |
| `triplet_share` | 0 / 0,002 / 0,04 | 0 | styl (np. swing) |
| `run_1/2.max_notes` | 13,8 / 34 / 76 | 36,5 | – |
| `run_1/4.max_notes` | 7 / 17 / 49 | 17 | – |
| `run_1/8.max_notes` ≤ 3 | 92% map | 90% | silna tendencja |
| ciąg odstępów ≤ 1/2 po kwantyzacji (pomocn.) | 66 / 137 / 320 chwil | 130 | twarda zasada: ≥ 40 w 96% map |
| `gap_ms.min` / `gap_ms.p5` | 44 / 75 / 93 i 71 / 85 / 112 ms | 76,5 / 82,5 | – |

**Akordy.**
- `chord_share` wynosi 0,27 / 0,42 / 0,58. Akordy w ≥ 25% chwil ma 96% map (test 90%): twarda zasada.
- Akordy 2-nutowe stanowią 0,35 chwil. Akordy 3-nutowe: p50 0,033 (p90 0,16); są w 95% map. Akordów 4-nutowych nie ma w 96% map.
- Pozycje akordów: downbeat 0,22, inny beat 0,54, poza beatem 0,25.
- `chord2_split_hands_share` wynosi 0,52 (0,41–0,68). Około połowy akordów 2-nutowych to więc skoki jednej ręki [0,1] albo [2,3]. Udział ≥ 25% ma 97% map (test 95%): twarda zasada.

**Jacki.**
- `minijack_share` wynosi 0,12. Szybkie minijacki 1/4 (`minijack_fast_share`) praktycznie nie występują: ≤ 0,5% w 96% map, twarda zasada.
- `jack_max_notes` wynosi 4 (3–7). `anchor_max_notes` wynosi 8 (6–12), patrz sekcja 4.
- Kolejne pojedyncze nuty na tym samym torze to tylko 2% kroków (`single_step_share.0`, p90 0,07).

**Holdy.**
- `hold_share` wynosi 0 / 0,068 / 0,24. Mapy z holdami ≥ 2% nut to 83% (styl, zależny też od gatunku).
- Długość p50: 0,5 beatu. Krótszych niż 1 beat jest 72% holdów, krótszych niż 1/2 beatu 27%.
- Puszczenia: `release_snap_share` na 1/1 0,57, na 1/2 0,33, na 1/4 0,03. ≥ 95% puszczeń na siatce 1/4 ma 95% map z ≥ 10 holdami (n = 62, m = 53; test 100%): twarda zasada.
- Nuty wewnątrz holdów (`holds_with_notes_inside_share`): 0,18 (p90 0,38). Holdów z nutą w środku jest ≤ 40% w 94% map: silna tendencja. Nuty drugiej ręki na beat holda: p50 0.
- Zależność od długości holda (pomocn., `tables/holds_inside_by_length.csv`): nutę w środku ma 4% holdów 1/2-beatowych, 39% jednobeatowych i 60% dwubeatowych.
- Głowa holda jest częścią akordu w 60% przypadków.
- `max_simultaneous_holds` wynosi 2 (0–3).

**BPM a skala RC** (regresja na log2(BPM/180), trening n = 75, test n = 20):
- nps nie zależy od tempa: 9,3 przy 180 BPM, nachylenie +0,7 na podwojenie BPM, p = 0,15.
- Nuty na beat spadają o 2,0 na podwojenie BPM (p < 0,001; test −0,9, p = 0,001). Po uwzględnieniu gatunku nachylenie jest takie samo (−2,15).
- Udział odstępów 1/4 spada o 0,31 na podwojenie: od 0,50 poniżej 150 BPM (n = 11) do 0,19 przy ≥ 210 BPM (n = 7). Odstępy 1/1 rosną (+0,08).
- Najkrótszy typowy odstęp (`gap_ms.p5`) wynosi 86 ms przy 180 BPM i skraca się o 25 ms na podwojenie BPM. W beatach to zawsze 1/4 (`gap_beats.p5` = 0,249 we wszystkich przedziałach).

Ludzie trzymają więc stałe tempo nut w czasie i zmieniają podział, czyli robią to, co RC opisuje jako skalowanie wokół 180 BPM. Najdrobniejszym podziałem na Hard pozostaje 1/4, nawet przy ≥ 210 BPM. Klasa: silna tendencja (zależność potwierdzona na teście).

### 2.3 Wzorce i powtarzalność

- **Kroki między pojedynczymi nutami**: o 1 tor 0,62, o 2 tory 0,25, o 3 tory 0,10, ten sam tor 0,02. Zmiana ręki w 0,62 przypadków.
- **Wzorce**: `trill_share` 0,017 / 0,041 / 0,091 (≤ 0,12 w 97% map, test 95%: twarda zasada). `stair_share` 0,005 / 0,044 / 0,105 (styl). Najdłuższy tryl (pomocn.) ma 5 nut, a > 9 nut ma tylko 2,7% map.
- **Różnorodność**: `pattern4_entropy_bits` 8,3 (7,8–8,9), `pattern4_distinct_per_100` 55 (37–79). Mocno zależy od gatunku (sekcja 3).
- **Balans rąk**: `left_hand_share` 0,493 / 0,499 / 0,506 (99% map w 48–52%). W każdym oknie 4 taktów mediana odchylenia od 50% wynosi 1,6 pp (p90 3,8 pp), a okien z przewagą powyżej 70/30 nie ma wcale (pomocn.). Twarda zasada, potwierdzona na teście.
- **Powtórzenie muzyki = powtórzenie wzorca** (oficjalnie, `repetition.*`, n = 60 map z parami, m = 50):

| | rytm | tory | tory z lustrem |
|---|---|---|---|
| powtórzenia | 0,91 (0,85–0,99) | 0,24 | 0,47 |
| linia bazowa | 0,62 (0,41–0,78) | 0,15 | 0,20 |

W mierze pomocniczej odpornej na drganie (sekcja 8) różnica powtórzenie − baza wynosi dla rytmu 0,26 (p10 0,11), a dla torów 0,17. Rytm powtarza się ponad bazę w 92% map, tory w 87%. Na teście kierunek jest ten sam (0,25 i 0,16). Klasa: silna tendencja. Ludzie powtarzają rytm prawie dosłownie, a tory częściowo, często w lustrze.

### 2.4 Wstęp, sekcje, przejścia (`a4_sections.py`)

Granice struktury z audio (`structure_boundaries_ms`) leżą na downbeatach siatki ludzkiej. Gęstość taktu jest liczona względem mediany utworu (mediana po utworach, trening).

| granica | n granic (utworów) | takty −4…−1 | takty 0…+3 |
|---|---|---|---|
| „w górę” (RMS po/przed ≥ 1,25) | 135 (64) | 0,69–0,74 | 1,00–1,07 |
| „w dół” (≤ 0,8) | 122 (52) | 1,10–1,00 | 0,62–0,66 |
| płaska | 430 (73) | 1,00 | 1,00 |

- Gęstość idzie za głośnością: Spearman nut na takt z RMS 0,51 (0,08–0,74). Po wejściu w głośną sekcję jest średnio o 46% więcej nut, po zejściu o 36% mniej.
- **Nie ma buildupu gęstością.** Ostatni takt przed granicą ma tyle nut co trzy poprzednie (mediana 1,00, także dla granic „w górę”) i nie ma więcej 1/4.
- Przed 12% granic „w górę” jest pusty takt, czyli przerwa przed dropem. To styl, a nie reguła.
- **Akcent na granicy**:
- nuta na downbeacie granicy: 88–97% granic zależnie od rodzaju; per mapa mediana 1,0 (p10 0,84);
- akord: 73–90% granic; per mapa mediana 0,86 (p10 0,60);
- akord na ≥ 50% granic ma 96% map (test 100%): twarda zasada;
- nuta na ≥ 75% granic ma 93% map (test 95%): silna tendencja.
- **Akordy 3-nutowe zaznaczają strukturę**: 41% z nich leży na downbeatach (test 57%), a na granicach sekcji jest ich 5 razy więcej, niż wynikałoby z liczby chwil (6% wobec 1,1%).
- **Wstęp i koniec**:
- pierwsze 4 takty z nutami mają 0,77 mediany gęstości (0,33–0,97), cała pierwsza sekcja 0,77;
- ostatnie 4 takty 0,95 (0,39–1,17), więc ludzie nie wygaszają końca;
- pierwsza nuta pada po 0,66 s (p90 3,0 s).
- **Kiai**: `kiai_density_ratio` 1,25 (1,04–1,61). Kiai jest gęstsze w 96% map z kiai (n = 67): twarda zasada. Akordów jest w kiai 0,46 chwil wobec 0,41 poza nim.

### 2.5 Pauzy, odpoczynek, kontrast

- Hard u ludzi jest prawie ciągły:
- `rests_ge_2b.per_min` p50 0 (p90 2,8);
- przerw ≥ 4 beaty nie ma w 81% map, przerw ≥ 8 beatów w ponad 90%;
- `longest_rest_beats` 2 (1–6,5);
- `empty_bar_share` 0,013 (0–0,05).
Klasa: silna tendencja. Przerw jest więcej przy wyższym BPM (Spearman 0,375).
- Kontrast tworzy zmiana gęstości, nie cisza:
- `bar_notes_cv` 0,31 (0,21–0,47);
- `phrase4_notes_p90_over_p10` 1,81 (1,31–4,19);
- `bar_notes` p10/p50/p90 to mediany 8 / 13 / 16 nut na takt.

### 2.6 Reguły i sprawdzenie na teście (`a11_rules.py`, wybór)

| reguła | trening (n / m) | test | algorytm (test) | klasa |
|---|---|---|---|---|
| brak chwil poza siatką | 96% (75 / 62) | 90% | 0% | twarda |
| sloty 1/8 ≤ 1% | 92% | 100% | 5% | silna |
| odstępy „other” po kwantyzacji ≤ 2% | 96% | 100% | 0% | twarda |
| najdłuższy ciąg odstępów ≤ 1/2 ≥ 40 chwil | 96% | 90% | 30% | twarda |
| beaty zmapowane ≥ 80% | 92% | 100% | 35% | silna |
| downbeaty z nutą ≥ 85% | 91% | **80%** | 0% | silna (na teście słabiej) |
| akordy ≥ 25% chwil | 96% | 90% | 5% | twarda |
| akord na ≥ 50% zmapowanych beatów | 92% | 90% | 0% | silna |
| skoki jednej ręki ≥ 25% akordów 2-nut. | 97% | 95% | 0% | twarda |
| akordy 3-nutowe obecne | 95% | 90% | 0% | silna / twarda |
| brak akordów 4-nutowych | 96% | 100% | 100% | twarda |
| lewa ręka 48–52% | 99% | 100% | 15% | twarda |
| balans w 4 taktach ≤ 3 pp (mediana) | 96% | 90% | 5% | twarda |
| puszczenia na siatce 1/4 ≥ 95% (≥ 10 holdów) | 95% (62 / 53) | 100% | 0% | twarda |
| hold ≥ 1/4 beatu | 100% (66 / 56) | 100% | 100% | twarda |
| mediana holda ≤ 1 beat | 91% | 94% | 0% | silna |
| holdy z nutą w środku ≤ 40% | 94% | 94% | 0% | silna |
| `trill_share` ≤ 0,12 | 97% | 95% | 5% | twarda |
| brak minijacków 1/4 | 96% | 100% | 95% | twarda |
| akord na downbeacie ≥ 50% granic | 96% | 100% | 5% | twarda |
| kiai gęstsze (ratio > 1) | 96% (67 / 54) | 95% | 100% | twarda |
| rytm powtórzeń ponad bazą ≥ 0,1 (pomocn.) | 92% | 100% | 70% | silna |
| bez przerw ≥ 4 beaty | 81% | 80% | 95% | silna |

Prawie każda reguła trzyma się na teście z dokładnością do 10 pp. Wyjątek to „downbeaty ≥ 85%”: 91% map w treningu, 80% w teście. Na teście ta reguła jest słabsza.

## 3. Gatunki (`a9_genres.py`)

Dość map mają cztery gatunki (trening n / m):

| gatunek | n / m | mediana BPM |
|---|---|---|
| anime | 18 / 18 | 170 |
| electronic | 19 / 16 | 200 |
| video game | 16 / 14 | 184 |
| pop | 13 / 13 | 164 |

W teście są po 4–6 utworów na gatunek. **Pozostałe są za małe do wniosków**: rock (3), metal, classical, hip hop, jazz, novelty i folk (po 1), łącznie 9 map w treningu i 1 w teście. Gatunek jest pomieszany z BPM, więc efekt gatunku liczę po odjęciu BPM (OLS z log2 BPM, test F).

**Wspólne dla wszystkich czterech gatunków**:
- puszczenia holdów na siatce (mediana 1,00 w każdym);
- balans rąk: odchylenie w 4 taktach 1,4–1,8 pp;
- puste sloty 1/8;
- beaty i półbeaty zmapowane;
- skoki jednej ręki: 47–50% akordów 2-nutowych;
- kiai gęstsze: mediany 1,14–1,30;
- rytm powtórzeń: 0,90–0,93;
- stałe nps po uwzględnieniu BPM (p = 0,08).

**Zależne od gatunku** (trening, p po uwzględnieniu BPM; „test” to liczba gatunków z tym samym kierunkiem na teście):

| cecha | anime | electronic | video game | pop | p | test |
|---|---|---|---|---|---|---|
| `chord_share` (mediana) | 0,52 | 0,38 | 0,36 | 0,44 | 0,005 | 4 / 4 |
| akord na zmapowanym beacie | 0,83 | 0,69 | 0,72 | 0,86 | 0,38 | 3 / 4 |
| `pattern4_distinct_per_100` | 73 | 47 | 52 | 60 | < 0,001 | 4 / 4 |
| `hold_share` | 0,146 | 0,031 | 0,065 | 0,132 | 0,14 | 4 / 4 |
| `stair_share` | 0,021 | 0,035 | 0,062 | 0,038 | 0,001 | 3 / 4 |
| `plugin_events.snare.recall` | 0,55 | 0,71 | 0,68 | 0,70 | < 0,001 | 3 / 4 |
| `minijack_share` | 0,165 | 0,148 | 0,092 | 0,181 | 0,037 | 4 / 4 |
| `gap_share.1/2` | 0,64 | 0,62 | 0,49 | 0,63 | 0,043 | 4 / 4 |

- **anime i pop**: więcej akordów, bardziej zróżnicowane wzorce, więcej holdów, mniej trzymania się werbla (zwłaszcza anime). To styl gatunku, potwierdzony na teście.
- **electronic i video game**: bardziej powtarzalne wzorce, mniej holdów, więcej schodów i 1/4 (VG), mniej akordów.
- Liczba nut na beat różni się między gatunkami tylko przez BPM (po uwzględnieniu BPM p = 0,054, na teście kierunek zgodny w 2 z 4 gatunków). Wniosku o gatunku tu nie wyciągam.
- Utwory „other” (9 map) nie pozwalają na wnioski.

## 4. Ranking Criteria i poradnik a dane

RC (część ogólna i Hard) dotyczy rytmu przy około 180 BPM. Mediana BPM korpusu Hard to 175.

| wytyczna (Hard / ogólna) | dane (trening n = 75; test n = 20) | ocena |
|---|---|---|
| HP i OD ≤ 8 | OD ≤ 8 w 99% map (jedna 8,5) | zgodne |
| Bez kolejnych 1/8 i drobniejszych (wyjątek: 3 grace notes) | `run_1/8.max_notes` ≤ 3 w 92% map. Wyjątki (6 map) mają głównie BPM 100–144, gdzie 1/8 to 1/4 przy 200–290 BPM | zgodne, w praktyce skalowane BPM |
| Długie strumienie 1/4 z pauzą 1/2 po każdej frazie | `run_1/4.max_notes` p50 17, p90 49. Serie > 64 nut (fraza 4 taktów bez pauzy) ma 5 map z 75 | zgodne dla ok. 93% |
| Akordy w strumieniach 1/4 co najmniej 1/1 od siebie | W 43 mapach z akordami w strumieniach 1/4 mediana udziału par akordów bliżej niż 1 beat wynosi 0,04, ale w 37% map większość par jest bliżej (pomocn.) | zgodne u ok. 2/3, u 1/3 (jumpstreamy) **nie** |
| Unikać anchorów ≥ 5 nut | `anchor_max_notes` p50 8 i ≥ 5 w 97% map | **sprzeczne**. Metryka jest przybliżeniem (co druga chwila), a w jumpstreamach 1/2 przy 180 BPM długie anchory są normalne |
| 1/4 jacki odradzane | `minijack_fast_share` ≈ 0 w 96% map | zgodne |
| ≤ 9 nut w trylu | tryl > 9 nut tylko w 2,7% map (pomocn.) | zgodne |
| Hold ≥ 1/4 beatu | 100% map | zgodne |
| 4K: akordy ≤ 3 nuty | 4-nutowych brak w 96% map | zgodne |
| Unikać akordów w środku strumieni 1/6 | triole rzadkie (`triplet_share` p90 0,04) | brak danych do oceny |
| Każda nuta odpowiada dźwiękowi | `no_sound_share` p50 0,09 (p90 0,22). Detektory gubią część onsetów | nie da się ocenić ostro |
| Przerwy tylko w bardzo spokojnych miejscach | przerw ≥ 4 beaty brak w 81% map | zgodne |
| Skalowanie BPM (120 i 240 jako progi podwajania) | nps stałe, nuty/beat −2,0 na podwojenie BPM, udział 1/4 od 0,50 (< 150) do 0,19 (≥ 210) | zgodne co do kierunku. Ale 1/4 zostaje w użyciu także przy ≥ 210 BPM (10% odstępów) |

Poradnik osu!mania (część Hard):

| rada | dane | ocena |
|---|---|---|
| Dłuższe 1/4 bursty i schody | `stair_share` p50 0,044 | umiarkowanie, styl (VG > anime) |
| Akordy 3-nutowe na początku lub końcu części | 41% na downbeatach i 5 razy częściej na granicach sekcji | zgodne |
| Krótkie jumpstreamy | ludzie robią długie: ciąg odstępów ≤ 1/2 p50 137 chwil, akordy na 76% beatów | dane idą dalej niż poradnik |
| Kiai najgęstsze | 96% map | zgodne |
| Łączyć LN z pojedynczymi nutami 1/4 | holdy z nutą w środku p50 0,18, nuty drugiej ręki w holdzie p50 0/beat | **w tym zakresie SR raczej nie**: LN są krótkie i zwykle bez nut w środku |
| Bursty 1/6 ≤ 1/2 beatu, 1/8 ≤ 1/4 beatu | `run_1/8` p90 3 nuty (zgodne), `run_1/6` > 4 nut w 10 mapach | prawie zgodne |

## 5. Algorytm a ludzie na zbiorze testowym (20 utworów)

**Beat tracking generatora** (`songs/*.json`, 19 utworów z siatką):
- tempo połówkowe (`human_beat_over_algo_beat` = 0,5) w 8 z 19 utworów; ludzkie tempo w 11;
- złożenie ×2 (`fold_factor` 2) w 4;
- downbeat zgodny z ludzkim w ≤ 20% przypadków w 12 z 19;
- ≥ 20% beatów algorytmu na ludzkich półbeatach (zła faza) w 4;
- brak siatki (`NO_TIMING`) w 1 utworze (2270163).

Warstwa prowadząca: perkusja w 68% fraz, lead w 24%, bas w 7%, ścieżka `bands` w 0% (z 324 fraz).

Tabela (`a15_report_tables.py`, `tables/report_table_test.csv`). „Poza p10–p90” to udział chartów algorytmu poza zakresem p10–p90 ludzi z treningu. p to test Wilcoxona dla par utwór-utwór, n = 20.

| metryka | ludzie test p10 / p50 / p90 | algorytm p10 / p50 / p90 | ludzie trening p10–p90 | algorytm poza p10–p90 treningu | Wilcoxon p |
|---|---|---|---|---|---|
| nuty/s (`nps`) | 8,06 / 9,11 / 10,9 | 5,26 / 7,04 / 7,76 | 8,00–10,6 | 90% | 2e-06 |
| nuty/beat (`notes_per_beat`) | 2,61 / 3,10 / 3,54 | 1,84 / 2,26 / 2,64 | 2,56–4,04 | 80% | 2e-06 |
| chwile/beat (`moments_per_beat`) | 1,75 / 2,02 / 2,31 | 1,74 / 2,01 / 2,35 | 1,73–2,67 | 10% | 0,985 |
| szczyt 8 s, nuty/s (`nps_peak8s`) | 10,9 / 11,7 / 13,0 | 7,30 / 9,06 / 9,89 | 10,7–13,8 | 100% | 9e-05 |
| udział akordów (`chord_share`) | 0,29 / 0,50 / 0,56 | 0,054 / 0,11 / 0,20 | 0,27–0,57 | 95% | 4e-06 |
| akordy 3-nutowe (`chord_size_share.3`) | 0,001 / 0,036 / 0,19 | 0 / 0 / 0 | 0,002–0,16 | 100% | 2e-04 |
| akordy 2-nut. na 2 ręce (`chord2_split_hands_share`) | 0,45 / 0,52 / 0,68 | 0,94 / 0,99 / 1,00 | 0,41–0,68 | 100% | 2e-06 |
| akordy poza beatem (`chord_position_share.offbeat`) | 0,08 / 0,23 / 0,36 | 0,36 / 0,59 / 0,82 | 0,09–0,37 | 85% | 2e-06 |
| akord na zmapowanym beacie (sloty) | 0,55 / 0,80 / 0,93 | 0,046 / 0,16 / 0,28 | 0,52–0,91 | 100% | 2e-06 |
| akord na downbeacie granicy sekcji (`sections.boundary_chord_share`) | 0,61 / 0,88 / 1,00 | 0 / 0 / 0,20 | 0,60–1,00 | 100% | 9e-05 |
| beaty zmapowane (sloty) | 0,85 / 0,95 / 0,99 | 0,61 / 0,77 / 0,84 | 0,82–0,98 | 75% | 2e-06 |
| półbeaty zmapowane (sloty) | 0,65 / 0,82 / 0,93 | 0,46 / 0,67 / 0,74 | 0,65–0,95 | 45% | 2e-04 |
| sloty 1/4 zmapowane | 0,044 / 0,096 / 0,24 | 0,12 / 0,24 / 0,33 | 0,042–0,42 | 0% | 0,005 |
| sloty 1/8 zmapowane | 0 / 0 / 0,003 | 0,015 / 0,040 / 0,090 | 0–0,003 | 100% | 2e-06 |
| downbeaty z nutą (`downbeats_carried`) | 0,78 / 0,96 / 1,00 | 0,46 / 0,66 / 0,72 | 0,85–1,00 | 100% | 2e-06 |
| chwile na 1/16 (`snap_share.16`) | 0 / 0 / 0,004 | 0,021 / 0,12 / 0,24 | 0–0 | 100% | 2e-06 |
| chwile poza siatką (`snap_share.off`) | 0 / 0 / 0 | 0,011 / 0,035 / 0,079 | 0–0 | 100% | 2e-06 |
| błąd siatki p50, ms (`grid_error_ms.p50`) | 0 / 0,48 / 0,52 | 2,76 / 4,12 / 6,61 | 0–0,53 | 100% | 2e-06 |
| odstępy „other” po kwantyzacji (pomocn.) | 0 / 0,002 / 0,011 | 0,043 / 0,099 / 0,25 | 0–0,013 | 100% | 2e-06 |
| odstępy 3/4 po kwantyzacji (pomocn.) | 0 / 0,002 / 0,026 | 0,034 / 0,057 / 0,10 | 0–0,033 | 90% | 2e-05 |
| najdł. seria 1/2 (`run_1/2.max_notes`) | 19,6 / 36,5 / 100 | 7 / 12 / 19,2 | 13,8–76,4 | 65% | 1e-04 |
| serie 1/2 na minutę (`run_1/2.count_per_min`) | 24,9 / 36,2 / 48,5 | 46,2 / 61,9 / 74,0 | 19,1–63,5 | 45% | 6e-06 |
| najdł. ciąg odstępów ≤ 1/2 po kwantyzacji (pomocn.) | 42,6 / 130 / 314 | 16,8 / 28,5 / 62,0 | 66,4–320 | 95% | 4e-06 |
| udział holdów (`hold_share`) | 0,008 / 0,066 / 0,25 | 0,024 / 0,070 / 0,096 | 0–0,24 | 0% | 0,123 |
| długość holda p50, beaty (`hold_len_beats.p50`) | 0,50 / 0,50 / 1,00 | 1,38 / 1,71 / 2,85 | 0,50–1,00 | 100% | 8e-06 |
| holdy < 1 beatu (`hold_short_share.lt_1`) | 0,32 / 0,72 / 0,90 | 0 / 0 / 0,025 | 0,31–0,94 | 100% | 2e-04 |
| puszczenia na 1/1 + 1/2 + 1/4 (`release_snap_share`, suma) | 0,86 / 1,00 / 1,00 | 0,15 / 0,32 / 0,56 | 0,97–1,00 (mapy z holdami) | 100% | 8e-06 |
| holdy z nutą w środku (`holds_with_notes_inside_share`) | 0 / 0,19 / 0,37 | 0,82 / 0,96 / 1,00 | 0,002–0,38 | 100% | 8e-06 |
| nuty drugiej ręki/beat w holdzie p50 | 0 / 0 / 0 | 1,05 / 1,50 / 1,85 | 0–0 | 100% | 8e-06 |
| lewa ręka (`left_hand_share`) | 0,49 / 0,50 / 0,51 | 0,37 / 0,45 / 0,54 | 0,49–0,51 | 95% | 0,007 |
| odchylenie rąk w 4 taktach p50 (pomocn.) | 0,010 / 0,018 / 0,025 | 0,034 / 0,067 / 0,14 | 0,010–0,025 | 100% | 4e-06 |
| tryle (`trill_share`) | 0,012 / 0,042 / 0,10 | 0,13 / 0,20 / 0,29 | 0,017–0,091 | 100% | 2e-06 |
| pojedyncze na tym samym torze (`single_step_share.0`) | 0 / 0,017 / 0,057 | 0,062 / 0,10 / 0,15 | 0–0,072 | 75% | 1e-05 |
| różne układy 4 chwil / 100 (`pattern4_distinct_per_100`) | 47,9 / 59,6 / 77,8 | 34,5 / 47,3 / 72,0 | 36,6–78,8 | 15% | 0,040 |
| chwile na onsecie perkusyjnym (`alignment.perc.share`) | 0,50 / 0,70 / 0,88 | 0,39 / 0,56 / 0,76 | 0,51–0,87 | 40% | 2e-06 |
| chwile bez dźwięku (`alignment.no_sound_share`) | 0,026 / 0,10 / 0,17 | 0,090 / 0,19 / 0,29 | 0,023–0,22 | 40% | 6e-06 |
| recall leadu (`plugin_events.lead.recall`) | 0,38 / 0,53 / 0,64 | 0,54 / 0,65 / 0,77 | 0,35–0,67 | 40% | 0,002 |
| recall basu (`plugin_events.bass.recall`) | 0,38 / 0,46 / 0,71 | 0,46 / 0,66 / 0,76 | 0,33–0,70 | 30% | 3e-05 |
| recall hi-hatu (`plugin_events.hat.recall`) | 0 / 0,50 / 0,72 | 0 / 0,087 / 0,43 | 0–1,00 | 0% | 0,006 |
| rytm powtórzeń: powtórzenie − baza (pomocn.) | 0,16 / 0,25 / 0,37 | 0,063 / 0,17 / 0,26 | 0,11–0,43 | 35% | 0,004 |
| tory powtórzeń: powtórzenie − baza (pomocn.) | 0,070 / 0,16 / 0,27 | −0,012 / 0,060 / 0,16 | 0,036–0,39 | 30% | 0,004 |
| `repetition.repeat.rhythm` (oficjalna, zob. 6.10) | 0,80 / 0,94 / 0,99 | 0,21 / 0,31 / 0,50 | 0,85–0,99 | 94% | 3e-05 |
| gęstość kiai / reszta (`kiai_density_ratio`) | 1,04 / 1,27 / 1,44 | 1,06 / 1,18 / 1,46 | 1,04–1,61 | 0% | 1,000 |
| gęstość taktu a RMS (`sections.bar_density_vs_rms_spearman`) | 0,16 / 0,49 / 0,70 | 0,38 / 0,54 / 0,76 | 0,08–0,74 | 20% | 0,053 |
| CV nut na takt (`bar_notes_cv`) | 0,19 / 0,28 / 0,41 | 0,19 / 0,26 / 0,40 | 0,21–0,47 | 20% | 0,571 |
| kontrast 4 taktów p90/p10 | 1,27 / 1,76 / 2,30 | 1,31 / 1,69 / 2,42 | 1,31–4,19 | 10% | 0,812 |
| przerwy ≥ 2 beaty / min | 0 / 0 / 2,71 | 0 / 0,39 / 1,66 | 0–2,81 | 5% | 0,363 |
| puste takty (`empty_bar_share`) | 0 / 0,011 / 0,039 | 0 / 0 / 0,001 | 0–0,050 | 0% | 0,002 |
| pierwsza nuta, ms (`first_ms`) | 345 / 803 / 2006 | 1522 / 1584 / 2190 | 177–3006 | 10% | 0,012 |

**Co się zgadza:**
- chwile na beat;
- kształt gęstości wokół granic: przed granicą „w górę” 0,71–0,84, po niej 1,00–1,17; po granicy „w dół” 0,58–0,80 (ludzie: 0,70–0,75, 1,04–1,12 i 0,67–0,75);
- kiai, CV taktów, kontrast fraz, przerwy;
- `minijack_share` (0,145 wobec 0,137), `anchor_max_notes` (8 wobec 8,5), `max_simultaneous_holds` (2 wobec 2);
- udział holdów.

Makrodynamika jest więc w porządku. Problemy są w mikrostrukturze.

**W podziale na gatunki** (mediany, ludzie → algorytm; n utworów testowych; „other” = 1 utwór, za mało):

| metryka (mediana) | anime (n = 5) | electronic (n = 6) | video game (n = 4) | pop (n = 4) | other (n = 1) |
|---|---|---|---|---|---|
| `nps` | 9,31 → 7,36 | 9,42 → 7,22 | 9,08 → 7,33 | 9,14 → 5,71 | 8,58 → 6,83 |
| `chord_share` | 0,52 → 0,16 | 0,35 → 0,095 | 0,37 → 0,15 | 0,53 → 0,072 | 0,39 → 0,19 |
| akord na zmapowanym beacie | 0,82 → 0,23 | 0,59 → 0,15 | 0,71 → 0,19 | 0,89 → 0,12 | 0,67 → 0,16 |
| półbeaty zmapowane | 0,77 → 0,63 | 0,90 → 0,60 | 0,73 → 0,71 | 0,89 → 0,60 | 0,85 → 0,74 |
| sloty 1/8 zmapowane | 0,002 → 0,039 | 0 → 0,050 | 0 → 0,029 | 0,002 → 0,043 | 0 → 0,026 |
| odstępy „other” po kwantyzacji | 0,009 → 0,096 | 0,001 → 0,13 | 0,002 → 0,076 | 0,004 → 0,15 | 0,002 → 0,052 |
| najdł. ciąg ≤ 1/2 (kwant.) | 43 → 21 | 125 → 28,5 | 135 → 30,5 | 280 → 38,5 | 298 → 29 |
| `snap_share.16` | 0 → 0,12 | 0 → 0,13 | 0 → 0,086 | 0,001 → 0,047 | 0 → 0,044 |
| `hold_len_beats.p50` | 0,50 → 1,43 | 1,00 → 2,02 | 1,00 → 2,17 | 0,50 → 1,70 | 0,50 → 1,90 |
| puszczenia na siatce 1/4 (pomocn.) | 1,00 → 0,28 | 1,00 → 0,29 | 1,00 → 0,45 | 1,00 → 0,35 | 1,00 → 0,36 |
| `holds_with_notes_inside_share` | 0,29 → 0,96 | 0,031 → 0,93 | 0,16 → 0,97 | 0,22 → 0,92 | 0 → 0,91 |
| `left_hand_share` | 0,50 → 0,53 | 0,50 → 0,40 | 0,50 → 0,46 | 0,50 → 0,48 | 0,50 → 0,43 |
| `trill_share` | 0,025 → 0,15 | 0,062 → 0,24 | 0,072 → 0,18 | 0,019 → 0,27 | 0,029 → 0,13 |
| `alignment.perc.share` | 0,70 → 0,47 | 0,70 → 0,57 | 0,65 → 0,55 | 0,75 → 0,57 | 0,88 → 0,79 |
| `plugin_events.lead.recall` | 0,41 → 0,64 | 0,53 → 0,64 | 0,58 → 0,59 | 0,57 → 0,68 | 0,56 → 0,78 |
| `sections.boundary_chord_share` | 1,00 → 0,11 | 0,82 → 0 | 0,77 → 0,042 | 1,00 → 0 | 0,80 → 0,20 |

- Kierunek różnic jest ten sam w każdym gatunku.
- **Pop** ma największy niedobór gęstości i akordów. Dwa z czterech utworów pop prowadzi lead, a w utworach prowadzonych przez lead (1000722, 1784295, 2515207) algorytm daje 3,9–5,3 nuty/s i 3–6% akordów.
- **Electronic** ma najsłabszy balans rąk (lewa 0,40) i dużo tryli.
- **Anime** ma najmniej chwil na onsecie perkusyjnym (0,47).

Gatunkowy styl ludzi (więcej akordów w anime i pop, więcej powtarzalności w electronic i VG) nie przekłada się na różnicę u algorytmu, bo jego charty wszędzie mają mało akordów.

## 6. Problemy algorytmu na Hard (od największego wpływu)

Kod: `helpers/mewbeat/charts/` (generator v19) oraz `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/`. „Test” w punktach oznacza, że reguła ludzi trzyma się na 20 utworach testowych.

### 6.1 Rytm bez szkieletu: dziury w ciągu półbeatów, nuty na 1/8, odstępy 3/8, 5/8 i 3/4

**Co jest nie tak.** Ludzki Hard to ciągła siatka 1/2 z dodatkami 1/4. Algorytm gubi beaty i półbeaty, a dokłada nuty na ludzkich 1/8. Strumień rozpada się przez to na krótkie kawałki o nieregularnych odstępach.

**Dowód** (n = 20):

| miara | ludzie | algorytm |
|---|---|---|
| beaty zmapowane | 0,95 | 0,77 |
| półbeaty zmapowane | 0,82 | 0,67 |
| downbeaty z nutą | 0,96 | 0,66 (100% utworów poniżej p10 ludzi) |
| sloty 1/8 zmapowane | 0,000 | 0,040 (`snap_share.8` 0,027) |
| odstępy „other” po kwantyzacji | 0,002 | 0,099 |
| odstępy 3/4 po kwantyzacji | 0,002 | 0,057 |
| najdłuższy ciąg odstępów ≤ 1/2 | 130 | 28,5 |
| `run_1/2.max_notes` | 36,5 | 12 |
| serie 1/2 na minutę | 36 | 62 |

- Odstępy „other” po kwantyzacji do najbliższego slotu to w 51% 3/8 beatu, w 25% 5/8 i w 8% 7/8.
- Kwantyzacja usuwa wpływ drgania siatki, więc to rzeczywisty wybór rytmu, a nie artefakt metryki.
- Nut na 1/8 jest więcej tam, gdzie siatka algorytmu ma ludzkie tempo: 4,4% slotów 1/8 wobec 1,8% przy tempie połówkowym (Spearman z `human_beat_over_algo_beat` 0,75).

**Klasa:** twarde zasady i silne tendencje ludzi:

| reguła | trening | test | algorytm |
|---|---|---|---|
| „other” ≤ 2% | 96% map | 100% | 0% |
| ciąg ≥ 40 | 96% | 90% | 30% |
| 1/8 ≤ 1% | 92% | 100% | 5% |
| beaty ≥ 80% | 92% | 100% | 35% |

Downbeaty ≥ 85% mają ludzie w 91% map w treningu, ale tylko w 80% na teście.

**Gdzie w kodzie:**
- `patterns.js` → `tonalEvents`: nuta basu lub leadu na siatce 1/8 dostaje `level = 1` (komentarz: „A sung line syncopates”). W `difficultyFilter.js` → `applyDifficulty` funkcja `onGrid` przenosi ją na `coarseT` (1/4) tylko przy `maxLevel < 2`, czyli na Hard synkopa 1/8 zostaje. W utworze prowadzonym przez wokal (1784295) daje to 34% odstępów „other”.
- `patterns.js` → `drumEvents`: uderzenie na 1/8 dostaje `level 2`, a Hard (`maxLevel 2`) je przyjmuje.
- `grid.js` → `snapToQuarterGrid`: zdarzenie dalej niż 1/16 beatu od punktu 1/4 trafia na 1/8. Rozmyte onsety wokalu lądują przez to na 1/8.
- `difficultyFilter.js` → `selectByFloors` z `byPriority` (poziom, potem siła). Na Hard nie ma `leaderFirst` ani `beatBias`, więc limit gęstości wycina słabsze zdarzenia gdziekolwiek, także na beatach. Nic nie pilnuje ciągłości pulsu.
- Dolny limit `pulseNotesPerBeat: 2` (`difficulty.js`) działa tylko we frazie perkusyjnej ze stałym pulsem (`phrases.js` → `hasSteadyPulse`).

**Wpływ: wysoki.** Gracz czuje puls przez ciągłość 1/2. Odstępy 3/8 i 5/8 w środku strumienia czyta się jak błędy, zwłaszcza przy stałej prędkości spadania.

**Adaptacja z osu!** Reguła „bez 1/8 na Hard” w RC jest liczona dla 180 BPM. Przy wolnych utworach, które bot gra częściej (< 150 BPM), ludzie mają więcej 1/4 (do 50% odstępów), ale 1/8 nadal nie (sekcja 2.2). Próg należy więc wyrażać w beatach ludzkiego tempa, a nie w beatach siatki algorytmu.

### 6.2 Akordy: prawie ich nie ma, zawsze na dwie ręce i nie tam, gdzie głośno

**Dowód** (n = 20, ludzie → algorytm):

| miara | ludzie | algorytm |
|---|---|---|
| `chord_share` | 0,50 | 0,11 (95% utworów poniżej p10 ludzi) |
| akord na zmapowanym beacie | 0,80 | 0,16 |
| akord na downbeacie | 0,81 | 0,15 |
| akord na granicy sekcji | 0,88 | 0,00 |
| akordy 3-nutowe | 0,036 | 0 |
| akordy na dwie ręce | 0,52 | 0,99 (skoki jednej ręki 0,48 → 0,014) |
| akordy poza beatem | 0,23 | 0,59 |
| Spearman akordów w takcie z RMS | 0,47 | 0,24 |
| akordy w strumieniach 1/4 (pomocn.) | 0,22 | 0,03 |

Model akordu na beacie z treningu ludzi osiąga AUC 0,74 na ludziach z testu i 0,52 na algorytmie. Akordy algorytmu są dla ludzkich cech (głośność, perkusja) przypadkowe. U samego algorytmu akord na beacie zależy od pozycji w siatce (downbeat +0,67, beat 2 lub 4 +0,61), a nie od RMS (−0,10).

**Klasa:** twarde zasady:

| reguła | trening | test | algorytm |
|---|---|---|---|
| ≥ 25% chwil | 96% | 90% | 5% |
| skoki jednej ręki ≥ 25% | 97% | 95% | 0% |
| akord na granicy sekcji | 96% | 100% | 5% |

Akordy obecne są w każdym gatunku (sekcja 3); ich częstość zależy od gatunku (anime i pop więcej).

**Gdzie w kodzie:**
- `patterns.js` → `withChords`: jedyny celowy akord na ścieżce wzorca to nuta lustrzana pod pojedynczym zdarzeniem poziomu 0 na początku taktu algorytmu (`isBarStart`). To najwyżej 1 akord na takt. Przy 8 chwilach na takt daje to ok. 12%, czyli dokładnie poziom algorytmu.
- `mirror = 3 − lane` zawsze wybiera drugą rękę, stąd 99% akordów na dwie ręce.
- Takt algorytmu to co 4. surowy beat. Przy tempie połówkowym (8 z 19) albo złożeniu ×2 (`timing.js` → `doubleBeats` zostawia stare downbeaty, 4 z 19) „takt” trwa 2 ludzkie takty, więc akcent wypada raz na 2 takty.
- Fazę downbeatu wybiera `TempoEstimator.downbeatPhase` raz na cały utwór, z maksimum energii niskiego pasma. W 12 z 19 utworów zgadza się z ludzką w ≤ 20% przypadków, stąd akordy poza beatem.
- `patterns.js` → `patternEvents` i `difficultyFilter.js` → `capMoments(…, 2)`: najwyżej 2 nuty na chwilę, więc akordów 3-nutowych nie ma wcale.
- `patterns.js` → `mixedEvents`: we frazie mieszanej jedno zdarzenie na rękę, więc akord powstaje tylko z przypadkowej zbieżności warstw, zwykle poza beatem.
- `difficulty.js`: reguła `hard.chord` (s ≥ 0,95, beat, E ≥ 0,5) działa tylko w `bandPath.js` → `chordLane`, a na teście ścieżka `bands` nie prowadzi żadnej frazy (0 z 324).

**Wpływ: wysoki.** Akord na mocnym beacie, na wejściu sekcji i w głośnym fragmencie to główne narzędzie akcentu na ludzkim Hard. Bez tego chart brzmi jak pojedyncza linia melodii.

**Adaptacja.** W osu! akordy niosą też hitsoundy (talerze), a tu hitsoundów nie ma. Akcent zostaje więc wyłącznie fizyczny i wizualny, ale nadal jest jedynym sposobem pokazania głośnego miejsca. Limit 3 nut z RC 4K i skoki jednej ręki pasują do 4 torów bez zmian.

### 6.3 Siatka i tempo: drganie, zła faza, połowa tempa, brak siatki

**Dowód:**
- `grid_error_ms.p50` 4,1 ms (2,8–6,6), p90 8 ms; ludzie 0,5 ms.
- `snap_share.16` 0,12 (0,02–0,24) i `snap_share.off` 0,035, podczas gdy ludzie mają 0 w 96% map. W utworze 808872 aż 50% chwil leży na 1/16. Spearman `grid_error_ms` z `snap_share.16` wynosi 0,73.
- Nuty algorytmu leżą stale o 0,02–0,05 beatu przed siatką, np. 808872 i 1773164 (sekcja 7).
- Tempo połówkowe w 8 z 19 utworów (np. 190 BPM wykryte jako 95), złożenie ×2 w 4.
- Downbeat w złej fazie w 12 z 19, beaty na ludzkich półbeatach (≥ 20%) w 4 (1570640: 38%).
- 2270163 nie ma siatki wcale: 29% odstępów „other” i 17% slotów 1/8.

**Klasa:** twarda zasada (brak chwil poza siatką: 96% map w treningu, 90% w teście, 0% u algorytmu).

**Gdzie w kodzie:**
- `TempoEstimator.java`:
- beaty są indeksami hopów 10,7 ms (`beatHops`, `FeatureExtractor` → `hopTimeMs`), więc każdy beat ma błąd kwantyzacji do ±5 ms;
- prior log-Gauss wokół 120 BPM (σ 1,4 oktawy) ciągnie szybkie utwory do połowy tempa;
- `downbeatPhase` daje jedną fazę taktu na cały utwór.
- `timing.js`:
- `foldTempo` składa tempo tylko do 70–200 BPM. Reguła half-time (`HALF_TIME_BELOW_BPM` 95, ≥ 8 onsetów na beat) nie łapie 95–115 BPM;
- `doubleBeats` interpoluje środek beatu i nie przelicza downbeatów;
- `gridPoints` interpoluje liniowo między drgającymi beatami;
- `buildTiming` zwraca `NO_TIMING` poniżej progu pewności.
- `generate.js` → `chartFrom` zapisuje `bpm` ze złożonej siatki (95 zamiast 190), a gra skaluje nim prędkość spadania.

**Wpływ: wysoki.** Drganie 4–8 ms mieści się w PERFECT (40 ms), ale przy stałej prędkości widać nierówne odstępy w strumieniu 1/4: przy 180 BPM ±8 ms to ±10% odstępu. Zła faza i połowa tempa psują dodatkowo akcenty (6.2), poziomy zdarzeń (6.1) i holdy (6.4). Wpływ `chart.bpm` na prędkość spadania trzeba sprawdzić w grze: liczby tego nie mierzą.

**Adaptacja.** W osu! timing ustawia człowiek, a tu siatka musi być równa sama w sobie. Ponieważ bot może grać inny upload z innym przesunięciem, równość odstępów w obrębie chartu jest ważniejsza niż trafienie w każdy onset.

### 6.4 Holdy: za długie, puszczane poza siatką, z grającą drugą ręką

**Dowód** (n = 20):

| miara | ludzie | algorytm |
|---|---|---|
| `hold_len_beats.p50` | 0,50 | 1,71 (100% utworów powyżej p90 ludzi) |
| holdy < 1 beatu | 72% | 0% |
| puszczenia na 1/1 + 1/2 + 1/4 (oficjalny `release_snap_share`) | 1,00 | 0,32 (reszta na 1/16, 1/12, 1/8, 1/6, 1/3 i poza siatką) |
| `holds_with_notes_inside_share` | 0,19 | 0,96 |
| nuty drugiej ręki / beat w holdzie | 0 | 1,5 |
| głowa holda w akordzie | 0,60 | 0,27 |
| start holda poza siatką 1/2 | 5% | 32% |
| udział holdów | 0,066 | 0,070 (bez różnicy) |

**Klasa:**

| reguła | trening | test | algorytm | klasa |
|---|---|---|---|---|
| puszczenia na siatce 1/4 | 95% map (n = 62) | 100% | 0% | twarda |
| mediana ≤ 1 beat | 91% | 94% | 0% | silna |
| nuta w środku ≤ 40% holdów | 94% | 94% | 0% | silna |

Sama obecność holdów to styl (83% map, zależnie od gatunku: anime i pop więcej).

**Gdzie w kodzie** (`holds.js`):
- `planHolds` i `addSustainHolds`: `len = min(sustainMs, 4 beaty, następna nuta toru − minLaneGapMs, …)`. Długość pochodzi z czasu nuty z pitch trackera w ms i nie jest przyciągana do siatki.
- `addGapHolds`: hold ręki, która odpoczywa ≥ `GAP_MIN_BEATS` 1,25 beatu, kończy się „następna nuta − odstęp”, co daje puszczenie poza siatką.
- `holdMinBeats: 1` beatu algorytmu, czyli 2 ludzkie beaty przy tempie połówkowym.
- `difficulty.js` → `hard.holdOtherHand: "free"`: druga ręka gra bez ograniczeń.
- `generate.js` → `finish` → `limitHoldShare` (12% na frazę) ogranicza tylko liczbę holdów, nie ich kształt.

**Wpływ: średni do wysokiego.** Puszczenie poza siatką jest oceniane (okno ×1,5), więc gracz musi puścić klawisz w momencie, w którym muzyka nic nie robi. Długi hold z grającą drugą ręką to umiejętność, której ludzki Hard w tym zakresie SR prawie nie wymaga.

**Adaptacja.** Puszczenie w grze ma okno ×1,5 (do 165 ms GOOD), więc holdy 1/2 beatu z RC są tu wykonalne. Holdy w tej grze nie mają hitsoundów, więc ich jedyną rolą jest rytm i czytelność dźwięku trzymanego.

### 6.5 Gęstość za niska

**Dowód:**
- `nps` 7,0 wobec 9,1 (90% utworów poniżej p10 ludzi), `nps_peak8s` 9,1 wobec 11,7 (100%).
- Okno 2 s: p90 9,0 wobec 11,5, maksimum 10 wobec 14.
- Chwil na beat jest tyle samo (2,01 wobec 2,02). Cała różnica wynika z akordów (6.2).
- W utworach prowadzonych przez lead: 3,9–5,3 nuty/s.

**Klasa:** silna tendencja (nps 7,5–11 w 92% map, test 90%; w dużej mierze wynika z definicji poziomu przez SR).

**Gdzie w kodzie:**
- `difficultyFilter.js` → `densityHolds`: w oknie 2 s mieści się najwyżej `floor(maxNps · 2 · max(dolna_moc, moc) + 1)` nut, gdzie:
- `maxNps = min(10, 9 · busy)` (`busyness.js` → `effectiveDifficulty`);
- moc to średnia energia × intensywność (≤ 1,3);
- typowa moc 0,5–0,8 daje 5–8,5 nuty/s.
- Hard liczy nuty, a nie chwile (`densityByMoment` nieustawione w `difficulty.js`), więc każdy akord zabiera z limitu 2 miejsca. Dołożenie akordów bez zmiany limitu zmniejszyłoby liczbę chwil.

To, czy limit jest wąskim gardłem w każdym utworze, wymaga uruchomienia generatora z innymi parametrami (etap 3).

**Wpływ: średni.** Chart jest łatwiejszy niż ludzki Hard, ale sam niedobór gęstości mniej razi niż 6.1–6.4.

**Adaptacja.** SR osu! to inna skala niż gwiazdki gry (`stars.js`: mediana 5,05 dla tych chartów). Docelowa gęstość zależy od tego, dla kogo jest Hard w tej grze, a to musi rozstrzygnąć gracz.

### 6.6 Nierówne ręce

**Dowód:**
- `left_hand_share` 0,45 (0,37–0,54) wobec 0,50 (0,49–0,51); 95% utworów poza p10–p90 ludzi. Najsilniejsza przewaga prawej ręki w electronic (0,40).
- Odchylenie w 4 taktach (pomocn.): mediana 6,7 pp wobec 1,8 pp. Okien z przewagą > 70/30 jest u algorytmu 5,4% (p90 21%), u ludzi 0. Przykład: 1773164 1:50–1:55, lewa ręka 9% nut.

**Klasa:** twarda zasada (99% map ludzi w 48–52%; okna 4 taktów ≤ 3 pp w 96% map, test 90%).

**Gdzie w kodzie:**
- `patterns.js` → `mixedEvents`: werbel, perc, hi-hat i lead idą na prawą rękę (`MIXED_SNARE_LANES` [2, 3], `TONAL_HAND_BASE.lead = 2`, `hatsOf(split)`), a na lewą tylko stopa i bas.
- `tonalLanes`: tory z wysokości dźwięku.
- Hard nie ma `balanceHands` ani `spreadLanes` (`difficulty.js`; `seams.js` → `balanceHands` działa tylko na Easy i Normal).

**Wpływ: średni.** Przy 9 nutach/s długie przeciążenie jednej ręki męczy i odbiera wzorcom symetrię.

**Adaptacja.** „Pitch relevancy” z poradnika (niskie dźwięki po lewej) dotyczy w osu! raczej 7K. Na 4K ludzie utrzymują balans mimo wysokości dźwięków.

### 6.7 Tryle i powtórzenia toru zamiast wzorców

**Dowód:**
- `trill_share` 0,20 (0,13–0,29) wobec 0,042; 100% utworów powyżej p90 ludzi.
- Pojedyncze nuty na tym samym torze: 0,10 wobec 0,017.
- Najdłuższy tryl (pomocn.): 8 nut wobec 5,5; tryle ≥ 10 nut ma p90 1,1/min.
- Skoki jednej ręki 0,014 wobec 0,48, a `pattern4_distinct_per_100` 47 wobec 60.
- Przykład: 1773164 1:50–1:55, 4 takty tryla 2-3 prawą ręką.

**Klasa:** twarda zasada (`trill_share` ≤ 0,12 w 97% map, test 95%, algorytm 5%). Pojedyncze na tym samym torze to silna tendencja.

**Gdzie w kodzie:**
- `patterns.js` → `hitsOf`: n-ta stopa lub werbel bierze tor `n % 2` z pary (0/3 i 1/2, we frazie mieszanej 0/1 i 2/3). Każda seria jednej klasy instrumentu staje się trylem.
- `tonalLanes`: powtórzony dźwięk szybszy niż max(½ beatu, `TRILL_MIN_GAP_MS` 250) daje tryl na sąsiednim torze. Wolniejszy zostaje na torze, stąd jacki pojedynczych nut.
- `difficultyFilter.js` → `limitJacks` (`alternatives`: najpierw partner roli) oraz `barRepeats.js` → `repeatBarLanes` utrwalają te same tory.

**Wpływ: średni.** Tryl ponad 9 nut RC odradza wprost, a przy stałych rolach torów wszystkie fragmenty perkusyjne grają się tak samo.

**Adaptacja.** Stałe tory instrumentów (stopa na zewnątrz) mają w osu! sens przy keysoundach. Tu dźwięk gra bot, więc role torów nie są słyszalne, a liczy się wygoda wzorca.

### 6.8 Wybór dźwięków: linia melodyczna zamiast perkusji

**Dowód:**
- `alignment.perc.share` 0,56 wobec 0,70, `no_sound_share` 0,19 wobec 0,10.
- Recall: lead 0,65 wobec 0,53, bas 0,66 wobec 0,46, hi-hat 0,09 wobec 0,50, werbel mocny 0,80 wobec 0,88.
- W slotach 1/4: z onsetem perkusyjnym 0,37 wobec 0,61, bez onsetu 0,23 wobec 0,085.
- Model ludzi z treningu przewiduje wybory algorytmu z AUC 0,815, a ludzi z testu z AUC 0,957. U algorytmu decyduje klasa `kick` pluginu (+0,72), u ludzi stem perkusji i pasmo high.

**Klasa:** silna tendencja (recall werbla i pasm wysokich > bas i lead w każdym gatunku; anime słabiej).

**Gdzie w kodzie:**
- `phrases.js` → `chooseLeaders` i `isVocalSong`: w utworze wokalnym lead z wynikiem ≥ 0,5 (`LEAD_PREFERRED_SCORE`) wygrywa od razu, a `supportLayers` nie daje mu wsparcia.
- `patterns.js` → `secondaryEvents`: perkusja pod leadem tylko tam, gdzie lead milczy, i tylko przy energii ≥ 0,6.
- `patterns.js` → `hatsOf`: hi-haty tylko na wolnych slotach 1/4 i na poziomie 2.
- Klasyfikacja w `DrumDetector.java` myli hi-hat z werblem, a ataki tonalne ze stopą (`shared/onset_bias.json`).

**Wpływ: średni.** Wpływa na to, czy chart „czuć” jak perkusję, którą słychać. Przy wokalu prowadzącym chart robi się rzadki (pkt 6.5).

**Adaptacja.** Bot może grać inną wersję utworu (inny miks), a perkusja jest stabilniejsza między uploadami niż wokal.

### 6.9 Granice sekcji bez akcentu

**Dowód** (mediany po utworach):
- nuta na downbeacie granicy: 0,82 wobec 1,00;
- akord: 0,09 wobec 0,86;
- najczęściej brak akordu na wejściu sekcji: granice „w górę” 9% (ludzie 81–90%), „w dół” 17%.

Gęstość przed i po granicy jest dobra (sekcja 5).

**Klasa:** twarda zasada dla akordu (96% map, test 100%), silna tendencja dla nuty (93%, test 95%).

**Gdzie w kodzie:**
- Generator nie zna sekcji muzycznych. `Highlight.sections` (plugin) wyznacza je tylko z energii, a `phrases.js` → `buildPhrases` tnie po 16 beatów algorytmu (32 ludzkie przy tempie połówkowym).
- Akcent na początku taktu daje tylko `withChords` (6.2), z fazą downbeatu z `TempoEstimator`.

**Wpływ: średni.** Wejście refrenu bez akcentu czuć od razu. Akordy 3-nutowe ludzi koncentrują się właśnie tam.

**Adaptacja:** kiai w grze nie istnieje, więc granice trzeba brać z audio (np. tak jak `structure_boundaries_ms`).

### 6.10 Słabsze powtarzanie wzorca przy powtórzeniu muzyki

**Dowód:**
- Oficjalna `repetition.repeat.rhythm` daje 0,31 wobec 0,94, ale ta liczba jest w większości artefaktem. Metryka liczy rytm na slotach 1/24 beatu (14 ms przy 180 BPM), więc drganie 4–8 ms zmienia slot. Także linia bazowa algorytmu wynosi tylko 0,19 wobec 0,65.
- Miara pomocnicza na skwantyzowanych chwilach (`a6_robust.py`) daje różnicę powtórzenie − baza dla rytmu 0,17 wobec 0,25 (18 z 20 utworów poniżej ludzi), a dla torów 0,06 wobec 0,165.
- Zgodność torów w linii bazowej jest u algorytmu wyższa niż u ludzi (0,29 wobec 0,18), bo tory są przypisane do instrumentów, a nie do frazy.

**Klasa:** silna tendencja (92% i 87% map, test 100% i 90%).

**Gdzie w kodzie:**
- `repeats.js` → `copyRepeat` i `generate.js` → `copiedRepeat`: kopia tylko przy `repeatOf` z podobieństwem ≥ 0,85 na 16-beatowych frazach pluginu (`Repetition.java`), nuta ginie bez zdarzenia w ±60 ms, a przy < 50% fraza jest mapowana od nowa.
- `barRepeats.js` → `repeatBarLanes`: takty z downbeatów algorytmu, po 2 ludzkie takty przy złej siatce.

**Wpływ: niski do średniego.** Ocena jest niepewna, bo podobieństwo muzyki w mierze pomocniczej jest przybliżone bez chromy.

### 6.11 Start chartu

`first_ms` 1584 ms wobec 803 ms (p = 0,012), bo `LEAD_IN_MS` = 1500 w `difficulty.js` i `applyDifficulty`. **Wpływ: niski.** Problem dotyczy tylko utworów, w których muzyka zaczyna się od razu.

## 7. Kandydaci do testów odsłuchowych i gry

Czasy podaję na osi zdekodowanego audio z `.osz` (mm:ss). Bot może grać inny upload, więc są przybliżone. Okna to 4 takty siatki ludzkiej (`a13_candidates.py`, `tables/candidate_windows.csv`). Grać Hard algorytmu i ludzki Hard tego samego fragmentu.

1. **1784295, Rokudenashi – Tada Koe Hitotsu** (pop, 130 BPM, prowadzi lead), **2:18–2:25**. Ludzie grają ciągły jumpstream 1/2 z akordami 2–3-nutowymi na każdym beacie (78 nut, 30 akordów). Algorytm gra 43 pojedyncze nuty z melodii wokalu, z odstępami 3/8 (pozycje 3,50 / 3,87 / 4,24 / 4,61 beatu) i 2 akordami. Sprawdzić, czy rytm z wokalu „siedzi” i czy brak akcentu w refrenie razi. Fragment 2:03–2:10 ma dodatkowo 13 nut na 1/8.
2. **808872, Kobaryo – Perfect Neglect** (electronic, 230 BPM, siatka algorytmu 115 BPM), **0:59–1:04**. 31 z 39 nut leży ponad 10 ms od siatki, stale przed beatem. Ludzie mają tu akordy 3-nutowe na beatach, algorytm 1 akord. Sprawdzić, czy drganie czuć w strumieniu i jak wygląda prędkość spadania liczona z 115 BPM.
3. **1773164, TUYU – Itsuka Otona ni Nareru to Ii ne.** (pop, 176 BPM, siatka złożona ×2), **1:50–1:55**. Algorytm gra tryl 2-3 prawą ręką przez 4 takty (lewa ręka 9% nut, nuty ok. 10 ms przed beatem). Ludzie mają akordy na każdym beacie i holdy 1/2. Sprawdzić zmęczenie ręki i monotonię. Dodatkowo 0:44–0:50: 30 z 45 nut poza siatką.
4. **2270163, ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasavitsa** (electronic, 185 BPM, brak siatki), **0:36–0:42**. Ludzie grają jumpstream z akordem na każdym półbeacie (64 nuty, 30 akordów). Algorytm ma 41 nut w surowych czasach (15 na 1/8, 0 akordów). Sprawdzić czytelność chartu bez siatki.
5. **2314654, Laur – PRAGMATISM -RESURRECTION-** (electronic, 174 BPM), **2:05–2:11**. 6 holdów algorytmu z ≥ 2 nutami drugiej ręki, puszczenia poza siatką, lewa ręka 33%. Ludzki mapper też łączy tu holdy z nutami, ale puszcza je na beacie lub półbeacie. Sprawdzić, czy puszczenie „w powietrzu” jest wyczuwalne.
6. **1000722, Ohara Yuiko – Zero Centimeters (TV Size)** (anime, 154 BPM, zmienne BPM, prowadzi lead), **0:54–1:01** (granica sekcji w oknie). Ludzie mają 25 akordów, w tym 3-nutowe, i holdy. Algorytm ma 0 akordów i nuty na półbeatach przesuniętych fazą. Dalej, 1:04–1:10: holdy z grającą drugą ręką. Sprawdzić wejście sekcji i holdy.
7. **2224035, JINGBURGER – Konton Boogie** (pop, 190 BPM, siatka algorytmu 95 BPM), **2:17–2:22** (granica w oknie). Ludzie: jumpstream, akord na każdym beacie i półbeacie (69 nut). Algorytm: 34 pojedyncze nuty w naprzemienności 0-2-0-2 i 1 akord. Sprawdzić, czy chart brzmi jak ten utwór i jak działa prędkość z 95 BPM.
8. **1570640, Lime – 8bit Voyager** (electronic, 182 BPM, siatka złożona ×2, 38% beatów na ludzkich półbeatach), **1:57–2:03**. 29 z 35 nut poza siatką, pozycje 0,35 / 0,73 / 1,24 / 1,46 beatu. Sprawdzić, czy rytm jest w ogóle rozpoznawalny.
9. **563569, P\*Light feat. mow\*2 – OVERDRIVERS** (video game, 177 BPM), **1:28–1:34** (granica w oknie). 8 nut na 1/8 w gęstym fragmencie. Sprawdzić, czy 1/8 z warstw perkusji i melodii czyta się jako ozdobnik, czy jako błąd.
10. **2515207, TAK – PPPP feat. Hatsune Miku, Kasane Teto** (pop, 152 BPM, prowadzi lead), **2:13–2:19**. 82 nuty i 30 akordów u ludzi wobec 36 nut i 3 akordów u algorytmu. Sprawdzić, czy refren jest za łatwy i za płaski.

## 8. Prośby o nowe metryki

Wszystkie poniższe policzyłem tylko pomocniczo, w skryptach `levels/hard/`. Proszę o wprowadzenie ich oficjalnie dla wszystkich poziomów.

1. **Cel slotu wyłączny (`chosen`)**: każda chwila przypisana do jednego, najbliższego slotu w ±25 ms; dla algorytmu najpierw siatka binarna, bo nie ma trioli. Obecny `mapped` zapala każdy slot w ±25 ms, więc przy ≥ 180 BPM jedna chwila zapala 1/8 i sąsiedni 1/6 (np. 808872: 937 chwil, 1973 sloty `mapped`). Zawyża to gęstość slotów triolowych i myli regresję.
2. **Pokrycie siatki** `slot_coverage.{1,2,4,8}`: udział slotów beatu, półbeatu, 1/4 i 1/8 z chwilą (wg `chosen`), oraz `chord_rate_on_beats`: udział zmapowanych beatów z akordem. To najprostszy opis szkieletu rytmu (6.1, 6.2).
3. **Metryki rytmu odporne na drganie**:
 - `gap_share_q`, `run_*_q` i `dense_run_max_q` (najdłuższy ciąg odstępów ≤ 1/2): odstępy liczone na indeksach slotów po przypisaniu jak w pkt 1;
 - `repetition.*_q`: rytm i tory powtórzeń na slotach, a nie na 1/24 beatu z zaokrągleniem.
 Powód: tolerancja ±6% (5 ms przy 1/4 i 180 BPM) i sloty 1/24 (14 ms) karzą algorytm za drganie 4–8 ms. Oficjalne `repetition.repeat.rhythm` daje mu 0,31, a po kwantyzacji 0,50.
4. **Balans rąk w oknach** `hand_balance_4bar`: mediana i p90 |udział lewej − 0,5| w oknach 4 taktów z ≥ 8 nutami oraz udział okien > 0,2. Globalny `left_hand_share` ukrywa przeciążenie w fragmentach.
5. **Długość tryla** `trill_max_notes` i `trills_ge10_per_min`: najdłuższy ciąg x-y-x-y (≤ 1 beat między powtórzeniem) i liczba tryli ≥ 10 nut na minutę. To bezpośrednie sprawdzenie wytycznej RC „≤ 9 nut”.
6. **Akordy w strumieniach 1/4** `chord_gap_in_q_streams`: udział par akordów wewnątrz strumienia 1/4 (≥ 5 chwil, bez pierwszej i ostatniej) bliżej niż 1 beat. Sprawdza wytyczną RC Hard.
7. **Holdy wg długości** `holds_inside_by_length`: udział holdów z nutą w środku osobno dla holdów 1/2, 1 i ≥ 2 beatów, oraz `hold_head_in_chord`. Globalny udział miesza krótkie i długie holdy.
8. **Akordy a głośność** `bar_chords_vs_rms_spearman`: Spearman liczby akordów w takcie z RMS taktu. Uzupełnia `sections.bar_density_vs_rms_spearman`, które u algorytmu wygląda dobrze, mimo że akordy nie idą za głośnością.

## 9. Ograniczenia

- Test to 20 utworów, w gatunkach po 4–6. Wnioski gatunkowe dla algorytmu są kierunkowe. Gatunki poza czterema dużymi są za małe.
- Ludzie to mapy Ranked wybrane po popularności i ocenie (62 mapperów w treningu, maks. 3 zestawy na mappera). To styl osu! z ostatnich lat, a nie jedyny dobry sposób mapowania. Popularność nie dowodzi, że element mapy jest dobry.
- Poziom jest zdefiniowany zakresem SR, więc gęstość ludzi częściowo wynika z definicji. SR nie mierzy czytelności ani dopasowania do muzyki.
- Przypisanie chwil do slotów (±25 ms) i kwantyzacja do siatki ludzkiej są przybliżeniami. Siatka ludzka pochodzi z timing pointów przesuniętych jednym offsetem na utwór (`timeline_offset`).
- Podobieństwo muzyczne w mierze pomocniczej powtórzeń liczę z obwiedni onsetów i RMS slotów, bez chromy. Bliższe porównanie z oficjalną metryką wymaga liczenia w pipeline.
- Regresje pokazują związek, nie przyczynę. Np. stem perkusji i pasmo high mogą zastępować dźwięk, za którym naprawdę idzie mapper.
- 4 oznaczone utwory z `alignment.md` (1957138, 2162283, 2219350, 2288990) są w treningu. Bez nich mediany metryk audio zmieniają się o ≤ 0,02 (np. `alignment.perc.share` 0,713 → 0,728).
- Nie uruchamiałem generatora. Wskazania miejsc w kodzie opierają się na odczycie kodu i zgodności liczb, np. 1 akord na takt z `withChords` daje ok. 12% akordów, a zmierzone jest 11%. Potwierdzić je trzeba eksperymentem w etapie 3.
- Charty algorytmu powstały z audio z `.osz`, a bot gra inne uploady (inne przesunięcie, intro, miks).
- Liczby nie mówią, czy chart jest przyjemny, czytelny przy prędkości gry, ani czy akord „pasuje” do talerza. To musi ocenić gracz (sekcja 7).
- Zgodność rozkładów z ludźmi nie oznacza dobrego chartu. Rozbieżność też nie zawsze jest błędem: np. synkopy wokalu na 1/8 mogą być trafne muzycznie, a ludzie po prostu ich nie mapują na tym poziomie.

## 10. Jak odtworzyć

Środowisko: `PY=/tmp/claude-0/-home-user-MewBit/4930cd9b-e13e-5233-b473-de00f0007e62/scratchpad/venv/bin/python`. Skrypty czytają tylko dane Hard i piszą do `mapping-analysis/levels/hard/tables/`. Kolejność ma znaczenie, bo późniejsze skrypty czytają tabele wcześniejszych.

```
cd /home/user/MewBit/mapping-analysis/levels/hard
$PY -I a1_profile.py         # kwantyle metryk ludzi (trening/test), BPM (Spearman), gatunki (Kruskal)
$PY -I a2_compare.py         # algorytm vs ludzie na teście, pary, gatunki
$PY -I a3_slots.py           # tabele slotów: udziały, regresje logistyczne, recall źródeł, tabela per utwór
$PY -I a4_sections.py        # gęstość wokół granic sekcji, akcent na granicy, wstęp/koniec, kiai
$PY -I a5_bpm.py             # przedziały BPM i regresje na log2(BPM/180)
$PY -I a6_robust.py          # kwantyzacja do slotów: odstępy, serie, powtórzenia (pomocnicze)
$PY -I a7_holds.py           # holdy: długość, puszczenia, nuty w środku wg długości
$PY -I a8_patterns.py        # akordy wg torów, tryle, balans w 4 taktach, akordy w strumieniach 1/4
$PY -I a9_genres.py          # profile gatunków i efekt gatunku po uwzględnieniu BPM
$PY -I a10_per_song.py       # tabela per utwór testowy (beat tracking i różnice)
$PY -I a11_rules.py          # reguły: udziały trening/test/algorytm, klasy
$PY -I a12_rc_checks.py      # wytyczne RC: serie 1/8 i 1/4, anchory, akordy 3-nutowe, akordy w strumieniach
$PY -I a13_candidates.py     # okna 4 taktów do odsłuchu
$PY -I a14_hold_placement.py # gdzie zaczynają się holdy
$PY -I a15_report_tables.py  # tabele sekcji 5
```

Wspólne funkcje są w `common.py`: ładowanie danych, uzupełnianie brakujących `gap_share` zerami i przypisanie chwil do slotów (`chosen_target`).