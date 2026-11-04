# mewbeat: rytm, gęstość, tory i holdy na Normal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nowy Normal, który wybiera nuty z muzyki rankingiem, ma gęstość zależną od fragmentu, czytelne tory i holdy zgrane z przeciąganymi dźwiękami, przy Easy, Hard i Hell identycznych z v26.

**Architecture:** Normal dostaje nową ścieżkę `selector: "music"` w `chartNotes`. Stary Normal liczy się dalej jako wewnętrzny poziom `normalV26`, z którego tnie Easy. Etap pomiarów rozstrzyga progami podanymi z góry, czy potrzebny jest plugin i Features v5. Domyślnie nie jest.

**Tech Stack:** Node CommonJS (`helpers/mewbeat/charts/`), `node:test`, Python w obrazie `mewbeat-ma` (tylko pomiary), bez ML w produkcji.

**Spec:** `docs/superpowers/specs/2026-11-04-mewbeat-music-first-charts-design.md` (etapy 2–5). Pomiar holdów: `mapping-analysis/salience/holds/REPORT.md`. Reguły: `mapping-analysis/shared/mania-patterns.md`.

## Global Constraints

- Easy, Hard i Hell mają nuty i holdy identyczne z v26 aż do etapu 6, który ma osobny plan po grze użytkownika.
- `GENERATOR_VERSION`: 27 po taskach 3–4, 28 po tasku 5, 29 po taskach 6–8. Tag `mewbeat-gen-v26` zostaje punktem powrotu.
- Stroimy tylko na `train`. 20 testowych dopiero na koniec etapu, każdy przebieg z wpisem w `mapping-analysis/TEST_USAGE.md`.
- Po każdym etapie: co zmieniono, metryki osobno Easy, Normal i Hard, testy, 3–5 fragmentów do zagrania, czego nie sprawdzono.
- Liczby ludzi to punkt odniesienia, nie cel. Udział nut na samej perkusji to kontrola: w częściach melodyjnych H&D nie może wzrosnąć.
- Trudność Normal nie rośnie: mediana naszych gwiazdek na `train` ok. 5,0, nuty/s ok. 6,1. F1 momentów Normal nie poniżej .72 bez wyjaśnienia.
- `pnpm test` przechodzi po każdym tasku. Produkcja działa na Pi, nowe sygnały dokładają najwyżej 20% do czasu analizy.
- Commit etapami na `feat/mewbeat`, stage po jawnych ścieżkach, bez push i merge. Nie commitować `.impeccable/config.json`, `helpers/lavalink/application.yml`, jarów.
- Stemy Demucs tylko jako wzorzec offline, nie w generatorze.

## Review Focus

1. Utwór z niską pewnością tempa albo bez siatki taktu: Normal nadal ma sensowne nuty i co najmniej `MIN_NOTES` (test w tasku 3).
2. Cichy wstęp i fraza prawie bez onsetów: zero nut w ciszy, a nuta bez dźwięku tylko dla ciągłości pulsu w grającym fragmencie (test w tasku 3).
3. Cechy bez `lead`, `bass` albo `drums`, np. niższy `analysisTier`: Normal i `sustains` działają bez wyjątku (testy w taskach 3 i 7).
4. Stary chart v26 w `chartStore` po podbiciu wersji przelicza się, a dwa przebiegi na tych samych cechach dają te same nuty (test w tasku 3).
5. Hold kończy się za końcem utworu, nuta pod holdem trafia w jego tor albo przy akordzie wymaga trzech palców: `normalViolations` to zgłasza, a generator tego nie robi (testy w taskach 5 i 6).

---

### Task 1: Bariery, bez zmiany nut

**Files:**
- Modify: `helpers/mewbeat/charts/difficulty.js`, `helpers/mewbeat/charts/generate.js`, `mapping-analysis/salience/holds/measure.py`
- Create: `tests/helpers/mewbeat/chartV26Identity.test.js`, `tests/helpers/mewbeat/fixtures/v26-notes.json`, `scripts/mewbeat-debug/compare-v26.mjs`

