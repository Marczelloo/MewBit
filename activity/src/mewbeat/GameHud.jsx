import { useEffect, useState } from "react";

const RING_LENGTH = 145; // circumference of the r=23 ring
const JUDGEMENT_CLASS = { perfect: "mb-j-perfect", great: "mb-j-great", good: "mb-j-good", miss: "mb-j-miss" };

export function formatScore(score) {
  return Math.round(score).toLocaleString("en-US");
}

export function formatAccuracy(accuracy) {
  return accuracy === null || accuracy === undefined ? "--" : `${accuracy.toFixed(2)}%`;
}

// Seconds of FEVER left, counted down locally from the snapshot so the HUD only re-renders on run events.
function useFeverSeconds(active, leftMs) {
  const [left, setLeft] = useState(leftMs);
  useEffect(() => {
    if (!active) {
      setLeft(0);
      return undefined;
    }
    const endsAt = performance.now() + leftMs;
    const tick = () => setLeft(Math.max(0, endsAt - performance.now()));
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [active, leftMs]);
  return left / 1000;
}

// Combo, multiplier ring and the last judgement, drawn over the highway.
export function HighwayReadout({ hud }) {
  const { combo, multiplier, feverActive, judgement } = hud;
  const progress = multiplier >= 4 ? 1 : (combo % 10) / 10;
  const shown = multiplier * (feverActive ? 2 : 1);
  return (
    <>
      <div className="mb-combo" aria-hidden="true">
        <b className="mb-combo-count">{combo}</b>
        <span className="mb-combo-label">COMBO</span>
        <div className={`mb-mult mb-mult-${multiplier}`} key={multiplier}>
          <svg viewBox="0 0 54 54">
            <circle className="mb-mult-bg" cx="27" cy="27" r="23" />
            <circle className="mb-mult-fg" cx="27" cy="27" r="23" style={{ strokeDashoffset: RING_LENGTH * (1 - progress) }} />
          </svg>
          <b className="mb-mult-text">{`×${shown}`}</b>
        </div>
      </div>
      {judgement ? (
        <div className={`mb-judgement ${JUDGEMENT_CLASS[judgement.kind] ?? ""}`.trim()} key={judgement.id} aria-hidden="true">
          {judgement.text}
        </div>
      ) : null}
    </>
  );
}

export default function GameHud({ hud }) {
  const full = hud.vibe >= 1 && !hud.feverActive;
  const feverSeconds = useFeverSeconds(hud.feverActive, hud.feverLeftMs);
  // During FEVER the vibe drains over the time it has left; a linear transition draws that without per-frame state.
  const vibeStyle = hud.feverActive
    ? { transform: "scaleX(0)", transition: `transform ${Math.max(0, hud.feverLeftMs)}ms linear` }
    : { transform: `scaleX(${hud.vibe})`, transition: "transform 200ms ease-out" };
  return (
    <section className="mb-hud" aria-label="Score">
      <div className="mb-hud-card">
        <span className="mb-label">Score</span>
        <div className="mb-hud-score">{formatScore(hud.score)}</div>
        <div className="mb-hud-stats">
          <div>
            Accuracy
            <b>{formatAccuracy(hud.accuracy)}</b>
          </div>
          <div>
            Max combo
            <b>{hud.maxCombo}</b>
          </div>
        </div>
        <span className="mb-label mb-hud-vibe-label">Vibe</span>
        <div
          className={`mb-vibe ${full ? "mb-vibe-full" : ""} ${hud.feverActive ? "mb-vibe-fever" : ""}`.trim()}
          role="progressbar"
          aria-label="Vibe"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hud.vibe * 100)}
        >
          <i style={vibeStyle} />
        </div>
        <div className={`mb-vibe-hint ${full ? "mb-vibe-hint-ready" : ""}`.trim()}>
          {hud.feverActive ? `FEVER · double points · ${feverSeconds.toFixed(1)} s` : full ? "Space for FEVER!" : "Fill vibe with hits"}
        </div>
      </div>
    </section>
  );
}
