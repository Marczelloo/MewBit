# Hard: jak mapują ludzie i jak wypada generator (etap 2, metryki v2)

**Zakres:** tylko poziom Hard (osu!mania 4K, SR [2,7; 3,4)), generator v19, metryki v2 (`shared/metrics.md`, sekcja „Dodane i poprawione po etapie 2”).

**Dane:**
- `shared/data/hard/`: 95 map ludzi (75 treningowych, 20 testowych) i 20 chartów algorytmu dla utworów testowych;
- `shared/data/songs/`;
- kolumny ogólne i `hard_*` z `shared/corpus.csv`.

Zestawów z mapą Hard jest 95, a nie 100, więc w treningu jest 75 utworów, nie 80. Mapperów liczę po właścicielu dyfficulty (`hard_owners`): w treningu jest ich 62, w teście 20. Profil i reguły wyznaczam na treningu i sprawdzam na teście. Algorytm porównuję z ludźmi tylko na teście. Tabele pośrednie są w `levels/hard/tables/`, skrypty opisuje sekcja 10.

**Oznaczenia:**
- p10/p50/p90 to kwantyle po mapach, n to liczba map, m to liczba różnych mapperów.
- „Sloty” to tabele slotów z oficjalnym celem `chosen`: każda chwila należy do jednego slotu.
- „(pomocn.)” oznacza miarę policzoną tutaj z nut, której nie ma w `metrics.md` (zob. sekcja 8).

## 1. Podsumowanie

**Jak mapują ludzie.** Hard ma niemal ciągły szkielet półbeatów:
- 93% beatów i 83% półbeatów ma nutę;
- 76% zmapowanych beatów to akordy;
- 1/4 pojawia się tam, gdzie słychać perkusję;
- gęstość wynosi około 9,4 nuty/s niezależnie od BPM, więc liczba nut na beat spada z tempem, zgodnie ze skalą RC wokół 180 BPM.

**Twarde zasady ludzi** (≥ 95% map treningowych, potwierdzone na teście):
- brak nut poza siatką i prawie puste sloty 1/8;
- balans rąk 50 ± 2%, także w każdych 4 taktach, bez przypisywania instrumentu do ręki;
- akordy w ≥ 25% chwil, z czego połowa to skoki jednej ręki;
- akord na downbeacie granicy sekcji i na początku kiai;
- puszczenia holdów na siatce 1/4;
- tryle nie dłuższe niż 9 nut.

**Co algorytm robi dobrze.** Ma tyle samo chwil na beat co ludzie (2,01 wobec 2,02). Trafia 74% ludzkich chwil w ±40 ms, a makrodynamika sekcji, kiai i kontrast są zbliżone. Mimo to jego Hard odbiega od ludzkiego w tym, co gracz czuje w ręce.

**Największe różnice:**
1. **Rytm bez szkieletu.** Tylko 62% beatów i 53% półbeatów ma nutę (w ±25 ms: 77% i 67%). Algorytm stawia nuty na 1/8, ma 19% odstępów „other”, a najdłuższy ciąg odstępów ≤ 1/2 to 28,5 chwili wobec 130 u ludzi.
2. **Prawie brak akordów.** Akordy to 11% chwil wobec 50%. Są zawsze na dwie ręce i nie tam, gdzie muzyka jest głośna. Nie ma akordu na wejściu sekcji ani kiai.
3. **Drganie i błędy fazy siatki.** 12% chwil leży ponad 10 ms od ludzkiej siatki, zwykle przed beatem. W 8 z 19 utworów tempo jest połówkowe, w 12 z 19 downbeaty mają złą fazę.
4. **Holdy.** Trwają 1,7 beatu zamiast 0,5. Tylko 23% kończy się przy następnej nucie (u ludzi 97%).
5. **Ręce i wzorce.** Instrument ma stałą rękę: stopa 74% w lewej, werbel 70% w prawej. Tryli jest dziewięć razy więcej (43,7 wobec 4,7 na minutę), a gęstość jest niższa (7,0 wobec 9,1 nuty/s).

Różnice występują w każdym z czterech dużych gatunków. Liczby nie rozstrzygną, czy chart się dobrze gra. Kandydaci do gry są w sekcji 7.

### Zmiany po metrykach v2

| obszar | wartość v1 → v2 (algorytm, test p50) | wpływ na wniosek |
|---|---|---|
| Granice sekcji, ±25 ms zamiast 3 ms | nuta na downbeacie granicy 0,225 → **0,83** (ludzie 1,00); akord 0 → 0,12 (ludzie 0,88) | Wniosek „brak nuty na granicy” był w większości artefaktem tolerancji: algorytm ma tam nutę o 17 pp rzadziej, a nie o 78 pp. Brak akordu na granicy zostaje (twarda zasada). |
| Powtórzenia, pozycje skwantowane | rytm w powtórzeniach 0,31 → 0,44, w bazie 0,19 → 0,26 (ludzie 0,94 i 0,65); różnica 0,11 wobec 0,27 | Słabsze powtarzanie rytmu się potwierdza (11 z 16 utworów poniżej ludzi). Tory z lustrem: różnica 0,18 u obu, więc zarzut o tory **wycofuję**. |
| Rytm, pozycje skwantowane | `gap_share.other` 0,115 → **0,19**, 3/4 0,052 → 0,047, `run_1/2.max_notes` 12 → 10 | Wniosek bez zmian. Około połowy z 19% „other” to nuty 10–25 ms od siatki, które kwantyzacja przypisuje do 1/16. Przy kwantyzacji do 1/8 (pomocn.) „other” wynosi 9,9%. |
| Sloty `chosen` zamiast własnego przypisania | 1/4: 0,24 → 0,185; 1/8: 0,040 → 0,029; AUC modelu ludzi na wyborach algorytmu 0,815 → 0,824 | Wyniki ludzi identyczne. Wnioski bez zmian. |
| `coverage.*` (tolerancja źródła) | beaty 0,62 (sloty ±25 ms: 0,77); półbeaty 0,53 (0,67) | Około 15 pp beatów algorytm trafia z błędem 10–25 ms. Ze sloty korelacja z udziałem chwil > 10 ms od siatki: ρ = −0,79. |
| `hold_short_share.lt_1` (< 0,95 beatu) | ludzie 0,72 → 0,59, algorytm 0 → 0 | Bez zmian. `holds_context` dodaje nowe dowody (6.4). |
| Nowe metryki | akord na początku kiai: ludzie 1,0, algorytm 0; `hand_by_class` stopa w lewej: 0,50 wobec 0,74; `trills.runs_per_min` 4,7 wobec 43,7 | Nowe twarde zasady (2.6) i mocniejsze dowody dla 6.2, 6.6, 6.7. |
| RC: anchory, akordy w strumieniach | `anchor_rc_max_notes` ludzie p50 5 (≥ 5 w 53% map); akordy bliżej niż 1 beat p50 0,21 | Sprzeczność z RC przy anchorach dotyczy około połowy map, a nie 97%. Wniosek o akordach w strumieniach bez zmian. |

## 2. Profil mapowania ludzi na Hard

Klasy reguł:
- **twarda zasada**: spełnia ≥ 95% map treningowych;
- **silna tendencja**: 80–95%;
- **styl**: mniej; zależy od mappera lub gatunku.

Pełna lista: `tables/rules.csv` (zob. 2.6).

### 2.1 Co ludzie mapują, a co pomijają (tabele slotów `chosen`, `a3_slots.py`)

**Siatka decyduje najpierw.** Tabela pokazuje udział punktów siatki z chwilą (`coverage.*`; dla 1/8 sloty `chosen`), p10/p50/p90 po mapach.

| punkt siatki | trening (n = 75, m = 62) | test (n = 20, m = 20) | zależność od BPM (trening, mediana po mapach) |
|---|---|---|---|
| beat (`coverage.beat`) | 0,82 / 0,93 / 0,98 | 0,85 / 0,95 / 0,99 | < 150: 0,97; 150–180: 0,94; 180–210: 0,92; ≥ 210: 0,80 |
| półbeat (`coverage.half`) | 0,65 / 0,83 / 0,95 | 0,65 / 0,82 / 0,93 | 0,89 / 0,84 / 0,78 / 0,70 |
| 1/4 (`coverage.quarter`) | 0,04 / 0,17 / 0,42 | 0,04 / 0,10 / 0,24 | 0,31 / 0,17 / 0,14 / 0,10 |
| 1/8 (sloty) | 0 / 0 / 0,003 | 0 / 0 / 0,003 | prawie zawsze 0 |
| beat w kiai (`coverage.beat_kiai`) | 0,94 / 1,00 / 1,00 (n = 67) | 0,91 / 1,00 / 1,00 | – |
| downbeat | 0,85 / 0,96 / 1,00 | 0,78 / 0,96 / 1,00 | – |
| triole 1/3 / 1/6 (zbiorczo) | 1,7% / 0,5% slotów | 1,4% / 0,1% | – |

Klasyfikacja:
- **twarda zasada w praktyce**: sloty 1/8 ≤ 1% w 92% map treningowych i 100% testowych;
- **silna tendencja**: beaty ≥ 80% w 92% map (test 100%), półbeaty ≥ 60% w 93% map (test 95%);
- w kiai beat ma nutę prawie zawsze;
- **styl**: 1/4, rozrzut 0,04–0,42 zależny od BPM i od mappera.

**W slotach 1/4 i 1/2 decyduje perkusja, nie melodia.** Slot 1/4 z onsetem perkusyjnym (librosa) dostaje nutę w 66% przypadków (p10 0,26, p90 0,95). Bez takiego onsetu tylko w 14% (p10 0,03, p90 0,33).

Regresja logistyczna wybrania slotu: cechy standaryzowane, model trenowany na treningu, AUC na teście.

| podzbiór slotów | AUC test | tylko siatka | tylko onsety librosa | tylko zdarzenia pluginu | tylko stemy | tylko energia i kiai |
|---|---|---|---|---|---|---|
| 1/1 + 1/2 + 1/4 | 0,957 | 0,900 | 0,927 | 0,915 | 0,916 | 0,642 |
| tylko 1/4 | 0,862 | 0,670 | 0,808 | 0,815 | 0,756 | 0,521 |
| tylko 1/2 | 0,871 | 0,624 | 0,831 | 0,819 | 0,830 | 0,713 |

Najsilniejsze współczynniki (standaryzowane, zbiór 1/1 + 1/2 + 1/4):
- dodatnie: obwiednia stemu perkusji +0,72, obwiednia lowmid +0,59, zdarzenia pasma high +0,58 i highmid +0,45, stem other +0,44, RMS +0,30, downbeat +0,27;
- ujemne: obwiednia harmoniczna −0,61 (długi dźwięk tonalny bez ataku) i BPM −0,31;
- klasa `kick` z pluginu ma tylko +0,12…0,19.

**Recall zdarzeń pluginu** (`plugin_events.*.recall`, trening p50; w nawiasie `recall_strong`):

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

Na teście kolejność jest ta sama. Recall onsetów stemów (sloty, test): perkusja 0,51, other 0,61, wokal 0,39, bas 0,42.

