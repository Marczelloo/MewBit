// Poses for Mewbit. A "frames" pose plays an image sequence: `order` lists the 1-based files in
// frames/<pose>/ as played (a loop may revisit a frame), `hold` makes it a one-shot that stays on
// its last frame, and `group` is the screen whose poses are preloaded together. `rest` marks a loop that
// starts and ends on the rest pose, so two of them can hand over on a cycle boundary without a fade (see
// Mewbit.jsx). An optional `motion` is a CSS class from mewbeat.css on top of the frames. A { kind: "placeholder", motion }
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
  // These three fit MISS_POSE_MS, CRUSHED_POSE_MS and MILESTONE_POSE_MS in useMewbeatGame.js; crushed (hands
  // over her eyes, sobbing) runs its full second and holds the last sob a little longer.
  miss: pose("miss", "game", run(14), 24, { hold: true, bubble: "eep!" }),
  crushed: pose("crushed", "game", run(36), 36, { hold: true, bubble: "nyoo… ;-;" }),
  milestone: pose("milestone", "game", run(21), 24, { hold: true }),
  fever: pose("fever", "game", run(48), 24, { bubble: "FEVER!!! ✦" }),
  charting: pose("charting", "game", run(48), 12, { rest: true, bubble: "charting…" }),
  // Climbs out of the unlock glitch; its last frame is the first of reveal.
  emerge: pose("emerge", "unlock", run(38), 24, { hold: true }),
  reveal: pose("reveal", "unlock", run(30), 24, { hold: true, motion: "mb-motion-reveal", bubble: "you found me!" }),
  // Lobby poses from the design spec: the room lobby idles (below), peeks before a round, is hyped on the
  // countdown digits, counts the last three on her fingers and goes on GO. count3 raises the hand in half a
  // second (Solo's count-in step); count2 and count1 fold a finger from where it left her, then hold.
  stretch: pose("stretch", "lobby", run(64), 16, { rest: true }),
  adjust: pose("adjust", "lobby", run(48), 16, { rest: true }),
  peek: pose("peek", "lobby", run(48), 16, { rest: true }),
  hype: pose("hype", "lobby", run(32), 24),
  count3: pose("count3", "lobby", run(14), 28, { hold: true }),
  count2: pose("count2", "lobby", run(12), 24, { hold: true }),
  count1: pose("count1", "lobby", run(12), 24, { hold: true }),
  go: pose("go", "lobby", run(22), 24, { hold: true, bubble: "nyaa~ ✦" }),
  // The lobby idle: neutral for a random 5–11 s, then one cycle of stretch or adjust, then neutral again.
  idle: { kind: "routine", group: "lobby", base: "neutral", fidgets: ["stretch", "adjust"], restMs: [5000, 11000] },
  cheer: pose("cheer", "results", run(32), 24),
  okay: pose("okay", "results", run(48), 12, { rest: true }),
  sad: pose("sad", "results", run(48), 12),
  newbest: pose("newbest", "results", run(26), 24, { hold: true }),
};
