# mewbeat — Layered, musical charts (with holds)

Date: 2026-11-01. Status: awaiting review.
Branch: `feat/mewbeat` (same rules as the main spec: no merge to `main` until the whole feature is done; test on local Docker, not the Pi).
Parent spec: `docs/superpowers/specs/2026-10-31-mewbeat-rhythm-game-design.md`. This document **replaces** its "Musicality rules" and "Difficulty rules" subsections (under *Chart generation: bot side*) and extends its *Analysis*, *Chart format* and *Gameplay rules*. Everything else in the parent spec stands.

## Intent

The first live test (2026-11-01, K/DA "WATCH ME") worked technically, but the chart did not feel like the song. The user's words: playing should feel **as if you were actually playing the track**, and after a few bars the pattern should **come to your hands by itself**. Random-feeling notes are "always mediocre"; rhythm that locks into the music is what makes it fun. Repeated parts of a song (choruses, recurring riffs) must repeat their patterns, because that repetition is what you learn and enjoy.

Why the current charts miss it (found while reviewing): the plugin only reports onsets in 4 frequency bands, tempo, energy and sections. The generator snaps those onsets to the beat grid, picks them by signal strength, takes the lane from the band, and breaks ties with a seeded RNG. It does not know whether a note is a kick, a snare, a bass note or a sung syllable, it never repeats a pattern on purpose, and it has no sustained notes. Research on community mapping practice (osu!mania mapping guide and wiki "Layer" page, BSMG/ScoreSaber Beat Saber criteria) and on auto-charting (Dance Dance Convolution) points at the same gaps: auto-charts pick onsets by strength, land on the wrong instruments and lose the rests and density changes human mappers build.

### Success looks like

- On the test set below, the user plays a chart and says it feels like playing the song: you can tell which part you are playing (the beat, the bass, the vocal), and a chorus plays the same the second time.
- The preview tool (`scripts/mewbeat-preview.mjs`, clicks mixed over the track) sounds like someone "playing along", not like a random clicker.
- Easy is playable by a newcomer; Hard is a fuller version of the same musical idea, not Normal plus noise.

## Goals

1. **Layer-aware analysis** in the Lavalink plugin: separate percussive from tonal content and report musical events per layer (kick, snare, hi-hat; bass line; lead line = vocals or main melody), with pitch and duration for tonal events.
2. **Repetition detection**: find which beat-aligned phrases of the song repeat earlier ones (choruses, recurring riffs).
3. **A new generator** that, per phrase, follows one leading layer, maps it to lanes by consistent rules (same sound → same lane pattern; melody contour → lane movement), copies the pattern of an earlier phrase when the music repeats, and derives Easy/Normal/Hard as subsets of the same musical idea.
4. **Hold notes** (long notes) for sustained sounds, end to end: chart format, generator, highway rendering, input, judging, scoring, autoplay, end card counts.
5. **No randomness in lane choice.** Determinism stays (same features + generator version + difficulty → same chart), and no RNG decides musical choices.

## Non-goals

- No ML / neural source separation (Demucs, Spleeter, etc.). It cannot run within the Pi budget. Layers are detected approximately with classic DSP; the design must degrade gracefully when a layer is unclear.
- No new screens (lobby, song select, results): those stay in plans 3 and 4.
- No manual chart editor and no user-uploaded charts.
- No changes to judgement windows, base points, vibe/FEVER rules for tap notes.
- No tempo-change (variable BPM) support beyond what the current beat tracker already gives.

## Anti-goals — failure even if it "works"

1. **Notes that feel random** — lanes jumping without a musical reason, rhythm that does not lock to an audible part.
2. **A repeated chorus that plays differently** the second time (when the music is the same).
3. **Following everything at once** — a note on every onset of every instrument, so no part is recognisable.
4. **Holds that don't match a sustained sound**, or holds that make a hand-crossing mess on lower difficulties.
5. **A Pi that stutters** while analysing (hard requirement from the parent spec still applies).

## Test set (from the user)

Tune and judge on these; they cover pop vocals, heavy electronic and very fast rhythm-game music:

- K/DA: "FIRESTARTER" (as named by the user), "WATCH ME", "MORE".
- Rhythm-friendly electronic remixes / game music: Camellia tracks (high BPM — watch for half/double tempo errors), "Coffin Dance" (Astronomia remix), "Rude Buster" (Deltarune), "Megalovania" (Undertale).
- At least two anime openings (builder picks well-known ones).

## Decided design

### 1. Analysis (Lavalink plugin, `lavalink-plugins/mewbeat/`)

Keep the current streaming decode (24 kHz mono), tempo/beat tracker, energy curve, sections and highlight. Add:

- **Harmonic/percussive split** of the spectrogram (median-filter HPSS or equivalent), done in a streaming way with a bounded frame delay — the audio itself is still never retained.
- **Percussive layer → drum events**: `kick`, `snare`, `hat` onsets, each with time (ms) and strength (0–1). Classified by the spectral shape of the percussive part around the onset (low-band thump / mid-band noise burst / high-band tick). Unclassifiable percussive onsets may be reported as `perc`.
- **Tonal layer → two note lines**, each a list of `{ t, len, pitch, s }` (ms, ms, MIDI-like float or semitone, strength):
  - `bass`: the dominant pitch in roughly 30–250 Hz;
  - `lead`: the most salient pitch above that (vocals or lead instrument), e.g. via harmonic-sum pitch salience with a voicing confidence; unvoiced stretches produce no notes.
  A tonal note starts at a pitch change or a re-attack and ends when the pitch drops out or changes; `len` is what lets the generator make holds.
- **Beat-synchronous chroma** (12 values per beat) and **repetition map**: phrases are beat-aligned blocks (default 4 bars, using the downbeats; fall back to 16 beats). Each phrase gets `repeatOf` = index of the earliest earlier phrase that matches it closely enough (chroma + rhythm self-similarity), or `null`, plus the similarity score. Short slips (a phrase starting a bar early/late) should still match.
- **Per-layer activity per phrase**: how present each layer is (e.g. drum event density and strength, lead voicing ratio), so the generator can pick a leading layer without re-deriving it.
- Keep `bands` in the output for compatibility and as a fallback.
- **Confidence everywhere**: each tonal note carries a voicing/pitch confidence and each phrase a per-layer confidence, so the generator can treat a layer as absent (dense pop/EDM mixes will often give a poor `lead`).
- **Downbeats**: phrases depend on them, so improving the downbeat estimate is in scope when the test set shows it is off. When downbeat confidence is low, the phrase grid's offset is chosen by the self-similarity itself (the offset that makes repeats line up best). *My call.*
- **Bump `featuresVersion` to 2.** Cached v1 feature files are re-analysed on demand.
- **Pi budget unchanged**: one job at a time, minimum priority, < 20 s for a 3–5 min track on the Pi, no audible stutter. On the PC the current job takes ~2 s of DSP for a 3 min track; the new analysis may cost more but must still reach `realtimeFactor ≥ 20` on the PC (the Plan 1 gate). The Pi benchmark gate from Plan 1 (not run yet) must be run with the new analysis before the branch is called done.
- **Cost knob** (*my call*): the expensive stages (HPSS, pitch salience, self-similarity) get a config-selectable lighter tier (e.g. lower pitch frame rate, smaller kernels), so a Pi miss can be fixed by configuration. If even the light tier misses the Pi budget, stop and come back to the user (same rule as the parent spec's spike gate).

### 2. Chart generation (bot, `helpers/mewbeat/charts/`)

Order of decisions, per difficulty:

1. **Phrases**: take the plugin's phrase list. If it is missing (no confident tempo), fall back to fixed-length windows on the energy sections and skip repetition copying.
2. **Leading layer per phrase**: choose among `drums`, `bass`, `lead` by layer activity and confidence. **Fallback order** (*my call*): a tonal layer below its confidence threshold counts as absent → drums lead; if the drums are weak too, the phrase uses the band-onset path (today's v3 logic, kept in the code but without the RNG). Choose, with hysteresis so the choice only changes at phrase boundaries and not every phrase (switching at section changes is good — it's the "contrast" mappers use; flickering is not). Vocals usually lead choruses and verses; drums lead intros, breaks and drops without vocals. A phrase that repeats an earlier one inherits that phrase's leading layer.
3. **Pattern for a new (non-repeat) phrase**:
   - **Drums**: fixed lane roles for the whole song section, so the same drum always lands in the same place: e.g. kick → outer lanes, snare → inner lanes, hats only on Hard and only as fill; a two-lane alternation within a role is decided by position in the bar, not by chance.
   - **Bass / lead**: lanes follow the pitch contour inside the phrase (higher → right, lower → left), quantised to the phrase's own pitch range; a repeated pitch stays on the same lane while slow, and turns into a trill on the two neighbouring lanes when fast enough to be an uncomfortable jack. Runs in one direction become stairs.
   - **Holds**: a tonal note with `len` ≥ a difficulty-dependent minimum (in beats) becomes a hold in its lane. The free hand may get notes from the secondary layer only on Normal/Hard.
   - **Chords**: on strong downbeats and phrase/section starts only (emphasis), never 3+.
4. **Repeat phrase**: if `repeatOf` is set and the similarity is high, **copy the source phrase's pattern** shifted to the new start time (notes, lanes, holds), then drop/keep notes only where the onsets of this phrase clearly differ. Difficulty filtering is applied after copying, so a repeat stays a repeat on every difficulty.
5. **Difficulty = how much of the idea you play** (starting points, tuned by ear):

   | | Easy | Normal | Hard |
   |---|---|---|---|
   | Follows | leading layer's main accents only (on-beat / strongest) | most of the leading layer | the full leading layer + secondary layer in high-energy phrases |
   | Max grid | 1/2 beat | 1/4 beat in high-energy phrases | 1/4 beat throughout, rare 1/8 on very strong events |
   | Holds | ≥ 1 beat, nothing else during a hold | ≥ 1/2 beat, other hand at ≤ 1/2-beat notes | ≥ 1/2 beat, other hand free |
   | Chords | none | 2-note on strong downbeats | 2-note; never 3+ |
   | Jacks | none | short (≤ 2) | ≤ 3, only on identical repeated sounds |

   **Hands** are lanes 0–1 (left) and 2–3 (right). Easy's "nothing else during a hold" means no notes in any lane.

   **Absolute floors and tempo folding** (*my call*): the beat-based grid is always capped by millisecond floors per difficulty (the current `minLaneGapMs` / `minNoteGapMs` idea, plus a max notes/s), so a 220 BPM Camellia track cannot make Easy a stream. Before charting, a tempo outside roughly 70–200 BPM is folded by halving/doubling for the grid (the beat tracker's raw BPM is kept in the features).

6. **Keep** from the current generator: lead-in before the first note, no notes in near-silence, density following the energy curve, star rating (extend `stars.js` to count holds), determinism, `MIN_NOTES` → "not chartable".
7. **Remove the RNG** from musical decisions. If a genuine tie remains, break it by a fixed rule (e.g. prefer the lane that balances the hands over the last bar).
8. **Bump `GENERATOR_VERSION` to 4.** The existing chart store already drops files of other versions; no leaderboards exist yet, so nothing is lost.

### 3. Chart format

Notes become `{ t, lane, len? }`. `len` (ms, > 0) marks a hold; a missing `len` is a tap — v3-style charts stay readable. Everything else in the parent spec's format stands.

### 4. Holds in the game (`activity/src/mewbeat/`)

- **Highway**: a hold is drawn as the note head plus a tail in the lane colour up to its end; while held, the tail is consumed at the receptor; a dropped hold greys out.
- **Judging** (*my call*, matching common 4K practice):
  - The **head** is judged exactly like a tap (same windows, points, combo, vibe).
  - The **tail** is judged on release: releasing within the GOOD window × 1.5 before the end, or any time after it, counts; holding past the end auto-completes at the end. Releasing earlier is a **drop**: the tail counts as MISS (combo reset, vibe −0.06), and the rest of the hold is dead.
  - Tail judgement: PERFECT/GREAT/GOOD by release error with windows × 1.5, base points as for taps; a missed head means the tail is also a MISS.
  - Otherwise the **tail behaves exactly like a tap judged at release time** (*my call*): it adds to combo, gains vibe by its judgement, and is scored with the multiplier and FEVER state at the moment it is judged.
  - Accuracy counts head and tail as two judgements. The end card shows the same four counts (heads and tails together).
- **Autoplay** holds through the full length.
- **Hit sounds**: the existing hit sound on the head only.
- Ghost taps and key repeat behave as today; a key that is already held when a hold head arrives does not count for it.

### 5. Verification

- **Unit tests (Java)**: the existing `Synth` test helper grows synthetic kick/snare/hat patterns, a bass line and a sung-like lead (harmonic tone with vibrato) so each detector is tested for timing (±10 ms), class and pitch; a synthetic song with an A-B-A-B structure must produce `repeatOf` for the second A and B.
- **Unit tests (Node)**: determinism; a repeated phrase gets an identical pattern (shifted) on every difficulty; no randomness (two different `audioKey`s with the same features give the same chart); hold rules per difficulty; Easy never has chords/jacks; tap-only v3 charts still play.
- **Game tests**: hold judging (head, early release, release after end, missed head), autoplay holds, scoring/accuracy with holds.
- **Measurable proxies** (*my call*), printed by the preview tool per track so each tuning round has numbers, not only ears: share of notes that sit within ±20 ms of a detected layer event; for every phrase with `repeatOf`, how identical its pattern is to the source (target: identical unless the onsets differ); lane balance per hand; notes/s per difficulty against the floors.
- **Audio for the test set**: through the local Docker Lavalink with normal search (YouTube works locally; Spotify creds there are invalid). No audio is committed to the repo.
- **Loop**: the builder runs the proxies and the preview renders; the user judges by ear between tuning rounds and plays the final round live in Discord.
- **By ear**: the preview tool renders the test set; holds are audible in the preview (a sustained tone or a second click on release — builder's choice). The user then plays the test set live in Discord.

## Left to the builder

- Exact DSP methods and parameters (HPSS kernel sizes, drum classification features, pitch salience method, chroma/self-similarity thresholds, phrase length fallback), as long as the budget and tests hold.
- The exact layer-activity measure and the hysteresis rule for the leading layer.
- Exact lane-role tables for drums and the pitch-to-lane quantisation.
- Tuning numbers in the difficulty table (they are starting points; Easy-for-newcomers and Hard-is-different are not negotiable).
- How holds look in detail (within the mockup v3 visual language) and how the preview tool sonifies them.
- The features JSON field names, as long as `featuresVersion` is 2 and `bands` stays.
- Order of work. Suggested: synthetic test signals → plugin layers → repetition map → generator v4 with taps only → holds in format/generator → holds in the game → by-ear tuning on the test set.