**Silna tendencja:** prawie każdy mocny werbel i jasny atak perkusyjny ma nutę, a linia basu i wokalu tylko w około połowie.

**Akordy tam, gdzie jest głośno i gra perkusja.** `chord_rate_on_mapped_beats` wynosi 0,76 (p10 0,52); akord ma też 21% zmapowanych półbeatów. Model „akord czy pojedyncza nuta” na wybranym beacie ma AUC 0,74 na teście. Decydują RMS (+0,87), stem perkusji (+0,74), downbeat (+0,54) i BPM (−0,46). Spearman akordów w takcie z RMS (`sections.bar_chords_vs_rms_spearman`): 0,44 (0,02–0,70).

**Holdy to raczej styl niż dźwięk.** Model startu holda ma AUC tylko 0,65 na teście (`a14_hold_placement.py`). Start holda wypada na beacie w 58% (`holds_context.start_on_beat_share` p50 0,59), a na półbeacie w 37%.

### 2.2 Gęstość, podziały i limity trudności (`a1_profile.py`, `a5_bpm.py`)

| metryka | trening p10 / p50 / p90 | test p50 | klasa |
|---|---|---|---|
| `nps` | 8,0 / 9,4 / 10,6 | 9,1 | silna tendencja (92% map w 7,5–11); wynika też z zakresu SR |
| `notes_per_beat` | 2,56 / 3,12 / 4,04 | 3,10 | zależy od BPM (niżej) |
| `moments_per_beat` | 1,73 / 2,15 / 2,67 | 2,02 | – |
| `nps_window` p50 / p90 / max | 9,5 / 12 / 14 (mediany) | 9,5 / 11,5 / 14 | – |
| `nps_peak8s` | 10,7 / 12,2 / 13,8 | 11,7 | – |
| `gap_share` 1/2 / 1/4 / 1/1 | 0,59 / 0,28 / 0,05 (p50) | 0,64 / 0,19 / 0,07 | dominuje 1/2 |
| `gap_share.other` | 0 / 0,002 / 0,009 | 0,002 | twarda zasada: ≤ 2% w 96% map |
| `gap_share.3/4` | 0 / 0,004 / 0,033 | 0,002 | silna tendencja: ≤ 3% w 89% map |
| `snap_share.off` | 0 w 96% map | 0 | twarda zasada |
| `triplet_share` | 0 / 0,002 / 0,04 | 0 | styl (np. swing) |
| `run_1/2.max_notes` | 13,8 / 34 / 76 | 36,5 | – |
| `run_1/4.max_notes` = `fast_runs_1_4_or_finer.max_notes` | 7 / 17 / 49 i 57 | 17 | – |
| `run_1/8.max_notes` ≤ 3 | 92% map | 90% | silna tendencja |
| najdłuższy ciąg odstępów ≤ 1/2 (pomocn.) | 66 / 137 / 320 chwil | 130 | twarda zasada: ≥ 40 w 96% map |
| `gap_ms.min` / `gap_ms.p5` | 44 / 75 / 93 i 71 / 85 / 112 ms | 76,5 / 82,5 | – |

**Akordy:**
- `chord_share` 0,27 / 0,42 / 0,58; ≥ 25% w 96% map (test 90%): twarda zasada.
- Akordy 2-nutowe to 35% chwil, 3-nutowe p50 0,033 (p90 0,16). 3-nutowe występują w 95% map, 4-nutowych nie ma w 96%.
- Pozycje: downbeat 0,22, inny beat 0,54, poza beatem 0,25.
- `chord2_split_hands_share` 0,52 (0,41–0,68). Około połowy akordów 2-nutowych to skoki jednej ręki ([0,1] albo [2,3]); ≥ 25% w 97% map: twarda zasada.
- Akordy w seriach 1/2 (`chords_in_half_runs_per_min`): 82 na minutę (39–144). To jumpstreamy, a nie pojedyncze akcenty.

**Jacki:**
- `minijack_share` 0,12;
- `minijack_fast_share` ≤ 0,5% w 96% map: twarda zasada;
- `jack_max_notes` 4 (3–7);
- `single_step_share.0` 0,02 (p90 0,07).

**Holdy:**
- `hold_share` 0 / 0,068 / 0,24; holdy ≥ 2% nut ma 83% map (styl, zależny też od gatunku).
- Długość p50 0,5 beatu. Wszystkie holdy razem (`holds_context.holds_by_length`): 62,5% < 3/4 beatu, 28,6% od 3/4 do 1,5, 8,8% ≥ 1,5. `hold_short_share.lt_1` (< 0,95 beatu) p50 0,57.
- Puszczenie: `release_snap_share` na 1/1 0,57, na 1/2 0,33, na 1/4 0,03. Mapy z ≥ 10 holdami mają ≥ 95% puszczeń na siatce 1/4 w 95% przypadków (n = 62, m = 53; test 100%): twarda zasada.
- `holds_context.release_at_next_moment_share` 0,94 (0,70–1,00), czyli hold zwykle kończy się tam, gdzie zaczyna się następna nuta. Hold jest więc nutą rytmiczną. ≥ 70% w 90% map: silna tendencja.
- Głowa holda w akordzie: 0,60 (0,23–0,82).
- Nuty w środku holda (`holds_context.notes_inside_share_by_length`): holdy < 3/4 beatu 0, od 3/4 do 1,5 beatu 0,30, ≥ 1,5 beatu 0,65. `holds_with_notes_inside_share` ≤ 40% w 94% map: silna tendencja. Nuty drugiej ręki na beat holda: p50 0.
- Shieldy 1/4 (`holds_context.shield_1_4_per_min`): 0 w ≥ 95% map. `max_simultaneous_holds` 2 (0–3).

**BPM a skala RC** (regresja na log2(BPM/180), trening n = 75, test n = 20):
- nps nie zależy od tempa: 9,3 przy 180 BPM, +0,7 na podwojenie, p = 0,15.
- Nuty na beat spadają o 2,0 na podwojenie BPM (p < 0,001; test −0,9, p = 0,001; po uwzględnieniu gatunku −2,15).
- Udział odstępów 1/4 spada z 0,50 przy < 150 BPM (n = 11) do 0,19 przy ≥ 210 BPM (n = 7), czyli o 0,31 na podwojenie.
- `gap_ms.p5` wynosi 86 ms przy 180 BPM i spada o 25 ms na podwojenie. W beatach to zawsze 1/4 (`gap_beats.p5` = 0,25 w każdym przedziale).

Ludzie trzymają stałe tempo nut w czasie i zmieniają podział, czyli robią to, co RC opisuje jako skalowanie. Najdrobniejszym podziałem pozostaje 1/4, nawet przy ≥ 210 BPM. Silna tendencja, potwierdzona na teście.

### 2.3 Wzorce i powtarzalność

**Kroki i różnorodność:**
- Kroki pojedynczych nut: o 1 tor 0,62, o 2 tory 0,25, o 3 tory 0,10, ten sam tor 0,02. Zmiana ręki w 0,62 kroków.
- `pattern4_entropy_bits` 8,3 (7,8–8,9), `pattern4_distinct_per_100` 55 (37–79); silnie zależy od gatunku (sekcja 3).

**Tryle:**
- `trill_share` 0,017 / 0,041 / 0,091; ≤ 0,12 w 97% map (test 95%): twarda zasada.
- `trills.max_notes` 4 (3–6); powyżej 9 nut tylko 1 mapa z 75: twarda zasada.
- `trills.runs_per_min` 5,8 (0,5–19); `trills.one_hand_share` 0,20.

**Schody i anchory:**
- `stair_share` 0,005 / 0,044 / 0,105: styl.
- `anchor_rc_max_notes` 5 (2–10,6); sekcja 4.

**Balans rąk:**
- `left_hand_share` 0,493 / 0,499 / 0,506; 99% map w 48–52%.
- `hand_balance_4bar.p50` 0,018 (0,009–0,025), p90 0,038. Okien z przewagą > 70/30 nie ma w żadnej mapie (`over_0_2_share` = 0 w 100%). Twarda zasada, potwierdzona na teście.

**Ręka nie zależy od instrumentu.** Udział lewej ręki (`hand_by_class.*.left_share`, trening p50 i p10–p90):

| klasa | p50 | p10–p90 |
|---|---|---|
| stopa | 0,49 | 0,47–0,54 |
| werbel | 0,50 | 0,47–0,52 |
| bas | 0,50 | 0,46–0,54 |
| lead | 0,51 | 0,43–0,62 |

Werbel w 45–55% ma 96% map, stopa 87%. To twarda zasada dla werbla i silna tendencja dla stopy. Zasada „niskie dźwięki po lewej” na 4K nie obowiązuje.

**Powtórzenie muzyki to powtórzenie wzorca** (`repetition.*` v2, n = 60 map z parami, m = 50):

| | rytm | tory | tory z lustrem |
|---|---|---|---|
| powtórzenia | 0,91 (0,85–0,99) | 0,24 | 0,47 |
| linia bazowa | 0,62 (0,41–0,78) | 0,15 | 0,20 |
| różnica (trening p50, p10–p90) | 0,29 (0,11–0,45) | 0,08 | 0,26 (0,05–0,64) |

- Rytm powtarza się ponad bazę (≥ 0,1) w 90% map, tory z lustrem (≥ 0,05) w 87%. Na teście: 95% i 95%. Silna tendencja.
- Rytm powtarza się prawie dosłownie, tory częściowo i często w lustrze.

### 2.4 Wstęp, sekcje, przejścia (`a4_sections.py`; oficjalnie `sections.boundary_profile_*`)

Granice struktury z audio leżą na downbeatach siatki ludzkiej. Gęstość taktu jest liczona względem mediany utworu (mediana po utworach, trening).

| granica | n granic (utworów) | takty −4…−1 | takty 0…+3 |
|---|---|---|---|
| „w górę” (RMS po/przed ≥ 1,25) | 135 (64) | 0,69–0,74 | 1,00–1,07 |
| „w dół” (≤ 0,8) | 122 (52) | 1,10–1,00 | 0,62–0,66 |
| płaska | 430 (73) | 1,00 | 1,00 |

**Gęstość idzie za głośnością.** Spearman nut na takt z RMS 0,51 (0,08–0,74). Po wejściu w głośną sekcję jest o 46% więcej nut, po zejściu o 36% mniej.

**Nie ma buildupu gęstością.** Ostatni takt przed granicą ma tyle samo nut co trzy poprzednie (mediana 1,00).
- Pusty ostatni beat przed granicą (`sections.boundary_empty_last_beat_share`): p50 0, p90 0,20. Co najmniej jedna taka granica jest w 41% map. Przed 12% granic „w górę” jest pusty takt (przerwa przed dropem). To styl, a nie reguła.

