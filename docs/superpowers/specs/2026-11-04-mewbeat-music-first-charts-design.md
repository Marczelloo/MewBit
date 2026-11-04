# mewbeat: mapowanie od muzyki

Data: 2026-11-04. Gałąź `feat/mewbeat`, punkt wyjścia: generator v26 (tag `mewbeat-gen-v26`), Features v4.

## 1. Po co

Generator v26 statystycznie zbliżył się do ludzi, ale gra się różnie. Użytkownik po zagraniu (głównie Normal):

- Generator nie wie, co jest na pierwszym planie. To, co stale i charakterystycznie słychać, powinno wyznaczać bloczki. Melodia często powstaje z kilku rzeczy naraz, nie z jednego instrumentu.
- Sekcje są wykrywane za słabo (melodia, przejście, sekcja gitary).
- Paterny mają duży rozstrzał: czasem „mega dobre”, czasem „totalnie nie klikalne”. Powtarzające się sekcje utworu nie mają powtarzających się paternów.
- Największy problem to rozszyfrowanie muzyki (co, gdzie, jak). Dopiero potem można ją mapować.
- Punkt odniesienia: **Easy v26 na „Hopes and Dreams” (H&D) jest „naprawdę zajebisty”, melodyjny. „Właśnie na takie coś liczę”.**

## 2. Co zdecydował użytkownik

- **Kryterium wyboru nut jest najważniejsze.** Poziomy nie mogą być cięte „totalnie losowo, byle spełnić liczbę bloczków”. Osobne generatory nie są wymaganiem.
- **Zasada wyboru (potwierdzona):**
  1. Najpierw bloczki dostają nuty najbardziej z pierwszego planu (melodia).
  2. Gęstość fragmentu ustalają muzyka i poziom.
  3. Gdy melodii jest za mało, kolejna warstwa (np. gitara) wypełnia mocne miejsca i przerwy melodii, tylko tyle, ile brakuje.
  4. Gdy melodii jest za dużo, odpadają jej najsłabsze nuty, a nie te, które nie mieszczą się w limicie.
- **Normal ma gęstość jak ludzki Normal osu!** (ok. 2,15★ osu, ok. 5 u nas, ok. 6 nut/s). Liczba jest punktem odniesienia. Ostatecznie ocenia użytkownik, grając.
- **Gęstość nie jest stała.** Zależy od momentu, intensywności i tempa utworu.
- **Można skupić się na Normal**, dopóki nie będzie dobry.
- Wiedzy o paternach z RC i forów osu!mania nie wolno zgubić (`mapping-analysis/shared/mania-patterns.md`).
- Wzorzec słuchowy H&D:

| Czas | Pierwszy plan |
|---|---|
| 0:00–0:20 | skrzypce |
| 0:20–0:22 | szybka sekwencja z gitarą |
| 0:22–0:45 | główna melodia, gitara w tle |
| 0:45–1:07 | sama gitara |
| 1:07–1:19 | gitara z melodią (albo zmodyfikowana gitara) |
| 1:19–1:30 | gitara z melodią typu dzwonek lub flet |
| 1:30–1:52 | głównie melodia lub flet |

Zasady z pierwotnego briefu dalej obowiązują:
- Strojenie tylko na 80 utworach `train`; 20 testowych wyłącznie do kontroli po etapie, z wpisem w `mapping-analysis/TEST_USAGE.md`.
- Po każdym etapie metryki osobno dla Easy, Normal i Hard.
- Commity etapami, bez pusha i merge'a.
- Jara nie commitować.

## 3. Cele

**Cele**
- Normal, który na H&D i innych utworach idzie za tym, co słychać z przodu, co najmniej tak melodyjnie jak Easy v26.
- Żadnych niegrywalnych figur na Normal.
- Powtórzona sekcja utworu daje rozpoznawalnie powtórzony patern.

**Poza zakresem**
- Insane.
- Rozgrywka i Activity.
- Dobijanie panelu 18 metryk (przestał być celem).

