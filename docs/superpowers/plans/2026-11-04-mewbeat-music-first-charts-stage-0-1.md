# mewbeat, mapowanie od muzyki: plan etapów 0 i 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przenieść pomiary do repozytorium, pokazać v26 w debuggerze i dać użytkownikowi ślepą próbę słuchową, która rozstrzyga, czy tani detektor pierwszego planu wchodzi do etapu 2.

**Architecture:** Wszystko offline, bez zmian w `helpers/mewbeat/charts/` i w pluginie. Skrypt Pythona w Dockerze liczy momenty Normal dla każdego wariantu przy tym samym budżecie i zapisuje JSON-y. Debugger dostaje jedną nową stronę, która gra muzykę z kliknięciami i przełącza warianty w miejscu.

**Tech Stack:** Python 3 (librosa, scipy, scikit-learn) w obrazie `mewbeat-ma`, Node (`scripts/mewbeat-debug/server.mjs`), czysty JS i Web Audio po stronie przeglądarki.

**Spec:** `docs/superpowers/specs/2026-11-04-mewbeat-music-first-charts-design.md`

## Global Constraints

- Generator i plugin bez zmian: `GENERATOR_VERSION` zostaje 26, Easy, Normal i Hard jak w v26.
- 20 utworów testowych nietknięte: `mapping-analysis/TEST_USAGE.md` bez nowego wpisu.
- Commit etapami na `feat/mewbeat`, stage po jawnych ścieżkach, bez push i merge.
- Nie commitować: `.impeccable/config.json`, `helpers/lavalink/application.yml`, żadnych jarów.
- Audio i dane odsłuchu tylko w `.mewbeat-debug/` (git-ignorowane). Bez publikacji audio jako Artifact, tylko prywatny tunel debuggera.
- Etap 1 kończy się decyzją użytkownika. Etapu 2 nie zaczynamy bez niej.

## Review Focus

1. Dwa warianty różnią się kilkoma momentami, więc na ucho są nie do odróżnienia. Raport podaje pokrycie każdej pary i wariant prawie identyczny z innym zostaje poprawiony przed oddaniem.
2. Przełączenie wariantu w trakcie grania nie może zdublować ani zgubić kliknięć w miejscu przełączenia.
3. Użytkownik otwiera stronę przez tunel na telefonie lub drugim komputerze: wolny download 32 MB wav pokazuje postęp, błąd dekodowania pokazuje komunikat, układ działa przy 375 px.
4. Klucz wariantów nie może być osiągalny przez serwer, także po `..` w adresie.
5. Kliknięcia giną pod głośną muzyką. Osobne suwaki głośności muzyki i kliknięć, także przy zerowej głośności muzyki.

---

### Task 1: Etap 0, migawka v26 i pomiary w repozytorium

**Files:**
- Modify: `scripts/mewbeat-debug/export.mjs:15-23`, `scripts/mewbeat-debug/server.mjs:21`
- Create: `mapping-analysis/salience/` (`RESULTS.md`, `README.md`, skrypty `*.py`, `run.sh`, logi `*.log`, `b_time.txt`)
- Commit również: specyfikacja, ten plan, `mapping-analysis/shared/mania-patterns.md`

**Interfaces:**
- Produces: migawka `.mewbeat-debug/data/charts/v26/<level>/<id>.json` i trasa `/api/snapshot/<id>/<level>/v26`; stąd task 2 bierze Normal v26 z `train`.

- [ ] Dodać `v26: ${WORK}/s7/data/algo_charts` do `SNAPSHOTS` w `export.mjs` i `"v26"` w `server.mjs`.
- [ ] Uruchomić `node scripts/mewbeat-debug/export.mjs`. Oczekiwane: pliki v26 dla `train` we wszystkich trzech poziomach, zero plików z 20 testowych.
- [ ] Zrestartować serwer debuggera, sprawdzić, że `/api/snapshot/2045473/normal/v26` zwraca nuty, a lista wersji w debuggerze pokazuje v26.
- [ ] Skopiować pomiary ze scratchpada bez `feat*`, `*.pkl`, `__pycache__`. `README.md`: pięć linii o tym, co leży w katalogu, jak uruchomić i że ścieżki `/scripts`, `/repo` to mounty Dockera.
- [ ] `pnpm test`. Oczekiwane: tyle samo zaliczonych co dotąd (1547).
- [ ] Commit: `chore(mewbeat): keep the salience measurements and the v26 snapshot for the music-first work`.

### Task 2: Warianty pierwszego planu

**Files:**
- Create: `mapping-analysis/salience/listening/build_variants.py`, `mapping-analysis/salience/listening/test_select.py`, `mapping-analysis/salience/listening/REPORT.md`
- Wynik poza gitem: `.mewbeat-debug/data/listening/index.json`, `.mewbeat-debug/data/listening/<song>.json`, `.mewbeat-debug/listening-key.json`

**Materiał:** H&D 0:00–1:52 (`preview:toby-fox-hopes-and-dreams-undertale`) oraz trzy utwory z `train`: Flower Dance `476691` (melodia instrumentalna), Yoru ni Kakeru `1374931` (wokal z zespołem), Mizuoto to Curtain `2045473` (zgłoszony przez użytkownika problem z 0:12).

**Interfaces:**
- Produces: `<song>.json` = `{id, title, audioId, durationMs, parts:[{startMs,label}], variants:[{label, moments:[{t}]}], references:[{label, moments:[{t}]}]}`, momenty posortowane rosnąco. `index.json` = `[{song, title}]`.
- Klucz: `{<song>: {<label>: "A"|"B"|"C"|"K"|"V26"}}`, tylko w `.mewbeat-debug/listening-key.json`.

