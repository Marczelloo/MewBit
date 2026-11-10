# mewbeat: open game, first-run tour, bug reports, Mewbit's bubbles (design)

Status: written 2026-11-09 after going through two mockups with the user, who chose the tour layout and the bubble style.
Mockups, open in a browser: `mewbeat-mockups/first-run/tutorial-flow.html` (click through the 12 steps; the user chose
variant B) and `mewbeat-mockups/first-run/bubble-style.html` (the user chose style A). Everything marked **(my call)** was
decided by Claude without the user and should be checked.

## Why

mewbeat is hidden behind the Konami code, so nobody finds it, and whoever does gets no explanation of Solo, Live, Rooms or
how a song becomes a map. Players also have no way to tell the author what broke. And Mewbit's speech bubbles look foreign
to the character and say the same stiff words every time: the user finds them odd-looking, repetitive, hard to understand
and not funny.

## Goals

1. The game is open to everyone from the start, through a button that is always there.
2. The first time someone opens it, Mewbit welcomes them and walks them through the game.
3. Players can report a bug or an idea, and the author reads it all in one place.
4. Bubbles look like they belong to Mewbit and say more, better and funnier things.

## Not in this work

- Practising inside the tour: the player only reads and clicks Next.
- Replying to reporters, report statuses, screenshots attached to a report.
- A mobile version: the game stays desktop only, as it is now **(my call)**.
- Translating the game: everything stays in English.

## What would make this a failure

- The tour blocks someone who came to play with a friend.
- Bubbles that distract from the notes, or that can't be understood at a glance while playing.
- A report that silently vanishes while the player believes it was sent.

## 1. Open game

- The mewbeat button is visible from the start on desktop, for everyone, and stays there.
- The server stops requiring an unlock. Every `isUnlocked` check goes away, and so does the requirement in
  `updateMewbeatSettings` and the `mewbeat_calibrate` and rooms paths. Old `unlocked` fields in stored records may stay and
  are ignored.
- The Konami code still opens the game (the glitch cut) from the player view, at any time.
- If the optional `wink` art exists (see Art), the Konami code plays it on entry with a line such as "you know the code ✦"
  **(my call: this is the "secret" the user mentioned earlier)**.

## 2. First-run tour

### When it runs

- The first time a player opens the game by the button, the Konami code or a launch in a private conversation: the current
  glitch and reveal play (`emerge`, `reveal`, "you found me!"), then the tour starts. The "mewbeat unlocked" card with its
  Play button goes away, because nothing is unlocked any more **(my call)**.
- Seen or skipped is stored on the player's server record (a `tutorialSeen` field next to their mewbeat settings), so it
  doesn't come back on another device **(my call)**. It's the only first-time flag.
- Existing players get it once too, glitch and reveal included, and can skip it **(my call)**.
- Someone arriving through an invite link goes straight into the friend's room: no reveal, no tour, and it stays unseen, so
  they get it on their next normal start **(my call)**.
- Settings gets a "Replay tutorial" button. A replay skips the glitch and reveal and starts at step 1 **(my call)**.

### What it looks like (variant B)

A popup sits next to the thing it explains, with a small portrait of Mewbit, a curved arrow to that thing, the rest of the
screen dimmed and the thing itself spotlit. Only the first and last steps, which point at nothing, show the full-size
Mewbit, centred on her stage. The popup and arrow use style A from section 4, not the white bubble in the flow mockup.

### Steps

Text is a draft from the mockup and may be polished.

| # | Target | Text |
|---|---|---|
| 1 | none, `reveal` pose | You found me! I'm Mewbit, and this is mewbeat: any song, turned into a rhythm game. Quick tour? |
| 2 | Solo tab | Solo is just you. Pick any song and it plays right here. |
| 3 | Live tab | Live follows the bot. Whatever's on in voice, you play along. |
| 4 | Room tab | Room is for friends: same song, same start, one scoreboard. You can invite them from anywhere. |
| 5 | The sample song in Solo, `charting` pose | Brand new song? I listen and write the notes myself. The first time takes a moment, then it's ready for everyone. |
| 6 | Its levels and board | Every song has four levels, and each one has its own leaderboard: this server and global. |
| 7 | none, the fork | That's the tour! Want the controls too, or straight to the game? Buttons: "Show me the controls", "Skip to the game". |
| 8 | Key row on the highway | Notes fall to the line. Press D, F, J or K as they land. The letters follow the player's own keys. |
| 9 | Settings, Gameplay, Keys | Rather use other keys? Change them here, along with the scroll speed. |
| 10 | Settings, Sync, Activity audio | Notes feel early or late? A block falls, you press on the click, and I'll work out your offset. |
| 11 | Settings, Sound | Music, hit sounds and effects are all up to you. |
| 12 | none, `go` pose | That's everything! You can replay this any time in Settings. Go get that full combo ✦ |