**Anty-cele: porażka, nawet jeśli liczby są dobre**
- Easy traci to, co użytkownik w nim polubił.
- Wynik lepszy statystycznie, ale brzmiący jak „klikanie perkusji”.
- Analiza, której nie da się uruchomić na Raspberry Pi.
- Hard po cichu gorszy.

## 4. Co pokazały pomiary

Dane: 80 utworów `train`, kandydaci to wszystkie onsety, walidacja krzyżowa po utworach. Raport i skrypty są na razie poza repozytorium, w scratchpadzie tej sesji (`ma-run/salience/`: `RESULTS.md`, `extract.py`, `b_models.py`, `c_hd.py`). Etap 0 przenosi je do `mapping-analysis/salience/`.

**Większość sygnałów liczono w Pythonie (librosa) na audio.** Z Features v4 pochodzą tylko kandydaci (onsety warstw) i sygnały z grupy `plugin`, w tym `lead` i `bass`. Przed strojeniem wag na cechach z pluginu trzeba więc sprawdzić, że wersja w Javie daje podobne wyniki (etap 2).

`rel_os` to siła uderzenia z `librosa.onset.onset_strength` (mel) podzielona przez jej średnią kroczącą z ok. 2 s, czyli uderzenie względem otoczenia, a nie głośność bezwzględna. Dokładna definicja: `extract.py`.

- **Co przewiduje wybory ludzi (AUC E/N/H):**
  - względna siła uderzenia dźwięku `rel_os` .888/.900/.878;
  - część perkusyjna ok. .86–.88;
  - część harmoniczna .65–.72;
  - najwyższy głos, chroma i CQT .50–.60;
  - `lead` i `bass` z pluginu .50–.52;
  - zestaw bez rozdzielania na część harmoniczną i perkusyjną (HPSS), czyli `rel_os` + miejsce w takcie + zmiana w dolnym paśmie: .920/.926/.899;
  - wszystkie sygnały: .935/.935/.913.
- **F1 przy gęstości ludzi:** najlepszy model na Normal .77, generator v26 wcześniej .76–.78. **Gonienie ludzi ma małą rezerwę i nie mierzy melodyjności**, bo ten korpus nagradza uderzenia i takt. Melodię oceniamy osobno, słuchem.
- **Ludzie tną poziomy niemal idealnie w dół:** Easy w Normal .991, Normal w Hard .996. Poziomy to w dużej mierze ten sam ranking na różnej głębokości. Różnica to głównie waga miejsca w takcie: Easy prawie nie gra poza beatem, Hard to akceptuje.
- **Dziś cięcie** (`rhythm.js`, `bestMoments`) trzyma beaty, a półbeaty ocenia po głośności i miejscu w takcie. Melodia ma tylko mały bonus, zależny od `lead`, który na H&D od 22 s prawie nie działa (0,96 nuty/s przy pewności 0,66, wobec 3,55 przy 1,00 na skrzypcach).
- **Sekcje:** `Highlight.sections` używa samej głośności i progu wokół mediany, stąd jeden odcinek 65–135 s na H&D.
  - Porównanie okien 5–8 s przed i po momencie (barwa albo głośność) znalazło 21, 45, 67, 90, 112 s bez fałszywych alarmów do 1:54. To 5 z 6 granic użytkownika.
  - Brak granicy 1:19: rozkład pasm po jej obu stronach jest niemal identyczny.
  - To jeden utwór, a parametry dobrano na nim.
- **Gęstość (Normal):**
  - zmienność momentów na frazę CV: ludzie .195, generator .136;
  - korelacja gęstości z głośnością: ludzie .39, generator .61;
  - powtórka głośniejsza od źródła: ludzie ×1,15 nut (Hard ×1,22, Easy ×1,00), generator ×1,00.
- **Tory v26:** `assignLanes` nadpisuje tor Markovem bez związku z dźwiękiem i nie ma jawnego limitu anchorów. Szczegóły: `mania-patterns.md` §5b.
- **Koszt:** ok. 6,5 s na minutę audio w Pythonie, z tego HPSS 4,4 s. Reszta to 0,1–0,3 s na sygnał. Plugin już liczy HPSS dla każdej ramki (`FeatureExtractor`, `hpss.push`), więc w Javie nie jest to nowy koszt, o ile sygnały skorzystają z gotowego wyniku. Czasu na Pi nie zmierzono.

