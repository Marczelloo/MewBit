# Noc 2026-11-10: melodia w mapach — wyniki i lista do odsłuchu

## W skrócie

- Zbudowałem **siedem flag generatora**, wszystkie domyślnie wyłączone. Z wyłączonymi flagami każda mapa jest
  identyczna nuta w nutę z dzisiejszą (646 map porównanych). Wersja generatora bez zmian (44), w bocie nic nie włączone.
- Generator jest **około 48% szybszy** bez zmiany ani jednej nuty (Remix 22,6 s → 14,1 s, Finale 2,8 → 1,1 s).
- Wszystko leży na gałęzi `feat/mewbeat-melody` (worktree `.claude/worktrees/melody-night`), 12 commitów, nic nie
  wypchnięte, w głównym katalogu nic nie ruszałem. Testy: 2385 przechodzi, 0 pada.
- Najważniejszy wynik w liczbach: cztery flagi Normala razem podnoszą udział zagranych nut melodii na piosenkach bota
  z 61,9% do 68,7%, a zgodność z mapami ludzi się nie pogarsza (F1 80,5 → 80,7).
- **Czego to nie naprawia:** riffu w Remiksie (dekoder słyszy go tylko we fragmentach, szczegóły niżej) i połowy
  nut Rush E na Normalu (gubią je reguły odstępów i siatka, nie wybór melodii). Biegi w Rush E też zostają otwarte.
- **Ciąg dalszy (ten sam dzień):** linie melodii i biegi w szybkich utworach mają trzy kolejne flagi
  (`melodyLines`, `melodyLinesFirst`, `fastRuns`), opisane w `linie-melodii-2026-11-10.md`.

O tym, czy flagi są dobre, decyduje Twoje ucho. Liczby mówią tylko, gdzie warto posłuchać.

## Jak włączyć flagę

1. Flagi są tylko na gałęzi `feat/mewbeat-melody`. Żeby ich posłuchać, trzeba ją dołączyć do `feat/mewbeat`
   (`git merge feat/mewbeat-melody` w głównym katalogu). Gałąź wychodzi z obecnego czubka `feat/mewbeat` i nie dotyka
   żadnego pliku, który ma tam teraz niezapisane zmiany, więc dołączy się bez konfliktu. Samo dołączenie nie zmienia
   żadnej mapy. Nie zrobiłem tego sam, bo w głównym katalogu pracuje inny agent.
2. Nazwę flagi dopisujesz do `helpers/data/mewbeat/generator-flags.json` (dziś: `["easySameCuts","hardHolds"]`)
   albo przełączasz w debuggerze. Każdy zestaw flag ma własne mapy w pamięci podręcznej.

## Co posłuchać

Zawsze dwie wersje: bez flagi i z flagą. Proponuję trzy porównania zamiast siedmiu.

### 1. `pitchLanes` — Normal (tylko tory)

Tor idzie za wysokością melodii: wyżej = w prawo. Żadna nuta nie zmienia czasu, zmieniają się wyłącznie tory,
więc to najczystsze porównanie. Odpowiada na „kolumny nie idą za dźwiękiem”.

| Piosenka | Sekundy |
|---|---|
| Rush E | 0:56–1:04, 1:44–1:52 |
| MEGALOVANIA (oryginał) | 0:00–0:08 (riff), 0:32–0:40 |
| Finale | 0:48–0:56 |

### 2. Cztery flagi Normala razem — `melodyKeep`, `copyMelody`, `heardChords`, `melodyShiftPick`

Jeśli razem brzmi dobrze, wystarczy. Jeśli coś przeszkadza, wyłączaj po jednej; tabela mówi, która flaga robi co.

