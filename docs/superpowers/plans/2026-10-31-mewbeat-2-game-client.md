# mewbeat Plan 2/4: Single-player game client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A desktop Discord user unlocks mewbeat with the Konami code, opens it from the player, and plays the current bot track live (4 lanes, judged, scored, with FEVER, Mewbit and a HUD), in sync with what they hear, with their own persisted settings.

**Architecture:**
- The bot gets a small `mewbeat_*` message channel on the existing Activity WebSocket.
  - `mewbeat_sync` is one round trip that gives the client both an NTP-style clock sample and a fresh song-time anchor.
  - `mewbeat_chart` returns one difficulty's chart for the current track from the plan 1 `chartStore`.
- Unlock state and settings live in user preferences and reach the client inside the normal per-user Activity state.
- The client builds the game from pure, Node-testable ESM modules:
  - judge;
  - scoring;
  - clock;
  - run controller;
  - Konami matcher.
- The pure modules drive a Canvas 2D highway on `requestAnimationFrame` and a React HUD that updates on judgement events, not per frame.
- Plan 2 is solo and unranked. It follows whatever the bot is playing and has no sessions, lobby, score submission or leaderboards; those are plans 3 and 4.

**Tech Stack:**
- Bot: Node 24 CommonJS, `ws`, `node:test`.
- Activity: React 19, Vite 8, `motion` 13, `@phosphor-icons/react`, Canvas 2D, Web Audio (hit sounds), `@discord/embedded-app-sdk` (`sdk.platform`).

**Spec:** `docs/superpowers/specs/2026-10-31-mewbeat-rhythm-game-design.md`. Mockups: `docs/superpowers/specs/mewbeat-mockups/game-screen-v3.html`, which is layout C and the visual reference for Tasks 8–9. Its copy is Polish; ours is English.

**Builds on:** Plan 1 (`docs/superpowers/plans/2026-10-31-mewbeat-1-charts-pipeline.md`):
- `helpers/mewbeat/chartStore.js` exports `chartStore.getCharts(track, node)`, which resolves to one of:
  - `{status:"ready", charts:{easy,normal,hard}}`;
  - `{status:"pending"}`;
  - `{status:"uncharted", reason}`;
  - `{status:"failed"}`.

  It also exports `peekCharts(track)`.
- `helpers/mewbeat/audioKey.js` exports `audioKeyOf(track)`. It returns `source:identifier:length`, or `null` for streams and unknown length.
- A chart has the shape `{version, audioKey, difficulty, durationMs, stars, highlightMs, notes:[{t, lane}]}`:
  - `t` is in integer ms;
  - `lane` is 0–3;
  - notes are sorted by `t`, with chords sharing a `t`.

## Global Constraints

- **Branch:**
  - Work happens on branch `feat/mewbeat` only. Never merge or push to `main`.
  - Never commit `.impeccable/config.json`, `.superpowers/`, `helpers/lavalink/plugins/youtube-plugin-*.jar` or `helpers/lavalink/application.yml`.
  - Stage files explicitly; never `git add -A` or `git add .`.
- **Language:** all game UI copy is English.
- **Gameplay values (spec, verbatim):**
  - Judgement windows, as absolute error after offset: PERFECT ≤ 45 ms, GREAT ≤ 90, GOOD ≤ 135, otherwise MISS.
  - A press with no note within the GOOD window does nothing; there is no ghost-tap penalty.
  - Base points: PERFECT 300, GREAT 200, GOOD 100, MISS 0.
  - Multiplier: `mult = min(4, 1 + floor(combo / 10))`. A MISS resets the combo.
  - Score per hit: `base × mult × (fever ? 2 : 1)`.
  - Vibe: +0.03 PERFECT, +0.02 GREAT, +0.01 GOOD, −0.06 MISS, clamped to 0–1.
  - FEVER: activated with Space when vibe is full. It lasts 8 s of double points, and vibe drains over those 8 s.
  - Accuracy weights: PERFECT 100, GREAT 66.7, GOOD 33.3, MISS 0.
  - Grade: S ≥ 95, A ≥ 90, B ≥ 80, C ≥ 70, otherwise D.
- **Settings (spec, per account, server-side):**

  | Setting | Default | Rule |
  |---|---|---|
  | Keys | D F J K | Any 4 distinct keys; Space is reserved for FEVER |
  | Offset | 0 ms | |
  | Scroll speed | mid | |
  | Live difficulty | Normal | |
  | Effects | Full | Full / Reduced / Off; `prefers-reduced-motion` forces at most Reduced |
  | Hit sounds | Off | Played locally in the client only, never through the bot |

  Unlock state (`unlocked`, `unlockedAt`) lives in the same record.
- **Entry:**
  - The Konami code is ↑ ↑ ↓ ↓ ← → ← → B A, typed anywhere in the Activity, on desktop only.
  - The reveal is a glitch plus Mewbit saying "you found me!".
  - The unlock is permanent and server-side.
  - After unlocking, a mewbeat button appears in the player.
  - On mobile there is no button and no listener.
- **Timing (spec):**
  - Anchors (position plus server timestamp) arrive on start, seek and resume, and periodically.
  - The clock offset is the median of several ping/pong samples.
  - `performance.now()` is mapped to song time.
  - Judgements use `KeyboardEvent.timeStamp`.
  - Rendering runs on rAF.
  - A per-user offset is applied.
- **Mewbit:**
  - The placeholder is the current Mewbit image (`docs/superpowers/specs/mewbeat-mockups/mewbit.png`) with CSS motion.
  - Poses come from a manifest, so frame sequences can replace them later without code changes beyond the manifest.
- **Visual tokens** come from `activity/src/styles.css`:

  | Token | Value |
  |---|---|
  | bg | #050608 |
  | surface | #0c0e12 |
  | raised | #111318 |
  | high | #161920 |
  | text | #f4f6f9 |
  | muted | #9ba4b2 |
  | faint | #667081 |
  | cyan | #67e3f4 |
  | violet | #a78bfa |
  | pink | #ff6ec7 |
  | danger | #ff8098 |
  | gold | #ffd479 |

  - Fonts are Hanken Grotesk and JetBrains Mono.
  - No zero-offset glow.
  - Arcade-loud but original.
