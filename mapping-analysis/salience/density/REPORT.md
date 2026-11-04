# Co Normal potrzebuje od pluginu

Pomiar przed nowym Normalem. Trzy pytania: czy siłę onsetu z Features v4 można liczyć bez `rel_os` (A), co tłumaczy gęstość frazy u ludzi (B), czy tani detektor przeciąganego dźwięku bije obecny (C). Tylko 80 utworów `train`. 20 testowych nie czytane. Hopes and Dreams służy tylko do pokazania, co robi detektor (C); nie ma ludzkiej mapy.

## Progi zapisane przed pierwszym przebiegiem
Nie zmieniają się po wyniku. Wszystko wypróbowane ponad listę poniżej trafia do raportu z liczbą prób.

### A. Czy siła onsetu z Features v4 zastępuje `rel_os`
- Kandydaci: skupienia onsetów Features v4 w 30 ms (jak w feat/*.pkl). Etykieta: nuta człowieka w 35 ms.
- K: regresja logistyczna (C=1) na rangach w obrębie utworu z `rel_os` albo zastępnika, m_beat, m_half, m_quarter, m_other, m_down, d_grid. Walidacja po utworach, 5 grup, podział jak w stems/measure.py (permutacja, ziarno 0).
- Siatka: cechy metryczne z siatki, którą generator naprawdę ma (ctx.timing). Jeśli w pkl jest inna, porównanie idzie na siatce generatora; oba warianty w raporcie.
- Zastępniki (tylko z bands, drums, bass, lead, energy): siła skupienia względem średniej w oknie ±1 s; ±0,5 s; ±2 s; względem sumy w oknie; względem maksimum w oknie; suma po źródłach względem okna; maksimum po źródłach z osobną średnią każdego źródła; siła surowa; energia wokół onsetu względem ±1 s. Wszystkie w tabeli.
- Wybór: najwyższa średnia AUC (po utworach, potem z trzech poziomów).
- Próg: wybrany zastępnik ma na każdym z poziomów E, N, H AUC K >= AUC K z rel_os - .01, na tej samej siatce, w średniej i w medianie po utworach. Spełniony: rel_os nie wchodzi do pluginu. Niespełniony: plugin musi dawać rel_os.

### B. Co tłumaczy gęstość frazy u ludzi na Normal
- Cel: nuty człowieka na Normal na sekundę, na frazę z analyse() (>= 2 s, w całości między pierwszą a ostatnią nutą mapy). Utwory bez Normal pomijane i policzone.
- Baza: liczba wyrazistych dźwięków na sekundę (kandydaci powyżej kwantyla K w utworze; kwantyl z {.5,.6,.7,.8,.9} wybrany na grupach uczących, K liczony zagnieżdżenie) + głośność frazy względem utworu.
- Model: regresja grzbietowa (alpha 1, cechy standaryzowane). R² z walidacji po utworach, zbiorczo po frazach.
- Części utworu, dwie formy osobno: (1) z Features v4 bez pluginu: ranga energii sekcji, położenie frazy w sekcji i utworze, początek sekcji, fraza powtórzona, fraza ma późniejsze powtórzenie, wzrost głośności sekcji; (2) etykieta struktury z audio: segmentacja z samopodobieństwa beat-synchronicznego MFCC + chroma, klastry; cechy: ile razy klaster wraca, czy najczęstszy, ranga głośności, odległość od reszty, położenie w segmencie; dwie skale segmentu (~15 s, ~30 s), do progu lepsza.
- Próg: forma wchodzi, gdy baza + forma ma R² >= .02 wyższe niż sama baza. Forma 1 przechodzi: bez pluginu. Tylko forma 2: wymaga pluginu. Żadna: części nie wchodzą.
- Do raportu: R² między utworami i wewnątrz utworu; rozkład gęstości utworu u ludzi (mediana, CV, korelacja z głośnością) i u modelu.

### C. Czy tani detektor przeciąganego dźwięku bije obecny
- Wzorzec i miary jak holds/measure.py (start długiego dźwięku ze ścieżek Demucs, >= 1,5 beatu; AUC mediana po utworach; precision@k; walidacja po utworach; pokrycie = ułamek 1748 przeciąganych dźwięków z odcinkiem pokrywającym >= połowę).
- Detektory: D1 dłuższe okno HPSS (~1,4 s, spektrogram uśredniony po 4 ramkach); D2 stabilność chromy z tolerancją wibrata (36 binów, maksimum po sąsiednich); D3 kanał środkowy (L+R)/2 z torem D1.
- Zestawy: każdy detektor + CHEAP, oraz D1+D2+D3 + CHEAP; cztery podejścia liczą się do progu osobno. Każdy sam jako informacja.
- Pokrycie w punkcie pracy: gdy detektor wystawia > 30 odcinków na minutę (mediana), do pokrycia idzie 30 najpewniejszych na minutę.
- Koszt: dodatkowy czas na minutę audio (jeden wątek, bez istniejącego STFT) / czas compute_series na utworach 1127488, 1141872, 1196084, mierzony w tej samej sesji (timing.log: 6,45 s). Limit 20%.
- Próg (Normal; E i H w raporcie): (AUC >= .72 LUB precyzja >= .15) ORAZ pokrycie >= .35 ORAZ koszt <= 20%. Spełniony: potrzebny plugin. Żaden zestaw: lead + bass bez progu pewności, plugin niepotrzebny.

## Wyniki

Progi z a5331c9, bez zmian. 80 utworów `train`, testowych nie czytano. Utwory bez danego poziomu pominięte (podane przy każdym).

### A. Czy zastępnik z Features v4 zastąpi `rel_os` w K

Nie. `rel_os` (librosa, siła onsetu / średnia z 2 s) jest potrzebny z pluginu. Siatka: `ctx.timing` generatora (metrum z surowych beatów trackera zgadza się z nią w 8 z 80 utworów; na siatce z pkl AUC różni się o mniej niż .002 dla `rel_os` (do .0002) i `raw_strength` (do .001); dla wariantu bez kolumny siły o .0035–.0039).

| Poziom | `rel_os` | zastępnik (`raw_strength`) | bez kolumny siły | różnica (średnia / mediana) |
|---|---|---|---|---|
| Easy | .9048 | .8709 | .8406 | -.034 / -.034 |
| Normal | .9101 | .8683 | .8350 | -.042 / -.040 |
| Hard | .8932 | .8464 | .7954 | -.047 / -.053 |

Utworów z danym poziomem: Easy 79, Normal 78, Hard 75 z 80 (reszta nie ma tego poziomu). Po błędzie w rangowaniu (ranga liczona globalnie, a nie w obrębie utworu) pomiar powtórzono; AUC zmieniło się o mniej niż .003, werdykt bez zmian. Próg to -.01 na każdym poziomie. Zastępniki względne wobec okna 0,5, 1 i 2 s nie dodają nic ponad surową siłę (średnia po poziomach: `raw_strength` .8619, `per_source_max_rel` .8599, skupienie/maksimum .8596, skupienie/średnia ±2 s .8539, energia .8257). Wagi K z `rel_os`: `k_weights.json`.

### B. Co tłumaczy gęstość fraz Normal

Części utworu nie wchodzą. 78 utworów (2 pominięte: brak poziomu Normal, brak użytecznej frazy), 1709 fraz, średnio 4,56 ruchu na sekundę.

- Baza (wyraziste dźwięki + głośność): R² .243 (między utworami -.115, wewnątrz .357).
- K jest dopasowany bez foldu f, ale wiersze uczące są oceniane przez K wytrenowane na nich samych (w próbie). Wpływu tego nie mierzono; dotyczy bazy i obu form tak samo.
- Forma 1, z Features v4 (sekcje, powtórzenia): ΔR² -.0057, CI [-.016, .005]. Nie przechodzi.
- Forma 2, etykieta struktury offline (15 s): ΔR² +.0157, CI [-.010, .040]. Poniżej .02, nie przechodzi. Przy 30 s -.0018.
- Obie razem: +.0114 (15 s), -.0045 (30 s).

Gęstość ludzka między utworami prawie się nie zmienia (CV .155, korelacja z głośnością .009), więc model tłumaczy ją niemal wyłącznie w obrębie utworu. Plugin nie jest tu potrzebny.

### C. Tanie wykrywanie długich dźwięków

Nie przechodzi żaden zestaw, i to już na dokładności: każdy ma AUC < .72 i precyzję < .15, więc koszt nie rozstrzyga. `pass` liczy się z dokładności ORAZ pokrycia ORAZ `cost_new_only` (koszt samych nowych detektorów); `pass_strict` używa `cost_with_shared_chain`. Decyzja: `lead` + `bass` bez progu pewności, bez pluginu.

Wyjście: 1748 długich dźwięków (>= 1,5 beatu, udział >= .2) w 80 utworach train. Do AUC wchodzą utwory, które mają co najmniej 5 kandydatów o długim celu i co najmniej 5 pozostałych: Easy 59, Normal 65, Hard 66. Odtworzenie wyniku bazowego zgadza się z `holds`: AUC .638 / .65 / .639, precyzja@k .115 / .102 / .094.

| Zestaw | Easy AUC / prec | Normal AUC / prec | Hard AUC / prec |
|---|---|---|---|
| obecny (CHEAP) | .638 / .115 | .650 / .102 | .639 / .094 |
| D1 + CHEAP | .639 / .125 | .653 / .098 | .634 / .095 |
| D2 + CHEAP | .652 / .132 | .667 / .112 | .651 / .106 |
| D3 + CHEAP | .648 / .116 | .649 / .104 | .631 / .104 |
| D1+D2+D3 + CHEAP | .647 / .138 | .657 / .124 | .651 / .117 |

Żaden nie osiąga AUC .72 ani precyzji .15. Pokrycie: D1 .371, D2 .467, D3 .301 (obecny miks .234; D1+D2+D3 .682; z miksem i `lead`+`bass` .718). Koszt wobec `compute_series` (6,41 s na minutę audio): D1 .165, D2 .044, D3 .185, wszystkie trzy .395; z obecnym łańcuchem D1 .214 i D3 .225 (powyżej 20%).

D3 w tabeli to wariant z wyciągniętym środkiem (maska na sygnale boku), nie dosłowne (L+R)/2. Dosłowne D3 to ten sam miks mono co D1 i daje identyczne liczby, więc osobnego wiersza nie ma. Wiersz "D3 + CHEAP", pokrycie D3 .301, koszt D3 .185 i D3 w zestawie D1+D2+D3 dotyczą wariantu ze środkiem.

Hopes and Dreams (3,08 min, 29 długich dźwięków, 16 w oknach `HD_PARTS`): widzi je obecny miks 11, D1 13, D2 16, D3 13. W częściach: skrzypce 8 z 8 (miks, D1, D3), D2 6; melodia 2 (D2 1), sama gitara 3 (D1, D2, D3 po 1), melodia i flet 3 (D2 1); pozostałe części 0. D1 (33,4), D2 (36,4) i D3 (33,4) dają tu więcej niż 30 odcinków na minutę, więc zastosowano ograniczenie do 30 najpewniejszych na minutę. Na tym utworze ograniczenie jest bezwarunkowe.

### D. Wybór nut: `rel_os` i siła surowa (informacja, decyzja A bez zmian)

Wybór nut w budżecie fraz (E / N / H), `rel_os` (R) wobec `raw_strength` (W); szczegóły w `rel_proxy_select.log`. Budżet to wyrocznia: N nut na frazę to liczba nut człowieka w tej frazie, więc F1 mierzy wybór przy znanej liczbie nut, a nie to, ile nut wybrałby generator. Różnice F1 to sparowane mediany po piosenkach z przedziałem bootstrap 95%; F1 R i W to mediany.

- Zwykły top-N: F1 R .706 / .766 / .770, W .734 / .794 / .799 (sparowana mediana R minus W −.018 / −.025 / −.018, przedział bez zera). Udział duplikatów wśród wybranych: R .084 / .105 / .133, W .040 / .048 / .081.
- Zachłannie, odstęp 70 ms: F1 R .783 / .846 / .879, W .772 / .830 / .856 (sparowana mediana R minus W +.019 / +.025 / +.024, przedział bez zera). Luka beatów do człowieka mniejsza u R na każdym poziomie. Brak kandydatów (R / W): Easy 0 / 0 z 1741 fraz, Normal 2 / 2 z 1709 (3 / 3 nuty), Hard 120 / 119 z 1673 (890 / 910 z 58143 nut).
- AUC po jednym pozytywie na nutę: luka R minus W .034 / .042 / .047 maleje do .0055 / .013 / .012 (najlepszy z kandydatów nuty) albo .011 / .019 / .020 (najbliższy); przedziały bez zera. Odrzuca się 26% pozytywów.
- Odstęp między nutami (zachłannie, sparowana mediana R minus W F1, E / N / H): 0 ms −.018 / −.025 / −.018; 35 ms +.006 (przedział od 0) / +.012 / +.022; 50 ms +.015 / +.020 / +.031; 70 ms +.019 / +.025 / +.024; 100 ms +.019 / +.017 / +.005. Realny odstęp generatora (`minNoteGapMs`, egzekwowany w `spacedMoments` i `enforceFloors`: 130 / 100 / 60 ms): +.018 / +.017 / +.030, po przyciągnięciu kandydatów do siatki +.015 / +.016 / +.028, przedziały bez zera. Znak ujemny tylko przy odstępie 0. Ludzkie momenty bliżej niż realny odstęp (górny pułap recall): 0,4 / 5,2 / 0,7%. Niedobór nut przy realnym odstępie (R / W): Easy 8 / 10, Normal 356 / 364, Hard 160 / 161. Hard przy 100 ms: 32% ludzkich momentów bliżej niż odstęp i 12,4% nut bez miejsca, więc +.005 w tym wierszu jest zniekształcone. Wybór zachłanny po wyniku przybliża regułę generatora (tam wygrywa wcześniejsza nuta; `spacedMoments` i `enforceFloors` są w `difficultyFilter.js`).
- Mechanizm (pomiar): 42,6% kandydatów ma sąsiada bliżej niż 35 ms; w takich parach `rel_os` (filtr maksimum po 5 ramkach) jest identyczne w 41,5% (raw_strength 0,8%; pary 100–200 ms: 0%). Po przeliczeniu `rel_os` z audio bez filtra duplikaty w zwykłym top-N spadają do .045 / .059 / .087 (W .040 / .048 / .081), a sparowana mediana R minus W wynosi +.004 / +.007 / +.014 (E i N: przedział dotyka zera). Cena: AUC R spada z .905 / .910 / .893 do .866 / .869 / .852, czyli do poziomu W. Drugie, niezależne wyjaśnienie to nasycenie: 8,8% kandydatów ma `raw_strength` równe 1,0 (24 / 20 / 16% pozytywów, 36 / 28 / 22% wyborów W w zwykłym top-N). Wynik zwykłego top-N bez reguły odstępu zależy od remisów `rel_os` (usunięcie filtra zmienia znak różnicy), ale nie rozstrzygnięto, ile różnicy F1 daje każdy z dwóch mechanizmów.
- Proxy post-hoc z filtrem maksimum (wybrane po zobaczeniu, że `rel_os` bez filtra spada do AUC `raw_strength`; progi i decyzja A bez zmian; `rel_proxy_mf.log`): `W_mf` = maksimum `raw_strength` po kandydatach w ±23,22 ms (5 ramek po 11,61 ms, jak filtr `rel_os`), `W_mf_rel` = `W_mf` / średnia ±1 s, `W_rel_mf` = to samo w kolejności `rel_os`; żaden nie przechodzi progu −.01 (AUC średnia proxy minus R: `W_mf` −.033 / −.039 / −.043, `W_mf_rel` −.038 / −.047 / −.057, `W_rel_mf` −.038 / −.047 / −.057 dla E / N / H; mediany podobnie), `W_mf` zamyka 4 / 7 / 9% luki AUC R minus W. W budżecie fraz (wyrocznia) przy realnym odstępie generatora (130 / 100 / 60 ms) sparowana mediana F1 R minus `W_mf` to +.019 / +.017 / +.030 (R minus W +.018 / +.017 / +.030), więc proxy nie zamyka luki F1; przy odstępie 0 `W_mf` zamyka 47–61% (równe pary sąsiadów 26% wobec 41% u `rel_os`; związek z remisami nie jest osobno sprawdzony).
- Decyzja A bez zmian.

## Głośniejsze powtórki: skąd `REPEAT`

`REPEAT = { louder: 1.1, gain: 1.15, sparse: 0.5 }` w `momentWeights.js`. Powtórka liczy się jako głośniejsza od 1,1 raza słyszalnej głośności źródła. Dostaje wtedy kopię źródła i momenty z własnego rankingu do 1,15 raza momentów źródła, ale nigdy ponad swój budżet. Gdy źródło ma mniej momentów niż połowa budżetu powtórki, powtórka jest pisana od nowa. Pomiar na 80 utworach treningowych, `measure_normal.js`.

- Ludzie, powtórki głośniejsze: mediana nut wobec źródła 1,034, średnia 1,366 (51 fraz). Rozkład jest skośny: połowa fraz dokłada najwyżej ok. 3%, a kilka dokłada dużo więcej. Średnią ciągną głównie kopie z dodatkami (49 fraz, średnia 1,321), a nie 2 frazy pisane od nowa.
- `gain` 1,15 to wybór estymatora (średnia ucięta), a nie mediana. Mediana dałaby 1,03, średnia 1,37. Wybór zapadł po obejrzeniu danych, wpływ na gęstość Normala jest poniżej 1%.
- Wykres po wdrożeniu: mediana 1,103, średnia 1,160 (57 fraz). Powtórki pisane od nowa: wykres 3 frazy, mediana 2,417; ludzie 2 frazy, mediana 2,455. Powtórki tej samej głośności: mediana 1,000 po obu stronach.

## Siatka Normala: defekt z Tasku 3 i poprawka

Ścieżka wyboru z muzyki z Tasku 3 brała surowe czasy onsetów zamiast czasów na siatce. Dwie recenzje tego nie wykryły, bo `measure_normal.js` liczył beat z tolerancją 70 ms i pokazywał .92. Wyszło dopiero w przebiegu korpusu `s8`. Poprawka: `29dfd12`. Podział siatki to stałe 1/4 beatu. Kandydat dalej niż 35 ms od zaufanej siatki odpada (13,5% kandydatów). Surowy czas zostaje tylko tam, gdzie siatka jest niezaufana. Miary ścisłe w `measure_normal.js` stoją teraz obok tych z tolerancją.

Train, 77 utworów z zaufaną siatką, przed i po poprawce: momenty na siatce 1/4 .593 i 1,000; ścisły udział beatów (5 ms) .76 i .92; momenty/s 4,646 i 4,648.

## Rozbieżności wobec planu

- Plan zakładał CV gęstości ok. .2 i korelację z głośnością ok. .4. Pomiar ludzi: CV między utworami .155, CV fraz .205, korelacja .009. Budżet strojono do pomiaru.
- Pauzy od 2 beatów: ludzie .64 na minutę, v26 .65, v27 1,61 (mediana po utworach w korpusie). Poprawka siatki zmieniła to o ok. 3%, więc przyczyną nie jest siatka. Luk jest ok. dwa razy więcej, a udział luk z mocnymi dźwiękami w środku jest podobny (.68, ludzie .72). Nie stroiłem tego przed grą.
- Okna 4 beatów są gęstsze niż u ludzi przy p95 i p99 (9,20 i 10,03 wobec 8,78 i 9,68 nut/s).
- Udział akordów nie jest twardym limitem: mediana .326, najwyższy utwór .380 (2391949). Downbeaty, otwarcia i kopie omijają bramkę. Limit akordów jest w Tasku 8.
- Korelacja gęstości utworu z ludzką mapą ok. −.06 do −.12: model nie przewiduje różnic między utworami, choć rozrzut jest podobny.
- Easy nie jest już prawie podzbiorem Normala: normal→easy .938 (v26 1,000), bo Easy jest cięty z wewnętrznego `normalV26`.

## v29: wynik etapu po Taskach 6–8

Kod zamrożony przed kontrolą na 20 testowych (użycie nr 10). Migawka: `synthesis/out/v29_normal`, holdy: `salience/holds/measure_v29.log` (wiersz chartu jest tam podpisany „v26” niezależnie od `--charts`). Easy, Hard i Hell bez zmian na 81 utworach. Dalej liczby Normala.

Train, człowiek / v26 / v29: nuty/beat 2,031 / 2,147 / 2,053; akordy .343 / .357 / .285; holdy .097 / .091 / .125; holdy z nutą w środku .101 / .030 / .145; pauzy od 2 beatów na minutę .636 / .649 / 1,384; bez dźwięku .069 / .118 / .073. Per-song .582 i .582, mediana .512 i .519 (v27 .502), P .753 i .782, R .781 i .827, in-band 16 i 16.

Test, człowiek / v26 / v29: nuty/beat 2,016 / 2,135 / 1,960; akordy .317 / .392 / .284; holdy .082 / .097 / .164; holdy z nutą w środku .130 / .015 / .092; pauzy .570 / .684 / .913; bez dźwięku .055 / .114 / .068. Per-song .612 i .529, mediana .524 i .500, P .782 i .841, R .789 i .834, in-band 16 i 16.

Rozjazdy:

- Holdów jest za dużo względem ludzi: train .125 wobec .097, test .164 wobec .082. Na testowych odległość wzrosła z .61 do .94. Nie stroiłem tego na testowych.
- Zagnieżdżenie algo spadło: hard→normal 1,000 do .939 (test .938), normal→easy 1,000 do .942 (test .940). Ludzie ok. .995. To skutek wyboru z muzyki, a nie cięcia z wyższego poziomu.
- Długie holdy na dźwięku wobec losowego ułożenia, średnie: v27 .207 i .094, v29 .256 i .090, ludzie .219 i .051. Próg 3× z Tasku 7 nie jest spełniony: 2,80 na utwór, 2,48 łącznie.
- `maxChordsPer8Beats` 6 pochodzi z ucha użytkownika, a nie z rozkładu ludzi (p50/p90/p95/p99 na 8 beatów: 4 / 8 / 8 / 10). H&D 22–45 s: mediana akordów na 8 beatów z 7 do 4,5–5, maksimum z 9 do 6. Mizuoto 12–20 s bez zmian (7 akordów, 26 momentów, 33 nuty); przyczyna raczej gęstość nut, nie akordy.
- `motifPull` 2 na publicznym Normalu. Różne figury 4-blokowe na 100: 44 przy 6, 50 przy 2, ludzie 56. Koszt: kroki zgodne z melodią .648 do .621, echo na tych samych torach .944 do .90, przejścia akordów między rękami .372 do .388 (ludzie .556, v27 .571). Próg testu opadającego przebiegu obniżony z .7 do .65, bo .7 trzymało się samowzmacnianiem; bez torów melodii wynik to .446.
- Końcowa recenzja: 0 krytycznych, 0 ważnych, 6 drobnych. Niezmierzone: czas `generateAll` na Pi.
