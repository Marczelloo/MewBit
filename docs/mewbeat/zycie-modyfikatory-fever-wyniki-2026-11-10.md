# mewbeat: życie, modyfikatory, fever, ekran wyników (2026-11-10)

Projekt zatwierdzony przez użytkownika 2026-11-10. Kod i komentarze po angielsku, w stylu otaczającego kodu.
Testy: `node scripts/run-tests.js` (node:test). Klient: `activity/src/mewbeat` (ESM, React 19). Bot: `helpers/` (CommonJS).
Serwer przelicza każdy run plikiem klienta `activity/src/mewbeat/scoring.js` (`helpers/mewbeat/recompute.js` ładuje go przez
dynamic import), więc każda reguła punktów, życia i feveru żyje w module klienta i serwer dostaje ją za darmo.

## Decyzje użytkownika

- Przegrana domyślnie włączona, jak w Beat Saberze. No Fail to modyfikator.
- Po przegranej w pokoju gracz ogląda innych (istniejący widok spectate z przełączaniem graczy). W Live: napis Failed, bloki znikają, tablica live zostaje do końca piosenki. W Solo: koniec runu i wyniki „Failed”.
- Fever: ustawienie „Manual (Space)” / „Auto” (sam rusza przy pełnym pasku). Rzadziej niż teraz.
- Nowe zasady = nowe tablice: wersja zasad wchodzi do klucza tablicy wyników. Stare wyniki zostają w historii.

## 1. Życie (health)

- Zakres 0..1, start 0.5. Delta: perfect +0.01, great +0.01, good +0.005, miss głowy lub tapa −0.08, miss ogona holda −0.04 (do 2026-11-10 po teście: −0.15 i −0.08, przegrywało się za szybko).
- Health 0 i brak No Fail → run przegrany (`failedAt` = czas słyszany tej oceny). Po przegranej żadna ocena nie zmienia już stanu (serwer ignoruje późniejsze eventy).
- One Life: pierwszy miss (dowolna część) → health 0 → przegrana. Four Lives: 4 życia, każdy miss zabiera jedno, 0 żyć → przegrana; health nie jest wtedy używane do przegranej (pasek pokazuje 4 pipsy).
- No Fail: health może spaść do 0, run trwa dalej. Od pierwszej oceny, przy której health osiągnął 0, każda kolejna ocena daje ×0.5 punktów (jak BS 1.13.2). Health dalej rośnie z trafieniami, ale kara zostaje do końca.
- Kalibracja, samouczek (tour/trap), autoplay i widz (spectator) nigdy nie przegrywają: niejawne No Fail bez kary (flaga `noFail` w createScore, nie modyfikator).
- Fever nie wpływa na health.

## 2. Modyfikatory

Nowy moduł `activity/src/mewbeat/modifiers.js` (ESM, bez zależności; serwer ładuje go jak scoring.js).

| id | nazwa | grupa (wykluczają się) | wynik | działanie |
|---|---|---|---|---|
| `nf` | No Fail | fail | 0 (kara ×0.5 po wyczerpaniu, w scoring) | nie da się przegrać |
| `ol` | One Life | fail | +0.10 | jeden miss kończy |
| `fl` | Four Lives | fail | +0.04 | cztery missy kończą |
| `gn` | Ghost Notes | – | +0.16 | bloki gasną w dolnych ~35% toru przed linią trafienia |
| `st` | Strict Timing | – | +0.12 | okna trafień ×0.75 (także okno early-miss i ogonów) |
| `nc` | No Colors | – | +0.06 | wszystkie bloki i holdy w jednym kolorze (tory i odbiorniki zostają kolorowe) |
| `mr` | Mirror | – | +0.02 | tory odbite (lane → 3 − lane) |
| `fs` | Faster Song | speed | +0.15 | tempo 1.2× |
| `sf` | Super Fast | speed | +0.30 | tempo 1.5× |
| `ss` | Slower Song | speed | −0.40 | tempo 0.85× |