**Akcent na granicy (v2, ±25 ms):**
- `sections.boundary_note_share`: per mapa p50 1,0 (p10 0,84). Nuta na ≥ 75% granic w 93% map (test 95%): silna tendencja.
- `sections.boundary_chord_share`: p50 0,86 (p10 0,60). Akord na ≥ 50% granic w 96% map (test 100%): twarda zasada.
- **Początek kiai** (`kiai_start`): nuta w 100% przypadków, a akord na każdym początku kiai w 96% map (n = 67, m = 54; test 90%). Twarda zasada.
- Akordy 3-nutowe: 41% z nich leży na downbeatach (test 57%). Na granicach sekcji jest ich 5 razy więcej, niż wynikałoby z liczby chwil (6% wobec 1,1%).

**Wstęp i koniec:**
- pierwsze 4 takty: 0,77 mediany gęstości (0,33–0,97);
- pierwsza sekcja: 0,77;
- ostatnie 4 takty: 0,95 (0,39–1,17);
- pierwsza nuta: po 0,66 s (p90 3,0 s).

**Kiai:** `kiai_density_ratio` 1,25 (1,04–1,61); kiai jest gęstsze w 96% map z kiai (twarda zasada). Akordy w kiai: 0,46 chwil, poza kiai 0,41.

### 2.5 Pauzy, odpoczynek, kontrast

**Ludzki Hard jest prawie ciągły:**
- `rests_ge_2b.per_min` p50 0 (p90 2,8);
- przerw ≥ 4 beaty nie ma w 81% map, ≥ 8 beatów w ponad 90%;
- `longest_rest_beats` 2 (1–6,5);
- `empty_bar_share` 0,013 (0–0,05);
- silna tendencja; przerw jest więcej przy wyższym BPM (Spearman 0,375).

**Gdzie są przerwy** (`rest_context`, 14 map z przerwami ≥ 4 beaty, m = 13): 58% leży przy granicy sekcji (test 88%). Mediana RMS w przerwie to 0,26 p95, a „głośnych” przerw jest p50 0. Przerwa wypada więc na zmianie sekcji i w cichej muzyce. Grupa jest mała.

**Kontrast** tworzy zmiana gęstości, nie cisza:
- `bar_notes_cv` 0,31 (0,21–0,47);
- `phrase4_notes_p90_over_p10` 1,81 (1,31–4,19);
- `bar_notes` 8 / 13 / 16 nut na takt.

### 2.6 Reguły i sprawdzenie na teście (`a11_rules.py`, wybór)

| reguła | trening (n / m) | test | algorytm (test) | klasa |
|---|---|---|---|---|
| brak chwil poza siatką | 96% (75 / 62) | 90% | 0% | twarda |
| `gap_share.other` ≤ 2% | 96% | 100% | 0% | twarda |
| `gap_share.3/4` ≤ 3% | 89% | 90% | 10% | silna |
| najdłuższy ciąg odstępów ≤ 1/2 ≥ 40 (pomocn.) | 96% | 90% | 30% | twarda |
| sloty 1/8 ≤ 1% | 92% | 100% | 5% | silna |
| `coverage.beat` ≥ 0,8 | 92% | 100% | 0% | silna |
| `coverage.half` ≥ 0,6 | 93% | 95% | 35% | silna |
| downbeaty z nutą ≥ 85% | 91% | **80%** | 0% | silna (na teście słabiej) |
| akordy ≥ 25% chwil | 96% | 90% | 5% | twarda |
| `chord_rate_on_mapped_beats` ≥ 0,5 | 92% | 90% | 0% | silna |
| skoki jednej ręki ≥ 25% akordów 2-nut. | 97% | 95% | 0% | twarda |
| akordy 3-nutowe obecne | 95% | 90% | 0% | silna / twarda |
| brak akordów 4-nutowych | 96% | 100% | 100% | twarda |
| lewa ręka 48–52% | 99% | 100% | 15% | twarda |
| `hand_balance_4bar.p50` ≤ 0,03 | 97% | 90% | 10% | twarda |
| brak okien 4 taktów > 70/30 | 100% | 95% | 35% | twarda |
| werbel: lewa ręka 45–55% | 96% | 95% | 5% | twarda |
| stopa: lewa ręka 45–55% | 87% | 95% | 5% | silna |
| puszczenia na siatce 1/4 ≥ 95% (≥ 10 holdów) | 95% (62 / 53) | 100% | 0% | twarda |
| puszczenie przy następnej chwili ≥ 70% | 90% (62 / 53) | 100% | 0% | silna |
| hold ≥ 1/4 beatu | 100% (66 / 56) | 100% | 100% | twarda |
| mediana holda ≤ 1 beat | 91% | 94% | 0% | silna |
| holdy z nutą w środku ≤ 40% | 94% | 94% | 0% | silna |
| `trills.max_notes` ≤ 9 | 99% | 100% | 65% | twarda |
| `trill_share` ≤ 0,12 | 97% | 95% | 5% | twarda |
| brak minijacków 1/4 | 96% | 100% | 95% | twarda |
| akord na downbeacie ≥ 50% granic | 96% | 100% | 5% | twarda |
| nuta na downbeacie ≥ 75% granic | 93% | 95% | 80% | silna |
| akord na każdym początku kiai | 96% (67 / 54) | 90% | 0% | twarda |
| kiai gęstsze (ratio > 1) | 96% | 95% | 100% | twarda |
| rytm powtórzeń ponad bazą ≥ 0,1 | 90% (60 / 50) | 95% | 50% (n = 16) | silna |
| tory powtórzeń (lustro) ponad bazą ≥ 0,05 | 87% | 95% | 81% | silna |
| bez przerw ≥ 4 beaty | 81% | 80% | 95% | silna |

Prawie każda reguła trzyma się na teście z dokładnością do 10 pp. Wyjątek to downbeaty ≥ 85%: 91% map w treningu, 80% w teście.

## 3. Gatunki (`a9_genres.py`)

Dość map mają cztery gatunki (trening n / m):
- anime 18 / 18;
- electronic 19 / 16;
- video game 16 / 14;
- pop 13 / 13.

W teście jest po 4–6 map na gatunek. Mediany BPM: electronic 200, VG 184, anime 170, pop 164.

**Za małe do wniosków:** rock 3, metal, classical, hip hop, jazz, novelty i folk po 1. Razem to 9 map treningowych i 1 testowa.

Gatunek jest pomieszany z BPM, więc efekt gatunku liczę po odjęciu BPM (OLS z log2 BPM, test F).

**Wspólne dla czterech gatunków:**
- puszczenia holdów na siatce (mediana 1,00 w każdym) i przy następnej chwili (0,92–0,95);
- balans rąk: `hand_balance_4bar.p50` 0,015–0,018;
- ręka niezależna od instrumentu: stopa po lewej w 0,48–0,51;
- puste sloty 1/8, beaty z nutą (0,91–0,96);
- skoki jednej ręki: 47–50% akordów 2-nutowych;
- akord na początku kiai: 1,00 w każdym gatunku;
- kiai gęstsze: 1,14–1,30;
- rytm powtórzeń: 0,90–0,93;
- stałe nps po odjęciu BPM (p = 0,08).

**Zależne od gatunku** (trening, mediany; p po odjęciu BPM; „test” = liczba gatunków z tym samym kierunkiem na teście):

| cecha | anime | electronic | video game | pop | p | test |
|---|---|---|---|---|---|---|
| `chord_share` | 0,52 | 0,38 | 0,36 | 0,44 | 0,005 | 4 / 4 |
| `chord_rate_on_mapped_beats` | 0,83 | 0,69 | 0,72 | 0,86 | 0,38 | 3 / 4 |
| `sections.bar_chords_vs_rms_spearman` | 0,29 | 0,57 | 0,42 | 0,40 | 0,027 | 3 / 4 |
| `pattern4_distinct_per_100` | 73 | 47 | 52 | 60 | < 0,001 | 4 / 4 |
| `hold_share` | 0,146 | 0,031 | 0,065 | 0,132 | 0,14 | 4 / 4 |
| `stair_share` | 0,021 | 0,035 | 0,062 | 0,038 | 0,001 | 3 / 4 |
| `plugin_events.snare.recall` | 0,55 | 0,71 | 0,68 | 0,70 | < 0,001 | 3 / 4 |
| `minijack_share` | 0,165 | 0,148 | 0,092 | 0,181 | 0,037 | 4 / 4 |
| `gap_share.1/2` | 0,64 | 0,62 | 0,49 | 0,63 | 0,043 | 4 / 4 |

**Anime i pop:**
- więcej akordów, bardziej zróżnicowane wzorce, więcej holdów;
- anime trzyma się werbla słabiej i stawia akordy mniej zależnie od głośności niż electronic;
- to styl gatunku, potwierdzony na teście.

**Electronic i video game:**
- bardziej powtarzalne wzorce, mniej holdów i akordów;
- VG ma więcej schodów i 1/4.

**Bez wniosku o gatunku:** liczba nut na beat różni się między gatunkami tylko przez BPM (po odjęciu BPM p = 0,054; kierunek zgodny na teście w 2 z 4 gatunków).

## 4. Ranking Criteria i poradnik a dane

RC (część ogólna i Hard) zakłada rytm około 180 BPM. Mediana BPM korpusu Hard to 175.

| wytyczna (Hard / ogólna) | dane (trening n = 75; test n = 20) | ocena |
|---|---|---|
| HP i OD ≤ 8 | OD ≤ 8 w 99% map (jedna mapa ma 8,5) | zgodne |
| Bez kolejnych 1/8 i drobniejszych (wyjątek: 3 grace notes) | `run_1/8.max_notes` ≤ 3 w 92% map; 6 wyjątków ma głównie BPM 100–144 | zgodne, w praktyce skalowane BPM |
| Strumienie 1/4 z pauzą 1/2 po każdej frazie | `run_1/4.max_notes` p50 17, p90 49; serie > 64 nut ma 5 z 75 map | zgodne dla ok. 93% |
| Akordy w strumieniach 1/4 co najmniej 1/1 od siebie | `chord_pairs_in_quarter_streams.closer_than_1_beat_share`: 44 mapy z parami, p50 0,21; w 36% map większość par jest bliżej | zgodne u ok. 2/3 map; u 1/3 (jumpstreamy) **nie** |
| Unikać anchorów ≥ 5 nut | `anchor_rc_max_notes` p50 5 (2–10,6): ≥ 5 w 53% map, ≥ 9 w 20% (test: 50% i 5%). Stara metryka `anchor_max_notes` liczyła też tryle (p50 8) | **sprzeczne dla około połowy map**; w jumpstreamach przy 180 BPM dłuższe anchory są częste |
| 1/4 jacki odradzane | `minijack_fast_share` ≈ 0 w 96% map | zgodne |
| ≤ 9 nut w trylu | `trills.max_notes` > 9 tylko w 1 z 75 map | zgodne |
| Hold ≥ 1/4 beatu | 100% map | zgodne |
| 4K: akordy ≤ 3 nuty | brak 4-nutowych w 96% map | zgodne |
| Bez akordów w środku strumieni 1/6 | triole rzadkie (`triplet_share` p90 0,04) | brak danych do oceny |
| Każda nuta odpowiada dźwiękowi | `no_sound_share` p50 0,09 (p90 0,22); detektory gubią część onsetów | nie da się ocenić ostro |
| Przerwy tylko przy bardzo spokojnej muzyce | przerw ≥ 4 beaty brak w 81% map; jeśli są, to przy granicach i w cichej muzyce (`rest_context`) | zgodne |
| Skalowanie BPM (progi 120 i 240) | nps stałe; nuty/beat −2,0 na podwojenie; 1/4 od 0,50 do 0,19 | zgodne co do kierunku; 1/4 zostaje w użyciu także przy ≥ 210 BPM |

