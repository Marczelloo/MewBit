// A frame monitor for finding stutter by hand: open the Activity with ?fps=1 and a corner box counts the frames that
// took longer than SLOW_FRAME_MS and shows the worst one. Without the flag nothing here runs.
export const SLOW_FRAME_MS = 20;

export const fpsFlagOn = (search) => new URLSearchParams(search).get("fps") === "1";

export function createFrameStats(slowMs = SLOW_FRAME_MS) {
  let frames = 0;
  let slow = 0;
  let worst = 0;
  return {
    push(ms) {
      frames += 1;
      if (ms > slowMs) slow += 1;
      if (ms > worst) worst = ms;
    },
    reset() {
      frames = 0;
      slow = 0;
      worst = 0;
    },
    snapshot: () => ({ frames, slow, worst }),
  };
}

// Draws the box and measures every animation frame until the returned stop is called.
export function startFrameMonitor(doc = document, raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window)) {
  const stats = createFrameStats();
  const box = doc.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:2147483647;padding:4px 7px;border-radius:6px;background:rgba(0,0,0,.72);color:#9fe;font:11px/1.4 monospace;pointer-events:none;white-space:pre";
  doc.body.appendChild(box);
  let last = null;
  let handle = 0;
  let shownAt = 0;
  const tick = (time) => {
    if (last !== null) stats.push(time - last);
    last = time;
    if (time - shownAt > 500) {
      shownAt = time;
      const { frames, slow, worst } = stats.snapshot();
      box.textContent = `frames ${frames}\nover ${SLOW_FRAME_MS} ms ${slow}\nworst ${worst.toFixed(1)} ms`;
    }
    handle = raf(tick);
  };
  handle = raf(tick);
  return () => {
    cancel(handle);
    box.remove();
  };
}
