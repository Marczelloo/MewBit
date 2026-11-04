# Co przewiduje moment nuty

Pomiary do `docs/superpowers/specs/2026-11-04-mewbeat-music-first-charts-design.md`. Wnioski są w `RESULTS.md`, logi obok skryptów.

Uruchamiane w obrazie `mewbeat-ma`: `/repo` to repozytorium tylko do odczytu, `/scripts` to ten katalog. `extract.py` zapisuje cechy do `/scripts/feat` (126 MB, poza gitem), `run.sh` puszcza całość.

`hd_lead.py` naśladuje bramki `PitchTracker` na Hopes and Dreams, a `listening/` zawiera próbę słuchową z etapu 1.
