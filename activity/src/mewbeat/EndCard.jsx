import { formatAccuracy, formatScore } from "./GameHud.jsx";

const ROWS = [
  ["perfect", "Perfect"],
  ["great", "Great"],
  ["good", "Good"],
  ["miss", "Miss"],
];

const PHASE_NOTES = {
  charting: "Charting this track…",
  uncharted: "This track can't be charted.",
  failed: "Charting failed. We'll try the next track.",
};

// Results of the run that just ended. It stays up until the next run starts, so what the
// game is waiting for goes in its footer.
export default function EndCard({ summary, phase, queued }) {
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
      </dl>
      <ul className="mb-endcard-counts">
        {ROWS.map(([key, label]) => (
          <li key={key} className={`mb-j-${key}`}>
            <span>{label}</span>
            <b>{summary.counts[key]}</b>
          </li>
        ))}
      </ul>
      {note ? <p className="mb-endcard-note" role="status">{note}</p> : null}
    </div>
  );
}
