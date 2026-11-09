import { useEffect, useRef, useState } from "react";
import { BLOCK_FALL_LIVE_MS, BLOCK_LISTEN_LIVE_MS, blockError, blockEstimate, nextBlockNote } from "./calibration.js";
import { SOUND_URLS } from "./sfx/index.js";
import { DEFAULT_VOLUME, gainOf } from "./sounds.js";
import { DEFAULT_SETTINGS } from "./useMewbeatGame.js";

const FALL_MS = 1500; // the Activity's block, from the top of the lane to the line
const LINE_AT = 0.8; // the line's place in the lane
const LISTEN_MS = 700; // how long after the later of block and click a press still counts
const SCHEDULE_AHEAD_MS = 200; // late enough for a fresh output timestamp, early enough for the audio thread
const KEEP_PRESSES = 24;
const STRIP_MS = 200; // the strip of presses reaches this far either side of the line
const CLICK = "hit-osu";
const perfClock = (perfMs) => perfMs;

const formatMs = (ms) => `${ms > 0 ? "+" : ""}${ms} ms`;

function pressText(ms) {
  if (Math.abs(ms) < 5) return "On the line";
  return `${Math.abs(ms)} ms ${ms > 0 ? "after the line" : "before the line"}`;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function liveStatus(request) {
  if (request === "failed") return "The bot couldn't play the clicks. Join a voice channel and try again.";
  if (request === "starting") return "Waiting for the bot's clicks. If a song is playing, they start after it.";
  return "The clicks are over.";
}

// One block falls at a time and its click sounds; the press lands on the lane. A press is kept against the click, so
// the answer doesn't depend on the offset in use; what is drawn does. Without `live` the click plays here, through the
// song's output, one block per request. With `live` ({ notes, songTimeAt, request, onReplay }) the bot plays the clicks
// in voice, and a block falls for each of them while they last.
export default function CalibrationPanel({ audio, settings, live = null, onApply, onClose }) {
  const offsetMs = (live ? settings?.offsetMs : settings?.soloOffsetMs) ?? 0;
  const keys = settings?.keys?.length === 4 ? settings.keys : DEFAULT_SETTINGS.keys;
  const notes = live?.notes ?? null;
  const fallMs = live ? BLOCK_FALL_LIVE_MS : FALL_MS;
  const [sample, setSample] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [falling, setFalling] = useState(false);
  const [errors, setErrors] = useState([]);
  const [last, setLast] = useState(null); // { errorMs, arrivalMs } after a press, { missed: true } after none

  const laneRef = useRef(null);
  const blockRef = useRef(null);
  const roundRef = useRef(null); // { arrival, soundAt, end, cancel } while a block is in the air, in the clock's ms
  const latest = useRef(null);
  latest.current = { sample, offsetMs, keys, level: gainOf(settings?.hitVolume || DEFAULT_VOLUME), onClose, clock: live?.songTimeAt ?? perfClock, notes };

  useEffect(() => {
    if (live) return undefined;
    let alive = true;
    audio.stopClip({ fadeMs: 0 });
    fetch(SOUND_URLS[CLICK])
      .then((response) => response.arrayBuffer())
      .then((data) => audio.ctx().decodeAudioData(data))
      .then((decoded) => { if (alive) setSample(decoded); })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => {
      alive = false;
      roundRef.current?.cancel?.();
      roundRef.current = null;
    };
    // The kind of window never changes while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  function beginRound(round) {
    roundRef.current = round;
    setFalling(true);
  }

  function endRound(result) {
    roundRef.current = null;
    setFalling(false);
    setLast(result);
  }

  function moveBlock(clockMs, round) {
    if (!blockRef.current) return;
    const distance = (laneRef.current?.clientHeight ?? 0) * LINE_AT;
    blockRef.current.style.transform = `translate3d(0, ${distance * (1 + (clockMs - round.arrival) / fallMs)}px, 0)`;
  }

  function drop() {
    if (live || roundRef.current || !latest.current.sample) return;
    void audio.unlock();
    const arrival = performance.now() + FALL_MS;
    const soundAt = arrival - latest.current.offsetMs;
    const round = { arrival, soundAt, end: Math.max(arrival, soundAt) + LISTEN_MS, cancel: null };
    beginRound(round);
    setLast(null);
    const frame = (now) => {
      if (roundRef.current !== round) return;
      if (!round.cancel && round.soundAt - now <= SCHEDULE_AHEAD_MS) {
        round.cancel = audio.playSampleAt(latest.current.sample, round.soundAt, latest.current.level);
      }
      moveBlock(now, round);
      if (now > round.end) endRound({ missed: true });
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function press(timeStamp) {
    const round = roundRef.current;
    if (!round) return;
    const clockMs = latest.current.clock(timeStamp);
    if (clockMs === null) return;
    const errorMs = blockError(clockMs, round.soundAt);
    if (errorMs === null) return; // far too early: the real press may still come
    endRound({ errorMs, arrivalMs: clockMs - round.arrival });
    setErrors((previous) => [...previous, errorMs].slice(-KEEP_PRESSES));
  }

  const handlers = useRef(null);
  handlers.current = { press, drop, beginRound, endRound, moveBlock };

  // The bot's clicks run on their own: a block for each, as long as the song clock has them.
  const liveMode = Boolean(live);
  useEffect(() => {
    if (!liveMode) return undefined;
    let raf = 0;
    let afterMs = -Infinity;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const clockMs = latest.current.clock(now);
      if (clockMs === null) return;
      const { beginRound: begin, endRound: end, moveBlock: move } = handlers.current;
      if (roundRef.current && (!latest.current.notes || clockMs > roundRef.current.end)) end({ missed: true });
      if (!roundRef.current && latest.current.notes) {
        const note = nextBlockNote(latest.current.notes, clockMs, latest.current.offsetMs, afterMs);
        if (note) {
          afterMs = note.t;
          const arrival = note.t + latest.current.offsetMs;
          begin({ arrival, soundAt: note.t, end: Math.max(arrival, note.t) + BLOCK_LISTEN_LIVE_MS, cancel: null });
        }
      }
      if (roundRef.current) move(clockMs, roundRef.current);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [liveMode]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.repeat) return;
      if (event.code === "Escape") {
        event.preventDefault();
        latest.current.onClose();
      } else if (event.code === "Enter") {
        event.preventDefault();
        handlers.current.drop();
      } else if (event.code === "Space" || latest.current.keys.includes(event.code)) {
        event.preventDefault();
        handlers.current.press(event.timeStamp);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const estimate = blockEstimate(errors);
  const lastMs = last && !last.missed ? Math.round(last.errorMs - offsetMs) : null;
  // Where the block was at the press, on the same scale it falls on.
  const markerTop = last && !last.missed ? clamp(LINE_AT * (1 + last.arrivalMs / fallMs), 0, 1) * 100 : null;
  const canReplay = live && !notes && live.request !== "starting";

  return (
    <div className="mb-settings-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mb-settings mb-cal" role="dialog" aria-label={live ? "Bot audio calibration" : "Activity audio calibration"}>
        <div className="mb-settings-head">
          <h2 className="mb-settings-title">{live ? "Bot audio" : "Activity audio"}</h2>
          <button type="button" className="mb-btn mb-settings-done" onClick={onClose}>Done</button>
        </div>
        <div className="mb-cal-body">
          <div className="mb-cal-lane" ref={laneRef} onPointerDown={(event) => press(event.timeStamp)}>
            {falling ? <div className="mb-cal-block" ref={blockRef} /> : null}
            <div className="mb-cal-line" style={{ top: `${LINE_AT * 100}%` }} />
            {markerTop !== null ? <div className={`mb-cal-marker${Math.abs(lastMs) < 5 ? " mb-cal-marker-on" : ""}`} style={{ top: `${markerTop}%` }} /> : null}
          </div>
          <div className="mb-cal-side">
            <p className="mb-row-help">Press any lane key when you <strong>hear</strong> the click{live ? " from the bot in voice" : ""}. Go by the sound, not by the block: the block only shows where your press landed.</p>
            <div className="mb-cal-result" role="status">
              {live && !notes ? <span>{liveStatus(live.request)}</span> : null}
              {last?.missed && !(live && !notes) ? <span>No press that time.</span> : null}
              {lastMs !== null && !(live && !notes) ? <span className="mb-cal-last">{pressText(lastMs)}</span> : null}
              {!live && !last && !falling ? <span>{errors.length ? "Ready for another." : "Drop a block to start."}</span> : null}
            </div>
            <div className="mb-cal-strip" aria-hidden="true">
              <span className="mb-cal-strip-zero" />
              {errors.map((errorMs, index) => (
                <span
                  key={index}
                  className={`mb-cal-dot${index === errors.length - 1 ? " mb-cal-dot-last" : ""}`}
                  style={{ left: `${50 + (clamp(errorMs - offsetMs, -STRIP_MS, STRIP_MS) / STRIP_MS) * 50}%` }}
                />
              ))}
            </div>
            <p className="mb-row-help">
              {estimate
                ? `${estimate.presses === 1 ? "1 press" : `${estimate.presses} presses, spread ±${estimate.spreadMs} ms`} suggest ${formatMs(estimate.offsetMs)}. Saved: ${formatMs(offsetMs)}.`
                : `Saved: ${formatMs(offsetMs)}. Once is enough for a start, a few presses make it better.`}
            </p>
            {loadFailed ? <p className="mb-field-error" role="alert">Couldn't load the click. Close this and try again.</p> : null}
            <div className="mb-calib-row">
              {live
                ? <button type="button" className="mb-btn mb-btn-primary" disabled={!canReplay} onClick={live.onReplay}>Play clicks again</button>
                : <button type="button" className="mb-btn mb-btn-primary" disabled={falling || !sample} onClick={drop}>{errors.length ? "Drop another" : "Drop a block"}</button>}
              <button type="button" className="mb-btn" disabled={!estimate || estimate.offsetMs === offsetMs} onClick={() => onApply(estimate.offsetMs)}>Use suggestion</button>
              <button type="button" className="mb-btn" disabled={!errors.length || (!live && falling)} onClick={() => { setErrors([]); setLast(null); }}>Clear</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
