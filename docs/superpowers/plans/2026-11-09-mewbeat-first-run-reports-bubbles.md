# mewbeat: open game, first-run tour, reports and bubbles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open mewbeat to everyone, walk first-time players through it, let players report bugs to a private channel, and give Mewbit bubbles that fit her.

**Architecture:** The unlock is removed on the server and replaced by a `tutorialSeen` flag. The tour is a layer over the real Solo screens, which run on sample data (`createMockRequest`, a still copy of the mock link). Reports go through one server module used by an Activity action and a `/report` command. Bubble text moves to a pool file, and one shared CSS tag gives every bubble style A.

**Tech Stack:** React + Vite (ESM) in `activity/`, Node + discord.js (CommonJS) in `helpers/` and `commands/`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-09-mewbeat-first-run-reports-bubbles-design.md`. Mockups: `docs/superpowers/specs/mewbeat-mockups/first-run/` (`tutorial-flow.html` variant B for placement, `bubble-style.html` style A for looks).

## Global Constraints

- Branch `feat/mewbeat`. Commit only if the controller says so; never `git add` `helpers/lavalink/*` or `.claude/worktrees/`. Never push.
- Never kill node by name, never run host python, never start a dev server through a shell.
- Tests: `node scripts/run-tests.js`. Build: `npx vite build` in `activity/`. Client tests load ESM with `await import(pathToFileURL(...))`.
- UI text in English. Code comments match the surrounding density.
- `mockRequests.js` and `mockLink.js` are loaded by the tour in production, so they must not depend on `import.meta.env.DEV`; load the tour's sample data lazily so normal starts don't pay for it.
- Bubbles appear no more often than today. Lines shown while notes fall are at most about 6 words.

## Review Focus

1. A first-time player arriving through an invite link lands in the room with no reveal or tour, and `tutorialSeen` stays false.
2. A Live song is playing during the tour: nothing is judged or sent, no miss poses or bubbles fire, no score reaches a board.
3. A target missing or off screen (small window, `[data-tour]` not rendered): the step shows centred with no arrow.
4. A report with `@everyone` or a user mention pings nobody, a second report inside a minute is refused, and an unset channel returns a plain error with the form text kept.
5. Skipping from any step, including while Settings is open on steps 9 to 11, closes Settings, marks the tour seen and leaves no setting changed.

---

### Task 1: Open the game on the server

**Files:**
- Modify: `helpers/mewbeat/userSettings.js`, `helpers/mewbeat/activityChannel.js`, `helpers/activity/server.js`, `activity/src/mockState.js`
- Test: `tests/helpers/mewbeat/userSettings.test.js`, the `activityChannel*.test.js` files and `tests/helpers/activity/gateway.test.js`, `tests/helpers/mewbeat/outbox.test.js` where they mention locked or unlock

**Interfaces:**
- Produces: `getMewbeatRecord(userId) -> { tutorialSeen: boolean, settings }`, `markTutorialSeen(userId) -> record`, `updateMewbeatSettings(userId, patch)` with no unlock check. `state.mewbeat = { tutorialSeen, settings }`. Action `mewbeat_tutorial_seen` returns `{ mewbeat }`.

- [ ] **Step 1:** Update the tests first: a record with no stored data has `tutorialSeen === false` and can change settings; `markTutorialSeen` persists and keeps the settings; an old stored `{ unlocked: true, generation: 2, settings }` keeps its settings and has `tutorialSeen === false`; channel handlers no longer answer "locked". Run them and see them fail.
- [ ] **Step 2:** In `userSettings.js` drop `UNLOCK_GENERATION`, `unlockMewbeat` and the checks. Remove `isUnlocked` from `activityChannel.js` and every `fail("locked")` guard. In `server.js` remove the unlock checks (`:1246`, `:1652`), replace the `mewbeat_unlock` case with `mewbeat_tutorial_seen`, set `PRIVATE_PLACE_ACTIONS` to `mewbeat_tutorial_seen`, `mewbeat_settings`, `mewbeat_report`, and make `serializeMewbeat` return `{ tutorialSeen, settings }`. `createMockState` takes `firstRun` instead of `locked`.
- [ ] **Step 3:** Run `node scripts/run-tests.js`; expect all pass.

### Task 2: Button, Konami and the first start

**Files:**
- Modify: `activity/src/App.jsx`, `activity/src/mewbeat/UnlockReveal.jsx`, `activity/src/mewbeat/mewbit/manifest.js`, `activity/src/mewbeat/mewbeat.css` (reveal card rules)

**Interfaces:**
- Consumes: `state.mewbeat.tutorialSeen` from Task 1.
- Produces: `MewbeatRoot` (the game entry) receives prop `firstRun: boolean`, true when `!tutorialSeen` and there is no `context.roomInvite`. Task 5 reads it. Placeholder poses `talk`, `explain`, `happy`, `wave`, `wink` always exist in the manifest.

- [ ] **Step 1:** Add one `openGame()` in `App.jsx`: first run without an invite opens `UnlockReveal`, anything else starts the cut. The header button (`:3441`), the DM gate action (`:3404`), the auto-open effect (`:3366`) and the Konami handler all call it. Everything drops `mewbeatUnlocked`; `prepareGlitchSound` runs for desktop. `?mock=1&locked` becomes `?mock=1&firstrun`.
- [ ] **Step 2:** `UnlockReveal`: remove the card (title, copy, Play now, Later). When the `reveal` pose has finished, or at once when effects are calm, call `onDone`, which starts the cut with `firstRun` true.
- [ ] **Step 3:** Register `talk`, `explain`, `happy`, `wave`, `wink` in the manifest as `{ kind: "placeholder", group, motion }` poses (a CSS class in `mewbeat.css` animating the single PNG; see the manifest's header), under one block headed `// PLACEHOLDER ART: ...` that names each pose, what the real art must be (spec's Art table) and that swapping needs only `pose(...)` lines here. The Konami code plays `wink` on entry with "you know the code ✦".
- [ ] **Step 4:** `node scripts/run-tests.js` and `npx vite build` pass. In the preview, `?mock=1&firstrun` shows the button, and clicking it plays the reveal into the game.

### Task 3: Tour steps and geometry (pure)

**Files:**
- Create: `activity/src/mewbeat/tour/steps.js`, `activity/src/mewbeat/tour/geometry.js`
- Test: `tests/activity/mewbeat/tourSteps.test.js`, `tests/activity/mewbeat/tourGeometry.test.js`

**Interfaces:**
- Produces: `TOUR_STEPS` (12 entries: `{ id, target, side, pose, say, count, view, settings, also, primary, secondary }`, text from the spec; `view` is `"select"` for steps 1 to 7 and `"play"` from 8; `settings` is `"sound" | "gameplay" | "sync"` matching `GROUPS` in `SettingsPanel.jsx`). `tourNext(i) -> number | null`, `FORK_INDEX = 6`. `placePopup(targetRect, popupSize, side, viewport) -> { x, y }` stays inside the viewport. `curvedArrow(fromRect, toRect) -> { path, head }` as SVG path strings.

- [ ] **Step 1:** Tests: 12 steps in the spec's order; `tourNext` runs to `null` after the last; step 8's text is built from the player's keys (`say` may be a function of `keys`); `placePopup` clamps at all four edges; the arrow starts outside the popup and ends outside the target. See them fail.
- [ ] **Step 2:** Implement. Port the arrow logic from the mockup (`drawArrow`, `edgePoint`).
- [ ] **Step 3:** Run the two test files; expect pass.

### Task 4: Tour layer and the shared tag look

**Files:**
- Create: `activity/src/mewbeat/tour/TourLayer.jsx`, `activity/src/mewbeat/tour/tour.css`
- Modify: `activity/src/mewbeat/mewbeat.css` (a shared `.mb-tag` block)

**Interfaces:**
- Consumes: Task 3.
- Produces: `<TourLayer step={TOUR_STEPS[i]} keys={keys} effects={level} onNext={fn} onSkip={fn} />`. It finds its target with `document.querySelector('[data-tour="<id>"]')`, covers the screen and swallows all pointer input outside its own buttons. `.mb-tag` is style A: near-black, cut corners, cyan and pink split, stepped tail, JetBrains Mono, no tilt; values from `bubble-style.html`.

- [ ] **Step 1:** Build the layer: spotlight on the target, popup with portrait (the placeholder `talk`, `explain` or `happy` pose per step), counter, Next and Skip, curved arrow in style A. Steps without a target show full-size Mewbit centred with the popup. A missing target falls back the same way. Reposition on resize. No draw-in or pop animation when `effects` is not `"full"`.
- [ ] **Step 2:** Escape calls `onSkip`.
- [ ] **Step 3:** `npx vite build` passes. Check the layer on a test page in the preview: the arrow reaches its target and the popup stays on screen at 800 px wide.

### Task 5: Run the tour on the real Solo screens

**Files:**
- Modify: `activity/src/mewbeat/MewbeatGame.jsx`, `activity/src/mewbeat/SettingsPanel.jsx`, `activity/src/mewbeat/SongSelect.jsx`, `activity/src/mewbeat/mockLink.js`
- Test: `tests/activity/mewbeat/mockLink.test.js` (create if absent)

**Interfaces:**
- Consumes: `firstRun` from Task 2, `TourLayer`, `TOUR_STEPS`, `createMockRequest()` and `SONGS` from `mockRequests.js`.
- Produces: `createStillLink()` in `mockLink.js`: the `createMockLink` surface, a chart from `buildMockChart`, the song clock paused at 8 s, no `send`. `SettingsPanel` prop `forcedGroup` overrides `activeGroup`; prop `onReplayTour` adds a "Replay tutorial" button.

- [ ] **Step 1:** Test `createStillLink`: its clock doesn't advance, and it exposes no send.
- [ ] **Step 2:** Add `[data-tour]` to: the three `.mb-mode` buttons (`solo`, `live`, `room`), the picked song in `SongSelect`, its levels and board (`track`, `diff`), `.mb-keys` (`keys`), and the Settings rows (`setkeys`, `offset`, `sound`).
- [ ] **Step 3:** In `MewbeatGame`: a `tour` state of `null` or a step index, started from `firstRun` or Replay. While it's set, `const viewMode = tour === null ? mode : "solo"` drives the link and the screens instead of `mode`; `createLink` returns `createStillLink()`; `request` is `createMockRequest()`; the sample `SONGS[0]` is preselected. A step with `view: "select"` shows the picker, `view: "play"` shows the play screen. Steps with `settings` open the real `SettingsPanel` on that group. `mode` itself is never written, so the game opens where it would have.
- [ ] **Step 4:** End of tour (Skip, Skip to the game, Play): close Settings, clear `tour`, send `onAction("mewbeat_tutorial_seen")`. A replay needs no send. Replay is disabled in Room with a line of help text.
- [ ] **Step 5:** Tests and build pass. In the preview, `?mock=1&firstrun` walks all 12 steps, with a target found for each.

### Task 6: Reports on the bot

**Files:**
- Create: `helpers/mewbeat/reports.js`, `commands/utility/report.js`
- Modify: `helpers/activity/server.js`, `events/interactionCreate.js`, `.env.example` (if present)
- Test: `tests/helpers/mewbeat/reports.test.js`

**Interfaces:**
- Produces: `validateReport({ type, text }) -> { type, text } | throws`, `createReporter({ getClient, channelId, now }) -> { send(report) }`. `report = { type: "bug"|"idea", text, reporter: { id, name }, source: "activity"|"command", place, mode?, song?, level? }`. Action `mewbeat_report` returns `{ sent: true }`.

- [ ] **Step 1:** Tests: text under 10 or over 1000 characters refused; unknown type refused; a second send within 60 s for the same user refused, after 60 s accepted; the posted message has `allowedMentions: { parse: [] }` and carries every field; no channel configured or a failed post rejects with a plain message and doesn't start the cooldown. See them fail.
- [ ] **Step 2:** Implement `reports.js`, reading `MEWBEAT_REPORT_CHANNEL_ID`.
- [ ] **Step 3:** Add the `mewbeat_report` case in `server.js`, keeping it out of the room feed as `mewbeat_settings` is.
- [ ] **Step 4:** Add `/report` with a type option, `setContexts` for guild and bot DM, and a modal for the text. Route its submit in `interactionCreate.js` (`:364`) the way `ticket` does, customId prefix `report:`.
- [ ] **Step 5:** `node scripts/run-tests.js` passes.

### Task 7: Report panel in the Activity

**Files:**
- Create: `activity/src/mewbeat/ReportPanel.jsx`
- Modify: `activity/src/mewbeat/MewbeatGame.jsx`, the menu component rendering Resume, Settings and Quit, `activity/src/mewbeat/settings.css`

**Interfaces:**
- Consumes: action `mewbeat_report` from Task 6.
- Produces: `<ReportPanel context={{ mode, song, level, place }} onSend={fn -> Promise<boolean>} onClose={fn} />`.

- [ ] **Step 1:** Panel in the `.mb-settings` look: Bug or Idea, a textarea with a character count, Send and Cancel. A success closes it with a confirmation. A failure shows the error and keeps the text. Keys typed here must not reach the game, so opening it counts toward `inputPaused`.
- [ ] **Step 2:** Add "Report a bug" to the menu, next to Settings, and add a `reportOpen` state.
- [ ] **Step 3:** Build passes; in the preview the panel opens from the menu and its validation blocks a short text.

### Task 8: Bubble look and lines

**Files:**
- Create: `activity/src/mewbeat/mewbit/lines.js`
- Modify: `activity/src/mewbeat/mewbit/manifest.js`, `activity/src/mewbeat/mewbit/Mewbit.jsx`, `activity/src/mewbeat/Lobby.jsx`, `activity/src/mewbeat/Results.jsx`, `activity/src/mewbeat/lobby.css`, `activity/src/mewbeat/mewbeat.css`
- Test: `tests/activity/mewbeat/lines.test.js`

**Interfaces:**
- Consumes: `.mb-tag` from Task 4.
- Produces: `LINES` keyed by moment (`combo`, `miss`, `crushed`, `fever`, `charting`, `lobby`, `count`, `gradeS` to `gradeD`, `fullCombo`, `newBest`); `pickLine(moment, random = Math.random) -> string`, never the pool's previous pick in a row. Manifest poses change from `bubble: "text"` to `bubble: "<moment>"`.

- [ ] **Step 1:** Tests: never the same line twice in a row over 500 picks; every current line is still in its pool; every line in a play-time pool (`combo`, `miss`, `crushed`, `fever`, `count`) is at most 6 words. See them fail.
- [ ] **Step 2:** Write `lines.js`: existing lines, the mockup's draft, extended to 6 to 10 per pool in the voice of `helpers/brand.js`, understood at a glance.
- [ ] **Step 3:** `Mewbit.jsx` picks once per pose change (`shown`), with no re-pick on a re-render. `Lobby.jsx` and `Results.jsx` use `pickLine`, with one choice per state.
- [ ] **Step 4:** Apply `.mb-tag` to `.mb-mewbit-bubble`, `.mb-lobby-bubble` and `.mb-res-bubble`, removing their old look and tilt, and keeping their positions.
- [ ] **Step 5:** Tests and build pass. Check in the preview that the bubbles stay inside their stage in game, lobby and results.
