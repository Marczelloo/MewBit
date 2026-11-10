# Linie melodii i szybkie biegi — 2026-11-10 (ciąg dalszy nocy)

Dopisek do `noc-melodia-2026-11-10.md`. Odpowiada na pytanie: czy melodia ginie przez to, że generator dzieli
utwór na krótkie sekcje, i co z tym zrobić.

## W skrócie

- **Podział na sekcje nie jest winny.** Przy granicy sekcji Normal gubi 41,6% nut melodii, z dala od granicy 41,9%
  (72 piosenki bota). Granice nie przeciekają.
- **Winne jest to, że wybór nut nigdy nie widzi melodii jako linii.** Generator ocenia każdy dźwięk osobno i bierze
  najlepsze, aż skończy się limit sekcji. Skutek: tylko 9% nut melodii leży w linii zagranej w całości, a 28% w liniach
  zagranych najwyżej w połowie.
- Zbudowałem **trzy nowe flagi** (wszystkie wyłączone, mapy bez flag identyczne nuta w nutę: 646 map; testy 2411
  przechodzi, 0 pada). Dwie inne zbudowałem, zmierzyłem i **usunąłem**, bo nic nie dawały.
- Wszystko jest na `feat/mewbeat-melody`, nic nie wypchnięte, w bocie nic nie włączone, wersja generatora bez zmian (44).

## Nowe flagi

| Flaga | Co robi | Koszt |
|---|---|---|
| `melodyLines` | Szuka linii melodii w całym utworze (nie w sekcji) i dogrywa je do tego, co sekcja już wybrała. Żadna nuta nie traci miejsca. | Brak w liczbach: zgodność z mapami ludzi bez zmian (F1 80,7), nut o 1% więcej. |
| `melodyLinesFirst` | Te same linie, ale wchodzą **przed** resztą i wygrywają miejsce z dźwiękiem, który nie jest wyraźnie głośniejszy. | Więcej melodii, ale giną nuty, które grają ludzie (F1 80,7 → 79,5; Easy 73,3 → 71,8). |
| `fastRuns` | Krótkie serie po 2–4 nuty tam, gdzie melodia biegnie szybko, także w utworach powyżej ok. 150 BPM. Do tej pory w Rush E i Finale było to niemożliwe. | Gęściej (Rush E 511 → 615 chwil). Ludzie na Normalu takich serii nie grają (F1 80,5 → 79,1). |

Linia to co najmniej 4 nuty melodii, każda najwyżej bit (albo 450 ms) po poprzedniej. Linia jest „trzymana”, gdy co
najmniej 60% jej nut ma słyszalny dźwięk i te dźwięki nie są ciche na tle utworu. To zabezpieczenie po odsłuchu
z 5 listopada, kiedy ciche nuty melodii zajęły miejsce głośnych i zostawiły dziury. Szybki bieg jest przerzedzany do
kroku poziomu: co druga nuta, najpierw te na bitach i połówkach.

`melodyLines` i `melodyLinesFirst` to dwie wersje tego samego. Włączaj jedną naraz.

## Liczby

Punkt odniesienia to trzy nocne flagi Normala (`melodyKeep`, `copyMelody`, `melodyShiftPick`). „Melodia ponad
kontrolę” = nuty melodii zagrane minus to, co trafia ta sama linia przesunięta o 2 bity (czyli przypadek).

| | Melodia zagrana (bot) | Melodia ponad kontrolę (bot / korpus) | F1 Normal | F1 Easy | Chwile (korpus) |
|---|---|---|---|---|---|
| dziś, bez flag | 61,9% | 12,8 / 8,8 | 80,5 | 73,6 | 647 |
| trzy nocne flagi | 68,6% | 18,2 / 10,8 | 80,7 | 73,3 | 653 |
| + `melodyLines` | 71,0% | 19,8 / 12,2 | 80,7 | 73,1 | 660 |
| + `melodyLinesFirst` | 72,0% | 21,9 / 15,8 | 79,5 | 71,8 | 648 |
| + `fastRuns` | 71,9% | 20,2 / 13,9 | 79,2 | 73,2 | 684 |
| + `melodyLines` + `fastRuns` | 74,4% | 21,9 / 15,4 | 79,2 | 73,0 | 692 |

