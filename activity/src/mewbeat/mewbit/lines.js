// What Mewbit says, in pools per moment. The manifest names a moment for a pose (`bubble: "combo"`); Lobby.jsx and
// Results.jsx pick for theirs. The voice is the bot's (helpers/brand.js): a small cute cat with a dangerous streak, dev
// and anime jokes that read at a glance.
//
// Rules the pools keep (tests/activity/mewbeat/lines.test.js checks them):
// - 6 to 10 lines per pool, except `reveal` and `wink`, which are one fixed line each.
// - Pools shown while notes fall (combo, miss, crushed, fever, charting, count, vibe) are at most 6 words.
// - A pool is shared by several poses and counts (combo fires at several combo levels), so a line never states a number
//   that could be wrong at the moment it comes up.
// - Inside a line, [word] is picked out in cyan and {word} in pink (one word, on a minority of lines). The lines Mewbit
//   said before pools existed are first in each pool and stay unmarked.
export const LINES = {
  // The three idle vibe poses.
  vibe: [
    "nyaa~!",
    "wooo!!",
    "SUGOI!!",
    "vibes: [immaculate]",
    "ears up!",
    "tail is wagging",
    "this part {slaps}",
    "good groove, good cat",
    "locked in, nya",
  ],
  // combo100 / combo200 / combo300.
  combo: [
    "KIRA KIRA~!",
    "SUGOOOI!!",
    "KAMI!!! ✦",
    "ok you can stay",
    "don't look at your hands",
    "your keyboard is [purring]",
    "who let you {cook}?",
    "combo go brrr",
    "nobody tell the miss",
  ],
  // On screen for about 400 ms, on the spot where the player's eyes must not linger: 3 words at most.
  miss: [
    "eep!",
    "skill issue, nya",
    "i saw [nothing]",
    "404: no note",
    "it's a {feature}",
    "ctrl+z pls",
    "rip that note",
    "blame the aux",
  ],
  // A deeper miss: several in a row.
  crushed: [
    "mou~",
    "that note had a {family}",
    "breathe. they smell {fear}",
    "we're rebuilding",
    "it's a training arc now",
    "segfault in the paws",
    "pls no [screenshots]",
    "the song is winning",
    "rebooting paws. please wait",
    "it's fine. everyone respawns",
  ],
  // fever, fever100, fever200, fever300.
  fever: [
    "FEVER!!! ✦",
    "{FEVER}!! no skips today",
    "main character mix!!",
    "keyboard's on [fire]",
    "domain expansion: FEVER",
    "rasengan of rhythm!!",
    "turbo cat, no brakes",
    "bankai! maximum volume",
    "speedrun mode: [on]",
  ],
  // Waiting for the chart while the game screen is up.
  charting: [
    "charting…",
    "shh, listening to the {good} part",
    "stealing the bassline…",
    "works on my headphones",
    "compiling your [song]…",
    "counting every beat",
    "asking the drums nicely…",
    "trust the process, nya",
  ],
  // The lobby idle (neutral, stretch, headphone adjust). Lobby has room for longer lines.
  lobby: [
    "waiting for my song~",
    "warming up the paws…",
    "*adjusts headphones*",
    "my bowl is empty. send {snacks}",
    "add another song, i'll [behave]",
    "small cat, enormous soundstage",
    "still here. just {vibing}",
    "hand me the aux. i'm ready",
    "this lobby needs more bass",
    "dibs on the aux cable",
  ],
  // The go pose, the moment the song starts.
  count: [
    "nyaa~ ✦",
    "paws ready?",
    "no looking at the keys",
    "here we {go}!",
    "it's [rhythm] o'clock",
    "lock in, nya",
    "don't blink",
    "go go go!",
  ],
  // The result by grade. A full combo and a new best have their own pools below.
  gradeS: [
    "S rank?! you're cracked!!",
    "S rank. touch grass, then come back",
    "someone call the chart police",
    "sign my {tail}, please. S rank",
    "the song is afraid of you",
    "main character energy. S rank",
    "ok that was [unreal]",
    "leave some skill for the rest of us",
  ],
  gradeA: [
    "great run!",
    "so close to S i can taste it",
    "A rank. rematch for S?",
    "strong run. the cat is {impressed}",
    "that was clean, nya",
    "one more for the [S]?",
    "solid A. say you'll go again",
    "your fingers deserve a snack",
  ],
  gradeB: [
    "nice one~",
    "decent! the cat nods",
    "B for [banger], right?",
    "the practice is {working}",
    "B rank: respectable and fluffy",
    "solid. now do it harder",
    "i can feel the S from here",
    "B-tier, but make it [legend]",
  ],
  gradeC: [
    "not bad!",
    "C is for {character} development",
    "it's a start. training arc time",
    "you cooked. a bit raw",
    "room for improvement. lots of room",
    "we call this [potential]",
    "the cat believes in you",
    "not a failure, a prologue",
  ],
  gradeD: [
    "nyoo… next time!",
    "the song won this round",
    "rematch. i'm not {asking}",
    "that was the filler episode",
    "skill issue (affectionate)",
    "plot twist: the next run slaps",
    "the aux cable betrayed us",
    "let's call that a [warm-up]",
    "it's fine. everyone respawns",
  ],
  // A full combo that is not also a new best.
  fullCombo: [
    "not one miss?! suspicious",
    "FULL COMBO. i'm calling the council",
    "[flawless]. are you a bot?",
    "zero misses. the cat is {afraid}",
    "every note, every time. unreal",
    "full combo?! who hurt you",
    "my whiskers are tingling",
    "not one miss. i counted twice",
  ],
  newBest: [
    "NEW BEST!! ✦",
    "new best?! that's illegal",
    "personal record. the cat is {screaming}",
    "you beat yourself. rude",
    "new best. i'm telling [everyone]",
    "level up! +1 swagger",
    "PB unlocked. frame it",
    "past you is shaking",
    "who is this main character",
  ],
  // The first-run tour's trap: said after the Hell chart is cut off, before the calm song starts (tour/trap.js).
  trap: [
    "gotcha ✦ that was Hell. here's the cute one",
    "you should've seen your face, nya",
    "boss fight tutorial skipped. you're welcome",
    "that chart is illegal in 12 countries",
    "relax, that was a {jumpscare}",
    "tutorial difficulty: [spicy]. back to normal now",
    "nobody told you the tutorial bites?",
  ],
  // One fixed line each: the unlock reveal, and the Konami code.
  reveal: ["you found me!"],
  wink: ["you know the code ✦"],
};

