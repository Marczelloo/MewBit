# mewbeat Activity audio, solo, boards, rooms — Implementation Plan

> For agentic workers: one task per dispatch; steps use `- [ ]`. Never push, never merge to main.

**Goal:** Solo play with Activity audio, song select, results, scores/leaderboards/history, live board,
live difficulty change, settings rework, rooms + lobby, invites.

**Spec:** `docs/superpowers/specs/2026-11-02-mewbeat-activity-audio-design.md` (binding).

## Global Constraints

- Branch `feat/mewbeat`; commit with explicit paths; message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- Never stage: `.impeccable/`, `.superpowers/`, `helpers/lavalink/plugins/*.jar`, `helpers/lavalink/application.yml`,
  `.env*`, `.mewbeat-preview/`, `.mewbeat-spike/`, `logs/`, data files under `helpers/data/` (code like
  `helpers/data/atomicJson.js` is fine).
- Never print secrets from `.env*`.
- Node tests: `pnpm test` (node:test, CommonJS in `helpers/`, tests in `tests/`). Activity is ESM React (Vite);
  Activity build check: `cd activity && VITE_ACTIVITY_GATEWAY_URL= VITE_ACTIVITY_CONNECT_LOCAL=false npx vite build`.
- Plugin build/test: `node scripts/build-mewbeat-plugin.mjs --test` (Docker gradle).
- UI copy English; visual tokens and fonts from the spec; match comment density and idiom of nearby code.
- All mewbeat WS messages are `mewbeat_*` and go through `helpers/mewbeat/activityChannel.js`.

## Review Focus

1. Solo audio not yet decoded/loaded when Play is pressed → a loading state, never a run on a null clock.
2. AudioContext suspended (no gesture) → resume on the Play click; never a silent run.
3. Socket reconnect mid-room → the member is removed on close and can rejoin; room never wedges in `loading`.
4. Submit for a chart that changed version / unknown audioKey → stored unranked or rejected, no crash.
5. Two sockets for the same user (two windows) → one room member, one live-board entry.

## Shared protocol (all tasks rely on these names)

Channel factory (Task 2 extends it):
`createMewbeatChannel({ readPlayback, chartStore, isUnlocked, now, audioLatencyMs, resolveTrack, soloTracks,
scoreStore, historyStore, loadScoring, broadcast, sendToUser, log })`, `handle(guildId, userId, message, profile)`
returning a reply or a Promise of one, `disconnect(guildId, userId)`.
`profile = { id, username, avatarUrl }`. `broadcast(guildId, userIds, payload)`, `sendToUser(guildId, userId, payload)`.