- **Anti-goal 4:** nothing in this plan pauses, skips, seeks or changes volume on the bot. Every mewbeat action is per-user.
- **Code style:**
  - Bot code is CommonJS, uses `Log` from `helpers/logs/log`, and has tests in `tests/helpers/mewbeat/` in the style of the existing tests there.
  - Activity code is ESM under `activity/src/mewbeat/`.
  - Pure modules are tested from CommonJS via dynamic `import(pathToFileURL(path.resolve(__dirname, "../../activity/src/mewbeat/<file>.js")).href)`, following `tests/activity/musicLink.test.js`. Those tests live in `tests/activity/mewbeat/`.
  - Match the surrounding code's comment density and idiom.
- **Test commands:**
  - Full suite: `npm test`. It must stay green.
  - Activity build: `npm --prefix activity run build`. It must succeed for every task that touches `activity/`.

## Review Focus

1. **Track changes mid-game:** skip, the next track starting, or `audioKey` changing.
   - The run ends cleanly and the end card shows.
   - A chart for the old key is never judged against the new audio.
   - Late chart replies for a stale key are dropped.
   - Tests are in Task 2 (`stale`) and Task 6 (link drops stale replies).
2. **Pause, resume and seek by someone else in the room.**
   - On pause, notes freeze and no misses are swept while paused.
   - A seek of more than 250 ms snaps the clock. Notes passed by the jump become `skipped`, not MISS.
   - Tests are in Task 4 (snap and pause) and Task 5 (skipped on forward jump).
3. **Starting mid-song (live join).**
   - Notes earlier than `startMs + 1000` are `skipped`.
   - Accuracy and grade count only judged notes.
   - A run with zero judged notes shows "—", never NaN.
   - Tests are in Task 3 and Task 5.
4. **Key handling:**
   - Auto-repeat (`event.repeat`) never produces a second hit.
   - Keys pressed while typing in an input do nothing.
   - The App's global shortcuts (Space, n, p, q, l, /) never fire while the game is open.
   - Rebinding refuses duplicates and Space.
   - Tests are in Task 1 (server validation), Task 7 (shortcut suppression) and Task 8 (repeat ignored).
5. **No live gateway or no track playing** (local preview, a dropped socket, an idle bot).
   - The game shows a clear English state ("Nothing is playing", "Reconnecting…") instead of a frozen highway.
   - It recovers on its own when sync replies resume.
   - Tests are in Task 6 (link reports `offline` after 3 s without replies) and Task 8 (screen state per link status).

---

### Task 1: Server — unlock and settings in user preferences

**Files:**
- Create: `helpers/mewbeat/userSettings.js`
- Modify: `helpers/activity/server.js`:
  - `buildActivityState` (around line 498) gains a `mewbeat` field;
  - `runActivityAction` gains cases `mewbeat_unlock` and `mewbeat_settings`, next to `set_lyrics_offset` (around line 948).
- Test: `tests/helpers/mewbeat/userSettings.test.js`, and new cases in `tests/helpers/activity/gateway.test.js`.

**Interfaces:**
- Produces (CommonJS, `helpers/mewbeat/userSettings.js`):
  - `DEFAULT_SETTINGS`, frozen: `{ keys: ["KeyD","KeyF","KeyJ","KeyK"], offsetMs: 0, scrollSpeed: 5, liveDifficulty: "normal", effects: "full", hitSounds: false }`.
    - Keys are `KeyboardEvent.code` values, so they work on any keyboard layout.
  - `LIMITS = { offsetMs: [-300, 700], scrollSpeed: [1, 10] }`.
  - `RESERVED_CODES = ["Space", "Escape"]`. Space is FEVER; Escape leaves the game.
  - `normalizeSettings(raw) -> settings`:
    - Lenient: it is used on stored data. Each invalid or missing field falls back to its default.
    - It never throws.
  - `validateSettingsPatch(patch, current) -> settings`:
    - Strict: it is used on client input. It merges `patch` onto `current` and returns the full settings.
    - It throws `Object.assign(new Error(msg), { statusCode: 400 })` on:
      - an unknown field;
      - `keys` that are not 4 distinct strings matching `/^[A-Za-z0-9]{1,32}$/`, or that contain a reserved code;
      - a non-integer or out-of-range `offsetMs` or `scrollSpeed`;
      - `liveDifficulty` not in easy, normal or hard;
      - `effects` not in full, reduced or off;
      - a non-boolean `hitSounds`.
    - Messages are English, for example "Pick four different keys.".
  - `getMewbeatRecord(userId) -> { unlocked: boolean, unlockedAt: number|null, settings }`. It reads `userPreferences.getUserPreferences(userId).mewbeat`, normalized.
  - `unlockMewbeat(userId, now = Date.now()) -> record`. It is idempotent: the first `unlockedAt` is kept.
  - `updateMewbeatSettings(userId, patch) -> record`. It throws `statusCode: 403` with "Unlock mewbeat first." when the user is not unlocked.
  - All writes go through `userPreferences.setUserPreference(userId, "mewbeat", record)`.
- Produces (state): `buildActivityState(...)` returns `mewbeat: { unlocked, settings }`. `unlockedAt` is not exposed.
- Produces (actions):
  - `mewbeat_unlock` returns `{ mewbeat: { unlocked, settings } }`.
  - `mewbeat_settings` takes payload `{ settings: patch }` and returns the same shape.
  - Neither action is in the DJ- or voice-guarded action sets.

