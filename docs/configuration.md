<!-- Split out of README.md. -->

[← Back to the README](../README.md)

# Configuration

All secrets belong in `.env`, `.env.dev`, or `.env.prod`—never in this repository.

## Required

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal. |
| `CLIENT_ID` | Discord application ID. |
| `LAVALINK_HOST` | `127.0.0.1` locally; `lavalink` inside the production Compose network. |
| `LAVALINK_PORT` | Lavalink port, normally `2333`. |
| `LAVALINK_PASSWORD` | Password shared by the bot and Lavalink. |

## Music providers and metadata

| Variable | Required? | Purpose |
| --- | --- | --- |
| `YOUTUBE_PO_TOKEN` | Recommended | Improves YouTube access. |
| `YOUTUBE_VISITOR_DATA` | Recommended | YouTube session metadata paired with the PO token. |
| `YOUTUBE_REFRESH_TOKEN` | Optional | OAuth refresh token for restricted/age-gated YouTube access. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Optional | Spotify metadata, playlists, and resolving support. |
| `SPOTIFY_SP_DC` | Optional | Spotify web session cookie where required by the resolver. Treat as a secret. |
| `DEEZER_ARL_TOKEN` | Optional | Deezer access cookie. Treat as a secret. |
| `DEEZER_MASTER_KEY` | Optional | Deezer resolver configuration; the default is supplied in the example. |
| `AUTOPLAY_DEEZER_METADATA` | `true` | Uses Deezer's public catalog metadata as a Spotify-independent autoplay signal. It can provide BPM, gain, ISRC, and release data when available. |
| `GENIUS_API_KEY` | Optional | Better lyrics lookup coverage. |
| `LASTFM_API_KEY` | Strongly recommended for autoplay | Similar-artist data and tags for DJ mode, and the "Similar to" row in Activity search. |
| `LASTFM_APPLICATION_NAME` / `LASTFM_SHARED_SECRET` | Optional | Application metadata for Last.fm integrations. |

Spotify links resolve their catalog metadata first, then play a verified YouTube mirror: ISRC search is preferred, followed by title and artist. Deezer is not used as Spotify's primary audio mirror because its media endpoint can reject otherwise valid recordings for licensing or regional-rights reasons. If the primary mirror fails, MewBit retries only a candidate with matching title, artist, requested version, duration, and (when both sources provide it) ISRC; it skips the track rather than silently playing a different song.

If a provider requires browser cookies, obtain them from an account you control and store them only on the host. The production Compose file mounts `helpers/lavalink/youtube-cookies.txt` for Lavalink when that file exists. Do not commit it.

