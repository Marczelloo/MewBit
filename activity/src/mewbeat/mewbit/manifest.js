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

export const MEWBIT_POSES = {
  neutral: pose("neutral", "game", [1, 2, 1, 3], 2.5),
  vibe1: pose("vibe1", "game", [1, 2, 3, 2], 4, { bubble: "nyaa~!" }),
  vibe2: pose("vibe2", "game", [1, 2, 3, 4], 6, { bubble: "wooo!!" }),
  vibe3: pose("vibe3", "game", [1, 2, 3, 4], 8, { bubble: "SUGOI!!" }),
  // These three fit MISS_POSE_MS, CRUSHED_POSE_MS and MILESTONE_POSE_MS in useMewbeatGame.js.
  miss: pose("miss", "game", [1, 2, 3], 5, { hold: true, bubble: "eep!" }),
  crushed: pose("crushed", "game", [1, 2, 3, 4], 3.4, { hold: true, bubble: "nyoo… ;-;" }),
  milestone: pose("milestone", "game", [1, 2, 3, 4], 4.5, { hold: true }),
  fever: pose("fever", "game", [1, 2, 3, 4, 3, 5], 8, { bubble: "FEVER!!! ✦" }),
  charting: pose("charting", "game", [1, 2, 3, 2], 2.5, { bubble: "charting…" }),
  reveal: pose("reveal", "unlock", [1, 2, 3, 4], 4, { hold: true, motion: "mb-motion-reveal", bubble: "you found me!" }),
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
