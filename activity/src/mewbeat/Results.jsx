import { useEffect, useMemo, useState } from "react";
import { MIN_TAPS } from "./calibration.js";
import { formatAccuracy, formatScore } from "./GameHud.jsx";
import Mewbit, { usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import { formatOffset } from "./SettingsPanel.jsx";
import { resolveArtworkUrl } from "./SongSelect.jsx";

const JUDGEMENTS = [
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

const BUBBLES = {
  S: "S rank?! you're cracked!!",
  A: "great run!",
  B: "nice one~",
  C: "not bad!",
  D: "nyoo… next time!",
};
const NEW_BEST_BUBBLE = "NEW BEST!! ✦";

const COUNT_UP_MS = 1200;
const TOP_ROWS = 5;
// The offset slider's range and step (SettingsPanel.jsx).
const OFFSET_MIN = -300;
const OFFSET_MAX = 700;
const OFFSET_STEP = 5;
// A run needs this many hits before its average says anything (as runTimingOf in calibration.js).
const MIN_HITS = 8;
// The histogram spans the widest hit window (good, 110 ms) in 10 ms bins, so the middle bin is "on time".
const HIST_BINS = 23;
const HIST_BIN_MS = 10;
const HIST_HALF_MS = (HIST_BINS * HIST_BIN_MS) / 2;

function capitalize(text) {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

// Mewbit's reaction to the run.
function resultPose(grade, newBest) {
  if (newBest) return "newbest";
  if (grade === "S" || grade === "A") return "cheer";
  if (grade === "B" || grade === "C") return "okay";
  return "sad";
}

function gradeKey(grade) {
  return ["S", "A", "B", "C"].includes(grade) ? grade : "D";
}

// The shown score climbs to its final value; with motion off it is there from the first paint.
function useCountUp(target, animate) {
  const [value, setValue] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / COUNT_UP_MS);
      setValue(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [target, animate]);
  return value;
}

// Mean head-hit error and the offset that would centre it. The error is positive when late in heard time, so
// hearing the song later (a larger offset) is what brings it back: new offset = offset + mean error.
function timingOf(summary) {
  const errors = summary.hitErrors ?? [];
  if (errors.length < MIN_HITS) return null;
  const mean = Math.round(errors.reduce((sum, error) => sum + error, 0) / errors.length);
  const snapped = Math.round(((summary.offsetMs ?? 0) + mean) / OFFSET_STEP) * OFFSET_STEP;
  return { mean, target: Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, snapped)) };
}

function histogramOf(errors) {
  const bins = new Array(HIST_BINS).fill(0);
  for (const error of errors) {
    const index = Math.floor((Math.max(-HIST_HALF_MS, Math.min(HIST_HALF_MS - 1, error)) + HIST_HALF_MS) / HIST_BIN_MS);
    bins[index] += 1;
  }
  return bins;
}

function timingTip(mean) {
  if (Math.abs(mean) <= 5) return "Right on the beat on average. Nothing to change.";
  const side = mean > 0 ? "late" : "early";
  if (Math.abs(mean) < 15) return `You hit slightly ${side} on average, well within range.`;
  return `You hit ${side} on average. A new offset would centre your hits.`;
}

// Why a score was not ranked. The reply only says that it was not; autoplay and skipped parts are known here.
function unrankedReason(summary) {
  if (summary.autoplay) return "Autoplay runs aren't ranked.";
  if (summary.difficultyChanged) return "The difficulty changed during the run.";
  if (summary.skipped > 0) return "Part of the song was skipped.";
  return "Too little of the song was played to rank.";
}

