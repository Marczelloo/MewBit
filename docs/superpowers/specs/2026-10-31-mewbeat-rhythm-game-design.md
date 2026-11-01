# mewbeat — Rhythm Minigame Easter Egg

Date: 2026-10-31
Status: awaiting review

## Intent

A hidden rhythm game inside the MewBit Discord Activity, opened for the first time with the Konami code. It works like Guitar Hero or osu!mania with 4 lanes and runs on **any track the bot can play**. Charts are generated automatically from the audio.

What makes it special is that it is played *together, on the music the bot is already playing in the voice channel*. Nobody has to upload a song or download a chart. Everyone in the channel can jump in, each with their own score, streak and combo.

Mewbit is the on-screen companion. It reacts to how you play, dances in the lobby and cheers on the results screen.

The game is an easter egg, not a product pivot. It must never get in the way of people who just want to listen to music.

### Success looks like

- A friend group in a voice channel plays several rounds back to back, with no dead time between songs.
- The notes feel like they belong to the song.
- Hits feel neither late nor early after the first round or two.

## Goals

- Rhythm game in the Activity, desktop Discord only for now.
- 4 lanes. Default keys D F J K, rebindable.
- Charts generated from audio by a custom Lavalink analysis plugin, in three difficulties: Easy, Normal, Hard.
- Audio always comes from the bot in the voice channel. The game never plays its own copy of the song.
- Multiplayer by default: every player in the session has their own score, combo, accuracy and grade, plus a live mini scoreboard of the others.
- Two ways in:
  - **Live:** play the currently playing track.
  - **Song select:** osu-like library browser with "Play now" or "Add to queue". Both lead into the lobby.
- Rounds follow the bot queue. After the results there is a short intermission, then the next queued (or autoplay-picked) track becomes the next round.
- Global leaderboards, viewable per server and globally, plus play history per user and per server. The history also acts as the song-select library.
- Per-account settings and a permanent per-account unlock.

## Non-goals (for this version)

- Mobile or tablet support. The mewbeat entry point must not appear on mobile.
- Spectate mode. Non-players see the normal player.
- Hand-authored or imported charts (osu!, StepMania files).
- Hold notes and sliders. Tap notes only. Holds are a possible later addition, but the chart format must not rule them out (see Chart format).
- Feeding game data into autoplay. The user noted this as a separate topic.
- Final Mewbit art. Placeholders only; the final art is anime-style frame-by-frame images delivered later.

## Anti-goals — failure even if it "works"

These were named by the user, most important first.

1. **Notes that don't match the music.** Random-feeling notes, notes off the beat, dense notes in quiet parts, or empty drops.
2. **Long waits in live mode.** Starting live or moving to the next round must not mean staring at a "charting…" spinner.
3. **Hits that feel late or early.** Audio and visual sync is the core feel problem.
4. **Disturbing normal listening.** People in the channel who aren't playing must not have their music experience degraded. No surprise pauses, skips or volume jumps outside an active game session.
5. **Raspberry Pi stutter.** Analysis must never cause audible playback stutter on the production Pi.
6. **Bad difficulties.**
   - Easy that is still hard.
   - Hard that is just Normal with more random notes.
   - Unplayable jacks (repeated fast notes in one lane) or chords.

## Constraints

- **Branch and merging:**
  - All work happens on a dedicated branch off `main`, proposed name `feat/mewbeat`.
  - Nothing merges into `main` until the whole feature is finished.
  - This spec gets committed to that branch when it is created.
- **Testing:** runs locally on the user's Windows PC with the bot and Lavalink (including the new plugin) in Docker (`docker-compose.local.yml` / `helpers/lavalink/docker-compose.yml`). Not on the Raspberry Pi.
- **Production target:**
  - Raspberry Pi, arm64.
  - Lavalink v4 in Docker (`ghcr.io/lavalink-devs/lavalink:4`), alongside lavasrc 4.8.3, the patched youtube-plugin and lavalyrics 1.1.0.
  - Local plugin jars live in `helpers/lavalink/plugins/`.
  - `bufferDurationMs: 400`, `frameBufferDurationMs: 1000`.
  - The `http` and `local` sources are disabled.
