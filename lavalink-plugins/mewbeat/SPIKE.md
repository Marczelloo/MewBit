# Spike: decoding a track outside a guild player

Task 3 of the charts pipeline. Question: can the mewbeat plugin decode a full
track to PCM using the Lavalink node's own source managers, without a guild
player, and fast enough to be useful? Answer: yes. Measured 21x to 32x
realtime on an idle node (YouTube).

## Approach

`POST /v4/mewbeat/analyze` takes `{"encodedTrack":"<base64>"}`. The plugin decodes
the track with Lavalink's shared `AudioPlayerManager` bean, so every source the
node already has (YouTube with its plugin and cipher, LavaSrc, Bandcamp, ...)
works unchanged.

`LavaplayerTrackDecoder` does the decode:

1. `playerManager.decodeTrack(...)` turns the base64 string into an `AudioTrack`.
2. We copy the manager's configuration and switch its output format to PCM
   (`StandardAudioDataFormats.DISCORD_PCM_S16_LE`, 48 kHz stereo s16), with low
   resampling quality. Lavalink's own players use Opus output, which we cannot use.
3. We build a `LocalAudioTrackExecutor` ourselves, give it to the track
   (`assignExecutor`) and run `executor.execute(...)` on our own daemon thread
   (`mewbeat-decode`, MIN_PRIORITY).
4. The analysis thread pulls frames with `executor.provide(frame, timeout)` in a
   loop, as fast as the source delivers them (no realtime pacing), and hands the
   PCM to the DSP (`Downsampler` to 24 kHz mono, then `FeatureExtractor`).
5. In `finally` the executor is stopped and the decode thread interrupted, so a
   cancelled or failed job never leaves a source connection open.

Nothing is registered with a guild, no `AudioPlayer` is created and no voice
connection is involved, so a running analysis cannot disturb playback state.

### Alternatives considered

- `playerManager.executeTrack(...)` with an `AudioPlayer`: runs the decode on
  lavaplayer's shared track-playback pool, which is the same pool the node's real
  playback uses. An analysis would compete with live music at normal priority and
  we could not control the thread. It also forces Opus (the manager's configured
  format) and a player. Rejected.
- Fetching the stream URL ourselves and decoding with ffmpeg or Java: would bypass
  the source managers (cipher, tokens, signed URLs, rate limit handling) and drag
  in a decoder dependency. Rejected.

### The worker

`AnalysisWorker` runs jobs on a single thread named `mewbeat-analysis` at
MIN_PRIORITY, behind a bounded queue of `plugins.mewbeat.maxQueue` jobs (default 4).
When the queue is full the request is answered `503 {"error":"busy"}` immediately.
A watchdog arms a 120 s timeout per job and interrupts the worker, which cancels
the decode (it shows in the log as `result=timeout`). Streams and tracks longer
than `maxTrackMs` (default 20 min) are refused before any audio is fetched:
`422 {"error":"uncharted","reason":"stream"|"too_long"}`.

Caveat on priorities: on a Linux JVM, `Thread.setPriority` is normally ignored (it
needs `-XX:ThreadPriorityPolicy` and root). The real protection for playback is
structural: only one analysis runs at a time, on its own thread, never on a request
thread and never on lavaplayer's playback pool. MIN_PRIORITY is a hint that helps
where the JVM and OS honour it. Whether playback stays smooth during an analysis
still needs a listening test (see Pending).

### Response shape

200: the features JSON v1 plus `"audio":{"sourceName","identifier","length"}`.
`highlightMs` is always present (an explicit `null` when the extractor has none).
Other statuses: 400 `bad_track` or `bad_request`, 422 `uncharted`, 502
`decode_failed` (with `message`), 503 `busy`.

One implementation note worth keeping: the routes write straight to the
`HttpServletResponse`. Returning `ResponseEntity<byte[]>` does not work on Lavalink
4.2.2, because its kotlinx.serialization message converter wins over the byte[]
converter and serialises the body as a JSON array of numbers (`[123,34,102,...]`).
The first live run returned exactly that; the unit tests cannot see it because they
do not go through Spring.

### Metrics

One log line per job, from `dev.mewbit.mewbeat.MetricsLog`:

    mewbeat-job identifier=5NV6Rdv1a3I durationMs=248080 wallMs=9837 realtimeFactor=25.2 peakHeapMb=118 result=ok

`result` is one of `ok`, `timeout`, `decode_failed`, `stream`, `too_long`, `busy`.
`peakHeapMb` is the highest used-heap value sampled every 250 ms during the job.
It is used heap, so it includes garbage not yet collected; read it as an upper
bound on what the job holds.

### Debug route

`GET /v4/mewbeat/debug/pcm?track=<base64>` returns the audio exactly as the
analysis sees it (24 kHz mono 16-bit WAV). It answers 404 unless
`plugins.mewbeat.debugRoutes: true`. It is off in `application.yml`.

