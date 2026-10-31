import { useEffect, useRef, useState } from "react";
import { effectiveEffects } from "./effects.js";
import Mewbit, { usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import "./mewbeat.css";

const GLITCH_MS = 600;
// Horizontal bands that tear across the screen: top and height in %, shift direction, tint.
const SLICES = [
  { top: 6, height: 9, dir: -1, tint: "cyan" },
  { top: 19, height: 5, dir: 1, tint: "pink" },
  { top: 31, height: 12, dir: -1, tint: "violet" },
  { top: 48, height: 6, dir: 1, tint: "cyan" },
  { top: 59, height: 14, dir: -1, tint: "pink" },
  { top: 77, height: 7, dir: 1, tint: "violet" },
  { top: 88, height: 5, dir: -1, tint: "cyan" },
];

export default function UnlockReveal({ onDone, onPlay, effects = "full" }) {
  const prefersReduced = usePrefersReducedMotion();
  const level = effectiveEffects(effects, prefersReduced);
  const calm = level !== "full";
  const [stage, setStage] = useState(calm ? "card" : "glitch");
  const dialogRef = useRef(null);
  const playRef = useRef(null);

  useEffect(() => {
    if (stage !== "glitch") return undefined;
    const timer = window.setTimeout(() => setStage("card"), GLITCH_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  // The OS setting can flip mid-glitch; skip straight to the card then.
  useEffect(() => {
    if (calm) setStage("card");
  }, [calm]);

  useEffect(() => {
    if (stage === "card") playRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDone?.();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...(dialogRef.current?.querySelectorAll("button") || [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDone]);

  return (
    <div className="mb-reveal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="mewbeat unlocked">
      {stage === "glitch" ? (
        <div className="mb-glitch" aria-hidden="true" style={{ "--mb-glitch-ms": `${GLITCH_MS}ms` }}>
          {SLICES.map((slice, index) => (
            <span
              key={index}
              className={`mb-glitch-slice mb-tint-${slice.tint}`}
              style={{ top: `${slice.top}%`, height: `${slice.height}%`, "--mb-dir": slice.dir, "--mb-delay": `${index * 38}ms` }}
            />
          ))}
          <span className="mb-glitch-split mb-glitch-split-a" />
          <span className="mb-glitch-split mb-glitch-split-b" />
        </div>
      ) : (
        <div className={`mb-reveal-card ${calm ? "mb-reveal-card-calm" : ""}`.trim()}>
          <Mewbit pose="reveal" effects={level} />
          <h2 className="mb-reveal-title">mewbeat unlocked</h2>
          <p className="mb-reveal-copy">A 4-lane rhythm game for whatever is playing in the room.</p>
          <div className="mb-reveal-actions">
            <button type="button" className="mb-btn mb-btn-primary" ref={playRef} onClick={onPlay}>Play now</button>
            <button type="button" className="mb-btn" onClick={onDone}>Later</button>
          </div>
        </div>
      )}
    </div>
  );
}
