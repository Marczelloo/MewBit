# Poziomy gry a star rating osu!mania 4K

**Stan: zakresy NIEUSTALONE.** Wymagają danych z osu! API (rozkład SR wszystkich Ranked dyfficulty 4K), a dostępu do API
w tej sesji nie było (zob. `../README.md`). Plik `levels.json`, którego używa selekcja korpusu, powstanie dopiero po kroku 2.
Poniżej metoda ustalona przed zobaczeniem danych, żeby wynik nie był dopasowany pod tezę.

## Hipoteza wyjściowa

Podział AIMod z wiki osu! (`Beatmap/Star_rating`), wspólny dla wszystkich trybów, w tym mania:
Easy 0,0–1,99★, Normal 2,0–2,69★, Hard 2,7–3,99★. Insane i wyżej (≥ 4,0★) poza analizą.
Zakresy są rozłączne i domknięte z lewej: [0; 2,0), [2,0; 2,7), [2,7; 4,0).

## Sprawdzenie na danych (`pipeline/corpus/derive_levels.py`)

Na wszystkich Ranked dyfficulty 4K z migawki API:

1. Kwantyle SR dla klas nazw (Easy/EZ/Beginner, Normal/NM, Hard/HD, Insane/MX, Expert/SHD/SC). Nazwy są tylko słabym sygnałem,
   gdzie mapperzy sami stawiają granice. Nie służą do przypisania poziomu.
2. Punkt cięcia SR najlepiej rozdzielający sąsiednie klasy nazw (indeks Youdena) dla Easy|Normal, Normal|Hard, Hard|Insane.
3. Pokrycie: ile zestawów ma dyfficulty w każdym zakresie i w trzech naraz, dla wariantu AIMod i wariantu Youdena.
4. Gęstość (nuty/s czasu gry) w pasmach SR co 0,5★, żeby było widać, co zakres znaczy dla gracza tej gry.

## Reguła decyzji (ustalona z góry)

- Zostaje wariant AIMod, chyba że punkt cięcia z danych różni się od niego o więcej niż 0,3★ przy którejś granicy.
  Wtedy ta granica przyjmuje wartość z danych. Każda zmiana jest wypisana tutaj z liczbami.
- Gdy dla Easy w całej populacji nie ma ≥ 60 zestawów, kwota zostaje (selekcja sięga po mniej popularne zestawy),
  a brak jest odnotowany jako odstępstwo. Zakresu nie przesuwam po to, żeby spełnić kwotę.
- Dyfficulty poza trzema zakresami są pomijane.

## Jedna dyfficulty na zestaw i poziom

Gdy zestaw ma kilka dyfficulty w jednym zakresie, biorę tę o SR najbliższym medianie SR wszystkich dyfficulty tego zakresu
w populacji („typowa” dyfficulty poziomu). Przy remisie wygrywa dyfficulty hosta zestawu, potem niższe `beatmap_id`.
Tylko dyfficulty 4K, Ranked, o hit length ≥ 30 s (`select_corpus.py` → `choose_diff`).

## Czy SR przenosi się na tę grę

Co się przenosi:
- ta sama mechanika 4 torów, tapy i holdy;
- podobne okna czasowe (PERFECT 40 ms ≈ 300 przy OD ok. 8);
- brak dodatkowych osi trudności osu!, których gra nie ma (celowanie, czytanie zbliżania).

Co może zniekształcić porównanie (do pilnowania przy wnioskach):
1. SR osu!mania liczy obciążenie palców i rąk z gęstości i układu nut. Nie widzi czytelności ani tego, czy nuty pasują do muzyki.
   Mapa o „właściwym” SR może być nienaturalna.
2. Gra ma stałą prędkość spadania i nie ma slider velocity. Mapy z gimmickami SV mogą mieć SR zaniżony względem odczucia.
   W korpusie nie ma to wpływu na metryki, bo SV pomijam.
3. Docelowy gracz Easy w tej grze to nowicjusz z Discorda, nie gracz osu!. Easy z osu! może być dla niego wciąż trudny.
   Tego nie rozstrzygną dane, tylko test z graczem (`../REPORT.md`, część 7).
4. Gwiazdki pokazywane w grze (`stars.js`: 0,5 + 0,48 × szczytowe nuty/s + akordy + holdy) to inna skala niż SR osu!.
   Nie porównuję ich wprost.