**Wspólna selekcja, jedyna różnica między wariantami to flaga pierwszego planu:**
- Ocena bazowa `base`: regresja logistyczna na `rel_os` (ranga w utworze) i `m_beat, m_half, m_quarter, m_other, m_down, d_grid`, uczona na etykietach Normal z `train`.
- Budżet frazy: 1,485 momentu na beat, zaokrąglony, stały we wszystkich wariantach, bo tu porównujemy kryterium, a nie gęstość.
- `select(cands, flagged, budget, min_gap_ms=90)`: najpierw flagowane wg `base` do budżetu z zachowaniem odstępu. Zostaje mniej niż budżet: dopełnienie z nieflagowanych najpierw na beatach i półbeatach, potem reszta wg `base`. Bez flag `select` daje zwykły ranking `base`.
- K: bez flag. A: kandydat w 40 ms od początku nuty konturu `contour/notes` z `hd_lead.py` przy `min_ms = 0.6 × półbeat`. B: `rel_fluxHmid` i udział środka pasma w paśmie pełnym, razem co najmniej 70. percentyl w utworze. C: flaga A lub B, albo skok `tv_jump`/`chroma_change` z 85. percentyla przy flagowanym B na poziomie 50. percentyla.
- V26: momenty Normal v26 jako piąty wariant ślepy, żeby padło też „czy lepiej niż dziś”. Na H&D z `.mewbeat-debug/backup-v26/hopes-and-dreams-normal.json`.
- Odniesienia jawne, nieślepe: Easy v26 na wszystkich utworach i Normal człowieka na utworach z `train`.
- Etykiety to losowa permutacja cyfr 1–5, inna na każdym utworze, ustalone ziarno. Ocena z jednego utworu nie przenosi się na następny.

- [ ] `test_select.py`, asercje: (a) flagowane przekraczające budżet: odpada najsłabsza wg `base`, nie ostatnia w czasie; (b) flagowanych za mało: dopełnienie trafia na beat lub półbeat przed resztą; (c) nigdy poniżej `min_gap_ms`; (d) liczba wybranych nie przekracza budżetu; (e) brak flag daje ranking `base`. Uruchomić, oczekiwane niepowodzenie.
- [ ] Napisać `select` i uruchomić testy w obrazie `mewbeat-ma`, oczekiwane zaliczenie.
- [ ] Napisać resztę `build_variants.py`, uruchomić na czterech utworach. Na utworach spoza `feat/` policzyć cechy przez `extract.py`.
- [ ] `REPORT.md`: dla każdego utworu liczba momentów, udział flagowanych, procent beat i półbeat, pokrycie każdej pary wariantów; na H&D udział flagowanych w każdej części (0–20, 20–22, 22–45, 45–67, 67–79, 79–90, 90–112 s). Raport nie zdradza permutacji.
- [ ] Warunek rozróżnialności: A, B, C pokrywają się z K najwyżej w 85%. Gdy więcej, zaostrzyć próg i odnotować zmianę w raporcie.
- [ ] Commit: `chore(mewbeat): build the blind foreground variants for the listening test`.

### Task 3: Strona próby słuchowej

**Files:**
- Create: `scripts/mewbeat-debug/public/listen.html`, `scripts/mewbeat-debug/public/listen.js`
- Modify: `scripts/mewbeat-debug/server.mjs` (trasy `/api/listening` i `/api/listening/<song>`)

**Interfaces:**
- Consumes: pliki z taska 2; `decodeAudio`, `Player` z `public/audio.js`; `/audio/<audioId>`.
- `listen.js` dziedziczy po `Player` i nadpisuje `blip`, żeby kliknięcia szły przez osobny `GainNode`. `audio.js` bez zmian.

- [ ] Trasy: `<song>` tylko z `index.json`; test ręczny `curl`: `/api/listening/..%2F..%2Flistening-key` daje 404.
- [ ] Strona: wybór utworu; przycisk grania i pauzy; duży bieżący czas; przyciski wariantów 1–5 i odniesień, klawisze 1–7, przełączenie przez `player.tracks = [...]` i `player.resetSchedule()`; klikany pasek postępu z momentami aktywnego wariantu i granicami części; ±5 s; suwaki głośności muzyki i kliknięć; postęp pobierania i komunikat błędu. Układ działa przy 375 px bez poziomego przewijania.
- [ ] Sprawdzenie w przeglądarce (`preview_start` `mewbeat-debug`): `/listen.html` ładuje H&D, `read_console_messages` bez błędów, po przełączeniu wariantu liczba momentów na pasku się zmienia, przy 375 px `document.documentElement.scrollWidth <= 375`. Jeden screenshot `scale: 0.5`.
- [ ] Commit: `chore(mewbeat): a debugger page to switch foreground variants while listening`.

### Task 4: Oddanie próby i stop

**Files:** bez zmian w kodzie.

- [ ] Sprawdzić, że tunel debuggera odpowiada na `/listen.html` przez adres publiczny.
- [ ] Wysłać użytkownikowi link, sposób użycia i pytanie: który wariant na każdym utworze idzie za tym, co słychać z przodu, i gdzie się myli (czas). Nie zdradzać klucza.
- [ ] Zatrzymać się. Po odpowiedzi odsłonić klucz, dopisać wynik do `REPORT.md` i zastosować regułę ze specyfikacji: wygrywa detektor → etap 2; K równie dobry → detektor odpada; nikt dobry → decyzja o cięższej analizie.
