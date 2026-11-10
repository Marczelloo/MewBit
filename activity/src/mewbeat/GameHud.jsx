import { memo, useEffect, useRef, useState } from "react";
import { gradeLadder } from "./scoring.js";
import { DIFFICULTIES, gradeClass, resolveArtworkUrl } from "./SongSelect.jsx";

const RING_LENGTH = 145; // circumference of the r=23 ring
const JUDGEMENT_CLASS = { perfect: "mb-j-perfect", great: "mb-j-great", good: "mb-j-good", miss: "mb-j-miss" };

export function formatScore(score) {
  return Math.round(score).toLocaleString("en-US");
}

export function formatAccuracy(accuracy) {
  return accuracy === null || accuracy === undefined ? "--" : `${accuracy.toFixed(2)}%`;
}

// Seconds of FEVER left, counted down locally from the snapshot and written straight into the text node: ten ticks a
// second never render React, only a changed tenth touches the DOM.
function FeverCountdown({ active, leftMs }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (!active) {
      node.textContent = "";
      return undefined;
    }
    const endsAt = performance.now() + leftMs;
    let shown = "";
    const tick = () => {
      const text = `${(Math.max(0, endsAt - performance.now()) / 1000).toFixed(1)}s`;
      if (text !== shown) {
        shown = text;
        node.textContent = text;
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [active, leftMs]);
  return <span ref={ref} />;
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

// Compact difficulty picker of the track card. Choosing one asks for that chart while the song plays; `swap`
// ({ difficulty, status }) shows a change in flight, `disabled` greys it out (calibration, no run yet).
function DifficultyControl({ difficulty, disabled, swap, onChange }) {
  const loading = swap?.status === "loading";
  const failed = swap?.status === "failed";
  // The pill follows the request while it loads, so a click answers at once; the old chart keeps playing.
  const shown = loading ? swap.difficulty : difficulty;
  return (
    <div className="mb-diff">
      <div className="mb-diff-seg" role="group" aria-label="Difficulty">
        {DIFFICULTIES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`mb-diff-btn${id === shown ? " mb-diff-on" : ""}`}
            aria-pressed={id === shown}
            disabled={disabled}
            title={disabled ? "Difficulty can't change here" : undefined}
            onClick={() => onChange?.(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <small className={`mb-diff-note${loading ? " mb-diff-loading" : ""}${failed ? " mb-diff-failed" : ""}`} role="status">
        {loading ? "Loading chart…" : failed ? `Couldn't load ${swap.difficulty}. Keeping ${difficulty}.` : ""}
      </small>
    </div>
  );
}

// Square cover of the track card; a plain placeholder of the same size stands in when there is no artwork or it fails to load.
function TrackCover({ artworkUrl }) {
  const src = resolveArtworkUrl(artworkUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) return <img className="mb-track-cover" src={src} alt="" draggable={false} onError={() => setFailed(true)} />;
  return <span className="mb-track-cover mb-track-cover-empty" aria-hidden="true" />;
}

// Track card in the right column. The progress bar and its time readout live here: the game hook writes into
// the <i> through progressRef and into the readout through progressTimeRef.
// The difficulty control is Live's alone, where the song plays on whatever the player does: Solo and rooms pick theirs before the song.
export const TrackCard = memo(function TrackCard({ track, difficulty, progressRef, progressTimeRef, disabled = false, swap = null, onDifficulty }) {
  const label = DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? difficulty;
  return (
    <section className="mb-card mb-track" aria-label="Track">
      <div className="mb-track-head">
        <TrackCover artworkUrl={track?.artworkUrl} />
        <div className="mb-track-meta">
          <span className="mb-lv-chip">{label}</span>
          <b className="mb-track-title">{track?.title ?? "No track"}</b>
          {track?.artist ? <small className="mb-track-artist">{track.artist}</small> : null}
        </div>
      </div>
      {onDifficulty ? <DifficultyControl difficulty={difficulty} disabled={disabled} swap={swap} onChange={onDifficulty} /> : null}
      <div className="mb-track-prog">
        <div className="mb-progress" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
          <i ref={progressRef} />
        </div>
        <span className="mb-track-time" ref={progressTimeRef}>0:00</span>
      </div>
    </section>
  );
});

// Vertical vibe meter beside the highway: filling, ready (Space starts FEVER), then FEVER draining.
// Its slot is the highway's, so it sits in the gap next to the canvas without taking any of its width.
export function FeverBar({ hud }) {
  const ready = hud.vibe >= 1 && !hud.feverActive;
  // During FEVER the vibe drains over the time it has left; a linear transition draws that without per-frame state.
  const fillStyle = hud.feverActive
    ? { transform: "scaleY(0)", transition: `transform ${Math.max(0, hud.feverLeftMs)}ms linear` }
    : { transform: `scaleY(${hud.vibe})`, transition: "transform 200ms ease-out" };
  return (
    <div className={`mb-fever-meter${ready ? " mb-fever-ready" : ""}${hud.feverActive ? " mb-fever-on" : ""}`}>
      <span className="mb-fever-top" aria-hidden="true">{hud.feverActive ? <FeverCountdown active leftMs={hud.feverLeftMs} /> : ready ? "SPACE" : ""}</span>
      <div className="mb-fever-bar">
        <div
          className="mb-fever-track"
          role="progressbar"
          aria-label="Fever"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hud.vibe * 100)}
          aria-valuetext={hud.feverActive ? "FEVER" : ready ? "Ready, press Space" : undefined}
        >
          <i style={fillStyle} />
        </div>
      </div>
      <span className="mb-fever-cap" aria-hidden="true">FEVER</span>
    </div>
  );
}

// The run against the player's best on this chart. With no best the row keeps its height, so the board doesn't jump.
function BestChase({ score, best, running }) {
  if (!best) return <div className="mb-chase mb-chase-none">{running ? "No best on this chart yet" : ""}</div>;
  const ahead = score > best.score;
  const share = best.score > 0 ? Math.min(1, score / best.score) : 1;
  return (
    <div className={`mb-chase${ahead ? " mb-chase-ahead" : ""}`}>
      <div className="mb-chase-row">
        <span className="mb-label">{ahead ? "New best" : "Best"}</span>
        <b>{formatScore(best.score)} <span className={gradeClass(best.grade)}>{best.grade}</span></b>
        <span className="mb-chase-gap">{`${ahead ? "+" : "−"}${formatScore(Math.abs(score - best.score))}`}</span>
      </div>
      <div className="mb-chase-bar" aria-hidden="true"><i style={{ transform: `scaleX(${share})` }} /></div>
    </div>
  );
}

// The numbers of the scoreboard panel. Nothing judged yet means nothing lost yet: accuracy starts at 100% and settles
// from there, while the grade waits for the first note.
export default function GameHud({ hud }) {
  const played = hud.judged > 0;
  const accuracy = hud.accuracy ?? 100;
  const ladder = gradeLadder(accuracy);
  const grade = played ? hud.grade : null;
  const note = !played ? null : ladder.next ? `${ladder.next.gap.toFixed(2)}% to ${ladder.next.grade}` : `${ladder.cushion.toFixed(2)}% above A`;
  const missed = hud.counts.miss;
  return (
    <section className="mb-card mb-hud" aria-label="Score">
      <div className="mb-hud-top">
        <div className="mb-hud-main">
          <span className="mb-label">Score</span>
          <div className="mb-hud-score">{formatScore(hud.score)}</div>
        </div>
        <b className={`mb-hud-grade ${grade ? `mb-grade-${grade}` : "mb-hud-grade-empty"}`} key={grade ?? "none"} aria-label={`Grade ${grade ?? "none yet"}`}>{grade ?? "–"}</b>
      </div>
      <div className="mb-ladder">
        <div className="mb-ladder-head">
          <b>{formatAccuracy(accuracy)}</b>
          {note ? <small>{note}</small> : null}
        </div>
        <div className="mb-ladder-steps" aria-hidden="true">
          {ladder.steps.map((step) => {
            const fill = played ? step.fill : 0;
            return (
              <div key={step.grade} className={`mb-ladder-step mb-grade-${step.grade}${fill > 0 ? " mb-ladder-on" : ""}`}>
                <div className="mb-ladder-cell"><i style={{ transform: `scaleX(${fill})` }} /></div>
                <span>{step.grade}</span>
              </div>
            );
          })}
        </div>
      </div>
      <dl className="mb-hud-tally">
        <div className={missed > 0 ? "mb-tally-miss" : undefined}>
          <dt>Missed</dt>
          <dd key={missed}>{missed}</dd>
        </div>
        <div>
          <dt>Max combo</dt>
          <dd>{hud.maxCombo}</dd>
        </div>
        <div>
          <dt>Notes left</dt>
          <dd>{hud.total > 0 ? Math.max(0, hud.total - hud.judged) : "--"}</dd>
        </div>
      </dl>
      <BestChase score={hud.score} best={hud.best} running={hud.total > 0} />
    </section>
  );
}