Messages (C→S request / S→C reply carry the client's `id` when given):
- `mewbeat_solo_prepare {id, uri, source}` → `{type, id, status:"ok"|"error", audioKey, track:{title, artist, durationMs, artworkUrl, uri, source}, reason}`
- `mewbeat_chart {audioKey, difficulty}` → existing reply shape; registry tracks allowed.
- `mewbeat_submit {id, mode, audioKey, difficulty, chartVersion, events:[{n, part, j, t, d}], fevers:[t], flags:{autoplay, calibration, difficultyChanged}}`
  → `{type, id, status, result:{score, accuracy, grade, maxCombo, counts, ranked, newBest, best, rank:{server, global}, serverTop:[{userId, username, avatarUrl, score, accuracy, grade}]}}`
- `mewbeat_board {id, audioKey, difficulty, scope:"server"|"global", limit}` → `{type, id, entries, own}`
- `mewbeat_played {id, scope:"server"|"global", limit}` → `{type, id, tracks:[{audioKey, uri, source, title, artist, artworkUrl, durationMs, plays, lastAt, stars:{easy..hell}|null, bests:{easy:{score, grade}}}]}`
- `mewbeat_live {session, audioKey, difficulty, score, combo, accuracy, ended}` → pushes `{type:"mewbeat_live_board", session, entries:[{userId, username, avatarUrl, difficulty, score, combo, accuracy, ended}]}`
- Rooms: `mewbeat_room_join`, `_leave`, `_queue_add {uri, source}`, `_queue_remove {index}`, `_ready {ready, difficulty}`,
  `_start`, `_loaded {audioKey}`, `_invite` → server pushes `{type:"mewbeat_room", room}` (shape in Task 9).
- HTTP `GET /api/activity/mewbeat/audio?guildId=&audioKey=` → `audio/ogg`.
- Plugin `POST /v4/mewbeat/audio {encodedTrack}` → `audio/ogg`.

---

### Task 1: Plugin Ogg Opus audio route
Files: `lavalink-plugins/mewbeat/src/main/java/dev/mewbit/mewbeat/{OggOpusWriter.java, AudioEncodeWorker.java (or extend AnalysisWorker), MewbeatRoutes.java, LavaplayerTrackDecoder.java}` + tests.
- [ ] OggOpusWriter: OpusHead (version 1, channels 2, pre-skip 312, 48000, gain 0, mapping 0), OpusTags, packets with granule from TOC (`frames × frameSize`), Ogg CRC (poly 0x04c11db7, not reflected), EOS flag on last page. Unit test: page CRC of a known page, granule sums, header bytes.
- [ ] Opus frame source: decoder variant producing `DISCORD_OPUS` frames with forced re-encode, quality 5.
- [ ] Route `POST /v4/mewbeat/audio`; raw bytes via existing `respond()`; one job at a time, 503 when >2 waiting; 422 on load failure.
- [ ] Build + tests green; commit (no jar).

### Task 2: Gateway — registry, audio route, channel deps
Files: `helpers/mewbeat/soloTracks.js` (LRU), `helpers/mewbeat/audioStore.js` (disk cache + plugin fetch), `helpers/mewbeat/activityChannel.js`, `helpers/activity/server.js`, tests.
- [ ] `createSoloTracks({max:128, ttlMs:6h, now})` → `{put(audioKey, entry), get(audioKey)}`.
- [ ] `createAudioStore({dir, fetchAudio, maxFiles:40})` → `{get(audioKey, track, node) → Promise<filePath>}`; shared in-flight promises, serial plugin jobs, atomic write, LRU eviction by mtime.
- [ ] Channel: `mewbeat_solo_prepare`, registry-aware `mewbeat_chart`, new deps, `profile` param, `disconnect`.
- [ ] server.js: `resolveTrack` via Poru (`uri` + `source`), audio HTTP route, `broadcast`/`sendToUser` over sockets of the guild filtered by `socket.identity.id`, `disconnect` on socket close, pass profile.
- [ ] Tests for LRU, audio store (fake fetch), channel solo prepare + registry chart. Commit.

### Task 3: Solo play (client)
Files: `activity/src/mewbeat/soloAudio.js` (fetch/decode/play/pause, clock), `activity/src/mewbeat/soloLink.js`, `MewbeatGame.jsx`, `useMewbeatGame.js` (only if needed), `input.js` (Esc → pause in solo).
- Produces: `createSoloAudio({ fetchAudio })` → `{load(audioKey) Promise, play(fromMs, atCtxTime?), pause() → ms, resume(), stop(), setVolume(0..1), songTimeAt(perfMs) | null, ctx, duration}`;
  `createSoloLink({ send, audio })` with the `createMewbeatLink` interface plus `prepare({uri, source}) Promise<{audioKey, track}>`, `begin(audioKey)`, `pause()`, `resume()`, `restart()`.
- [ ] Mode switch Live · Solo · Room in header; default by bot state; pause overlay (Resume / Restart / Song select / Exit), count-in.
- [ ] Unit tests (node:test can import ESM from tests via dynamic import) for the clock math with a fake AudioContext. Commit.

### Task 4: Scores, history, submit (server)
Files: `helpers/mewbeat/scoreStore.js`, `helpers/mewbeat/historyStore.js`, `helpers/mewbeat/recompute.js`, channel + server wiring, tests.
- [ ] Recompute from events with `scoring.js` (`createScore`, `applyJudgement`, `startFever`, `accuracyOf`, `gradeOf`); reject > chart notes.
- [ ] Ranked rules from the spec; best per user per chart key; ranks server/global; history cap 200.
- [ ] `mewbeat_submit`, `mewbeat_board`, `mewbeat_played` (stars via `charts/stars.js` on peeked charts). Commit.

### Task 5: Song select (client) — mockup `song-select.html`
Files: `activity/src/mewbeat/SongSelect.jsx`, css. Consumes `mewbeat_played`, existing search API, solo link `prepare`.
- [ ] Scopes, search, list rows, difficulty pick, Play / Add to room queue; loading + error states. Commit.

### Task 6: Results screen (client) — mockup `results-v2.html`
Files: `activity/src/mewbeat/Results.jsx` (replaces EndCard usage), run event log for submit, submit on run end.
- [ ] Run exposes per-note event log `{n, part, j, t, d}` + fever starts; client sends `mewbeat_submit`; results show the reply. Commit.

### Task 7: Live leaderboard
Files: `helpers/mewbeat/liveBoard.js` + channel wiring + tests; `activity/src/mewbeat/LiveBoard.jsx`; send loop in game.
- [ ] Session table, 5 s expiry, ≤4 Hz pushes, one entry per user. Commit.

### Task 8: Live difficulty change + settings rework
Files: `run.js` (`swapChart(chart, songMs)`), track card control, `SettingsPanel.jsx`, `helpers/mewbeat/userSettings.js` (`musicVolume`).
- [ ] Commit.

### Task 9: Rooms (server)
Files: `helpers/mewbeat/rooms.js` + channel wiring + tests.
- `room = {hostId, phase:"lobby"|"loading"|"countdown"|"playing"|"results"|"intermission", members:[{userId, username, avatarUrl, difficulty, ready, loaded, spectator, submitted}], queue:[{audioKey, title, artist, durationMs, artworkUrl, uri, source, addedBy}], current, startAt, nextAt, results:[{userId, username, score, accuracy, grade, difficulty}], serverNow}`.
- [ ] Phase machine with injected timers; tests with fake time. Commit.

### Task 10: Lobby + room play (client) — mockup `lobby-v3.html`
Files: `activity/src/mewbeat/Lobby.jsx`, room flow in `MewbeatGame.jsx`, countdown overlay.
- [ ] Commit.

### Task 11: Invites
Files: channel/server + a button handler in the bot's interaction code. Commit.

### Task 12: Final: build, tests, plugin redeploy, review, report.
