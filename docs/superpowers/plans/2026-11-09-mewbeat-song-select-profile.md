# mewbeat song select, profiles and ranking: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Solo song select into the game's home: profile, Stats, ranking, level leaderboards, sortable song list, and a level change in the pause menu.

**Architecture:** The bot gains a pure rating module, a per-player stats store and three read messages on the existing Activity socket. The client splits the left half of `SongSelect` into panels fed by those messages and sorts the song list locally.

**Tech Stack:** Node (CommonJS, `node:test`) in `helpers/mewbeat`; React + Vite (ESM) in `activity/src/mewbeat`; JSON stores on `createDebouncedJson`.

**Spec:** `docs/superpowers/specs/2026-11-09-mewbeat-song-select-profile-design.md`. Layout reference: `docs/superpowers/specs/mewbeat-mockups/song-select-profile.html`.

## Global Constraints

- Branch `feat/mewbeat`. Commit only when the user has said so, and then stage only the files the task names: the tree also holds unrelated changes (`helpers/lavalink/*`, `.claude/worktrees/`, `.impeccable/config.json`).
- Never kill node by name and never run host python. Everything runs on this PC.
- Interface copy is English. Colours are the Obsidian tokens: difficulty easy=cyan, normal=violet, hard=pink, hell=danger; grades S gold, A cyan, B violet, C high, D danger; judgements Perfect cyan, Great violet, Good high, Miss danger.
- No change to the game board, in-game HUD, settings window or chart generator. Modifiers are inert slots with no stored field.
- A new channel message follows the `board`/`played` conventions in `activityChannel.js`: id check, then `isUnlocked`, then `{ type, id, status: "error", reason }` on refusal.
- Test commands: `node --test tests/helpers/mewbeat/*.test.js` and `node --test tests/activity/mewbeat/*.test.js`. Build: `(cd activity && npx vite build --outDir <scratchpad>/build --emptyOutDir)`, in a subshell so the working directory does not move.

## Review Focus

- A player with no rounds opens Profile or Stats: zeros and "—", never `NaN` or a crash (test in Task 2).
- Someone opens a player the bot has no record of: a `not_found` reply the panel shows as a message, while your own profile is never `not_found` (test in Task 4).
- Sorting by Stars or BPM over songs with no stored charts: those rows stay last in both directions (test in Task 6).
- A hold whose head missed, or a run that has a head event and no tail event: no hold time, no negative hold time (test in Task 2).
- A client sends a bad `presses` (negative, fraction, string, huge): the run still scores and the field counts as absent (test in Task 4).

---

### Task 1: Level change in the pause menu

**Files:**
- Modify: `activity/src/mewbeat/MewbeatGame.jsx` (`GameMenu` at 128, `pickSong` at 400, `restartFromMenu` at 443, the `GameMenu` render at 956)
- Modify: `activity/src/mewbeat/mewbeat.css`

**Interfaces:**
- Consumes: `link.restart()`, `setPickedLevel`, `levelSaves`, `DIFFICULTIES` from `SongSelect.jsx`.
- Produces: nothing other tasks use.

- [ ] **Step 1:** Extract `saveLevel(next)` from `pickSong`: the `setPickedLevel`, `levelSaves` and `mewbeat_settings` block, unchanged. `pickSong` calls it.
- [ ] **Step 2:** Add to `GameMenu` optional props `level`, `onLevel(id)`. When given, render a four-button row above the actions with the classes of the difficulty picker in `GameHud.jsx` (`mb-diff-seg`, `mb-diff-btn`, `mb-diff-on`), inside a `mb-lv-<level>` wrapper because `.mb-diff-on` reads `--lv` from it. Pass them only while `restartFromMenu` exists and `solo`.
- [ ] **Step 3:** `onLevel` does nothing for the current level. Otherwise it calls `saveLevel(next)` and sets a ref `restartOnLevel.current = next`. A `useEffect` keyed on the effective level runs `link.restart(); closeMenu(); backToGame();` once that level equals the ref, then clears the ref. Restarting in the click handler would chart the old level, because `useMewbeatGame` reads `cfgRef.current.liveDifficulty` set during render.
- [ ] **Step 4:** Run the build and `node --test tests/activity/mewbeat/*.test.js`. Expected: build succeeds, tests pass. This flow needs the bot, so the user confirms it by playing.

### Task 2: Rating and per-run stats, pure

