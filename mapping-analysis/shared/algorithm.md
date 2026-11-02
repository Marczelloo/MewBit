# Algorytm mapowania mewbeat: jak dziś podejmuje decyzje

Stan kodu: gałąź `feat/mewbeat`, commit `de7bc96`, `GENERATOR_VERSION = 19` (`helpers/mewbeat/charts/difficulty.js`).
Ten dokument opisuje kod bez oceniania go. Ocena przychodzi dopiero po porównaniu z mapami ludzi (etapy 2 i 3).
Miejsca, które warto sprawdzić w danych, są zebrane osobno na końcu jako **hipotezy, nie wnioski**.

## 0. Mechanika gry (z kodu i specyfikacji, nie z założeń)

- 4 tory, klawisze D F J K. Ręce: tory 0–1 to lewa, 2–3 prawa (`handOf = lane >> 1`).
- Nuty zwykłe (`{t, lane}`) i holdy (`{t, lane, len}`). Głowa holda jest oceniana jak tap, koniec przy puszczeniu z oknem ×1,5
  (`docs/superpowers/specs/2026-11-01-mewbeat-layered-charts-design.md`, sekcja 4).
- Okna oceny: PERFECT ≤ 40 ms, GREAT ≤ 75 ms, GOOD ≤ 110 ms, wczesny MISS 110–150 ms. Ghost tapy nie są karane.
- Prędkość spadania jest stała w obrębie utworu. Gra skaluje ją przez `chart.bpm` (`generate.js` → `chartFrom`).
- Audio gra bot z YouTube/innego źródła, a nie plik z mapy. Dla analizy nie ma to znaczenia, bo charty algorytmu
  generujemy z audio z `.osz`, więc nuty ludzi i algorytmu są na tej samej osi czasu.
- W kodzie są **cztery** poziomy: `easy`, `normal`, `hard`, `hell`. Gra generuje wszystkie cztery (`chartStore.js`,
  `generateAll`). Ta analiza obejmuje trzy pierwsze, zgodnie z zadaniem. Hell jest opisany tylko dla porządku.

Mechanika odpowiada osu!mania 4K: 4 tory, tapy i long note'y, podobne okna czasowe (osu!mania przy OD 8: 300 ≈ ±40 ms,
100 ≈ ±100 ms). Różnice ważne dla przenoszenia wniosków:

1. osu!mania ma osobne mapy dla 4K/7K itd. Tutaj zawsze jest 4K, więc z korpusu biorę wyłącznie mapy 4K.
2. W osu!mania mapper ustawia timing (BPM, offset, metrum) ręcznie. Tutaj siatka pochodzi z automatycznego śledzenia beatu.
3. osu! nie ma „wyboru layera”. Mapper słyszy całość, a algorytm widzi tylko to, co wykryje DSP.

## 1. Wejście: cechy audio z pluginu (`lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/`)

Plugin dekoduje utwór do 48 kHz stereo, `Downsampler` robi z tego 24 kHz mono, a `FeatureExtractor` liczy (features v2):

