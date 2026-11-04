# Rejestr użyć 20 utworów testowych

Zestaw: `split = test` w `shared/corpus.csv` (lista w `HANDOFF.md`, część 4). Strojenie generatora odbywa się tylko na 80 utworach `train`.

Użycie liczymy, gdy charty generatora albo wyniki na tych utworach trafiają przed oczy osoby lub modelu podejmującego decyzje o generatorze. Metryki człowieka z tych utworów wchodzą też do IQR panelu (definicja z `synthesis/level_distance.py`) i nie liczymy tego jako użycia, bo nie zależą od generatora.

Żeby strojenie nie dotykało testu przez przypadek, `run_pipeline.py --algo-splits train` w ogóle nie generuje chartów testowych.

## Stan testu przed tą pracą

Test **nie jest dziewiczy**. Analiza (etapy 1–3) oglądała na nim generator v19:

- wszystkie porównania generator–człowiek w `REPORT.md` i raportach poziomów;
- `synthesis/ablation.py`: z tego eksperymentu pochodzą wartości parametrów z planu (C1: `maxNps` 6,5, sufit 7,5 itd.), więc są hipotezami do sprawdzenia na treningu, a nie wynikami;
- fragmenty do gry w części 7 raportu, wszystkie z utworów testowych.

Wyniki kontrolne na teście mogą więc wypadać nieco lepiej niż na utworach, których nikt nie widział.

## Użycia w tej pracy

| Nr | Data | Etap | Generator | Co zrobiono | Czy wpłynęło na decyzje o generatorze |
|---|---|---|---|---|---|
| 1 | 2026-11-03 | 0 | v19 | Odtworzenie linii bazowej (`compare_baseline.py --split test`): 120/120 chartów identycznych; różni się tylko `alignment.no_sound_share`, bo przebieg jest bez stemów | Nie, tylko kontrola środowiska |
| 2 | 2026-11-03 | 0 | v19 | Te same charty: sprawdzenie poprawionego `compare_baseline.py` (obejrzany tylko wynik: zgodność, 0 różnic) i zapis tabeli bez stemów do `synthesis/out/baseline_v19/test/` (nie oglądana) | Nie, tylko narzędzia i punkt odniesienia |
| 3 | 2026-11-03 | 1 | v20 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu etapu |
| 4 | 2026-11-03 | Korekta Hard po etapie 1 | v21 | Kontrola po korekcie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v19 i v20, obejrzane tylko jako podsumowania, bez listy utworów. Wcześniejsze uruchomienie przerwano bez wyniku i bez oglądania, gdy trzeba było sprawdzić na treningu jeden utwór | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 5 | 2026-11-03 | 2 | v22 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v21 i v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 6 | 2026-11-03 | 3 | v23 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v22 i v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 7 | 2026-11-03 | 4 | v24 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v23 i v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 8 | 2026-11-03 | 5 | v25 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v24 i v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 9 | 2026-11-04 | 6 | v26 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v25 i v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 10 | 2026-11-04 | rytm, gęstość, holdy | v29 | Kontrola po etapie: metryki poziomów, siatka, zagnieżdżenie i odporność wobec v26 i v19, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
