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

## Jak włączyć

Jak w nocnym raporcie: dołączyć `feat/mewbeat-melody` do `feat/mewbeat`, potem dopisać nazwę flagi do
`helpers/data/mewbeat/generator-flags.json` albo przełączyć w debuggerze.