Linie zagrane w całości (na tyle, na ile pozwala krok poziomu): 11,2% nut melodii → 15,9% z `melodyLines`
→ 21,7% z `melodyLines` + `fastRuns`.

Rush E, Normal: melodia zagrana 49% (dziś) → 55% (nocne flagi) → 59% (+ `melodyLines`) → 75% (+ `fastRuns`).

## Co posłuchać

Zawsze dwie wersje naraz. W obu zostaw włączone `melodyKeep`, `copyMelody`, `melodyShiftPick`.

**1. `melodyLines` — bez flagi i z flagą**

| Piosenka | Sekundy | Linia zagrana |
|---|---|---|
| MEGALOVANIA (oryginał) | 0:00–0:16 (riff) | 86% → 98% |
| Rush E | 0:56–1:04 | 73% → 84% |
| Rush E | 0:27–0:31 | 83% → 96% |
| MEGALOVANIA Remix | 4:00–4:04 | 29% → 79% |
| Finale | 0:00–0:03 | 64% → 79% |

**2. `fastRuns` — z `melodyLines` w obu wersjach**

| Piosenka | Sekundy | Linia zagrana |
|---|---|---|
| Rush E | 1:06–1:11 | 50% → 74% |
| Rush E | 1:53–1:57 | 41% → 72% |
| Rush E | 1:36–1:40 | 43% → 78% |
| Finale | 1:13–1:21 | 71% → 85% |

Pytanie do ucha: czy serie 3–4 nut co 80–95 ms są na Normalu grywalne, czy to już Hard.

**3. `melodyLinesFirst` zamiast `melodyLines`** — tylko jeśli punkt 1 się spodoba i chcesz więcej. Finale 0:00–0:03
(79% → 100%), 0:10–0:13 (57% → 71%). Słuchaj, czy nie znikają głośne, pełne nuty obok melodii.

## Co zbudowałem i usunąłem

- **`melodyDuel`** (nuta melodii wygrywa pojedynczy spór o miejsce z sąsiadem): kosztowała tyle samo F1 co
  `melodyLinesFirst` i dawała połowę melodii. Zadziałałaby tylko w szybkich utworach, bo poniżej 150 BPM sąsiednie
  ćwierćbity i tak się mieszczą.
- **`melodySnap`** (dźwięk melodii 35–60 ms od siatki dociągany do siatki): zmieniała 0,2–0,4% chwil i żadnej miary.
  Te dźwięki mają niską ocenę i w biegu i tak blokuje je sąsiad.

## Czego to nie naprawia

- **Riff w Remiksie 0:00–0:30.** Dekoder słyszy tam tylko strzępy (najdłuższa linia ma 8 nut, 0:08–0:10), więc nie ma
  czego trzymać. Dwie długie linie z końcówki (3:52–3:59, 4:04–4:08) są odrzucane jako za ciche. To nadal problem
  wykrywania, nie wyboru.
- **40% nut melodii nie należy do żadnej linii** (pojedyncze nuty, pary). Te dalej idą zwykłą drogą.
- **MEGALOVANIA 2:23–2:35:** linia przekazana w całości (49 nut), zagrane 59%. Coś dalej w łańcuchu ją przerzedza
  (kopia powtórki albo wyciszenie na końcu utworu). Nie sprawdziłem co.
- Easy, Hard i Hell powstają z Normala, więc zmieniają się razem z nim. Nie stroiłem ich osobno.

## Po pierwszym odsłuchu (10 listopada po południu)

Zestaw 1 (`melodyKeep`, `copyMelody`, `melodyShiftPick`, `melodyLines`) zagrany w Discordzie: „o wiele lepiej”, na
MEGALOVANII „klika się bardziej naturalnie, już podświadomie”. Rush E dalej gubi nuty, czasem daje trzy bloczki na jedną
nutę i zostawia przerwy, mimo że nuty grają.

Co zmierzyłem w Rush E na Normalu z zestawem 1:

