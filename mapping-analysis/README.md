# mapping-analysis: jak ludzie mapują w osu!mania 4K i co z tego wynika dla generatora mewbeat

Zadanie: raport `REPORT.md`, czyli przyczyny nienaturalności map algorytmu, osobno dla Easy, Normal i Hard,
oraz sprawdzenie hipotezy „Hard wypada lepiej niż Normal”. Kod algorytmu (`helpers/mewbeat/charts/`) nie jest tu zmieniany.

## Stan na 2026-11-03

**Etapy 1–3 są gotowe; raport końcowy: `REPORT.md`.** Raporty poziomów: `levels/<poziom>/REPORT.md`, analizy między poziomami: `synthesis/`.

Etap 1: Wyniki: `shared/`, czyli korpus, poziomy, metryki per poziom w `shared/data/<poziom>/`,
dane utworów w `shared/data/songs/`, charty wszystkich poziomów dla etapu 3 w `shared/cross/` oraz `shared/alignment.md`.
- **osu! API.** Migawka 6103 zestawów Ranked 4K w cache `data/corpus/`. Zakresy SR: `shared/levels.md`. Korpus: `shared/corpus.csv`.
- **Pliki `.osz`.** Za zgodą użytkownika z mirrora osu.direct (`pipeline/corpus/download_mirror.py`). Każdy plik ma
  zweryfikowane MD5 wybranych dyfficulty względem oficjalnego API. osu! wydaje pliki tylko zalogowanej przeglądarce;
  logowanie skryptem blokuje pusty token CSRF i tego nie obchodzę.
- **Oś czasu.** Oś osu! wyprzedza zdekodowane audio o 19–54 ms (mediana 36). Mapy ludzi są przesuwane na oś audio
  (`shared/metrics.md`, „Oś czasu”). Zgodność z pluginem: mediana 3 ms; dryf w utworze: p90 5 ms.
- **Pozostałe dane.** Stemy Spleeter 4stems dla 100 utworów. Charty algorytmu (generator v19) dla 20 utworów testowych × 3 poziomy.
- Tabele slotów (`shared/data/<poziom>/slots/`, ok. 140 MB) są poza gitem. Odtwarza je `run_pipeline.py`.

Gotowe wcześniej (2026-11-02): `shared/algorithm.md`, `shared/metrics.md`, kalibracja detektorów `shared/onset_bias.json`,
pipeline sprawdzony testem dymnym na danych syntetycznych.

## Jak odtworzyć (kolejność kroków)

Środowisko:

```bash
python3 -m venv .venv && .venv/bin/pip install -r mapping-analysis/requirements.txt
```

Stemy (opcjonalnie, osobne środowisko, zob. `requirements-stems.txt`):

```bash
uv python install 3.10 && uv venv -p 3.10 .stemvenv && VIRTUAL_ENV=.stemvenv uv pip install -r mapping-analysis/requirements-stems.txt
```

1. Kandydaci z API (ok. 1 zapytanie/s, cache w `data/corpus/api-cache`, można przerwać i wznowić):

   ```bash
   .venv/bin/python -I mapping-analysis/pipeline/corpus/fetch_candidates.py --out mapping-analysis/data/corpus
   ```

2. Dowody dla zakresów SR. Potem decyzja według reguły z `shared/levels.md`, zapisana w `shared/levels.md` i `shared/levels.json`
   (`{"ranges": {"easy": [0, 2.0], …}}`):

   ```bash
   .venv/bin/python -I mapping-analysis/pipeline/corpus/derive_levels.py --candidates mapping-analysis/data/corpus/candidates.json --out mapping-analysis/data/corpus/levels_evidence.json
   ```

3. Selekcja korpusu. Tworzy `shared/corpus.csv`, `shared/corpus_selection.md` i `shared/download-list.md`:

   ```bash
   .venv/bin/python -I mapping-analysis/pipeline/corpus/select_corpus.py --candidates mapping-analysis/data/corpus/candidates.json --levels mapping-analysis/shared/levels.json --snapshot mapping-analysis/data/corpus/snapshot.json --out mapping-analysis/shared
   ```

4. Pobranie `.osz`: ręcznie z `download-list.md` albo (za zgodą na mirror) z weryfikacją MD5 względem API:

   ```bash
   python3 -I mapping-analysis/pipeline/corpus/download_mirror.py --mirror osudirect --corpus mapping-analysis/shared/corpus.csv --cache mapping-analysis/data/corpus/api-cache --out mapping-analysis/data/osz
   ```
5. Pipeline: cechy pluginu, cechy librosa, stemy, charty algorytmu dla testu i metryki per poziom.
   Bez `--stems-*` stemy są pomijane:

   ```bash
   .venv/bin/python -I mapping-analysis/pipeline/run_pipeline.py --maps <folder z .osz> --jobs 3 --stems-python .stemvenv/bin/python --stems-models <folder z 4stems/>
   ```

6. Tabele per poziom i kontrola dopasowania nut do audio:

   ```bash
   .venv/bin/python -I mapping-analysis/pipeline/aggregate.py
   ```

   ```bash
   .venv/bin/python -I mapping-analysis/pipeline/alignment_report.py
   ```

7. Opcjonalnie: kopie stron wiki osu!, na które powołują się raporty (do `data/references/`):

   ```bash
   python3 -I mapping-analysis/pipeline/fetch_references.py
   ```

Kalibrację detektorów powtarza się tak:

```bash
.venv/bin/python -I mapping-analysis/pipeline/audio/calibrate_onsets.py --build mapping-analysis/data/dspbuild --work /tmp/calib --out mapping-analysis/shared/onset_bias.json
```

Ze stemami: najpierw `--write-wav-only`, potem `stems.py` na `calibration.wav`, potem znowu z `--stems-npz`.

Testy pipeline'u bez prawdziwych danych:
- `pipeline/tests/test_select_synthetic.py`: niezmienniki selekcji (kwoty, limity, rozłączność mapperów, determinizm);
- `pipeline/tests/make_smoke_osz.py`: syntetyczny zestaw dla `run_pipeline.py`.

## Układ

```
pipeline/audio/      FeatureDump.java (DSP pluginu offline), extract_features.py, librosa_features.py, stems.py, calibrate_onsets.py
pipeline/osu/        osu_format.py: bezpieczne czytanie .osz, parser .osu (mania), siatka z timing pointów
pipeline/algo/       generate_charts.js (niezmieniony generateChart), dump_analysis.js (siatka, frazy, liderzy algorytmu)
pipeline/metrics/    chart_metrics.py (bez audio), audio_metrics.py (z audio)
pipeline/corpus/     osu_api.py, fetch_candidates.py, derive_levels.py, select_corpus.py
shared/              algorithm.md, metrics.md, levels.md, onset_bias.json; po przebiegu: corpus.csv, data/<poziom>/…, data/songs/, cross/
levels/<poziom>/     REPORT.md każdego poziomu (etap 2)
data/                (git-ignorowane) audio, .osz, cechy, cache API, kopie wiki
```
