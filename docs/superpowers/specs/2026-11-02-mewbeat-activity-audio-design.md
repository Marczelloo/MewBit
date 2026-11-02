# mewbeat — Activity audio, solo, live boards, rooms (design)

Status: written 2026-11-02 for an overnight autonomous build. The user approved the direction
(memory: "mewbeat activity audio direction") and asked for everything left in the original spec
(`2026-10-31-mewbeat-rhythm-game-design.md`): song select, leaderboards, history, lobby, multiplayer,
results, "looking like the mockups" (`mewbeat-mockups/`). Phones stay out of scope.
Everything marked **(my call)** was decided by Claude without the user and should be checked.

## Why

Playing along to the bot through voice has unavoidable sync noise (voice latency, Lavalink position jitter)
and needs the bot to play for everyone. Playing the audio inside the Activity gives a sample-exact clock,
works alone, and makes rooms possible. The bot path stays as "Live" (play along to what the bot plays).

## Spike results (Discord desktop, 2026-11-02)

- Discord proxy served a 45 MB file at 24–28 Mbit/s; no autoplay block after a click; Opus/AAC/MP3 decode.
- `baseLatency` 10 ms, `outputLatency` 56 ms; `getOutputTimestamp()` agrees with `currentTime − outputLatency`.
- A decoded 4-minute song costs ~85 MB of memory — acceptable on desktop.
- Calibration taps landed ~75 ms early with hit sounds on: players align the hit sound, not the beat.
  **(my call)** calibration runs mute hit sounds.

## Modes

| Mode | Audio | When it is the default | Pause |
|---|---|---|---|
| **Live** | the bot in voice (existing path) | the bot is playing a track | no (Esc exits, as today) |
| **Solo** | the Activity (AudioContext) | the bot plays nothing | yes |
| **Room** | the Activity, started together | never (entered from the header) | no |

The header shows a mode switch `Live · Solo · Room`; Live is disabled when the bot plays nothing.
If the user picks Solo while the bot plays, both play: a one-line hint says "Lower MewBit in Discord to hear
the song" **(my call: hint only, no auto-mute)**.

## Song audio pipeline

1. Lavalink plugin route `POST /v4/mewbeat/audio` body `{ "encodedTrack": "..." }` → `200 audio/ogg`
   (Ogg Opus, 48 kHz stereo). Decoding reuses the analysis decoder but with `DISCORD_OPUS` output, forced
   re-encode (no passthrough, so the timeline starts exactly at 0), Opus quality 5 **(my call: Pi CPU)**,
   pre-skip 312. A minimal Java Ogg muxer writes OpusHead/OpusTags and one packet per page-segment group with
   granule positions from each packet's TOC. One job at a time, decode thread at MIN_PRIORITY.
   Errors: `422 {error}` when the track can't be loaded, `503` when busy over 2 queued jobs.
2. Gateway route `GET /api/activity/mewbeat/audio?guildId=&audioKey=` (Bearer auth like the other routes).
   Looks the audioKey up in the solo track registry, serves `helpers/data/mewbeat/audio/<sha1>.ogg` from disk
   or fetches it from the plugin first (one plugin job at a time, concurrent requests share a promise),
   writes it atomically, keeps the 40 most recently used files **(my call)**. `Content-Type: audio/ogg`,
   `Cache-Control: private, max-age=86400`, CORS like the spike did. Unknown audioKey → 404.
3. The Activity fetches it as an ArrayBuffer, `decodeAudioData`, and plays an `AudioBufferSourceNode`
   through a gain node (music volume setting).

## Solo track registry

`mewbeat_solo_prepare { uri, source }` resolves a search result (or a history entry) through Poru into an
encoded track, computes its audioKey (`helpers/mewbeat/audioKey.js`), and stores `{track, node, info}` in an
in-memory LRU (128 entries, 6 h) **(my call)**. It starts chart generation (`chartStore.getCharts`) without
waiting. `mewbeat_chart` for an audioKey in the registry serves charts for that track instead of requiring
it to be the bot's current track. Rooms use the same registry.

## Solo clock

A "solo link" implements the same interface as `createMewbeatLink` (status, songClock, requestChart,
onAnchor/onChart/onStatus, setTrackInfo, track, start/stop/handle/syncNow), so `useMewbeatGame` runs
unchanged. Its songClock maps `performance.now()` to song time through the AudioContext:
`getOutputTimestamp()` (fallback `currentTime − outputLatency − baseLatency`) relative to the source's start.
Pause stops the source and remembers the position; resume starts a new source at that offset after a
3-2-1 count-in of 0.5 s per step **(my call)**. A paused-and-resumed solo run stays ranked **(my call)**;
restart starts a fresh run.

## Song select (mockup `song-select.html`, English copy)

osu-like list: artwork, title, artist, length, per-difficulty stars (from `charts/stars.js` when the charts
exist, "—" until then), the player's best grade per difficulty. Scopes: **Played on this server** (default),
**Played anywhere**, plus a search box that searches every source (existing search API). Picking a song
shows its difficulties and **Play** (solo) — and in a room **Add to room queue**. **(my call)** the original
"Add to bot queue" buttons are dropped from song select: the bot queue belongs to the music panel.