- **Zgubione nuty:** 41% nut linii melodii bez bloczka. Z `fastRuns` 24%.
- **Przerwy:** 14 dziur na bit lub dłużej (razem 11,7 s), w których dekoder słyszy 2+ nuty i nie ma holda. Dźwięki w tych
  dziurach były głośne, ale poniżej progu pierwszego planu (ćwierćbit dostaje niską ocenę), a limit sekcji był już
  wydany. Żadna istniejąca flaga tego nie ruszała.
- **Trzy bloczki na jedną nutę:** na Easy i Normalu nie ma ani jednego potrójnego akordu. Są na Hardzie (21) i Hellu (36);
  `heardChords` zostawia na Hardzie 10. Bez poziomu i sekundy od gracza nie wiem, czy chodziło o to.

Nowa flaga **`loudHoles`** (Normal, wyłączona): pusty odcinek między dwiema nutami, długi na półtora bitu i co najmniej
500 ms, dostaje najlepszy głośny dźwięk, który w nim leży, ponad limit sekcji. Rush E: 14 dziur (11,7 s) → 8 (4,4 s),
z `fastRuns` 4 (2,8 s); 538 → 550 chwil. Zgodność z mapami ludzi bez zmian (F1 80,7; nut o 0,4% więcej). W całym zbiorze
bota takie dziury są rzadkie z flagą i bez (2,2 → 2,0 na piosenkę), więc to poprawka dla utworów takich jak Rush E,
a nie ogólna.

Zestaw 2 do odsłuchu: zestaw 1 + `loudHoles` + `fastRuns`. MEGALOVANIA zostaje nuta w nutę taka sama. Rush E Normal
538 → 644 chwil, Finale 532 → 585 (Easy 291 → 347).

### Trzy bloczki na jedną nutę: `fillFloor`

Gracz doprecyzował: to nie akord, tylko początek Rush E, jeden klawisz pianina i trzy bloczki na trzech torach. Miejsce:
0:04,1. Jedno E trwa 1,27 s. Normal dawał bloczek na uderzeniu i dwa „dopełnienia” 0,2 i 0,4 s później, na ledwo
słyszalnych dźwiękach (siła 0,16 i 0,17 przy 1,00 dla samego uderzenia), czyli w ogonie tej samej nuty. Easy miał tam
3 bloczki, Hard 4, Hell 5. To samo E w 0:00 i 0:05 dostawało jeden hold i tak ma być.

Flaga **`fillFloor`** (Normal, wyłączona): dopełnienia pustych odcinków i pauz pomijają dźwięk o sile poniżej 0,25.
W 0:04 jest teraz jeden hold na każdym poziomie. Takich dopełnień w całym zbiorze bota było 57 na 75 piosenek, zostaje 0.
Zgodność z mapami ludzi bez zmian (F1 80,7). Próg 0,5 wypada w liczbach lepiej (F1 81,0), ale zabiera 11 nut na
piosenkę, na które nikt się nie skarżył, więc zostaje 0,25.

Zestaw 3 w bocie: zestaw 2 + `fillFloor`. Poza Rush E (644 → 639 chwil na Normalu) trzy pozostałe piosenki testowe
są nuta w nutę takie same jak w zestawie 2.

### Fragmenty bez stałego tempa: `freeTime`

Po zestawie 3 gracz zgłosił w Rush E: do 0:08 gra pięć klawiszy, a bloczków jest cztery; od 0:12 mapa pomija nutę i nie
gęstnieje razem z muzyką; „lead 6 i 7 się pogubiły”.

Przyczyna jest jedna. Rush E przyspiesza i zmienia tempo, a siatka rytmu kładzie stałe 387 ms na bit przez całe
0:07–0:41, 1:18–1:30 i 2:04 do końca. Uderzenia pianina leżą tam względem linii siatki tak jak przypadek. Skutki:

- dźwięk dalej niż 35 ms od linii w ogóle nie był kandydatem na bloczek (głośne uderzenie w 0:07,16 przepadało),
- głośny dźwięk na „ćwierćbicie” przegrywał z ledwo słyszalnym na „bicie” (0:07,71 z dźwiękiem o sile 0,24 w 0:07,77),
- bloczki stały do 35 ms obok dźwięku,
- przerzedzanie w spadku energii zdejmowało głośne uderzenie, bo było „poza bitem” (0:14,44).

