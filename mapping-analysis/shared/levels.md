# Poziomy gry a star rating osu!mania 4K

**Stan: zakresy USTALONE 2026-11-02** (`levels.json`), według reguły zapisanej niżej przed zobaczeniem danych.

| Poziom gry | Zakres SR | Uzasadnienie |
|---|---|---|
| Easy | [0; 1,65) | granica z danych (1,65 vs AIMod 2,0: różnica 0,35★ > 0,3★) |
| Normal | [1,65; 2,7) | dolna z danych, górna AIMod (dane: 2,45, różnica 0,25★ ≤ 0,3★) |
| Hard | [2,7; 3,4) | górna z danych (3,4 vs AIMod 4,0: różnica 0,6★). Przy 4,0 Hard objąłby większość dyfficulty nazwanych Insane (mediana 3,86★) |

Dyfficulty ≥ 3,4★ (Insane i wyżej) są poza analizą.

### Dowody (migawka API 2026-11-02, 6103 zestawy Ranked z 4K, 19 052 dyfficulty 4K)

SR według klas nazw (13 088 dyfficulty z jednoznaczną nazwą; 5964 bez niej):

| Klasa nazwy | n | p5 | p25 | p50 | p75 | p95 |
|---|---|---|---|---|---|---|
| Easy | 2824 | 0,96 | 1,27 | 1,42 | 1,54 | 2,01 |
| Normal | 3880 | 1,54 | 1,85 | 2,08 | 2,28 | 2,95 |
| Hard | 3580 | 2,16 | 2,64 | 2,91 | 3,15 | 3,47 |
| Insane | 2049 | 3,04 | 3,52 | 3,86 | 4,17 | 4,69 |
| Expert | 755 | 3,28 | 4,07 | 4,54 | 4,99 | 5,66 |

Punkty cięcia Youdena: Easy|Normal 1,65; Normal|Hard 2,45; Hard|Insane 3,4.

Co oznaczają ostateczne zakresy (wszystkie dyfficulty 4K w zakresie; gęstość = (nuty + holdy) / hit length):

| Poziom | dyfficulty | mediana SR | nuty/s p10 / p50 / p90 | udział holdów p50 / p90 | nazwy w zakresie |
|---|---|---|---|---|---|
| Easy | 3096 | 1,40 | 2,2 / 3,3 / 4,2 | 0,16 / 0,36 | Easy 2463, Normal 386, niejasne 227, Hard 19 |
| Normal | 5217 | 2,15 | 4,5 / 6,0 / 7,7 | 0,15 / 0,39 | Normal 3197, Hard 1051, niejasne 575, Easy 359 |
| Hard | 3623 | 3,05 | 7,4 / 8,9 / 10,4 | 0,15 / 0,42 | Hard 2235, niejasne 772, Insane 324, Normal 246 |

Pokrycie: zestawów z dyfficulty w zakresie Easy 2637, Normal 3793, Hard 3342; ze wszystkimi trzema 1961.
Kwota ≥ 60 na poziom jest osiągalna z dużym zapasem.

Nazwy dyfficulty potwierdzają, że nie można na nich polegać. W zakresie Normal jest 1051 dyfficulty nazwanych Hard,
a w zakresie Hard 324 nazwane Insane.

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
