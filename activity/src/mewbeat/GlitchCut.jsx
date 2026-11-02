import { useEffect, useRef } from "react";
import { effectiveEffects } from "./effects.js";
import { CUT, FRAME_MS, cutAt } from "./glitch.js";
import { GlitchFilters, paintNoise, setGlitchFilter, useGlitchPage } from "./GlitchFx.jsx";
import { usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import "./mewbeat.css";

const LOAD_WAIT_MS = 1500;

// The short glitch that carries you into the game: the screen tears, cuts to black while the game mounts
// behind it, then the game resolves out of the noise. Without full effects it opens the game straight away.
export default function GlitchCut({ effects = "full", load, dimFrom = 0, onCut, onDone }) {
  const prefersReduced = usePrefersReducedMotion();
  const calm = effectiveEffects(effects, prefersReduced) !== "full";
  const rootRef = useRef(null);
  const noiseRef = useRef(null);
  const latest = useRef({});
  latest.current = { load, dimFrom, onCut, onDone };

  useGlitchPage(!calm);

  useEffect(() => {
    if (calm) {
      latest.current.onCut?.();
      latest.current.onDone?.();
      return undefined;
    }
    let ready = false;
    let cutAtTime = null;
    let wait = 0;
    Promise.race([
      Promise.resolve(latest.current.load?.()).catch(() => {}),
      new Promise((resolve) => { wait = window.setTimeout(resolve, LOAD_WAIT_MS); }),
    ]).then(() => { ready = true; });
    const start = performance.now();
    const paint = (ms) => {
      const frame = cutAt(ms, latest.current.dimFrom);
      setGlitchFilter("mb-glitch-page", frame.page);
      document.documentElement.style.setProperty("--mb-slip", `${frame.slip}px`);
      const root = rootRef.current;
      root?.style.setProperty("--mb-dim", frame.dim);
      root?.style.setProperty("--mb-scan", frame.scan);
      paintNoise(noiseRef.current, frame.noise, frame.frame);
    };
    const tick = () => {
      const now = performance.now();
      let ms = now - start;
      if (ms >= CUT.holdMs) {
        // Stay on black until the game's code has arrived, so its entrance is what the cut reveals.
        if (cutAtTime === null && ready) {
          cutAtTime = now;
          latest.current.onCut?.();
        }
        ms = cutAtTime === null ? CUT.holdMs : CUT.holdMs + (now - cutAtTime);
      }
      if (ms >= CUT.endMs) {
        window.clearInterval(timer);
        latest.current.onDone?.();
        return;
      }
      paint(ms);
    };
    tick();
    const timer = window.setInterval(tick, FRAME_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(wait);
    };
  }, [calm]);

  if (calm) return null;
  return (
    <div className="mb-cut" ref={rootRef} aria-hidden="true">
      <GlitchFilters />
      <canvas className="mb-noise" ref={noiseRef} width="320" height="180" />
      <div className="mb-scan" />
    </div>
  );
}
