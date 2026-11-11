import { useState } from "react";
import { Cover, DIFFICULTIES, describePrepareError } from "./SongSelect.jsx";
import { stripRows, suggestedLevelText } from "./suggestions.js";
import { useSuggestions } from "./useSuggestions.js";

const LEVEL_LABELS = Object.fromEntries(DIFFICULTIES.map(({ id, label }) => [id, label]));
const levelLabelOf = (id) => LEVEL_LABELS[id] ?? id;

// "Suggested next" under the results: a few songs worth playing after this one, each with why. It asks the bot in
// the background and shows nothing until there is something to show, so the results never wait for it (and a bot
// that can't suggest leaves no gap). Picking one runs onSuggest(row): solo starts it, a room adds it to the queue,
// where the room's vote for the next map applies (doneLabel then marks the song as added). Showing the strip starts no charting.
// This is not the room's "Play next" vote button: that one votes on what is already queued.
export default function SuggestedNext({ request, seedKey = null, onSuggest, actionLabel = "Play", doneLabel = null }) {
  const state = useSuggestions({ request, enabled: typeof onSuggest === "function", seedKey });
  const [busy, setBusy] = useState(null); // the audio key being started or added
  const [added, setAdded] = useState(() => new Set());
  const [error, setError] = useState(null);
  const rows = state.status === "ready" ? stripRows(state.reply) : [];
  if (!rows.length) return null;

  const pick = async (row) => {
    if (busy) return;
    setBusy(row.key);
    setError(null);
    try {
      await onSuggest(row);
      if (doneLabel) setAdded((current) => new Set(current).add(row.key));
    } catch (failure) {
      setError(describePrepareError(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-res-suggest" role="group" aria-label="Suggested next">
      <span className="mb-res-label">Suggested next</span>
      <ul className="mb-res-suggest-list">
        {rows.map((row) => {
          const level = suggestedLevelText(row, levelLabelOf);
          const done = added.has(row.key);
          return (
            <li key={row.key}>
              <button
                type="button"
                className={`mb-res-sug${done ? " mb-res-sug-done" : ""}`}
                disabled={Boolean(busy) || done}
                aria-busy={busy === row.key || undefined}
                title={`${actionLabel}: ${row.title}${row.artist ? ` — ${row.artist}` : ""}`}
                onClick={() => pick(row)}
              >
                <Cover row={row} className="mb-res-sug-art" size="small" box={40} />
                <span className="mb-res-sug-text">
                  <b>{row.title}</b>
                  <small>{row.reason || row.artist}</small>
                  {level ? <span className={`mb-res-sug-level mb-ss-d-${row.level}`}>{level}</span> : null}
                </span>
                <span className="mb-res-sug-go">{busy === row.key ? "…" : done ? doneLabel : actionLabel}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mb-ss-error" role="alert">{error}</p> : null}
    </div>
  );
}