| Pole | Jak powstaje | Ograniczenia istotne dla mapowania |
|---|---|---|
| `bands[4].onsets` | Spectral flux w pasmach 20–150 / 150–800 / 800–4000 / 4000–12000 Hz, FFT 1024, hop 256 (10,7 ms), adaptacyjny próg (`OnsetPicker`), min. 50 ms między onsetami w paśmie | Siła znormalizowana do 95. percentyla pasma, więc „silny” znaczy silny względem samego pasma, nie całego miksu |
| `tempo` | Autokorelacja obwiedni onsetów z priorem log-Gauss wokół 120 BPM, zakres 60–200 BPM, test 3:2, potem śledzenie beatu programowaniem dynamicznym (Ellis 2007) (`TempoEstimator`) | **Jedno tempo bazowe na cały utwór.** Beaty mogą się lekko przesuwać (DP), ale zmian tempa nie ma w modelu |
| `tempo.downbeats` | Co 4. beat od jednej fazy (`downbeatPhase` = indeks mod 4 z największą energią niskiego pasma) | **Zakłada metrum 4/4 i jedną fazę taktu na cały utwór** |
| `energy` | RMS co 500 ms, podzielone przez 95. percentyl utworu, obcięte do 0..1 | Głośność względna w obrębie utworu |
| `sections` | Wygładzona (4 s) energia przecina medianę ±0,15, min. 4 s, granice przyciągane do downbeatów (`Highlight.sections`) | Sekcje wyłącznie z głośności: brak pojęcia zwrotki, refrenu, buildupu |
| `highlightMs` | Najgłośniejsze okno 12 s poza pierwszymi 15 s i ostatnimi 10 s | Tylko do powtórki w przerwie, nie do chartu |
| `drums` | HPSS (mediany Fitzgeralda, jądro 17), flux części perkusyjnej w 3 pasmach, klasyfikacja po udziale pasm: `kick` / `snare` / `hat` / `perc` (`Hpss`, `DrumDetector`) | Klasyfikacja po kształcie widma. Bez separacji źródeł (bez stemów) |
| `bass`, `lead` | Suma harmonicznych na widmie 4096; bas MIDI 23–59, lead MIDI 55–96 po odjęciu harmonicznych basu; nuty z `len`, `pitch`, `s`, `conf` (`PitchTracker`) | Jedna linia basu i jedna linia „leadu” (wokal albo melodia, co jest głośniejsze). W gęstym miksie `lead` bywa zawodny (kod sam to przyznaje progami `conf`) |
| `phrases.list` | Bloki po 16 beatów; `repeatOf` = najwcześniejsza wcześniejsza fraza o podobieństwie ≥ 0,85 (0,6·cos(chroma) + 0,4·cos(rytm)), przesunięcia −4..+4 beaty; `activity`/`confidence` warstw (`Repetition`, `LayerActivity`) | Fraza ma zawsze 16 beatów (4 takty 4/4), niezależnie od budowy utworu |

## 2. Wspólna analiza (identyczna dla każdego poziomu): `generate.js` → `analyse()`

1. **Legato leadu** (`legato.js`): fragmenty wokalu bliżej niż 60 ms i w zakresie ≤ 1 półtonu łączą się w jedną nutę.
2. **Siatka** (`timing.js` → `buildTiming`):
   - beat zaufany, gdy `confidence ≥ 0,5`, albo ≥ 0,35 przy bardzo regularnych odstępach (CV ≤ 8%, 90% w ±10% mediany);
   - inaczej `NO_TIMING`: brak siatki, nuty zostają w surowych czasach, brak akordów zależnych od downbeatu;
   - **składanie tempa** do 70–200 BPM przez podwajanie lub połowienie, plus jedno dodatkowe podwojenie poniżej 95 BPM,
     gdy jest ≥ 8 silnych onsetów na beat (hipoteza „half-time”);
   - beaty przedłużone do 0 i do końca utworu medianą beatu; punkty siatki 1/2, 1/4, 1/8 są interpolowane liniowo
     między kolejnymi beatami (`gridPoints`).
   - **Siatka zna tylko podziały binarne** (1/1, 1/2, 1/4, 1/8: `grid.js`, `EIGHTHS_PER_BEAT = 8`). Triole (1/3, 1/6)
     nie istnieją. Zdarzenie dalej niż 1/16 beatu od siatki 1/4 trafia na siatkę 1/8 (`snapToQuarterGrid`).
3. **Frazy** (`phrases.js` → `buildPhrases`): lista z pluginu albo, bez niej, okna po 16 beatów (lub 8 s bez siatki)
   cięte na granicach sekcji. Każda fraza dostaje `energy` (średnia), `pulse` (udział słyszalnych beatów z perkusją
   lub onsetem niskiego pasma), `rate` (onsety/s na warstwę), `sectionStart`.
