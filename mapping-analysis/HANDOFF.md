# Przekazanie do sesji lokalnej

Stan na 2026-11-03, gałąź `feat/mewbeat`. Generator **niezmieniony**: v19 (`GENERATOR_VERSION = 19`). `helpers/mewbeat/charts/`,
DSP pluginu i `activity/src/mewbeat/highway.js` nie zmieniły się od commita `de7bc96`, na którym liczono wyniki.

## 1. Stan prac

- **Etapy 1–3 są zakończone.**
  - Wynik: `REPORT.md`.
  - Plan zmian: `REPORT.md` część 6 („Plan zmian”, z miarami sukcesu i oceną architektury). Audyt kodu z plikami i liniami: część 5. Fragmenty do gry: część 7.
  - Raporty poziomów: `levels/<poziom>/REPORT.md`. Definicje metryk: `shared/metrics.md` (wersja v2).
- **Nic z planu nie jest wdrożone.** Następny krok to krok 1 planu: parametry Normal i Easy, holdy, akcenty na startach sekcji.

### Errata do `REPORT.md` (wykryta przy przekazaniu, w raporcie jeszcze niepoprawiona)

**Przyczyna.** `pipeline/metrics/chart_metrics.py` zapisuje w `gap_share` tylko klasy odstępów, które w charcie występują. Gdy klasy brak, kolumna w `*_metrics.csv` jest pusta (NaN), a mediany w pandas pomijają takie wiersze. Klasa nieobecna powinna liczyć się jako 0.

**Co się zmienia** (poprawione wartości, test 20 utworów):

| Miejsce w `REPORT.md` | Jest | Powinno być |
|---|---|---|
| 3.1, odstępy 1/2, generator Easy p10 / p50 / p90 | 0,09 / 0,10 / 0,17 | 0,00 / 0,00 / 0,09 |
| 3.1, odstępy 1/2, ludzie Easy p10 | 0,14 | 0,04 |
| 4.1, odstępy 1/2, stosunek Easy | 0,28 | 0,00 |
| 4.1, mediana odległości Easy od ludzi | 1,31 | 1,26 |
| 4.1, „Normal istotnie bliżej ludzi niż Easy (13/20, p = 0,017); najsłabszy jest Easy” | jak obok | 11/20, p = 0,105, różnica **nieistotna** na pełnym panelu; Easy jest najsłabszy w gęstości, pokryciu beatów i 1/2 |

**Czego to nie zmienia.**
- Hard vs Normal bez zmian: 11/20, p = 0,67. Wartości 1/2 Normal i Hard nie mają pustych wierszy.
- Część 1 raportu podaje Easy 1/2 poprawnie (0,00).
- Raport Easy liczył 1/2 poprawnie. Inne użycia `gap_share.*` z pustymi wierszami (u ludzi klasy `2`, `other`, `1/4`) mogą lekko zawyżać mediany.

**Naprawa.** W `chart_metrics.py` emitować wszystkie klasy z `GAP_CLASSES` z zerami (tak jak `snap_share`), potem `aggregate.py` i skrypty `synthesis/`. Do tego czasu przy analizie robić `fillna(0)` na kolumnach `gap_share.*`.

## 2. Dane poza gitem

| Co | Ścieżka | Do czego | Jak odtworzyć |
|---|---|---|---|
| 100 plików `.osz` korpusu | `data/osz/<set>.osz` | wszystko: mapy ludzi i audio | `download_mirror.py` (krok 4 niżej); weryfikacja MD5 z `shared/corpus_checksums.json` |
| audio, cechy pluginu, cechy librosa, analiza i charty generatora | `data/audio`, `data/features`, `data/librosa`, `data/algo_analysis`, `data/algo_charts` | metryki generatora i porównanie z ludźmi | `run_pipeline.py` z `.osz` (krok 5); DSP kompiluje się sam przez `javac` |
| stemy Spleeter | `data/stems` | tylko kolumny `stem_*` | opcjonalnie, osobne środowisko (`requirements-stems.txt`, Python 3.10, wagi `4stems` z GitHub Releases Spleetera) |
| tabele slotów | `shared/data/<poziom>/slots/` | regresje wyboru dźwięków w raportach poziomów | `run_pipeline.py` |
| migawka osu! API (cache, `listing.json`, `candidates.json`) | `data/corpus/` | **tylko** ponowny dobór korpusu, a nie metryki | `fetch_candidates.py` z kluczami API (ok. 1 h 45 min) |
| kopie wiki osu! | `data/references/` | cytaty z Ranking Criteria w raportach poziomów | `pipeline/fetch_references.py` |

