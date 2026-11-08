// Poses for Mewbit. A "frames" pose plays an image sequence: `order` lists the 1-based files in
// frames/<pose>/ as played (a loop may revisit a frame), `hold` makes it a one-shot that stays on
// its last frame, and `group` is the screen whose poses are preloaded together (`also` names more screens
// that preload it). `rest` marks a loop that
// starts and ends on the rest pose, so two of them can hand over on a cycle boundary without a fade (see
// Mewbit.jsx). Loops with the same `sync` move identically, so switching between them keeps the phase. An optional `motion` is a CSS class from mewbeat.css on top of the frames. A { kind: "placeholder", motion }
// pose animates the single PNG with that class instead. New art only needs this file.
const FRAME_URLS = import.meta.glob("./frames/*/*.webp", { eager: true, query: "?url", import: "default" });

function pose(name, group, order, fps, extra = {}) {
  const frames = order.map((n) => FRAME_URLS[`./frames/${name}/${String(n).padStart(2, "0")}.webp`]);
  return { kind: "frames", group, frames, fps, ...extra };
}

// Files 1..count in order, then back down to `from` when a loop retraces its way to the start.
function run(count, from) {
  const up = Array.from({ length: count }, (_, i) => i + 1);
  return from === undefined ? up : [...up, ...up.slice(from - 1, -1).reverse()];
}

// Most poses play at 24 fps; the calm loops run slower so they breathe instead of hurrying.
export const MEWBIT_POSES = {
  neutral: pose("neutral", "game", run(64), 16, { rest: true }),
  vibe1: pose("vibe1", "game", run(64), 24, { rest: true, bubble: "nyaa~!" }),
  vibe2: pose("vibe2", "game", run(64), 24, { rest: true, bubble: "wooo!!" }),
  vibe3: pose("vibe3", "game", run(48), 24, { bubble: "SUGOI!!" }),
  combo100: pose("combo100", "game", run(48), 24, { sync: "combo", bubble: "KIRA KIRA~!" }),
  combo200: pose("combo200", "game", run(48), 24, { sync: "combo", bubble: "SUGOOOI!!" }),
  combo300: pose("combo300", "game", run(48), 24, { sync: "combo", bubble: "KAMI!!! ✦" }),
  // These three fit MISS_POSE_MS and CRUSHED_POSE_MS in missPose.js and MILESTONE_POSE_MS in useMewbeatGame.js;
  // crushed (a deeper miss: she sinks, head down, the gloom over her brow) plays in under a second and holds the gloom.
  miss: pose("miss", "game", run(14), 24, { hold: true, bubble: "eep!" }),
  crushed: pose("crushed", "game", run(26), 30, { hold: true, bubble: "mou~" }),
  milestone: pose("milestone", "game", run(21), 24, { hold: true }),
  fever: pose("fever", "game", run(48), 24, { sync: "fever", bubble: "FEVER!!! ✦" }),
  fever100: pose("fever100", "game", run(48), 24, { sync: "fever", bubble: "FEVER!!! ✦" }),
  fever200: pose("fever200", "game", run(48), 24, { sync: "fever", bubble: "FEVER!!! ✦" }),
  fever300: pose("fever300", "game", run(48), 24, { sync: "fever", bubble: "FEVER!!! ✦" }),
  charting: pose("charting", "game", run(48), 12, { rest: true, bubble: "charting…" }),
  // Climbs out of the unlock glitch; its last frame is the first of reveal.
  emerge: pose("emerge", "unlock", run(38), 24, { hold: true }),
  reveal: pose("reveal", "unlock", run(30), 24, { hold: true, motion: "mb-motion-reveal", bubble: "you found me!" }),
  // Lobby poses from the design spec: the room lobby idles (below), peeks before a round, is hyped on the
  // countdown digits, counts the last three on her fingers and goes on GO; Solo's count-in plays them over the
// game screen, so they preload with it too. count3 raises the hand in half a
  // second (Solo's count-in step); count2 and count1 fold a finger from where it left her, then hold.
  stretch: pose("stretch", "lobby", run(64), 16, { rest: true }),
  adjust: pose("adjust", "lobby", run(48), 16, { rest: true }),
  peek: pose("peek", "lobby", run(48), 16, { rest: true }),
  hype: pose("hype", "lobby", run(32), 24, { also: ["game"] }),
  count3: pose("count3", "lobby", run(14), 28, { hold: true, also: ["game"] }),
  count2: pose("count2", "lobby", run(12), 24, { hold: true, also: ["game"] }),
  count1: pose("count1", "lobby", run(12), 24, { hold: true, also: ["game"] }),
  go: pose("go", "lobby", run(22), 24, { hold: true, also: ["game"], bubble: "nyaa~ ✦" }),
  // The lobby idle: neutral for a random 5–11 s, then one cycle of stretch or adjust, then neutral again.
  idle: { kind: "routine", group: "lobby", base: "neutral", fidgets: ["stretch", "adjust"], restMs: [5000, 11000] },
  cheer: pose("cheer", "results", run(32), 24),
  okay: pose("okay", "results", run(48), 12, { rest: true }),
  sad: pose("sad", "results", run(48), 12),
  newbest: pose("newbest", "results", run(26), 24, { hold: true }),
};