**Interfaces:**
- Produces: `INTERNAL_LEVELS.normalV26` (kopia dzisiejszego Normal, `cutFrom: "hard"`); `levelOf(name)` zamiast bezpośredniego `DIFFICULTIES[name]` w `generate.js`; Easy ma `cutFrom: "normalV26"`. `DIFFICULTIES` i `generateAll` nadal mają tylko cztery publiczne poziomy.
- Produces: `node scripts/mewbeat-debug/compare-v26.mjs [--levels easy,hard]` liczy poziomy z `.mewbeat-debug/data/features/` i porównuje z migawkami `charts/v26` oraz `charts/v26-hd`, bez pola `version`.
- Produces: `measure.py --charts <wersja>` drukuje tabelę holdów i udział „tylko perkusja” dla dowolnej migawki.

- [ ] **Step 1:** Skrót nut Easy, Hard i Hell na cechach z `fixtures.js` zapisać do `v26-notes.json`, jeszcze na niezmienionym kodzie.
- [ ] **Step 2:** Test `easy, hard and hell notes stay identical to v26`: skróty sha1 z `generateChart(...).notes` równe plikowi. Test `generateAll exposes only public levels`.
- [ ] **Step 3:** Wprowadzić `normalV26` i `levelOf`. Test przechodzi, a do tego Normal wciąż równy `normalV26`.
- [ ] **Step 4:** `compare-v26.mjs` na 80 `train` + H&D: oczekiwane 0 różnic. Inny wynik: stop, wyjaśnić przed dalszą pracą.
- [ ] **Step 5:** `pnpm test`, commit: `chore(mewbeat): keep the v26 Normal internal and pin Easy and Hard to v26`.

### Task 2: Pomiary, które rozstrzygają, czy trzeba ruszać plugin

**Files:**
- Create: `mapping-analysis/salience/density/` (`rel_proxy.py`, `phrase_density.py`, `sustain_cheap.py`, `export_weights.py`, logi, `REPORT.md`), wiersz w `mapping-analysis/salience/README.md`

**Interfaces:**
- Consumes: cechy `$S/salience/feat/*.pkl`, `.mewbeat-debug/data/features`, `human`, `stems/_sust`.
- Produces: `REPORT.md` z decyzjami A, B, C i współczynniki K dla tasku 3.

Progi są ustalone przed wynikiem i nie zmieniają się po nim:

| | Pytanie | Decyzja |
|---|---|---|
| A | Czy siła onsetu z Features v4 względem średniej z ok. 2 s zastępuje `rel_os`? | AUC K z zastępnikiem ≥ AUC K z `rel_os` − .01 na każdym z trzech poziomów: bez `rel_os` w pluginie |
| B | Co tłumaczy gęstość frazy u ludzi na Normal (R² w walidacji po utworach)? | Części utworu wchodzą, gdy dokładają ≥ .02 R² ponad liczbę wyrazistych dźwięków + głośność |
| C | Czy tani detektor przeciąganego dźwięku bije obecny? Dłuższe okno HPSS, stabilność chromy z tolerancją wibrata, kanał środkowy | Wchodzi przy AUC ≥ .72 lub precyzji ≥ .15, pokryciu ≥ .35 i koszcie w limicie 20%. Inaczej zostaje `lead` + `bass` bez progu pewności |

- [ ] **Step 1:** Zapisać progi w `REPORT.md` i zacommitować przed pierwszym przebiegiem.
- [ ] **Step 2:** Uruchomić A, B i C na 80 `train`; wpisać wynik i decyzje.
- [ ] **Step 3:** `export_weights.py` zapisuje współczynniki K, według decyzji A na `rel_os` albo na zastępniku.
- [ ] **Step 4:** Commit: `chore(mewbeat): measure what density and moments need from the plugin`.
- [ ] **Step 5:** Jeśli A, B lub C wymaga pluginu: stop. Podać użytkownikowi, co daje zmiana i ile kosztuje (jar, ponowna ekstrakcja), a etap 2 zaplanować osobno. Inaczej krótka notka i dalej.

### Task 3: Normal, ocena i wybór nut

