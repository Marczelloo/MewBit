# Wspólne definicje metryk

Obowiązują wszystkie trzy poziomy i oba źródła map (ludzie, algorytm). Etap 2 ich nie zmienia. Nowa metryka trafia tu
przez agenta głównego i jest liczona dla wszystkich poziomów naraz.
Implementacja: `pipeline/metrics/chart_metrics.py` (bez audio), `pipeline/metrics/audio_metrics.py` (z audio).
Klucze w plikach `shared/data/<poziom>/{human,algo}/<set>.json` odpowiadają nazwom w nawiasach.

## Podstawy

- **Siatka referencyjna.** Każdy chart (ludzki i algorytmu) mierzę na siatce z czerwonych timing pointów **mapy ludzkiej**
  tego samego utworu i poziomu (`TimingGrid`). Gdy zestaw nie ma ludzkiej dyfficulty na danym poziomie, chart algorytmu
  mierzę na siatce dyfficulty referencyjnej zestawu (`grid_from`). Czerwona linia zaczyna nową siatkę i nowy takt
  (tak liczy osu!). Pozycja w beatach jest skumulowana, więc odstępy w beatach mają sens także przy zmianach BPM.
- **Spójność timingu.** Dla każdego zestawu sprawdzam, czy wybrane dyfficulty mają identyczne czerwone linie
  (`songs/<set>.json` → `timing_consistent`). Rozbieżności są wypisane w raporcie korpusu.
- **Chwila** (moment): wszystkie nuty o tym samym czasie. Akord = chwila z ≥ 2 nutami. Tor 0–1 = lewa ręka, 2–3 = prawa.
- **Tolerancja siatki** (`snap`): nuta leży na podziale 1/d beatu, jeśli jej odległość od najbliższego punktu tego podziału
  ≤ tolerancja. Sprawdzam od najgrubszego: 1, 2, 3, 4, 6, 8, 12, 16; wygrywa pierwszy pasujący, a brak dopasowania = `off`.
  - Ludzie: 2,5 ms. Edytor osu! zapisuje całe ms, więc to wystarcza z zapasem na zaokrąglenia starych map.
  - Algorytm: min(10 ms; 0,03 beatu). Jego siatka pochodzi z beat trackera w krokach 10,7 ms. Na syntetycznym utworze
    o znanej siatce algorytm trafia beat z medianą błędu 3–4 ms (test dymny), a tolerancja 2,5 ms wrzucała wtedy 57–62% jego nut
    do `off`. Próg 0,03 beatu trzyma 1/6 i 1/8 osobno do ok. 240 BPM: najbliższe punkty tych podziałów są o 0,042 beatu od siebie.
    Błąd w ms raportuję osobno (`grid_error_ms`).
- **Czas aktywny** (drain): od pierwszej nuty do końca ostatniej nuty lub holda, minus przerwy (`[Events]` break).
- Wszystkie rozkłady podaję jako kwantyle (p10/p50/p90 lub wskazane), nie same średnie.

## Gęstość

| Metryka | Definicja |
|---|---|
| `nps`, `mps` | nuty (obiekty, hold = 1) / chwile na sekundę czasu aktywnego |
| `notes_per_beat`, `moments_per_beat` | to samo na beat siatki referencyjnej; niezależne od tempa, do porównań między BPM |
| `nps_window` | nuty/s w oknach 2 s przesuwanych co 0,5 s: p10, p50, p90, max |
| `nps_peak8s` | maks. nuty/s w oknie 8 s (ta sama definicja co w `stars.js` algorytmu) |

## Rytm

| Metryka | Definicja |
|---|---|
| `snap_share` | udział chwil na podziale 1/1, 1/2, 1/3, 1/4, 1/6, 1/8, 1/12, 1/16, `off` |
| `triplet_share` | udział chwil na 1/3, 1/6, 1/12 (podziały, których siatka algorytmu nie ma) |
| `on_beat_share`, `on_downbeat_share` | udział chwil na beacie / na pierwszej mierze taktu (metrum z timing pointu) |
| `downbeats_carried` | udział downbeatów w czasie aktywnym, na których jest chwila |
| `gap_share` | odstęp między kolejnymi chwilami w beatach, przypisany do najbliższej klasy z {8, 6, 4, 3, 2, 3/2, 1, 3/4, 2/3, 1/2, 1/3, 1/4, 1/6, 1/8, 1/12, 1/16} z tolerancją ±6% względnie; inne = `other` |
| `gap_ms`, `gap_beats` | rozkład odstępów (min, kwantyle) |
| `run_1/2`, `run_1/4`, `run_1/3`, `run_1/6`, `run_1/8`, `run_1/1` | serie kolejnych odstępów jednej klasy (jak w Ranking Criteria „consecutive 1/2”): liczba serii/min, maks. i p90 liczby nut w serii |
| `fast_runs_1_4_or_finer` | serie odstępów ≤ 1/4 beatu: liczba/min, maks. nut |