**Files:**
- Create: `helpers/mewbeat/rating.js`, `helpers/mewbeat/runStats.js`, `helpers/mewbeat/statsStore.js`
- Test: `tests/helpers/mewbeat/rating.test.js`, `tests/helpers/mewbeat/runStats.test.js`, `tests/helpers/mewbeat/statsStore.test.js`

**Interfaces:**
- Produces:
  - `playPp({ stars: number|null, accuracy: number|null }) -> number`
  - `ratingOf(pps: number[]) -> number`
  - `deriveRunStats({ chart, events }) -> { holdMs, longestHoldMs, timing: { n, sum, sumSq, early, late } }`
  - `createStatsStore({ file, now, debounceMs }) -> { add(userId, run), summaryOf(userId), has(userId), flush }`
  - `run` is `{ profile, audioKey, difficulty, track: { title, artist, artworkUrl }, durationMs, accuracy, counts, maxCombo, parts, fevers, presses, emptyPresses, holdMs, longestHoldMs, timing }`
  - `summaryOf` returns `null` for an unknown user, else `{ username, avatarUrl, firstAt, plays, avgAccuracy, songs, playMs, counts, presses, emptyPresses, holdMs, longestHoldMs, fevers, fullCombos, timing: { meanMs, spreadMs, earlyShare, lateShare }, bestCombo: { value, title } | null, maps: [{ audioKey, difficulty, title, maxCombo, parts, fullCombo }] }`, `maps` highest combo first. With no timing samples the four timing fields are `null`.

- [ ] **Step 1: Write the failing tests**

```js
// rating.test.js
near(playPp({ stars: 4, accuracy: 100 }), 8 * 4 ** 2.2);
near(playPp({ stars: 4, accuracy: 75 }), 8 * 4 ** 2.2 * 0.5 ** 2.5);
assert.equal(playPp({ stars: 4, accuracy: 50 }), 0);
assert.equal(playPp({ stars: 4, accuracy: 30 }), 0);
assert.equal(playPp({ stars: null, accuracy: 99 }), 0);
assert.equal(ratingOf([]), 0);
near(ratingOf([100, 200]), 200 + 100 * 0.95);

// runStats.test.js; a hold at t=1000, len=2000
// head great, tail great at t=3050 -> holdMs 2000 (clamped to the note's end)
// head great, tail miss at t=2200 -> holdMs 1200
// head miss, tail miss -> holdMs 0
// head great, no tail event -> holdMs 0
// head events d=-10, d=20, tail d ignored, d=null ignored -> timing { n: 2, sum: 10, sumSq: 500, early: 1, late: 1 }

// statsStore.test.js
// summaryOf(unknown) === null
// has(unknown) === false
// one run with no timing samples: timing fields are all null, avgAccuracy is the run's accuracy, no NaN anywhere
// two runs: counts add up, playMs adds up, spreadMs is the standard deviation, songs counts distinct audioKeys
// full combo: counts.miss === 0 and maxCombo === parts increments fullCombos and marks the map, a later non-FC keeps it
// maxCombo per map keeps the highest; bestCombo names that map's title
// survives a flush and reload through the file
```

- [ ] **Step 2:** Run the three test files. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement. `rating.js` holds `PP = { base: 8, starPower: 2.2, accuracyFloor: 50, accuracyPower: 2.5, decay: 0.95 }`. `ratingOf` sorts its own copy, highest first. `deriveRunStats` indexes tail events by note, counts a hold only with a non-miss head and a tail event, and uses `Math.max(0, Math.min(tail.t, note.t + note.len) - note.t)`. `statsStore` follows `historyStore.js`; a full combo is `counts.miss === 0 && maxCombo >= parts`.
- [ ] **Step 4:** Run the three test files. Expected: PASS.

### Task 3: Score and history stores, ranking table

**Files:**
- Create: `helpers/mewbeat/ranking.js`
- Modify: `helpers/mewbeat/scoreStore.js`, `helpers/mewbeat/historyStore.js`
- Test: `tests/helpers/mewbeat/ranking.test.js`, `tests/helpers/mewbeat/scoreStore.test.js`, `tests/helpers/mewbeat/historyStore.test.js`