## Results (mockup `results-v2.html`)

Grade, score count-up, NEW BEST, accuracy, max combo, fevers, average offset, judgement counts,
"#N server · #N global" (from the submit reply), hit-timing histogram with **Adjust offset**, Mewbit reacting to
the grade, standings (live/room) with "next ✓" marks, **Server best** top 5. Actions: **Back** (live: back to
playing), **Song select**, **Next round** (live: "Up next: <title> · chart ready"; room: host only / auto timer).
The intermission highlight replay through the bot is dropped **(my call: it would play to all listeners)**.

## Scores, leaderboards, history

- At the end of every run with ≥1 judged note the client sends `mewbeat_submit` with its per-note judgement
  list and fever starts. The server recomputes score/accuracy/grade with the client's own `scoring.js`
  (dynamic `import()` from `activity/src/mewbeat/scoring.js`, which ships in the Docker image) and rejects
  lists longer than the chart.
- Ranked = not autoplay, not calibration, no difficulty change, not joined late (first judged note within the
  first 2 s of the chart **(my call)**), current chart version, ≥ 50 % of notes judged.
  Unranked runs go to history only.
- `helpers/data/mewbeat/scores.json`: best per user per `audioKey|difficulty|chartVersion`, with guildIds
  the user scored it in (server board = users who scored it in that guild). `history.json`: last 200 rounds
  per user `{audioKey, uri, source, title, artist, artworkUrl, durationMs, difficulty, score, accuracy, grade,
  ranked, mode, guildId, at}`. Both through `helpers/data/atomicJson.js`, debounced writes.
- Mixed difficulties (rooms, live) rank standings by accuracy, otherwise by score.

## Live leaderboard (live and rooms)

Clients send `mewbeat_live {session, score, combo, accuracy, difficulty, ended}` at ≤ 4 Hz while running.
Session = `room` in a room, `live:<audioKey>` in Live. The server keeps entries for 5 s after the last update
and pushes `mewbeat_live_board` to every member of the session at ≤ 4 Hz. The game shows a mini board
(top 5 + you) in the side column. Solo has none.

## Live difficulty change

A difficulty control in the track card (Live and Solo; disabled in rooms). On change the new chart is
requested; when it arrives notes already within the approach window stay, everything after is replaced by
the new chart's notes. Score and combo carry over; the run becomes unranked.

## Settings rework

One panel with three sections — **Gameplay** (keys, scroll speed, tempo scroll, default difficulty),
**Audio & sync** (offset, calibrate, auto offset, hit sounds + volume, **music volume** (new, 0–100, default
80, solo/room only)), **Visual** (effects, show Mewbit) — styled with the mockup tokens below.

## Rooms (mockup `lobby-v3.html`)

- **(my call)** one room per Discord server ("the server's room"), at most 10 players; later joiners spectate.
  The first member is host; the host role passes to the oldest member on leave. A member leaves on
  "Leave room" or when their socket closes.
- Anyone in the room adds songs (song select → Add to room queue, max 20 entries); the host or the adder
  removes them. The host starts the round.
- Round: server phase `loading` (clients fetch audio + chart, report `mewbeat_room_loaded`) → when all have
  loaded or after 20 s, `startAt = serverNow + 5000` → 5-4-3-2-1-GO overlay; each client maps `startAt`
  through its server clock onto AudioContext time → `playing` → `results` when every player submitted or
  `duration + 5 s` passed → `intermission` (15 s auto timer if the queue has a next song; the host can start
  now) → next round.
- Lobby view: "Round starts in mm:ss" during intermission, queue timeline (current cyan, yours pink),
  Mewbit stage (idle, peek in the last 15 s, hype on 5–1, "nyaa~ ✦"), players list (40 px avatars,
  difficulty pill, ready dot, own row cyan border + YOU badge), difficulty buttons + informational Ready
  toggle, invite card, keys/offset/Calibrate row.
- Skip & defer votes from the original spec are dropped **(my call: the room queue replaces the bot queue
  session model)**.

## Invites (lowest priority)

"Invite" in the lobby posts one bot message in the inviter's voice channel chat: "<name> is playing mewbeat"
with a **Join** button that launches the Activity (`interaction.launchActivity()` when the discord.js version
supports it, else an ephemeral hint). 60 s cooldown per server. An invite doesn't unlock mewbeat permanently.

## Visual tokens (from the original spec)

bg #050608, surface #0c0e12, raised #111318, high #161920, text #f4f6f9, muted #9ba4b2, faint #667081,
cyan #67e3f4, violet #a78bfa, pink #ff6ec7, danger #ff8098, gold #ffd479; Hanken Grotesk + JetBrains Mono.
All UI copy English.

## Non-goals

Phones/touch; Live-mode pause; bot-side replay; anti-cheat beyond server recompute; cross-server rooms.