- [ ] **Step 1: Write the failing tests.**
  - `userSettings.test.js` has these tests:
    - `normalizeSettings({})` deep-equals `DEFAULT_SETTINGS`.
    - `normalizeSettings({ offsetMs: 9999, keys: ["KeyA","KeyA","KeyB","KeyC"], effects: "neon" })` gives `offsetMs` 0, the default keys and `effects` "full".
    - `validateSettingsPatch({ keys: ["KeyA","KeyS","KeyK","KeyL"] }, DEFAULT_SETTINGS).keys` deep-equals that array.
    - `validateSettingsPatch` throws with `statusCode` 400 for each of:
      - duplicate keys;
      - `["Space","KeyF","KeyJ","KeyK"]`;
      - 3 keys;
      - `offsetMs: 701`;
      - `offsetMs: 1.5`;
      - `scrollSpeed: 0`;
      - `liveDifficulty: "expert"`;
      - `hitSounds: "yes"`;
      - `{ colour: 1 }`.
    - `unlockMewbeat` called twice keeps the first `unlockedAt`. Pass `now` 1000 and then 2000; the result is 1000.
    - `updateMewbeatSettings` on a locked user throws `statusCode` 403.
  - To isolate preferences, reuse whatever reset or temp-dir hook the existing preferences tests use. Look in `tests/helpers/users/`.
  - `gateway.test.js` gets one test over the existing WebSocket harness (around line 196). Over the socket it sends:
    1. `action mewbeat_settings` before unlocking. It must get an error.
    2. `action mewbeat_unlock`. The next `state` must have `state.mewbeat.unlocked === true`.
    3. `action mewbeat_settings { settings: { offsetMs: 40 } }`. The next `state` must have `state.mewbeat.settings.offsetMs === 40`.

    Then assert that `getActivityEvents(guildId)` contains no entry mentioning mewbeat. The easter egg must not show up in the room feed.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/helpers/mewbeat/userSettings.test.js tests/helpers/activity/gateway.test.js`
  - Expected: FAIL, because the module is not found and the unknown action is refused.
- [ ] **Step 3: Implement `helpers/mewbeat/userSettings.js` and the `server.js` wiring.**
  - If `helpers/activity/feed.js` `actionDetail` would produce a feed line for these actions, make it return `null` for them.
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run the same command, then `npm test`.
  - Expected: PASS, with the suite count increased.
- [ ] **Step 5: Commit.**

```bash
git add helpers/mewbeat/userSettings.js helpers/activity/server.js tests/helpers/mewbeat/userSettings.test.js tests/helpers/activity/gateway.test.js
git commit -m "feat(mewbeat): per-account unlock and settings"
```

(Add `helpers/activity/feed.js` only if Step 3 changed it.)

---

### Task 2: Server — `mewbeat_sync` and `mewbeat_chart` over the Activity socket

**Files:**
- Create: `helpers/mewbeat/activityChannel.js`
- Modify: `helpers/activity/server.js`. In the socket `message` handler (around line 1236), after the `authorized` check, route every `message.type` starting with `"mewbeat_"` to the channel and `sendSocket` its reply.
- Test: `tests/helpers/mewbeat/activityChannel.test.js`

**Interfaces:**
- Consumes:
  - `chartStore.getCharts(track, node)` and `audioKeyOf(track)` from plan 1;
  - `getMewbeatRecord(userId)` from Task 1;
  - `getActivityPosition(player, state, durationMs, now)`, `resolveActivityPlayback`, `playbackState` and `getPlayer` from `server.js`.
- Produces (CommonJS): `createMewbeatChannel({ readPlayback, chartStore, isUnlocked, now = Date.now })`, which returns `{ handle(guildId, userId, message) -> Promise<reply|null> }`.
  - `readPlayback(guildId)` returns `{ track, node, positionMs, paused, durationMs } | null`.
    - `server.js` builds it from `playbackState.get(guildId)`, `resolveActivityPlayback`, `getActivityPosition(player, state, durationMs, now())` and `getPlayer(guildId)?.node`.
    - It returns `null` when there is no track.
  - `isUnlocked(userId)` is `getMewbeatRecord(userId).unlocked`.
  - Unknown `mewbeat_*` types reply `{ type: "error", error: "Unknown mewbeat message." }`.
- Wire protocol (client to server, then server to client):
  - **Sync.** The client sends `{ type: "mewbeat_sync", id, clientSentAt }`.
    - `id` is a string of at most 40 characters, echoed back.
    - `clientSentAt` is a finite number, echoed back.

    The server replies `{ type: "mewbeat_sync", id, clientSentAt, serverNow, anchor }`. The anchor is either `{ audioKey, positionMs, at: serverNow, paused, durationMs }` or `null` when nothing plays or `audioKeyOf` is null.
    - `positionMs` is rounded to an integer.
    - Sync does not require the unlock.
  - **Chart.** The client sends `{ type: "mewbeat_chart", audioKey, difficulty }`.
    - When the user is locked, the server replies `{ type:"error", error:"Unlock mewbeat first." }`.
    - When `difficulty` is not easy, normal or hard, it replies with an error.
    - When the current track's `audioKey` differs from the requested one, or nothing plays, it replies `{ type:"mewbeat_chart", audioKey, difficulty, status:"stale" }`.
    - Otherwise it awaits `getCharts(track, node)` and replies `{ type:"mewbeat_chart", audioKey, difficulty, status, reason?, chart? }`, where `chart` is `charts[difficulty]` and is present only when the status is `"ready"`.
  - Rate limit: `server.js` applies `consumeRateLimit(`ws-mewbeat:${identity.id}`, { limit: 600, windowMs: 60_000 })` before calling the channel, separate from the action limit.

- [ ] **Step 1: Write the failing tests** with fake `readPlayback`, `chartStore` and `now`:
  - The `sync` reply echoes `id` and `clientSentAt`, has `serverNow` equal to `now()`, and has an anchor of `{ audioKey: "youtube:abc:200000", positionMs: 61234, at: now(), paused: false, durationMs: 200000 }` for a fake track with `info { sourceName:"youtube", identifier:"abc", length:200000 }`.
  - `sync` with no playback gives `anchor: null`.
  - `sync` with a stream track (`info.isStream: true`) gives `anchor: null`.
  - `chart` for a locked user gives the error reply, and `getCharts` is not called.
  - `chart` with a mismatched `audioKey` gives `status:"stale"`, and `getCharts` is not called.
  - `chart` when the result is ready gives a reply with `chart` that deep-equals the fake `charts.hard` for `difficulty:"hard"`, and has no `charts` key.
  - `chart` when the result is `{status:"uncharted", reason:"too_few_notes"}` passes the status and reason through, with no `chart`.
  - `chart` with `difficulty:"expert"` gives an error.
  - An unknown type `mewbeat_dance` gives the error reply.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/helpers/mewbeat/activityChannel.test.js`
  - Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement `activityChannel.js` and the `server.js` routing.**
  - `server.js` constructs one channel at module level with the real `chartStore` (`require("../mewbeat/chartStore").chartStore`).
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run the same command, then `npm test`.
  - Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add helpers/mewbeat/activityChannel.js helpers/activity/server.js tests/helpers/mewbeat/activityChannel.test.js