Flaga **`freeTime`** (wszystkie poziomy, wyłączona): fragment bez stałego tempa jest mapowany poza siatką. Bloczki stoją
tam, gdzie dźwięk został usłyszany, i są wybierane według samej głośności. Fragment jest „bez tempa”, gdy naraz:

1. śledzenie bitów w pluginie nie trzyma tempa (jego bity się rozjeżdżają),
2. dźwięki nie leżą na liniach siatki,
3. nuty melodii z dekodera nie układają się w żadną siatkę w tym tempie.

Każdy z tych warunków osobno jest częsty w muzyce, do której siatka pasuje (breakdown, wokal, kilka wolnych nut), i tam
mapa poza siatką jest dalsza od map ludzi. Sam pierwszy warunek łapie 6% fragmentów korpusu i pogarsza zgodność z ludźmi
w tych fragmentach (Normal F1 62,1 → 57,8). Trzy razem łapią 68 z 1910 fragmentów korpusu.

| | bez flagi | z flagą |
|---|---|---|
| Rush E, Normal: nuty melodii bez bloczka | 24% | 15% |
| Rush E, Normal: dziury (bit lub dłużej, 2+ dźwięki w środku) | 30 (16,2 s) | 22 (11,2 s) |
| Rush E, Hard / Hell: nuty melodii bez bloczka | 19% / 11% | 12% / 6% |
| Rush E, melodia ponad kontrolę | 25,3 | 33,9 |
| Korpus, F1 Easy / Normal / Hard | 73,0 / 79,1 / 81,0 | 72,7 / 79,1 / 80,9 |
| Korpus, tylko złapane fragmenty, F1 Normal | 56,9 | 54,7 |
| Zbiór bota, melodia ponad kontrolę | 21,6 | 22,7 |

Rush E: 11 z 25 fragmentów (0:07–0:41, 1:18–1:30, 2:04–koniec). Początek: bloczki w 0:00,13, 0:04,10, 0:05,84, 0:07,16,
0:07,71, czyli pięć na pięć klawiszy, potem każde uderzenie przyspieszającego E osobno. MEGALOVANIA i Finale: żaden
fragment, mapy nuta w nutę takie same. Remix: 6 z 94 fragmentów (0:31–0:35, 4:05–4:25).

Flaga zmienia też inne piosenki bota (30 z 81), najbardziej: Say My Name (19 z 47 fragmentów), Alexander Hamilton (10),
Skarazula Marazula (8), GHOST (7), REVOLVANIA (7, 2:10–2:40). Tych nie sprawdzałem uchem.

Czego nie naprawia: hold z 0:07,16 trwa 1,6 s i biegnie pod trzema kolejnymi uderzeniami (plugin słyszy wybrzmiewanie
klawisza; Normal pozwala długiemu holdowi biec pod rzadkimi nutami drugiej ręki). Ostrzejszy próg trzeciego warunku
(0,3 zamiast 0,5) daje w korpusie zysk zamiast straty (+4,0 F1 na 30 fragmentach), ale zostawia Rush E 0:12–0:24 na siatce.

Zestaw 4 w bocie: zestaw 3 + `freeTime`.

### Ciche zakończenie to nie wyciszenie: `fadeFalls`

Po odsłuchu zestawu 4: „w MEGALOVANII w dalszej części znowu była przerwa, chociaż nuty w piosence grały normalnie".

Przyczyna: reguła wyciszenia (`fadeOut`). Od 2:24 do końca (2:36) piosenka gra cicho, ale równo: energia spada z 0,58
do 0,21 i zostaje na tym poziomie (trzecie części końcówki: 0,21, 0,22, 0,21), a riff gra dalej (45 nut linii). Reguła
uznała to za wyciszenie i zdjęła połowę nut z każdego taktu: 22 nuty Normala, z 9 na 4 bloczki na dwie sekundy.

Flaga `fadeFalls`: zakończenie jest wyciszeniem tylko wtedy, gdy jego energia naprawdę opada (ostatnia trzecia część
poniżej 0,7 pierwszej). Z 31 piosenek bota z wykrytym wyciszeniem 9 kończy się równo (stosunek 0,90 lub więcej), a 22
prawdziwe wyciszenia mają 0,13–0,62, więc próg 0,7 leży w pustym miejscu między nimi.