## 3. Odtworzenie na Windowsie

**Uwaga: `pipeline/run_pipeline.py` importuje `fcntl`** (blokada przy stemach), którego nie ma na Windowsie, więc natywnie się nie uruchomi. Do czasu poprawki używaj WSL2. Repozytorium klonuj do katalogu WSL, nie pod `/mnt/c` (szybkość I/O).

Jednorazowo, w PowerShellu:

```bash
wsl --install -d Ubuntu-24.04
```

W WSL (Ubuntu); potrzebny jest też Node ≥ 20, np. z nvm:

```bash
sudo apt update && sudo apt install -y openjdk-21-jdk-headless ffmpeg python3-venv git
```

```bash
git clone https://github.com/Marczelloo/MewBit.git && cd MewBit && git checkout feat/mewbeat
```

```bash
python3 -m venv .venv && .venv/bin/pip install -r mapping-analysis/requirements.txt
```

Krok 4. Minimalny cache sum kontrolnych (zamiast migawki API) i pobranie `.osz` z weryfikacją; zgoda na mirror osu.direct została udzielona w tej sesji:

```bash
.venv/bin/python -I -c "import json,hashlib,pathlib; c=json.load(open('mapping-analysis/shared/corpus_checksums.json')); d=pathlib.Path('mapping-analysis/data/corpus/api-cache'); d.mkdir(parents=True,exist_ok=True); [(d/(hashlib.sha1(f'/beatmapsets/{s}?'.encode()).hexdigest()+'.json')).write_text(json.dumps({'beatmaps':[{'id':int(b),'checksum':m} for b,m in v.items()]})) for s,v in c['sets'].items()]"
```

```bash
.venv/bin/python -I mapping-analysis/pipeline/corpus/download_mirror.py --mirror osudirect --corpus mapping-analysis/shared/corpus.csv --cache mapping-analysis/data/corpus/api-cache --out mapping-analysis/data/osz
```

Krok 5. Pipeline do katalogu roboczego, żeby nie nadpisać zacommitowanej linii bazowej; bez stemów:

```bash
.venv/bin/python -I mapping-analysis/pipeline/run_pipeline.py --maps mapping-analysis/data/osz --jobs 4 --shared mapping-analysis/data/stage1
```

```bash
.venv/bin/python -I mapping-analysis/pipeline/aggregate.py --shared mapping-analysis/data/stage1 --corpus mapping-analysis/shared/corpus.csv && .venv/bin/python -I mapping-analysis/pipeline/split_notes.py --shared mapping-analysis/data/stage1
```

Całość zajmuje ok. 1 h na 4 rdzeniach; najdłużej liczą się cechy librosa.

## 4. Strojenie i test

- **Strojenie: 80 utworów z `split = train`** w `shared/corpus.csv`.
- **Test: 20 utworów z `split = test`, tylko do oceny końcowej:**
  310607, 363594, 563569, 636959, 808872, 859248, 923488, 1000722, 1277503, 1329723, 1570640, 1697477, 1773164,
  1784295, 1894317, 2200258, 2224035, 2270163, 2314654, 2515207.
  - Wszystkie mają komplet poziomów; mapperzy testu nie występują w treningu.
- **Luka do zamknięcia na początku.** `run_pipeline.py` generuje charty generatora tylko dla `split = test` (linia z `test = row.get("split") == "test"`). Do strojenia na treningu trzeba generować charty także dla `train`, np. tym samym `pipeline/algo/generate_charts.js`.

## 5. Linia bazowa v19

Mediany na 20 utworach testowych, mapy ludzi tego samego utworu i poziomu. Źródło: `shared/data/<poziom>/{human,algo}_metrics.csv` (puste `gap_share.*` liczone jako 0) i `synthesis/out/level_distance_summary.json`.