## Measurements

Local Docker Lavalink 4.2.2 (Windows host, Docker Desktop), YouTube via the
youtube-source plugin and the yt-cipher sidecar. Nothing else was playing.

| Track | Source | Length | Wall | Realtime factor | Peak heap | Tempo (conf.) | Beats | Onsets low / lowmid / highmid / high | Sections |
|---|---|---|---|---|---|---|---|---|---|
| Daft Punk - Get Lucky (Official Audio) | youtube | 4:09 | 9.8 s | 25.2x | 118 MB | 116 (0.994) | 478 | 2323 / 2110 / 2007 / 1638 | 6 |
| same, second load | youtube | 4:09 | 7.6 s | 32.5x | 113 MB | 116 (0.994) | 478 | 2323 / 2110 / 2007 / 1638 | 6 |
| Metallica - Master of Puppets (Remastered) | youtube | 8:36 | 24.4 s | 21.1x | 127 MB | 104.63 (0.347) | 895 | 4744 / 4297 / 3736 / 2758 | 23 |

Both runs of Get Lucky returned identical features. The decoded length varies by
about 0.1 s between runs (248080 and 247940 ms), which is lavaplayer's frame
boundary, not a problem.

Seven simultaneous requests for the same track (queue limit 4): 5 returned 200 and
2 returned `503 busy` after 22 ms and 46 ms, as designed. The accepted jobs
reported realtime factors of 6.6x to 19.5x, noticeably slower than the solo runs
of the same track (25x to 32x), with wall times 2x to 5x longer. They ran strictly
one after another, so this is not contention inside the plugin; the most likely
cause is YouTube throttling repeated fetches of one video. No error and no 403 or
429 was seen, and nothing was done to work around it.

### What the numbers say for the DSP

- Onset density is high: about 9 per second in each of the low and lowmid bands for
  both tracks (Get Lucky 2323 low onsets in 248 s; Master of Puppets 4744 in 516 s)
  and about 7 to 8 per second in highmid. Summed over four bands that is roughly 30
  onsets per second, far too dense to play. The chart builder (plan 2) has to thin
  these hard (strength threshold, minimum gap, lane assignment) and should not
  trust the raw counts. If anything the extractor thresholds are permissive, not
  strict.
- Tempo: Get Lucky resolved cleanly (116 BPM is the known tempo, confidence 0.994).
  Master of Puppets gave 104.63 with confidence 0.347. It is a fast, syncopated
  metal track (roughly 210 BPM) with tempo changes, and 104.63 is the half-time
  reading, so a low confidence is the right answer. The chart builder should fall
  back to onset-driven placement when confidence is low.
- Section counts (6 and 23) scale with length and dynamics, which looks plausible.

## What worked and what did not

- YouTube (`ytsearch:`): works end to end. A second load of the same video worked
  and no rate-limit error appeared. The node logs a long `StreamingNonMusicClient`
  warning about formats skipped for missing fields on every YouTube load; that is
  pre-existing noise from the youtube-source plugin, not from mewbeat.
- Over-long track (Brian Eno, Music for Airports, full album, 48:40): `422
  uncharted too_long` in 9 ms, no audio fetched.
- Bad base64 in `encodedTrack`: `400 bad_track`. Body `{}`: `400 bad_request`.
- Debug route: 404 with `debugRoutes: false`. With it set to true it returned a
  24 kHz mono 16-bit WAV of 248.18 s (11,912,684 bytes), peak 32767 (the
  mastering is loud and clips), RMS 8002. The flag was reverted to false.
- SoundCloud (`scsearch:` and a direct track URL): the load itself fails inside
  lavaplayer with `Did not detect any supported formats`
  (`DefaultSoundCloudFormatHandler.chooseBestFormat`), before our route is reached.
  This looks like a lavaplayer 2.2.6 and SoundCloud API incompatibility on this
  node, not a mewbeat issue. Not worked around.
- Spotify (`spsearch:`): fails in LavaSrc at `SpotifyTokenTracker.refreshAccessToken`
  with a 400, because the credentials in the local `.env.dev` are dummies. Not
  verified here. Spotify tracks that LavaSrc resolves to another source would take
  the same path as the YouTube ones.
- A direct HTTP mp3 URL could not be tried: the `http` source is disabled on this
  node (`sources.http: false`). Only YouTube was exercised as a decoded source, so
  the MP3, FLAC and Vorbis probe paths were not run here, only YouTube's WebM/Opus
  and MP4/AAC.

## Pending

- "No audible stutter while music plays during an analysis" has not been checked.
  It needs a person listening to a playing guild player while an analysis runs
  (ideally a long track, two or three in a row). The controller will do this with
  the user. If playback stutters, the levers are to lower decode concurrency
  further or to hold analysis while any player is active.
- The 120 s hard timeout is only unit tested. A real hang (a source that stalls)
  was not reproduced live.
