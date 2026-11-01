# mewbeat Layered Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mewbeat charts follow an audible musical layer (drums, bass, or lead), repeat their patterns when the music repeats, contain holds for sustained notes, and use no randomness.

**Architecture:** The Lavalink plugin reports `featuresVersion` 2. On top of v1 it adds drum events (from a streaming HPSS percussive part), bass and lead note lines (harmonic-sum pitch tracking), beat-synchronous chroma, a 16-beat phrase repetition map and per-layer activity per phrase. The Node generator v4 picks a leading layer per phrase (with hysteresis), maps it to lanes with fixed rules, copies earlier phrases for repeats, and filters by difficulty, with millisecond floors and tempo folding. The Activity game judges hold heads and tails and draws tails on the highway.

**Tech Stack:**
- Java 17 plugin (Gradle in Docker, JUnit 5).
- Node 24 CJS bot (`node:test` via `npm test`).
- React 19 / Vite 8 ESM activity (tests in `tests/activity/mewbeat/`).

**Spec:** `docs/superpowers/specs/2026-11-01-mewbeat-layered-charts-design.md` (it replaces the parent spec's "Musicality rules" and "Difficulty rules").

## Global Constraints

**Branch**
- Work on `feat/mewbeat` only. Never merge to `main` and never push.

**Committing**
- Stage files explicitly by path.
- Never stage `.impeccable/config.json`, `.superpowers/`, `helpers/lavalink/application.yml`, `helpers/lavalink/plugins/*.jar` or any `.env*`.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Charts**
- No RNG in chart generation. The same features + `GENERATOR_VERSION` + difficulty always give the same chart, whatever the `audioKey`.

**Audio**
- The plugin never retains the decoded audio or a full spectrogram.
- Per-frame state is bounded. Small per-frame summaries (≤ 12 floats per pitch frame) are allowed.
- `featuresVersion` is 2 and the v1 fields stay, including `bands`.

**Performance**
- The PC gate is `realtimeFactor ≥ 20`: a 180 s track analysed in ≤ 9 s of DSP on the full tier.
- The Pi budget (< 20 s for a 3–5 min track) is checked by the user in Task 11.

**Game**
- All UI copy is English.
- Tap judgement windows, base points and vibe/FEVER rules stay unchanged.
- No zero-offset glows; honour the Effects setting and `prefers-reduced-motion`.

**Tests**
- Use `npm test` from the repo root. It must end with `ℹ fail 0`; the baseline is 828 passing.
- Java tests run with `node scripts/build-mewbeat-plugin.mjs --test`, which runs Gradle in Docker and needs Docker Desktop running.

## Review Focus

1. **Very fast or half/double-tempo tracks (Camellia, 220+ BPM).** Easy must stay a newcomer chart: no streams and never over its notes/s cap. Covered by the Task 6 test `floorsHoldAt220Bpm`.
2. **Tracks with no confident tempo, no phrases or no tonal layer** (ambient, pure drums, speech). The generator falls back to the band path and still returns a chart or `null`, never a crash. Covered by the Task 6 test `bandPathWhenNoLayers`, the Task 5 test `bandsWhenNoLayers`, and the Task 3 test `shortTrackHasNoPhrases`.
3. **A key released while input is paused (settings panel, window blur) during a hold.** The hold is dropped, not stuck "held" forever. Covered by the Task 8 test `releaseWithoutActiveHoldIsNoop` and the Task 9 pause-release wiring.
4. **A seek/jump or late join in the middle of a hold.** No hold stays active, and totals still add up. Covered by the Task 8 test `skipBeforeSkipsHoldTails`.
5. **Old data: v1 cached features and v3 tap-only charts.** v1 is re-analysed; a v3 tap chart plays exactly as before. Covered by the Task 4 test (the version flip in `analysisClient.test.js`) and the Task 8 test `tapOnlyChartUnchanged`.

---

### Task 1: Synthetic layers + HPSS + drum events

**Files:**
- Create `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/AnalysisTier.java`.
- Create `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/Hpss.java`.
- Create `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/DrumDetector.java`.
- Modify `lavalink-plugins/mewbeat/src/test/java/dev/mewbit/mewbeat/dsp/Synth.java`.
- Test `lavalink-plugins/mewbeat/src/test/java/dev/mewbit/mewbeat/dsp/DrumDetectorTest.java`.
- Test `lavalink-plugins/mewbeat/src/test/java/dev/mewbit/mewbeat/dsp/HpssTest.java`.

**Interfaces:**

Produces:
- `enum AnalysisTier { FULL, LIGHT }`
  - `static AnalysisTier parse(String s)`: case-insensitive; `null` or unknown → `FULL`.
  - `int hpssKernel()`: FULL 17, LIGHT 9. The same odd size is used for the time median and the frequency median.
  - `int pitchHop()`: FULL 512, LIGHT 1024 samples.
  - `String wireName()`: `"full"` or `"light"`.
- `final class Hpss`
  - `Hpss(int bins, int kernel)`
  - `float[][] push(float[] magnitude)`: returns `{percussive, harmonic}` for the frame `kernel/2` hops earlier, or `null` while warming up.
  - `float[][] flush()`: returns the remaining frames' pairs in order, padding with zeros.
  - Soft Wiener masks with power 2. The ring buffer holds `kernel` frames; nothing else is kept.
- `final class DrumDetector`
  - `DrumDetector(int sampleRate, int fftSize, double hopMs)`
  - `void accept(float[] percussive, int hop)`
  - `List<Features.Drum> finish()`: time-ordered.
- New record `Features.Drum(int t, double s, String kind)`. This task adds only the record; serialisation comes in Task 3. `kind` is one of `"kick" | "snare" | "hat" | "perc"`.

Synth gains:
- `addSnare(float[] buf, double at, double amp, Random r)`: a 180 Hz body for 30 ms plus band-limited noise 1–5 kHz for 120 ms.
- `addKickPattern(...)`, or plain loops in tests.
- Use `addHat` as it exists.

- [ ] **Step 1: Write failing tests.**
  - `HpssTest.toneGoesHarmonicClickGoesPercussive`: on a steady 440 Hz tone plus clicks every 0.5 s, the harmonic energy at the 440 Hz bin is > 0.8 of the total there, and the percussive energy at click frames across bins > 4–8 kHz is > 0.8.
  - `HpssTest.boundedDelay`: the first non-null `push` result arrives after exactly `kernel/2 + 1` pushes.
  - `DrumDetectorTest.kickSnareHatPattern`: at 120 BPM over 8 s, kick on beats 1 and 3, snare on 2 and 4, hats on every 8th.
    - Each synthetic event has a detected event of the right `kind` within ±10 ms.
    - ≥ 90 % of synthetic events are matched.
    - False positives are ≤ 10 %.
  - `DrumDetectorTest.silenceHasNoDrums`: silence produces an empty list.

- [ ] **Step 2: Run the tests and confirm they fail** (compile errors).
  - Run: `node scripts/build-mewbeat-plugin.mjs --test`
  - Expected: FAIL.

- [ ] **Step 3: Implement.**
  - DrumDetector:
    1. Compute three band fluxes on the percussive magnitude: low 30–150 Hz, mid 150–4000 Hz, high 5000–12000 Hz.
    2. Pick onsets on their sum with `OnsetPicker`, minimum gap 40 ms.
    3. Classify each onset by the band shares of the flux at it:

       | Condition | Kind |
       |---|---|
       | low share ≥ 0.5 | `kick` |
       | high share ≥ 0.5 and low share < 0.15 | `hat` |
       | mid + high ≥ 0.6 and low < 0.35 | `snare` |
       | otherwise | `perc` |

    4. Normalise `s` to 0–1 by the 95th percentile of onset strengths.
  - Exact thresholds may move to make the tests pass; keep them as named constants.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `node scripts/build-mewbeat-plugin.mjs --test`
  - Expected: BUILD SUCCESSFUL, all tests pass, including the 7 existing `FeatureExtractorTest` tests.

- [ ] **Step 5: Commit** `feat(mewbeat-plugin): streaming HPSS and drum events`.

### Task 2: Tonal lines (bass + lead) and chroma frames

**Files:**
- Create `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/PitchTracker.java`.
- Modify `Synth.java`.
- Test `PitchTrackerTest.java`.

**Interfaces:**

Consumes:
- `AnalysisTier.pitchHop()`.
- `Fft` (existing).

Produces:
- New record `Features.Note(int t, int len, double pitch, double s, double conf)`, where `pitch` is a MIDI float.
- `final class PitchTracker`
  - `PitchTracker(int sampleRate, AnalysisTier tier)`
  - `void accept(float[] mono, int length)`: does its own framing with FFT 4096 and the tier hop.
  - `Lines finish(int[] onsetMs)`
  - `record Lines(List<Features.Note> bass, List<Features.Note> lead, int[] chromaMs, float[][] chroma)`, with one 12-value chroma frame per pitch frame.

Synth gains:
- `addBassNote(buf, at, dur, midi, amp)`: a sine plus 2 harmonics.
- `addLeadNote(buf, at, dur, midi, amp, vibratoCents)`: 6 harmonics with decaying amplitudes and a 5.5 Hz vibrato.

Approach:
- **Salience:** harmonic-sum salience over candidates at 1/5-semitone steps, using 8 harmonics with weights 0.8^(h−1).
- **Ranges:**
  - Bass is the best candidate in MIDI 23–59 (≈ 30–250 Hz).
  - Lead is the best candidate in MIDI 55–96 that is not a multiple of the bass f0 within ±0.5 semitone.
- **Voicing:** confidence is the peak salience over the frame's spectral energy, clipped to 0–1. A frame is voiced when conf ≥ 0.35 (named constant).
- **Note boundaries:**
  - A note starts at a voiced frame whose pitch differs from the running note by > 0.7 semitone, or at a broadband onset (`onsetMs`) inside a voiced stretch.
  - A note ends at unvoiced or at a pitch change.
- **Clean-up:**
  - Snap the start to an `onsetMs` within 50 ms.
  - Drop notes shorter than 60 ms.
  - The note's `pitch` is the median of its frames.
  - `s` is the mean salience normalised by the 95th percentile.
  - `conf` is the mean voicing.

- [ ] **Step 1: Write failing tests.**
  - `PitchTrackerTest.bassLineDetected`: bass notes MIDI 36, 38, 41, 43, each 500 ms with 50 ms gaps.
    - Each is detected with pitch ±0.5, start ±10 ms and len ±50 ms.
    - The lead list has no note longer than 100 ms.
  - `PitchTrackerTest.vibratoLeadIsOneNote`: one 1200 ms lead note at MIDI 69 with 40-cent vibrato gives exactly one lead note, pitch 69 ±0.5 and len 1200 ±50.
  - `PitchTrackerTest.leadOverBass`: bass at MIDI 40 and a lead melody 64, 67, 71, 67 at 400 ms each, played together, give both lines correct (same tolerances).
  - `PitchTrackerTest.noiseIsUnvoiced`: white noise produces no notes.
  - `PitchTrackerTest.chromaPeaksAtPitchClass`: during a MIDI 69 note, the chroma frames peak at pitch class 9.

- [ ] **Step 2: Run the tests and confirm they fail** (`node scripts/build-mewbeat-plugin.mjs --test` → FAIL).

- [ ] **Step 3: Implement `PitchTracker`** as described above.

- [ ] **Step 4: Run the tests and confirm they pass** (all tests pass).

- [ ] **Step 5: Commit** `feat(mewbeat-plugin): bass and lead note lines`.

### Task 3: Phrases, repetition, layer activity, tier config, Features v2

**Files:**
- Create `dsp/Repetition.java`.
- Create `dsp/LayerActivity.java`.
- Modify `dsp/Features.java` (`VERSION` 2 and new fields).
- Modify `dsp/FeatureExtractor.java` to wire `Hpss`, `DrumDetector`, `PitchTracker` and `Repetition` into `accept`/`finish`.
- Modify `AnalysisWorker.java`: `new FeatureExtractor(WAV_SAMPLE_RATE, tier)`, with `@Value("${plugins.mewbeat.analysisTier:full}")`.
- Modify `MewbeatRoutes.java` only if it hard-codes the version.
- Tests:
  - `RepetitionTest.java`
  - `FeatureExtractorTest.java` (update)
  - `AnalysisBudgetTest.java`
- Modify `Synth.java` to add `song(...)`, an ABAB builder.
- Docs: add a short "Analysis tier" section to `lavalink-plugins/mewbeat/SPIKE.md`. Do not edit `helpers/lavalink/application.yml`.

**Interfaces:**

Features gains, after the v1 fields, in this order:
- `String analysisTier`
- `List<Drum> drums`
- `List<Note> bass`
- `List<Note> lead`
- `Phrases phrases`

New records:
- `Phrases(int beatsPerPhrase, List<Phrase> list)`
- `Phrase(int startMs, int endMs, Integer repeatOf, double similarity, int lagMs, Layers activity, Layers confidence)`
- `Layers(double drums, double bass, double lead)`

JSON names are exactly the record component names. Numbers are rounded the way v1 already rounds `s`.

Example (field names are binding for Task 4):

```json
{ "featuresVersion": 2, "analysisTier": "full", "...v1 fields...": 0,
  "drums": [{ "t": 1000, "s": 0.82, "kind": "kick" }],
  "bass":  [{ "t": 1000, "len": 480, "pitch": 36.02, "s": 0.7, "conf": 0.66 }],
  "lead":  [{ "t": 1500, "len": 1200, "pitch": 69.1, "s": 0.9, "conf": 0.58 }],
  "phrases": { "beatsPerPhrase": 16, "list": [
    { "startMs": 0, "endMs": 8000, "repeatOf": null, "similarity": 0, "lagMs": 0,
      "activity": { "drums": 0.8, "bass": 0.6, "lead": 0.0 },
      "confidence": { "drums": 0.7, "bass": 0.6, "lead": 0.0 } } ] } }
```

Repetition:
- **Signature:** `static List<Features.Phrase> Repetition.phrases(int[] beatMs, int[] downbeatMs, double tempoConfidence, float[][] beatChroma, float[][] beatRhythm, int durationMs)`.
- **Inputs:**
  - `beatChroma[i]` is the mean chroma between beat i and i+1, L2-normalised.
  - `beatRhythm[i]` is the combined flux summed into 4 sub-beat slots.
- **Phrase grid:**
  - Phrases are 16 beats long.
  - The grid offset is the first downbeat when `tempoConfidence ≥ 0.5`. Otherwise it is the offset in 0..3 beats that maximises the mean best-repeat similarity.
  - The pickup before the first grid start becomes phrase 0 when it is ≥ 1 beat. The tail runs to `durationMs`.
  - Fewer than 32 beats → empty list.
- **Similarity:** `0.6·cos(chroma) + 0.4·cos(rhythm)`, averaged over aligned beats.
  - Phrase j is compared with each earlier i at beat shifts −4..+4 (±1 bar).
  - `repeatOf` is the earliest i with similarity ≥ 0.85 (named constant `REPEAT_THRESHOLD`).
  - `lagMs = startMs_j − beatMs[startBeat_i + shift]`, so the content at t in j matches the content at t − lagMs.
  - With no match: `repeatOf` null, `similarity` the best value seen, `lagMs` 0.
- **LayerActivity:** `static void fill(...)`, or return new phrases with activity and confidence.
  - drums activity = `min(1, drumEventsPerBeat / 2) × mean s`; confidence = mean `s` of kick/snare events.
  - bass and lead activity = the share of phrase time covered by notes; confidence = the len-weighted mean `conf`.
  - All values are 0–1. A layer with no events gets 0 / 0.

- [ ] **Step 1: Write failing tests.**
  - `RepetitionTest.ababStructure`: `Synth.song` builds an A-B-A-B synthetic song at 120 BPM, each section 16 beats.
    - A is kick/snare plus bass C-E-G plus lead melody 1; B has different chords and melody.
    - Expect phrases[*].repeatOf == `[null, null, 0, 1]` and similarity ≥ 0.85 on the repeats.
  - `RepetitionTest.slippedRepeatStillMatches`: the second A starts 1 bar late; it still has `repeatOf` 0, with `lagMs` = the true shift ±20 ms.
  - `RepetitionTest.shortTrackHasNoPhrases`: 20 beats → empty list.
  - `FeatureExtractorTest.serialisesToFeaturesJsonV2` (renamed from V1):
    - the JSON has `featuresVersion: 2`, `analysisTier`, `bands`, `drums`, `bass`, `lead` and `phrases.beatsPerPhrase` 16;
    - `streamingEqualsOneShot` still holds with the new layers.
  - `AnalysisBudgetTest.fullTierMeetsPcGate`:
    - it runs only when `System.getProperty("mewbeat.bench")` is `"true"` (use `assumeTrue`);
    - a 180 s synthetic song on the full tier takes ≤ 9000 ms wall time.
    - It runs via `./gradlew test -Dmewbeat.bench=true`; forward the system property in `build.gradle.kts` `tasks.test`.

- [ ] **Step 2: Run the tests and confirm they fail** (`node scripts/build-mewbeat-plugin.mjs --test` → FAIL).

- [ ] **Step 3: Implement.**
  - FeatureExtractor keeps the existing v1 path untouched and feeds:
    - each FFT-1024 magnitude frame to `Hpss`, whose percussive output goes to `DrumDetector`;
    - the raw mono to `PitchTracker`.
  - In `finish()`:
    1. Build `beatChroma` and `beatRhythm` from `PitchTracker.Lines` chroma and the combined flux.
    2. Call `Repetition.phrases`, then `LayerActivity`.
  - Keep the constructor `FeatureExtractor(int sampleRate)` as a delegate to `FULL`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `node scripts/build-mewbeat-plugin.mjs --test`, then the bench once in Docker with `-Dmewbeat.bench=true`, and record the time in the report.

- [ ] **Step 5: Commit** `feat(mewbeat-plugin): phrases, repetition map and features v2`.

### Task 4: Node features v2, timing module and band path without RNG

**Files:**
- Modify `helpers/mewbeat/analysisClient.js`: `FEATURES_VERSION = 2`.
- Modify `tests/helpers/mewbeat/analysisClient.test.js`: flip the version expectations (lines ~21 and ~283–295) so v1 is now the stale version.
- Create `helpers/mewbeat/charts/timing.js`: move `buildTiming`, `energyLookup` and their helpers out of `generate.js` unchanged, then add folding.
- Create `helpers/mewbeat/charts/bandPath.js`: the v3 candidate → snap → thin → lane path, moved from `generate.js`, with the RNG replaced.
- Modify `helpers/mewbeat/charts/generate.js` to import from the new modules. It stays v3 behaviour apart from the tie-break.
- Modify `tests/helpers/mewbeat/fixtures.js`: add `makeLayeredFeatures`.
- Test `tests/helpers/mewbeat/chartTiming.test.js`.

**Interfaces:**

Produces:
- `timing.js` exports `{ buildTiming, energyLookup, foldTempo }`.
  - `buildTiming(features, durationMs)` keeps today's return shape (`snapped, beats, downbeats, medianMs, intervalOk, beatMsAt, gridPoints(div)` or `NO_TIMING`) and adds `foldFactor`.
  - `foldTempo(bpm) → { bpm, factor }`: factor is a power of 2 with `70 ≤ bpm·factor ≤ 200`. For `bpm ≤ 0` or NaN it returns `{ bpm, factor: 1 }`.
  - When `factor` is 2, `buildTiming` inserts midpoints between beats. When it is ½, it keeps every second beat starting at the first downbeat (or beat 0). `medianMs` follows.
- `bandPath.js` exports `bandPathNotes(features, timing, diff, energyAt, { fromMs, toMs })` → `[{ t, lane }]`, time-ordered, with v3 thinning applied inside the window.
  - Tie-break (replaces `rng`):
    1. Pick the hand with fewer notes over the previous 1 bar (4 beats, or 2000 ms without timing).
    2. Within that hand, pick the lane the previous note did not use.
    3. Then pick the lower lane index.
- `fixtures.js` exports `makeLayeredFeatures({ bpm = 120, durationMs = 64000, structure = "ABAB", leadConfidence = 0.7, drums = true, bass = true, lead = true, holdsEveryBeats = 0 })`.
  - It returns a v2 features object: v1 fields from `makeFeatures`, plus `drums`, `bass`, `lead` and `phrases` with 16-beat phrases.
  - The `structure` letters repeat identical event patterns (A, B…). Repeats get `repeatOf` set, `similarity: 0.95` and `lagMs` = start difference.
  - When `holdsEveryBeats` > 0, every Nth lead note is `holdsEveryBeats` beats long.

- [ ] **Step 1: Write failing tests** in `chartTiming.test.js`.
  - `foldTempo`: 220 → factor 0.5; 60 → 2; 120 → 1; 0 → 1.
  - `buildTiming` folds a 230 BPM grid to `medianMs` ≈ 521.7 ±1.
  - `bandPathNotes` is identical for two different `audioKey`s. This test lives in `charts.test.js`, as `generateChart(f, 'hard', 'a')` deep-equal to `generateChart(f, 'hard', 'b')`.

- [ ] **Step 2: Run the tests and confirm they fail** (`npm test` → the new tests FAIL).

- [ ] **Step 3: Implement the moves, `foldTempo` and the deterministic tie-break.** Delete `helpers/mewbeat/charts/rng.js` and its import. The existing v3 tests in `charts.test.js` must still pass, except any that assert seeded-RNG specifics.

- [ ] **Step 4: Run the tests and confirm they pass** (`npm test` → `ℹ fail 0`).

- [ ] **Step 5: Commit** `refactor(mewbeat): timing module, tempo folding, band path without RNG`.

### Task 5: Phrases and leading layer

**Files:**
- Create `helpers/mewbeat/charts/phrases.js`.
- Test `tests/helpers/mewbeat/chartPhrases.test.js`.

**Interfaces:**

Consumes:
- `buildTiming`, `energyLookup` (Task 4).
- The features v2 shape (Task 3 JSON).

Produces:
- `buildPhrases(features, timing, durationMs)` → `Phrase[]`, where `Phrase = { index, startMs, endMs, repeatOf: number|null, similarity, lagMs, activity: {drums,bass,lead}, confidence: {drums,bass,lead}, energy, sectionStart: boolean }`.
  - `energy` is the mean of `energyAt` over the phrase.
  - `sectionStart` is true when an energy section boundary falls within ±1 beat of `startMs`.
  - **Fallback**, when `features.phrases?.list` is missing or empty:
    - windows of 16 beats, or 8000 ms without timing;
    - each window clipped to section boundaries;
    - `repeatOf` null;
    - activity and confidence computed from `drums`/`bass`/`lead` with the Task 3 formulas, or all zero for v1-shaped data.
- `chooseLeaders(phrases)` → `Array<"drums"|"bass"|"lead"|"bands">`, aligned to `phrases`:
  1. **Score:** a layer's score is activity × confidence.
  2. **Absent layers:**
     - A tonal layer is absent when its confidence < `TONAL_MIN_CONF` 0.45.
     - Drums are absent when activity < 0.15 or confidence < 0.3.
     - When all three are absent → `"bands"`.
  3. **Best:** `lead` when present with score ≥ 0.35, else the present layer with the highest score.
  4. **Hysteresis:** keep the previous leader when it is present and its score ≥ 0.8 × the best score, unless `sectionStart` is true.
  5. **Repeats:** a phrase with `repeatOf != null` and `similarity ≥ REPEAT_SIMILARITY` (0.85, exported) takes `leaders[repeatOf]`.

- [ ] **Step 1: Write failing tests.**
  - `fallbackWindowsWhenNoPhrases`: v1 `makeFeatures` gives phrases of 16 beats, all with `repeatOf` null.
  - `leaderFollowsVocalsAndDrums`: with lead confidence 0.7 the leaders are `lead`; with `leadConfidence: 0.2` they are `drums`.
  - `bandsWhenNoLayers`: v1 data gives all `bands`.
  - `hysteresisAvoidsFlicker`: alternating lead scores of 0.5 and 0.45 against bass 0.42 keep `lead` throughout. A `sectionStart` phrase where bass beats lead clearly switches.
  - `repeatInheritsLeader`.

- [ ] **Step 2: Run the tests and confirm they fail** (`npm test` → FAIL).

- [ ] **Step 3: Implement `buildPhrases` and `chooseLeaders`.**

- [ ] **Step 4: Run the tests and confirm they pass** (`npm test` → `ℹ fail 0`).

- [ ] **Step 5: Commit** `feat(mewbeat): phrases and leading layer`.

### Task 6: Generator v4 (taps): patterns, repeats, difficulty filter, metrics

**Files:**
- Create `helpers/mewbeat/charts/patterns.js`.
- Create `helpers/mewbeat/charts/repeats.js`.
- Create `helpers/mewbeat/charts/difficultyFilter.js`.
- Create `helpers/mewbeat/charts/metrics.js`.
- Modify `helpers/mewbeat/charts/generate.js` (orchestration).
- Modify `helpers/mewbeat/charts/difficulty.js`: `GENERATOR_VERSION = 4` and the new per-difficulty fields.
- Modify `tests/helpers/mewbeat/charts.test.js`: delete `hardIsNotNormalPlusNoise`.
- Test `tests/helpers/mewbeat/chartsV4.test.js`.

**Interfaces:**

Consumes:
- Tasks 4–5.

Produces:
- `patternEvents(phrase, leader, features, timing)` → `Event[]`, where `Event = { t, lane, level: 0|1|2, s, source: "drums"|"bass"|"lead"|"secondary", sustainMs?: number }`, time-ordered.
  - **Grid:** every time is snapped to the nearest 1/4-beat grid point (`timing.gridPoints(4)`). An event farther than 1/16 beat from it snaps to 1/8 instead and is level 2. Without timing, times stay raw.
  - **Drums:**
    - kick → lanes `[0, 3]`, snare → `[1, 2]`; the pair index is `floor(beatInBar) % 2` (positions from downbeats).
    - Hats go only into 1/4-grid slots with no kick or snare within 1/8 beat, are level 2, and take the lane of the hand opposite the previous event.
    - `perc` counts as snare.
    - Levels:
      - level 0: kick/snare on a beat with `s` ≥ the phrase's median kick/snare `s`;
      - level 1: other kick/snare on the 1/2 or 1/4 grid;
      - level 2: hats and 1/8.
  - **Tonal (bass/lead):**
    - Use notes with `conf ≥ 0.45` that start in the phrase.
    - **Lane from pitch:** `lane = clamp(floor(4·(pitch−min)/(max−min+1e-9)), 0, 3)` over the phrase's pitch range.
    - **Narrow range:** when the range is < 3 semitones, use the contour instead: start at lane 1, then +1 / −1 per step up / down, bouncing at 0 and 3.
    - **Repeated pitch:** stays on the same lane when the gap is ≥ max(½ beat, 250 ms). Faster, it alternates `lane ↔ lane±1`, toward the centre (a trill).
    - **Stairs:** a monotonic run of ≥ 3 steps in one direction moves one lane per step (bouncing at edges).
    - **Levels:**
      - level 0: a note starting on a beat or ½ beat with `s` ≥ the phrase median, plus the longest 25 % of notes;
      - level 1: the rest on the 1/4 grid;
      - level 2: 1/8.
    - `sustainMs = note.len` (used in Task 7).
  - **Secondary layer:** when the leader is tonal and `phrase.energy ≥ 0.6`, add kick/snare events from drums with `source: "secondary"`, level 2, only into slots ≥ 1/4 beat from any leader event.
  - **Chords:** at a bar downbeat or the phrase start, when the leading event there has level 0, add a mirror event `lane = 3 − lane` at level 1. Never 3+ events at one time.
- `copyRepeat(sourceNotes, phrase, eventTimes)` → `notes`.
  - `sourceNotes` are that difficulty's final notes of the source phrase.
  - Each note gets `t + phrase.lagMs` (and `len` when present); keep those inside `[startMs, endMs)`.
  - Drop a note when no time in `eventTimes` (all layer events and band onsets, sorted) is within ±60 ms.
- `applyDifficulty(events, diff, timing, energyAt, prevNotes)` → `[{ t, lane }]`.
  1. Keep `level ≤ diff.maxLevel` (easy 0, normal 1, hard 2). On Normal, also drop level-1 events off the ½ grid in phrases with energy < 0.6.
  2. Drop notes before `LEAD_IN_MS` or where energy < `SILENCE_ENERGY`.
  3. Easy has no chords (keep the lower-level/stronger one). No difficulty ever has 3+ events at one time.
  4. **Jacks:** a same-lane run longer than `diff.maxJack` moves to `lane ^ 1`. Easy has `maxJack` 1 (no jacks), Normal 2, Hard 3.
  5. **Floors:** `minNoteGapMs`, `minLaneGapMs` and the v3 sliding `maxNps` density scaled by energy^1.5. When over the cap, drop the highest level first, then the lowest `s`.
  - `prevNotes` (the previous phrase's tail) makes gaps hold across boundaries.
- `enforceFloors(notes, diff)` → `notes`: a final whole-song pass that drops only notes breaking `minNoteGapMs` or `minLaneGapMs`.
- `chartMetrics(chart, features)` → `{ onLayerShare, repeatIdentity: [{ phrase, source, identity }], handBalance: { left, right }, nps: { mean, peak } }`.
  - `onLayerShare` is the share of notes within ±20 ms of any layer event.
  - `identity` is the share of source notes reproduced at the same lane and shifted time ±5 ms.
- `generate.js`:
  1. timing → `buildPhrases` → `chooseLeaders`.
  2. For each difficulty, walk the phrases in order:
     - a repeat (`repeatOf != null && similarity ≥ REPEAT_SIMILARITY` and the source has notes) → `copyRepeat`;
     - leader `bands` → `bandPathNotes` for the phrase window;
     - otherwise → `applyDifficulty(patternEvents(...))`.
  3. Then `enforceFloors`, then `MIN_NOTES` → `null`.
  - The output shape stays `{version, audioKey, difficulty, durationMs, stars, highlightMs, notes}`.
- `difficulty.js` gains per-difficulty `maxLevel`, `maxJack` and `holdMinBeats` (easy 1, normal 0.5, hard 0.5; used in Task 7) and keeps the existing gap and nps values as starting points.

- [ ] **Step 1: Write failing tests** in `chartsV4.test.js`, all on `makeLayeredFeatures`.
  - `deterministic`: two runs are deep-equal.
  - `noRandomness`: two `audioKey`s give equal `notes`.
  - `repeatsIdenticalOnEveryDifficulty`: on ABAB, for each difficulty, the notes of phrase 2 equal phrase 0's shifted by `lagMs` (lane and t), and phrase 3 equals phrase 1's.
  - `easyHasNoChordsOrJacks`: no two Easy notes share `t`, and no consecutive Easy notes share a lane.
  - `neverThreeNoteChords`: true on all difficulties.
  - `floorsHoldAt220Bpm`: `makeLayeredFeatures({ bpm: 220 })`.
    - Easy keeps every gap ≥ `minNoteGapMs`.
    - Easy's peak nps over 2 s is ≤ `DIFFICULTIES.easy.maxNps`.
    - The chart uses the folded grid (no Easy note off the ½ grid of the folded beat).
  - `notesSitOnLayerEvents`: `chartMetrics(...).onLayerShare ≥ 0.9` on Normal.
  - `bandPathWhenNoLayers`: v1-shaped `makeFeatures` still returns three charts and keeps the v3 invariants (gaps, lead-in).
  - `drumLaneRoles`: with a drums-led fixture, every Easy kick note is on lane 0 or 3 and every snare note on lane 1 or 2.
  - `hardIsFullerThanNormal`: Hard's note count is > Normal's > Easy's, and ≥ 80 % of Easy note times also appear in Normal.

- [ ] **Step 2: Run the tests and confirm they fail** (`npm test` → FAIL).

- [ ] **Step 3: Implement the modules** as specified. Bump `GENERATOR_VERSION` to 4.

- [ ] **Step 4: Run the tests and confirm they pass** (`npm test` → `ℹ fail 0`; existing `chartStore` and `formatShape` tests still pass).

- [ ] **Step 5: Commit** `feat(mewbeat): generator v4 follows musical layers and repeats`.

### Task 7: Holds in the generator and star rating

**Files:**
- Modify `helpers/mewbeat/charts/difficultyFilter.js`, `generate.js`, `repeats.js` and `stars.js`.
- Test `tests/helpers/mewbeat/chartsV4.test.js` (add to it).

**Interfaces:**
- Notes become `{ t, lane, len? }`; `len` is an integer number of ms > 0, and a tap has no `len` key.
- **Becoming a hold:** `applyDifficulty` turns an event with `sustainMs ≥ diff.holdMinBeats × beatMsAt(t)` into a hold.
  - `len = min(sustainMs, nextSameLaneT − minLaneGapMs − t, 4 beats)`.
  - When the clipped `len` is below the minimum, the event stays a tap.
  - Drum-sourced events never become holds.
- **Constraints while a hold runs** (from `t` to `t + len`):
  - Easy: no notes in any lane until `t + len + minNoteGapMs`.
  - All difficulties: no notes in the hold's own hand (lanes 0–1 or 2–3).
  - Normal: notes in the other hand are spaced ≥ ½ beat apart.
  - Hard: the other hand is free.
  - On Easy and Normal, a hold is never part of a chord.
- `copyRepeat` carries `len`.
- `enforceFloors` treats a hold as occupying its lane until `t + len`.
- `starsOf(chart)`:
  - each hold counts as one note for nps;
  - add `0.3 × (holds / notes)`;
  - keep the cap at 10.

- [ ] **Step 1: Write failing tests.**
  - `holdsFollowSustainedNotes`: in `makeLayeredFeatures({ holdsEveryBeats: 2 })` on Normal, every lead note of ≥ ½ beat leading a level-≤1 event becomes a hold. A tolerance of ±1 note per phrase is allowed for floor drops.
  - `easyHoldsAreAloneAndLong`: on Easy, every hold has `len ≥ beatMs` and no note starts in `(t, t + len]`.
  - `noSameHandNotesDuringHold`: true on all difficulties.
  - `holdsSurviveRepeats`: the ABAB repeat identity includes `len`.
  - `starsCountHolds`: the same notes with holds get more stars than without.
  - `tapChartsHaveNoLenKey`: a drums-only fixture produces no `len` keys.

- [ ] **Step 2: Run the tests and confirm they fail** (`npm test` → FAIL).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and confirm they pass** (`npm test` → `ℹ fail 0`).

- [ ] **Step 5: Commit** `feat(mewbeat): hold notes in generated charts`.

### Task 8: Hold judging and run logic in the game

**Files:**
- Modify `activity/src/mewbeat/judge.js` and `activity/src/mewbeat/run.js`.
- Tests:
  - `tests/activity/mewbeat/judge.test.js` (add, or create alongside the existing judge tests)
  - `tests/activity/mewbeat/run.test.js`

**Interfaces:**

Constants:
- `HOLD_WINDOW_SCALE = 1.5`, exported from `scoring.js`.
- Tail windows are `WINDOWS × 1.5`: perfect 67.5, great 135, good 202.5.

Judge (`createJudge(notes, { fromMs })`):
- Outcome objects gain `part: "head" | "tail"`.
- `outcomeOf(index)` keeps returning the head outcome.
- New `tailOutcomeOf(index)` returns the tail outcome or `null`.
- `press` on a hold head judges it like a tap. A non-MISS head makes the hold active on that lane.
- New `release(lane, songMs)` → `Outcome[]`:
  - With an active hold on the lane: when `songMs ≥ end − 202.5`, the tail is judged by `|songMs − end|` against the tail windows. Earlier, it is a drop: the tail is MISS.
  - With no active hold it returns `[]`.
- `sweep(songMs)`:
  - Auto-completes active holds whose `end ≤ songMs` (judgement `perfect`, `errorMs` 0).
  - When a head is missed, the tail's MISS is emitted in the same sweep.
- `skipBefore(songMs)`:
  - Also skips tails whose end is before `songMs`.
  - A hold whose head is skipped but whose end is after `songMs` is skipped whole: no outcomes and not counted.
- `remaining()` counts pending tails.

Run (`createRun`):
- New `release(lane, songMs)` → events.
- Hit events gain `part`; miss events gain `part`.
- `total` judgements = notes + holds.
- `endAfterMs = max(t + (len || 0)) + WINDOWS.good`.
- Autoplay presses at the head and releases at the end.
- `visibleNotes(...)` entries gain `len` (0 for taps) and `hold: "pending" | "held" | "dropped" | "done"`.
  - The look-back includes holds whose end is still visible: keep notes with `t + len ≥ heardMs − lookback`.
  - Track the longest `len` so the scan window stays bounded.
- Tail judgements go through the same `applyJudgement(state, judgement, songMs)` as taps: combo, vibe, multiplier and FEVER at the moment of judging.

- [ ] **Step 1: Write failing tests.**
  - `holdHeadThenReleaseAtEnd`: the head is PERFECT; releasing at `end` gives a PERFECT tail. The score counts two perfects and accuracy is 100 %.
  - `earlyReleaseDropsHold`: a release at `end − 300` gives a tail MISS, combo 0 and vibe reduced by 0.06.
  - `releaseInsideTailWindow`: a release at `end − 150` gives a tail GREAT.
  - `holdPastEndAutoCompletes`: never releasing, `sweep(end + 1)` gives a tail PERFECT.
  - `missedHeadMissesTail`: no press, a sweep past the head gives a head MISS and a tail MISS.
  - `releaseWithoutActiveHoldIsNoop`: releasing a lane with no active hold, or a release after auto-complete, returns `[]`.
  - `skipBeforeSkipsHoldTails`: `skipBefore` in the middle of a hold leaves no active hold. `remaining()` and the totals are consistent, and the run still ends.
  - `autoplayHoldsFullLength`: an autoplay run over a chart with a hold gives head PERFECT and tail PERFECT.
  - `tapOnlyChartUnchanged`: a tap-only chart gives the same events and score as before. Use an existing run test fixture and assert its expected values unchanged.
  - `heldKeyBeforeHeadDoesNotCount`: a press 500 ms before the head is a ghost (no outcome). Holding then never judges the head, and the head MISSes at the sweep.

- [ ] **Step 2: Run the tests and confirm they fail** (`npm test` → FAIL).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and confirm they pass** (`npm test` → `ℹ fail 0`).

- [ ] **Step 5: Commit** `feat(mewbeat): hold judging and autoplay holds`.

### Task 9: Holds on the highway, input wiring and mock chart

**Files:**
- Modify `activity/src/mewbeat/highway.js`, `activity/src/mewbeat/useMewbeatGame.js` and `activity/src/mewbeat/mockLink.js`.
- Test `tests/activity/mewbeat/mockLink.test.js`, or the closest existing test of the mock chart.

**Interfaces:**

Consumes:
- `run.release`.
- `visibleNotes` entries with `len` and `hold` (Task 8).

Behaviour:
- **Highway:** a hold draws its tail from the head y to the end y.
  - Width 38 % of the lane, rounded caps, the lane colour at alpha 0.55, with the head drawn as today on top.
  - While `hold === "held"`, the tail starts at the receptor and the head is not drawn.
  - `"dropped"` draws the tail and head in `#5b6170` at alpha 0.45.
  - `"done"` is not drawn.
  - Effects "off" draws no tail gradient, only flat colour.
- **useMewbeatGame:**
  - `onKeyUp` → `run.release(lane, songMs)`, with events going through `handleEvents`.
  - The hit sound plays only for `event.part !== "tail"`.
  - When input pauses (`inputPausedRef` becomes true: the settings panel opens, the window blurs, or the round ends), call `run.release` for every lane in `lanesDownRef` and clear it.
- **mockLink:** the fixed 120 BPM chart gets 4 holds (1–2 beats each, lanes spread over both hands), and every other note keeps working.

- [ ] **Step 1: Write a failing test**: the mock chart contains ≥ 4 notes with `len > 0`, and no note starts inside a hold in that hold's hand.

- [ ] **Step 2: Run the test and confirm it fails** (`npm test` → FAIL).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and the build** (`npm test` → `ℹ fail 0`; `npm --prefix activity run build` succeeds). Do not start dev servers or take screenshots; the controller verifies visually.

- [ ] **Step 5: Commit** `feat(mewbeat): draw and play hold notes`.

### Task 10: Preview tool metrics and hold sonification

**Files:**
- Modify `scripts/mewbeat-preview.mjs`.
- Modify `tests/scripts/mewbeatPreview.test.js`.

**Interfaces:**

Consumes:
- `chartMetrics` (Task 6).

Behaviour:
- `mixClicks(audio, notes)`: for a note with `len`, add a second, softer click at `t + len` (gain 0.5, pitch one octave above the head click) and a quiet sustained 0.08-gain tone between head and release.
- `describe(chart, features)` also prints:
  - `onLayerShare` (as %);
  - the mean repeat identity and the count of phrases with `repeatOf`;
  - hand balance L/R;
  - nps mean/peak against the difficulty's `maxNps`;
  - hold count;
  - the per-phrase leader sequence, compressed (e.g. `lead×6 drums×2 lead×4`).

- [ ] **Step 1: Write failing tests.**
  - `mixClicks` with a hold note: the sample energy at `t + len` is > 0 and below the head click's peak.
  - `describe` output contains `on-layer` and `repeat identity`.

- [ ] **Step 2: Run the tests and confirm they fail** (`npm test` → FAIL).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and confirm they pass** (`npm test` → `ℹ fail 0`).

- [ ] **Step 5: Commit** `feat(mewbeat): preview tool prints chart proxies and sonifies holds`.

### Task 11: Rebuild, tune by ear, live and Pi gates (controller + user)

Not dispatched to an implementer. The controller runs it with the user.

- [ ] **Step 1: Rebuild and restart.**
  - Run `node scripts/build-mewbeat-plugin.mjs --test`, then restart the `lavalink` container; start `lavalink-yt-cipher-1` first if it is stopped.
  - Check that `GET /v4/mewbeat/version` reports `featuresVersion` 2.
- [ ] **Step 2: Render the previews.**
  - Render the test set with `scripts/mewbeat-preview.mjs` (Normal + Easy + Hard): K/DA FIRESTARTER / WATCH ME / MORE, one Camellia track, Coffin Dance, Rude Buster, Megalovania and two anime openings (Gurenge, Unravel).
  - Record the proxies per track in the ledger.
- [ ] **Step 3: Tune by ear with the user.**
  - Hand the renders to the user and tune the constants (Tasks 1–3 thresholds, Task 5–7 numbers) from their feedback.
  - Rebuild and re-render. Each round is one commit, `tune(mewbeat): …`.
- [ ] **Step 4: Live round.** The user plays the test set in Discord (bot `pnpm start:dev`, activity preview, tunnel).
- [ ] **Step 5: Pi gate.** The user runs the Plan 1 benchmark on the Pi with the new analysis. If it misses, set `plugins.mewbeat.analysisTier: light` and re-run. If light also misses, stop and come back to the user (spec rule).