| MEGALOVANIA | bez flagi | z flagą |
|---|---|---|
| Normal, wszystkie momenty | 662 | 684 |
| Normal, momenty po 2:24 | 25 | 47 |
| Hard / Hell, wszystkie | 821 / 1124 | 846 / 1147 |
| Easy | 336 | 336 |
| Normal, dziury (z holdami) | 10 | 4 |
| nuty linii zagrane | 90,5% | 94,9% |

Korpus: F1 bez zmian (Easy 72,7, Normal 79,1, Hard 80,9). Rush E, Remix i Finale nuta w nutę takie same. Zmienia się
9 piosenek bota: MEGALOVANIA, parodia Frozen, Hyper Spoiler, SANAH, Exit This Earth (Camellia), Puma Maciury i trzy
inne. Cztery dziury, które zostają w Normalu MEGALOVANII (0:47,9, 1:03,9–1:04,9, 2:07,4), mają dokładnie jedno uderzenie
i leżą w spadkach energii albo na granicy budżetu.

Zestaw 5 w bocie: zestaw 4 + `fadeFalls`.

### Przerwa dłuższa niż tempo nut wokół: `paceHoles`

Po odsłuchu zestawu 5: „w MEGALOVANII dalej jest przerwa ok. 2:12, na 2–4 bloczki, a muzyka gra dalej".

W 2:07,4 i 2:15,4 Normal szedł co pół uderzenia i jedną nutę opuszczał: dźwięk był na pierwszym planie, ale limit
sekcji był już wydany. `loudHoles` łata dopiero dziury od 1,5 uderzenia, a ta miała dokładnie jedno.

Flaga `paceHoles`: przerwa między dwiema nutami, która ma co najmniej jedno uderzenie i jest co najmniej dwa razy
dłuższa niż tempo nut wokół niej (mediana odstępów, po dwa z każdej strony), dostaje najlepszy dźwięk pierwszego planu,
który w niej leży, ponad limit sekcji (do 25% limitu). Dźwięk na uderzeniu ma pierwszeństwo przed dźwiękiem między
uderzeniami.

| | bez flagi | z flagą |
|---|---|---|
| MEGALOVANIA Normal, momenty | 684 | 707 |
| MEGALOVANIA 2:07,4–2:07,9 | pusto | nuta w 2:07,6 |
| MEGALOVANIA 2:15,4–2:15,9 | pusto | nuta w 2:15,6 |
| dziury ≥ 1 uderzenie, 74 piosenki bota (na piosenkę) | 5,4 | 4,6 |
| korpus, F1 Normal / Easy / Hard | 79,1 / 72,7 / 80,9 | 79,3 / 72,8 / 80,9 |
| korpus, momenty Normala | | +1,0% |

Trzy dziury, które zostają w MEGALOVANII (0:47,9, 1:03,9, 1:04,4), leżą w krótkich spadkach energii (`dipThin`).

### Powtarzana nuta melodii: `lineRepeats`

„Wybrało niższą, bardziej basową linię zamiast wysokiej prowadzącej" (Rush E, 0:30–0:41). Linia dekodera jest tam
wysoka, ale z E uderzanego co 165 ms (0:33–0:36) trzyma co drugie uderzenie: dekoder odsuwa linię od dźwięku, który
właśnie grał. Normal grał więc co drugie E, w tempie lewej ręki.

Flaga `lineRepeats`: do linii melodii dochodzą zdekodowane nuty o wysokości sąsiedniej nuty linii, do 400 ms od niej.
Rush E 0:33–0:36: bloczek na każdym E. Rush E 674 → 691 momentów, MEGALOVANIA 707 → 708. Korpus: F1 Normal
79,3 → 79,1 (precyzja 73,3 → 72,9), Easy 72,8 → 72,9, Hard bez zmian.

### Bas pod melodią ustępuje: `leadVoice`