### Behaviour

- Every step has Next and Skip. Escape is Skip. Skip anywhere marks the tour seen and goes to the game.
- The tour always runs on the real Solo screens filled with sample data, whatever mode the game would open in (the user's
  decision): the real song select with a sample song picked, its real levels and leaderboard with sample scores, and from
  step 8 the real play screen with sample notes standing still. No real song, audio, request or save happens.
- Live and Room are only pointed at and explained: their tabs are the targets, and the tour doesn't switch to them.
- Steps 9 to 11 open the real Settings on the right tab, and leaving the tour closes it again. The tour changes no setting.
- When the tour ends, the game opens in the mode it would have opened in anyway.
- The game takes no key input during the tour. A Live song that is already playing keeps playing in voice, but nothing that
  happens during the tour counts: no run, misses, bubbles or scores. The player joins the song after the tour, as they
  would joining mid-song **(my call)**.
- If a target isn't on screen, the step shows centred with no arrow rather than breaking.
- The popup and arrow follow the target when the window is resized, and stay inside the window.
- With effects reduced or off, there are no draw-in or pop animations.

## 3. Bug reports

- The author reads them in one **private channel** on their own server, posted through that channel's webhook (the
  user's later decision). Its address comes from a new env variable, `MEWBEAT_REPORT_WEBHOOK_URL`.
- Two ways in: "Report a bug" in the game's menu, next to Settings, and a `/report` slash command on the bot. The menu
  works everywhere the game does, private conversations included. The command works on servers and in DMs with the bot
  **(my call)**.
- The form: a type (Bug or Idea) and a description (required, 10 to 1000 characters) **(my call on the limits)**. In the
  Activity it's the game's own panel, on Discord it's a modal.
- The bot posts one message per report, carrying the type, the text, who sent it (name and id), where it came from
  (Activity or command, and the server or conversation), and from the Activity also the mode, song and level. Mentions in
  the text must not ping anyone.
- One report per player per minute **(my call)**.
- The reporter is told whether it was sent. If sending fails, or the channel isn't configured, they get a plain error and
  their text stays in the form.

## 4. Mewbit's bubbles

### Look: style A, "glitch tag"

As in the mockup: a near-black tag with cut corners, a thin cyan and pink colour split around the edge, a small stepped tail
and JetBrains Mono text, with one word sometimes picked out in cyan or pink. No tilt. It replaces the look of
`.mb-mewbit-bubble`, `.mb-lobby-bubble` and `.mb-res-bubble`, and it's the look of the tour popup.

### Words

- Current lines stay, and more join them, in one file of line pools per moment. The draft list is at the bottom of the
  bubble mockup. The voice follows the bot's (`helpers/brand.js`): a small cute cat with a dangerous streak, dev and anime
  jokes that are still understood at a glance. The builder extends each pool to about 6 to 10 lines.
- Moments: combo, miss, many misses (`crushed`), fever, charting, lobby waiting, count-in, result by grade, full combo, new
  best.
- A line never repeats twice in a row from the same pool, within a session **(my call on the scope)**.
- While notes are falling, lines are at most about 6 words. Lobby and results can be longer.
- Bubbles appear no more often than they do today.

## Art (the user has an agent for it)

The art doesn't exist yet, so each ships as a clearly marked placeholder pose in `mewbit/manifest.js`, and another agent
swaps in the real art later (the user's decision). The real ones are transparent `.webp` sequences like the current poses.

| Name | What | Type | Where |
|---|---|---|---|
| `talk` | bust facing forward, talks and blinks | loop, first = last frame | ordinary tour steps |
| `explain` | bust, one finger raised, talking | loop, first = last frame | keys, offset, charting |
| `happy` | bust, eyes closed, wide smile | loop, first = last frame | welcome, the fork |
| `wave` | full body waving at the player | one shot, ends on `neutral` | end of the tour |
| `wink` | full body, wink, finger to lips | one shot, ends on `neutral` | Konami code |

Busts show at about 46 px, so the face fills most of the frame.

## Left to the builder

The tour's component structure, how targets are marked in the UI, the arrow's geometry, the exact report panel layout,
and the final wording within the voice above.

## How we'll know it works

Automated tests cover the logic: nothing requires an unlock on the server, the tour's seen flag and its skip paths, the
invite case, the report's validation, rate limit and message, and the no-repeat line picker. The tour and bubbles are
checked in the mock preview. Real Discord behaviour (the `/report` modal, posting to the channel) and how the lines feel
in play are for the user to judge.