git commit -m "feat(mewbeat): sync and chart messages on the activity socket"
```

---

### Task 3: Client — judge and scoring (pure)

**Files:**
- Create: `activity/src/mewbeat/scoring.js`, `activity/src/mewbeat/judge.js`
- Test: `tests/activity/mewbeat/scoring.test.js`, `tests/activity/mewbeat/judge.test.js`

**Interfaces:**
- Produces (`scoring.js`):
  - Constants:
    - `WINDOWS = { perfect: 45, great: 90, good: 135 }`;
    - `BASE_POINTS = { perfect: 300, great: 200, good: 100, miss: 0 }`;
    - `VIBE_DELTA = { perfect: 0.03, great: 0.02, good: 0.01, miss: -0.06 }`;
    - `ACCURACY_WEIGHT = { perfect: 100, great: 66.7, good: 33.3, miss: 0 }`;
    - `FEVER_MS = 8000`.
  - `judgementFor(absErrorMs) -> "perfect"|"great"|"good"|null`. Boundaries are inclusive: 45 is perfect and 45.01 is great.
  - `multiplierFor(combo) -> 1..4`.
  - `createScore() -> { score:0, combo:0, maxCombo:0, vibe:0, feverUntil:null, fevers:0, counts:{perfect:0,great:0,good:0,miss:0} }`.
  - `applyJudgement(state, judgement, songMs) -> newState`. It is immutable. It uses the multiplier from the combo **before** this hit is added. During FEVER (`songMs < feverUntil`), points ×2 and vibe gains are ignored.
  - `canFever(state, songMs) -> boolean`. It is true when `vibe >= 1` and FEVER is not active.
  - `startFever(state, songMs) -> newState`. It sets `feverUntil = songMs + FEVER_MS`, increments `fevers`, and returns the state unchanged when `!canFever`.
  - `vibeAt(state, songMs) -> 0..1`. During FEVER it drains linearly from 1 to 0. Once FEVER has ended, the stored vibe is 0.
    - Implementation: when `applyJudgement` or `vibeAt` sees `songMs >= feverUntil`, it treats the vibe as 0 and clears `feverUntil`.
  - `accuracyOf(counts) -> number|null`. It returns the weighted mean, rounded to 2 decimals, or `null` when no notes were judged.
  - `gradeOf(accuracy) -> "S"|"A"|"B"|"C"|"D"|null`.
- Produces (`judge.js`): `createJudge(notes, { fromMs = 0 } = {})`, which returns:
  - `press(lane, songMs) -> { index, judgement, errorMs } | null`.
    - It picks the **earliest** unjudged, unskipped note in `lane` with `|songMs - t| <= 135`.
    - `errorMs = songMs - t`, signed: positive means late.
    - It returns `null` when there is no such note (a ghost tap).
  - `sweep(songMs) -> Array<{ index, judgement:"miss", errorMs:null }>`. It marks as missed every unjudged note with `t + 135 < songMs`, and returns those notes in index order.
  - `skipBefore(songMs) -> number`. It marks every unjudged note with `t < songMs` as skipped (used for live join and forward seeks) and returns how many it skipped.
  - `remaining() -> number`. Notes neither judged nor skipped.
  - `outcomeOf(index) -> "pending"|"skipped"|judgement`.
  - At construction the judge calls `skipBefore(fromMs)`.
  - Per-lane cursors keep `press` and `sweep` amortized O(1). Never scan the whole chart per frame.

- [ ] **Step 1: Write the failing tests.**
  - Scoring:
    - Judgement boundaries: 0 is perfect, 45 perfect, 46 great, 90 great, 135 good, 136 null.
    - `multiplierFor` for 0, 9, 10, 29, 30 and 99 gives 1, 1, 2, 3, 4 and 4.
    - Ten PERFECTs from a fresh score give score 3000. The 11th gives +600.
    - A MISS after combo 25 gives combo 0, vibe reduced by 0.06, and `maxCombo` 25.
    - Vibe clamps at 1 after 40 PERFECTs and at 0 after misses from 0.
    - `startFever` at vibe 1, songMs 10000, gives `feverUntil` 18000. A PERFECT at 12000 with combo 0 gives +600 (300 × 1 × 2). `vibeAt(…, 14000)` is 0.5. A hit at 18000 gives no ×2.
    - `startFever` at vibe 0.99 returns the same state.
    - `accuracyOf({perfect:1,great:1,good:1,miss:1})` is 50. The mean is (100+66.7+33.3+0)/4.
    - `accuracyOf` of all zeros is `null`.
    - `gradeOf` for 95, 94.99, 90, 80, 70 and 69.99 gives S, A, A, B, C and D. `gradeOf(null)` is `null`.
  - Judge:
    - With notes `[{t:1000,lane:0},{t:1100,lane:0},{t:1000,lane:1}]`, `press(0, 1050)` judges index 0 (the earliest), not index 1, with `errorMs` 50 and judgement "great".
    - `press(2, 1000)` is `null`.
    - `sweep(1136)` returns index 2 as a miss but not index 1. `sweep(1236)` returns index 1.
    - `createJudge(notes, {fromMs: 1050})` gives `outcomeOf(0)` "skipped", `outcomeOf(1)` "pending" and `remaining()` 1.
    - A chord at `t:2000` in lanes 0 and 3 can be hit by both lanes.
    - Pressing the same lane twice within the window judges two different notes, never the same note twice.
    - A performance guard: 5000 notes, then `sweep` called at 1 ms steps across the song, finishes in under 200 ms.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/activity/mewbeat/scoring.test.js tests/activity/mewbeat/judge.test.js`
  - Expected: FAIL, because the modules are not found.
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run the same command.
  - Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/mewbeat/scoring.js activity/src/mewbeat/judge.js tests/activity/mewbeat/scoring.test.js tests/activity/mewbeat/judge.test.js
