import { useEffect, useRef, useState } from "react";
import { effectiveEffects } from "./effects.js";
import { FRAME_MS, unlockAt } from "./glitch.js";
import { GlitchFilters, paintNoise, setGlitchFilter, useGlitchPage } from "./GlitchFx.jsx";
import Mewbit, { preloadMewbitGroup, usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import { MEWBIT_POSES } from "./mewbit/manifest.js";
import "./mewbeat.css";

const TIMELINE_VARS = ["--mb-dim", "--mb-scan", "--mb-rift-clip", "--mb-rift-split", "--mb-sprite-clip"];

// How long "you found me!" is on screen before the game's cut: the reveal pose plays through, then holds a beat.
const REVEAL_BEAT_MS = 900;
const REVEAL_SHOWN_MS = (MEWBIT_POSES.reveal.frames.length / MEWBIT_POSES.reveal.fps) * 1000 + REVEAL_BEAT_MS;
// The pose shows once its first frame is decoded, which can lag on a slow connection; if it never does, go on anyway.
const REVEAL_GIVE_UP_MS = 6000;

// glitch: the app tears and a rift opens. emerge: Mewbit climbs out of it. card: the rift shuts as she settles.
// settled: everything has stopped. Without full effects it starts settled and hands over at once. Once the reveal
// pose has been on screen for REVEAL_SHOWN_MS (or on Escape) it calls onDone, which starts the cut into the game.
export default function UnlockReveal({ onDone, effects = "full" }) {
  const prefersReduced = usePrefersReducedMotion();
  const level = effectiveEffects(effects, prefersReduced);
  const calm = level !== "full";
  const [stage, setStage] = useState(calm ? "settled" : "glitch");
  const dialogRef = useRef(null);
  const noiseRef = useRef(null);
  const riftNoiseRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [revealUp, setRevealUp] = useState(false); // the reveal pose is on screen
  const running = stage !== "settled";
  const revealStage = stage === "card" || stage === "settled";

  useGlitchPage(stage === "glitch" || stage === "emerge");

  useEffect(() => preloadMewbitGroup("unlock"), []);

  // The OS setting can flip mid-glitch; skip straight to the end then.
  useEffect(() => {
    if (calm) setStage("settled");
  }, [calm]);

  useEffect(() => {
    if (calm) {
      onDoneRef.current?.();
      return undefined;
    }
    if (!revealStage) return undefined;
    const timer = window.setTimeout(() => onDoneRef.current?.(), revealUp ? REVEAL_SHOWN_MS : REVEAL_GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [calm, revealStage, revealUp]);

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
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDoneRef.current?.();
        return;
      }
      if (running && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        setStage("settled");
        return;
      }
      // There is nothing to tab to: keep focus on the dialog.
      if (event.key === "Tab") event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [running]);

  const skip = () => { if (running) setStage("settled"); };

  return (
    <div
      className={`mb-reveal ${running ? "mb-reveal-running" : ""}`.trim()}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="mewbeat"
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
              <Mewbit pose={stage === "emerge" ? "emerge" : "reveal"} effects={level} onShow={(name) => setRevealUp(name === "reveal")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