Poradnik osu!mania (część Hard):

| rada | dane | ocena |
|---|---|---|
| Dłuższe bursty 1/4 i schody | `stair_share` p50 0,044 | umiarkowanie; styl (VG > anime) |
| Akordy 3-nutowe na początku lub końcu części | 41% leży na downbeatach, na granicach 5× częściej niż przeciętnie | zgodne |
| Krótkie jumpstreamy | ludzie robią długie: `chords_in_half_runs_per_min` 82, ciąg ≤ 1/2 p50 137 chwil | dane idą dalej niż poradnik |
| Kiai najgęstsze | 96% map; akord na początku kiai w 96% | zgodne |
| Łączyć LN z pojedynczymi nutami 1/4 | holdy < 3/4 beatu bez nut w środku, a hold kończy się przy następnej chwili (0,94) | **w tym zakresie SR raczej nie**: LN to krótkie nuty rytmiczne |
| Bursty 1/6 ≤ 1/2 beatu, 1/8 ≤ 1/4 beatu | `run_1/8` p90 3; `run_1/6` > 4 w 10 mapach | prawie zgodne |

## 5. Algorytm a ludzie na zbiorze testowym (20 utworów)

**Beat tracking generatora** (`songs/*.json`, 19 utworów z siatką):
- tempo połówkowe (`human_beat_over_algo_beat` = 0,5) w 8 z 19 utworów;
- złożenie ×2 w 4 utworach;
- downbeat zgodny z ludzkim w ≤ 20% w 12 utworach;
- ≥ 20% beatów na ludzkich półbeatach w 4 utworach;
- `NO_TIMING` w 1 utworze (2270163).

**Względem mapy człowieka** (`versus_human`):
- recall chwil w ±40 ms: 0,74 (0,63–0,81); precyzja: 0,71 (0,63–0,81);
- zgodność torów na dopasowanych chwilach: 0,46;
- przesunięcie do ludzkiej siatki: p50 −2,4 ms (per utwór od −7,7 do +0,2); w 15 z 20 utworów nuty są przed beatem;
- chwile ponad 10 ms od siatki: 12% (4–34%).

**Warstwa prowadząca:** perkusja w 68% fraz, lead w 24%, bas w 7%, `bands` w 0% (z 324 fraz).

Tabela poniżej pochodzi z `a15_report_tables.py` (`tables/report_table_test.csv`). „Poza p10–p90” to udział chartów algorytmu poza zakresem p10–p90 ludzi z treningu. p to test Wilcoxona dla par utwór-utwór (n = 20; dla powtórzeń n = 16).

| metryka | ludzie test p10 / p50 / p90 | algorytm p10 / p50 / p90 | ludzie trening p10–p90 | algorytm poza p10–p90 treningu | Wilcoxon p |
|---|---|---|---|---|---|
| nuty/s (`nps`) | 8,06 / 9,11 / 10,9 | 5,26 / 7,04 / 7,76 | 8,00–10,6 | 90% | 2e-06 |
| nuty/beat (`notes_per_beat`) | 2,61 / 3,10 / 3,54 | 1,84 / 2,26 / 2,64 | 2,56–4,04 | 80% | 2e-06 |
| chwile/beat (`moments_per_beat`) | 1,75 / 2,02 / 2,31 | 1,74 / 2,01 / 2,35 | 1,73–2,67 | 10% | 0,985 |
| szczyt 8 s (`nps_peak8s`) | 10,9 / 11,7 / 13,0 | 7,30 / 9,06 / 9,89 | 10,7–13,8 | 100% | 9e-05 |
| udział akordów (`chord_share`) | 0,29 / 0,50 / 0,56 | 0,054 / 0,11 / 0,20 | 0,27–0,57 | 95% | 4e-06 |
| akordy 3-nutowe (`chord_size_share.3`) | 0,001 / 0,036 / 0,19 | 0 / 0 / 0 | 0,002–0,16 | 100% | 2e-04 |
| akordy 2-nut. na 2 ręce (`chord2_split_hands_share`) | 0,45 / 0,52 / 0,68 | 0,94 / 0,99 / 1,00 | 0,41–0,68 | 100% | 2e-06 |
| akordy poza beatem (`chord_position_share.offbeat`) | 0,08 / 0,23 / 0,36 | 0,36 / 0,59 / 0,82 | 0,09–0,37 | 85% | 2e-06 |
| akord na zmapowanym beacie (`chord_rate_on_mapped_beats`) | 0,55 / 0,80 / 0,93 | 0,047 / 0,15 / 0,29 | 0,52–0,91 | 100% | 2e-06 |
| akordy w seriach 1/2 / min (`chords_in_half_runs_per_min`) | 46 / 90 / 171 | 1,9 / 11,9 / 26,9 | 39–144 | 95% | 2e-06 |
| akord na downbeacie granicy (`sections.boundary_chord_share`) | 0,61 / 0,88 / 1,00 | 0 / 0,12 / 0,27 | 0,60–1,00 | 100% | 9e-05 |
| nuta na downbeacie granicy (`sections.boundary_note_share`) | 0,85 / 1,00 / 1,00 | 0,64 / 0,83 / 0,93 | 0,84–1,00 | 55% | 0,008 |
| akord na początku kiai (`kiai_start.chord_share`) | 0,99 / 1,00 / 1,00 | 0 / 0 / 0,50 | 1,00–1,00 | 100% | 5e-05 |
| akordy w takcie a RMS (`sections.bar_chords_vs_rms_spearman`) | −0,03 / 0,33 / 0,69 | 0,00 / 0,20 / 0,39 | 0,02–0,70 | 15% | 0,048 |
| beaty z chwilą (`coverage.beat`) | 0,85 / 0,95 / 0,99 | 0,48 / 0,62 / 0,77 | 0,82–0,98 | 100% | 2e-06 |
| beaty z chwilą w ±25 ms (sloty `chosen`) | 0,85 / 0,95 / 0,99 | 0,61 / 0,77 / 0,84 | 0,82–0,98 | 75% | 2e-06 |
| półbeaty z chwilą (`coverage.half`) | 0,65 / 0,82 / 0,93 | 0,34 / 0,53 / 0,67 | 0,65–0,95 | 80% | 4e-06 |
| punkty 1/4 z chwilą (`coverage.quarter`) | 0,044 / 0,096 / 0,24 | 0,065 / 0,17 / 0,25 | 0,042–0,42 | 5% | 0,216 |
| beaty w kiai z chwilą (`coverage.beat_kiai`) | 0,91 / 1,00 / 1,00 | 0,50 / 0,72 / 0,87 | 0,94–1,00 | 100% | 2e-06 |
| sloty 1/8 z chwilą (`chosen`) | 0 / 0 / 0,003 | 0,012 / 0,029 / 0,076 | 0–0,003 | 100% | 2e-06 |
| downbeaty z nutą (`downbeats_carried`) | 0,78 / 0,96 / 1,00 | 0,46 / 0,66 / 0,72 | 0,85–1,00 | 100% | 2e-06 |
| chwile na 1/8 (`snap_share.8`) | 0 / 0 / 0,006 | 0,009 / 0,027 / 0,11 | 0–0,005 | 95% | 4e-06 |
| chwile na 1/16 (`snap_share.16`) | 0 / 0 / 0,004 | 0,021 / 0,12 / 0,24 | 0–0 | 100% | 2e-06 |
| chwile poza siatką (`snap_share.off`) | 0 / 0 / 0 | 0,011 / 0,035 / 0,079 | 0–0 | 100% | 2e-06 |
| błąd siatki p50, ms (`grid_error_ms.p50`) | 0 / 0,48 / 0,52 | 2,76 / 4,12 / 6,61 | 0–0,53 | 100% | 2e-06 |
| przesunięcie do siatki człowieka p50, ms | – | −7,65 / −2,40 / 0,23 | – | – | – |
| chwile > 10 ms od siatki człowieka | – | 0,041 / 0,12 / 0,34 | – | – | – |
| odstępy 1/2 (`gap_share.1/2`) | 0,40 / 0,64 / 0,83 | 0,24 / 0,34 / 0,54 | 0,28–0,81 | 30% | 1e-05 |
| odstępy 1/4 (`gap_share.1/4`) | 0,087 / 0,19 / 0,42 | 0,17 / 0,27 / 0,36 | 0,092–0,56 | 5% | 0,314 |
| odstępy 3/4 (`gap_share.3/4`) | 0 / 0,002 / 0,026 | 0,031 / 0,047 / 0,096 | 0–0,033 | 85% | 3e-05 |
| odstępy „other” (`gap_share.other`) | 0 / 0,002 / 0,009 | 0,11 / 0,19 / 0,32 | 0–0,009 | 100% | 2e-06 |
| „other” przy kwantyzacji do 1/8 (pomocn.) | 0 / 0,002 / 0,011 | 0,043 / 0,099 / 0,25 | 0–0,013 | 100% | 2e-06 |
| najdł. seria 1/2 (`run_1/2.max_notes`) | 19,6 / 36,5 / 100 | 7 / 10 / 18,3 | 13,8–76,4 | 70% | 1e-04 |
| serie 1/2 / min (`run_1/2.count_per_min`) | 24,9 / 36,2 / 48,5 | 46,2 / 63,9 / 74,0 | 19,1–63,5 | 55% | 6e-06 |
| najdł. seria ≤ 1/4 (`fast_runs_1_4_or_finer.max_notes`) | 7 / 17 / 35 | 4,9 / 7 / 10,1 | 7–57 | 40% | 1e-04 |
| najdł. ciąg odstępów ≤ 1/2 (pomocn.) | 42,6 / 130 / 314 | 16,8 / 28,5 / 62,0 | 66,4–320 | 95% | 4e-06 |
| udział holdów (`hold_share`) | 0,008 / 0,066 / 0,25 | 0,024 / 0,070 / 0,096 | 0–0,24 | 0% | 0,123 |
| długość holda p50, beaty | 0,50 / 0,50 / 1,00 | 1,37 / 1,71 / 2,88 | 0,50–1,00 | 100% | 8e-06 |
| holdy < 0,95 beatu (`hold_short_share.lt_1`) | 0,15 / 0,59 / 0,85 | 0 / 0 / 0,015 | 0,11–0,86 | 100% | 2e-04 |
| puszczenia na siatce 1/4 (`release_snap_share` 1+2+4) | 0,86 / 1,00 / 1,00 | 0,15 / 0,32 / 0,56 | 0,97–1,00 (mapy z holdami) | 100% | 8e-06 |
| puszczenie przy następnej chwili | 0,78 / 0,97 / 1,00 | 0,090 / 0,23 / 0,45 | 0,70–1,00 | 100% | 8e-06 |
| start holda na beacie | 0,41 / 0,74 / 0,94 | 0,13 / 0,29 / 0,43 | 0,46–0,90 | 100% | 2e-05 |
| głowa holda w akordzie | 0,26 / 0,67 / 0,89 | 0,082 / 0,27 / 0,46 | 0,23–0,82 | 40% | 0,001 |
| holdy z nutą w środku | 0 / 0,19 / 0,37 | 0,82 / 0,96 / 1,00 | 0,002–0,38 | 100% | 8e-06 |
| nuta w środku holda 3/4–1,5 beatu | 0 / 0,38 / 0,83 | 0,65 / 0,92 / 1,00 | 0–0,80 | 75% | 0,037 |
| nuty drugiej ręki/beat w holdzie p50 | 0 / 0 / 0 | 1,05 / 1,50 / 1,85 | 0–0 | 100% | 8e-06 |
| lewa ręka (`left_hand_share`) | 0,49 / 0,50 / 0,51 | 0,37 / 0,45 / 0,54 | 0,49–0,51 | 95% | 0,007 |
| odchylenie rąk w 4 taktach (`hand_balance_4bar.p50`) | 0,011 / 0,019 / 0,027 | 0,030 / 0,075 / 0,14 | 0,009–0,025 | 90% | 6e-06 |
| okna 4 taktów > 70/30 | 0 / 0 / 0 | 0 / 0,065 / 0,24 | 0–0 | 65% | 0,001 |
| stopa: lewa ręka (`hand_by_class.kick.left_share`) | 0,47 / 0,50 / 0,53 | 0,63 / 0,74 / 0,82 | 0,47–0,54 | 95% | 2e-06 |
| werbel: lewa ręka | 0,46 / 0,50 / 0,52 | 0,22 / 0,30 / 0,42 | 0,47–0,52 | 100% | 6e-06 |
| lead: lewa ręka | 0,43 / 0,51 / 0,58 | 0,24 / 0,33 / 0,54 | 0,43–0,62 | 65% | 3e-04 |
| tryle (`trill_share`) | 0,012 / 0,042 / 0,10 | 0,13 / 0,20 / 0,29 | 0,017–0,091 | 100% | 2e-06 |
| najdłuższy tryl (`trills.max_notes`) | 2,7 / 4 / 6,2 | 5,9 / 8 / 13,3 | 3–6 | 70% | 8e-05 |
| tryle / min (`trills.runs_per_min`) | 0,61 / 4,71 / 19,0 | 32,7 / 43,7 / 60,6 | 0,51–19,1 | 100% | 4e-06 |
| kolejne pojedyncze na tym samym torze | 0 / 0,017 / 0,057 | 0,062 / 0,10 / 0,15 | 0–0,072 | 75% | 1e-05 |
| różne układy 4 chwil/100 | 47,9 / 59,6 / 77,8 | 34,5 / 47,3 / 72,0 | 36,6–78,8 | 15% | 0,040 |
| anchor RC (`anchor_rc_max_notes`) | 3 / 4,5 / 7,1 | 1,8 / 3 / 5 | 2–10,6 | 10% | 8e-04 |
| chwile na onsecie perkusyjnym | 0,50 / 0,70 / 0,88 | 0,39 / 0,56 / 0,76 | 0,51–0,87 | 40% | 2e-06 |
| chwile bez dźwięku | 0,026 / 0,10 / 0,17 | 0,090 / 0,19 / 0,29 | 0,023–0,22 | 40% | 6e-06 |
| recall leadu | 0,38 / 0,53 / 0,64 | 0,54 / 0,65 / 0,77 | 0,35–0,67 | 40% | 0,002 |
| recall basu | 0,38 / 0,46 / 0,71 | 0,46 / 0,66 / 0,76 | 0,33–0,70 | 30% | 3e-05 |
| recall hi-hatu | 0 / 0,50 / 0,72 | 0 / 0,087 / 0,43 | 0–1,00 | 0% | 0,006 |
| rytm w powtórzeniach (`repetition.repeat.rhythm`) | 0,80 / 0,94 / 0,99 | 0,17 / 0,44 / 0,56 | 0,85–0,99 | 94% | 3e-05 |
| rytm w linii bazowej | 0,53 / 0,65 / 0,81 | 0,15 / 0,26 / 0,38 | 0,41–0,78 | 95% | 2e-06 |
| rytm: powtórzenie − baza | 0,14 / 0,27 / 0,38 | −0,01 / 0,11 / 0,34 | 0,11–0,45 | 56% | 0,034 |
| tory z lustrem: powtórzenie − baza | 0,09 / 0,18 / 0,53 | 0,035 / 0,18 / 0,31 | 0,05–0,64 | 19% | 0,175 |
| gęstość kiai / reszta | 1,04 / 1,27 / 1,44 | 1,06 / 1,18 / 1,46 | 1,04–1,61 | 0% | 1,000 |
| gęstość taktu a RMS | 0,16 / 0,49 / 0,70 | 0,38 / 0,54 / 0,76 | 0,08–0,74 | 20% | 0,053 |
| CV nut na takt | 0,19 / 0,28 / 0,41 | 0,19 / 0,26 / 0,40 | 0,21–0,47 | 20% | 0,571 |
| kontrast 4 taktów p90/p10 | 1,27 / 1,76 / 2,30 | 1,31 / 1,69 / 2,42 | 1,31–4,19 | 10% | 0,812 |
| przerwy ≥ 2 beaty / min | 0 / 0 / 2,71 | 0 / 0,39 / 1,66 | 0–2,81 | 5% | 0,363 |
| puste takty | 0 / 0,011 / 0,039 | 0 / 0 / 0,001 | 0–0,050 | 0% | 0,002 |
| pierwsza nuta, ms | 345 / 803 / 2006 | 1522 / 1584 / 2190 | 177–3006 | 10% | 0,012 |

