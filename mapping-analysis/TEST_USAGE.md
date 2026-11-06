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
| 11 | 2026-11-05 | siatka: dopasowanie stałego tempa | v30 | Kontrola po etapie: beaty na czerwonych liniach ludzi, nuty na beacie, równe odstępy, różne rytmy na 100 taktów, holdy i akordy wobec v29, oraz hash nut przy wyłączonym dopasowaniu, obejrzane tylko jako podsumowania, bez listy utworów. `cross_levels`, `grid_quality`, `level_distance` i `robustness` tym razem nie liczone | Nie, kod zamrożony przed kontrolą; rozjazdy trafiły do raportu |
| 12 | 2026-11-05 | etapy 1-8 z flagami | v31 | Kontrola po etapach: metryki poziomów wobec v30, bez flag, z każdą z czterech flag osobno i ze wszystkimi naraz, miary figur dla `transitions` i dla wszystkich flag, oraz ile razy odpala reguła obrotu siatki o pół beatu i czy nuty ludzi leżą z nią lepiej, obejrzane tylko jako podsumowania, bez listy utworów. Sprawdzenie reguły trzeba było policzyć drugi raz, bo za pierwszym razem skrypt nie czytał map ludzi z utworów testowych | Tak, jedna decyzja: reguła obrotu odpaliła na 1 z 20 i zepsuła Easy (0,76 -> 0,24), więc została usunięta w 078f2b3, zgodnie z warunkiem zapisanym przed kontrolą. Bez strojenia na tych utworach. Reszta kodu i flag zamrożona; rozjazdy trafiły do raportu |
| 13 | 2026-11-05 | flagi figur perkusji i basu | v32, 0513004 | Kontrola po etapie: Normal wobec v32 i map ludzi z `figures` i `figuresQuarter` osobno (gęstość, trafienia w nuty ludzi, ile nut dochodzi i odpada, miejsce w beacie, krótkie serie) oraz czy Easy, Hard i Hell zostają bez zmian, obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą. `figures`: F1 z 0,827 na 0,830, wzrost mniejszy niż na treningu. `figuresQuarter`: 135 nut na ćwierćbeatach, 0% trafień, F1 0,825. Flaga zostaje wyłączona, wynik podany użytkownikowi do decyzji |
| 14 | 2026-11-05 | flagi mini pauz i wolnych utworów | v33, 0dbcd7f | Kontrola po etapie: Easy, Normal, Hard i Hell wobec v33 z `miniRests` i `feltTempo` osobno (gęstość, trafienia w nuty ludzi, ile nut dochodzi i odpada, ile utworów się zmienia), obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą. `miniRests`: Normal 12 z 20 utworów, +63 nuty, 70% na nutach ludzi, F1 0,8315 -> 0,8331, inne poziomy bez zmian. `feltTempo`: żaden utwór testowy nie ma poniżej 115 BPM, więc kontrola nic o nim nie mówi |
| 15 | 2026-11-06 | flagi samotnej nuty w ciszy | v33, 908300d | Kontrola po etapie: Easy, Normal, Hard i Hell wobec v33 z `quietLone` i `quietLoneHold` osobno (F1, udział akordów i holdów, co ludzie grają w zmienionych miejscach), obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą. `quietLone`: Normal 4 z 20 utworów, 10 akordów mniej, ludzie mają tam pojedynczą nutę 7 z 8 razy, F1 bez zmian 0,8315. `quietLoneHold`: do tego 2 nowe holdy, ludzie nie mają tam holda. Inne poziomy bez zmian |
| 16 | 2026-11-06 | flaga cichego solo melodii | v34, f4c4cf7 | Kontrola po etapie: Easy, Normal, Hard i Hell wobec v34 z `soloLead` (F1, udział akordów i holdów, co ludzie grają w miejscach zabranych akordów), obejrzane tylko jako podsumowania, bez listy utworów | Nie, kod zamrożony przed kontrolą. Normal 4 z 20 utworów, 11 akordów mniej, ludzie mają tam nutę 4 razy, w tym 2 akordy, F1 bez zmian 0,8315. Inne poziomy bez zmian |