// After the calibration clicks: what the taps say the offset should be.
function CalibrationResult({ timing, savedOffset, onApplyOffset }) {
  if (!timing || timing.offsetMs === null) {
    return (
      <p className="mb-res-note" role="status">
        Only {timing?.taps ?? 0}/{MIN_TAPS} taps landed near a click. Play the clicks again and tap each one as you hear it.
      </p>
    );
  }
  const applied = timing.offsetMs === savedOffset;
  return (
    <div className="mb-res-card mb-res-calib" role="status">
      <p className="mb-res-note">
        Your {timing.taps} taps suggest <b>{formatOffset(timing.offsetMs)}</b> (spread ±{timing.spreadMs} ms). Saved: {formatOffset(savedOffset)}.
      </p>
      <button type="button" className="mb-btn" disabled={applied} onClick={() => onApplyOffset?.(timing.offsetMs)}>
        {applied ? "Applied" : "Apply offset"}
      </button>
    </div>
  );
}

function RankLine({ submit, summary }) {
  // Never sent: the run mixes two charts, which the server cannot score.
  if (summary.difficultyChanged) {
    return (
      <span className="mb-res-unranked" role="status">
        <b>Unranked · difficulty changed</b>
        <small>Changing difficulty mid-song keeps your score here, but it isn't saved.</small>
      </span>
    );
  }
  if (submit.status === "submitting") return <span className="mb-res-quiet" role="status">Saving score…</span>;
  if (submit.status === "error") return <span className="mb-res-quiet" role="status">Score not saved</span>;
  if (submit.status !== "ok") return summary.calibration ? <span className="mb-res-quiet">Calibration run</span> : null;
  const { result } = submit;
  if (!result.ranked) {
    return (
      <span className="mb-res-unranked" role="status">
        <b>Unranked</b>
        <small>{unrankedReason(summary)}</small>
      </span>
    );
  }
  const parts = [];
  if (Number.isFinite(result.rank?.server)) parts.push(`#${result.rank.server} server`);
  if (Number.isFinite(result.rank?.global)) parts.push(`#${result.rank.global} global`);
  return parts.length ? <span className="mb-res-rank" role="status"><b>{parts.join(" · ")}</b></span> : null;
}

function Avatar({ name, url }) {
  const initials = String(name ?? "?").slice(0, 2).toUpperCase();
  const src = resolveArtworkUrl(url);
  return src ? <img className="mb-res-av" src={src} alt="" draggable="false" /> : <span className="mb-res-av mb-res-av-text" aria-hidden="true">{initials}</span>;
}