Hipoteza, niesprawdzona: Easy v26 brzmi melodyjnie, bo zostają najmocniejsze momenty. `lead` pokrywa tam tylko 0–28% momentów od 22 s, więc to nie on tworzy melodyjność. Dlatego etap 1 porównuje detektory z próbą kontrolną.

## 5. Projekt

Kolejność: **analiza muzyki → ocena momentu → wybór nut → tory i figury**. Dziś tor, poziom i filtr są splecione; po przebudowie każdy krok ma być osobny i widoczny w debuggerze.

### 5.1 Analiza (plugin, Features v5)

- **Części utworu:** nowe pole `parts`, liczone porównaniem okien przed i po momencie z barwy i głośności. Każda część dostaje opis: energia, rozkład pasm, udział części harmonicznej. Stare `sections` zostaje bez zmian, by Easy i Hard v26 nie zmieniły się do etapu 6.
- **Sygnały momentu:** `rel_os`, miejsce w takcie, zmiana w dolnym paśmie, liczone tanio.
- **Warstwa pierwszego planu:** dla każdego kandydata ocena, czy należy do tego, co prowadzi. Bez nazywania instrumentów, bo melodia bywa połączeniem kilku źródeł. Metodę wybiera etap 1.
- Zmiana cech wymaga `FEATURES_VERSION` w `analysisClient.js`, przebudowy jara i ponownej ekstrakcji cech korpusu.

### 5.2 Ocena momentu

Jeden wspólny ranking kandydatów: `ocena = siła dźwięku + miejsce w takcie + premia pierwszego planu`.
- Pierwsze dwa składniki stroimy na ludziach (train).
- Wagę premii ustawia ucho użytkownika, bo ludzie jej nie zmierzą.
- Dla każdego poziomu inna jest głównie waga miejsca w takcie, jak u ludzi.

### 5.3 Wybór nut na poziom

**Skąd kandydaci:** nowy Normal wybiera bezpośrednio z onsetów wszystkich warstw plus punkty siatki, gdzie coś brzmi (jak `withBeats`). Nie wybiera z momentów Hard v26. W etapach 3–5 Hard i Easy zostają na v26, więc **zawieranie się poziomów chwilowo nie obowiązuje**. Wraca w etapie 6.

Algorytm dla każdej frazy realizuje zasadę z części 2:
1. Budżet momentów fragmentu z 5.4.
2. Bierzemy momenty pierwszego planu od najlepszej oceny.
3. Jeśli jest ich więcej niż budżet, odpadają najsłabsze, ale tak, by rytm się nie rozsypał (mocne miejsca taktu najpierw, potem gęstość lokalna).
4. Jeśli mniej, dobieramy z innych warstw najpierw na beaty i półbeaty w przerwach melodii.
5. Nuta bez dźwięku jest ostatecznością, tylko dla ciągłości pulsu.

Decyzja projektowa: **nie osobne generatory, tylko jeden ranking**. Pomiar pokazuje, że ludzie robią właśnie tak, a od losowego cięcia chroni kryterium. Docelowo poziom niższy wybiera z momentów wyższego (`Hard ⊃ Normal ⊃ Easy`) własną wagą taktu. Zawieranie się poziomów wynika z rankingu i nie może wymuszać utraty melodii na niższym poziomie.

W każdym momencie zapisujemy powód wyboru (`melodia`, `dopełnienie`, `puls`), żeby było go widać w debuggerze.

### 5.4 Gęstość fragmentu

- Budżet frazy zależy od liczby wyrazistych dźwięków we frazie, części utworu i głośności, nie od samej głośności.
- Zależność stroimy na ludziach (train); wcześniej trzeba zmierzyć, co u nich tłumaczy gęstość frazy.
- Punkty odniesienia Normal: mediana utworów ok. 6 nut/s, CV frazy ok. .2, korelacja z głośnością ok. .4.
- 6 nut/s to punkt odniesienia dla całego korpusu, a nie cel dla każdego utworu. Budżet dopasowujemy tak, by rozkład gęstości między utworami z `train` był podobny do ludzkiego. Spokojny utwór może być wyraźnie rzadszy.
- Budżet to górna granica, nie norma do wypełnienia: dopełnienie z innych warstw (krok 4 w 5.3) dochodzi tylko do poziomu wynikającego z muzyki danego fragmentu.

