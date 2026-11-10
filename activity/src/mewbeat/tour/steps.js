// The first-run tour, step by step. Text follows the spec; `target` is a data-tour id the UI looks up
// on the real screen, `also` a second element the spotlight covers. `pose` is Mewbit's full-size pose
// on steps that point at nothing, `portrait` her small pose in the popup. `view` is the screen the tour
// shows ("select" = song select, "lobby" = the room lobby on a sample room, "play" = the play screen), `settings` the
// Settings group open behind it, `menu` the game menu open over it (the tour's own copy, nothing in it can be pressed).
//
// Two parts: everything up to "end" is the tour; the "after-*" steps are a short second part that waits until the player
// has played a map and is back at song select (finished it or left it). It runs in the same sample session and does the
// same: no real action, nothing sent.

const DEFAULT_KEYS = ["D", "F", "J", "K"];

export const TOUR_STEPS = [
  {
    id: "welcome", target: null, side: null, pose: "reveal", portrait: "happy",
    say: "You found me! I'm Mewbit, and this is mewbeat: any song, turned into a rhythm game. Quick tour?",
    count: "1/10", view: "select", settings: null, also: null, primary: "Show me around", secondary: "Skip",
  },
  {
    id: "solo", target: "solo", side: "below", portrait: "talk",
    say: "Solo is just you. Pick any song and it plays right here.",
    count: "2/10", view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "list", target: "list", side: "right", portrait: "talk",
    say: "Every song played here lands in this list, with its stars for each level and your best grade. The tabs show this server, everywhere, or just what you've played.",
    count: "3/10", view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "charting", target: "track", side: "left", portrait: "explain",
    say: "Brand new song? I listen and write the notes myself. The first time takes a moment, then it's ready for everyone.",
    count: "4/10", view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "levels", target: "diff", side: "left", portrait: "talk",
    say: "Every song has four levels, and each one has its own leaderboard: this server and global.",
    count: "5/10", view: "select", settings: null, also: "board", primary: "Next", secondary: "Skip",
  },
  {
    id: "live", target: "live", side: "below", portrait: "talk",
    say: "Live follows the bot. Whatever's on in voice, you play along.",
    count: "6/10", view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "room", target: "room", side: "below", portrait: "talk",
    say: "Room is for friends: same song, same start, one scoreboard. You can invite them from anywhere.",
    count: "7/10", view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "lobby-players", target: "lobby-players", also: "lobby-ready", side: "left", portrait: "explain",
    say: "This is a room. Everyone in it is listed here, and the crown marks who owns it. Press Ready when you are: the round starts once all of you are.",
    count: "8/10", view: "lobby", settings: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "lobby-queue", target: "lobby-queue", also: "lobby-levels", side: "right", portrait: "talk",
    say: "The queue is the plan. Add songs here and the room plays them one by one. The levels above show how hard the next one is, with a board each.",
    count: "9/10", view: "lobby", settings: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "lobby-invite", target: "lobby-invite", side: "left", portrait: "talk",
    say: "Want friends in? Post an invite in your voice channel, or share a link to the room with anyone.",
    count: "10/10", view: "lobby", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "fork", target: null, side: null, pose: "neutral", portrait: "happy",
    say: "That's the tour! Want the controls too, or straight to the game?",
    count: null, view: "select", settings: null, also: null, primary: "Show me the controls", secondary: "Skip to the game",
  },
  {
    id: "keys", target: "keys", side: "right", portrait: "explain",
    say: (keys) => `Notes fall to the line. Press ${keyList(keys)} as they land.`,
    count: "1/4", view: "play", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "setkeys", target: "setkeys", side: "below", portrait: "explain",
    say: "Rather use other keys? Change them here, along with the scroll speed.",
    count: "2/4", view: "play", settings: "gameplay", also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "offset", target: "offset", side: "above", portrait: "explain",
    say: "Notes feel early or late? A block falls, you press on the click, and I'll work out your offset.",
    count: "3/4", view: "play", settings: "sync", also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "sound", target: "sound", side: "below", portrait: "talk",
    say: "Music, hit sounds and effects are all up to you.",
    count: "4/4", view: "play", settings: "sound", also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "end", target: null, side: null, pose: "go", portrait: null,
    say: "That's everything! You can replay this any time in Settings. Now show me what you've got ✦",
    count: null, view: "play", settings: null, also: null, primary: "Let's go", secondary: "Skip",
  },
  // The second part. Song select behind it, like the first one's opening steps.
  {
    id: "after-sorry", target: null, side: null, pose: "okay", portrait: "happy",
    say: "okay okay, sorry about the Hell thing. It's not so hard when the song isn't out to get you ✦",
    count: null, view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "after-generator", target: null, side: null, pose: "charting", portrait: "explain",
    say: "One thing: I write every map myself, with a generator, so not every map is perfect. Now and then a note lands a bit off.",
    count: null, view: "select", settings: null, also: null, primary: "Next", secondary: "Skip",
  },
  {
    id: "after-report", target: "report", side: "left", portrait: "talk", menu: true,
    say: "A weird map or a bug? Report it here: pick the song you played and tell me where it went wrong. mewbeat is still growing, so things can break.",
    count: null, view: "select", settings: null, also: null, primary: "Got it", secondary: null,
  },
  {
    id: "after-bye", target: null, side: null, pose: "wave", portrait: "happy",
    say: "That's it, for real this time. No more traps. Probably. Have fun out there ✦",
    count: null, view: "select", settings: null, also: null, primary: "Let's play", secondary: null,
  },
];

export const stepIndex = (id) => TOUR_STEPS.findIndex((step) => step.id === id);

// The fork: "Show me the controls" goes to the next step, "Skip to the game" ends the tour. The UI wires the buttons.
export const FORK_INDEX = stepIndex("fork");
// "Let's go" is the player's turn (the trap, when it is ready, else a song of their own); Skip ends it.
export const END_INDEX = stepIndex("end");
// The second part: after the trap's test map the tour comes back here, with the apology first.
export const AFTER_INDEX = stepIndex("after-sorry");
export const AFTER_NO_TRAP_INDEX = stepIndex("after-generator"); // no trap ran, so nothing to apologise for

// The next step, or null when this part is over: the first one ends at "end", the second at the last step.
export function tourNext(i) {
  if (i === END_INDEX) return null;
  return i + 1 < TOUR_STEPS.length ? i + 1 : null;
}

// "D, F, J or K" from the player's own four keys.
function keyList(keys) {
  const k = keys?.length === 4 ? keys : DEFAULT_KEYS;
  return `${k.slice(0, -1).join(", ")} or ${k[3]}`;
}

// A step's text; the keys step's depends on the keys, so the UI calls this rather than reading `say`.
export function tourText(step, keys) {
  return typeof step.say === "function" ? step.say(keys) : step.say;
}