Eksport:
- `MODIFIERS` — lista definicji `{ id, name, short, group|null, bonus, speed?, solo? }`. Grupa `speed` ma `solo: true`.
- `normalizeModifiers(list, { mode })` → `{ ok: true, modifiers: string[] }` (posortowane wg kolejności w MODIFIERS, bez duplikatów) albo `{ ok: false, reason: "unknown_modifier" | "conflict" | "solo_only" }`. `mode` to "solo" | "room" | "live"; modyfikatory speed tylko w "solo".
- `modifierMultiplier(modifiers)` → `max(0, 1 + Σ bonus)`.
- `speedOf(modifiers)` → 1 | 1.2 | 1.5 | 0.85.
- `RULES_VERSION = 3` (zasady sprzed życia = 1, pierwsza wersja życia z ostrzejszą karą i mniejszymi bonusami = 2).

## 3. Fever

- Pasek fever (`vibe`) pełni się w zależności od mapy: N = max(30, round(0.2 × parts)), gdzie parts = liczba ocen mapy (tap 1, hold 2; `judgeablePartsOf`). Delta: perfect +1/N, great +0.6/N, good +0.25/N, miss −0.05. Podczas feveru pasek nie rośnie (jak teraz). FEVER_MS 8000 i ×2 punktów bez zmian.
- Efekt: najwyżej ~4 fevery na piosenkę przy idealnej grze, realnie 2–3, na każdym poziomie trudności.
- Ustawienie gracza `feverMode: "manual" | "auto"` (domyślnie "manual"). Auto odpala fever w pętli gry, gdy pasek pełny (tak jak dziś robi to autoplay). Serwer nie musi znać trybu: dostaje czasy startu feveru jak dotąd.

## 4. API scoring.js (kontrakt między zadaniami)

- `createScore({ parts, modifiers = [], noFail = false } = {})` — dodatkowe pola stanu: `health` (0.5), `lives` (4 przy `fl`, inaczej null), `failedAt` (null), `depletedAt` (null; pierwsze wyczerpanie przy No Fail), `feverN`, `modMult`, plus `rawPoints` jeśli potrzebne. `createScore()` bez argumentów musi dalej działać (parts nieznane → N = 30).
- `applyJudgement(state, judgement, songMs, part = "head")` — punkty = `BASE_POINTS × multiplierFor(combo) × (fever ? 2 : 1) × modMult × (po wyczerpaniu przy NF ? 0.5 : 1)`, zaokrąglone do liczby całkowitej na ocenę. Po `failedAt !== null` zwraca stan bez zmian.
- `isFailed(state)`; `healthOf(state)`.
- `startFever` / `canFever` / `vibeAt` jak dotąd (z nowym N).
- Okna: `judgementFor(absErrorMs, scale)` już ma `scale`; Strict Timing mnoży scale przez 0.75 w judge (zadanie 2).

## 5. Serwer

- `recompute.js`: `recomputeRun({ chart, events, fevers, modifiers, noFail, loadScoring })` buduje `createScore({ parts: judgeablePartsOf(chart), modifiers, noFail })`, zwraca dodatkowo `failed`, `failedAt`, `depleted` (bool, NF), `modifiers`.
- `activityChannel.submit`: czyta `message.modifiers` (brak = []), waliduje `normalizeModifiers(…, { mode })`; błąd → `fail(reason)`. Przegrany run: `ranked = false`, nie idzie do scoreStore; do historii z `failed: true` i `modifiers`; do statystyk jak dotąd (warunek completion). Odpowiedź `result` zawiera `failed`, `modifiers`.
- Klucz tablicy: jedna funkcja buduje `${audioKey}|${difficulty}|${version}|r${RULES_VERSION}` we wszystkich miejscach (linie ~451, ~564 i wszystko, co korzysta z `chartKeyFor` / `currentChartKeyOf`). Stare wiersze zostają w magazynie, po prostu nie pasują do nowego klucza.
- scoreStore zapisuje `modifiers` przy wyniku (sprawdzić schemat AtlasHub/pliku; dodatkowe pole JSON); `board(...)` zwraca `modifiers` w wierszach.
- Pokój: `rooms.submitted(room, userId, { score, accuracy, grade, difficulty, failed, modifiers })`; w standings przegrani są pod tymi, którzy skończyli. Klient pokoju może wysłać submit wcześniej (zaraz po przegranej).
- Live/room próbki (`liveSample`) niosą `failed: true` po przegranej, a tablice live pokazują FAILED.

