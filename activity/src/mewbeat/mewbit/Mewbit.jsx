import { useEffect, useState } from "react";
import { effectiveEffects } from "../effects.js";
import { MEWBIT_POSES } from "./manifest.js";
import placeholderUrl from "./mewbit.png";
import "../mewbeat.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// True while the OS asks for less motion. Falls back to false where matchMedia is missing.
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query) return undefined;
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// Cycles a frame list at the given fps; holds the first frame when not animating.
function useFrame(frames, fps, animate) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (!animate || !frames || frames.length < 2 || !(fps > 0)) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % frames.length), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [animate, fps, frames]);
  return index;
}

export default function Mewbit({ pose = "neutral", effects = "full", className = "" }) {
  const prefersReduced = usePrefersReducedMotion();
  const entry = MEWBIT_POSES[pose] || MEWBIT_POSES.neutral;
  const level = effectiveEffects(effects, prefersReduced);
  const animated = level !== "off";
  const frameIndex = useFrame(entry.frames, entry.fps, animated);
  const src = entry.kind === "frames" ? entry.frames?.[frameIndex] ?? placeholderUrl : placeholderUrl;
  const motion = entry.kind === "placeholder" && animated ? entry.motion : "";

  return (
    <div className={`mb-mewbit mb-mewbit-${level} ${className}`.trim()} data-pose={pose}>
      <div className={`mb-mewbit-body ${motion}`.trim()}>
        <img className="mb-mewbit-img" src={src} alt="Mewbit" draggable="false" />
      </div>
      {entry.bubble ? <div className="mb-mewbit-bubble" key={pose}>{entry.bubble}</div> : null}
    </div>
  );
}