4. **Warstwa prowadząca** na frazę (`chooseLeaders`): `drums` / `bass` / `lead` / `bands`.
   - Wynik warstwy: perkusja = aktywność, bas = aktywność × pewność, lead = pewność; każdy skalowany w dół, gdy warstwa
     ma mniej niż `1,8 × energia` onsetów na sekundę.
   - Warstwa „obecna” tylko powyżej progów (lead/bas `conf ≥ 0,45`, perkusja `activity ≥ 0,15` i `conf ≥ 0,3`).
     Gdy żadna nie jest obecna: `bands` (stara ścieżka v3, pkt 3.3).
   - „Utwór wokalny” (≥ 30% fraz z pewnym, gęstym leadem): lead z wynikiem ≥ 0,5 wygrywa od razu.
   - Histereza: poprzedni lider zostaje, jeśli ma ≥ 80% wyniku najlepszego i fraza nie zaczyna sekcji.
   - Fraza-powtórzenie (`similarity ≥ 0,85`) dziedziczy lidera źródła.
5. **Warstwy wspierające** (`supportLayers`): inne obecne warstwy z wynikiem ≥ 30% wyniku lidera. Wtedy fraza jest
   „mieszana”: niskie dźwięki (bas, stopa) na lewą rękę, wysokie (werbel, hi-hat, lead) na prawą. W utworze wokalnym fraza
   prowadzona przez wyraźnie śpiewany lead nie dostaje wsparcia.
6. **Intensywność sekcji** (`intensity.js`): tempo zdarzeń we frazie względem średniej geometrycznej utworu,
   do potęgi 0,6, obcięte do 0,6–1,3. Mnoży „moc” okna w limicie gęstości.
7. **Ruchliwość utworu** (`busyness.js`): silne onsety/s względem 14/s, obcięte do 0,8–1,6, mnożą `maxNps` poziomu
   (do `maxNpsCeiling`).

## 3. Jeden poziom: `generate.js` → `chartNotes()` i `finish()`

Każdy poziom jest liczony **osobno, z tej samej puli zdarzeń**. Kod nie bierze Hard i go nie przerzedza
(komentarz przy `chartNotes`, linie 91–93). Wspólne są lider, wsparcie i zdarzenia `patternEvents`.
Różne są filtry, limity i dodatkowe przebiegi. Uwaga: nagłówek `barRepeats.js` mówi
o Easy i Normal „thinned from Hard” i o funkcji `repeatBars`, której w kodzie już nie ma. Ten komentarz jest nieaktualny.

Dla każdej frazy, po kolei:

### 3.1 Powtórzenie (`copiedRepeat`, `repeats.js`)
Gdy fraza jest powtórzeniem (`repeatOf`, `similarity ≥ 0,85`), kopiowane są **nuty tego samego poziomu** ze źródła,
przesunięte o całkowitą liczbę beatów najbliższą `lagMs`. Kopia traci nuty, które nie mają zdarzenia audio w ±60 ms.
Gdy zostaje < 50% nut źródła, fraza jest mapowana od nowa.

### 3.2 Zdarzenia wzorca (`patterns.js` → `patternEvents`), wspólne dla poziomów
Każde zdarzenie dostaje `level`: 0 = mocne, 1 = na siatce 1/2 lub 1/4, 2 = drobne (hi-haty, uderzenia na 1/8).
- **Perkusja** (`drumEvents`): stopa na torach 0/3, werbel/perc na 1/2, n-te uderzenie klasy bierze tor `n % 2` z pary.
  Level 0 = na beacie i siła ≥ mediana frazy; uderzenie na 1/8 = level 2; hi-haty tylko na wolnych slotach 1/4, level 2.
- **Bas/lead** (`tonalEvents`): tor z wysokości dźwięku w zakresie frazy (wąski zakres < 3 półtonów: z konturu),
  bieg ≥ 3 kroków w jedną stronę = schody, powtórzony dźwięk szybciej niż max(½ beatu, 250 ms) = tryl na sąsiednim torze.
  Level 0 = na beacie/półbeacie (lead zawsze, bas przy sile ≥ mediana) albo w najdłuższej ćwiartce nut.
- **Perkusja pod liderem tonalnym** (`secondaryEvents`): przy energii frazy ≥ 0,6 stopa/werbel tam, gdzie lider milczy;
  na beacie level 0 (więc Easy też je dostaje), poza beatem level 1.