**Co się zgadza:**
- liczba chwil na beat;
- kształt gęstości wokół granic sekcji: przed granicą „w górę” 0,71–0,84, po niej 1,00–1,17; po granicy „w dół” 0,58–0,80 (ludzie 0,70–0,75, 1,04–1,12 i 0,67–0,75; oficjalny `boundary_profile` bez istotnych różnic);
- kiai, CV taktów, kontrast fraz, przerwy;
- `minijack_share` (0,145 wobec 0,137) i `max_simultaneous_holds` (2 wobec 2);
- udział holdów;
- powtarzanie torów przy powtórzeniu muzyki.

Makrodynamika jest więc w porządku, a problemy są w mikrostrukturze.

**W podziale na gatunki** (mediany, ludzie → algorytm; „other” = 1 utwór, za mało):

| metryka (mediana) | anime (n = 5) | electronic (n = 6) | video game (n = 4) | pop (n = 4) | other (n = 1) |
|---|---|---|---|---|---|
| `nps` | 9,31 → 7,36 | 9,42 → 7,22 | 9,08 → 7,33 | 9,14 → 5,71 | 8,58 → 6,83 |
| `chord_share` | 0,52 → 0,16 | 0,35 → 0,095 | 0,37 → 0,15 | 0,53 → 0,072 | 0,39 → 0,19 |
| `chord_rate_on_mapped_beats` | 0,82 → 0,24 | 0,59 → 0,16 | 0,71 → 0,18 | 0,89 → 0,11 | 0,67 → 0,13 |
| `coverage.beat` | 0,91 → 0,63 | 0,91 → 0,52 | 0,90 → 0,69 | 0,97 → 0,61 | 0,98 → 0,74 |
| `coverage.half` | 0,77 → 0,54 | 0,90 → 0,45 | 0,73 → 0,56 | 0,89 → 0,51 | 0,85 → 0,65 |
| sloty 1/8 z chwilą | 0,002 → 0,027 | 0 → 0,034 | 0 → 0,025 | 0,002 → 0,034 | 0 → 0,021 |
| `gap_share.other` | 0,002 → 0,23 | 0 → 0,21 | 0,001 → 0,13 | 0,004 → 0,19 | 0,002 → 0,13 |
| najdł. ciąg ≤ 1/2 (pomocn.) | 43 → 21 | 125 → 28,5 | 135 → 30,5 | 280 → 38,5 | 298 → 29 |
| `versus_human.recall` | 0,80 | 0,69 | 0,73 | 0,71 | 0,78 |
| `snap_share.16` | 0 → 0,12 | 0 → 0,13 | 0 → 0,086 | 0,001 → 0,047 | 0 → 0,044 |
| `hold_len_beats.p50` | 0,50 → 1,42 | 1,00 → 2,00 | 1,00 → 2,16 | 0,50 → 1,70 | 0,50 → 1,90 |
| puszczenie przy następnej chwili | 0,93 → 0,21 | 0,99 → 0,25 | 0,96 → 0,31 | 0,87 → 0,28 | 1,00 → 0,10 |
| `holds_with_notes_inside_share` | 0,29 → 0,96 | 0,031 → 0,93 | 0,16 → 0,97 | 0,22 → 0,92 | 0 → 0,91 |
| `hand_balance_4bar.p50` | 0,018 → 0,031 | 0,012 → 0,099 | 0,021 → 0,083 | 0,017 → 0,086 | 0,021 → 0,095 |
| stopa: lewa ręka | 0,48 → 0,81 | 0,48 → 0,75 | 0,50 → 0,74 | 0,51 → 0,69 | 0,53 → 0,70 |
| `trills.max_notes` | 3 → 6 | 5 → 9 | 4 → 9 | 3,5 → 10 | 3 → 5 |
| `alignment.perc.share` | 0,70 → 0,47 | 0,70 → 0,57 | 0,65 → 0,55 | 0,75 → 0,57 | 0,88 → 0,79 |
| `plugin_events.lead.recall` | 0,41 → 0,64 | 0,53 → 0,64 | 0,58 → 0,59 | 0,57 → 0,68 | 0,56 → 0,78 |
| `sections.boundary_chord_share` | 1,00 → 0,11 | 0,82 → 0,062 | 0,77 → 0,12 | 1,00 → 0,050 | 0,80 → 0,20 |
| `kiai_start.chord_share` | 1,00 → 0 | 1,00 → 0 | 1,00 → 0,21 | 1,00 → 0 | 1,00 → 0 |
| rytm: powtórzenie − baza | 0,27 → 0,076 | 0,31 → 0,096 | 0,30 → 0,094 | 0,21 → 0,15 | 0,23 → – |

- Kierunek różnic jest ten sam w każdym gatunku.
- **Pop** ma największy niedobór gęstości i akordów. W utworach prowadzonych przez lead (1000722, 1784295, 2515207) algorytm daje 3,9–5,3 nuty/s i 3–6% akordów; w 1784295 trafia tylko 45% chwil człowieka.
- **Electronic** ma najsłabszy balans rąk (0,099) i najwięcej chwil poza siatką.
- **Anime** ma najmniej chwil na onsetach perkusyjnych.
- Gatunkowy styl ludzi nie przekłada się na różnice u algorytmu, bo jego charty wszędzie mają mało akordów.

