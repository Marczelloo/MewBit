# mewbeat: song select, player profiles, ranking (design)

Status: written 2026-11-09 after going through a clickable mockup with the user, who approved the layout.
Mockup: `mewbeat-mockups/song-select-profile.html` (open it in a browser; the buttons on top switch states, its numbers
are made up). Everything marked **(my call)** was decided by Claude without the user and should be checked.

## Why

The Solo song select works as a concept, but its left half is almost empty: only "Pick a song" until something is picked,
and free space under the levels after that. Players have no place to see how they are doing, how they compare, or who
holds the record on a level. The screen becomes the game's home: your profile while nothing is picked, the level and its
leaderboard when something is.

## Goals

1. Change the level from the Solo menu; the map starts over on the new level.
2. Profile for every player: overall stats, recent plays, best plays, place in the global ranking.
3. A separate Stats card with extended numbers, so the profile itself stays as approved.
4. Level leaderboard next to the picked song, on the picked difficulty, switchable between this server and global.
5. A ranking system like osu!'s pp, with a global and a server ranking.
6. Song list: a "Played by you" tab, sorting, filtering, cleaner display of the levels.
7. A visible place for level modifiers on the picked song.

## Non-goals

- Modifiers that do anything. Goal 7 is the space only: no toggles, no scoring, no stored field.
- Any change to the game board, the in-game HUD or the settings window.
- Any change to the chart generator.
- Migrating or preserving data. This is a dev build; production starts with everything cleared.
- Profile, Stats and Ranking in the Room "add songs" window, which keeps its current left side **(my call)**. The list
  changes of goal 6 do apply there, because it is the same component.
- Anti-cheat beyond what `mewbeat_submit` already does.

## Anti-goals

- A profile that gets busier. New numbers go on the Stats card.
- A rating or board that mixes different note layouts. Scores are only compared on the same chart version.

## Decisions

**From the user**

- Only results on the song's current chart version count toward the ranking. Older versions don't, and nothing carries
  over. Production starts from zero anyway.
- Layout as in the mockup. Left side has three states: Profile, Stats and Ranking while no song is picked (tabs), or the
  picked song.
- Extended stats live on a separate card: key presses, Perfect/Great/Good/Miss counts, max combo on maps, seconds spent
  holding, and similar.
- Another player's profile opens by clicking them in the Ranking or on a level leaderboard.
- The Live / Solo / Room switcher in the top bar stays there, unchanged. (The first mockups just left the bar out.)
- The modifiers area is a placeholder for now.

**(my call)**

