# Korpus: kryteria i wynik selekcji

Wygenerowane przez `pipeline/corpus/select_corpus.py` z migawki API 2026-11-03T01:20:27.644958+00:00 (wyszukiwanie: `{'m': 3, 's': 'ranked', 'q': 'keys=4', 'sort': 'ranked_asc'}`). Uruchomienie ponowne na tych samych plikach daje ten sam wynik.

## Wzór

`score = 0.4·pct(log(1+plays)) + 0.25·pct(log(1+favourites)) + 0.35·pct(rating_bayes)`

- `pct` = percentyl (mid-rank) w grupie (gatunek, okres 3-letni wg daty rankingu); grupa < 15 zestawów → percentyl w samym okresie.
- `rating_bayes = (średnia·głosy + 9.008·10) / (głosy + 10)` (średnia globalna kandydatów).
- Gatunek: z API; dla `unspecified`/`other` uzupełniony z tagów/źródła/tytułu (kolumna `genre_source` = `tags`), inaczej `unknown`.

## Poziomy

Zakresy SR (`shared/levels.json`): {"easy": [0.0, 1.65], "normal": [1.65, 2.7], "hard": [2.7, 3.4]}; typowy SR (mediana w zakresie): {"easy": 1.4, "normal": 2.15, "hard": 3.05}. Na poziom jedna dyfficulty: najbliższa typowemu SR, remis → dyfficulty hosta → niższe id; tylko dyfficulty 4K Ranked o hit length ≥ 30 s.

## Kwoty

- 100 zestawów, każdy inna piosenka (`song_key`: wykonawca + tytuł bez dopisków wersji typu „TV Size”, „Cut Ver.”); pierwszeństwo: liczba poziomów (3 > 2 > 1), potem score.
- ≥ 60 zestawów na poziom; ≤ 25 na gatunek; ≥ 6 gatunków; ≤ 3 zestawy na mappera (host zestawu i właściciele wybranych dyfficulty liczą się razem);
  ≤ 35 na okres 3-letni; przedział BPM (granice (120, 150, 180, 210)) między 0.8× a 1.25× swojego udziału wśród pełnych zestawów populacji, maks. 40: (min, maks.) = {"0-120": [4, 8], "120-150": [15, 24], "150-180": [27, 40], "180-210": [26, 40], ">=210": [5, 10]}.
- Podział: 20 test / 80 trening, po składowych grafu mapperów (żaden mapper w obu częściach), proporcjonalnie do gatunków, zestawy pełne najpierw.

## Wynik

- Zestawy: 100; z kompletem poziomów: 93; test: 20 (pełnych: 20).
- Na poziom: {'easy': 99, 'normal': 98, 'hard': 95}; w teście: {'easy': 20, 'normal': 20, 'hard': 20}.
- Gatunki: {'anime': 25, 'electronic': 25, 'video game': 21, 'pop': 18, 'rock': 3, 'novelty': 2, 'classical': 1, 'folk': 1, 'hip hop': 1, 'jazz': 1, 'metal': 1, 'other': 1}; źródło gatunku: {'api': 100}.
- Gatunki w teście: {'electronic': 6, 'anime': 5, 'pop': 4, 'video game': 4, 'novelty': 1}.
- Okresy: {'2022-2024': 35, '2025-2027': 31, '2019-2021': 16, '2016-2018': 11, '2013-2015': 7}; BPM: {'180-210': 37, '150-180': 34, '120-150': 15, '>=210': 10, '0-120': 4}.
- Mapperzy z największą liczbą zestawów: [(3734394, 3), (2596306, 3), (4632359, 3), (7707789, 3), (3484485, 3)].
- Grupy normalizacji z fallbackiem do okresu: 5 zestawów.

## Odstępstwa od kwot

- brak

## Wykluczone zestawy

- [1746870]: żadna kopia z mirrorów nie zgadzała się z sumami MD5 oficjalnego API (osu.direct: inna wersja dyfficulty, nerinyan: brak, catboy: odmowa dostępu).

## Zmiany kryterium BPM w trakcie selekcji

- Przebieg 1: tylko limit 40 na przedział BPM → < 150 BPM: 10 utworów (populacja pełnych zestawów: 25%), ≥ 210 BPM: 21 (populacja: 7%).
- Przebieg 2: przedział BPM 0,5×–1,5× udziału w populacji → < 150 BPM: 12 utworów, ≥ 210 BPM: 11.
- Przebieg 3 (obowiązujący): 0,8×–1,25× udziału w populacji, bo gra gra głównie utwory < 150 BPM, a 12 utworów to za mała grupa do wniosków.
