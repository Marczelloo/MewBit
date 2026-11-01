import { MIN_TAPS } from "./calibration.js";
import { formatAccuracy, formatScore } from "./GameHud.jsx";
import { formatOffset } from "./SettingsPanel.jsx";

const ROWS = [
  ["perfect", "Perfect"],
  ["great", "Great"],
  ["good", "Good"],
  ["miss", "Miss"],
];

const PHASE_NOTES = {
  offline: "Reconnecting…",
  idle: "Nothing is playing.",
  charting: "Charting this track…",
  uncharted: "This track can't be charted.",
  failed: "Charting failed. We'll try the next track.",
};

// "12 ms late", "8 ms early" or "On time" for a run's median hit error.
function formatTiming(ms) {
  if (Math.abs(ms) < 5) return "On time";
  return `${Math.abs(ms)} ms ${ms > 0 ? "late" : "early"}`;
}

// After the calibration clicks: what the taps say the offset should be.
function CalibrationResult({ timing, savedOffset, onApplyOffset }) {
  if (!timing || timing.offsetMs === null) {
    return (
      <p className="mb-endcard-note" role="status">
        Only {timing?.taps ?? 0}/{MIN_TAPS} taps landed near a click. Play the clicks again and tap each one as you hear it.
      </p>
    );
  }
  const applied = timing.offsetMs === savedOffset;
  return (
    <div className="mb-endcard-calib" role="status">
      <p className="mb-endcard-note">
        Your {timing.taps} taps suggest <b>{formatOffset(timing.offsetMs)}</b> (spread ±{timing.spreadMs} ms). Saved: {formatOffset(savedOffset)}.
      </p>
      <button type="button" className="mb-btn" disabled={applied} onClick={() => onApplyOffset?.(timing.offsetMs)}>
        {applied ? "Applied" : "Apply offset"}
      </button>
    </div>
  );
}

// Results of the run that just ended. It stays up until the next run starts, so what the
// game is waiting for goes in its footer.
export default function EndCard({ summary, phase, queued, timing = null, savedOffset = 0, onApplyOffset }) {
  const note = PHASE_NOTES[phase] ?? (queued ? "Waiting for the next track…" : null);
  return (
    <div className="mb-endcard" role="group" aria-label="Run results">
      <span className="mb-label">{summary.title ? `${summary.title}${summary.artist ? ` · ${summary.artist}` : ""}` : "Run complete"}</span>
      <div className="mb-endcard-main">
        <div className={`mb-grade mb-grade-${summary.grade ?? "none"}`} aria-label={`Grade ${summary.grade ?? "none"}`}>
          {summary.grade ?? "-"}
        </div>
        <div className="mb-endcard-score">
          <b>{formatScore(summary.score)}</b>
          <span>points</span>
        </div>
      </div>
      <dl className="mb-endcard-stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{formatAccuracy(summary.accuracy)}</dd>
        </div>
        <div>
          <dt>Max combo</dt>
          <dd>{summary.maxCombo}</dd>
        </div>
        <div>
          <dt>Fevers</dt>
          <dd>{summary.fevers}</dd>
        </div>
        {Number.isFinite(summary.timingMs) ? (
          <div>
            <dt>Timing</dt>
            <dd>{formatTiming(summary.timingMs)}</dd>
          </div>
        ) : null}
      </dl>
      <ul className="mb-endcard-counts">
        {ROWS.map(([key, label]) => (
          <li key={key} className={`mb-j-${key}`}>
            <span>{label}</span>
            <b>{summary.counts[key]}</b>
          </li>
        ))}
      </ul>
      {summary.calibration ? <CalibrationResult timing={timing} savedOffset={savedOffset} onApplyOffset={onApplyOffset} /> : null}
      {note ? <p className="mb-endcard-note" role="status">{note}</p> : null}
    </div>
  );
}