### 5.5 Powtórki

- Powtórka bez zmiany głośności kopiuje rytm i tory źródła.
- Powtórka głośniejsza dokłada nuty ponad kopię (ludzie: Normal ×1,15). Nie kopiuje rzadkiej frazy na głośną sekcję, co dziś dzieje się na H&D w 146–168 s.
- Tory powtarzają się częściej niż w korpusie (.21–.26), bo o to prosi użytkownik.

### 5.6 Tory i figury

Tor znów ma związek z dźwiękiem. Wiedza: `mania-patterns.md`.
- Kształt melodii wyznacza kierunek: rosnąca sekwencja to schody, wysokie w prawo, niskie w lewo, powtarzany dźwięk to tryl lub jack w dopuszczalnych limitach.
- Źródło wysokości: `lead` i `bass` tam, gdzie mają wysoką pewność, a poza tym przybliżony kierunek z chromy lub środka widma w danym momencie. Kierunek ma tylko wskazać „w górę” albo „w dół”, nie konkretną nutę. Nowego trackera wysokości w tym przebiegu nie budujemy.
- Gdzie kierunek jest niepewny, zostaje gramatyka v26.
- Nad tym twarde reguły grywalności Normal z RC: anchor poniżej 3, brak minijacków 1/4, ograniczone sekwencje jednej ręki. Sprawdzane osobną funkcją z testami, zwracającą listę naruszeń. **Na Normal ma być ich zero.**
- Równowaga rąk i rozkłady kroków z korpusu zostają punktem odniesienia.

### 5.7 Holdy, akordy, puls, profil

- **Holdy z nutami pod spodem:** nuty drugiej ręki w trakcie holda (pomiar: nut pod holdem ludzie Normal .278, v26 .053), bez nowych momentów ponad budżet.
- **Koniec holda niezależny od następnego momentu:** dziś v26 puszcza na nim w .942 holdów na Normal, ludzie w .771. Długich holdów ≥1,5 beatu ludzie mają .171, v26 .104.
- **Holdy zgrane z dźwiękiem (wymaganie użytkownika):** długie holdy leżą na przeciąganych nutach i ciągniętym wokalu, także jeśli ludzie robią to rzadziej. Sygnał z miksu jest słaby, więc działa jako preferencja przy wyborze długich holdów, nie reguła dla wszystkich. Pomiar: `mapping-analysis/salience/holds/REPORT.md`.
- **Akordy:** według akcentu i startów części, z lokalnym limitem, tak by nie powtórzył się Mizuoto 0:12 (24 akordy wobec 9 u człowieka).
- **Puls:** przesunięcie wagi na beaty (ludzie Normal .92 beatów z nutą przy dobrej siatce, generator .76), nie dodatkowa gęstość.
- **Profil utworu:** map holdowa, akordowa lub gęsta, zależnie od muzyki. Osobny etap, po ocenie poprzednich.

### 5.8 Siatka

Śledzenie tempa jest największą i najbardziej ryzykowną pracą. 37 z 79 utworów ma ≥ .85 beatów z ludzkimi nutami. H&D ma siatkę dobrą, więc nie blokuje oceny słuchem. Sygnał miejsca w takcie traci mało na słabej siatce (AUC +.005–.022 na dobrej). Dlatego to osobny, ostatni etap, a Normal na słabej siatce sprawdzamy jawnie w metrykach.

## 6. Etapy

Każdy etap kończy się commitem i raportem:
- co zmieniono;
- metryki E/N/H;
- wynik testów;
- fragmenty do zagrania;
- czego nie sprawdzono.