git commit -m "feat(mewbeat): note judge and scoring rules"
```

---

### Task 4: Client — server clock and song clock (pure)

**Files:**
- Create: `activity/src/mewbeat/clock.js`
- Test: `tests/activity/mewbeat/clock.test.js`

**Interfaces:**
- Produces `createServerClock({ maxSamples = 16, bestOf = 5 } = {})`:
  - `addSample({ clientSentAt, serverNow, clientReceivedAt })`. The client times are `performance.now()` ms.
    - `rtt = received - sent`.
    - `offset = serverNow - (sent + received) / 2`.
    - Samples with negative `rtt`, or `rtt` over 2000, are ignored.
  - `offsetMs() -> number|null`. The median offset of the `bestOf` lowest-rtt samples among the last `maxSamples`. It is `null` before any sample.
  - `ready() -> boolean`. True once there are at least 3 samples.
  - `serverTimeAt(perfMs) -> number`. Equals `perfMs + offsetMs()`.
- Produces `createSongClock(serverClock, { snapMs = 250, slewMs = 600 } = {})`:
  - `setAnchor(anchor) -> "init"|"slew"|"snap"|"keyChange"|"pause"|"resume"|"clear"`, where `anchor` is `{ audioKey, positionMs, at, paused, durationMs } | null`.
    - Compare the new anchor's predicted position with the current clock's at the same server time:
      - a different `audioKey` gives `keyChange`, and `null` gives `clear`;
      - a change in the paused flag gives `pause` or `resume`, and the clock rebases immediately;
      - `|delta| > snapMs` gives `snap`, with an immediate rebase;
      - otherwise `slew`: the correction is spread linearly over `slewMs` of perf time, so the song time never jumps or runs backwards.
    - The first anchor gives `init`.
  - `songTimeAt(perfMs) -> number|null`. Null with no anchor.
    - When paused, it is `positionMs`.
    - Otherwise it is `positionMs + (serverTimeAt(perfMs) - at)` plus the remaining slew correction, clamped to `[0, durationMs]`.
  - `audioKey() -> string|null`, `paused() -> boolean`.
- The user offset is **not** applied here. Task 5 applies it.

- [ ] **Step 1: Write the failing tests** with synthetic numbers:
  - Server clock:
    - With `bestOf: 3` and samples (offset, rtt) of (100, 10), (102, 12), (98, 14), (500, 900) and (101, 11), the 3 lowest-rtt samples are 100, 101 and 102, so `offsetMs()` is 101. The 500/900 outlier is excluded.
    - `ready()` is false with 2 samples and true with 3.
  - Song clock (fake server clock with a fixed offset of 0):
    - Anchor `{positionMs:1000, at:5000, paused:false}` at perf 5000 gives `songTimeAt(5500)` 1500.
    - Paused gives `songTimeAt` constant.
    - A second anchor 30 ms ahead of prediction returns "slew". Song time is monotonic over 0–600 ms of perf time in 1 ms steps, and it converges to the new line by `slewMs`.
    - An anchor 2000 ms ahead returns "snap", and the song time jumps.
    - A different `audioKey` returns "keyChange".
    - `null` returns "clear", and `songTimeAt` is null.
    - The result is clamped at `durationMs`.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/activity/mewbeat/clock.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement `clock.js`.**
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/mewbeat/clock.js tests/activity/mewbeat/clock.test.js
git commit -m "feat(mewbeat): server clock offset and song-time anchors"
```

---

### Task 5: Client — run controller (pure)

**Files:**
- Create: `activity/src/mewbeat/run.js`
- Test: `tests/activity/mewbeat/run.test.js`

**Interfaces:**
- Consumes `createJudge` and the scoring functions from Task 3.
- Produces `createRun({ chart, startSongMs, offsetMs = 0, autoplay = false })`.
  - **Heard time:** `heard = songMs - offsetMs`. Every judge, sweep and fever call uses heard time. A positive offset means the audio reaches the player later than the server position.
  - The judge is built with `fromMs: heard(startSongMs) + 1000`.
  - `ranked` is always `false` in plan 2.
  - The run returns these methods:
    - `press(lane, songMs) -> event|null`. On a hit it returns `{ kind:"hit", lane, judgement, errorMs, index }`. It returns `null` for a ghost tap or when the run has ended.
    - `tick(songMs) -> event[]`. It returns `{kind:"miss", lane, index}` for swept notes. When autoplay is on, it returns `{kind:"hit", judgement:"perfect", errorMs:0, …}` for every note whose `t <= heard`.
      - It also emits `{kind:"feverEnd"}` once, when FEVER expires.
      - It emits `{kind:"end"}` once, when `remaining() === 0` and `heard > lastNote.t + 135`.
    - `fever(songMs) -> event|null`. It returns `{kind:"fever"}` when FEVER starts.
    - `jump(songMs)`. Called by the screen on a snap; it skips notes before `heard(songMs) + 300`.
    - `snapshot(songMs) -> { score, combo, maxCombo, multiplier, vibe, feverActive, feverLeftMs, accuracy, grade, counts, fevers, judged, total, ranked:false, hits:[{index, errorMs}] }`.
    - `visibleNotes(fromHeardMs, toHeardMs) -> Array<{ t, lane, outcome }>`. It is used by the renderer. It must binary-search the start index, not filter the whole array.
    - `heardTime(songMs) -> number`.

- [ ] **Step 1: Write the failing tests** with a small synthetic chart of 40 notes, 250 ms apart from `t:2000`, lanes cycling 0–3:
  - `startSongMs: 4500` skips every note before 5500. `total - judged` counts only notes from 5500 onwards.
  - `offsetMs: 100`: pressing lane 0 at songMs 2100 hits `t:2000` with `errorMs` 0.
  - Autoplay ticking from 0 to 15000 in 16 ms steps gives every judged note perfect, accuracy 100, grade S, and exactly one `end` event.
  - With no presses, ticking to 15000 gives 40 misses, accuracy 0, grade D and combo 0.
  - Pressing after `end` returns null.
  - `jump(9000)` mid-run: the notes in 9000–9300 are skipped, and none of them appears as a miss on later ticks.
  - FEVER: with autoplay up to vibe 1, `fever` returns a fever event. `snapshot().feverActive` is true. Exactly one `feverEnd` arrives 8000 ms of heard time later.
  - `visibleNotes(3000, 4000)` returns exactly the notes with `3000 <= t <= 4000`.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/activity/mewbeat/run.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement `run.js`.**
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/mewbeat/run.js tests/activity/mewbeat/run.test.js
git commit -m "feat(mewbeat): run controller with offset, fever and autoplay"
```

---

### Task 6: Client — socket plumbing, mewbeat link and mock link

**Files:**
- Modify: `activity/src/api.js` (`connectActivitySocket`, around line 66).
- Create: `activity/src/mewbeat/link.js`, `activity/src/mewbeat/mockLink.js`
- Test: `tests/activity/mewbeat/link.test.js`

**Interfaces:**
- `connectActivitySocket({ ..., onMewbeat })`:
  - Messages whose `type` starts with `"mewbeat_"` go to `onMewbeat(payload)`.
  - Error messages also still go to `onError`.
  - The returned stop function gains a property `stop.send(payload) -> boolean`, which is true when the socket was open. Existing callers keep working unchanged.
- `createMewbeatLink({ send, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, serverClock, songClock })`:
  - `serverClock` and `songClock` come from Task 4.
  - `start()`:
    1. Sends a burst of 6 `mewbeat_sync` messages, 120 ms apart.
    2. Then sends one every 1000 ms. Each `id` is `"s" + counter`, and `clientSentAt = now()`.
    3. Rejects replies whose `id` was not sent by this link.
  - `stop()` clears all timers.
  - `handle(payload)`: on a sync reply it calls `serverClock.addSample(...)`, then `songClock.setAnchor(payload.anchor)`, and notifies the anchor listeners with the `setAnchor` result.
  - `syncNow()` sends one extra sync immediately. The screen calls it when Activity state reports a pause, resume or seek.
  - `requestChart(audioKey, difficulty) -> void`:
    - It is deduped per `audioKey:difficulty` while in flight.
    - On `status:"pending"` it retries after 3000 ms.
    - It drops replies whose `audioKey` differs from `songClock.audioKey()`.
    - It notifies the chart listeners with `{ audioKey, difficulty, status, reason, chart }`.
  - `onAnchor(fn) -> unsubscribe` and `onChart(fn) -> unsubscribe`.
  - `status() -> "connecting"|"live"|"offline"`. It becomes `offline` when 3000 ms pass with no sync reply. It returns to `live` on the next reply.
  - `onStatus(fn) -> unsubscribe`.
- `createMockLink({ now })` has the same surface. Used only when `?mock=1` (the App's existing `MOCK_PREVIEW` flag):
  - a fake 150 s track `mock:demo:150000` that starts at link start;
  - a deterministic synthetic chart: 120 BPM, notes on beats, lanes cycling `[0,1,2,3,2,1]`, a 2-note chord every 8th beat, all difficulties identical;
  - status `live` immediately.

  It lets the game run in a browser with no bot.

- [ ] **Step 1: Write the failing tests** for `createMewbeatLink` with a fake `send` that captures messages, fake timers, and fake clocks recording calls:
  - `start` sends 6 syncs at 0, 120, …, 600, then 1 per 1000 ms.
  - A reply with an unknown `id` is ignored.
  - A valid reply calls `addSample` with the matching `clientSentAt`, then `setAnchor`.
  - Two `requestChart("k","normal")` calls give one send.
  - A pending reply leads to a resend after 3000 ms.
  - A reply for audioKey "old" when `songClock.audioKey()` is "new" leads to no chart listener call.
  - No reply for 3000 ms gives status "offline". A later reply gives "live".
  - After `stop`, no timer fires a send.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/activity/mewbeat/link.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement `link.js`, `mockLink.js` and the `api.js` change.**
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run the same command, then `npm test` and `npm --prefix activity run build`.
  - Expected: PASS, and the build succeeds.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/api.js activity/src/mewbeat/link.js activity/src/mewbeat/mockLink.js tests/activity/mewbeat/link.test.js
git commit -m "feat(mewbeat): sync and chart link over the activity socket"
```