## Akordy

| Metryka | Definicja |
|---|---|
| `chord_share`, `chord_size_share` | udział chwil-akordów; udział chwil o 1, 2, 3, 4 nutach |
| `chord_position_share` | akordy na downbeacie / innym beacie / poza beatem |
| `chord2_split_hands_share` | akordy 2-nutowe z nutą w każdej ręce |
| `chords_in_fast_stream_per_min` | akordy, których oba sąsiednie odstępy ≤ 1/4 beatu (RC: „chords during consecutive 1/4”) |

## Jacki i anchory

| Metryka | Definicja |
|---|---|
| `minijack_share` | udział par kolejnych chwil, które dzielą tor |
| `minijack_gap_beats`, `minijack_fast_share` | odstęp takich par; udział par ≤ 1/4 beatu |
| `jack_max_notes` | najdłuższa seria kolejnych chwil z tym samym torem |
| `anchor_max_notes` | najdłuższy łańcuch nut jednego toru co drugą chwilę (1-2-1-2-1 → 3). Przybliżenie definicji z RC |

## Holdy

| Metryka | Definicja |
|---|---|
| `hold_share` | holdy / wszystkie nuty |
| `hold_len_beats`, `hold_short_share` | długość w beatach (p10/p50/p90); udział < 1/2 i < 1 beatu |
| `holds_with_notes_inside_share` | holdy, w trakcie których zaczyna się inna nuta |
| `other_hand_notes_per_beat_in_hold` | nuty drugiej ręki na beat trwania holda (p50, p90) |
| `release_gap_beats`, `release_snap_share` | odstępy między puszczeniami; podział, na którym leży puszczenie |
| `max_simultaneous_holds` | najwięcej holdów trzymanych naraz |

## Tory i wzorce

| Metryka | Definicja |
|---|---|
| `lane_share`, `left_hand_share` | udział nut na torach 0–3; udział lewej ręki |
| `single_step_share` | dla kolejnych chwil jednonutowych: skok o 0, 1, 2, 3 tory |
| `hand_switch_share` | dla tych samych par: zmiana ręki |
| `trill_share`, `stair_share` | trójki chwil x-y-x (tryl; także jumptryl na akordach) i x, x±1, x±2 (schody/rolka) |
| `pattern4_entropy_bits`, `pattern4_distinct_per_100` | entropia i liczba różnych 4-chwilowych układów torów na 100 wystąpień: różnorodność kontra powtarzalność |

## Pauzy, kontrast, sekcje