**Nuty Easy i Hard pozostają identyczne jak w v26 aż do etapu 6.** Normal dostaje nową ścieżkę, a Easy dalej tnie rytm starego Normal, który generator nadal liczy wewnętrznie. Pilnuje tego test porównujący nuty i holdy z migawką v26, bez pola `version`, więc nie można ich pogorszyć po cichu.

**Wersja:** każdy etap, który zmienia nuty Normal, podnosi globalny `GENERATOR_VERSION` (od 27). Jak przy poprzednich podbiciach, unieważnia to zapisane charty wszystkich poziomów i nie dzielimy wersji na poziomy.

| # | Etap | Koniec etapu |
|---|---|---|
| 0 | Przygotowanie: migawka v26 w debuggerze, przeniesienie pomiarów i skryptów do `mapping-analysis/salience/`, commit tego projektu i `mania-patterns.md` | v26 widoczne w debuggerze obok nowych wersji |
| 1 | **Próba słuchowa pierwszego planu** (poniżej) | **Stop: decyzja użytkownika** |
| 2 | **Warunkowo.** Warstwa pierwszego planu odpada po próbie słuchowej. Części utworu i nowe sygnały wchodzą do pluginu (Features v5) tylko, jeśli pomiar z planu rytmu i gęstości pokaże, że bez nich się nie da | Wersja w Javie zgodna z wzorcem z Pythona; granice H&D; debugger pokazuje części |
| 3 | Normal: ocena, wybór nut, gęstość, powtórki | **Stop: gra użytkownik**, tory jeszcze stare; słucha rytmu |
| 4 | Normal: tory, figury, reguły grywalności | Zero naruszeń na `train` |
| 5 | Normal: budowa holdów, holdy na przeciąganych dźwiękach i wokalu, akordy, puls | **Stop: gra użytkownik** |
| 6 | Przeniesienie na Easy i Hard; A/B z Easy v26 | **Stop: gra użytkownik.** Easy nie może być gorszy słuchowo; jeśli jest, Easy zostaje na v26, a problem wraca do użytkownika |
| 7 | Profil utworu | Do uzgodnienia po etapie 6 |
| 8 | Siatka i śledzenie tempa | Osobny projekt; najpierw krótki plan do akceptacji |

**Zmiany po etapie 1 (4 listopada).** Żaden tani detektor pierwszego planu nie pokonał rankingu, a rozdzielanie instrumentów nie przeszło progu (`mapping-analysis/salience/listening/`, `stems/REPORT.md`). Dlatego premia pierwszego planu z 5.2 i warstwa z 5.1 odpadają, a ocena momentu to ranking K. Powód wyboru w 5.3 to `ocena`, `dopełnienie` albo `puls`, nie `melodia`. Melodii pilnuje kontrola: udział nut na samej perkusji w częściach melodyjnych H&D nie może wzrosnąć. Użytkownik wybór między kolejną próbą z melodią a rytmem oddał wykonawcy; wybrany został rytm, gęstość i holdy. Plan: `docs/superpowers/plans/2026-11-04-mewbeat-rhythm-density-holds.md`.

### Etap 1: próba słuchowa (bramka)

Bez kodu produktu, offline. Cel: dowiedzieć się, czy tani detektor wskazuje to, co użytkownik słyszy z przodu.

- **Kandydaci:**
  - A: `lead` z progiem długości zależnym od tempa zamiast stałych 150 ms;
  - B: premia za udział środka pasma i część harmoniczną;
  - C: połączenie z nowymi sygnałami;
  - K (kontrola): sam ranking `rel_os` + takt, bez detektora.
- **Materiał:** muzyka z kliknięciami na momentach Normal wybranych wg każdego kandydata. H&D 0:00–1:52 plus 3 inne utwory z `train` o wyraźnej melodii. Etykiety A/B/C/K bez ujawniania, który jest który.
- **Pytanie do użytkownika:** który wariant idzie za tym, co słychać z przodu, i gdzie się myli.
- **Wyniki:**
  - Wygrywa detektor: wchodzi do etapu 2.
  - K równie dobry: detektor jest zbędny, a wysiłek idzie w rytm, gęstość i tory.
  - Nikt nie jest dobry: wracamy do użytkownika z decyzją o cięższej analizie (separacja lub ML), która na Pi może nie działać, więc wymagałaby zmiany miejsca analizy.