| Flaga | Co robi | Gdzie słychać |
|---|---|---|
| `melodyKeep` | przerzedzanie (wolniejszy fragment, spadek energii, fade out) nie wycina nut melodii | Remix 0:08–0:16 (+7 nut, wszystkie na melodii) i 2:16–2:24 (+8, 7 na melodii); Finale 0:56–1:04 (+4, wszystkie na melodii); MEGALOVANIA 0:08–0:16 |
| `copyMelody` | powtórka frazy nie jest kopią, gdy kopia gubi melodię | MEGALOVANIA 1:04–1:12 (6 nut przeniesionych, 5 trafia na melodię); Remix 4:16–4:32 |
| `heardChords` | akord tylko tam, gdzie naprawdę zaczyna się kilka dźwięków (linia pianina itp.) | Finale 0:24–0:40 i 1:28–1:36; MEGALOVANIA 1:12–1:20 |
| `melodyShiftPick` | melodia dosuwana w czasie do dźwięków utworu | tylko Rush E 0:24–0:48 |

### 3. Hard i Hell — `plusMelody` i `heardChords`

`plusMelody`: dodatkowe nuty Harda i Hella chętniej siadają na melodii. `heardChords` na Hardzie odpowiada na
„trzy bloczki na jedną nutę” w Rush E.

| Flaga | Poziom | Gdzie słychać |
|---|---|---|
| `plusMelody` | Hard | Remix 1:20–1:28, 5:12–5:28; Finale 1:28–1:44; Rush E 1:52–2:00 i 2:08–2:16 |
| `heardChords` | Hard | Rush E 0:48–1:04 i 1:36–1:44; Finale 1:20–1:44 |

**Uwaga przy słuchaniu:** każda flaga, która doda lub zabierze choć kilka nut, przestawia też akordy i tory
w innych miejscach piosenki (budżety i przeszukiwanie torów liczą się od nowa). `melodyKeep` w Remiksie zmienia
28 momentów, a rozmiar akordu na 516. Oceniaj więc, czy nuty siedzą na melodii, a nie czy układ bloczków
gdzieś indziej wygląda inaczej.

## Liczby

Dwa zestawy po 80 piosenek: piosenki bota (z plikami melodii) i korpus z mapami ludzi. Miary:

- **melodia**: jaki procent nut zdekodowanej melodii ma nutę na mapie (do 45 ms),
- **ponad kontrolę**: ten sam procent minus wynik dla tej samej melodii przesuniętej w czasie; pokazuje, ile mapa
  idzie za melodią, a ile po prostu jest gęsta,
- **F1**: zgodność z mapami ludzi na korpusie.

### Każda flaga osobno (Normal, chyba że napisano inaczej)

| Flaga | Bot: melodia | Bot: ponad kontrolę | Korpus: ponad kontrolę | F1 Normal | Werdykt |
|---|---|---|---|---|---|
| stan dzisiejszy | 61,9 | 12,8 | 8,8 | 80,5 | — |
| `melodyKeep` | 66,1 | 15,8 | 10,5 | 80,7 | największy pojedynczy zysk, warto posłuchać |
| `copyMelody` | 63,1 | 13,9 | 9,1 | 80,6 | skromna, bezpieczna (zmienia 1–2,5% momentów) |
| `melodyShiftPick` | — | 13,7 | 8,8 | 80,5 | tylko Rush E (9,3 → 11,5); siatka bezpieczeństwa na stare pliki melodii |
| `heardChords` | bez zmian | bez zmian | bez zmian | 80,5 | zmienia tylko akordy: korpus 26,3 → 24,6% |
| `pitchLanes` | bez zmian | bez zmian | bez zmian | 80,5 | zmienia tylko tory; życzenie, nie korpus (niżej) |
| `runLanes` | bez zmian | bez zmian | bez zmian | 80,5 | prawie nic nie daje, nie słuchaj |

`plusMelody` (Hard i Hell), ponad kontrolę: bot Hard 10,3 → 13,3, Hell 7,4 → 9,8; korpus Hard 6,5 → 10,4,
Hell 4,4 → 8,2; F1 Harda 81,3 → 81,2. Na trzech piosenkach: Remix Hard 8,9 → 12,7 i Hell 4,8 → 11,3;
Finale Hard 5,1 → 8,9; Rush E Hard 10,7 → 12,3.