Flaga `leadVoice`, tylko w utworze, który niesie pianino albo inna linia z wysokością dźwięku (w 75% fragmentów
na co najmniej 80% głośnych momentów zaczyna się zdekodowana nuta): moment, na którym grają tylko dźwięki o kwintę
lub więcej pod melodią, tam gdzie melodia gra, dostaje niższą ocenę. Normal bierze go dopiero, gdy nic innego nie ma.

- Bramkę przechodzą 4 z 74 piosenek bota: Finale, Bad Piggies Theme, Rush E, BlackBerry. Reszta nuta w nutę bez zmian.
- Rush E Normal 691 → 656 momentów, Finale 625 → 570, holdy w Finale 52 → 88 (długa nuta melodii jest trzymana tam,
  gdzie wcześniej grała lewa ręka). Melodia ponad kontrolę: Rush E 31,7 → 32,9, Finale 10,3 → 15,2.
- Hard i Hell są budowane na Normalu bez tej flagi i nie zmieniają się ani o nutę: bas zostaje u nich. Normal ma przez
  to 6–9 momentów, których Hard nie ma (Rush E 9 z 656).
- Easy jest cięty z Normala, więc idzie za nim: Rush E 300 → 295, Finale 338 → 331.
- Względem ludzi jest gorzej tam, gdzie jest ludzka mapa: Flower Dance Normal F1 77,4 → 74,1, Yoru ni Kakeru Easy
  70,2 → 65,1. Ludzie grają lewą rękę w utworach na pianino. To flaga wyłącznie pod ucho.
- Dziury Normala (≥ 1 uderzenie, 2+ dźwięki w środku): Rush E 3 → 6, Finale 4 → 4. Nowe mają 1,1–1,4 uderzenia;
  od 1,5 uderzenia łata je `loudHoles`.

Zestaw 6 w bocie: zestaw 5 + `paceHoles`, `lineRepeats`, `leadVoice`.

### Obie ręce naraz: `leadVoiceBoth`

Po zestawie 6: „może po prostu jakoś je łączyć czy dobierać z obydwu naraz". Flaga `leadVoiceBoth` to `leadVoice`
z jedną zmianą: bas pod melodią ustępuje tylko tam, gdzie nuta melodii zaczyna się do 120 ms od niego, czyli tam,
gdzie zabrałby jej miejsce. Reszta lewej ręki zostaje. Hard i Hell są budowane na tym Normalu, więc zawierają każdy
jego moment.

| | bez flagi | `leadVoice` | `leadVoiceBoth` |
|---|---|---|---|
| Rush E, momenty Normal | 691 | 656 | 674 |
| Finale, momenty Normal / holdy | 625 / 52 | 570 / 88 | 612 / 59 |
| Rush E, Hard | 846 | 846 | 828 |
| Finale, Hard | 734 | 734 | 717 |
| Momenty Normala, których nie ma Hard (Rush E / Finale) | 0 / 0 | 9 / 6 | 0 / 0 |
| Flower Dance, Normal F1 względem ludzi | 77,4 | 74,1 | 77,0 |
| Yoru ni Kakeru, Easy F1 | 70,2 | 65,1 | 66,6 |

Okno 200 ms daje na szybkim utworze znowu `leadVoice` (Finale 570 momentów, 85 holdów; Flower Dance 76,0), więc
zostało 120 ms. Flaga czeka na odsłuch jako zamiana za `leadVoice` (zestaw 8); obie włączone naraz dają
`leadVoiceBoth`.

### Pozostałe flagi na zestawie 6

- `heardChords`: akordy Normala na 80 utworach bota 17 339 → 16 545 (−4,6%), MEGALOVANIA 145 → 119, Finale
  134 → 100, Rush E 60 → 55; F1 bez zmian (79,1). Zestaw 7.
- `pitchLanes`: 20% nut Normala zmienia tor (Rush E 47%, Finale 36%, MEGALOVANIA 31%), momenty i akordy bez zmian.
  Zestaw 7.
- `runLanes`: po `fastRuns` rusza 3% nut Normala, schodki 55% → 56%, powtórek na tym samym torze o 17 więcej na
  80 utworach. Bez słyszalnego efektu; flaga usunięta z kodu, mapy z `pitchLanes` i bez flag zostały co do nuty.