**Interfaces:**
- Consumes: `playPp`, `ratingOf`.
- Produces:
  - `scoreStore.submit` accepts `track: { title, artist, artworkUrl }`, stored on the entry when it is the new best
  - `scoreStore.forEachEntry(fn: (chartKey, entry) => void)`
  - `historyStore.played({ guildId, userId, limit })` rows gain `playsBy: { easy, normal, hard, hell }`; `perUser` default 2000
  - `historyStore.firstTrackOf(userId, audioKey) -> { title, artist, artworkUrl } | null`
  - `createRanking({ walk, currentOf, trackOf, now, ttlMs = 60000 }) -> { rowsFor({ guildId, limit }), rankOf({ userId, guildId }), playerOf(userId), invalidate() }`
  - `currentOf(audioKey, difficulty) -> { chartKey, stars } | null`
  - `playerOf` returns `{ username, avatarUrl, pp, accuracy, plays: [{ audioKey, difficulty, stars, pp, accuracy, grade, score, title, artist, artworkUrl }] } | null`, `plays` highest pp first
  - `rowsFor` returns `[{ rank, userId, username, avatarUrl, pp, accuracy }]`

- [ ] **Step 1: Write the failing tests**

```js
// ranking.test.js
// an entry whose chartKey differs from currentOf(...).chartKey adds nothing
// currentOf returning null adds nothing
// two players sort by rating; rank is 1-based
// rowsFor({ guildId }) keeps only players with a counted entry whose guildIds include it; pp is still the global rating
// rankOf for a player with nothing counted is null
// userId "local-user" never appears
// accuracy is the mean of the counted plays
// a second call within ttlMs does not call walk again; invalidate() or passing ttlMs does
// chartKey with a flag version "yt:a:1|hard|44-easySameCuts-hardHolds" parses to audioKey "yt:a:1", difficulty "hard"

// scoreStore.test.js: submit with track keeps it on the best entry; forEachEntry visits every chart and user
// historyStore.test.js: keeps 2000 by default; played({ userId }) only that user's rounds; playsBy counts per level
```

- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement. Parse chart keys with `/^(.*)\|(easy|normal|hard|hell)\|(.+)$/`. `trackOf(userId, audioKey)` is used when an entry has no stored `title`.
- [ ] **Step 4:** Run the three files. Expected: PASS.

### Task 4: Channel messages and submit

**Files:**
- Modify: `helpers/mewbeat/activityChannel.js`, `helpers/mewbeat/stores.js`, `helpers/activity/server.js:67,758-759`, `activity/src/mewbeat/run.js`, `activity/src/mewbeat/useMewbeatGame.js:329`
- Test: `tests/helpers/mewbeat/activityChannelScores.test.js`, `tests/activity/mewbeat/run.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces, as `requests.request` replies:
  - `mewbeat_profile { userId? }` -> `{ status: "ok", player: { userId, username, avatarUrl, firstAt }, rating: { pp, global, server }, summary: { plays, avgAccuracy, songs, playMs, bestGrades: { S, A, B, C, D } }, recent: [{ audioKey, title, artist, artworkUrl, difficulty, grade, accuracy, score, at }], best: [{ audioKey, title, artist, artworkUrl, difficulty, stars, grade, accuracy, pp }] }`, 8 rows in each list
  - `mewbeat_stats { userId? }` -> `{ status: "ok", player, stats: <summaryOf> }`
  - `mewbeat_ranking { scope: "global"|"server", limit? }` -> `{ status: "ok", entries, own: { rank, pp } }`, limit default 50, max 100
  - `mewbeat_played` also takes `scope: "mine"`; tracks gain `bpm`, `playsBy`; `PLAYED_LIMIT` 500
  - `run.log()` adds `presses`, `emptyPresses`; the submit body carries both

- [ ] **Step 1: Write the failing tests**

```js
// activityChannelScores.test.js
// profile of yourself with no rounds: status ok, zeros, rating.pp 0, ranks null
// profile of an unknown userId: status error, reason not_found
// profile of a locked requester: status error, reason locked
// a non-string or too long userId: status error, reason bad_request
// ranking with a bad scope: reason bad_scope
// a submit adds to mewbeat_stats; a calibration or autoplay run does not; an unranked real run does
// a ranked submit changes mewbeat_ranking at once (the cache was invalidated)
// presses: -1, 1.5, "9", 1e9 -> the submit still replies ok and stats.presses stays 0; presses 42, emptyPresses 7 are counted
// played scope "mine" lists only your songs; a track carries bpm from the stored chart