**Files:**
- Create: `helpers/mewbeat/charts/selection.js`, `helpers/mewbeat/charts/momentWeights.js`, `tests/helpers/mewbeat/chartSelection.test.js`
- Modify: `helpers/mewbeat/charts/generate.js`, `helpers/mewbeat/charts/difficulty.js` (`normal.selector: "music"`, wersja 27), `helpers/mewbeat/charts/trace.js`

**Interfaces:**
- Consumes: `momentWeights` z tasku 2, `sortedOnsets`, `metricLevel`, `strengthAt` z `rhythm.js`.
- Produces: `scoreMoments(ctx, level) -> [{t, s, score, metric}]`, zapamiętane na `ctx`; `phraseBudget(phrase, ctx, diff) -> number`; `selectMoments(phrase, scored, budget, diff, timing) -> [{t, s, reason, source}]`, gdzie `reason` to `"ocena" | "dopełnienie" | "puls"`.

Kolejność w `selectMoments`: najlepsze według oceny do budżetu z minimalnym odstępem z `diff`; luka ponad 2 beaty, w której coś brzmi, wymienia najsłabszą nutę na mocne miejsce; niedobór idzie na beaty i półbeaty z dźwiękiem w przerwach; nuta bez dźwięku tylko dla pulsu. Budżet to górna granica, a nie norma do wypełnienia. `fillRests` i `withBeats` nie działają przy `selector: "music"`.

- [ ] **Step 1:** Testy: `scores use the sound and the place in the bar`; `a stronger moment beats a weaker one on the same beat level`; `over budget drops the weakest, keeps downbeats`; `under budget fills beats where something sounds, never the silence`; `no sound means no notes` (ognisko 2); `low tempo confidence still gives a chart` (ognisko 1); `features without lead, bass or drums still give a chart` (ognisko 3); `same features give the same notes` i `a stored v26 chart is recomputed` (ognisko 4).
- [ ] **Step 2:** Sprawdzić, że nie przechodzą.
- [ ] **Step 3:** Napisać `selection.js`. `phraseBudget` według modelu z decyzji B, skalowany tak, by rozkład gęstości między utworami z `train` był podobny do ludzkiego. Puls: waga beatu w K jest stała dla Normal i ma dać udział beatów z nutą bliżej .92 ludzi niż .76 z v26, bez dokładania gęstości.
- [ ] **Step 4:** Wpiąć w `chartNotes`, gdy `diff.selector === "music"`. Powód wyboru trafia do śladu w debuggerze.
- [ ] **Step 5:** `pnpm test` i `compare-v26.mjs --levels easy,hard` (0 różnic), commit: `feat(mewbeat): Normal picks its notes from the music`.

### Task 4: Normal, powtórki i oddanie etapu 3

**Files:**
- Modify: `helpers/mewbeat/charts/selection.js`, `helpers/mewbeat/charts/repeats.js`, `helpers/mewbeat/charts/generate.js`, `scripts/mewbeat-debug/export.mjs`
- Test: `tests/helpers/mewbeat/chartSelection.test.js`

**Interfaces:**
- Produces: `repeatPlan(phrase, source, ctx, diff) -> { copy: boolean, extra: number }`. Powtórka bez zmiany głośności kopiuje rytm i tory, głośniejsza dokłada `extra` nut z rankingu ponad kopię, a rzadkie źródło nie jest kopiowane na głośną sekcję.

- [ ] **Step 1:** Testy: `same loudness copies rhythm and lanes`; `a louder repeat adds notes above the copy`; `a sparse phrase is not copied onto a loud section`.
- [ ] **Step 2:** Napisać, uruchomić testy, commit: `feat(mewbeat): louder repeats of Normal add notes above the copy`.
- [ ] **Step 3:** Przebieg korpusu `run_pipeline.py --algo-splits train`, `level_distance.py --split train`, `grid_quality.py`; migawka v27 w `export.mjs`, restart bota z całym drzewem procesów.
- [ ] **Step 4:** Raport: F1 Normal, gęstość (mediana, CV ok. .2, korelacja z głośnością ok. .4), powtórka ok. ×1,15, beaty z nutą, nuty bez dźwięku, naruszenia (jeszcze niewymagane), `measure.py --charts v27`, tabela E/N/H.
- [ ] **Step 5:** **Stop: gra użytkownik.** Tory jeszcze stare, słucha rytmu i gęstości. Fragmenty: H&D 0:22–0:45, 0:45–1:07, 2:26–2:48; Mizuoto 0:12; Flower Dance. Dalej tylko po decyzji użytkownika.