- `melodyLinesFirst` zamiast `melodyLines`: melodia zagrana 82,8% → 84,3%, ponad kontrolę 15,3 → 18,3 p.p.,
  momenty Normala −1,3%, F1 Normal 79,1 → 78,1, Easy 72,8 → 71,8. Więcej melodii za mniej zgodności z ludźmi: do
  odsłuchu jako osobna zamiana.
- `plusMelody`: razem z poziomami, na końcu.

Zestaw 7 w bocie: zestaw 6 + `heardChords`, `pitchLanes`.

### Odsłuch zestawów 7, 8 i 9 (10 listopada wieczorem)

- **Zestaw 7 zaliczony.** „Mapy zrobiły się trochę bardziej puste, na intensywnych patternach jest mniej bloczków, ale
  poziom dalej zachowuje się jak Normal, a mapping jest dobry." To `heardChords`. `heardChords` i `pitchLanes` zostają.
- **Zestaw 8 zaliczony:** zestaw 7 z `leadVoiceBoth` zamiast `leadVoice`. „Rush E jest teraz mega i ogólnie gra się
  mega dobrze." Wobec zestawu 7 zmieniały się cztery utwory bota: Rush E Normal 656 → 673 (Hard 846 → 827), Finale
  570 → 612 z holdami 89 → 61 (Hard 732 → 716), Bad Piggies Theme 804 → 837 z holdami 72 → 44, BlackBerry 152 → 152.
  `leadVoice` przegrała i jest usunięta z kodu; mapy z `leadVoiceBoth` i bez flag zostały co do nuty.
- **Zestaw 9 w bocie:** zestaw 8 z `melodyLinesFirst` zamiast `melodyLines`. Normal wobec zestawu 8: Rush E
  673 → 658 (+37/−52 momenty, najwięcej 0:40–0:50 i 1:50–2:00), MEGALOVANIA 709 → 691 (+7/−25; 0:30, 0:50, 1:10),
  Camellia Remix 2355 → 2340 (+53/−68, z czego +26/−25 w 4:20–4:30), Finale 612 → 621 z holdami 61 → 68 (+15/−2 w
  pierwszych 20 s). To ostatni zestaw flag melodii; po nim złożenie zaliczonych flag i poziomy.
- **Zestaw 9 bez różnicy dla ucha:** „gra się dobrze, nie odczułem dużych zmian, nie ma gorzej". Przy remisie zostaje
  `melodyLines` (lepsza zgodność z ludźmi, 79,1 wobec 78,1), `melodyLinesFirst` wypada przy składaniu flag. Normal
  zostaje na zestawie 8 i na tym odsłuch flag melodii jest zamknięty.

### Poziomy, pierwszy zestaw: `plusMelody` (Hard, Hell)

Normal i Easy bez zmian (zestaw 8). Flaga zmienia tylko to, które dodatki biorą Hard i Hell: chętniej nuty melodii,
których Normal nie gra.

| | bez flagi | `plusMelody` | ludzie |
|---|---|---|---|
| dodatki Harda na nucie melodii | 9% | 18% | 22% |
| na stopie | 24% | 21% | 14% |
| na werblu | 15% | 14% | 17% |
| dodatki ludzi, które gramy też my | 14% | 14% | |
| F1 Hard wobec ludzi (korpus) | 80,9 | 80,9 | |

Liczba bloczków zostaje, zmienia się ok. 4% momentów Harda: Rush E Hard +34/−36 (827 → 825), Finale +35/−36
(716 → 715), Camellia Remix +110/−107 (2821 → 2824); Hell Rush E +46/−45, Remix +256/−252 (3460 → 3464). MEGALOVANIA
bez zmian. Zagnieżdżenie poziomów trzyma: na 160 utworach Hardowi brakuje 1 momentu Normala (bez flagi 2), Hellowi 1
momentu Harda (bez flagi 0). Skład dodatków przesuwa się w stronę ludzi, ale trafność w ich konkretne dodatki nie
rośnie: to dopiero pierwszy krok, następny to ranking dodatków według tego, na czym leżą (werbel przed stopą, inne
linie).

### Poziomy, drugi zestaw: `plusHeard` (Hard, Hell)