## 6. Problemy algorytmu na Hard (od największego wpływu)

Kod: `helpers/mewbeat/charts/` (generator v19) oraz `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/`. „Test” oznacza, że reguła ludzi trzyma się na 20 utworach testowych.

### 6.1 Rytm bez szkieletu: dziury w ciągu półbeatów, nuty na 1/8, odstępy „other” i 3/4

**Co jest nie tak.** Ludzki Hard to ciągła siatka 1/2 z dodatkami 1/4. Algorytm gubi beaty i półbeaty, a dokłada ludzkie 1/8, więc strumień rozpada się na krótkie, nieregularne kawałki.

**Dowód** (n = 20, ludzie → algorytm):

| miara | ludzie | algorytm |
|---|---|---|
| `coverage.beat` | 0,95 | 0,62 (w ±25 ms: 0,77) |
| `coverage.half` | 0,82 | 0,53 (w ±25 ms: 0,67) |
| `downbeats_carried` | 0,96 | 0,66 |
| sloty 1/8 z chwilą | 0 | 0,029 |
| `snap_share.8` | 0 | 0,027 |
| `gap_share.other` (v2) | 0,002 | 0,19 |
| `gap_share.3/4` | 0,002 | 0,047 |
| `run_1/2.max_notes` | 36,5 | 10 |
| serie 1/2 na minutę | 36 | 64 |
| `fast_runs_1_4_or_finer.max_notes` | 17 | 7 |
| najdłuższy ciąg odstępów ≤ 1/2 (pomocn.) | 130 | 28,5 |

Mimo to algorytm trafia 74% ludzkich chwil w ±40 ms. Zgadza się więc większość pozycji, ale brakuje co czwartej chwili człowieka, a 29% jego chwil to nuty dodane.

**Skąd biorą się odstępy „other”.** Około połowa wynika z drgania (nuty 10–25 ms od siatki kwantyzacja v2 przypisuje do 1/16). Druga połowa to rzeczywisty wybór rytmu: przy kwantyzacji do najbliższego punktu 1/8 (pomocn.) „other” wynosi 9,9%. Z tych odstępów 51% to 3/8 beatu, 25% to 5/8, a 8% to 7/8. Nut na 1/8 jest więcej, gdy siatka algorytmu ma ludzkie tempo: 3,8% slotów 1/8 wobec 1,5% przy tempie połówkowym (ρ = 0,76).

**Klasa** (trening / test / algorytm):
- `gap_share.other` ≤ 2%: 96% / 100% / 0%, twarda zasada;
- ciąg ≥ 40: 96% / 90% / 30%, twarda zasada;
- sloty 1/8 ≤ 1%: 92% / 100% / 5%, silna tendencja;
- `coverage.beat` ≥ 0,8: 92% / 100% / 0%, silna tendencja.

**Gdzie w kodzie:**
- `patterns.js` → `tonalEvents`: nuta basu lub leadu na 1/8 dostaje `level = 1`. `difficultyFilter.js` → `applyDifficulty`/`onGrid` przesuwa ją na `coarseT` tylko przy `maxLevel < 2`, więc na Hard synkopa 1/8 zostaje. W 1784295 (prowadzi wokal) daje to 36% odstępów „other” (v2).
- `patterns.js` → `drumEvents`: uderzenie na 1/8 ma `level 2`, a Hard (`maxLevel 2`) je przyjmuje.
- `grid.js` → `snapToQuarterGrid`: wszystko dalej niż 1/16 beatu od punktu 1/4 idzie na 1/8.
- `difficultyFilter.js` → `selectByFloors`/`byPriority`: selekcja idzie po poziomie, potem po sile. Na Hard nie ma `leaderFirst` ani `beatBias`, więc limit gęstości wycina zdarzenia także na beatach i nic nie pilnuje ciągłości pulsu.
- `pulseNotesPerBeat: 2` działa tylko we frazie perkusyjnej ze stałym pulsem (`phrases.js` → `hasSteadyPulse`).

**Wpływ: wysoki.** Puls czuć dzięki ciągłości 1/2, a odstępy 3/8 i 5/8 w środku strumienia czyta się jak błąd, zwłaszcza przy stałej prędkości spadania.

**Adaptacja:** RC mówi o 180 BPM. Przy wolnych utworach (< 150 BPM, częstych w bocie) ludzie stawiają więcej 1/4 (do 50% odstępów), ale nadal nie 1/8. Progi trzeba liczyć w beatach ludzkiego tempa, nie w beatach siatki algorytmu.

### 6.2 Akordy: prawie ich nie ma, zawsze na dwie ręce, nie tam, gdzie głośno

**Dowód** (ludzie → algorytm):

| miara | ludzie | algorytm |
|---|---|---|
| `chord_share` | 0,50 | 0,11 (95% utworów poniżej p10 ludzi) |
| `chord_rate_on_mapped_beats` | 0,80 | 0,15 |
| akordy w seriach 1/2 na minutę | 90 | 12 |
| akordy 3-nutowe | 0,036 | 0 |
| `chord2_split_hands_share` | 0,52 | 0,99 |
| akordy poza beatem | 0,23 | 0,59 |
| `sections.bar_chords_vs_rms_spearman` | 0,33 | 0,20 (p = 0,048) |
| akord na granicy sekcji | 0,88 | 0,12 |
| akord na początku kiai | 1,00 | 0 |

Model akordu na beacie trenowany na ludziach ma AUC 0,74 na ludziach z testu i tylko 0,52 na algorytmie. U algorytmu akord zależy od pozycji (downbeat +0,67, beat 2 i 4 +0,61), a nie od RMS (−0,10).

**Klasa** (trening / test / algorytm):
- akordy ≥ 25% chwil: 96% / 90% / 5%;
- skoki jednej ręki ≥ 25%: 97% / 95% / 0%;
- akord na granicy: 96% / 100% / 5%;
- akord na początku kiai: 96% / 90% / 0%.

Wszystkie to twarde zasady. Częstość akordów zależy od gatunku (anime i pop mają więcej).

**Gdzie w kodzie:**
- `patterns.js` → `withChords`: jedyny celowy akord to nuta lustrzana pod pojedynczym zdarzeniem poziomu 0 na początku taktu algorytmu (`isBarStart`). To najwyżej 1 akord na takt, czyli ok. 12% przy 8 chwilach na takt, dokładnie poziom algorytmu.
- `mirror = 3 − lane` zawsze wybiera drugą rękę.
- Takt to co 4. surowy beat. Przy tempie połówkowym lub złożeniu ×2 (`timing.js` → `doubleBeats` nie przelicza downbeatów; 12 z 19 utworów) takt obejmuje 2 ludzkie takty.
- Faza downbeatu pochodzi z `TempoEstimator.downbeatPhase`. Zgodność fazy koreluje z akordem na granicy (ρ = 0,48, p = 0,04).
- `capMoments(…, 2)` (`patterns.js` → `patternEvents`, `difficultyFilter.js`): nie ma akordów 3-nutowych.
- `patterns.js` → `mixedEvents`: jedno zdarzenie na rękę, więc akord powstaje tylko z przypadkowej zbieżności warstw.
- `difficulty.js` → `hard.chord` działa tylko w `bandPath.js` → `chordLane`, a ścieżki `bands` nie prowadzi na teście żadna fraza.
- Generator nie wie, gdzie zaczyna się kiai ani sekcja (6.9).

**Wpływ: wysoki.** Akord na mocnym beacie, na wejściu sekcji i refrenu oraz w głośnym jumpstreamie to główny akcent ludzkiego Hard.

**Adaptacja:** w osu! akordy niosą też hitsoundy, a tutaj akcent jest tylko fizyczny i wizualny. Limit 3 nut z RC 4K i skoki jednej ręki pasują do 4 torów bez zmian.

### 6.3 Siatka i tempo: drganie, wczesne nuty, zła faza, połowa tempa

**Dowód:**
- **Drganie:** `grid_error_ms.p50` 4,1 ms (2,8–6,6), u ludzi 0,5 ms. `snap_share.16` 0,12 i `snap_share.off` 0,035, a ludzie mają 0 w 96% map.
- **Wczesne nuty:** w `versus_human` przesunięcie p50 wynosi −2,4 ms, a w 15 z 20 utworów nuty są przed siatką (do −8,7 ms). Chwile ponad 10 ms od ludzkiej siatki to 12%; w 808872 44%, w 1773164 35%, w 310607 34%.
- **Skutek dla pokrycia:** udział chwil > 10 ms od siatki koreluje z `coverage.beat` (ρ = −0,79). Około 15 pp beatów algorytm gra z błędem 10–25 ms.
- **Tempo i faza:** połowa tempa w 8 z 19 utworów (np. 190 BPM wykryte jako 95), złożenie ×2 w 4. Zła faza downbeatu w 12 z 19, beaty na ludzkich półbeatach w 4 (1570640: 38%).
- **Brak siatki:** 2270163 (47% odstępów „other”).

**Klasa:** twarda zasada (brak chwil poza siatką: 96% / 90% / 0%).

**Gdzie w kodzie:**
- `TempoEstimator.java`:
- beaty są indeksami hopów 10,7 ms (`beatHops` → `FeatureExtractor.hopTimeMs`), więc błąd kwantyzacji do ±5 ms;
- prior wokół 120 BPM z σ 1,4 oktawy ciągnie szybkie utwory do połowy tempa;
- `downbeatPhase` daje jedną fazę na cały utwór.
- `timing.js`:
- `foldTempo` składa tylko do zakresu 70–200 BPM, a reguła half-time działa tylko poniżej 95 BPM;
- `doubleBeats` nie przelicza downbeatów;
- `gridPoints` interpoluje liniowo;
- przy niskiej pewności zwraca `NO_TIMING`.
- `generate.js` → `chartFrom` zapisuje `bpm` ze złożonej siatki, a gra skaluje nim prędkość spadania.

**Wpływ: wysoki.** Drganie 4–8 ms mieści się w oknie PERFECT, ale przy stałej prędkości odstępy w strumieniu 1/4 widać jako nierówne (±10% przy 180 BPM). Do tego błędy fazy i tempa psują wyniki z 6.1, 6.2 i 6.4. Wpływ `chart.bpm` na prędkość trzeba sprawdzić w grze.

**Adaptacja:** w osu! timing ustawia człowiek. Tutaj siatka musi być równa sama w sobie, bo bot może grać inny upload z innym przesunięciem.

### 6.4 Holdy: za długie, puszczane w ciszy, przy grającej drugiej ręce

**Dowód** (ludzie → algorytm):

