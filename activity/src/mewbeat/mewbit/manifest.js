// Poses for Mewbit. A "frames" pose plays an image sequence: `order` lists the 1-based files in
// frames/<pose>/ as played (a loop may revisit a frame), `hold` makes it a one-shot that stays on
// its last frame, and `group` is the screen whose poses are preloaded together. An optional
// `motion` is a CSS class from mewbeat.css on top of the frames. A { kind: "placeholder", motion }
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

// Poses a screen shows play at 12 fps, on twos like anime; the tempo comes from the in-betweens per move.
const TWOS = 12;

export const MEWBIT_POSES = {
  neutral: pose("neutral", "game", [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8], TWOS),
  vibe1: pose("vibe1", "game", run(13, 2), TWOS, { bubble: "nyaa~!" }),
  vibe2: pose("vibe2", "game", run(16), TWOS, { bubble: "wooo!!" }),
  vibe3: pose("vibe3", "game", run(12), TWOS, { bubble: "SUGOI!!" }),
  // These three fit MISS_POSE_MS, CRUSHED_POSE_MS and MILESTONE_POSE_MS in useMewbeatGame.js.
  miss: pose("miss", "game", run(7), TWOS, { hold: true, bubble: "eep!" }),
  crushed: pose("crushed", "game", run(13), TWOS, { hold: true, bubble: "nyoo… ;-;" }),
  milestone: pose("milestone", "game", run(10), TWOS, { hold: true }),
  fever: pose("fever", "game", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 11, 12, 13, 14, 15], TWOS, { bubble: "FEVER!!! ✦" }),
  charting: pose("charting", "game", run(13, 2), TWOS, { bubble: "charting…" }),
  // Climbs out of the unlock glitch; its last frame is the first of reveal.
  emerge: pose("emerge", "unlock", run(19), TWOS, { hold: true }),
  reveal: pose("reveal", "unlock", run(13), TWOS, { hold: true, motion: "mb-motion-reveal", bubble: "you found me!" }),
  // Lobby and results poses from the design spec: no screen renders <Mewbit> with them yet.
  stretch: pose("stretch", "lobby", [1, 2, 3, 2, 4], 2.5),
  adjust: pose("adjust", "lobby", [1, 2, 3], 3),
  peek: pose("peek", "lobby", [1, 2, 3, 2], 3),
  hype: pose("hype", "lobby", [1, 2, 3, 4], 7),
  go: pose("go", "lobby", [1, 2, 3], 5, { hold: true, bubble: "nyaa~ ✦" }),
  cheer: pose("cheer", "results", [1, 2, 3, 2, 4], 5),
  okay: pose("okay", "results", [1, 2, 3], 2.5),
  sad: pose("sad", "results", [1, 2, 3], 2.5),
  newbest: pose("newbest", "results", [1, 2, 3, 4], 4, { hold: true }),
};
