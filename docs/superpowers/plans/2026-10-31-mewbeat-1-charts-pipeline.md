# mewbeat 1/4 — Charts Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any playable track can be turned into deterministic Easy / Normal / Hard charts.

- A custom Lavalink plugin analyses the exact audio the bot plays.
- The bot generates and caches the charts.
- A preview tool lets a human check by ear that the notes match the music.

**Architecture:**
- A Java Lavalink v4 plugin (`lavalink-plugins/mewbeat/`):
  - decodes a track faster than realtime on one minimum-priority worker;
  - runs streaming DSP (band onsets, tempo and beat grid, energy, highlight);
  - returns a features JSON over `POST /v4/mewbeat/analyze`.
- The Node bot (`helpers/mewbeat/`):
  - fetches features with in-flight dedupe and a disk cache keyed by the exact resolved audio;
  - generates charts with a pure, versioned generator.
- Nothing in this plan touches the Activity or gameplay.

**Tech Stack:**
- Plugin: Java 21, Gradle via `docker run gradle:8.10-jdk21` (the same pattern as `scripts/build-youtube-tvua-plugin.mjs`), Lavalink plugin API, JUnit 5.
- Bot: Node 24 CommonJS, `node:test`, poru `node.rest`, and `helpers/data/atomicJson.js` for writes.

**Spec:** `docs/superpowers/specs/2026-10-31-mewbeat-rhythm-game-design.md` (sections "Charts", "Constraints", "Anti-goals").

**Roadmap:** this is plan 1 of 4. Later plans get written after this one lands and the Pi gate (Task 4) passes.

2. Single-player game client: highway, timing sync, judgement and scoring, HUD, Mewbit placeholder, settings, Konami unlock.
3. Sessions and multiplayer: queue-following rounds, lobby, song select, Skip & defer, pre-analysis and early autoplay pick.
4. Results, intermission, leaderboards and history, invites, calibration (metronome source), auto-offset.

## Global Constraints

- All work happens on branch `feat/mewbeat`. Never merge it to `main` until all 4 plans are done.
- Local testing uses the Docker stack on the Windows PC. Start Docker Desktop first; it is the user's machine.
  - Lavalink only: `pnpm lavalink:dev`.
  - Full stack: `pnpm local:up`.
- The Pi is touched only in Task 4.
- Production Lavalink is `ghcr.io/lavalink-devs/lavalink:4` on Raspberry Pi arm64. Plugin jars are committed to `helpers/lavalink/plugins/` (as lavasrc and lavalyrics already are).
- The `http` and `local` sources stay disabled in `helpers/lavalink/application.yml`.
- Pi safety is a hard requirement:
  - analysis runs on a single worker thread at `Thread.MIN_PRIORITY`;
  - at most 1 analysis runs at a time;
  - the full PCM is never held in memory;
  - analysis never runs on Lavalink's playback threads.
- Speed target: analysing a 3–5 min track takes **< 20 s on the Pi**.
- Charts must be **deterministic**. The same features, `GENERATOR_VERSION` and difficulty always give byte-identical charts. No `Math.random`, no wall-clock values.
- Cache and chart key is the **exact resolved audio**: `sourceName + identifier + length` of the playable track. Never use `helpers/lavalink/trackIdentity.js` for this.
- Difficulty table, verbatim from the spec:

  | | Easy | Normal | Hard |
  |---|---|---|---|
  | Max grid | 1/2 beat | 1/4 beat in high-energy parts | 1/4 beat throughout, occasional 1/8 on very strong onsets |
  | Same-lane gap | ≥ 1 beat | ≥ 1/2 beat | ≥ 1/4 beat |
  | Chords | none | 2-note chords on strong downbeats only | 2-note chords; never 3+ |

- Chart format: `{ version, audioKey, difficulty, durationMs, stars, highlightMs, notes: [{ t, lane }] }`.
  - `t` is in integer ms.
  - `lane` is 0–3.
  - A future optional `len` must be addable without breaking the format.
- Code style:
  - Bot code is CommonJS, matching `helpers/lavalink/*`, with `Log` from `helpers/logs/log`.
  - Tests live under `tests/helpers/mewbeat/` in the style of `tests/helpers/lavalink/loudness.test.js`.

