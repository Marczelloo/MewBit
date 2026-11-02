import { useEffect, useRef, useState } from "react";
import { effectiveEffects } from "./effects.js";
import { FRAME_MS, unlockAt } from "./glitch.js";
import { GlitchFilters, paintNoise, setGlitchFilter, useGlitchPage } from "./GlitchFx.jsx";
import Mewbit, { preloadMewbitGroup, usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import "./mewbeat.css";

const TIMELINE_VARS = ["--mb-dim", "--mb-scan", "--mb-rift-clip", "--mb-rift-split", "--mb-sprite-clip"];

// glitch: the app tears and a rift opens. emerge: Mewbit climbs out of it. card: the rift shuts as the
// title and buttons come in. settled: everything has stopped. Without full effects it starts settled.
export default function UnlockReveal({ onDone, onPlay, effects = "full" }) {
  const prefersReduced = usePrefersReducedMotion();
  const level = effectiveEffects(effects, prefersReduced);
  const calm = level !== "full";
  const [stage, setStage] = useState(calm ? "settled" : "glitch");
  const dialogRef = useRef(null);
  const playRef = useRef(null);
  const noiseRef = useRef(null);
  const riftNoiseRef = useRef(null);
  const running = stage !== "settled";
  const cardIn = stage === "card" || !running;

  useGlitchPage(stage === "glitch" || stage === "emerge");

  useEffect(() => preloadMewbitGroup("unlock"), []);

  // The OS setting can flip mid-glitch; skip straight to the card then.
  useEffect(() => {
    if (calm) setStage("settled");
  }, [calm]);

  useEffect(() => {
    if (!running) return undefined;
    const root = dialogRef.current;
    root?.focus();
    const start = performance.now();
    const tick = () => {
      const ms = performance.now() - start;
      const frame = unlockAt(ms);
      setStage(frame.stage);
      if (frame.stage === "settled") return;
      setGlitchFilter("mb-glitch-page", frame.page);
      setGlitchFilter("mb-glitch-sprite", frame.sprite);
      document.documentElement.style.setProperty("--mb-slip", `${frame.slip}px`);
      root?.style.setProperty("--mb-dim", frame.dim);
      root?.style.setProperty("--mb-scan", frame.scan);
      root?.style.setProperty("--mb-rift-clip", frame.riftClip);
      root?.style.setProperty("--mb-rift-split", `${frame.riftSplit}px`);
      root?.style.setProperty("--mb-sprite-clip", frame.spriteClip);
      paintNoise(noiseRef.current, frame.noise, frame.frame);
      paintNoise(riftNoiseRef.current, 0.5, frame.frame);
    };
    tick();
    const timer = window.setInterval(tick, FRAME_MS);
    return () => {
      window.clearInterval(timer);
      TIMELINE_VARS.forEach((name) => root?.style.removeProperty(name));
    };
    // `running` only ever goes from true to false, so the timeline starts once.
  }, [running]);

  useEffect(() => {
    if (cardIn) playRef.current?.focus();
  }, [cardIn]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDone?.();
        return;
      }
      if (running && !cardIn && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        setStage("settled");
        return;
      }
      if (event.key !== "Tab") return;
      if (!cardIn) { event.preventDefault(); return; }
      const buttons = [...(dialogRef.current?.querySelectorAll("button") || [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cardIn, onDone, running]);

  const skip = () => { if (!cardIn) setStage("settled"); };

  return (
    <div
      className={`mb-reveal ${running ? "mb-reveal-running" : ""}`.trim()}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="mewbeat unlocked"
      tabIndex={-1}
      onClick={skip}
    >
      {running ? (
        <>
          <GlitchFilters />
          <canvas className="mb-noise" ref={noiseRef} width="320" height="180" aria-hidden="true" />
          <div className="mb-scan" aria-hidden="true" />
        </>
      ) : null}
      <div className={`mb-reveal-card ${calm ? "mb-reveal-card-calm" : "mb-reveal-card-cut"}`}>
        <div className={`mb-reveal-figure ${running ? "mb-reveal-figure-fx" : ""}`.trim()}>
          {running ? (
            <div className="mb-rift" aria-hidden="true">
              <span className="mb-rift-rim mb-rift-rim-a" />
              <span className="mb-rift-rim mb-rift-rim-b" />
              <span className="mb-rift-void"><canvas ref={riftNoiseRef} width="96" height="108" /></span>
            </div>
          ) : null}
          {stage === "glitch" ? null : (
            <div className="mb-reveal-sprite">
              <Mewbit pose={stage === "emerge" ? "emerge" : "reveal"} effects={level} />
            </div>
          )}
        </div>
        <div className={`mb-reveal-text ${cardIn ? "is-in" : ""}`.trim()}>
          <h2 className="mb-reveal-title">mewbeat unlocked</h2>
          <p className="mb-reveal-copy">A 4-lane rhythm game for whatever is playing in the room.</p>
          <div className="mb-reveal-actions">
            <button type="button" className="mb-btn mb-btn-primary" ref={playRef} onClick={onPlay}>Play now</button>
            <button type="button" className="mb-btn" onClick={onDone}>Later</button>
          </div>
        </div>
      </div>
    </div>
  );
}