| Metryka | Easy ludzie | Easy v19 | Normal ludzie | Normal v19 | Hard ludzie | Hard v19 |
|---|---|---|---|---|---|---|
| nuty/s | 3,64 | 1,87 | 6,00 | 3,70 | 9,11 | 7,04 |
| beaty z nutą (`coverage.beat`) | 0,86 | 0,36 | 0,92 | 0,63 | 0,95 | 0,62 |
| półbeaty z nutą | 0,19 | 0,05 | 0,58 | 0,23 | 0,82 | 0,53 |
| odstępy 1/2 | 0,28 | 0,00 | 0,64 | 0,25 | 0,64 | 0,34 |
| najdłuższa seria 1/2 | 5 | 0 | 31 | 4 | 36 | 10 |
| akordy | 0,16 | 0,07 | 0,32 | 0,14 | 0,50 | 0,11 |
| hold kończy się na następnej nucie | 0,99 | 0,35 | 0,97 | 0,10 | 0,97 | 0,23 |
| hold z nutą w środku | 0,00 | 0,73 | 0,13 | 0,90 | 0,19 | 0,96 |
| rytm w powtórzeniach muzyki | 0,90 | 0,31 | 0,91 | 0,41 | 0,94 | 0,44 |
| nuta na granicy sekcji | 1,00 | 0,41 | 1,00 | 0,78 | 1,00 | 0,83 |
| precision / recall względem człowieka | – | 0,84 / 0,43 | – | 0,85 / 0,58 | – | 0,71 / 0,74 |
| odległość od ludzi (panel 18 metryk, w IQR ludzi) | – | 1,26 | – | 1,18 | – | 1,13 |

**Polecenie, które powtórzy tabelę** (po kroku 5):

```bash
.venv/bin/python -I mapping-analysis/synthesis/level_distance.py --shared mapping-analysis/data/stage1 --out mapping-analysis/data/stage1/synthesis
```

Wynik porównuj z `synthesis/out/level_distance_summary.json` (Easy tam jeszcze 1,31, zob. erratę).

**Odtworzenie bit po bicie.** Generator jest deterministyczny. Kolumna `n_notes` w lokalnym `algo_metrics.csv` powinna być identyczna z zacommitowaną; inaczej różnią się cechy DSP, czyli dekodowanie audio albo JDK.

**Dopuszczalny dryf.** Metryki audio (onsety, przesunięcie osi) mogą się różnić o kilka ms przy innych wersjach ffmpeg i librosa. Oczekuj zgodności panelu w ±0,05 IQR i precision/recall w ±0,02.

**Pozostałe analizy etapu 3:** `synthesis/cross_levels.py`, `robustness.py` i `ablation.py` przyjmują `--shared mapping-analysis/data/stage1` i `--work mapping-analysis/data`.

## 6. Ryzyka i rzeczy niesprawdzone

**Błędy znane:**
1. Errata `gap_share` (część 1).
2. `fcntl` w `run_pipeline.py` blokuje Windows natywnie.

**Niesprawdzone:**
3. Żadnego chartu nie sprawdzono w grze. Fragmenty do gry są w `REPORT.md`, część 7; liczby nie mówią, czy chart jest przyjemny.
4. Eksperyment `synthesis/ablation.py` zmieniał tylko parametry poziomów. Zmiany we wspólnych funkcjach (siatka, holdy, wybór momentów) nie były testowane.
5. Klasyfikację perkusji pluginu oceniono tylko na sygnale syntetycznym.
6. Nie wiadomo, czy „hold do następnej nuty” w tej samej ręce jest grywalny w tej grze (okno puszczenia ×1,5 zostaje). Grywalności nie sprawdzono.

**Ograniczenia danych:**
7. Charty generatora powstały z audio z `.osz`, a w grze bot gra inny upload; analiza tempa może wyjść inaczej.
8. Korpus to popularne osu!mania: szybkie, japońskie i elektroniczne, z lat 2022–26. Tylko 4 gatunki nadają się do porównań. Docelowy gracz Easy z Discorda może potrzebować mniejszej gęstości niż gracz osu!.
9. Przesunięcie osi czasu jest dopasowane na nutach ludzi (jeden parametr na utwór). 5 utworów oznaczonych w `shared/alignment.md`.
10. Próg powtórzeń muzyki (0,75) skalibrowano na mapach ludzi.
11. Zestaw 1746870 wykluczony (brak zgodnej kopii); poziom `hell` nieanalizowany.

**Uwagi praktyczne:**
12. Jar pluginu zacommitowany w `helpers/lavalink/plugins/` ma tylko cechy v1, więc bot uzna utwory za „uncharted”. Do testów w grze przebuduj go (`scripts/build-mewbeat-plugin.mjs`).
13. W raportach poziomów zostały 3 niespełnione prośby o metryki na poziom (część 8 każdego raportu). Najważniejsza: rytm na siatce binarnej w ±25 ms; jest częściowo zastąpiona przez `synthesis/robustness.py`.
14. Klucz OAuth osu! i hasło konta pojawiły się w czacie tej sesji. Nie ma ich w żadnym pliku ani w gicie, ale trzeba je zmienić.