- Timing and full combo counts are on the Stats card although the user did not list them; the bot already has the data.
- The formula and constants under "Rating".
- Tab labels: `This server`, `Everywhere`, `Played by you` (replacing the longer "Played on this server" and "Played
  anywhere"). List column labels `EZ NM HD HL`.
- A server ranking ranks the global rating of the players who have a ranked score in that guild. It is not a rating
  recomputed from that guild's plays.
- Stats counters include every submitted run that is neither calibration nor autoplay, ranked or not. The ranking counts
  ranked runs only, the same rule as the boards.
- Counters start from new rounds. No backfill from `history.json`.

## The screen

Follow the mockup for structure, the existing `.mb-ss` styles and the Obsidian tokens for look. Difficulty colours stay
easy=cyan, normal=violet, hard=pink, hell=danger; grades S gold, A cyan, B violet, C high, D danger; judgements Perfect
cyan, Great violet, Good high, Miss danger. Interface copy is English. The screen must hold up at the Activity's small
sizes: the previous batch was checked down to 1024x560 and 800x480, and the Stats tiles' small captions need care there
because they overflow at about 500 px of column width in the mockup.

**Left, no song picked.** Tabs `Profile`, `Stats`, `Ranking`.

- Profile: avatar, name, "playing since", rating in pp, global and server rank; tiles for plays, average accuracy, songs,
  time played, best-grade counts (how many maps have S, A, B, C, D as your best); two panels, Recent plays and Best plays.
- Stats: Judgements (proportional bar and the four counts with percent); tiles for key presses (with how many hit empty
  air), holds held (total and longest), best combo (with the song), full combos, FEVERs, time played; Timing (mean offset
  with early/late wording, spread, early and late share); Max combo by map (best maps, combo against the map's total, or
  "full combo").
- Ranking: rows of rank, avatar, name, accuracy, rating, own row highlighted; Global / This server switch. Clicking a row
  opens that player's profile.

**Left, another player.** Same Profile and Stats, no Ranking tab, "Viewing <name>" and a "← Your profile" button. Server
rank shows "—" when they have no ranked score in this guild.

**Left, song picked.** "← Profile" (clears the selection and stops the preview, returning to whatever the player was
looking at), hero, the four level tiles as today with BPM added to the chips, a Modifiers strip of inert slots, then the
Leaderboard on the selected difficulty with This server / Global. Own row highlighted; when outside the shown rows it is
pinned at the bottom with its real rank. Clicking a row opens that player's profile, which clears the selection and stops
the preview; "← Your profile" does not bring the song back **(my call)**.

**Right.** Tabs, search box, then the tools row: `Sort`, `Level`, `Filter`, direction. Then the table header and rows:
cover, title, artist, `length · BPM`, four fixed level columns each showing that level's stars in its colour with the
player's grade beneath. The selected row is tinted.

- Sort: Recent (default), Stars, BPM, Length, Plays, Title.
- Level says which level Stars, Plays and Filter look at.
- Filter: All, Played on this level, Not played on this level. "Played" means the player has their own best there, the
  grade shown in that column **(my call)**.
- Search results have no charts yet, so the tools row is hidden while searching.
- "Played by you" lists the songs in the player's own history, newest first.

## Pause menu

`GameMenu` gets a difficulty picker while a Solo run is on stage. Picking a different level saves it the way `pickSong`
does (`mewbeat_settings`, `liveDifficulty`) and restarts through `link.restart()`, which already drops the run and charts
again. The chart has to be requested on the new level, so the restart must not race the settings round trip that sets
`savedDifficulty`; `setPickedLevel` in `pickSong` is the existing way past that. Picking the current level does nothing.
The abandoned run is not submitted.

## Rating

```
playPp = 8 * stars^2.2 * ((accuracy - 50) / 50)^2.5      (0 at 50% accuracy or below)
rating = sum over the player's plays, highest playPp first, of playPp * 0.95^index
```

One play per song and difficulty: the player's best score there. A play counts only when its `chartKey` is the song's
current one, that is the stored chart's version as `chartKeyFor` reads it. A song without a stored chart counts nothing,
so the `latestChartKey` fallback of `chartKeyFor` must not be used here. Stars come from `starsFor(chart)`.

Accepted limitation **(my call)**: a song's charts can be regenerated at the same version once its melody finishes decoding
(`chartStore.dropCharts`), so a score set just before that stays on the same key. The boards already behave this way and
it is rare.

The accuracy is the one on the best-scoring entry. Rating accuracy shown in the Ranking is the mean over the counted plays.

Constants live in one small module with tests, so they can be tuned by feel after playing. Compute at read time, not on
submit, so a generator bump drops old results by itself and no stored number goes stale. Recomputing every rating on
each request is wasteful, so cache the computed table and drop it on `scoreStore.submit` and when the chart set changes;
how is left to the builder.

## Data

**`scoreStore`** Add a way to walk all entries by player for the rating. New entries also store `title`, `artist` and
`artworkUrl` so Best plays can name a song; for entries without them fall back to the player's history.

**`historyStore`** Raise `perUser` from 200 to 2000 **(my call)**: the main dev account is already at 200, which caps the
Plays sort and "Played by you". `played()` gains per-difficulty play counts, an optional user filter for the new tab, and
needs no other change.

**New `statsStore`** (`helpers/data/mewbeat/stats.json`, built like the other two on `createDebouncedJson`, flushed by
`flushMewbeatStores`). Per user: `firstAt`, the latest name and avatar, `plays`, `playMs`, the sum of accuracies,
judgement counts, `presses`, `emptyPresses`, `holdMs`, `longestHoldMs`, `fevers`, `fullCombos`, timing aggregates (count,
sum, sum of squares, early, late), and per `audioKey|difficulty`: `maxCombo`, the total for that chart, full-combo flag and
track name. Updated in `submit` for every counted run.

Derived on the server from what `mewbeat_submit` already receives:

- Hold time: for each hold whose head was not a miss, tail time clamped to the note's end, minus the note's start.
- Timing: head events with a non-null `d`. Negative is early.
- Full combo: `run.counts.miss === 0` and `run.judged` equals `judgeablePartsOf(stored)`.
- Max combo against total: `run.maxCombo` against `judgeablePartsOf(stored)`. A hold counts head and tail.

New from the client: `presses` and `emptyPresses` in the `mewbeat_submit` body, counted in `run.js`'s `press` (a press with
no result from `judge.press` is empty). Server: non-negative integers with a sanity cap, otherwise treated as absent. They
are display numbers and touch no score.

**Channel messages** (`activityChannel.js`, same id, `isUnlocked` and error-shape conventions as the existing ones)

- `mewbeat_profile { userId? }`: player, rating, global and server rank, summary tiles, recent and best plays. No `userId`
  means yourself.
- `mewbeat_stats { userId? }`: everything on the Stats card.
- `mewbeat_ranking { scope, limit }`: rows plus your own row.
- `mewbeat_played`: scope also accepts `mine`; each track gains `bpm` and per-level play counts; `PLAYED_LIMIT` goes up so
  sorting sees the whole list instead of the 50 newest. The client sorts and filters.
- `mewbeat_board`: already exists with `scope`; the song select starts using it.

`local-user` (the mock preview's account) is left out of rankings.

## Order of work

Each stage can be played and judged on its own.

1. Pause-menu difficulty picker.
2. Bot side: rating module, `statsStore`, score and history changes, the new messages, `presses` from the client.
3. Left side: Profile, Stats, level leaderboard, modifiers strip, split out of `SongSelect.jsx` into their own components.
4. Right side: tabs, sort, filter, table rows.
5. Ranking tab and other players' profiles.

## Checks

- `node --test tests/activity/mewbeat/*.test.js` stays green. New tests for the rating formula and order, the
  current-version rule (an old version counts nothing), `statsStore`, hold and timing derivation, full-combo edge cases,
  the new channel messages and refusals.
- Build from `activity/` with `npx vite build`.
- `?mock=1` cannot reach Solo today (`MOCK_PREVIEW` disables it). Extend the mock preview with fake replies for these
  messages so the screen can be checked in the browser at the small sizes **(my call)**. Real flows are tested by the user
  playing against the bot.

## Left to the builder

Component boundaries, cache invalidation of the rating table, the exact `PLAYED_LIMIT`, row counts per panel, loading and
empty states in the existing style, keyboard behaviour on the new tabs, and how the mock replies are wired.