// run.test.js
// two presses, one on a note and one on empty air: log() has presses 2, emptyPresses 1
// a press after the run ended counts nothing
```

- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement. `createMewbeatChannel` takes `statsStore` and builds the ranking with `walk: scoreStore.forEachEntry`, and `currentOf` from `peekChartsOf(trackFromAudioKey(audioKey))?.[difficulty]` with its version as in `chartKeyFor`, without the `latestChartKey` fallback. `MAX_PRESSES = 200000`; a value counts only if `Number.isInteger(v) && v >= 0 && v <= MAX_PRESSES`. In `submit`, pass `track` to `scoreStore.submit` and add to `statsStore` under the same `!calibration` guard as history, plus `!flags?.autoplay`; invalidate the ranking after a ranked submit. `mewbeat_profile` takes `plays`, `avgAccuracy`, `songs`, `playMs` and the name from `statsStore.summaryOf`, falling back to `playerOf` and then to the requester's `profile`; `recent` from `historyStore.recent`; `best` from `playerOf(...).plays`; `bestGrades` counts the grades of those plays. It is `not_found` only for someone else with no `statsStore.has`, no `playerOf` and no history. Add `statsStore` to `stores.js`, `flushMewbeatStores` and the channel wiring in `server.js`.
- [ ] **Step 4:** Run `node --test tests/helpers/mewbeat/*.test.js` and `node --test tests/activity/mewbeat/*.test.js`. Expected: PASS.

### Task 5: Left side: Profile, Stats, level leaderboard, modifiers

**Files:**
- Create: `activity/src/mewbeat/playerFormat.js`, `activity/src/mewbeat/PlayerPanel.jsx`, `activity/src/mewbeat/LevelBoard.jsx`, `activity/src/mewbeat/songSelect.css`
- Modify: `activity/src/mewbeat/SongSelect.jsx`, `activity/src/mewbeat/MewbeatGame.jsx:780`
- Test: `tests/activity/mewbeat/playerFormat.test.js`

**Interfaces:**
- Consumes: replies from Task 4, `mewbeat_board`.
- Produces:
  - `formatDuration(ms) -> "11h 40m" | "12m" | "0m"`, `formatOffsetMs(mean) -> "+6 ms" | "-4 ms" | "—"`, `timingWord(mean) -> "a little late" | "a little early" | "on time" | ""`, `formatPercent(value) -> "86.4%" | "—"`
  - `SongSelect` prop `player: { userId } | undefined`; only the Solo picker passes it, the Room window keeps today's left side
  - `<PlayerPanel request tab userId onTab onBack onOpenPlayer />` and `<LevelBoard request audioKey difficulty userId onOpenPlayer />`

- [ ] **Step 1: Write the failing test**

```js
assert.equal(formatDuration(42_000_000), "11h 40m");
assert.equal(formatDuration(720_000), "12m");
assert.equal(formatDuration(0), "0m");
assert.equal(formatOffsetMs(6.4), "+6 ms");
assert.equal(formatOffsetMs(-4), "-4 ms");
assert.equal(formatOffsetMs(null), "—");
assert.equal(timingWord(null), "");
assert.equal(timingWord(1), "on time");
assert.equal(formatPercent(null), "—");
assert.equal(formatPercent(86.42), "86.4%");
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `playerFormat.js`; `|mean| <= 2` is "on time". Run it. Expected: PASS.
- [ ] **Step 4:** Build `PlayerPanel` (tabs Profile and Stats, the Ranking tab comes in Task 7) and `LevelBoard` to the mockup, each with loading, empty and error states in the style of `.mb-ss-empty`. `LevelBoard` refetches on song, difficulty and scope, drops stale replies, requests `limit: 50`, shows own row pinned with `own.rank` when it is not among the shown rows. `songSelect.css` is scoped under `.mb-ss` like `settings.css` is under `.mb-settings`, and imported the same way. Stats tile captions must not overflow at 500 px of column width.
- [ ] **Step 5:** In `SongSelect`, with `player` set: no selection renders `PlayerPanel`; a selection renders "← Profile" (`setSelectedKey(null)`), the hero with a BPM chip, the tiles, four inert Modifiers slots and `LevelBoard`. Add `bpm: track.bpm ?? null` to `playedRow`. Pass `player={{ userId }}` at `MewbeatGame.jsx:780` only.
- [ ] **Step 6:** Run the build and the activity tests. Expected: both pass.

### Task 6: Right side: tabs, sort, filter, table rows

**Files:**
- Create: `activity/src/mewbeat/songList.js`
- Modify: `activity/src/mewbeat/SongSelect.jsx`, `activity/src/mewbeat/songSelect.css`, `activity/src/mewbeat/mewbeat.css` (remove the `.mb-ss-mini*` rules that become unused)
- Test: `tests/activity/mewbeat/songList.test.js`

**Interfaces:**
- Produces: `arrangeRows(rows, { sort, level, direction, filter }) -> rows`, with `sort` one of `recent|stars|bpm|length|plays|title`, `direction` `desc|asc`, `filter` `all|played|unplayed`.

- [ ] **Step 1: Write the failing test**

```js
// input order is "recent"; sort "recent" desc returns it unchanged, asc reversed
// stars on level "hard": rows with stars.hard null stay last in desc and in asc
// bpm null stays last in both directions
// plays uses row.playsBy[level], missing counts as 0
// title compares case-insensitively
// filter "played" keeps rows with row.bests[level]; "unplayed" the others; "all" keeps everything
// equal values keep their input order
// the input array is not mutated
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `arrangeRows`. Run it. Expected: PASS.
- [ ] **Step 4:** In `SongSelect`: scopes `This server`, `Everywhere`, `Played by you` (`mine`); request `limit: 500`; add `playsBy` to `playedRow`. Add the tools row, hidden while searching, and the `EZ NM HD HL` header. Replace `MiniDifficulties` with four fixed columns, stars in the level colour and the grade beneath. Row shows `length · BPM`; omit the BPM part when null. Applies to the Room window too. Keep the arrow-key order following the arranged list.
- [ ] **Step 5:** Run the build and the activity tests. Expected: both pass.

### Task 7: Ranking tab and other players' profiles

**Files:**
- Create: `activity/src/mewbeat/RankingPanel.jsx`
- Modify: `activity/src/mewbeat/PlayerPanel.jsx`, `activity/src/mewbeat/SongSelect.jsx`, `activity/src/mewbeat/songSelect.css`

**Interfaces:**
- Consumes: `mewbeat_ranking`, `PlayerPanel`, `LevelBoard`'s `onOpenPlayer`.
- Produces: `<RankingPanel request userId onOpenPlayer />`.

- [ ] **Step 1:** Build `RankingPanel` to the mockup: rows of rank, avatar, name, accuracy, rating, own row highlighted, Global and This server switch, own row pinned when not shown.
- [ ] **Step 2:** `SongSelect` keeps `leftView: { tab, userId }`, `userId` null meaning yourself. `onOpenPlayer(id)` clears the selection, which also stops the preview through the existing effect, and sets `{ tab: "profile", userId: id === own ? null : id }`.
- [ ] **Step 3:** With another player: tabs Profile and Stats, "Viewing <name>", "← Your profile". Server rank null shows "—". A `not_found` reply shows "Couldn't find that player." with the back button still there.
- [ ] **Step 4:** Run the build and the activity tests. Expected: both pass.

### Task 8: Browser check through the mock preview

**Files:**
- Create: `activity/src/mewbeat/mockRequests.js`
- Modify: `activity/src/mewbeat/MewbeatGame.jsx` (`MOCK_PREVIEW` handling)

**Interfaces:**
- Consumes: the reply shapes of Task 4.
- Produces: `createMockRequest() -> (type, body) => Promise<reply>`, answering `mewbeat_played`, `mewbeat_board`, `mewbeat_profile`, `mewbeat_stats`, `mewbeat_ranking`.

- [ ] **Step 1:** Implement it. With `?mock=1&select=1` the session shows the `SongSelect` with `request={createMockRequest()}`, `player` set and a no-op `onPlay`. Dev-only, behind `MOCK_PREVIEW`, no effect on a normal build.
- [ ] **Step 2:** In the browser pane at 1280x720, 1024x560 and 800x480, using text tools and at most one `scale: 0.5` screenshot per size, check every state: no horizontal overflow inside the left column, console clean, tab switching, sort, filter, opening a player and coming back, a player with no rounds, `not_found`.
- [ ] **Step 3:** Run all tests and the build. Expected: pass. Report what could only be checked by playing against the bot: Task 1's restart, real submits feeding Stats and Ranking.