| miara | ludzie | algorytm |
|---|---|---|
| `hold_len_beats.p50` | 0,50 | 1,71 |
| holdy < 3/4 / od 3/4 do 1,5 / ≥ 1,5 beatu | 62,5% / 28,6% / 8,8% (trening) | 0,3% / 34,9% / 64,8% |
| `hold_short_share.lt_1` | 0,59 | 0 |
| puszczenia na siatce 1/4 | 1,00 | 0,32 |
| `release_at_next_moment_share` | 0,97 | 0,23 |
| `start_on_beat_share` | 0,74 | 0,29 |
| `head_in_chord_share` | 0,67 | 0,27 |
| nuta w środku holda 3/4–1,5 beatu | 0,38 | 0,92 |
| `holds_with_notes_inside_share` | 0,19 | 0,96 |
| nuty drugiej ręki na beat holda | 0 | 1,5 |
| `hold_share` | 0,066 | 0,070 (bez różnicy) |

**Klasa** (trening / test / algorytm):
- puszczenia na siatce: 95% / 100% / 0%, twarda zasada;
- puszczenie przy następnej chwili ≥ 70%: 90% / 100% / 0%, silna tendencja;
- mediana ≤ 1 beat: 91% / 94% / 0%, silna tendencja;
- nuty w środku ≤ 40%: 94% / 94% / 0%, silna tendencja.

Sama obecność holdów to styl (83% map).

**Gdzie w kodzie (`holds.js`):**
- `planHolds` i `addSustainHolds`: długość to `min(sustainMs, 4 beaty, następna nuta toru − minLaneGapMs, …)`. Pochodzi z ms pitch trackera i nie jest wyrównywana do siatki.
- `addGapHolds`: hold kończy się w miejscu „następna nuta − odstęp”, czyli tuż przed nutą, a nie na niej.
- `holdMinBeats: 1` to beat algorytmu, więc przy połowie tempa 2 ludzkie beaty.
- `difficulty.js` → `holdOtherHand: "free"`.
- `generate.js` → `finish` → `limitHoldShare` ogranicza tylko liczbę holdów.

**Wpływ: średni do wysokiego.** Puszczenie jest oceniane (okno ×1,5), a algorytm każe puszczać w ciszy. Długi hold z grającą drugą ręką to umiejętność, której ludzki Hard w tym zakresie SR prawie nie wymaga.

**Adaptacja:** holdy 1/2 beatu są w tej grze wykonalne. Bez hitsoundów ich rola to rytm i czytelność dźwięku trzymanego.

### 6.5 Gęstość za niska

**Dowód:**
- `nps` 7,0 wobec 9,1 (90% utworów poniżej p10 ludzi);
- `nps_peak8s` 9,1 wobec 11,7 (100% poniżej p10 ludzi);
- okno 2 s p90 9,0 wobec 11,5;
- chwil na beat jest tyle samo (2,01 wobec 2,02), więc różnicę robią akordy (6.2);
- utwory prowadzone przez lead mają 3,9–5,3 nuty/s.

**Klasa:** silna tendencja (92% / 90%); wynika też z definicji poziomu przez SR.

**Gdzie w kodzie:**
- `difficultyFilter.js` → `densityHolds` dopuszcza najwyżej `floor(maxNps · 2 · max(dolna_moc, moc) + 1)` nut na 2 s.
- `maxNps = min(10, 9 · busy)` (`busyness.js` → `effectiveDifficulty`), a moc to energia × intensywność.
- Hard liczy nuty, nie chwile (bez `densityByMoment`), więc akord zabiera 2 miejsca.
- To, czy limit jest wąskim gardłem w każdym utworze, wymaga uruchomienia generatora (etap 3).

**Wpływ: średni.** Chart jest łatwiejszy niż ludzki Hard, ale razi mniej niż 6.1–6.4.

**Adaptacja:** skala SR osu! nie jest skalą gwiazdek gry (`stars.js`: mediana 5,05). Docelową gęstość musi ocenić gracz.

### 6.6 Ręka zależna od instrumentu i nierówne ręce

**Dowód:**
- `left_hand_share` 0,45 (0,37–0,54) wobec 0,50 (0,49–0,51).
- `hand_balance_4bar.p50` 0,075 wobec 0,019. Okna 4 taktów > 70/30: 6,5% (p90 24%), u ludzi 0.
- `hand_by_class.*.left_share` (lewa ręka):

| klasa | algorytm | ludzie |
|---|---|---|
| stopa | 0,74 | 0,50 |
| werbel | 0,30 | 0,50 |
| lead | 0,33 | 0,51 |
| bas | 0,60 | 0,50 |

- Przykład: 1773164 1:50–1:55, lewa ręka gra 9% nut.

**Klasa** (trening / test / algorytm):
- twarde zasady: lewa ręka 48–52% (99% / 100% / 15%), balans 4 taktów (97% / 90% / 10%), werbel 45–55% (96% / 95% / 5%);
- silna tendencja: stopa 45–55% (87% / 95% / 5%).

**Gdzie w kodzie:**
- `patterns.js` → `mixedEvents`: stopa i bas idą do lewej ręki (`MIXED_KICK_LANES` [0, 1], `TONAL_HAND_BASE.bass = 0`), a werbel, perc, hi-hat i lead do prawej (`MIXED_SNARE_LANES` [2, 3], `TONAL_HAND_BASE.lead = 2`, `hatsOf(split)`).
- `tonalLanes` układa tory według wysokości dźwięku.
- Hard nie ma `balanceHands` ani `spreadLanes` (`seams.js` → `balanceHands` działa tylko na Easy i Normal).

**Wpływ: średni.** Długie przeciążenie jednej ręki przy 9 nutach/s męczy i usuwa symetrię wzorców.

**Adaptacja:** „pitch relevancy” z poradnika dotyczy raczej 7K. Na 4K ludzie trzymają balans i nie wiążą instrumentów z ręką.

### 6.7 Tryle i powtórzenia toru zamiast wzorców

**Dowód** (ludzie → algorytm):

| miara | ludzie | algorytm |
|---|---|---|
| `trill_share` | 0,042 | 0,20 (100% powyżej p90 ludzi) |
| `trills.runs_per_min` | 4,7 | 43,7 |
| `trills.max_notes` | 4 | 8 (p90 13,3) |
| `trills.ge10_per_min` | 0 | p90 1,48 (≤ 9 nut tylko w 65% chartów) |
| `trills.one_hand_share` | 0,19 | 0,39 |
| pojedyncze nuty na tym samym torze | 0,017 | 0,10 |
| skoki jednej ręki | 0,48 | 0,014 |
| `pattern4_distinct_per_100` | 60 | 47 |

Przykład: 1773164 1:50–1:55, 4 takty tryla 2-3.

**Klasa:** twarda zasada (`trill_share` 97% / 95% / 5%; `trills.max_notes` 99% / 100% / 65%).

**Gdzie w kodzie:**
- `patterns.js` → `hitsOf`: n-ta stopa lub werbel bierze tor `n % 2` z pary. Pary to 0/3 i 1/2, a we frazie mieszanej 0/1 i 2/3, co daje tryle jednej ręki.
- `tonalLanes`: szybko powtórzony dźwięk daje tryl na sąsiednim torze, wolniej powtórzony zostaje na tym samym torze.
- `limitJacks` (najpierw partner roli) i `barRepeats.js` → `repeatBarLanes` utrwalają te tory.

**Wpływ: średni.** RC wprost odradza tryle dłuższe niż 9 nut.

**Adaptacja:** stałe role torów mają sens przy keysoundach osu!. Tutaj dźwięk gra bot, więc liczy się wygoda wzorca.

### 6.8 Wybór dźwięków: melodia zamiast perkusji

**Dowód** (ludzie → algorytm):

| miara | ludzie | algorytm |
|---|---|---|
| `alignment.perc.share` | 0,70 | 0,56 |
| `no_sound_share` | 0,10 | 0,19 |
| recall leadu | 0,53 | 0,65 |
| recall basu | 0,46 | 0,66 |
| recall hi-hatu | 0,50 | 0,09 |
| recall mocnego werbla | 0,88 | 0,80 |
| sloty 1/4 z onsetem perkusyjnym | 0,61 | 0,36 |
| sloty 1/4 bez onsetu | 0,085 | 0,18 |

Model ludzi przewiduje wybory algorytmu z AUC 0,824, a ludzi z testu z AUC 0,957. U algorytmu decyduje klasa `kick` (+0,72), u ludzi stem perkusji i pasmo high.

**Klasa:** silna tendencja.

**Gdzie w kodzie:**
- `phrases.js` → `chooseLeaders` i `isVocalSong`: lead wygrywa w utworach wokalnych, gdy `LEAD_PREFERRED_SCORE` ≥ 0,5. `supportLayers` nie daje mu wsparcia.
- `patterns.js` → `secondaryEvents`: perkusja dochodzi tylko w pauzach leadu i tylko przy energii ≥ 0,6.
- `hatsOf`: hi-haty tylko na wolnych slotach 1/4 i na poziomie 2.
- `DrumDetector.java` myli klasy (`shared/onset_bias.json`).

**Wpływ: średni.**

**Adaptacja:** perkusja jest stabilniejsza między uploadami niż wokal.

### 6.9 Granice sekcji i początek kiai bez akcentu

**Dowód (v2, ±25 ms):**
- nuta na downbeacie granicy: 0,83 wobec 1,00 (p = 0,008); wcześniejsze 0,225 było artefaktem tolerancji 3 ms;
- akord na granicy: 0,12 wobec 0,88;
- `kiai_start.note_share`: 0,5 wobec 1,0;
- `kiai_start.chord_share`: 0 wobec 1,0;
- `coverage.beat_kiai`: 0,72 wobec 1,00.

Gęstość przed i po granicy jest dobra.

**Klasa:**
- akord na granicy: twarda zasada (96% / 100% / 5%);
- akord na początku kiai: twarda zasada (96% / 90% / 0%);
- nuta na granicy: silna tendencja (93% / 95% / 80%).

**Gdzie w kodzie:**
- Generator nie zna sekcji muzycznych. `Highlight.sections` wyznacza je tylko z energii.
- `phrases.js` → `buildPhrases` tnie po 16 beatów algorytmu.
- Akcent na początku taktu daje tylko `withChords` (6.2).

**Wpływ: średni.** Wejście refrenu bez akcentu czuć od razu.

**Adaptacja:** w grze nie ma kiai, więc granice i początki refrenów trzeba brać z audio (jak `structure_boundaries_ms`).

### 6.10 Słabsze powtarzanie rytmu przy powtórzeniu muzyki

**Dowód (v2, pozycje skwantowane, n = 16 utworów z parami):**
- rytm w powtórzeniach: 0,44 wobec 0,94;
- rytm w bazie: 0,26 wobec 0,65;
- różnica powtórzenie − baza: 0,11 wobec 0,27 (p = 0,034; 11 z 16 utworów poniżej ludzi);
- miara pomocnicza z kwantyzacją do 1/8: 0,17 wobec 0,25.

**Tory nie są problemem.** Tory z lustrem mają różnicę 0,18 u obu. Bez lustra algorytm ma nawet więcej (0,22 wobec 0,11), ale w bazie tory też się u niego powtarzają częściej (0,23 wobec 0,14): instrument ma stały tor niezależnie od muzyki.

Niski rytm bazowy wynika też z rozbicia rytmu (6.1) i z drgania przypisywanego do 1/16.