---

### Task 7: Entry — Konami unlock, reveal, Mewbit placeholder, player button

**Files:**
- Create:
  - `activity/src/mewbeat/konami.js`
  - `activity/src/mewbeat/platform.js`
  - `activity/src/mewbeat/mewbit/manifest.js`
  - `activity/src/mewbeat/mewbit/Mewbit.jsx`
  - `activity/src/mewbeat/mewbit/mewbit.png`, copied from `docs/superpowers/specs/mewbeat-mockups/mewbit.png`
  - `activity/src/mewbeat/UnlockReveal.jsx`
  - `activity/src/mewbeat/MewbeatGame.jsx` (a stub in this task; Task 8 replaces it)
  - `activity/src/mewbeat/mewbeat.css`
- Modify:
  - `activity/src/App.jsx`:
    - Konami listener;
    - a reveal overlay;
    - a mewbeat `IconButton` in the top nav group (around line 2487);
    - a lazy `MewbeatGame` overlay host;
    - the global shortcut handler (around line 2401), which returns early while the game is open;
    - passes `onMewbeat` and keeps the socket's `send`.
  - `activity/src/mockState.js`: add `mewbeat: { unlocked: true, settings: <defaults> }`.
- Test: `tests/activity/mewbeat/konami.test.js`, `tests/activity/mewbeat/platform.test.js`

**Interfaces:**
- `createKonamiMatcher() -> { push(key) -> boolean }`.
  - The sequence is `["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"]`, compared case-insensitively on `KeyboardEvent.key`.
  - On a mismatch, progress falls back to the longest prefix that is still a suffix of the input, so "↑ ↑ ↑ ↓ ↓ …" still completes.
  - It resets after a completion.
- `isDesktopClient(context) -> boolean`. True for `context.mode === "local"` or `context.sdk?.platform === "desktop"`.
- `MEWBIT_POSES`: a manifest object keyed by pose name. Each entry is `{ kind:"placeholder", motion:"<css class>", bubble?: string }`. A later entry may be `{ kind:"frames", frames:[url…], fps }`.
  - The pose names are the spec's game and unlock poses: `neutral`, `vibe1`, `vibe2`, `vibe3`, `miss`, `crushed`, `milestone`, `fever`, `charting`, `reveal`.
  - Bubbles: vibe1 "nyaa~!", vibe2 "wooo!!", vibe3 "SUGOI!!", fever "FEVER!!! ✦", miss "eep!", crushed "nyoo… ;-;", charting "charting…", reveal "you found me!".
- `<Mewbit pose="..." effects="full|reduced|off" />` renders from the manifest. With effects off it shows no motion and keeps the bubble. It also honours `prefers-reduced-motion`.
- `<UnlockReveal onDone onPlay />`:
  - a full-screen glitch over the Activity, about 600 ms (CSS clip-path or translate slices plus a chromatic split, no zero-offset glow);
  - then Mewbit with the `reveal` pose and the title "mewbeat unlocked";
  - buttons "Play now" and "Later".
  - With reduced effects it skips the glitch and fades in.
- App behaviour:
  - The Konami listener is attached only when `isDesktopClient(context)`.
  - Keys are ignored while typing in an input, textarea, select or contenteditable.
  - On completion:
    - when the user is not unlocked, send `onAction("mewbeat_unlock")` and show `UnlockReveal`;
    - when the user is already unlocked, open the game directly.
  - The mewbeat button (label "mewbeat", Phosphor `GameController`) shows when `state.mewbeat?.unlocked && isDesktopClient(context)`.
  - The game overlay is `lazy(() => import("./mewbeat/MewbeatGame.jsx"))` and is mounted only while open. Task 8 creates the file; in this task it is a stub that renders a "mewbeat" placeholder panel with a Close button.

- [ ] **Step 1: Write the failing tests.**
  - Konami:
    - The exact sequence returns true on "a" only.
    - Uppercase "B" and "A" also work.
    - "ArrowUp ×3" followed by the rest completes.
    - A wrong key mid-way followed by the full sequence completes.
    - A second full sequence completes again.
  - Platform:
    - local gives true;
    - `{mode:"discord", sdk:{platform:"desktop"}}` gives true;
    - `"mobile"` gives false;
    - a missing sdk gives false.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/activity/mewbeat/konami.test.js tests/activity/mewbeat/platform.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement the modules, components, the App wiring and the mock state.**