// A room's standings after the round (only given in rooms): one row per player, with who is ready for the next round.
function Standings({ rows }) {
  return (
    <section className="mb-res-standings" aria-label="Standings">
      <h3>Standings <small>{rows.length} {rows.length === 1 ? "player" : "players"}</small></h3>
      <ol>
        {rows.map((row, index) => (
          <li key={row.userId ?? index} className={row.me ? "mb-res-me" : undefined}>
            <span className="mb-res-pos">{index + 1}</span>
            <Avatar name={row.username} url={row.avatarUrl} />
            <span className="mb-res-who">
              <b>{row.username}{row.me ? <span className="mb-res-you">YOU</span> : null}</b>
              <small>{[capitalize(row.difficulty), Number.isFinite(row.accuracy) ? formatAccuracy(row.accuracy) : null].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="mb-res-score">
              <b>{formatScore(row.score ?? 0)}</b>
              <span className={`mb-ss-grade-${gradeKey(row.grade)}`}>{row.grade ?? ""}</span>
              {"next" in row ? <span className={`mb-res-vote${row.next ? "" : " mb-res-vote-no"}`}> · {row.next ? "next ✓" : "…"}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ServerBest({ entries, meId, difficulty }) {
  return (
    <section className="mb-res-board" aria-label="Server best">
      <span className="mb-res-label">Server best{difficulty ? ` · ${capitalize(difficulty)}` : ""}</span>
      <ol>
        {entries.slice(0, TOP_ROWS).map((entry, index) => (
          <li key={entry.userId ?? index} className={entry.userId === meId ? "mb-res-me" : undefined}>
            <span className="mb-res-pos">{index + 1}</span>
            <span className="mb-res-name">{entry.username}</span>
            <span className="mb-res-value">{formatScore(entry.score)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Results of the run that just ended. The local numbers come from the run itself and show at once; the
// server's reply (rank, best, top list) fills in when it arrives. Rooms pass standings and onNext (Task 10).
export default function Results({
  summary,
  mode = "live",
  phase,
  effects = "full",
  active = true,
  queued = false,
  upNext = null,
  standings = null,
  timing = null,
  savedOffset = 0,
  onApplyOffset,
  onBack,
  onSongSelect,
  onNext = null,
  nextLabel = "Next round",
  nextCount = null,
}) {
  const prefersReduced = usePrefersReducedMotion();
  const submit = summary.submit ?? { status: "skipped" };
  const result = submit.status === "ok" ? submit.result : null;
  const newBest = Boolean(result?.newBest);
  const shownScore = useCountUp(summary.score, effects !== "off" && !prefersReduced);
  const shownTiming = useMemo(() => timingOf(summary), [summary]);
  const bins = useMemo(() => histogramOf(summary.hitErrors ?? []), [summary]);
  const peak = Math.max(1, ...bins);
  const meId = result?.best?.userId ?? null;
  const topList = result?.serverTop ?? [];
  const showSide = Boolean(standings?.length) || topList.length > 0;
  const grade = gradeKey(summary.grade);
  const note = PHASE_NOTES[phase] ?? (queued ? "Waiting for the next track…" : null);
  const cover = resolveArtworkUrl(summary.artworkUrl);

  // Primary action: what Enter does. A room's next round, else leaving for the next thing to play.
  const primary = onNext ? "next" : mode === "solo" ? "songs" : "back";
  const runPrimary = () => {
    if (primary === "next") onNext();
    else if (primary === "songs") onSongSelect?.();
    else onBack?.();
  };
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Enter" || event.repeat) return;
      // A focused button or field takes Enter itself.
      if (event.target instanceof HTMLElement && ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(event.target.tagName)) return;
      event.preventDefault();
      runPrimary();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const previous = result?.best && !newBest ? result.best : null;
  const canAdjust = shownTiming && !summary.autoplay && !summary.calibration && !(Math.abs(shownTiming.mean) <= 5 && shownTiming.target === savedOffset);
  const adjusted = shownTiming?.target === savedOffset;

  return (
    <section className={`mb-res${showSide ? " mb-res-has-side" : ""}`} aria-label="Run results">
      <div className="mb-res-main">
        <div className="mb-res-head">
          {cover ? <img className="mb-res-cover" src={cover} alt="" draggable="false" /> : <div className="mb-res-cover mb-res-cover-empty" aria-hidden="true" />}
          <div className="mb-res-title">
            <span className="mb-res-label">{`${summary.calibration ? "Calibration" : "Run complete"}${summary.difficulty ? ` · ${capitalize(summary.difficulty)}` : ""}`}</span>
            <h2>{summary.title ?? "Run complete"}</h2>
            {summary.artist ? <small>{summary.artist}</small> : null}
          </div>
          <div className="mb-res-ranked"><RankLine submit={submit} summary={summary} /></div>
        </div>

        <div className="mb-res-body">
          <div className="mb-res-cards">
            <div className="mb-res-card mb-res-mine">
              <div className={`mb-grade mb-grade-${grade} mb-res-grade`} aria-label={`Grade ${summary.grade ?? "none"}`}>{summary.grade ?? "-"}</div>
              <div className="mb-res-numbers">
                <div className="mb-res-scoreline">
                  <b aria-label={`${formatScore(summary.score)} points`}>{formatScore(shownScore)}</b>
                  {newBest ? <span className="mb-res-newbest">NEW BEST</span> : null}
                  {previous ? <span className="mb-res-label">Best {formatScore(previous.score)}</span> : null}
                </div>
                <dl className="mb-res-stats">
                  <div><dt className="mb-res-label">Accuracy</dt><dd>{formatAccuracy(summary.accuracy)}</dd></div>
                  <div><dt className="mb-res-label">Max combo</dt><dd>{summary.maxCombo}</dd></div>
                  <div><dt className="mb-res-label">Fevers</dt><dd>{summary.fevers}</dd></div>
                  <div><dt className="mb-res-label">Avg offset</dt><dd>{shownTiming ? formatOffset(shownTiming.mean) : "--"}</dd></div>
                </dl>
                <ul className="mb-res-judges">
                  {JUDGEMENTS.map(([key, label]) => (
                    <li key={key} className={`mb-j-${key}`}><span>{label}</span>{summary.counts[key]}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mb-res-card mb-res-timing">
              <div className="mb-res-histwrap">
                <span className="mb-res-label">Hit timing</span>
                <div className="mb-res-hist" role="img" aria-label={shownTiming ? `Hit timing, average ${formatOffset(shownTiming.mean)}` : "Hit timing"}>
                  {bins.map((count, index) => (
                    <i key={index} style={{ height: `${count ? Math.max(6, Math.round((count / peak) * 100)) : 2}%` }} />
                  ))}
                </div>
                <div className="mb-res-axis mb-res-label"><span>early −{HIST_HALF_MS}</span><span>0</span><span>late +{HIST_HALF_MS}</span></div>
              </div>
              <div className="mb-res-tip">
                {shownTiming ? (
                  <>
                    <b>{formatOffset(shownTiming.mean)}</b>
                    <p>{timingTip(shownTiming.mean)}</p>
                    {canAdjust ? (
                      <button type="button" className="mb-btn" disabled={adjusted} onClick={() => onApplyOffset?.(shownTiming.target)}>
                        {adjusted ? `Offset ${formatOffset(shownTiming.target)}` : "Adjust offset"}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p>Not enough hits to tell your timing.</p>
                )}
              </div>
            </div>

            {summary.calibration ? <CalibrationResult timing={timing} savedOffset={savedOffset} onApplyOffset={onApplyOffset} /> : null}
          </div>

          <div className="mb-res-stage">
            <div className="mb-res-spot" aria-hidden="true" />
            <div className="mb-res-mew">
              <Mewbit pose={resultPose(summary.grade, newBest)} effects={effects} />
              <div className="mb-res-bubble" aria-hidden="true">{newBest ? NEW_BEST_BUBBLE : BUBBLES[grade]}</div>
            </div>
          </div>
        </div>

        <div className="mb-res-footer">
          {note ? <p className="mb-res-note" role="status">{note}</p> : null}
          {mode !== "solo" && upNext?.title ? (
            <p className="mb-res-next">Up next: <b>{upNext.title}</b>{upNext.ready ? " · chart ready" : ""}</p>
          ) : null}
          <div className="mb-res-actions">
            {mode === "solo" ? null : <button type="button" className={`mb-btn${primary === "back" ? " mb-btn-primary" : ""}`} onClick={onBack}>Back{primary === "back" ? <> <kbd className="mb-kbd">Enter</kbd></> : null}</button>}
            {mode === "solo" || onSongSelect ? <button type="button" className={`mb-btn${primary === "songs" ? " mb-btn-primary" : ""}`} onClick={onSongSelect}>Song select{primary === "songs" ? <> <kbd className="mb-kbd">Enter</kbd></> : null}</button> : null}
            {onNext ? (
              <button type="button" className="mb-btn mb-btn-primary" onClick={onNext}>
                {nextLabel} {nextCount ? <span className="mb-res-count">{nextCount}</span> : null}<kbd className="mb-kbd">Enter</kbd>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {showSide ? (
        <aside className="mb-res-side">
          {standings?.length ? <Standings rows={standings} /> : null}
          {topList.length ? <ServerBest entries={topList} meId={meId} difficulty={summary.difficulty} /> : null}
        </aside>
      ) : null}
    </section>
  );
}