### Task 5: Normal, tory i reguły grywalności

**Files:**
- Create: `helpers/mewbeat/charts/laneRules.js`, `tests/helpers/mewbeat/chartLaneRules.test.js`
- Modify: `helpers/mewbeat/charts/lanes.js`, `helpers/mewbeat/charts/difficulty.js` (`normal.melodyLanes: true`, wersja 28)

**Interfaces:**
- Produces: `normalViolations(notes, timing) -> [{ rule, t, lane }]`. Reguły z RC: anchor poniżej 3, brak minijacków 1/4, najwyżej 5 kolejnych 1/4, akord najwyżej 2, hold co najmniej ½ beatu, pod holdem ½ nic, pod holdem 1/1 nic szybszego niż 1/2, nuta nie na torze trwającego holda, hold w granicach utworu (ognisko 5).
- Produces: `melodyDirection(ctx, t) -> -1 | 0 | 1 | null`: `lead` lub `bass` przy wysokiej pewności, inaczej środek widma z pasm `onsets`, `null` gdy niepewne.

- [ ] **Step 1:** Testy po jednym przypadku na regułę, także `a clean chart has no violations`.
- [ ] **Step 2:** Testy `assignLanes`: `a rising run becomes stairs`; `a repeated sound becomes a trill or a jack within limits`; `null direction keeps the v26 grammar`; `same phrase repeated gets the same lanes`.
- [ ] **Step 3:** Napisać `laneRules.js`, dodać kierunek do `assignLanes` przy `diff.melodyLanes`. Naruszenia po wyborze torów poprawia przesunięcie na inny tor, a usunięcie nuty jest ostatecznością.
- [ ] **Step 4:** `normalViolations` na 80 `train` i H&D: oczekiwane **0**. Równowaga rąk i rozkład kroków w raporcie, porównane z ludźmi.
- [ ] **Step 5:** `pnpm test`, `compare-v26.mjs` (0 różnic), commit: `feat(mewbeat): Normal lanes follow the melody within the ranking rules`.

### Task 6: Normal, budowa holdów

**Files:**
- Modify: `helpers/mewbeat/charts/holds.js`, `helpers/mewbeat/charts/lanes.js`, `helpers/mewbeat/charts/difficulty.js` (nowe pola tylko na Normal)
- Create: `tests/helpers/mewbeat/chartHoldsUnder.test.js`

**Interfaces:**
- Consumes: `normalViolations`.
- Produces: `diff.holdRelease: "free"`, `diff.underHold: true`. Bez tych pól `settleHolds` i `longRelease` działają jak w v26.

Hold nie puszcza się już z automatu na następnym momencie: koniec wynika z długości dźwięku, a bez dźwięku z dostępnej przerwy na siatce. Nuty pod holdem to istniejące momenty przeniesione do drugiej ręki, bez dokładania momentów ponad budżet.

Punkty odniesienia Normal (ludzie / v26): udział holdów .118/.088, ≥1,5 beatu .171/.104, z nutą pod spodem .147/.042, nut pod holdem .278/.053, puszczenie na następnym momencie .771/.942.

- [ ] **Step 1:** Testy: `a hold can outlast the next moment`; `notes under a hold go to the other hand`; `a half beat hold has nothing under it`; `a one beat hold has nothing faster than a half beat under it`; `a hold ending past the song end is clipped`; `under holds adds no moments`.
- [ ] **Step 2:** Napisać, zdjąć ograniczenie `spacedBlocked` na rzecz reguł z RC na Normal, podnieść `maxHoldShare` i `gapHoldShare`, jeśli pomiar pokaże, że trzymają udział poniżej ludzi.
- [ ] **Step 3:** `normalViolations` na `train` nadal 0, `measure.py` wykazuje zbliżenie do ludzi, a gwiazdki Normal nie rosną.
- [ ] **Step 4:** `pnpm test`, `compare-v26.mjs` (0 różnic), commit: `feat(mewbeat): Normal holds carry notes and end with the sound`.