`heardChords`, akordy na jednej wysokości dźwięku: Finale Normal 20,8 → 2,0%, Hard 44,6 → 3,7%, Hell 59,4 → 30,3%;
Rush E Hard 32,2 → 11,7%, trójki na jednej nucie 2,8 → 0,0% (Hell 3,9 → 0,8%). Flaga działa tylko we frazach,
które prowadzi linia z wysokością dźwięku: na akcentach perkusji ludzie stawiają akordy równie często jak my,
więc tam zostaje po staremu.

`pitchLanes`, zgodność kierunku tor–wysokość (zgodny / przeciwny): bot 47,0 / 40,8 → 59,9 / 28,1, korpus
47,8 / 42,4 → 61,3 / 29,1. Kontrola z pomieszanymi wysokościami: 42,5 / 45,2, czyli flaga naprawdę czyta melodię.
Rush E: 51 / 29 → 68 / 12 z 82 par. **Ludzie w korpusie nie idą za wysokością bardziej niż przypadek (47 / 41)**,
więc to spełnienie Twojego życzenia, a nie naśladowanie map.

### Cztery flagi Normala razem

| | Bot dziś | Bot z flagami | Korpus dziś | Korpus z flagami |
|---|---|---|---|---|
| melodia (Normal) | 61,9 | 68,7 | 72,6 | 75,1 |
| ponad kontrolę Normal | 12,8 | 18,2 | 8,8 | 10,8 |
| ponad kontrolę Easy | 3,9 | 5,1 | 3,2 | — |
| akordy Normal | 28,6% | 26,5% | 26,3% | 24,1% |
| momenty na piosenkę | 815,3 | 823,5 | 647,1 | 652,7 |
| F1 Normal / Easy | — | — | 80,5 / 73,6 | 80,7 / 73,3 |

Trzy piosenki (Normal, melodia): Rush E 49,2 → 55,4; Remix 71,3 → 75,2; Finale 74,0 → 76,2; MEGALOVANIA oryginał
82,6 → 85,0. Easy traci 0,3 punktu F1, bo dziedziczy nuty Normala; to jedyna liczba, która się pogarsza.

Z `plusMelody` i `pitchLanes` dodatkowo: ponad kontrolę Hard bot 10,3 → 16,0, Hell 7,4 → 11,5; F1 Harda bez zmian (81,3).

## Twoje uwagi do Rush E — co jest, czego nie ma

| Uwaga | Stan |
|---|---|
| „pomijanie niektórych nut”, „bloczki nie idą za każdym uderzeniem” | częściowo: 49,2 → 55,4% nut melodii na Normalu. Reszta ginie gdzie indziej: 19–23% to nuty za blisko siebie dla Normala, 11% leży poza siatką, 17–18% jest za słabych w dźwięku |
| „trzy bloczki na jedną nutę” | `heardChords`: trójki na jednej nucie na Hardzie 2,8 → 0,0% |
| „kolumny nie idą za dźwiękiem” | `pitchLanes` |
| „brak zgrupowania nut w szybszych biegach” | **otwarte.** `runLanes` układa biegi w schodki, ale na Normalu biegów prawie nie ma (7 par w Rush E), bo reguły odstępów wycinają je wcześniej. Trzeba najpierw wpuścić biegi na mapę, dopiero potem je układać |

## Co sprawdziłem i odrzuciłem

- **`melodySwap`** (zamiana zagranej nuty na pobliską nutę melodii): zero efektu, usunięta. Zablokowane nuty melodii
  są za słabe w dźwięku, żeby w ogóle dojść do zamiany.
- **Większa premia za melodię przy wyborze nut**: premia 2 daje bot 12,8 → 14,8, ale F1 Normal 80,5 → 80,2 i Easy
  73,6 → 73,0; premia 3 jeszcze gorzej, a Rush E traci. Kupuje melodię kosztem zgodności z ludźmi, zostawiłem jak jest.
