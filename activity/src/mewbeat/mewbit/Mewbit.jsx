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

// Cycles a frame list at the given fps, or stops on the last frame when `hold` is set; holds the
// first frame when not animating. The index belongs to one frame list, so a new pose starts at
// its first frame right away instead of showing the old index for a paint.
function useFrame(frames, fps, animate, hold) {
  const [state, setState] = useState({ frames, index: 0 });
  useEffect(() => {
    setState({ frames, index: 0 });
    if (!animate || !frames || frames.length < 2 || !(fps > 0)) return undefined;
    const timer = window.setInterval(() => {
      setState((current) => {
        const next = current.index + 1;
        if (next < frames.length) return { frames, index: next };
        return hold ? current : { frames, index: 0 };
      });
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [animate, fps, frames, hold]);
  return state.frames === frames ? state.index : 0;
}

const preloaded = new Map();

// Loads every frame of a screen's poses up front, so a pose never blinks while its images download.
function preloadGroup(group) {
  if (!group || preloaded.has(group)) return;
  const urls = Object.values(MEWBIT_POSES).filter((entry) => entry.group === group).flatMap((entry) => entry.frames);
  preloaded.set(group, [...new Set(urls)].map((url) => {
    const image = new Image();
    image.src = url;
    return image;
  }));
}

export default function Mewbit({ pose = "neutral", effects = "full", className = "" }) {
  const prefersReduced = usePrefersReducedMotion();
  const entry = MEWBIT_POSES[pose] || MEWBIT_POSES.neutral;
  const level = effectiveEffects(effects, prefersReduced);
  const animated = level !== "off";
  const frameIndex = useFrame(entry.frames, entry.fps, animated, entry.hold);
  const src = entry.kind === "frames" ? entry.frames?.[frameIndex] ?? placeholderUrl : placeholderUrl;
  const motion = animated && entry.motion ? entry.motion : "";

  useEffect(() => preloadGroup(entry.group), [entry.group]);

  return (
    <div className={`mb-mewbit mb-mewbit-${level} ${className}`.trim()} data-pose={pose}>
      <div className={`mb-mewbit-body ${motion}`.trim()}>
        <img className="mb-mewbit-img" src={src} alt="Mewbit" draggable="false" />
      </div>
      {entry.bubble ? <div className="mb-mewbit-bubble" key={pose}>{entry.bubble}</div> : null}
    </div>
  );
}