## Review Focus

1. **Streams and unknown-length tracks** (`info.isStream`, or length 0). The bot refuses before calling Lavalink and marks the track uncharted. Test in Task 6.
2. **Analysis failing mid-decode** (source 403, decode error, plugin queue full).
   - The bot negative-caches the failure for 10 min, so there is no retry storm and every caller gets `null` quickly.
   - The plugin answers fast with an error, not a hang.
   - Tests in Tasks 3 and 6.
3. **The same track requested twice at once** (pre-analysis plus a live join). Only one Lavalink request goes out, and both callers get the same result. Test in Task 6.
4. **Near-silent, ambient or tempo-less audio.**
   - The generator still produces a playable chart without a grid.
   - If a difficulty would have fewer than 20 notes, the whole track is reported uncharted rather than giving an empty-feeling chart.
   - Test in Task 7.
5. **Corrupt or old-version cache files.** They are treated as a miss and regenerated, never thrown to the caller. Test in Task 8.

---

### Task 1: Plugin skeleton, build script, version route

**Files:**
- Create: `lavalink-plugins/mewbeat/` — a Gradle project based on the official `lavalink-devs/lavalink-plugin-template`, including `settings.gradle.kts`, `build.gradle.kts`, the `gradlew` wrapper and `src/main/java/dev/mewbit/mewbeat/`. The package is `dev.mewbit.mewbeat`.
- Create: `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/MewbeatRoutes.java` (a `@RestController`).
- Create: `scripts/build-mewbeat-plugin.mjs`.
- Output: `helpers/lavalink/plugins/mewbeat-plugin-<version>.jar`.

**Interfaces:**
- Produces:
  - `GET /v4/mewbeat/version` → `{ "plugin": "mewbeat", "version": "<semver>", "featuresVersion": 1 }`.
  - `node scripts/build-mewbeat-plugin.mjs [--test]`, which runs gradle `test` and then `build` in Docker and copies the jar. It deletes older `mewbeat-plugin-*.jar` files in the plugins dir.