- **Długie nuty innej warstwy** (`sustainEvents`): ≥ 1,5 beatu i `conf ≥ 0,8`, level 0, jako przyszłe holdy.
- **Akcent początku taktu** (`withChords`): lustrzana nuta na początku taktu pod pojedynczym zdarzeniem level 0
  (`level 1, accent`).
- **Fraza mieszana** (`mixedEvents`): lider i wsparcie, jedno zdarzenie na rękę i chwilę, wsparcie o 1 level wyżej,
  chyba że wypełnia pauzę lidera; `takeTurns` rozdziela miejsca w limicie gęstości po równo między źródła.
- **Ścieżka `bands`** (`bandPath.js`) dla frazy bez wyraźnej warstwy: onsety 4 pasm sklejone w ±30 ms, przyciągnięte do siatki
  poziomu (`baseDiv`/`energyDiv`/`fineDiv`) gdy ≤ 35 ms od punktu, przerzedzane w oknach 2 s do celu
  `maxNps × moc`, ranking `siła × bandBias + beatBias × (downbeat 1 / beat 0,5)`, tor = pasmo
  (na Hard naprzemiennie z drugim najsilniejszym pasmem, `alternation`).

### 3.3 Filtr poziomu (`difficultyFilter.js` → `applyDifficulty`)
Kolejno:
1. odrzuca zdarzenia powyżej `maxLevel` (akcenty `accent` przechodzą, gdy jest `thinChords`) i `chordOnly` bez `drumChords`;
2. Normal: poza siatką 1/2 tylko w frazach o energii ≥ 0,75 (`quarterMinEnergy`, z wyjątkiem basu/leadu);
3. nic przed 1500 ms (`LEAD_IN_MS`) ani przy energii < 0,08 (`SILENCE_ENERGY`);
4. `thinChords` (Easy, Normal): akord tylko na mocnym beacie (Easy: downbeat), z nutą w każdej ręce, w limicie `maxChordShare`;
5. `capMoments`: maks. 2 nuty na chwilę;
6. `limitJacks` (miękko), potem `selectByFloors`: kolejność wyboru, odstępy `minNoteGapMs`, `minLaneGapMs`, `gapBeats`,
   `maxFastRun` i **limit gęstości**: w każdym oknie 2 s maks. `floor(maxNps × 2 × max(dolna_moc, moc) + 1)` nut,
   gdzie `moc` = średnia (energia × intensywność) okna, a `dolna_moc` > 0 tylko dla frazy perkusyjnej ze stałym pulsem
   (`pulseNotesPerBeat`);
7. Normal: `capQuarters` (≤ 10% chwil poza siatką 1/2); `spaceChords` (akord nie w środku szybkiego biegu);
8. `planHolds` (hold z `sustainMs` ≥ `holdMinBeats`, maks. 4 beaty, reguły drugiej ręki), na końcu `limitJacks` ściśle.

### 3.4 Po filtrze, w `chartNotes`
- `repeatBarLanes` (wszystkie poziomy): takt podobny do taktu 1 lub 2 wstecz (≥ 65% wspólnych slotów 1/4) bierze jego tory.
- `orientDrums`: fraza perkusyjna po zmianie lidera jest odbijana lustrzanie, gdy to płynniej łączy ręce.
- Pauzy (≥ 2 beaty):
  - Easy, Normal: `fillRests` (`rests.js`) wstawia **pojedynczą nutę** z dźwięku muzyki w środek pauzy, póki pauzy są
    i energia ≥ 0,2;
  - Hard: `fillGaps` (`seams.js`) wypełnia pauzę **wszystkimi** stopami i werblami na beatach/półbeatach.
- `addGapHolds` we frazach z basem/leadem: tap, po którym ręka odpoczywa ≥ 1,25 beatu przy granej muzyce, staje się holdem ≤ 2 beaty.
- `balanceHands` (Easy, Normal): odbicie lustrzane frazy, gdy wyrównuje ręce.
- `spreadLanes` (Easy, Normal): powtórzenie toru bliżej niż `laneGapBeats` przenosi się na wolny tor.
- Na końcu utworu `addSustainHolds`: długie (≥ `sustainMinBeats`, `conf ≥ 0,8`) nuty basu/leadu zamieniają tap na hold.

