import { useEffect, useRef, useState } from "react";
import { Notice, useReply } from "./PlayerPanel.jsx";
import { formatAgo, formatPercent } from "./playerFormat.js";
import { DIFFICULTIES, gradeClass } from "./SongSelect.jsx";

export const REPORT_MIN = 10; // same limits as the server's report check
export const REPORT_MAX = 1000;
const TYPES = [
  { value: "bug", label: "Bug" },
  { value: "map", label: "Map" },
  { value: "idea", label: "Idea" },
];

const PLACEHOLDERS = {
  bug: "What you did, what happened, and what you expected.",
  map: "What sounds or looks off, and roughly when in the song.",
  idea: "Describe your idea.",
};
const LABELS = { bug: "What went wrong?", map: "What is wrong with the map?", idea: "What would you like to see?" };

const runKey = (run) => `${run.audioKey}|${run.difficulty}|${run.at}`;
const levelLabel = (id) => DIFFICULTIES.find((level) => level.id === id)?.label ?? id ?? "";

// The player's recent runs as a single choice: the song and level, when it was played and how it went. Nothing is picked
// until the player picks it. The bot sends them newest first.
function RunPicker({ state, retry, picked, onPick }) {
  if (state.status !== "ready") {
    return <Notice state={state} retry={retry} loading="Loading your recent runs…" failed="Couldn't load your recent runs." />;
  }
  const runs = state.reply.runs ?? [];
  if (!runs.length) return <div className="mb-ss-empty" role="status"><span>Play a song first, then it shows up here.</span></div>;
  return (
    <div className="mb-report-runs" role="radiogroup" aria-label="Which song?">
      {runs.map((run) => {
        const key = runKey(run);
        return (
          <label key={key} className="mb-report-run">
            <input type="radio" name="mb-report-run" checked={picked === key} onChange={() => onPick(key)} />
            <span className="mb-report-run-row">
              <span className="mb-report-run-main">
                <b>{run.title || "Unknown song"}</b>
                <small>{run.artist || "Unknown artist"}</small>
              </span>
              <span className="mb-report-run-meta">
                <span className={gradeClass(run.grade)}>{run.grade ?? "—"}</span>
                <small>{levelLabel(run.difficulty)} · {Number.isFinite(run.accuracy) ? `${formatPercent(run.accuracy, 2)} · ` : ""}{formatAgo(run.at)}</small>
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// What sits under the text field: what is still missing, then what goes along with the report.
function helpText(type, run, length) {
  if (type === "map" && !run) return "Pick the run this is about.";
  if (length < REPORT_MIN) return `At least ${REPORT_MIN} characters.`;
  return type === "map" ? "The song, level and result of that run go along with it." : "The mode, song and level go along with it.";
}

// The "Report a bug" window: a type, a description and Send. `onSend({ type, text, run })` resolves true when the report
// went out, and false when it did not (the app has already shown the reason as a toast); the text stays for another try.
// Where in the game the player was (mode, song, level) is added by whoever sends. A map report instead names one of the
// player's recent runs (`run` is { audioKey, difficulty, at }; the bot looks up everything else), which `request` fetches
// the first time Map is chosen.
export default function ReportPanel({ onSend, onClose, request }) {
  const [type, setType] = useState("bug");
  const [mapChosen, setMapChosen] = useState(false);
  const [picked, setPicked] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const textRef = useRef(null);
  const aliveRef = useRef(true);
  const length = text.trim().length;
  const [runs, retryRuns] = useReply(request, "mewbeat_report_runs", mapChosen ? {} : null);
  const run = type === "map" ? runs.reply?.runs?.find((candidate) => runKey(candidate) === picked) : null;
  const valid = length >= REPORT_MIN && length <= REPORT_MAX && (type !== "map" || Boolean(run));

  useEffect(() => {
    aliveRef.current = true;
    textRef.current?.focus();
    return () => { aliveRef.current = false; };
  }, []);

  // Escape closes the panel wherever focus is. It is a plain bubble listener on window, as in the settings panel, and the
  // session's own Esc handlers stand aside while this is open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setFailed(false);
    const sent = await onSend({ type, text: text.trim(), ...(run ? { run: { audioKey: run.audioKey, difficulty: run.difficulty, at: run.at } } : null) });
    if (!aliveRef.current) return; // closed while it was on its way
    setSending(false);
    if (sent === false) setFailed(true);
    else onClose();
  };

  return (
    <div className="mb-settings-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget && !text.trim()) onClose(); }}>
      <form
        className="mb-settings mb-report"
        role="dialog"
        aria-label="Report a bug"
        onSubmit={(event) => { event.preventDefault(); send(); }}
      >
        <div className="mb-settings-head">
          <h2 className="mb-settings-title">Report a bug</h2>
        </div>
        <div className="mb-report-body">
          <div className="mb-segmented mb-segmented-fill" role="group" aria-label="Type">
            {TYPES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`mb-btn mb-seg${value === type ? " mb-toggle-on" : ""}`}
                aria-pressed={value === type}
                onClick={() => { setType(value); if (value === "map") setMapChosen(true); }}
              >
                {label}
              </button>
            ))}
          </div>
          {type === "map" ? (
            <div className="mb-report-field">
              <span className="mb-row-label">Which song?</span>
              <RunPicker state={runs} retry={retryRuns} picked={picked} onPick={setPicked} />
            </div>
          ) : null}
          <label className="mb-report-field">
            <span className="mb-row-label">{LABELS[type]}</span>
            <textarea
              ref={textRef}
              className="mb-report-text"
              value={text}
              maxLength={REPORT_MAX}
              rows={6}
              placeholder={PLACEHOLDERS[type]}
              onChange={(event) => { setText(event.target.value); setFailed(false); }}
            />
          </label>
          <div className="mb-row-foot">
            <p className="mb-row-help">{helpText(type, run, length)}</p>
            <span className="mb-report-count" aria-live="off">{length} / {REPORT_MAX}</span>
          </div>
          {failed ? <p className="mb-field-error" role="alert">Couldn't send that. Your text is still here.</p> : null}
        </div>
        <div className="mb-report-actions">
          <button type="button" className="mb-btn" onClick={onClose}>Cancel <kbd className="mb-kbd">Esc</kbd></button>
          <button type="submit" className="mb-btn mb-btn-primary" disabled={!valid || sending}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
