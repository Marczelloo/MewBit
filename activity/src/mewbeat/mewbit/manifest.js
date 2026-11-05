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

// Most poses play at 24 fps; the calm loops run slower so they breathe instead of hurrying.
export const MEWBIT_POSES = {
  neutral: pose("neutral", "game", run(64), 16),
  vibe1: pose("vibe1", "game", run(64), 24, { bubble: "nyaa~!" }),
  vibe2: pose("vibe2", "game", run(64), 24, { bubble: "wooo!!" }),
  vibe3: pose("vibe3", "game", run(48), 24, { bubble: "SUGOI!!" }),
  // These three fit MISS_POSE_MS and CRUSHED_POSE_MS in missPose.js and MILESTONE_POSE_MS in useMewbeatGame.js.
  miss: pose("miss", "game", run(14), 24, { hold: true, bubble: "eep!" }),
  crushed: pose("crushed", "game", run(28), 24, { hold: true, bubble: "nyoo… ;-;" }),
  milestone: pose("milestone", "game", run(21), 24, { hold: true }),
  fever: pose("fever", "game", run(48), 24, { bubble: "FEVER!!! ✦" }),
  charting: pose("charting", "game", run(48), 12, { bubble: "charting…" }),
  // Climbs out of the unlock glitch; its last frame is the first of reveal.
  emerge: pose("emerge", "unlock", run(38), 24, { hold: true }),
  reveal: pose("reveal", "unlock", run(30), 24, { hold: true, motion: "mb-motion-reveal", bubble: "you found me!" }),
  // Lobby poses from the design spec: the room lobby shows stretch/adjust while idle, peek before a round,
  // hype on the countdown digits and go on GO.
  stretch: pose("stretch", "lobby", run(64), 16),
  adjust: pose("adjust", "lobby", run(48), 16),
  peek: pose("peek", "lobby", run(48), 16),
  hype: pose("hype", "lobby", run(32), 24),
  go: pose("go", "lobby", run(22), 24, { hold: true, bubble: "nyaa~ ✦" }),
  cheer: pose("cheer", "results", run(32), 24),
  okay: pose("okay", "results", run(48), 12),
  sad: pose("sad", "results", run(48), 12),
  newbest: pose("newbest", "results", run(26), 24, { hold: true }),
};