### 3.5 `finish()`
`clipHolds` → `enforceFloors` (cały utwór: odstępy i reguły holdów, wcześniejsza nuta wygrywa) → Easy: `oneHoldAtATime`
→ `limitHoldShare` **na frazę** (Easy 40%, Normal 35%, Hard domyślnie 12% nut). Chart z < 20 nut = „nie do zmapowania”.

## 4. Czym różnią się ścieżki kodu poziomów

Wartości z `DIFFICULTIES` (`difficulty.js`); `—` = brak klucza, czyli zachowanie domyślne lub wyłączone.

| Parametr | Easy | Normal | Hard | Hell |
|---|---|---|---|---|
| `maxNps` (× ruchliwość 0,8–1,6, sufit) | 3 (sufit 3,5) | 5 (5,5) | 9 (10) | 13 (16) |
| Najdrobniejszy poziom zdarzeń `maxLevel` | 0 | 1 | 2 | 2 |
| Siatka ścieżki `bands` (`baseDiv`/`fineDiv`) | 1/2 / — | 1/2 / — | 1/4 / 1/8 | 1/4 / 1/8 |
| Min. odstęp dowolnych nut `minNoteGapMs` | 200 | 100 | 60 | 45 |
| Min. odstęp na torze `minLaneGapMs` / `laneGapBeats` | 350 / 1 | 200 / 1 | 150 / ¼ | 110 / ¼ |
| `gapBeats` (min. odstęp w odczuwanych beatach) | ½ (tonalne ½) | ¼ | — | — |
| `maxJack` | 2 | 2 | 3 | 4 |
| Akordy | downbeat, s ≥ 0,8, E ≥ 0,7 | każdy beat, s ≥ 0,4, E ≥ 0,45, ≤ 1/3 chwil, `drumChords` | ścieżka wzorca: **bez reguły**, każde 2 zdarzenia w chwili; ścieżka `bands`: s ≥ 0,95 | jak Hard, `bands` s ≥ 0,8 |
| Kolejność wyboru | `leaderFirst` (lider, potem beat) | `leaderFirst` | poziom, potem siła (`byPriority`) | jak Hard |
| `densityByMoment` (akord = 1 w limicie) | tak | tak | nie | nie |
| Pauzy | `fillRests` (1 nuta) | `fillRests` | `fillGaps` (cała perkusja) | `fillGaps` |
| `spreadLanes`, `balanceHands` | tak | tak | nie | nie |
| Tylko lider, bez warstw wsparcia `oneLayer` | tak | nie | nie | nie |
| Lead prowadzi każdą frazę, gdzie słychać wokal `vocalLeads` | tak | nie | nie | nie |
| Szybkie biegi `maxFastRun` | — | ≤ 3 szybkie odstępy z rzędu | — | — |
| Udział chwil poza siatką 1/2 `maxQuarterShare` | — (siatka i tak 1/2) | ≤ 10% | — | — |
| Holdy: druga ręka | odstęp 1 beat, 1 hold naraz | odstęp ½ beatu | wolna | wolna |
| Udział holdów na frazę | ≤ 40% | ≤ 35% | ≤ 12% (domyślne) | ≤ 12% |
| `pulseNotesPerBeat` (dolny limit gęstości w pulsie) | 0,5 | 1 | 2 | 4 |
| `bandBias` / `beatBias` | backbone / 0,35 | backbone / 0,2 | surowa siła / 0 | surowa siła / 0 |

Strukturalnie:
- **Easy i Normal** przechodzą przez zestaw reguł „czytelności”, dopisywanych warstwami
  (historia: `00c62e5` „readable Easy and Normal charts”, `e293162` „fuller Normal”). Normal ma ich najwięcej
  i to on ma reguły wyjątkowe: `drumChords`, `maxChordShare`, `chordGapBeats`, `maxFastRun`, `maxQuarterShare`, `quarterMinEnergy`.
- **Hard** nie ma żadnej z tych reguł. Jego chart to „wszystko, co wykryło DSP, do poziomu 2”, ograniczone tylko
  odstępami w ms, `maxJack 3` i limitem gęstości. To najprostsza i najbardziej bezpośrednia ścieżka.
