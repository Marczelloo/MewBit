# Etap 0: gdzie ginie melodia i czy tempo jest dobre

Data: 2026-11-10. Poziom: Normal, generator v44 z flagami bota. Tylko pomiary, żadnej zmiany w kodzie.
Utwory: MEGALOVANIA (Camellia Remix), Finale (Toby Fox), Rush E (Sheet Music Boss), a do porównania oryginalna
MEGALOVANIA, na której melodia wychodzi dobrze.

## Najkrócej

1. **Tempo jest dobre na muzyce studyjnej.** Na 79 z 80 utworów z mapami ludzi nasze końcowe BPM jest takie samo jak u
   ludzi, a 99% ich nut leży na naszej siatce ćwierć-uderzeń. Problem z tempem zostaje na utworach granych „na żywo"
   i na kilku, w których siatki nie ma wcale (lista niżej).
2. **Normal nie jest mapą melodii, tylko mapą głośności i pozycji w takcie, którą melodia lekko popycha.** Na trzech
   utworach plik z melodią zmienia 3–7% momentów mapy. Mapa zrobiona bez niego gra prawie te same nuty.
3. **Każdy z trzech utworów gubi melodię gdzie indziej:**
   - remix Camellii: melodia ginie przy **wykrywaniu**. Dekoder słyszy cienką linię, a mapa robi się mapą perkusji;
   - Finale: melodia jest wykryta, ale we wstępie pianina **budżet nut jest mniejszy niż melodia**, a od 1:04 prowadzi
     perkusja;
   - Rush E: **błąd przesunięcia melodii o 52 ms**, wybór nut po głośności, a pod koniec „perkusja" prowadzi utwór,
     w którym jest samo pianino.
4. **Linie (kolumny) prawie nie idą za wysokością dźwięku**: kierunek zgodny w 46–59% par nut, przeciwny w 36–41%.

## Co działa

- **Oryginalna MEGALOVANIA.** Normal gra 84% nut melodii z dekodera. Dla porównania: gdy tę samą melodię przesunę o dwa
  uderzenia, trafia w mapę tylko w 42%, więc to nie przypadek gęstej mapy. Słynny motyw (D D D5 A G# G F D F G) znajduję
  w 15 miejscach i na początku utworu mapa gra 7–8 z jego 10 nut.
- **Finale, pierwsze 24 s.** 79–93% momentów mapy leży na nucie melodii.
- **Tempo na korpusie.** Opis w części „Tempo".
- **Rush E, szybkie biegi.** Tam, gdzie pianino gra to samo E szesnastkami, Normal gra co drugą nutę (ósemki). To jest
  rozsądne uproszczenie dla tego poziomu.

## Jak mierzyłem

Dekoder (Basic Pitch) zapisuje dla utworu linię melodii. Dla każdej jej nuty sprawdzam, czy mapa gra moment, który
wtyczka usłyszała najwyżej 50 ms od niej. Sam wynik nic nie znaczy, bo mapy są gęste, więc przy każdym są dwie kontrole:
ta sama melodia przesunięta o dwa uderzenia (ten sam rytm, złe miejsce) oraz mapa wygenerowana bez pliku melodii.

| Utwór | Nuty melodii zagrane | Melodia przesunięta o 2 uderzenia | Mapa bez pliku melodii | Momenty mapy leżące na melodii |
|---|---|---|---|---|
| MEGALOVANIA (oryginał) | 84% | 42% | 59% | 60% |
| MEGALOVANIA (Camellia Remix) | 77% | 65% | 68% | 20% |
| Finale | 76% | 69% | 72% | 53% |
| Rush E | 46% (52% po poprawce przesunięcia) | 44% | 48% | 49% (53%) |

Na oryginale różnica między melodią a kontrolą to 42 punkty. Na trzech utworach, które Ci przeszkadzają, to 7–12
punktów. Mapa gra tam „coś w rytmie melodii", a nie melodię.

Uwaga do miary: linia z dekodera nie jest prawdą o melodii. W szybkich biegach Rush E dekoder zostawia w linii co drugą
nutę, więc „momenty mapy na melodii" są tam zaniżone. Dlatego przy remiksie i Rush E potrzebuję Twojego ucha (pytania
na końcu).

## Utwór po utworze

### MEGALOVANIA (Camellia Remix), 242 BPM