- **Bot stack:** Node, discord.js 14 and poru (`helpers/lavalink/client.js`). Persistence is JSON stores through `helpers/data/atomicJson.js`. User prefs live in `helpers/users/preferences.js`.
- **Activity stack:**
  - React 19 + Vite + motion in `activity/`.
  - Talks to the bot over the WebSocket at `/api/activity/ws` (`helpers/activity/server.js`, which handles message types like `play`, `skip` and `seek` in a switch).
  - Position interpolation lives in `activity/src/hooks/usePlayerPosition.js`.
- **Language:** all game UI is in English, matching the existing player.
- **Visual system:**
  - The game reuses the Activity's tokens (DESIGN.md / `activity/src/styles.css`). Colours:

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
  - The game is allowed to be louder and more arcade than the player: lightly Friday-Night-Funkin'-flavoured, but original.
  - No zero-offset glow.
  - Honour `prefers-reduced-motion` (also see the Effects setting).

## Decided design

### Mockups

The final, approved mockups are copied to `docs/superpowers/specs/mewbeat-mockups/`. They are throwaway HTML: they show layout, hierarchy and behaviour, not production code.

| File | Screen | Notes |
|---|---|---|
| `game-screen-v3.html` | In-round game (layout C) | Includes the multiplier ring, vibe meter, FEVER (press Space, or autoplay triggers it in the demo) and Mewbit states. |
| `song-select.html` | Song select | Accepted for layout. **Its copy is Polish; production copy must be English.** |
| `lobby-v3.html` | Lobby / waiting room | Countdown, queue timeline, Mewbit waiting poses, players, invite, keys/offset row. |
| `results-v2.html` | Results + intermission | Own result card, timing histogram, standings with next-round votes, server best. |