- [ ] **Step 4: Verify.**
  - Run the tests above and `npm --prefix activity run build`. Expected: PASS, and the build succeeds.
  - Then check in the browser pane: start the `activity` preview from `.claude/launch.json` and open `/?mock=1`.
    - Typing the Konami code on the page shows the reveal.
    - The nav shows the mewbeat button.
    - Pressing Space while the stub overlay is open does not toggle playback. Check with `read_console_messages` and the mock state's play/pause label via `find`.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/mewbeat/konami.js activity/src/mewbeat/platform.js activity/src/mewbeat/mewbit activity/src/mewbeat/UnlockReveal.jsx activity/src/mewbeat/mewbeat.css activity/src/mewbeat/MewbeatGame.jsx activity/src/App.jsx activity/src/mockState.js tests/activity/mewbeat/konami.test.js tests/activity/mewbeat/platform.test.js
git commit -m "feat(mewbeat): konami unlock, reveal and player entry"
```

---

### Task 8: Game screen — highway, input, HUD, states, end card

**Files:**
- Create:
  - `activity/src/mewbeat/highway.js` (canvas renderer plus pure geometry);
  - `activity/src/mewbeat/input.js` (pure key router);
  - `activity/src/mewbeat/useMewbeatGame.js` (hook: link, clocks, run, rAF, input);
  - `activity/src/mewbeat/GameHud.jsx`;
  - `activity/src/mewbeat/EndCard.jsx`.
- Modify:
  - `activity/src/mewbeat/MewbeatGame.jsx`: replace the stub with the real screen.
  - `activity/src/mewbeat/mewbeat.css`.
- Test: `tests/activity/mewbeat/highway.test.js`, `tests/activity/mewbeat/input.test.js`

**Interfaces:**
- `highway.js`:
  - `approachMsFor(scrollSpeed) -> number`, equal to `Math.round(2200 * 0.85 ** (scrollSpeed - 1))`. Speed 1 gives 2200, the default 5 gives 1148, and 10 gives 509.
  - `noteY(t, heardMs, approachMs, hitLineY) -> number`:
    - `hitLineY * (1 - (t - heardMs) / approachMs)`;
    - 0 at the top when `t - heard == approachMs`;
    - `hitLineY` when `t == heard`.
  - `createHighwayRenderer(canvas, { effects }) -> { resize(), render({ heardMs, approachMs, notes, lanesDown:[bool×4], flashes, feverActive }) , destroy() }`.
    - It is DPR-aware.
    - There are 4 lanes. Lane colours follow the mockup: cyan, violet, violet, cyan. FEVER tints the highway gold/pink.
    - Notes with outcome `perfect|great|good` disappear. Misses fade out below the line. Skipped notes are drawn at 35% alpha.
    - With effects `off` there are no flashes and no particles.
- `input.js` (create it alongside; it is pure): `createKeyRouter({ keys, onLane, onFever, onExit }) -> (event) => boolean`.
  - It maps `event.code` to a lane through `keys`, and returns true when it handled the event, so the caller calls `preventDefault`.
  - It ignores `event.repeat`, and events with `metaKey`, `ctrlKey` or `altKey`.
  - `Space` calls `onFever`, and `Escape` calls `onExit`.
  - It passes `event.timeStamp` to `onLane(lane, timeStamp)`.
- `useMewbeatGame({ link, settings, effects }) -> { phase, hud, endSummary, mewbitPose, track, canvasRef, autoplay, setAutoplay }`.
  - `phase` is one of `"connecting"|"offline"|"idle"|"charting"|"uncharted"|"failed"|"playing"|"paused"|"ended"`.
  - Input is a window `keydown` and `keyup` listener in the **capture** phase while mounted.
  - `KeyboardEvent.timeStamp` and `performance.now()` share a time origin in Chromium, so song time for a press is `songClock.songTimeAt(event.timeStamp)`.
  - Each rAF frame:
    1. `heard = run.heardTime(songClock.songTimeAt(performance.now()))`;
    2. `run.tick`;
    3. `renderer.render`.
  - `setState` happens only for run events (hit, miss, fever, feverEnd, end) and phase changes, coalesced to at most one HUD update per frame.
  - A new `audioKey` from an anchor `keyChange` ends the current run and shows its end card, if the run judged at least one note. Then the hook requests the chart for the new key at `settings.liveDifficulty`.
  - `snap` calls `run.jump`.
  - `pause` freezes rendering and makes `phase` "paused".
  - `uncharted` and `failed` show their states, and the game waits for the next key.
- Mewbit pose rules:
  - `fever` while FEVER is active;
  - `miss` for 600 ms after a miss, and `crushed` when the combo breaks from 25 or more;
  - `milestone` for 900 ms when the multiplier rises;
  - `vibe3` at combo ≥ 50, `vibe2` at ≥ 25, `vibe1` at ≥ 10;
  - `charting` in the charting phase;
  - otherwise `neutral`.
- Screen copy (English, exact):
  - Charting: "Charting this track…" and "You'll join from the current position."
  - Uncharted: "This track can't be charted."
  - Failed: "Charting failed. We'll try the next track."
  - Idle: "Nothing is playing."
  - Offline: "Reconnecting…"
  - Paused: "Paused".
  - In the header: a "live · <difficulty>" label, the track title and artist, a progress bar and an Exit button (`Esc`).
  - A mid-song join shows an "unranked" chip.
  - An Autoplay toggle is in the header (Ruling P2-3).
- Layout C, following the mockup: Mewbit left, highway centre, HUD right.
  - On the highway there is the combo with a multiplier ring, coloured per level (×1 faint, ×2 cyan, ×3 violet, ×4 gold), and the last judgement text (PERFECT, GREAT, GOOD or MISS).
  - The HUD shows score, accuracy, max combo, the vibe meter with the hint "Fill vibe with hits" or "Space for FEVER!" when full, and the FEVER time left.
  - The mini scoreboard is omitted until plan 3.
- `EndCard` shows the grade, score, accuracy, max combo, fevers and the counts per judgement, plus "Waiting for the next track…" when the bot has queued more. It disappears when the next run starts.

- [ ] **Step 1: Write the failing tests.**
  - `highway.test.js`:
    - `approachMsFor` gives 2200, 1148 and 509 for speeds 1, 5 and 10.
    - `noteY` gives 0 and `hitLineY` at the two endpoints, and a value below `hitLineY` for a past note.
  - `input.test.js`, using fake events:
    - `code:"KeyF"` with default keys calls `onLane(1, timeStamp)` and returns true.
    - `repeat:true` returns false with no call.
    - `ctrlKey` returns false.
    - Space calls `onFever`, and Escape calls `onExit`.
    - An unbound `KeyQ` returns false.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test tests/activity/mewbeat/highway.test.js tests/activity/mewbeat/input.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement the renderer, the input router, the hook, the HUD, the end card and the screen.**
  - In App, the screen gets the link: `createMockLink` when `MOCK_PREVIEW`, otherwise `createMewbeatLink({ send: stopSocket.send, … })` fed from `onMewbeat`.
  - App calls `link.syncNow()` when an incoming Activity state changes `player.paused`, `player.currentTrack?.id`, or `positionMs` by more than 1500 ms against the extrapolated value.
- [ ] **Step 4: Verify.**
  - Run the tests above, `npm test` and `npm --prefix activity run build`. Expected: PASS, and the build succeeds.
  - Then, in the browser pane at `/?mock=1`, open mewbeat and turn Autoplay on.
    - Confirm with `javascript_tool` that the score rises and the phase is "playing".
    - Confirm `read_console_messages` has no errors.
    - Take one screenshot at `scale: 0.5` of the playing screen.
    - Press Escape; the player is back.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/mewbeat activity/src/App.jsx tests/activity/mewbeat/highway.test.js tests/activity/mewbeat/input.test.js
git commit -m "feat(mewbeat): live game screen with highway, hud and end card"
```