## Playback and autoplay

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEFAULT_VOLUME` | `50` | Initial player volume (0–100). |
| `INACTIVITY_TIMEOUT_MS` | `300000` | Disconnect after this many idle milliseconds. |
| `TRACK_START_TIMEOUT_MS` | `15000` | Retry a queued item through verified fallbacks when Lavalink never emits `TrackStart`. |
| `PROGRESS_UPDATE_INTERVAL_MS` | `0` | Player-message update interval; `0` uses the built-in behavior. |
| `LYRICS_SYNC_OFFSET_MS` | `-450` | Shared lyric timing offset in milliseconds. The default compensates for Discord voice delivery so synced lines do not lead the audio. |
| `LOUDNESS_NORMALIZATION` | `true` | Enables source-aware playback gain compensation. |
| `LOUDNESS_<SOURCE>_DB` | provider default | Optional gain offset for a provider, e.g. `LOUDNESS_SOUNDCLOUD_DB=-3`. |
| `PLAYER_RECOVERY_MAX_AGE_MS` | `7200000` | How long an unexpected-disconnect snapshot is eligible for restoration after a user explicitly resumes playback. |
| `SEARCH_CACHE_MAX_ENTRIES` | `240` | Maximum cached Activity/autocomplete search entries; old entries are evicted first. |
| `SEARCH_SUGGESTIONS` | `true` | Looks up YouTube's public query suggestions to correct misspelt Activity and `/play` searches ("Showing results for ...") and offer related searches. Set to `false` to search queries exactly as typed and make no suggestion requests. |
| `AUTOPLAY_HISTORY_LIMIT` | `80` | Recent autoplay reservations remembered for hard duplicate prevention. |
| `AUTOPLAY_V3` | `true` | Uses the simpler trusted-source DJ selector. Set to `false` only to temporarily roll back to the legacy scorer. |
| `AUTOPLAY_V3_MAX_ALBUM_STREAK` | `2` | Maximum consecutive tracks from one album before V3 requires a different album. |
| `AUTOPLAY_V3_MAX_ARTIST_STREAK` | `3` | Maximum consecutive tracks by one artist before V3 requires a different artist. |
| `AI_DJ_ENABLED` | `false` | Enables OpenAI as the primary autoplay music director; V3 is retained as a safe playback fallback. |
| `OPENAI_API_KEY` | — | Secret API key for the OpenAI Responses API. Keep it only in local/server `.env` files. |
| `AI_DJ_MODEL` | `gpt-5.6-luna` | Fast Responses API model used for structured AI DJ plans. |
| `AI_DJ_REASONING_EFFORT` | `low` | GPT-5.6 reasoning depth; `low` keeps autoplay decisions responsive. |
| `AI_DJ_TIMEOUT_MS` | `12000` | Maximum AI DJ wait before falling back to V3. Planning runs in parallel with provider fallback collection. |
| `AI_DJ_CACHE_TTL_MS` | `300000` | Caches an identical sanitized listening context to avoid duplicate API calls. |
| `AI_DJ_MAX_PROPOSALS` | `8` | Maximum exact artist/title recordings in one AI DJ plan. |
| `AI_DJ_DIVERSITY_FIT_BAND` | `10` | Maximum AI fit-score drop accepted when softly rotating from a continuation to a bridge. |
| `AI_DJ_SKIP_DEMOTION` | `12` | Soft weight reduction applied to an AI proposal whose artist was recently skipped. |
| `AUTOPLAY_V3_SOFT_ARTIST_STREAK` | `4` | Generic V3 fallback only: after this streak, compatible exits gain a gentle preference. |
| `AUTOPLAY_V3_SOFT_ALBUM_STREAK` | `3` | Generic V3 fallback only: after this streak, compatible exits gain a gentle preference. |
| `AI_DJ_WEB_SEARCH` | `false` | Optional paid OpenAI web lookup. Provider resolution still verifies every proposal; enable only when you explicitly want external lookup costs. |
| `AI_DJ_MIN_CONFIDENCE` | `0.55` | AI plans below this confidence leave V3 as the fallback. |
| `AI_DJ_MIN_FIT` | `55` | Individual AI proposals below this transition-fit threshold are discarded before selection. |
| `AUTOPLAY_V3_MAX_ALBUM_CONTINUITY_STREAK` | `3` | Emergency cap for a direct, genre-compatible album run after its soft cap. |
| `AUTOPLAY_V3_MAX_ARTIST_CONTINUITY_STREAK` | `6` | Emergency cap for a direct, genre-compatible artist run after its soft cap. |
| `TRACK_HISTORY_LIMIT` | `80` | Number of tracks retained in the active playback history. |
| `AUTOPLAY_EXPOSURE_TTL_MS` | `1209600000` | How long cross-session autoplay exposure is remembered (14 days). |
| `AUTOPLAY_EXPOSURE_LIMIT` | `300` | Maximum canonical recommendations remembered per guild. |
| `LASTFM_AUTOPLAY_FETCH_LIMIT` | `18` | Similar tracks requested from Last.fm for an adaptive candidate pool. |
| `LASTFM_AUTOPLAY_RESOLVE_LIMIT` | `12` | Similar tracks resolved through Lavalink per autoplay cycle. |
| `AUTOPLAY_DIVERSITY_POOL_SIZE` | `4` | Maximum near-top candidates eligible for weighted variety. |
| `AUTOPLAY_DIVERSITY_SCORE_BAND` | `6` | Maximum score distance from the best candidate for diversity selection. |
| `AUTOPLAY_SELECTION_MAX_SCORE_DROP` | `4` | Strict score gate for exploration; candidates below it need a stronger transition anchor. |
| `AUTOPLAY_SELECTION_QUALITY_ADVANTAGE` | `3` | Transition-quality advantage required for a wider exploration pick. |
| `AUTOPLAY_MIX_FALLBACK_MIN_SCORE` | `58` | Minimum fit score for metadata-free YouTube Mix fallback candidates; Mix never enters the normal safe pool. |
| `AUTOPLAY_MANUAL_CONTEXT_LIMIT` | `12` | Number of recently played user-selected tracks retained as strong autoplay anchors. |
| `AUTOPLAY_MANUAL_MEMORY_LIMIT` | `40` | Durable user-selected memory supplied to the AI DJ as exact tracks plus recurring artists and albums. |
| `AUTOPLAY_PENDING_MANUAL_CONTEXT_LIMIT` | `4` | Upcoming manual queue tracks used to shape recommendations before they play. |
| `AUTOPLAY_DRIFT_GUARD_AFTER` | `1` | Enforces the manual-anchor corridor after the first automatic transition, preventing multi-step drift before it starts. |
| `AUTOPLAY_MANUAL_ANCHOR_MIN_SCORE` | `42` | Minimum normalized fit to a manual anchor while drift protection is active. |
| `AUTOPLAY_UNVERIFIED_DRIFT_PENALTY` | `18` | Penalty for candidates without enough evidence against the manual listening context. |
| `AUTOPLAY_REPEAT_COOLDOWN_MS` | `3600000` | Prevents duplicate recordings during a short session; after one hour a natural repeat can be considered again. |
| `AUTOPLAY_SKIP_GENRE_PENALTY_MAX` | `30` | Caps learned genre penalties; one skipped track contributes one specific-genre penalty instead of one penalty per tag. |
| `AUTOPLAY_ARTIST_WINDOW` | `5` | Recent automatic tracks considered for artist repetition control. |
| `AUTOPLAY_ARTIST_MAX_IN_WINDOW` | `2` | Maximum automatic appearances by one artist in that window before deferral. |
| `AUTOPLAY_TEMPO_CORRIDOR_MAX` | `38` | Maximum verified half/double-time-aware BPM jump before an established session rejects the transition. |
| `AUTOPLAY_ENERGY_CORRIDOR_MAX` | `0.36` | Maximum verified energy jump before an established session rejects the transition. |
| `AUTOPLAY_VALENCE_CORRIDOR_MAX` | `0.48` | Maximum verified valence/mood jump before an established session rejects the transition. |
| `AUTOPLAY_TRANSITION_QUALITY_MIN` | `6` | Minimum transition-quality score preferred when a better safe alternative exists. |
| `AUTOPLAY_TRANSITION_QUALITY_GUARD_AFTER` | `2` | Autoplay streak after which low-quality transitions are deferred. |
| `AUTOPLAY_DEEZER_METADATA_LIMIT` | `18` | Maximum candidates enriched with Deezer metadata during one autoplay cycle. |
| `AUTOPLAY_DEEZER_METADATA_CACHE_TTL_MS` | `604800000` | In-memory cache lifetime for Deezer catalog metadata (7 days). |
| `SURPRISE_ME_TRENDING_CACHE_TTL_MS` | `900000` | In-memory lifetime for the free Deezer global-chart candidate pool used only by Surprise Me (15 minutes). |
| `AUTOPLAY_METADATA_TIMEOUT_MS` | `3500` | Timeout for non-critical metadata requests; playback continues if the lookup fails. |
| `AUTOPLAY_RESOLVE_TIMEOUT_MS` | `12000` | Per-provider timeout while resolving an autoplay or fallback track. |
| `AUTOPLAY_COMMUNITY_METADATA` | `true` | Uses one bounded metadata aggregator for active/manual autoplay anchors. It prefers Last.fm track tags, verifies sparse recordings with MusicBrainz, then uses TheAudioDB only when genre/mood information is still missing. |
| `AUTOPLAY_COMMUNITY_METADATA_CACHE_TTL_MS` | `2592000000` | In-memory lifetime for community metadata (30 days). |
| `AUTOPLAY_COMMUNITY_METADATA_MIN_TAGS` | `2` | Number of usable tags that stops lower-priority community lookups. |
| `AUTOPLAY_MUSICBRAINZ` | `true` | Enables MusicBrainz recording verification; no API key is needed and calls are throttled to one per ~1.1 seconds. |
| `AUTOPLAY_THEAUDIODB` | `true` | Enables TheAudioDB genre/mood fallback. The public key `2` is used unless `THEAUDIODB_API_KEY` is set. |
| `USE_SPOTIFY_AUTOPLAY` | `false` | Opt in to Spotify-derived autoplay candidates. Disabled by default because metadata and availability may vary. |

Autoplay keeps two separate memories. The active playback history is a hard
cooldown for exact recordings and provider variants during the current room
session. A smaller persistent exposure ledger remembers canonical
`artist + title` identities and `seed → recommendation` transitions for a
limited time, so stopping and restarting a room does not immediately recreate
the same radio path. The ledger is stored in `helpers/data/autoplayExposure.json`
and is covered by the existing Compose data volume; it contains no track URLs,
tokens, or full Lavalink payloads.

## Logs

| Variable | Default | Purpose |
| --- | --- | --- |
| `FAST_LOGS` | `1` | Compact console logging. |
| `LOG_TO_FILE` | `1` | Writes bot logs to the local `logs/` directory. |

## Activity gateway

The Activity gateway runs in the bot process and is responsible for authorizing Activity users and sharing player state.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACTIVITY_ENABLED` | `true` | Enables the Activity gateway. |
| `ACTIVITY_HOST` | `127.0.0.1` | Bind host; use `0.0.0.0` behind a production proxy. |
| `ACTIVITY_PORT` | `8787` | Gateway port. |
| `ACTIVITY_STATE_HEARTBEAT_MS` | `1500` | Background player-state safety heartbeat in milliseconds; event updates remain immediate. Lower values recover faster from a silent iframe/proxy at the cost of more snapshot work. |
| `ACTIVITY_CLIENT_SECRET` | falls back to `DISCORD_CLIENT_SECRET` | Discord application client secret used for the OAuth token exchange. |
| `ACTIVITY_REDIRECT_URI` | `https://127.0.0.1` | Exact OAuth redirect URI registered in the Developer Portal. |
| `ACTIVITY_ALLOWED_ORIGINS` | `*` | Comma-separated allowed browser origins. Restrict this in production. |
| `ACTIVITY_ARTWORK_HOSTS` | empty | Optional comma-separated allowlist for external artwork URLs. |
| `ACTIVITY_ALLOW_DEV` | `false` | Enables local development identity. Never enable on public production. |
| `ACTIVITY_DEV_GUILD_ID` / `ACTIVITY_DEV_USER_ID` | demo values | Local preview identity. |
| `ACTIVITY_DEV_TOKEN` | empty | Optional token protecting local gateway preview. |