`mewbit.png` in the same folder is the placeholder Mewbit image the mockups load (they reference `/files/mewbit.png`, which was the mockup server's path).

### Screens

#### Entry and unlock

- **First entry is the Konami code** (↑ ↑ ↓ ↓ ← → ← → B A), typed anywhere in the Activity on desktop.
  - It triggers a short glitch animation over the Activity.
  - Mewbit then pops in saying "you found me!".
  - The game is unlocked **permanently for that Discord account**, stored server-side, not in browser storage.
  - *My call:* the code works anywhere in the Activity, and the glitch plus Mewbit line is the reveal.
- After unlocking, a **mewbeat button** appears in the normal player, so the code is not needed again.
- On mobile clients the button never appears and the Konami listener is inactive.

#### Invites

- A player in a session can optionally invite the channel. The bot posts **one message in the voice channel's text chat** (*my call*) with a "Join" button.
- Clicking it opens the Activity straight into that session's lobby.
- That user can play that round (and the following rounds of the same session) without knowing the code.
- *My call:* an invite does **not** unlock the game permanently. The permanent unlock is only via the Konami code.

#### Non-players

People in the channel who are not in the game keep seeing the normal player. There is no spectate mode in this version.

#### Game screen (layout C)

- The note highway is centred.
- Mewbit is on one side, reacting to hits, misses, combo milestones and FEVER.
- The HUD is on the other side:
  - score;
  - combo with the multiplier ring next to it;
  - accuracy;
  - vibe meter;
  - a live mini scoreboard of the other players.

#### Song select

- Osu-like list: the song with its artwork, plus per-difficulty star ratings computed from the chart.
- Library scopes: **Played on this server** (default) and **Played anywhere** (global). Both come from play history.
- A search box queries the bot's normal search and lets you play anything.
- Choose a difficulty, then **Play now** or **Add to queue**. Add to queue asks **Play next** or **End of queue** (user decision).
  - "Play now" means play next and skip the current track. That affects everyone listening, so it follows the same rules as the normal player's play-now (DJ permissions and so on).
  - "Add to queue" also follows the normal player's queue permission checks. *My call.*
  - All of them go to the lobby, or straight into the next round if one is about to start.

#### Lobby

- A big **countdown "Round starts in mm:ss"**, which is the time until the next track starts. Since every track is a round, this is simply the rest of the current song when you enter mid-song.
- A proportional **queue timeline**: the current track as a cyan fill and the upcoming rounds after it. The track you picked is in pink.
- A **"Skip & defer"** vote on the up-next track (see Session model).
- A **Mewbit stage** with waiting poses:
  - idle loop (sway, stretch, bob to the current song, headphones);
  - **peek** in the last 15 s;
  - **hype** on 5–1;
  - "nyaa~ ✦" on GO.
- A full-screen 5-4-3-2-1-GO overlay as the game track starts.
- **Players list:** 40 px avatars, the chosen difficulty pill and a ready status dot. Your own row is highlighted with a cyan border, a gradient and a YOU badge.
- Your own difficulty buttons and a **Ready** toggle.
  - *My call:* Ready is informational only. The round starts when the song starts, ready or not.
- **Invite card** (see Invites).
- **Keys / offset / Calibrate** row.

#### Results and intermission

- **Intermission bar:** "replaying the drop… quietly", a 10 s timer and progress.
- **Your card:**
  - grade, from S down through A, B, C and D;
  - score count-up and a NEW BEST badge;
  - Accuracy, Max combo, Fevers and Avg offset;
  - judgement counts;
  - rank as "#N server · #N global".
- **Hit-timing histogram** with an "Adjust offset" link.
- **Mewbit stage** reacting to the grade: cheer for good results, a softer reaction for poor ones.
- **Standings** of all players in the round, with a "next ✓" mark when they voted, plus the **Server best** top 5 for that track and difficulty.
- Actions:
  - **Back to player:** leaves the session.
  - **Song select:** stays in the session and picks what's next.
  - **Next round:** a vote. Shows "Up next: <title> · chart ready".

### Session model: rounds follow the bot queue

- One **mewbeat session** per voice channel / guild player at most. It exists only while at least one player is in it.
- **The game has priority while a session exists** (user decision). Every track the bot plays is a **round**, including the tracks between now and a song someone picked. "Live" and "next round" are the same thing: playing along with the queue in a full loop.
- The session moves through these states:
  1. **lobby** — waiting for the next track to start, for example after joining mid-song (or play the rest of it live, unranked);
  2. **playing**;
  3. **results/intermission**;
  4. then **playing** the next track.
- **Skip & defer vote** (user decision): players can vote to skip a track they don't want to play. The track is **moved to the end of the queue**, not removed.
  - It is available for the up-next track (lobby and intermission) and for the current round. A passed vote mid-round ends that round unranked.
  - Only session players vote. It passes with a majority of them, so a solo player passes it alone. *My call.*
  - If the track is autoplay's pick, deferring means autoplay picks a replacement instead. *My call.*

  When the last player leaves, the session ends and the bot continues as a normal player.
- **Joining mid-song** is allowed but **unranked**. You play from where the song is, and the score is shown but not saved to leaderboards.
- A round is **ranked** only if all of these hold:
  - the player was in from the first note;
  - the track wasn't seeked, paused or re-filtered during the round;
  - the timescale/speed filter is neutral;
  - the chart version is current.

#### Intermission

- About 10 s after a round ends.
- The bot quietly replays the **finished song's highlight** (the drop or chorus, detected by the plugin) with a fade in and out at reduced volume.
- If no highlight was found, or the replay can't be done, the intermission is silent.
- It ends early once every player has chosen an action.
- *My call:* the next round starts when the intermission ends, provided at least one player voted Next round or is still sitting in the session. Players who chose Back to player are out.
- The intermission always runs while a session exists, even when non-players are in the channel (user decision: the game has priority).

#### Mixed difficulties and empty queue

- Players in one round can be on different difficulties. The live mini scoreboard and the results standings **rank by accuracy**, and show score plus a difficulty badge, because raw score favours Hard. *My call.*
- All three difficulties are generated whenever a track is charted. Generation is cheap once features exist.
- If the queue is empty and autoplay is off, or its pick can't be charted, the session goes back to the lobby in a "queue something" state that points to Song select. The bot stays a normal player meanwhile. *My call.*
- A track that can't be charted plays as normal listening. Players wait in the lobby. *My call.*

#### Pre-analysis and early autoplay pick

- While a round plays, the bot makes sure the **next queue item** is analysed and charted.
- If the queue is empty and autoplay is on, autoplay is asked to pick the next track **early** (during the round, not at track end) so it can be charted in time.
- The results screen shows "chart ready" once it is.

### Gameplay rules

- **Judgement windows** (absolute hit error after offset correction): PERFECT ≤ 40 ms, GREAT ≤ 75 ms, GOOD ≤ 110 ms. A press 110–150 ms early takes the note as a MISS (early miss band, as in osu!mania), so mashing ahead of the notes breaks combo; a hold missed this way loses its tail too. Anything later, or no hit, is a MISS.
  - A press with no note within the GOOD window does nothing. There is no penalty for ghost taps.
- **Base points:** PERFECT 300, GREAT 200, GOOD 100, MISS 0. These are the mockup values, and the builder may tune them.
- **Combo multiplier:** ×1 to ×4. +1 per 10 combo, so `mult = min(4, 1 + floor(combo / 10))`.
  - A MISS resets the combo and with it the multiplier.
  - It is shown as a ring next to the combo number, with a colour per level.
- **Score per hit:** `base × mult × (fever ? 2 : 1)`.
- **Vibe meter:** +0.03 per PERFECT, +0.02 per GREAT, +0.01 per GOOD, −0.06 per MISS, clamped to 0–1.
- **FEVER:**
  - When vibe is full, the player presses **Space** to activate it.
  - It gives 8 s of double points and a visual/Mewbit FEVER state.
  - Vibe drains over those 8 s.
  - FEVER is per player.
- **Accuracy:** a weighted hit ratio: PERFECT 100%, GREAT 66.7%, GOOD 33.3%, MISS 0.
- **Grade from accuracy:** S ≥ 95, A ≥ 90, B ≥ 80, C ≥ 70, else D. S doesn't require a full combo.
  - *My call.*

### Charts

#### Analysis: Lavalink plugin (new)

- A custom Lavalink v4 plugin, in Java or Kotlin and built with Gradle. The jar is dropped into `helpers/lavalink/plugins/`.
- It exposes an authenticated REST route, for example `POST /v4/mewbeat/analyze`, taking an encoded track and returning a features JSON.
- It loads the track itself and decodes it **faster than realtime** into PCM, without a voice connection. It then extracts:
  - the onset strength envelope in **3–4 frequency bands** (low / low-mid / high-mid / high), with peak-picked onsets per band;
  - tempo (BPM), with a confidence value and a beat grid (beat times plus downbeat estimate);
  - an energy curve and section boundaries (verse, chorus, drop-like high-energy segments);
  - the **highlight timestamp**, which is the start of the strongest sustained high-energy section (the drop or chorus). It is used for the intermission replay.
- **Pi safety (hard requirement):**
  - The analysis worker runs at minimum thread priority.
  - At most **1 analysis at a time**.
  - It is throttled if needed so it never starves the playback threads.
  - "No audible stutter while analysing on the Pi during playback" is an acceptance test.
  - It is checked **twice** on the Pi: a quick benchmark right after the plugin spike (a decision gate: if it fails, come back to the user before going further), and once before the branch is called done. Day-to-day testing stays local. *My call.*
- **Speed target:**
  - A typical 3–5 min track analysed in well under its own duration on the Pi.
  - The goal is under 20 s, so the pre-analysis of the next track always finishes during the current one.
  - Live mode on a cold track should mostly avoid waiting (see Live start on an uncharted track).
- **Metronome source:**
  - The plugin also registers a tiny generated audio source (for example a `mewbeat:metronome` identifier with a BPM) so the bot can play a click track for calibration.
  - This is needed because the `http` and `local` sources are disabled.
  - *My call.*

#### Chart generation: bot side (Node)

- The bot turns features into charts. Keeping generation in Node, not in the plugin, makes iteration on chart feel cheap and versionable.
- **Deterministic:** the same features, generator version and difficulty always give the same chart. That is what makes leaderboards fair.
- **Cache on disk:**
  - features are keyed by the **exact audio that gets played**: the resolved playable track's `sourceName + identifier + length`. That is the same encoded track the player plays (for Spotify/Deezer items, the resolved mirror). The fuzzy `trackIdentity.js` key is not used, because it merges different uploads and edits.
  - Analysis always runs on the queue item's own resolved encoded track. If the item is re-resolved to a different stream at play time, the chart is treated as missing (see Live start on an uncharted track).
  - charts are keyed by `audioKey + generatorVersion + difficulty`, and leaderboards use the same key. *My call.*
- Bumping the generator version invalidates old leaderboards for that chart. Scores are stored with the chart version, and only current-version scores are shown.
- **Musicality rules (anti-goal 1):**
  - Notes come only from detected onsets. When tempo confidence is high, onsets snap to the beat grid at the difficulty's subdivision.
  - Density follows the energy curve: quiet parts are sparse and drops are dense.
  - The lane comes from the band the onset is strongest in (low → outer-left …). Then a smoothing pass breaks up long single-lane runs and avoids awkward patterns.
  - No notes in near-silence. There is a short lead-in before the first note.
- **Difficulty rules (anti-goal 6):** target note density and minimum gaps per difficulty.

  | | Easy | Normal | Hard |
  |---|---|---|---|
  | Max grid | 1/2 beat | 1/4 beat in high-energy parts | 1/4 beat throughout, occasional 1/8 on very strong onsets |
  | Same-lane gap | ≥ 1 beat | ≥ 1/2 beat | ≥ 1/4 beat |
  | Chords | none | 2-note chords on strong downbeats only | 2-note chords; never 3+ |

  The numbers are a starting point for tuning. What isn't negotiable: Easy must be playable by a newcomer, and Hard must be a different chart, not Normal plus noise.
- **Star rating** per chart from density and pattern difficulty, shown in song select.

#### Live start on an uncharted track

- If a player enters live while the current track has no chart yet, analysis is started immediately.
- The player sees a short "charting…" state with Mewbit, then joins from the current position. This is unranked, since they weren't in from the first note.
- If analysis fails (the source can't be decoded, or the track is a stream), the round is shown as "this track can't be charted". Players wait in the lobby for the next one.
- Thanks to pre-analysis, this case should mainly happen for the very first track of a session.

#### Chart format

- JSON:
  - `version`, `trackIdentity`, `difficulty`, `durationMs`, `stars`, `highlightMs`;
  - `notes: [{ t: ms, lane: 0–3 }]`.
- A future `len` field for holds must be addable without breaking the format.

### Timing and sync (anti-goal 3)

- **Song time reference:** the bot knows the Lavalink player position. The game needs much tighter sync than the normal player's progress bar.
  - The session channel sends song-time anchors: position plus server timestamp, at every track start, seek or resume, and periodically.
  - The client keeps a clock-offset estimate to the server via WS ping/pong (NTP-style, median of several samples).
  - The client maps `performance.now()` to song time and renders notes from that.
- **Pipeline latency:** Lavalink to Discord voice to the user's ears adds an unknown, fairly stable delay. It is handled by the per-user offset.
- **Input:** judgements happen client-side using `KeyboardEvent.timeStamp`, so frame timing doesn't add error. Rendering runs on `requestAnimationFrame`.
- **Offset:**
  - **Auto-adjust** from the hit-timing histogram of the first rounds: after each of the first ~3 ranked-or-not rounds, move the offset towards the median error of GOOD-or-better hits.
  - Auto-adjust stops once it is stable, or as soon as the user moves the slider.
  - A **manual slider** is in settings, with the lobby and results "Adjust offset" shortcuts.
  - **Metronome calibration through the bot:** the bot plays the click track and the user taps along. It is only available when the user is **alone in the voice channel**, so nobody else hears clicks. Otherwise it is disabled with a short reason.
- **Players must be in the bot's voice channel.** That matches the Activity's existing playback rules, and sync depends on hearing the bot. Leaving the voice channel mid-round drops you out of the round, and the score is not saved. Sessions hold at most 10 players. *My call.*
- **Score submission (light anti-cheat):**
  - At round end the client sends its hit list: note index and signed error in ms.
  - The server recomputes the score from the chart and the hit list, and stores only that.
  - Live updates during the round (score, combo, last judgement) go over WS at a low rate (around 4 Hz) for the mini scoreboard.
  - *My call.*

### Settings (per Discord account, server-side in user preferences)

| Setting | Default | Notes |
|---|---|---|
| Keys | D F J K | Rebindable; any 4 distinct keys; Space reserved for FEVER |
| Offset | 0 ms, then auto | Slider plus Calibrate (alone-only) |
| Scroll speed | mid | Note approach time |
| Live difficulty | Normal | Used when entering live mode |
| Effects | Full | Full / Reduced / Off. `prefers-reduced-motion` forces at most Reduced. |
| Hit sounds | Off | Played locally in the client only, never through the bot |

Unlock state (`unlocked: true`, `unlockedAt`) lives in the same per-account record.

### Leaderboards and history

- **Leaderboards:**
  - Per chart, meaning audio key + difficulty + chart version.
  - Each user's best score.
  - Viewable **per server** (scores set in this server) and **global**.
- **History:**
  - Every finished round per user, with track, difficulty, score, accuracy, grade, ranked flag, guild and time.
  - Queryable per user (global / this server) and per server.
  - It powers the song-select library: a track appears there once anyone has played it on this server (server scope) or anywhere (global).
- **Storage:**
  - New JSON stores via `atomicJson`, under `helpers/data/` (for example `mewbeat-scores.json`, `mewbeat-history.json`, plus the chart/feature cache directory).
  - History is capped or rotated so the files can't grow without bound on the Pi. The cap is the builder's choice.

### Mewbit art: pose list for the artist

Placeholders for now: the current Mewbit image with CSS motion. The final art is frame-by-frame anime-style image sequences. Each pose needs its own sequence; the list below is the brief.

- **Lobby:** idle sway, stretch, bob (on the beat of the current song), headphones adjust, peek (last 15 s), hype (5–1), go ("nyaa~ ✦").
- **Game:**
  - neutral/vibing;
  - good hit or streak reaction;
  - miss flinch;
  - combo milestone (×2, ×3, ×4);
  - FEVER;
  - "charting…" waiting.
- **Results:** cheer (S/A), okay (B/C), sad but cute (D), new best.
- **Unlock:** glitch-in plus "you found me!".

The frame format is the builder's choice (frame folders or sprite strips, per-pose fps). It must be swappable without code changes beyond a manifest.

## My calls (please check these)

- The Konami code works anywhere in the Activity. The reveal is a glitch animation plus Mewbit saying "you found me!", then the permanent unlock.
- An invite lets you play that session without the code, but does not unlock the game permanently.
- "Ready" in the lobby is informational only. The round starts with the song regardless.
- The invite is posted as one message in the voice channel's text chat.
- The next round starts after the intermission if at least one player is still in the session. "Back to player" leaves the session.
- Grades: S ≥ 95 %, A ≥ 90, B ≥ 80, C ≥ 70, else D. S doesn't require a full combo.
- Rankedness:
  - A round is ranked only when the player was in from the first note.
  - There must be no seek, pause or filter change, and speed must be neutral.
  - The chart version must be current.
- The plugin only extracts features. Chart generation lives in Node and is versioned.
- The metronome is a generated audio source inside the plugin, because the `http` and `local` sources are disabled.
- The server recomputes the score from the hit list at round end. There is light anti-cheat, nothing heavier.
- Ghost taps aren't penalised.
- Charts, cache and leaderboards are keyed by the exact resolved audio (source + identifier + length), not by the fuzzy song identity.
- Players must be in the bot's voice channel. Leaving drops you from the round. There are at most 10 players per session.
- Mixed difficulties in one round are ranked by accuracy in the standings. All three charts are generated per track.
- An empty queue (autoplay off or failing) or a track that can't be charted sends the session back to the lobby. That track plays as normal listening.
- The plugin is checked on the Pi right after the spike, as a decision gate.

## Left to the builder

- **Plugin internals:** the DSP approach (FFT size, onset function, tempo estimator), the exact REST shape, and how to decode a track outside a player in Lavalink v4 / lavaplayer.
  - Spike this first: it is the biggest technical risk.
  - Check also that loading a track a second time for analysis (especially YouTube) doesn't trip rate limits.
- Chart generator details and tuning.
  - Build a small **chart preview tool**: play a track with the chart's notes as clicks, or an autoplay view.
  - Tune by ear on a varied test set of roughly 10 tracks (EDM, rock, hip-hop, pop, acoustic, something with tempo changes).
- **Rendering tech** for the highway: canvas or DOM/CSS transforms. It must hold the display refresh rate in the Discord desktop client.
- **How the invite button launches the Activity.** Candidates are the interaction `LAUNCH_ACTIVITY` response or an Activity invite link. Verify which one Discord allows here.
- **How "desktop vs mobile" is detected.** Likely the Embedded App SDK's platform info.
- **WS message names and shapes** for the session (join, leave, difficulty, ready, hit stream, results, vote). They are added to the existing `/api/activity/ws` handler.
- **Intermission implementation:** seeking the finished track to `highlightMs`, a volume fade via the Lavalink volume filter, and how it interacts with the queue, loop and autoplay.
- Exact settings UI placement, the points table, the star-rating formula and history retention.
- The order of work.

  Suggested order:
  1. plugin spike;
  2. features to charts plus the preview tool;
  3. single-player live game;
  4. sessions and multiplayer;
  5. lobby and song select;
  6. results, intermission and leaderboards;
  7. unlock and invites;
  8. polish and art hookup.