const lastPick = new Map(); // moment -> the line it gave last, for the whole session

// A random line of the moment's pool, never the one this moment gave last time. A one-line pool gives its line, an
// unknown moment gives "".
export function pickLine(moment, random = Math.random) {
  const pool = Object.hasOwn(LINES, moment) ? LINES[moment] : null;
  if (!pool || pool.length === 0) return "";
  const previous = lastPick.get(moment);
  const choices = pool.length > 1 ? pool.filter((line) => line !== previous) : pool;
  const index = Math.max(0, Math.min(choices.length - 1, Math.floor(random() * choices.length)));
  const line = choices[index];
  lastPick.set(moment, line);
  return line;
}

const MARKED = /\[([^[\]]+)\]|\{([^{}]+)\}/g;

// A line split into its plain text and its picked-out words: [word] is cyan, {word} is pink.
export function lineParts(line) {
  if (typeof line !== "string" || line === "") return [];
  const parts = [];
  let at = 0;
  for (const match of line.matchAll(MARKED)) {
    if (match.index > at) parts.push({ text: line.slice(at, match.index), tone: null });
    parts.push(match[1] !== undefined ? { text: match[1], tone: "cyan" } : { text: match[2], tone: "pink" });
    at = match.index + match[0].length;
  }
  if (at < line.length) parts.push({ text: line.slice(at), tone: null });
  return parts;
}