**Klasa:** silna tendencja (90% / 95% / 50%).

**Gdzie w kodzie:**
- `repeats.js` → `copyRepeat` i `generate.js` → `copiedRepeat`: kopia działa tylko przy `repeatOf` ≥ 0,85 w 16-beatowych frazach pluginu (`Repetition.java`); nuta przepada bez zdarzenia w ±60 ms, a przy < 50% kopia jest odrzucana.
- `barRepeats.js` → `repeatBarLanes` przenosi tylko tory, nie rytm.

**Wpływ: niski do średniego.**

### 6.11 Start chartu

`first_ms` 1584 ms wobec 803 ms (p = 0,012), bo `LEAD_IN_MS` = 1500 (`difficulty.js`, `applyDifficulty`). **Wpływ: niski.**

## 7. Kandydaci do testów odsłuchowych i gry

Czasy są na osi zdekodowanego audio z `.osz` (mm:ss). Bot może grać inny upload, więc czasy są przybliżone. Okna obejmują 4 takty siatki ludzkiej (`a13_candidates.py`, `tables/candidate_windows.csv`). Fragment grać na Hard algorytmu i na ludzkim Hard.

1. **1784295, Rokudenashi – Tada Koe Hitotsu** (pop, 130 BPM, prowadzi lead; recall w całym utworze tylko 0,45), **2:18–2:25**.
 - Ludzie: ciągły jumpstream 1/2 z akordami 2–3-nutowymi na każdym beacie (78 nut, 30 akordów).
 - Algorytm: 43 pojedyncze nuty z melodii wokalu, odstępy 3/8, 2 akordy.
 - Fragment 2:03–2:10 ma 13 nut na 1/8.
2. **808872, Kobaryo – Perfect Neglect** (electronic, 230 BPM, siatka algorytmu 115 BPM, 44% chwil > 10 ms od siatki), **0:59–1:04**.
 - Nuty stale przed beatem.
 - Ludzie mają akordy 3-nutowe na beatach, algorytm 1 akord.
 - Sprawdzić drganie i prędkość liczoną ze 115 BPM.
3. **1773164, TUYU – Itsuka Otona ni Nareru to Ii ne.** (pop, 176 BPM, złożenie ×2), **1:50–1:55**.
 - Algorytm: tryl 2-3 prawą ręką przez 4 takty, lewa ręka gra 9% nut, nuty ok. 10 ms przed beatem.
 - Ludzie: akordy na każdym beacie i holdy 1/2.
 - Fragment 0:44–0:50: 30 z 45 nut poza siatką.
4. **2270163, ANGUISH, vlad pivo, YARCHE SOLNCA & ily – Krasavitsa** (electronic, 185 BPM, brak siatki), **0:36–0:42**.
 - Ludzie: jumpstream z akordem na każdym półbeacie (64 nuty, 30 akordów).
 - Algorytm: 41 nut w surowych czasach, 15 na 1/8, 0 akordów.
5. **2314654, Laur – PRAGMATISM -RESURRECTION-** (electronic, 174 BPM), **2:05–2:11**.
 - Algorytm: 6 holdów z ≥ 2 nutami drugiej ręki, puszczenia w ciszy, lewa ręka 33%.
 - Ludzki mapper też łączy holdy z nutami, ale puszcza je na beacie lub półbeacie.
6. **1000722, Ohara Yuiko – Zero Centimeters (TV Size)** (anime, 154 BPM, zmienne BPM, prowadzi lead), **0:54–1:01** (granica sekcji w oknie).
 - Ludzie: 25 akordów, w tym 3-nutowe.
 - Algorytm: 0 akordów, nuty przesunięte fazą.
 - Fragment 1:04–1:10: holdy z grającą drugą ręką.
7. **2224035, JINGBURGER – Konton Boogie** (pop, 190 BPM, siatka 95 BPM), **2:17–2:22** (granica w oknie).
 - Ludzie: jumpstream z akordem na każdym beacie i półbeacie (69 nut).
 - Algorytm: 34 pojedyncze nuty w naprzemienności 0-2-0-2, 1 akord.
8. **1570640, Lime – 8bit Voyager** (electronic, 182 BPM, złożenie ×2, 38% beatów na ludzkich półbeatach), **1:57–2:03**.
 - Algorytm: 29 z 35 nut poza siatką, pozycje 0,35 / 0,73 / 1,24 / 1,46 beatu.
9. **563569, P\*Light feat. mow\*2 – OVERDRIVERS** (video game, 177 BPM), **1:28–1:34** (granica w oknie).
 - Algorytm: 8 nut na 1/8 w gęstym fragmencie. Sprawdzić, czy czyta się je jako ozdobnik, czy jako błąd.
10. **2515207, TAK – PPPP feat. Hatsune Miku, Kasane Teto** (pop, 152 BPM, prowadzi lead), **2:13–2:19**.
  - Ludzie: 82 nuty i 30 akordów; algorytm: 36 nut i 3 akordy.
  - Sprawdzić, czy refren nie jest za łatwy i za płaski.

## 8. Prośby o nowe metryki (tylko niespełnione)

Spełnione w v2 i użyte w raporcie: `chosen`, `coverage.*`, `chord_rate_on_mapped_beats`, rytm i powtórzenia na pozycjach skwantowanych, `hand_balance_4bar`, `trills`, `chord_pairs_in_quarter_streams`, `holds_context` oraz `sections.bar_chords_vs_rms_spearman`.

Niespełnione:

1. **`dense_run_max`**: najdłuższy ciąg kolejnych odstępów ≤ 1/2 beatu, w chwilach. Także p50 i liczba na minutę.
 - Po co: to najprostsza miara szkieletu strumienia. U ludzi ≥ 40 w 96% map, u algorytmu w 30% chartów.
 - Czego nie zastępują istniejące metryki: `run_1/2` i `fast_runs_1_4_or_finer` rozrywa każda zmiana klasy 1/2 ↔ 1/4.
2. **Rytm na siatce binarnej**: `gap_share` i `run_*` liczone po przesunięciu chwili na najbliższy punkt 1/8 (lub 1/6, jeśli bliżej) w ±25 ms, a nie na punkt podziału wybrany przez klasyfikację.
 - Po co: kwantyzacja v2 przypisuje nuty algorytmu leżące 10–25 ms od siatki do 1/16. Przez to `gap_share.other` (0,19) miesza drganie z wyborem rytmu, a przy kwantyzacji do 1/8 wynosi 0,099.
 - Druga wersja pozwoliłaby oddzielić problem 6.1 od 6.3.
3. **`coverage.eighth`**: udział punktów 1/8, które nie leżą na 1/4, z chwilą przypisaną według tolerancji źródła.
 - Po co: uzupełnia `coverage.*`; w raporcie liczę to ze slotów `chosen`.

## 9. Ograniczenia

- **Mała próba testowa:** 20 utworów, 4–6 na gatunek. Wnioski gatunkowe o algorytmie są tylko kierunkowe. Gatunki spoza czterech dużych są za małe.
- **Dobór map ludzi:** mapy Ranked wybrane po popularności i ocenie, 62 mapperów w treningu. To styl osu! z ostatnich lat. Popularność nie dowodzi, że element mapy jest dobry.
- **Definicja poziomu:** poziom wyznacza zakres SR, więc gęstość częściowo wynika z definicji. SR nie mierzy czytelności.
- **Kwantyzacja v2:** nuty algorytmu przesuwa na punkt 1/16, jeśli tam je sklasyfikowano. Metryki rytmu i powtórzeń nadal częściowo karzą drganie (sekcja 8, prośba 2). Siatka ludzka pochodzi z timing pointów przesuniętych jednym offsetem na utwór.
- **Miara pomocnicza powtórzeń** (`a6_robust.py`) przybliża podobieństwo muzyki bez chromy. W raporcie używam oficjalnych `repetition.*` v2.
- **Regresje** pokazują związek, nie przyczynę.
- **Utwory oznaczone w `alignment.md`:** 4 są w treningu (1957138, 2162283, 2219350, 2288990). Bez nich mediany metryk audio zmieniają się o ≤ 0,02.
- **Generatora nie uruchamiałem.** Wskazania kodu opierają się na jego odczycie i zgodności liczb, np. `withChords` daje najwyżej 1 akord na takt, czyli ok. 12%, a zmierzone jest 11%. Potwierdzić je trzeba eksperymentem w etapie 3.
- **Audio:** charty algorytmu powstały z audio z `.osz`, a bot gra inne uploady.
- **Czego liczby nie powiedzą:** czy chart jest przyjemny, czytelny przy prędkości gry i czy akord pasuje do dźwięku. Rozbieżność z ludźmi nie zawsze oznacza błąd; synkopy wokalu na 1/8 mogą być trafne muzycznie, mimo że ludzie ich na tym poziomie nie mapują.

## 10. Jak odtworzyć

Środowisko: `PY=/tmp/claude-0/-home-user-MewBit/4930cd9b-e13e-5233-b473-de00f0007e62/scratchpad/venv/bin/python`. Skrypty czytają tylko dane Hard (metryki v2) i piszą do `mapping-analysis/levels/hard/tables/`. Kolejność ma znaczenie, bo późniejsze skrypty czytają tabele wcześniejszych.

```
cd /home/user/MewBit/mapping-analysis/levels/hard
$PY -I a1_profile.py         # kwantyle metryk ludzi (trening/test), BPM, gatunki (Kruskal)
$PY -I a2_compare.py         # algorytm vs ludzie na teście, pary, gatunki
$PY -I a3_slots.py           # tabele slotów (`chosen`): udziały, regresje, recall źródeł, tabela per utwór
$PY -I a4_sections.py        # gęstość wokół granic, akcent na granicy, wstęp/koniec, kiai
$PY -I a5_bpm.py             # przedziały BPM, regresje na log2(BPM/180)
$PY -I a6_robust.py          # kwantyzacja do najbliższego slotu 1/8: „other”, ciąg ≤ 1/2, powtórzenia (pomocn.)
$PY -I a7_holds.py           # holdy według długości, puszczenia na siatce 1/4
$PY -I a8_patterns.py        # pomocnicze miary wzorców (przed v2; w raporcie wersje oficjalne)
$PY -I a9_genres.py          # profile gatunków, efekt gatunku po odjęciu BPM
$PY -I a10_per_song.py       # tabela per utwór testowy (beat tracking, versus_human)
$PY -I a11_rules.py          # reguły: udziały trening/test/algorytm, klasy
$PY -I a12_rc_checks.py      # wytyczne RC: serie, anchory RC, akordy w strumieniach, akordy 3-nutowe
$PY -I a13_candidates.py     # okna 4 taktów do odsłuchu
$PY -I a14_hold_placement.py # gdzie zaczynają się holdy (`chosen_hold_start`)
$PY -I a15_report_tables.py  # tabele sekcji 5
```

`common.py` ładuje dane i uzupełnia brakujące `gap_share` zerami. Jego funkcja `chosen_target` czyta teraz oficjalne kolumny `chosen` i `chosen_n_notes` z tabel slotów.