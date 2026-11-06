# Noc 2026-11-06: raporty i flagi

Wszystko za flagami wyłączonymi domyślnie. Bez flag 508 map (trening i grane utwory, wszystkie poziomy) jest identycznych z v36, a testy przechodzą (1834). Nic nie jest wypchnięte.

## Raporty (kolejność czytania)

1. [map-scan.md](map-scan.md): skan 42 granych utworów na czterech poziomach. Lista 40 najbardziej podejrzanych miejsc w formacie utwór, poziom, czas, problem.
   - Najwięcej jest akordów w cichych miejscach, głównie na Hard i Hell. 43 ze 102 takich miejsc mają akord na 3+ poziomach naraz, czyli przyczyna jest wspólna.
   - Dziury pod głośną muzyką zdarzają się głównie na Easy i Hard, zwykle na szwach fraz. Najczęściej w DM DOKURO, GHOST, Hopes and Dreams i Say My Name.
   - Przy ASGORE 1:47 odpala detektor „siatka traci zaczepienie”.
2. [tempo-changes.md](tempo-changes.md) (zadanie 3): **nie warto** robić siatki za tempem.
   - Tylko 7 z 80 utworów treningowych zmienia tempo o 3%+ na dłużej. To 0,2–0,3% nut ludzi.
   - Nawet idealne zgranie daje mniej niż +0,001 F1, a wersja z trackerem traci, bo widzi zmiany tempa w 47 z 63 równych utworów.
   - ASGORE nie zwalnia na stałe. Około 1:47,5–1:48,7 muzyka rozciąga się o pół beatu i dalej gra w 522 ms, tylko przesunięta. To problem fazy pół beatu, nie tempa.
3. [lead-gaps.md](lead-gaps.md) (zadanie 4): gdzie gubimy melodię.
   - 74% (Normal) i 81% (Hard) zgubionych melodyjnych nut ludzi to brak jakiejkolwiek wykrytej wysokości dźwięku, czyli wina detektora.
   - Progi odpowiadają za 2–3%, więc nie warto ich stroić.
   - Reszta to wybór i kopiowanie powtórzeń. Z tego wyszła flaga `copyStrict` poniżej.
   - Finale: pianino, które jest wykryte, nadal przegrywa z budżetem i kopią.
4. [fnaf-leads.md](fnaf-leads.md) (zadanie 5): **żaden trop nie jest wart flagi.**
   - Faza pół beatu już teraz pochodzi z pasma highmid. Ludzie grają w tej fazie na wszystkich 4 utworach, gdzie pełny miks się nie zgadza. Innego źródła, które by pomogło, nie ma.
   - Ludzie w głośnych frazach nie podążają za basem (wynik na poziomie losowym). My już gramy więcej basu niż oni.

## Nowe flagi do przetestowania na ucho

Włączanie: `node scripts/mewbeat-flags.js +nazwa`, wyłączanie: `-nazwa`. Bot zrestartowany, zna nowe flagi i wszystkie są wyłączone. Najlepiej testować po jednej.

| Flaga | Poziom | Co robi | Liczby (trening / test) | Gdzie słuchać |
|---|---|---|---|---|
| `copyStrict` | Normal | Powtórzenie fragmentu kopiuje nuty źródła tylko przy podobieństwie ≥ 0,95 (było 0,85), inaczej jest mapowane z własnej muzyki | F1 0,7985 → 0,8017 / 0,8331 → 0,8344, Easy i Hard bez zmian. Największy zysk tej nocy | DM DOKURO ok. 13:00, Exit This Earth's Atomosphere 2:20, REVOLVANIA 3:20, GHOST 4:10, Rude Buster 5:10, M@GICAL☆CURE 0:20. Uwaga: powtórzone frazy przestają być identyczne |
| `copyStrictHard` | Hard (+ Easy) | To samo dla Hard. Easy jest cięte z Normal v26, a ono z Hard, więc zmienia się też Easy | Hard 0,7678 → 0,7712 / 0,7920 → 0,7934; **Easy na teście 0,7576 → 0,7554** | DM DOKURO 10:00, Exit This Earth's Atomosphere 2:10, Rude Buster 2:00, Hyper Spoiler 1:10, Rebel Path 2:20 |
| `fadeOut` | Normal | W fade-oucie na końcu utworu (od ostatniego głośnego miejsca, min. 4 s) zostaje połowa momentów, najpierw te na beacie. Samotna nuta z miejscem dostaje holda. Reszta utworu bez zmian | Ludzie 1,27 nuty/s, v36 2,48, flaga 1,33. Holdów w fade-oucie 51% (ludzie 26%). F1 0,7985 → 0,7989 / 0,8331 → 0,8324 | Exit This Earth's Atomosphere 5:07–5:29, GHOST 5:18–5:38, Bad Piggies 2:19–2:36, Hyper Spoiler 4:28–5:01, Finale 1:44–1:49 |
| `stairs` | Normal | Gdy pewna linia leadu (lub basu) idzie w górę albo w dół przez 3+ pojedyncze nuty, tory schodzą lub wchodzą o jeden na nutę, a przy krawędzi zaczynają od nowa | Kroki o jeden tor w takich biegach: 24% → 66%. Zmienia się 0,8% nut, F1 i zasady Normal bez zmian. Ludzie robią to tylko na poziomie losowym, więc to czysto na ucho | DM DOKURO 12:30, Carmen 0:10–0:20, FNAF 2 0:40, FIRESTARTER 2:30, GHOST 4:00 |

Uwaga do `stairs` i `copyStrict`: wyszukiwanie torów wybiera ścieżkę dla całego utworu, więc tory mogą się różnić też poza wskazanymi miejscami.

## Czego nie zrobiłem i dlaczego

- **Holdy na fade-inach i dłuższych przejściach:** u nas holdów jest tam już więcej niż u ludzi (Normal fade-in 20% wobec 5%, przejścia 17% wobec 4%), a gęstość jest podobna. Zrobiłem tylko fade-out, gdzie różnica jest wyraźna. Jeśli na ucho fade-iny nadal brzmią źle, mogę dodać osobną flagę.
- **Nowy składnik oceny momentów (onsety średnich pasm bez perkusji),** zaproponowany w raporcie o lukach melodii: to wymaga przeuczenia wag K, więc to osobny etap, nie robota na noc.
- **Siatka za tempem i oba tropy FNAF 2:** wyniki mówią „nie warto” (raporty 2 i 4).

## Użycie utworów testowych

Wpisy 17–19 w `mapping-analysis/TEST_USAGE.md`:
- 17: `stairs` i `fadeOut`;
- 18: `copyStrict`, liczone trzy razy, bo pierwsza wspólna flaga obniżyła Easy i została rozdzielona; próg bez zmian;
- 19: `fadeOut` po przeniesieniu za wybór torów.
