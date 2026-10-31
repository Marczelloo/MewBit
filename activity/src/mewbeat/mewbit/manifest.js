// Poses for Mewbit. A "placeholder" pose animates the single PNG with a CSS class from
// mewbeat.css; a "frames" pose ({ kind: "frames", frames: [url, ...], fps }) plays an image
// sequence instead, so final art replaces the placeholder by editing this file alone.
export const MEWBIT_POSES = {
  neutral: { kind: "placeholder", motion: "mb-motion-neutral" },
  vibe1: { kind: "placeholder", motion: "mb-motion-vibe1", bubble: "nyaa~!" },
  vibe2: { kind: "placeholder", motion: "mb-motion-vibe2", bubble: "wooo!!" },
  vibe3: { kind: "placeholder", motion: "mb-motion-vibe3", bubble: "SUGOI!!" },
  miss: { kind: "placeholder", motion: "mb-motion-miss", bubble: "eep!" },
  crushed: { kind: "placeholder", motion: "mb-motion-crushed", bubble: "nyoo… ;-;" },
  milestone: { kind: "placeholder", motion: "mb-motion-milestone" },
  fever: { kind: "placeholder", motion: "mb-motion-fever", bubble: "FEVER!!! ✦" },
  charting: { kind: "placeholder", motion: "mb-motion-charting", bubble: "charting…" },
  reveal: { kind: "placeholder", motion: "mb-motion-reveal", bubble: "you found me!" },
};