### Etap 2: warunek zaliczenia

Etap 2 nie ma gry, bo tylko przenosi do pluginu to, co użytkownik wybrał w etapie 1. Zaliczenie:
- Na utworach z próby słuchowej momenty Normal wybrane z cech Javy pokrywają się z wersją z Pythona w co najmniej 85% przy tym samym budżecie. Gdy jest mniej, porównujemy oba wyniki na ucho i decyduje użytkownik.
- AUC modelu na `train` z cech Javy jest niższe od pythonowego najwyżej o .02.
- Granice części na H&D: co najmniej 21, 45, 67, 90 i 112 s (±2 s), bez fałszywych granic do 1:54. Dodatkowo raport liczby części na utwór w `train`, żeby wyłapać rozdrobnienie.

## 7. Jak oceniamy

Rozstrzyga **ucho użytkownika**. Liczby służą do wyłapywania regresji:
- F1 wobec ludzi na Normal: nie powinno spaść poniżej ok. .72 bez wyjaśnienia (v26 .76–.78). To mój próg ostrzegawczy, nie cel.
- Gęstość i jej zmienność z 5.4; gwiazdki osu i nasze.
- Udział momentów pierwszego planu w Normal per część H&D, tylko informacyjnie. Zgodność z tabelą z części 2 ocenia użytkownik słuchem, bo tabela nazywa instrumenty, a warstwa ich nie zna.
- Naruszenia grywalności (zero na Normal).
- Podobieństwo rytmu i torów w powtórkach.
- Beaty z nutą, holdy z nutą, nuty bez dźwięku, akordy lokalnie, osobno na dobrej i słabej siatce.
- `TEST_USAGE.md`: każda kontrola testowa to nowy wiersz; nic nie stroimy po wynikach testowych.

## 8. Ograniczenia

- Generator zostaje deterministyczny w Node (CommonJS), jak w `helpers/mewbeat/charts/`.
- Analiza zostaje w pluginie Lavalink (Java 17) i musi dać się uruchomić na Raspberry Pi. Bez modeli ML w tym przebiegu.
- Budżet czasu: nowe sygnały dokładają najwyżej 20% do obecnego czasu analizy, mierzone na Dockerze, i korzystają z gotowego wyniku HPSS z pluginu. Etap 2 raportuje czas przed i po. Pomiar na samym Pi zostaje do zrobienia przed merge'em.
- Zmiany użytkownika (`.impeccable/config.json`, `helpers/lavalink/application.yml`, jary) zostają poza commitami.
- `pnpm test` musi przechodzić; nowe moduły w stylu sąsiednich.

## 9. Moje decyzje do sprawdzenia

- Jeden ranking zamiast osobnych generatorów (5.3).
- Easy i Hard zamrożone do etapu 6.
- Trzy stopy na grę plus bramka słuchowa, zamiast robienia wszystkiego do końca jak w poprzedniej rundzie.
- Siatka na końcu.
- Granicy 1:19 na H&D nie gonimy na siłę, dopóki etap 1 nie pokaże, że to przeszkadza.
- Powtórki z torami częściej niż w korpusie.
- Nowy Normal wybiera z surowych onsetów, a zawieranie się poziomów wraca dopiero w etapie 6.
- Kierunek torów z `lead`, `bass` albo przybliżenia widmowego, bez nowego trackera wysokości.
- 6 nut/s jako punkt odniesienia korpusu, nie cel per utwór.
- Jedna globalna wersja generatora.
- Limit 20% czasu analizy oraz progi etapu 2 (85%, .02, ±2 s).

## 10. Do decyzji wykonawcy

- Dokładna metoda porównania okien i progi granic części (bez dostrajania do jednego H&D).
- Kształt pól Features v5 i debuggera.
- Podział na moduły w `helpers/mewbeat/charts/` oraz sposób współistnienia nowej ścieżki Normal z v26.
- Dobór 3 utworów do próby słuchowej (z `train`, różne gatunki, melodia słyszalna).