### Task 7: Normal, holdy na przeciąganych dźwiękach i ciągniętym wokalu

**Files:**
- Create: `helpers/mewbeat/charts/sustains.js`, `tests/helpers/mewbeat/chartSustains.test.js`
- Modify: `helpers/mewbeat/charts/holds.js`, `helpers/mewbeat/charts/legato.js`

**Interfaces:**
- Consumes: decyzja C z tasku 2.
- Produces: `sustainsOf(features, timing) -> [{ t, len, source, conf }]`. Sklejone `lead` i `bass` bez progu pewności, albo pole z pluginu, jeśli decyzja C tak wskaże; pusta tablica przy braku warstw (ognisko 3).

To preferencja, a nie reguła: wśród kandydatów na długi hold wygrywa ten, który trafia w przeciągany dźwięk i kończy się z nim. Fałszywy alarm oznacza hold na przerwie, czyli nie gorzej niż dziś. Jeden wykryty dźwięk może też zamienić tap na hold, jeśli nie łamie reguł.

Progi przed wynikiem: na H&D w 0–112 s Normal trzyma co najmniej 6 z 16 przeciąganych dźwięków (dziś 1), a długi hold leży na trwającym dźwięku co najmniej 3× częściej niż placebo na `train` (ludzie 3,8×, v26 2,5×). Stemy służą tu wyłącznie do tej oceny.

- [ ] **Step 1:** Testy: `sustains merge a dragged note`; `no melodic layers means no sustains`; `a long hold prefers a sustained sound`; `a hold ends with the sound it follows`; `a false sustain still respects the rules`.
- [ ] **Step 2:** Napisać, wpiąć w `addGapHolds` i `addSustainHolds` tylko przy `diff.holdRelease === "free"`.
- [ ] **Step 3:** `measure.py` z progami. Niespełniony próg: wpisać, co zabrakło i powiedzieć wprost w raporcie; progu nie obniżać.
- [ ] **Step 4:** `pnpm test`, `compare-v26.mjs` (0 różnic), commit: `feat(mewbeat): long Normal holds follow sustained sounds`.

### Task 8: Normal, akordy i oddanie etapu 5

**Files:**
- Modify: `helpers/mewbeat/charts/chords.js`, `helpers/mewbeat/charts/difficulty.js` (wersja 29), `scripts/mewbeat-debug/export.mjs`, `mapping-analysis/TEST_USAGE.md`
- Test: `tests/helpers/mewbeat/chartLanes.test.js`

**Interfaces:**
- Produces: `diff.maxChordsPer8Beats`, sprawdzane w `planChords`. Pierwszeństwo mają starty części i akcenty.

- [ ] **Step 1:** Testy: `chords stay under the local limit`; `a section start keeps its chord`. Wartość limitu z rozkładu ludzi na `train`; Mizuoto 0:12 ma zejść z 24 w stronę 9.
- [ ] **Step 2:** Napisać, `pnpm test`, commit: `feat(mewbeat): Normal chords follow accents under a local limit`.
- [ ] **Step 3:** Pełny przebieg `train`, migawka v29, kontrola na 20 testowych z wpisem w `TEST_USAGE.md`, restart bota i tunel.
- [ ] **Step 4:** Raport: metryki E/N/H, `normalViolations`, tabela holdów, „tylko perkusja” na H&D względem v26, testy, czego nie sprawdzono.
- [ ] **Step 5:** **Stop: gra użytkownik.** Fragmenty: skrzypce H&D 0:03, 0:05, 0:09, 0:13, 0:16; gitara 0:23, 0:49, 0:55; wokal 2:37, 3:03; Mizuoto 0:12; Yoru ni Kakeru. Przeniesienie na Easy i Hard (etap 6) dostaje osobny plan po tej grze.