- Linia melodii z dekodera ma około 1,4 nuty na sekundę przez większość utworu. Mapa gra 6,0 momentu na sekundę
  (7,9 nuty z akordami). Melodii jest więc za mało, żeby wypełnić mapę, i 80% momentów leży poza nią.
- Wtyczka ma w swojej linii prowadzącej 140 nut na 380 s.
- W 82 z 94 fraz jako instrument prowadzący wybrana jest perkusja.
- Słynny motyw znajduję w wyjściu dekodera tylko w 4 miejscach (0:11, 3:57, 4:05, 4:33), a w linii, którą czyta
  Normal, jest połowa ich nut. Nie wiem jeszcze, w ilu miejscach motyw naprawdę gra w tym remiksie.
- Jedyny odcinek, gdzie melodia jest gęsta, to 3:40–4:20. Tam 41–67% momentów mapy leży na melodii.

Wniosek: tu nie pomoże żadna reguła wyboru nut. Najpierw trzeba usłyszeć melodię pod ścianą dźwięku.

### Finale, 190 BPM

- 0:00–0:24 (pianino): mapa trzyma się melodii, ale gra 14–22 z 26–31 nut melodii na każde 8 s. Budżet nut Normala jest
  tu niższy niż gęstość melodii. To samo wyszło w badaniu v29 i nadal jest prawdą.
- Od 1:04 do końca prowadzi perkusja i na melodii leży 29–52% momentów.
- Nuty melodii, których mapa nie gra (88 z 369): 34% przegrało z nutą o ćwierć uderzenia obok, 20% leży we frazie
  skopiowanej z wcześniejszej frazy, 19% nie zmieściło się w budżecie frazy, około 20% wycięły późniejsze etapy
  (przerzedzanie w spadkach energii, długie nuty, wyciszenie).

### Rush E, 162 BPM

- **Błąd przesunięcia.** Dekoder i wtyczka inaczej wyznaczają początek nuty, więc generator przesuwa melodię. Na Rush E
  przesuwa ją o +52 ms, a poprawne jest 0: bez przesunięcia 99% nut melodii ma dźwięk wtyczki w odległości do 25 ms,
  po przesunięciu 59%. Przy szesnastkach co 92 ms przesunięcie o 52 ms kładzie premię za melodię na sąsiednim polu
  siatki. Przyczyna: przesunięcie liczone jest jako mediana odległości do najbliższego dźwięku, a przy gęstych nutach
  „najbliższy" bywa raz wcześniejszy, raz późniejszy.
- Po poprawce mapa gra 52% nut melodii. Z reszty 62% przegrywa z głośniejszą nutą obok. Przykład z 0:40: bieg
  E5 C5 B4 A4 G#4 B4 A4 dostaje dwie nuty, a trzecią mapa stawia na samotnym dźwięku basu między nimi.
- Od 1:44 jako prowadząca wybierana jest „perkusja", choć w utworze jest samo pianino. Na melodii leży wtedy 29–42%
  momentów.
- W oknie 0:20–0:40 głośne dźwięki nie trzymają się naszej siatki lepiej niż losowo. Możliwa zmiana tempa, do
  sprawdzenia.

## Wspólne przyczyny

1. **Melodia jest tylko premią do oceny.** Moment dostaje +1,25 do oceny, jeśli leży na nucie melodii. O wyborze
   decydują głośność i pozycja w takcie. Ciche nuty melodii mają medianę oceny około −0,8, a grane nuty spoza melodii
   około +1,2, więc premia tego nie odwraca.
2. **Przesunięcie melodii bywa złe.** Na 15 z 69 utworów bota zastosowane przesunięcie trafia w dźwięki wtyczki o co
   najmniej 10 punktów gorzej niż najlepsze. Poprawka daje na nich 3–8 punktów więcej zagranych nut melodii
   (Bad Piggies 57→64%, Say My Name 51→59%). To mały zysk, ale prawie darmowy.
3. **Frazy kopiowane.** Fraza uznana za powtórkę bierze nuty z wcześniejszej frazy, nawet gdy melodia w niej jest inna.
   To 8–20% zgubionych nut.