| Metryka | Definicja |
|---|---|
| `rests_ge_2b`, `rests_ge_4b`, `rests_ge_8b` | przerwy od końca chwili (z holdem) do następnej ≥ 2/4/8 beatów: liczba/min i udział czasu aktywnego |
| `longest_rest_beats` | najdłuższa przerwa |
| `bar_notes`, `bar_notes_cv`, `empty_bar_share` | nuty na takt (kwantyle), współczynnik zmienności, udział pustych taktów |
| `phrase4_notes_p90_over_p10` | kontrast gęstości: p90/p10 liczby nut na blok 4 taktów |
| `kiai_density_ratio` | gęstość w kiai / poza kiai. Kiai to znacznik „kulminacji” postawiony przez mappera. Dla chartu algorytmu kiai jest z mapy ludzkiej, więc mierzy, czy algorytm zagęszcza tam, gdzie człowiek uznał kulminację |
| `sections.*` | granice sekcji wykryte z audio (nowość szachownicowa Foote'a na podobieństwie taktów: chroma, MFCC, RMS; jądro 8 taktów; maks. 1 granica na 4 takty), na taktach siatki ludzkiej. Dla granic: gęstość 4 taktów po / przed (`boundary_after_over_before_median`), ostatni takt przed granicą / 3 wcześniejsze (`boundary_last_bar_over_prev3_median`, buildup), udział granic z nutą lub akordem na downbeacie granicy, osobno granice „w górę” (RMS po/przed ≥ 1,25) i „w dół” (≤ 0,8). Korelacja Spearmana nut na takt z RMS i z tempem onsetów w takcie |

## Powtarzalność (`repetition`)

- Okna po 4 takty od pierwszego downbeatu. Cecha okna: chroma (część harmoniczna) na beat, wycentrowana, plus obwiednia onsetów na 1/4 beatu,
  ważone 0,6/0,4 jak w pluginie, cosinus.
- Pary okien o podobieństwie audio ≥ 0,9 = **muzyczne powtórzenie**, ≤ 0,6 = **linia bazowa**.
- Dla par: `rhythm` = Jaccard pozycji chwil na siatce 1/24 beatu; `lanes` = udział wspólnych chwil o identycznych torach;
  `lanes_or_mirror` = to samo z dopuszczeniem lustra. Wynik: średnie dla powtórzeń i dla linii bazowej.
  Różnica powtórzenie − baza mówi, czy chart powtarza się tam, gdzie powtarza się muzyka.
- Progi 0,9/0,6 są parametrem do kalibracji na danych: odsetek par powyżej progu na utwór raportuję w etapie 1.

## Muzyka pod nutą

- **Onsety librosa** (`alignment`): pełny miks, część perkusyjna i harmoniczna (HPSS), 4 pasma jak w pluginie (20–150, 150–800,
  800–4000, 4000–11025 Hz). Czasy są skorygowane o zmierzony błąd detektora (`shared/onset_bias.json`, −10…−14 ms; kalibracja
  na sygnale o znanych onsetach, `pipeline/audio/calibrate_onsets.py`).
  - `share` = udział chwil w ±25 ms od onsetu danego detektora;
  - `median_signed_ms` = mediana przesunięcia (onset − nuta) dla trafionych;
  - `no_sound_share` = chwile dalej niż 40 ms od każdego onsetu każdego detektora (RC: „every note should correlate to a sound”).
- **Zdarzenia pluginu** (`plugin_events`): kick, snare, hat, perc, bass i lead (`conf ≥ 0,45`, czyli tyle, ile ufa generator),
  onsety 4 pasm.
  - `moment_share` = udział chwil na takim zdarzeniu (±25 ms);
  - `recall` = udział zdarzeń tej klasy w czasie aktywnym, które mają chwilę; `recall_strong` to samo dla `s ≥ 0,5`.
  - Ta sama miara dla ludzi i algorytmu odpowiada na pytanie, z których zdarzeń pluginu człowiek by mapował.
- **Tabela slotów** (`slots/<who>_<set>.npz`): wiersz na każdy punkt siatki 1/8 i 1/6 beatu w czasie aktywnym. Kolumny:
  - położenie: podział, beat w takcie, downbeat, kiai, BPM, takt w bloku 4 taktów;
  - audio: RMS względem p95 utworu, obwiednie librosa względem p99, czy jest onset librosa, siła zdarzenia pluginu każdej klasy;
  - cel: czy slot ma chwilę, ile nut, czy zaczyna się tam hold.

  Na tej tabeli etap 2 bada, co decyduje o wyborze dźwięku (np. regresja logistyczna `mapped` od cech, w podziale na poziomy).
- **Stemy.** Demucs wymaga wag z `dl.fbaipublicfiles.com`, a ten host jest zablokowany w tym środowisku. Wykonalna alternatywa
  to Spleeter 4 stemy (wagi z GitHub Releases, Python 3.11). Jeśli zostanie użyty, kolumny `stem_<drums|bass|vocals|other>`
  (obwiednia onsetów stemu) dojdą do tabeli slotów i do `alignment` dla wszystkich poziomów naraz. Stan: zob. `README.md`.

## Tylko algorytm

- `songs/<set>.json` → `algo_beat_tracking`, czyli beaty algorytmu po złożeniu tempa na siatce ludzkiej (±20 ms):
  - `human_beat_over_algo_beat`: 1 = to samo tempo, 2 = algorytm w podwójnym, 0,5 = w połówkowym;
  - `on_human_beat_share`;
  - `on_human_half_not_beat_share`, czyli faza przesunięta o pół beatu;
  - `on_human_quarter_only_share`, `off_grid_share`;
  - `downbeat_on_human_downbeat_share`, czyli zgodność fazy taktu.
- `grid_error_ms` (każdy chart): odległość chwil od dokładnego punktu podziału, na którym je sklasyfikowano.
- `algo_leaders`, `algo_vocal`, `algo_tempo`: decyzje algorytmu na utwór (warstwa prowadząca na frazę).

## Dane wspólne i między poziomami

- `shared/data/songs/<set>.json` jest niezależne od poziomu: spójność timingu, zmienne BPM, metrum, dopasowanie dyfficulty
  referencyjnej (`alignment_reference`), granice struktury, beat tracking algorytmu. Etap 2 może je czytać.
- `shared/cross/<set>.json` zawiera nuty wszystkich poziomów zestawu. **Tylko dla etapu 3** (porównania Hard → Normal → Easy).

## Czego te liczby nie pokażą

- Czy wzorzec jest przyjemny w ręce, czy czytelny przy danej prędkości spadania i czy „czuć” w nim konkretny instrument.
  Zgodność rozkładów z ludźmi nie dowodzi jakości.
- Czy nuta trafia w dźwięk, który słuchacz uważa za ważny. Onset w ±25 ms to warunek konieczny, nie wystarczający.
- Hitsoundy i keysoundy osu! (nie przenoszą się na grę, w której audio gra bot).
- Slider velocity (zmiany prędkości) w osu!mania. Gra ma stałą prędkość, więc SV pomijam.