---

### Task 9: Settings panel, hit sounds and effects levels

**Files:**
- Create: `activity/src/mewbeat/SettingsPanel.jsx`, `activity/src/mewbeat/hitSounds.js`, `activity/src/mewbeat/effects.js`
- Modify: `activity/src/mewbeat/MewbeatGame.jsx` (gear button opens the panel; the game pauses input while the panel is open), `activity/src/mewbeat/mewbeat.css`
- Test: `tests/activity/mewbeat/effects.test.js`

**Interfaces:**
- `effectiveEffects(setting, prefersReducedMotion) -> "full"|"reduced"|"off"`. When reduced motion is preferred, "full" becomes "reduced". It is consumed by the renderer, `Mewbit` and `UnlockReveal`.
- `createHitSounds() -> { play(judgement), close() }`:
  - A Web Audio short click synthesized with an oscillator and gain envelope; no audio files.
  - PERFECT is pitched higher than GOOD.
  - It is created lazily on the first key press, to satisfy autoplay policy.
  - It plays only when `settings.hitSounds`.
- `SettingsPanel` sends `onAction("mewbeat_settings", { settings: patch })` and shows the server error toast on refusal. Its fields:
  - **Keys:** 4 "press a key" capture buttons using `event.code`, shown as readable labels ("KeyD" as "D").
    - The panel refuses Space, Escape and duplicates locally with the same English messages as the server.
  - **Audio offset:** a slider from −300 to 700 ms in steps of 5, with −5/+5 buttons. Help text: "Raise it if notes reach the line before you hear the beat."
  - **Scroll speed:** 1–10.
  - **Live difficulty:** Easy, Normal or Hard.
  - **Effects:** Full, Reduced or Off.
  - **Hit sounds:** on or off.
- Settings changes apply to the running game immediately:
  - offset and keys apply to the current run (create the run with the new offset at the current position, preserving the score: `run.setOffset(ms)`; add it to `run.js` with a test);
  - difficulty applies from the next track.

- [ ] **Step 1: Write the failing tests.**
  - `effects.test.js`: `effectiveEffects` for ("full", true) gives "reduced", ("off", true) gives "off", and ("full", false) gives "full".
  - In `run.test.js`, add: `setOffset(100)` mid-run moves later presses' `errorMs` by −100.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - Run the tests, `npm test` and the activity build. Expected: PASS.
  - In the browser pane at `/?mock=1`, open settings and change the offset and the keys.
    - The mock's action is accepted.
    - The UI reflects the new keys on the lane labels.
    - Use `find`/`read_page`, not screenshots.
- [ ] **Step 5: Commit.**

```bash
git add activity/src/mewbeat tests/activity/mewbeat/effects.test.js tests/activity/mewbeat/run.test.js
git commit -m "feat(mewbeat): game settings, hit sounds and effects levels"
```

---

### Task 10 (controller): Local end-to-end check with the bot in Docker

This task has no implementer and needs no commit unless it finds a defect. The controller runs it, and the user judges the feel.

- [ ] Run `npm run lavalink:dev` and the bot locally with the mewbeat plugin, and the Activity with `VITE_ACTIVITY_CONNECT_LOCAL=true`.
- [ ] Play a track that already has charts (plan 1's preview tracks).
- [ ] Unlock with Konami and open mewbeat. Confirm with `javascript_tool` and console logs that:
  - the sync replies arrive about every 1 s;
  - the offset estimate is stable to within ±5 ms;
  - the chart arrives;
  - `phase` becomes "playing".
- [ ] Skip the track from another view: the end card shows, the next chart is requested, and the play continues.
- [ ] Hand over to the user for the by-ear check with Autoplay and hit sounds. This doubles as the "visual tester" the user asked for in plan 1.

---

## Rulings made while writing this plan

- **P2-0:** Plan 2 is written and executed before plan 1's Pi gate (Task 4).
  - Why: it is client-side and independent of Pi analysis cost, and the user cannot reach the Pi.
  - Cost if wrong: none to this plan. Pi findings change only plugin and chartStore internals.
- **P2-1:** Sync and anchors are one request/reply (`mewbeat_sync` at 1 Hz) rather than server-pushed anchors.
  - Why: a single message gives both the NTP sample and a fresh anchor, needs no server subscription state, and stops when the game closes.
  - Cost if wrong: about 1 s worst-case latency to notice a seek. App's `syncNow()` on state changes covers that.
- **P2-2:** Keys are stored as `KeyboardEvent.code`, so the layout does not matter. Escape is reserved besides Space, because it leaves the game.
- **P2-3:** Autoplay is available in plan 2. The run is unranked and nothing is submitted.
  - Why: it is the visual and audio chart tester the user asked for.
  - Plan 4 hides it in ranked rounds.
- **P2-4:** No voice-channel requirement in plan 2. Solo play changes nothing for others; plan 3 enforces voice for sessions.
- **P2-5:** During FEVER, vibe gains are ignored and vibe ends at 0. The spec only says it drains over 8 s.
- **P2-6:** Offset range is −300…+700 ms, because the pipeline latency is unknown. Scroll speed 1–10 maps exponentially to an approach of 2200…509 ms, and the default 5 gives 1148 ms ("mid").
