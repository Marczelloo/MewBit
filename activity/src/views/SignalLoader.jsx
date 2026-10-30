import React, { useEffect, useRef, useState } from "react";
import { createSignalEngine, stageScale } from "./signalEngine.js";
import "../signalLoader.css";

// If animation frames stop (a hidden window), the app still opens this long after ready.
const FALLBACK_MS = 6500;

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function useStageScale() {
  const [scale, setScale] = useState(() => (typeof window === "undefined" ? 1 : stageScale(window.innerWidth, window.innerHeight)));
  useEffect(() => {
    const update = () => setScale(stageScale(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return scale;
}

/**
 * The opening sequence: light gathers while the room loads, then builds the
 * MewBit mark, flashes, and hands over to the app. `ready` starts the finale;
 * `onPhase("done")` is the moment to bring the app in, `onDone` the moment to unmount.
 */
export default function SignalLoader({ ready = false, message = "", onPhase, onDone }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const callbacks = useRef({ onPhase, onDone });
  const [phase, setPhase] = useState("loading");
  const scale = useStageScale();
  callbacks.current = { onPhase, onDone };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = createSignalEngine(canvas, {
      reduce: prefersReducedMotion(),
      onPhase: (next) => {
        if (next === "stopped") {
          callbacks.current.onDone?.();
          return;
        }
        setPhase(next);
        callbacks.current.onPhase?.(next);
      },
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    engineRef.current?.setReady();
    const timer = window.setTimeout(() => {
      callbacks.current.onPhase?.("done");
      callbacks.current.onDone?.();
    }, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  return (
    <div className={`signal-loader p-${phase}`} role="status" aria-live="polite" aria-busy={phase === "loading"}>
      <canvas className="signal-fx" ref={canvasRef} aria-hidden="true" />
      <div className="signal-vignette" aria-hidden="true" />
      <svg className="signal-grain" aria-hidden="true">
        <filter id="signal-grain-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#signal-grain-noise)" />
      </svg>

      <div className="signal-stage" style={{ "--signal-scale": scale }}>
        <div className="signal-logo" role="img" aria-label="MewBit">
          <svg className="signal-mark" width="200" height="200" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="13.2" stroke="currentColor" strokeWidth="1.5" opacity="0.28" />
            <path d="M8.4 11.2 L7.2 5.6 L12.4 8.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M23.6 11.2 L24.8 5.6 L19.6 8.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.6 18.4 v-2.2 a7.4 7.4 0 0 1 14.8 0 v2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <rect x="6.4" y="17.6" width="4.2" height="6.4" rx="2.1" fill="currentColor" />
            <rect x="21.4" y="17.6" width="4.2" height="6.4" rx="2.1" fill="currentColor" />
            <g stroke="#67e3f4" strokeWidth="1.7" strokeLinecap="round">
              <path d="M13 19.4 v2.6" />
              <path d="M16 17.4 v6.6" />
              <path d="M19 19.4 v2.6" />
            </g>
          </svg>
          <span className="signal-wordmark">MewBit</span>
          <div className="signal-horizon" />
        </div>
      </div>

      <p className="signal-status">{message || "Connecting to the room…"}</p>
    </div>
  );
}