## 6. Klient — gra

- `run.js`: `createRun({ ..., modifiers = [], noFail = false })` przekazuje do createScore; Mirror odbija tory przy starcie (indeksy nut `n` bez zmian, więc serwer nic nie wie o lustrze); Strict skaluje okna judge; snapshot zawiera `health`, `lives`, `failed`, `depleted`, `modifiers`, `modMult`; po przegranej `tick` zwraca event `{ kind: "fail" }` (raz) i run przestaje oceniać (jak `ended`). `log()` dodaje `modifiers` i oś czasu nie jest potrzebna (wykres liczy się z eventów).
- Tempo (tylko Solo): audio gra z `playbackRate = speed` (z obniżeniem/podwyższeniem tonu jak w BS, bez zachowania wysokości), czas piosenki to dalej czas utworu (ms pozycji w nagraniu), więc nuty, eventy i serwer się nie zmieniają; bloki spadają szybciej w czasie rzeczywistym.
- HUD: pasek życia pionowo przy prawej krawędzi toru (jak osu!mania), kolor od zielonego przez żółty do czerwonego poniżej 0.3, pulsuje poniżej 0.2 (tylko przy efektach full). Four Lives: 4 pipsy; One Life: jeden pips. No Fail po wyczerpaniu: pasek przygaszony + mały chip „NF ×0.5”. Czyta HUD store przez selektor (jak inne liście w StageLeaves), bez re-renderu sesji.
- Przegrana: banner „FAILED” (~1.5 s), tor gaśnie. Solo: muzyka zwalnia do zera w ~1 s (rampa playbackRate) i staje, potem wyniki w wersji Failed. Pokój: submit przegranego runu od razu, potem istniejący widok spectate (SpectateCard ze strzałkami). Live: tor znika, tablica live zostaje, wyniki Failed po końcu piosenki. Mewbit: poza „crushed”.
- Ghost Notes: w highway.js bloki i ciała holdów gasną liniowo od 65% do 85% drogi do linii trafienia (alpha 1 → 0).
- Ustawienia: `feverMode` w panelu ustawień (Manual/Auto) obok opisu „Space is FEVER”.

## 7. Klient — wybór modyfikatorów

- Song select (Solo) i lobby pokoju: przycisk „Modifiers” otwiera panel z przełącznikami pogrupowanymi (Fail, Notes, Speed), z bonusem przy każdym i sumarycznym mnożnikiem („×1.14”). Wykluczające się w grupie działają jak radio z możliwością odznaczenia. Speed niewidoczne/wyłączone poza Solo z podpowiedzią dlaczego.
- Wybór zapamiętany per gracz (tak jak inne ustawienia gracza), osobno nic dla trybów — tylko speed jest odrzucany poza Solo.
- Tablice wyników (song select, wyniki, lobby): wiersz z modyfikatorami pokazuje krótkie tagi (`NF`, `GN`, `FS`…).

## 8. Ekran wyników

- Tło: scena piosenki z gry (StageBackdrop jest już pod spodem) — wyniki przestają być nieprzezroczyste w środku; ciemna, lekka zasłona dla czytelności zamiast czarnej pustki; rozmyta okładka zostaje tylko jako fallback, gdy sceny brak.
- Wykres runu: pełna szerokość pod kartami (SVG, bez bibliotek), oś X = czas piosenki, linia życia (z replayu eventów przez scoring.js), czerwone kreski missów, pasy odcinków feveru, znacznik przegranej. Nowy moduł `runGraph.js` z czystą funkcją `runGraphOf({ events, fevers, parts, modifiers, noFail, durationMs })` → `{ health: [{ t, v }], misses: [t], fevers: [{ from, to }], failedAt }` + test.
- Nagłówek: chipy modyfikatorów i mnożnik obok poziomu trudności.
- Wersja Failed: etykieta „Failed · Normal”, zamiast litery oceny czerwony stempel „FAILED”, Restart jako główny przycisk w Solo, poza Mewbita smutna/crushed, linia Mewbita z nowego momentu `failed` w `mewbit/lines.js`.
- Nic do generowania: wystarczy scena z gry.