Odsłuch `plusMelody`: trudno ocenić, bo Hard i Hell są za trudne do przejścia; „w Rush E na Hardzie było parę momentów
z bloczkami w ogóle nie w nuty", na innych utworach w porządku. Rush E ma jedną warstwę, więc gęstość może tam brać się
tylko z akordów i z nut, które naprawdę grają.

**Co mierzyłem.** W Rush E 49 ze 152 dodatków Harda leżało poza dźwiękiem z dekodera: 31 na „stopie" (w utworze na samo
pianino to niski klawisz albo szum odczytany jako stopa), 12 na gołym onsecie. Ludzie w utworach, gdzie prawie każdy
moment ma dźwięk (10 utworów korpusu): 66% dodatków Harda leży na dźwięku (melodia 35%), akord rośnie na 31% momentów
Normala i w 68% przypadków tam, gdzie zaczynają się co najmniej dwa dźwięki; momentów mają 1,56× Normala (my 1,21×).

**Flaga.** W utworze, który niesie linia z wysokością (ta sama bramka co `leadVoiceBoth`, 4 z 80 utworów bota), i w
frazie, którą taka linia prowadzi, Hard i Hell nie biorą dodatku tam, gdzie nie zaczyna się żaden dźwięk, chyba że gra
tam werbel albo inny bęben poza stopą.

| | bez flagi | `plusHeard` |
|---|---|---|
| Rush E Hard / Hell | 825 / 1073 | 819 / 1018 |
| Finale Hard / Hell | 715 / 911 | 705 / 878 |
| Rush E Hard, dodatki na stopie lub onsecie bez dźwięku | 29% | 20% |
| F1 Harda wobec ludzi, 3 utwory korpusu z ludzkim Hardem | 83,9 | 84,1 |

Wg odczytu samej flagi (czas dźwięku, 60 ms) 90% dodatków Harda w Rush E leży teraz na dźwięku; reszta to dwie frazy,
których bramka nie obejmuje (1:22 i sam koniec, 2:17). Hell traci 6% momentów na ośmiu utworach (Flower Dance 14%),
bez ludzkiego Hella do porównania. Easy i Normal bez zmian, zagnieżdżenie trzyma (1 moment na 160 utworów).
Sprawdzone warianty: bez wyjątku dla bębnów Hell tracił 10%, a F1 Harda spadało o 0,1; na wszystkich frazach utworu
Hell tracił 7% przy tym samym F1.

### Na czym leżą dodatki w ludzkich mapach

74 utwory korpusu z ludzkim Normalem i Hardem. Ludzki Hard zawiera 98,8% momentów Normala (Normal 97,7% Easy), czyli
zasada „niższy poziom zawarty w wyższym" jest tym, co robią ludzie. Dodatki Harda na utwór: ludzie 245, my 149.

| dodatek leży na | ludzie | my (zestaw 6) | my z `plusMelody` |
|---|---|---|---|
| nucie melodii, której Normal nie gra | 22% | 9% | 17% |
| innym dźwięku z wysokością, przy linii albo nad nią | 5% | | |
| dźwięku z wysokością pod linią | 21% | 21% | |
| stopie | 14% | 24% | 21% |
| werblu | 17% | 15% | |
| innej perkusji | 10% | 12% | |
| samym uderzeniu bez wysokości i bez bębna | 9% | 12% | |
| niczym | 2% | | |

Z tego, co jest do wzięcia, ludzie biorą najchętniej werbel (40%), dźwięk nad linią (39%), nutę melodii (36%)
i dźwięk pod linią (34%); stopę 21%, samo uderzenie 13%. Tylko 14% ludzkich dodatków jest też naszymi. Wniosek na
etap poziomów: dodatki wybierać po tym, na czym leżą (melodia, której Normal nie zagrał, druga linia, werbel przed
stopą), a nie po samej głośności. Poziomy zostają na koniec, po odsłuchu wszystkich flag.

## Jak włączyć

Jak w nocnym raporcie: dołączyć `feat/mewbeat-melody` do `feat/mewbeat`, potem dopisać nazwę flagi do
`helpers/data/mewbeat/generator-flags.json` albo przełączyć w debuggerze.