- [ ] **Step 1:** Read the running Lavalink version: start `pnpm lavalink:dev`, then `curl -H "Authorization: youshallnotpass" localhost:2333/version`. Pin the template's `lavalink { version = ... }` (plugin API) to that exact version.
- [ ] **Step 2:** Write `MewbeatRoutes` with the version route. The plugin version comes from the Gradle project version `0.1.0`.
- [ ] **Step 3:** Write the build script, mirroring `scripts/build-youtube-tvua-plugin.mjs`. Docker volume path normalisation for win32 is the same. The image is `gradle:8.10-jdk21`; run `./gradlew test build --no-daemon` (or `build -x test` when `--test` is absent).
- [ ] **Step 4:** Run `node scripts/build-mewbeat-plugin.mjs`, then `pnpm lavalink:dev:down && pnpm lavalink:dev`.
  - Expected: Lavalink logs list the `mewbeat` plugin as loaded.
  - The curl to `/v4/mewbeat/version` returns the JSON above.
  - The same curl without the `Authorization` header returns 401 (Lavalink's auth covers plugin routes).
- [ ] **Step 5:** Commit `lavalink-plugins/mewbeat`, the script and the jar: `feat(mewbeat): lavalink plugin skeleton with version route`.

### Task 2: Streaming DSP core (pure Java, unit-tested on synthetic audio)

**Files:**
- Create in `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/dsp/`:
  - `FeatureExtractor.java`
  - `Features.java` (records)
  - `Fft.java`
  - `TempoEstimator.java`
  - `Highlight.java`
- Test: `lavalink-plugins/mewbeat/src/test/java/dev/mewbit/mewbeat/dsp/FeatureExtractorTest.java`, plus a `Synth.java` helper that generates click trains, noise bursts and silence.

**Interfaces:**
- Produces:
  - `new FeatureExtractor(int sampleRate)`;
  - `void accept(float[] mono, int length)`, which is streamed and can be called many times;
  - `Features finish()`.
- `Features` serialises (Jackson, available in Lavalink) to the features JSON v1:

```json
{ "featuresVersion": 1, "durationMs": 0, "hopMs": 10.667,
  "bands": [ { "name": "low|lowmid|highmid|high", "onsets": [ { "t": 0, "s": 0.0 } ] } ],
  "tempo": { "bpm": 0.0, "confidence": 0.0, "beats": [0], "downbeats": [0] },
  "energy": { "hopMs": 500, "values": [0.0] },
  "sections": [ { "startMs": 0, "endMs": 0, "energy": 0.0 } ],
  "highlightMs": null }
```

- Fixed DSP decisions. The internals are free.
  - **Input:** 48 kHz stereo from lavaplayer, downmixed to mono and decimated ×2 to 24 kHz before `accept`.
  - **STFT:** FFT 1024, hop 256 (10.667 ms), Hann window.
  - **Bands (Hz):** low 20–150, lowmid 150–800, highmid 800–4000, high 4000–12000.
  - **Onsets:**
    - per-band log-compressed spectral flux;
    - adaptive threshold of median + 1.5×MAD over ±0.5 s;
    - minimum inter-onset 50 ms per band;
    - strength `s` normalised 0–1 per band over the track.
  - **Memory:** only the per-hop band flux is kept (4 floats per hop). This is what satisfies "never hold full PCM".
  - **Tempo:**
    - autocorrelation of summed flux over 60–200 BPM, with a log-Gaussian prior centred at 120 BPM;
    - dynamic-programming beat tracking (Ellis 2007);
    - `confidence` = autocorrelation peak / mean in 0–1;
    - downbeat = the phase of 4-beat grouping that maximises low-band onset strength.
  - **Energy:** RMS per 500 ms, normalised to the track's 95th percentile and clamped to 0–1.
  - **Sections:**
    - energy smoothed over 4 s;
    - a boundary wherever the smoothed value crosses its median ± 0.15;
    - boundaries snapped to the nearest downbeat when confidence ≥ 0.5.
  - **Highlight:**
    - the start of the 12 s window with the highest mean energy, ignoring the first 15 s and the last 10 s;
    - snapped back to a section start within 4 s if one exists;
    - `null` when the track is shorter than 40 s, or the best window mean is < 0.5.

- [ ] **Step 1: Write the failing tests.**
  - `clickTrain120BpmGivesTempo120`: 60 s of clicks at 120 BPM. Assert `bpm` is within 1.0 of 120, `confidence` ≥ 0.5, and every click has a beat within 15 ms.
  - `onsetsLandOnClicks`: low-band clicks (60 Hz bursts) appear in the `low` band within 15 ms. Hi-hat noise bursts appear in `high`, not `low`.
  - `silenceHasNoOnsetsAndZeroEnergy`: 30 s of zeros gives no onsets in any band and all energy values = 0.
  - `highlightFindsLoudSection`: quiet clicks from 0 to 60 s, dense loud noise and clicks from 60 to 80 s, quiet again until 120 s. `highlightMs` is within 4000 ms of 60000.
  - `shortTrackHasNoHighlight`: a 30 s track gives `highlightMs == null`.
  - `streamingEqualsOneShot`: feeding the same signal in 1 chunk or in 997-sample chunks gives identical `Features`.
- [ ] **Step 2:** Run `node scripts/build-mewbeat-plugin.mjs --test`. Expected: FAIL, because the classes are missing.
- [ ] **Step 3:** Implement the classes with the decisions above.
- [ ] **Step 4:** Run `node scripts/build-mewbeat-plugin.mjs --test`. Expected: all 6 tests pass.
- [ ] **Step 5:** Commit `feat(mewbeat): streaming onset, tempo, energy and highlight extraction`.

### Task 3: Decode-and-analyse route (the spike — biggest risk)

**Files:**
- Create in `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/`:
  - `TrackDecoder.java`
  - `AnalysisWorker.java`
  - `MetricsLog.java`
- Modify: `MewbeatRoutes.java`.
- Modify: `helpers/lavalink/application.yml`. Add a `plugins.mewbeat` block:
  - `maxQueue: 4`
  - `maxTrackMs: 1200000`
  - `debugRoutes: false`

**Interfaces:**
- Consumes: `FeatureExtractor` (Task 2).
- Produces: `POST /v4/mewbeat/analyze` with body `{ "encodedTrack": "<base64>" }`.

  | Result | Response |
  |---|---|
  | Success | 200 → features JSON v1 plus `"audio": { "sourceName", "identifier", "length" }`, so the caller can confirm what was analysed |
  | Stream, or length > `maxTrackMs` | 422 `{ "error": "uncharted", "reason": "stream" \| "too_long" }` |
  | Queue full | 503 `{ "error": "busy" }` |
  | Decode or source failure | 502 `{ "error": "decode_failed", "message": ... }` |

- Fixed decisions:
  - **Decoding** happens outside any guild player. Decode the encoded track with Lavalink's shared `AudioPlayerManager` (inject the bean), so every source plugin (lavasrc, youtube) works.
    - Run it in a private player or executor whose output format is PCM 48 kHz stereo s16, not Opus.
    - Pull frames as fast as they decode. How to obtain a PCM-format executor from lavaplayer is the spike's job.
    - If a second load of a YouTube track hits rate limits, record it in the spike notes. Do not work around it silently.
  - **`AnalysisWorker`:**
    - one `ThreadPoolExecutor` thread named `mewbeat-analysis` at `Thread.MIN_PRIORITY`, with a bounded queue of `maxQueue`;
    - a 120 s hard timeout per job, which cancels the decode;
    - the HTTP thread waits on the job's future.
  - **`MetricsLog`:** logs one line per job with `identifier`, `durationMs`, `wallMs`, `realtimeFactor` (= durationMs / wallMs), `peakHeapMb` and `result`. Task 4 reads these lines.
  - **Debug route.** `GET /v4/mewbeat/debug/pcm?track=<base64>` exists only when `debugRoutes: true`. It returns a 24 kHz mono 16-bit WAV of the decode, for Task 9's preview tool. When the flag is false the route must 404.

- [ ] **Step 1: Write the failing JUnit tests**, with `TrackDecoder` mocked behind an interface.
  - `rejectsStreams`: returns 422 with reason `stream`.
  - `queueFullReturns503`: block the worker and submit `maxQueue + 1` jobs. The last one gets 503 within 100 ms.
  - `timeoutCancelsJob`: the decoder never ends. The job ends with `decode_failed` after the timeout, which is configurable down to 200 ms in the test, and the worker is free again.
  - `workerThreadIsMinPriority`: inside a job, `Thread.currentThread().getPriority() == Thread.MIN_PRIORITY`.
- [ ] **Step 2:** Run `node scripts/build-mewbeat-plugin.mjs --test`. Expected: FAIL.
- [ ] **Step 3:** Implement `AnalysisWorker`, the route and `MetricsLog`. Then implement the real `TrackDecoder`.
- [ ] **Step 4:** Run `node scripts/build-mewbeat-plugin.mjs --test`. Expected: PASS.
- [ ] **Step 5: Manual spike check (local).** Rebuild and restart Lavalink, then for 3 tracks (one YouTube, one Spotify-resolved, one SoundCloud):
  1. get an encoded track via `GET /v4/loadtracks?identifier=ytsearch:...`;
  2. POST it to `/v4/mewbeat/analyze`.

  Expected:
  - 200, with `tempo.bpm` plausible by ear;
  - the `MetricsLog` line shows `realtimeFactor` ≥ 20 on the PC;
  - analysing while the bot plays music in a voice channel causes no audible stutter.

  Write the results into `lavalink-plugins/mewbeat/SPIKE.md`, including the realtime factors and any rate-limit notes.
- [ ] **Step 6:** Commit `feat(mewbeat): analyse route with single min-priority worker`.

### Task 4: Pi decision gate (manual, with the user)

**Files:**
- Modify: `lavalink-plugins/mewbeat/SPIKE.md`, adding a "Pi benchmark" section.

- [ ] **Step 1:** Ask the user to pull `feat/mewbeat`'s jar onto the Pi's `helpers/lavalink/plugins/` and restart Lavalink there. This is the only Pi step in this plan, and it is the user's machine, so ask first.
- [ ] **Step 2:** While a track plays in a voice channel on the Pi, analyse 3 tracks of 3–5 min one after another. Read `MetricsLog` lines from `docker logs mewbit-lavalink`.
- [ ] **Step 3:** Record `wallMs`, `realtimeFactor` and `peakHeapMb`, and whether the user heard any stutter.
- [ ] **Step 4: Gate.**
  - **Pass:** every `wallMs` < 20000 and no stutter. Continue to Task 5.
  - **Fail:** stop. Bring the numbers to the user and propose options (lower FFT size or sample rate, a lower `realtimeFactor` cap via throttling, or moving DSP off the Pi). Do not continue without the user's choice.
- [ ] **Step 5:** Commit `docs(mewbeat): pi benchmark results`.

### Task 5: Audio key

**Files:**
- Create: `helpers/mewbeat/audioKey.js`.
- Test: `tests/helpers/mewbeat/audioKey.test.js`.

**Interfaces:**
- Produces:
  - `audioKeyOf(track) -> string | null`, where `track` is a poru track with `.info.{sourceName, identifier, length, isStream}`. It returns `"<sourceName>:<identifier>:<length>"`, lower-cased source, identifier unchanged.
  - It returns `null` for streams, missing identifier, or `length <= 0`.
  - `audioKeyFile(key) -> string` gives a filesystem-safe name: the sha1 hex of the key.

- [ ] **Step 1: Write the failing tests.**
  - `"youtube:dQw4w9WgXcQ:213000"` for `{ sourceName: "YouTube", identifier: "dQw4w9WgXcQ", length: 213000 }`.
  - The same identifier with a different length gives a different key.
  - `null` for `isStream: true` and for `length: 0`.
  - `audioKeyFile` returns 40 hex chars and is stable.
- [ ] **Step 2:** Run `node --test tests/helpers/mewbeat/audioKey.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mewbeat): exact-audio cache key`.

### Task 6: Analysis client with cache, dedupe and negative cache

**Files:**
- Create: `helpers/mewbeat/analysisClient.js`.
- Test: `tests/helpers/mewbeat/analysisClient.test.js`.

**Interfaces:**
- Consumes: `audioKeyOf` and `audioKeyFile` (Task 5).
- Produces: `createAnalysisClient({ dir, now = Date.now }) -> { getFeatures(track, node) -> Promise<Features | null>, peek(track) -> Features | null }`.
  - Features are cached at `<dir>/features/<audioKeyFile>.json`, written with `writeJsonAtomic`.
  - The production `dir` is `helpers/data/mewbeat`.
  - The default export `analysisClient` is created with that dir.
  - The request is `node.rest.post("/v4/mewbeat/analyze", { encodedTrack: track.track })`. Check poru's `rest.post` signature in `node_modules/poru`, and use `rest.makeRequest` if `post` is absent.
  - If the response's `audio.identifier`/`length` disagree with the track's key, return `null` and log a warning. The analysed audio isn't what we would play.
  - A negative cache in memory for failures: `now() + 10 min`, with `decode_failed` and `busy` treated alike. `uncharted` is cached on disk as `{ uncharted: true, reason }` forever.

- [ ] **Step 1: Write the failing tests**, using a temp dir, a fake `node.rest.post` and a fake clock.
  - `returnsNullForStreamsWithoutCallingLavalink`: `post` call count is 0.
  - `cachesFeaturesOnDisk`: second call → `post` called once, and the file exists.
  - `dedupesConcurrentRequests`: two `getFeatures` calls before resolve → `post` called once, both get the same object.
  - `negativeCachesFailuresFor10Minutes`: on a 502, the next call within 10 min doesn't call `post`; at +10 min + 1 ms it does.
  - `rejectsMismatchedAudio`: a response with a different `length` gives `null`.
  - `unchartedIsPermanent`: a 422 gives `null`, the file contains `uncharted: true`, and later calls don't call `post`.
- [ ] **Step 2:** Run `node --test tests/helpers/mewbeat/analysisClient.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mewbeat): cached, deduped analysis client`.

### Task 7: Chart generator

**Files:**
- Create in `helpers/mewbeat/charts/`:
  - `generate.js`
  - `difficulty.js`, holding the parameter table
  - `stars.js`
- Test:
  - `tests/helpers/mewbeat/charts.test.js`
  - `tests/helpers/mewbeat/fixtures.js`, containing `makeFeatures({ bpm, confidence, durationMs, energy: (ms) => 0..1, onsetEveryBeats })`.

**Interfaces:**
- Produces:
  - `GENERATOR_VERSION` (integer, starts at 1);
  - `generateChart(features, difficulty, audioKey) -> Chart | null`, where `difficulty` is `"easy" | "normal" | "hard"` and `null` means fewer than 20 notes;
  - `generateAll(features, audioKey) -> { easy, normal, hard } | null`, which is `null` if any difficulty is `null`;
  - `starsOf(chart) -> number`, one decimal place.
- Fixed decisions:
  - **Candidates:** the union of band onsets, merged within 30 ms. The strongest band wins and gives the base lane: low → 0, lowmid → 1, highmid → 2, high → 3.
  - **Grid:** when `tempo.confidence ≥ 0.5`, snap to the difficulty's grid from `tempo.beats`. Otherwise keep raw times and use 120-BPM-equivalent ms gaps.
  - **Density:**
    - target notes/s = `maxNps[d] × energy^1.5`, with `maxNps` = easy 2.5, normal 4.5, hard 7.0;
    - in each 2 s window, keep the strongest candidates up to the target;
    - no notes where energy < 0.08, and no notes before 1500 ms.
  - **Lanes:**
    - enforce the same-lane gap from the table by moving a note to the free lane unused for the longest (ties go to the lower index);
    - no more than 2 consecutive same-lane notes on Easy/Normal, or 3 on Hard.
  - **Chords:**
    - Easy has none.
    - Normal adds a second note only on a downbeat with strength ≥ 0.8 and energy ≥ 0.6.
    - Hard adds one on any beat with strength ≥ 0.7.
    - The second lane is the mirror (`3 - lane`), or the nearest free lane.
  - **1/8 on Hard:** only for onsets with strength ≥ 0.9.
  - **Determinism:** any tie-break that needs randomness uses mulberry32 seeded from the first 8 hex chars of sha1(audioKey).

- [ ] **Step 1: Write the failing tests.** Fixture: 120 BPM, confidence 0.9, 180 s; energy 0.3 for 0–60 s, 1.0 for 60–120 s, 0.3 for 120–180 s; onsets every 1/4 beat.
  - `isDeterministic`: two runs give a `JSON.stringify`-equal result.
  - `sameLaneGapRespected`: the minimum same-lane gap is ≥ 500 ms on Easy, ≥ 250 on Normal and ≥ 125 on Hard, with a 2 ms tolerance.
  - `chordRules`: Easy has 0 chords; Normal and Hard have none with 3+ notes at the same `t`; every Normal chord sits on a downbeat.
  - `densityOrder`: notes(easy) < notes(normal) < notes(hard).
  - `followsEnergy`: per difficulty, notes/s for 60–120 s is ≥ 2 × notes/s for 0–60 s.
  - `hardIsNotNormalPlusNoise`: the share of Hard notes whose `(t, lane)` also appears in Normal is ≤ 0.85.
  - `onGridWhenConfident`: every note `t` is within 3 ms of a 1/2-beat (Easy) or 1/4-beat (Normal) grid point.
  - `leadInAndSilence`: no note before 1500 ms. With energy 0 for 30–40 s, no note in that span.
  - `ambientIsUnchartedOrPlayable`: confidence 0.1, very few onsets, energy 0.1 throughout gives either `null` or every difficulty with ≥ 20 notes. It never gives a chart with fewer than 20 notes.
  - `starsOrder`: starsOf(easy) < starsOf(normal) < starsOf(hard).
  - `formatShape`: keys are exactly `version, audioKey, difficulty, durationMs, stars, highlightMs, notes`, notes are sorted by `t` then `lane`, and `t` is an integer.
- [ ] **Step 2:** Run `node --test tests/helpers/mewbeat/charts.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `difficulty.js` (the table and `maxNps`), `generate.js` and `stars.js`.
  - Stars start as `clamp(0.5 + 0.55 × peakNps8s + 2 × chordRatio, 0, 10)`, where `peakNps8s` is the highest notes/s over any 8 s window.
  - The formula may be tuned in Task 9. Tuning bumps `GENERATOR_VERSION`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mewbeat): deterministic three-difficulty chart generator`.

### Task 8: Chart store

**Files:**
- Create: `helpers/mewbeat/chartStore.js`.
- Test: `tests/helpers/mewbeat/chartStore.test.js`.

**Interfaces:**
- Consumes: `createAnalysisClient` (Task 6), `generateAll` and `GENERATOR_VERSION` (Task 7).
- Produces: `createChartStore({ dir, analysis }) -> { getCharts(track, node) -> Promise<{ easy, normal, hard } | null>, peekCharts(track) -> {…} | null }`.
  - The file is `<dir>/charts/<audioKeyFile>.v<GENERATOR_VERSION>.json`.
  - A file with an older version, or one that fails to parse, is ignored and regenerated. A corrupt file is moved aside with `backupCorruptFile`.
  - The default export `chartStore` uses `helpers/data/mewbeat`.
  - `getCharts(track, node)` is the single entry point later plans call.

- [ ] **Step 1: Write the failing tests**, with a fake `analysis` returning fixture features.
  - `generatesAndCaches`: second call → `generateAll` (spied) runs once.
  - `regeneratesOnVersionBump`: a pre-written `.v0.json` is ignored.
  - `corruptFileIsAMiss`: a garbage file → charts returned, and a backup file exists.
  - `nullFeaturesGiveNull`: when analysis returns `null`, `getCharts` gives `null`.
- [ ] **Step 2:** Run `node --test tests/helpers/mewbeat/chartStore.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `node --test tests/helpers/mewbeat/`. Expected: all mewbeat tests pass. Also run `pnpm test`; nothing else may break.
- [ ] **Step 5:** Commit `feat(mewbeat): versioned on-disk chart store`.

### Task 9: Chart preview tool and by-ear tuning

**Files:**
- Create: `scripts/mewbeat-preview.mjs`.
- Modify: `helpers/lavalink/application.yml` only locally, to set `debugRoutes: true`. **Do not commit that change.**
- Modify: `lavalink-plugins/mewbeat/SPIKE.md`, adding a "Tuning log" section.

**Interfaces:**
- Consumes: `generateAll` (Task 7) and the debug PCM route (Task 3).
- Produces: `node scripts/mewbeat-preview.mjs "<search query>" [--difficulty normal] [--out <dir>]`, which writes `<out>/<slug>-<difficulty>.wav`. That file is the track's decoded audio with a short click (1 kHz, 15 ms, pitched per lane) mixed in at every note. It also writes `<slug>.json` with the charts and features.
  - `out` defaults to `./.mewbeat-preview/`, which gets added to `.gitignore`.
  - Lavalink URL and password come from `.env.dev`, the same as `pnpm lavalink:dev`.

- [ ] **Step 1:** Implement the script: loadtracks → analyze → `generateAll` → fetch PCM → mix clicks → write WAV. Use the plain Node RIFF writer; no new dependencies.
- [ ] **Step 2:** Run it on 10 varied tracks: EDM, rock, hip-hop, pop, acoustic, and one with tempo changes. Listen to Normal and Hard for each.
- [ ] **Step 3:** For each track, note in the tuning log whether the notes match the music, plus any problems. Adjust the parameters in `difficulty.js` / `generate.js` and bump `GENERATOR_VERSION` per change. Keep Task 7's tests green.
- [ ] **Step 4:** Bring the tuning log and 2–3 preview WAVs to the user, and ask whether the notes feel like the music. Repeat Step 3 on their feedback. **Done when the user says it matches.** This is anti-goal 1, so a self-check alone is not enough.
- [ ] **Step 5:** Commit `feat(mewbeat): chart preview tool and tuned generator`.