- **Easy** jako jedyny może iść za innym liderem niż Normal i Hard (`vocalLeads`) i jako jedyny gra jedną warstwę (`oneLayer`).
  W takich frazach Easy nie jest podzbiorem Normal ani Hard.
- Pozostałe poziomy dzielą pulę zdarzeń, więc w praktyce często są „zagnieżdżone”, ale kod tego nie gwarantuje:
  wybór w limicie gęstości, `spreadLanes`, `balanceHands` i `fillRests` mogą dać na Normal nutę, której nie ma na Hard
  albo jest na innym torze. Czy i jak często tak jest, ustalimy w etapie 3 na danych.

## 5. Hipotezy do sprawdzenia w danych (nie wnioski)

Wypisane po to, żeby etap 2 i 3 miały co obalić. Żadna nie jest tu potwierdzona.

1. Brak trioli w siatce: jeśli ludzie używają 1/3, 1/6 w części gatunków, algorytm je przesuwa lub gubi.
2. Jedno tempo i stałe 4/4: mapy ze zmianami BPM lub metrum mogą mieć dryfującą siatkę i frazy 16-beatowe w złych miejscach.
3. Intensywność sekcji wynika tylko z energii i tempa zdarzeń. Nie ma pojęcia buildupu, dropu ani tego, co mapper robi
   tuż przed zmianą sekcji.
4. Easy/Normal wypełniają każdą pauzę ≥ 2 beaty pojedynczą nutą (`fillRests`). Jeśli ludzie zostawiają na niższych
   poziomach dłuższe przerwy, to usuwa kontrast.
5. Normal: wiele zasad wyjątkowych, które mogą ze sobą kolidować (akordy na każdym beacie do 1/3 chwil, a jednocześnie
   ≤ 10% chwil poza 1/2 i ≤ 3 szybkie odstępy). Rytm Normal może przez to odbiegać od rytmu muzyki bardziej niż na Hard.
6. Hard: brak reguł czytelności, ale ludzki Hard też je ma (akordy z sensem, wzorce, odpoczynek). Hard może być
   „lepszy niż Normal” tylko dlatego, że jest bliżej surowej muzyki, a nie dlatego, że jest dobrze zmapowany.
7. Udział holdów: Hard ≤ 12%, Easy ≤ 40%. Do sprawdzenia, czy ludzie mają odwrotną albo zupełnie inną zależność.
8. Przydział torów perkusji jest stały (stopa na zewnątrz, werbel w środku). Ludzie w 4K częściej budują wzorce
   (jumptrille, schody, rolki) niezależne od instrumentu. Do sprawdzenia, ile ludzkich wzorców da się tak opisać.
9. Klasyfikacja perkusji w pluginie może mylić klasy. Na syntetycznym sygnale kalibracyjnym (`shared/onset_bias.json`,
   `plugin_drum_confusion`): stopy rozpoznane w 100%, ale 112 z 266 hi-hatów oznaczone jako `snare`, werble w 66% jako `perc`,
   a ataki dźwięków tonalnych jako `kick` (52) i `snare` (71). To sygnał syntetyczny, nie muzyka. Na prawdziwych utworach
   sprawdzi to metryka `plugin_events` (który typ zdarzenia ludzie mapują) i porównanie ze stemem perkusji.

## 6. Uwaga wdrożeniowa (poza mapowaniem)

Jar `helpers/lavalink/plugins/mewbeat-plugin-0.1.0.jar` w repozytorium zawiera tylko analizę v1 (bez `Hpss`,
`DrumDetector`, `PitchTracker`, `Repetition`). Bot odrzuca cechy v1 (`analysisClient.js`, „features version mismatch”),
więc z takim jarem utwory byłyby „uncharted”, a nie gorzej zmapowane. Lokalnie jar przebudowuje `scripts/build-mewbeat-plugin.mjs`.
Ta analiza kompiluje DSP ze źródeł (`mapping-analysis/pipeline/audio/FeatureDump.java`), więc nie zależy od tego jara.
