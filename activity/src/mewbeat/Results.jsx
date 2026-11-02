import { ArrowCounterClockwise, ArrowLeft, ArrowRight, MusicNotesSimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const COUNT_UP_MS = 1400;
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

// The screen fills in one thing at a time and ends on the grade; ms after it opens.
const REVEAL = { score: 300, accuracy: 1700, combo: 2300, fevers: 2900, offset: 3300, judges: 3700, timing: 4700, side: 5000, grade: 5400, verdict: 5900 };
// The steps that pluck as they appear, climbing a major scale (semitones up from the first), and the grade's own sound.
const TALLY_STEPS = ["score", "accuracy", "combo", "fevers", "offset", "judges", "timing"];
const TALLY_SEMITONES = [0, 2, 4, 5, 7, 9, 12];
const TALLY_LEVEL = 0.7;
const GRADE_SOUNDS = { S: "grade-high", A: "grade-high", B: "grade-mid", C: "grade-mid", D: "grade-low" };
const STAT_COUNT_MS = 650;
const JUDGE_COUNT_MS = 420;
const JUDGE_STEP_MS = 180;

// How far the screen has got, in REVEAL's terms. With motion off everything is there from the first paint.
function useRevealClock(animate) {
  const [reached, setReached] = useState(animate ? -1 : Infinity);
  useEffect(() => {
    if (!animate) {
      setReached(Infinity);
      return undefined;
    }
    const timers = Object.values(REVEAL).map((ms) => window.setTimeout(() => setReached((now) => Math.max(now, ms)), ms));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [animate]);
  return reached;
}

// A number holds at zero until its turn, then climbs to its final value.
function useCountUp(target, started, animate, duration, delay = 0) {
  const [value, setValue] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setValue(target);
      return undefined;
    }
    if (!started) return undefined;
    const start = performance.now() + delay;
    let raf = 0;
    const step = (now) => {
      // A frame timestamp can predate performance.now() taken in the effect: never a negative first score.
      const k = Math.max(0, Math.min(1, (now - start) / duration));
      setValue(target * (1 - (1 - k) ** 3));
      if (k < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [target, started, animate, duration, delay]);
  return value;
}

function CountUp({ value, started, animate, duration = STAT_COUNT_MS, delay = 0, format = Math.round }) {
  const current = useCountUp(value ?? 0, started, animate, duration, delay);
  return format(value == null ? value : current); // no accuracy to climb to reads "--"
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
    <div className="mb-res-card mb-res-calib mb-res-in" role="status">
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

// One player's line, shared by the room's standings and the server's best list. vote: they are ready for the next round.
function PlayerRow({ position, me, name, avatarUrl, sub, score, grade, vote, style }) {
  return (
    <li className={me ? "mb-res-me" : undefined} style={style}>
      <span className="mb-res-pos">{position}</span>
      <Avatar name={name} url={avatarUrl} />
      <span className="mb-res-who">
        <b>{name}{me ? <span className="mb-res-you">YOU</span> : null}</b>
        <small>{sub}</small>
      </span>
      <span className="mb-res-score">
        <b>{formatScore(score ?? 0)}</b>
        <span className={`mb-ss-grade-${gradeKey(grade)}`}>{grade ?? ""}</span>
        {vote ? <span className="mb-res-vote"> · next ✓</span> : null}
      </span>
    </li>
  );
}

// A room's standings after the round (only given in rooms): one row per player, with who is ready for the next round.
function Standings({ rows }) {
  return (
    <section className="mb-res-standings" aria-label="Standings">
      <h3>Standings <small>{rows.length} {rows.length === 1 ? "player" : "players"}</small></h3>
      <ol>
        {rows.map((row, index) => (
          <PlayerRow
            key={row.userId ?? index}
            position={index + 1}
            me={row.me}
            name={row.username}
            avatarUrl={row.avatarUrl}
            sub={[capitalize(row.difficulty), Number.isFinite(row.accuracy) ? formatAccuracy(row.accuracy) : null].filter(Boolean).join(" · ")}
            score={row.score}
            grade={row.grade}
            vote={Boolean(row.next)}
          />
        ))}
      </ol>
    </section>
  );
}

function ServerBest({ entries, meId, difficulty }) {
  return (
    <section className="mb-res-board" aria-label="Server best">
      <h3>Server best <small>{difficulty ? capitalize(difficulty) : ""}</small></h3>
      {entries.length ? (
        <ol>
          {entries.slice(0, TOP_ROWS).map((entry, index) => (
            <PlayerRow
              key={entry.userId ?? index}
              position={index + 1}
              me={entry.userId === meId}
              name={entry.username}
              avatarUrl={entry.avatarUrl}
              sub={[Number.isFinite(entry.accuracy) ? formatAccuracy(entry.accuracy) : null, entry.maxCombo > 0 ? `${entry.maxCombo} combo` : null].filter(Boolean).join(" · ")}
              score={entry.score}
              grade={entry.grade}
              style={{ "--i": index }}
            />
          ))}
        </ol>
      ) : (
        <p className="mb-res-empty">Nobody's on the board yet. Be the first.</p>
      )}
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
  onRestart,
  onNext = null,
  nextLabel = "Next round",
  nextCount = null,
  onSound = null,
}) {
  const prefersReduced = usePrefersReducedMotion();
  const submit = summary.submit ?? { status: "skipped" };
  const result = submit.status === "ok" ? submit.result : null;
  const newBest = Boolean(result?.newBest);
  // A click anywhere skips to the end of the reveal.
  const [skipped, setSkipped] = useState(false);
  const animate = effects !== "off" && !prefersReduced && !skipped;
  const reached = useRevealClock(animate);
  const shown = (step) => reached >= REVEAL[step];
  const verdict = shown("verdict");
  const shownTiming = useMemo(() => timingOf(summary), [summary]);
  const bins = useMemo(() => histogramOf(summary.hitErrors ?? []), [summary]);
  const peak = Math.max(1, ...bins);
  const meId = result?.best?.userId ?? null;
  const topList = result?.serverTop ?? [];
  // A ranked-mode reply with an empty board still gets the panel, so the empty state reads as intended.
  const boardEmpty = topList.length === 0 && Boolean(result) && !standings?.length && !summary.calibration;
  const showSide = Boolean(standings?.length) || topList.length > 0 || boardEmpty;
  const grade = gradeKey(summary.grade);
  // A skip, or motion turned off, goes straight to the grade.
  const tallied = useRef(0);
  const graded = useRef(false);
  useEffect(() => {
    if (!onSound || summary.calibration || graded.current) return;
    if (reached >= REVEAL.grade) {
      graded.current = true;
      onSound(GRADE_SOUNDS[grade]);
      return;
    }
    const step = tallied.current;
    if (step < TALLY_STEPS.length && reached >= REVEAL[TALLY_STEPS[step]]) {
      tallied.current = step + 1;
      onSound("tally", { level: TALLY_LEVEL, rate: 2 ** (TALLY_SEMITONES[step] / 12) });
    }
  }, [reached, grade, onSound, summary.calibration]);
  // Only Live follows what the bot plays; Solo and rooms move on by themselves.
  const note = mode === "live" ? PHASE_NOTES[phase] ?? (queued ? "Waiting for the next track…" : null) : null;
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
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Enter") {
        // A focused button or field takes Enter itself.
        if (target && ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(target.tagName)) return;
        event.preventDefault();
        runPrimary();
      } else if (onRestart && (event.key === "r" || event.key === "R")) {
        // Buttons don't use R, so only typing blocks it.
        if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
        event.preventDefault();
        onRestart();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const previous = result?.best && !newBest ? result.best : null;
  const canAdjust = shownTiming && !summary.autoplay && !summary.calibration && !(Math.abs(shownTiming.mean) <= 5 && shownTiming.target === savedOffset);
  const adjusted = shownTiming?.target === savedOffset;

  return (
    <section className={`mb-res${showSide ? " mb-res-has-side" : ""}`} aria-label="Run results" onClick={verdict ? undefined : () => setSkipped(true)}>
      {/* The cover, blurred far behind everything; the shade keeps the text readable. */}
      {cover ? <div className="mb-res-backdrop" aria-hidden="true"><img src={cover} alt="" draggable="false" /></div> : null}
      <div className="mb-res-main">
        <div className="mb-res-head mb-res-in">
          {cover ? <img className="mb-res-cover" src={cover} alt="" draggable="false" /> : <div className="mb-res-cover mb-res-cover-empty" aria-hidden="true" />}
          <div className="mb-res-title">
            <span className="mb-res-label">{`${summary.calibration ? "Calibration" : "Run complete"}${summary.difficulty ? ` · ${capitalize(summary.difficulty)}` : ""}`}</span>
            <h2>{summary.title ?? "Run complete"}</h2>
            {summary.artist ? <small>{summary.artist}</small> : null}
          </div>
          <div className="mb-res-ranked">{verdict ? <RankLine submit={submit} summary={summary} /> : null}</div>
        </div>

        <div className="mb-res-body">
          <div className="mb-res-cards">
            <div className="mb-res-card mb-res-mine mb-res-in" style={{ "--d": "80ms" }}>
              <div className={`mb-grade mb-grade-${grade} mb-res-grade${shown("grade") ? "" : " mb-res-wait"}`} aria-label={`Grade ${summary.grade ?? "none"}`}>{summary.grade ?? "-"}</div>
              <div className="mb-res-numbers">
                <div className="mb-res-scoreline">
                  <b aria-label={`${formatScore(summary.score)} points`}>
                    <CountUp value={summary.score} started={shown("score")} animate={animate} duration={COUNT_UP_MS} format={(value) => formatScore(Math.round(value))} />
                  </b>
                  {newBest && verdict ? <span className="mb-res-newbest">NEW BEST</span> : null}
                  {previous && shown("accuracy") ? <span className="mb-res-label mb-res-in">Best {formatScore(previous.score)}</span> : null}
                </div>
                <dl className="mb-res-stats">
                  <div><dt className="mb-res-label">Accuracy</dt><dd aria-label={formatAccuracy(summary.accuracy)}><CountUp value={summary.accuracy} started={shown("accuracy")} animate={animate} format={formatAccuracy} /></dd></div>
                  <div><dt className="mb-res-label">Max combo</dt><dd aria-label={String(summary.maxCombo)}><CountUp value={summary.maxCombo} started={shown("combo")} animate={animate} /></dd></div>
                  <div><dt className="mb-res-label">Fevers</dt><dd aria-label={String(summary.fevers)}><CountUp value={summary.fevers} started={shown("fevers")} animate={animate} duration={300} /></dd></div>
                  <div><dt className="mb-res-label">Avg offset</dt><dd className={shown("offset") ? "mb-res-in" : "mb-res-wait"}>{shownTiming ? formatOffset(shownTiming.mean) : "--"}</dd></div>
                </dl>
                <ul className="mb-res-judges">
                  {JUDGEMENTS.map(([key, label], index) => (
                    <li key={key} className={`mb-j-${key}${shown("judges") ? "" : " mb-res-wait"}`} style={{ "--i": index }} aria-label={`${label} ${summary.counts[key]}`}>
                      <span>{label}</span><CountUp value={summary.counts[key]} started={shown("judges")} animate={animate} duration={JUDGE_COUNT_MS} delay={index * JUDGE_STEP_MS} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className={`mb-res-card mb-res-timing ${shown("timing") ? "mb-res-in" : "mb-res-wait"}`}>
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

            {summary.calibration && shown("timing") ? <CalibrationResult timing={timing} savedOffset={savedOffset} onApplyOffset={onApplyOffset} /> : null}
          </div>

          <div className="mb-res-stage">
            <div className="mb-res-spot" aria-hidden="true" />
            <div className="mb-res-mew">
              {/* Mewbit waits with everyone else and reacts only once the grade is out. */}
              <Mewbit pose={verdict ? resultPose(summary.grade, newBest) : "hype"} effects={effects} />
              {verdict ? <div className="mb-res-bubble" aria-hidden="true">{newBest ? NEW_BEST_BUBBLE : BUBBLES[grade]}</div> : null}
            </div>
          </div>
        </div>

        <div className="mb-res-footer mb-res-in" style={{ "--d": "200ms" }}>
          {note ? <p className="mb-res-note" role="status">{note}</p> : null}
          {mode !== "solo" && upNext?.title ? (
            <p className="mb-res-next">Up next: <b>{upNext.title}</b>{upNext.ready ? " · chart ready" : ""}</p>
          ) : null}
          <div className="mb-res-actions">
            {onRestart ? (
              <button type="button" className="mb-btn" onClick={onRestart}>
                <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />Restart <kbd className="mb-kbd">R</kbd>
              </button>
            ) : null}
            {mode === "solo" ? null : (
              <button type="button" className={`mb-btn${primary === "back" ? " mb-btn-primary" : ""}`} onClick={onBack}>
                <ArrowLeft size={16} weight="bold" aria-hidden="true" />Back{primary === "back" ? <> <kbd className="mb-kbd">Enter</kbd></> : null}
              </button>
            )}
            {mode === "solo" || onSongSelect ? (
              <button type="button" className={`mb-btn${primary === "songs" ? " mb-btn-primary" : ""}`} onClick={onSongSelect}>
                <MusicNotesSimple size={16} weight="bold" aria-hidden="true" />Song select{primary === "songs" ? <> <kbd className="mb-kbd">Enter</kbd></> : null}
              </button>
            ) : null}
            {onNext ? (
              <button type="button" className="mb-btn mb-btn-primary" onClick={onNext}>
                {nextLabel} {nextCount ? <span className="mb-res-count">{nextCount}</span> : null}<ArrowRight size={16} weight="bold" aria-hidden="true" /><kbd className="mb-kbd">Enter</kbd>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {showSide ? (
        <aside className="mb-res-side">
          {standings?.length && shown("side") ? <Standings rows={standings} /> : null}
          {(topList.length || boardEmpty) && shown("side") ? <ServerBest entries={topList} meId={meId} difficulty={summary.difficulty} /> : null}
        </aside>
      ) : null}
    </section>
  );
}