4. **Etapy przerzedzania nie wiedzą o melodii.** Wycinają nuty melodii tak samo jak każde inne.
5. **Wybór instrumentu prowadzącego.** Perkusja wygrywa w gęstych utworach i wygrywa nawet tam, gdzie perkusji nie ma.
6. **Linie.** Kolumna następnej nuty idzie w stronę wysokości dźwięku niewiele częściej niż losowo. Tej miary nie
   porównałem jeszcze z mapami ludzi, więc nie wiem, ile wynosi u nich.

## Tempo

**Z mapami ludzi (80 utworów korpusu).** Końcowe BPM takie samo jak u ludzi: 79 z 80. Nuty ludzi w odległości do 15 ms
od naszej siatki ćwierć-uderzeń: mediana 99% (kontrola, nuty przesunięte o 1/8 uderzenia: 0%). Żaden utwór nie ma
siatki obróconej o pół uderzenia. Jedna porażka: „Preserved Valkyria" (220 BPM), gdzie wtyczka podała 217,7, a generator
nie dopasował siatki i spadł na 120.

Zastrzeżenie: to są utwory, na których siatka była strojona, i wszystkie mają stałe tempo. Wynik mówi „na muzyce
elektronicznej i studyjnej jest dobrze", nie „wszędzie jest dobrze".

**Utwory bota (80, bez map ludzi).** Tu mogę zmierzyć tylko, czy głośne dźwięki utworu trzymają się naszej siatki.
Skalę wziąłem z korpusu: najsłabszy poprawny utwór ma 17 punktów ponad przypadek.

- 5 utworów nie ma siatki wcale (mapa dostaje BPM 0): „Frozen" (parodia), „Pat & Mat (Sąsiedzi Hardcore Remix)",
  „Chainsaw Sound Effect" i dwa bez tytułu w historii.
- 7 z 75 ma siatkę słabszą niż jakikolwiek utwór korpusu: „Yellow Submarine" (Korwin), „Say My Name", „Carmen",
  „Alexander Hamilton", „Skarazula Marazula", „The Rebel Path" i jeden bez tytułu. To głównie nagrania z żywym
  graniem albo zmianami tempa.
- Trzy Twoje utwory: Finale i obie MEGALOVANIE są w normie. Rush E jest w normie jako całość, poza oknem 0:20–0:40.

Ta miara mówi, że siatka słabo pasuje. Nie mówi, czy winne jest BPM, zmiana tempa, czy luźne granie.

## Co z tego wynika dla planu

Kolejność etapów 1–2 (dekoder jako usługa, przyspieszenia bez zmiany nut) zostaje. Etap 3 „melodia" proponuję tak,
każda rzecz za wyłączoną flagą i do oceny uchem najwyżej po dwie naraz:

1. **Przesunięcie melodii**: wybierać to z dwóch przesunięć, które lepiej trafia w dźwięki wtyczki. Najtańsze.
2. **Sąsiad o ćwierć uderzenia**: gdy nuta melodii przegrywa z dźwiękiem na polu obok, a jest podobnie głośna, grać
   nutę melodii. To nie jest powrót do „dekoder wybiera nuty", który przegrał u Ciebie na słuch 5 listopada:
   budżet i głośne, pełne nuty zostają.
3. **Kopiowanie fraz** tylko wtedy, gdy melodia obu fraz się zgadza.
4. **Przerzedzanie oszczędza nuty melodii**, gdy ma do wyboru inną nutę.
5. **Instrument prowadzący**: perkusja nie prowadzi, gdy w utworze jej nie ma, i nie prowadzi tam, gdzie melodia jest
   pewna.
6. **Remix Camellii** to osobna praca nad wykrywaniem. Zacznę ją dopiero, gdy będę wiedział, gdzie motyw naprawdę gra.

Tempo: utwory bez siatki i ze słabą siatką to osobny, późniejszy temat (śledzenie tempa lokalnie). Na razie
wystarczy, że są policzone.

## Czego nie sprawdziłem

- Nie słuchałem audio. Wszystko powyżej porównuje dekoder, wtyczkę i mapę między sobą.
- Easy, Hard i Hell. Hard i Hell budują się na Normalu, więc dziedziczą jego wybór nut.
- 20 utworów testowych korpusu (są tylko w woluminie Dockera).
- Pomiarów na Pi. Czekają na klucz.

Skrypty pomiarowe leżą poza repo, w katalogu roboczym sesji (`stage0`: `why.js`, `timeline.js`, `riff.js`,
`shiftall.js`, `tempo.js`, `bottempo.js`).