- **Flaga „perkusja nie prowadzi tam, gdzie jej nie ma”**: nie zbudowana, niski priorytet.

## Riff w Remiksie

Riff jest w nagraniu, ale dekoder (Basic Pitch) zapisuje tylko jego strzępy: pięć pierwszych nut riffu znajduje
wyraźnie tylko około 0:11 i 0:15. Żadna flaga generatora tego nie naprawi, bo generator nie dostaje tych nut.

- Filtry, rozdzielenie perkusja/reszta i niższe progi dekodera: bez zysku albo gorzej.
- Rozdzielenie na ścieżki (Demucs, ścieżka „reszta”): początek riffu 4 razy w 0:00–0:30 i 3 razy w 0:30–0:55,
  nic w 0:55–1:44, słabo po 1:44. To częściowo zgadza się z tym, co słyszysz (0:00–0:30 tak; fragment 0:55–1:44
  dalej zgubiony).
- Koszt: 277 s na tym komputerze dla tej piosenki; na Pi 5 szacuję około 14 minut (nic nie uruchamiałem na Pi).
  Na innych piosenkach ta ścieżka zmienia linię prowadzącą bardzo mocno, co nie znaczy, że na lepsze.
- Dla porównania oryginalna MEGALOVANIA: dekoder znajduje pełny riff 7 razy w pierwszych 30 s. Tam działa.

Wniosek: nie wkładałbym Demucsa do bota bez testu odsłuchowego, a na Pi tylko jako praca w tle, nie przy każdej
nowej piosence. Pełny opis: `scratchpad/night/remix/REPORT.md` (katalog roboczy sesji).

Osobno: przy `melodyShiftPick` wyszło, że **12 z 33 sprawdzonych plików melodii bota jest nieaktualnych**. Ponowne
dekodowanie to prawdziwa naprawa; flaga tylko łagodzi skutki.

## Szybkość generatora

Bez zmiany nut (646 map identycznych). Mediana na 12 piosenkach: 53,1 s → 27,4 s łącznie.

Co zrobione: dopasowanie tempa liczy kąt każdego uderzenia raz na okres; przeszukiwanie torów pyta o koszt raz
na figurę i moment i czyta tory z tablicy; poziom zbudowany na innym nie liczy drugi raz tego samego.

Co zostało (nie ruszone): dokładne przycinanie szukania okresu w dopasowaniu tempa (około 30% na długich
piosenkach), alokacje w przeszukiwaniu torów, powtarzane liczenie momentów. Stary łańcuch v26 zostaje (w profilu
sprzed nocy 20–24% czasu); jego usunięcie to osobna zmiana, do sprawdzenia nuta w nutę.

## Pi 5 (tylko odczyty, nic nie zmieniałem)

- 4 rdzenie prawie bezczynne (obciążenie 0,19), 41 °C, bez dławienia, 91 dni pracy bez przerwy.
- RAM: 8 GB, zajęte 3,3 GB, **wolne około 4,7 GB**; 19 kontenerów, największy Lavalink (0,8 GB).
- Dysk 235 GB, zajęte 52 GB. Z obrazów mewbeat jest tam tylko Lavalink.
- Miejsce na osobną usługę dekodera jest. Jedna rzecz do Twojej decyzji: jądro startuje z `cgroup_disable=memory`,
  więc kontenerom nie da się dziś ustawić limitu pamięci. To ustawienie systemowe, nie zmieniałem go.

## Co proponuję dalej

1. Odsłuch trzech porównań z listy wyżej; to, co się spodoba, włączam w bocie i składam w wersję 45.
2. Ponowne dekodowanie starych plików melodii.
3. Biegi na Normalu: wpuścić szybkie nuty melodii przez reguły odstępów (to największa strata Rush E), potem `runLanes`.
4. Dekoder jako osobna usługa na Pi; Demucs najwyżej w tle i dopiero po teście odsłuchowym.
