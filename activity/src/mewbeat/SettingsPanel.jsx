import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIN_TAPS } from "./calibration.js";
import { keyLabel, keysProblem } from "./input.js";
import { DEFAULT_SETTINGS } from "./useMewbeatGame.js";

// Same limits as LIMITS in helpers/mewbeat/userSettings.js (the activity cannot import that CJS file).
const OFFSET_MIN = -300;
const OFFSET_MAX = 700;
const OFFSET_STEP = 5;
const SPEED_MIN = 1;
const SPEED_MAX = 10;
const DEBOUNCE_MS = 300;
const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

const DIFFICULTIES = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];
const EFFECTS = [
  { value: "full", label: "Full" },
  { value: "reduced", label: "Reduced" },
  { value: "off", label: "Off" },
];
const HIT_SOUNDS = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];
const AUTO_OFFSET = HIT_SOUNDS;

function formatOffset(ms) {
  return `${ms > 0 ? "+" : ""}${ms} ms`;
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="mb-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`mb-btn mb-seg ${option.value === value ? "mb-toggle-on" : ""}`.trim()}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// The settings drawer. It renders from the `settings` prop (the server's echo) and keeps a local
// draft per field only while a change is in flight; a refused patch therefore snaps back by itself.
export default function SettingsPanel({ settings, onAction, onClose, timing = null, autoOffset = false, onAutoOffset, onResetTiming }) {
  const current = useMemo(() => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    if (!Array.isArray(merged.keys) || merged.keys.length !== 4) merged.keys = DEFAULT_SETTINGS.keys;
    return merged;
  }, [settings]);

  const [draft, setDraft] = useState({});
  const [capture, setCapture] = useState(null); // lane index waiting for a key
  const [keyError, setKeyError] = useState(null);
  const panelRef = useRef(null);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const seqRef = useRef({});
  const timersRef = useRef({}); // debounce timers by field (offset and scroll speed)
  const pendingRef = useRef({}); // values waiting out their debounce
  const latestRef = useRef({}); // the newest requested value of a debounced field until its request settles
  const keyButtonsRef = useRef([]);
  const sliderRef = useRef(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  const valueOf = (field) => (field in draft ? draft[field] : current[field]);
  const keys = valueOf("keys");
  const keysRef = useRef(keys);
  keysRef.current = keys;

  // Sends one field. The draft shows the new value until the request settles; by then the prop
  // holds the saved value (accepted) or the old one (refused, and App has shown the toast).
  const send = useCallback((patch) => {
    const field = Object.keys(patch)[0];
    const id = (seqRef.current[field] = (seqRef.current[field] ?? 0) + 1);
    setDraft((previous) => ({ ...previous, ...patch }));
    Promise.resolve(onActionRef.current?.("mewbeat_settings", { settings: patch }))
      .catch(() => undefined)
      .finally(() => {
        if (seqRef.current[field] !== id) return;
        delete latestRef.current[field];
        setDraft((previous) => {
          const { [field]: _settled, ...rest } = previous;
          return rest;
        });
      });
  }, []);

  const flushField = useCallback((field) => {
    window.clearTimeout(timersRef.current[field]);
    delete timersRef.current[field];
    if (!(field in pendingRef.current)) return;
    const value = pendingRef.current[field];
    delete pendingRef.current[field];
    send({ [field]: value });
  }, [send]);

  // Closing the panel must not drop a slider change that is still waiting out its debounce.
  useEffect(() => () => {
    for (const field of Object.keys(pendingRef.current)) flushField(field);
  }, [flushField]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // The newest value wins over a stale render: it bumps the field's sequence (so an older request
  // settling cannot clear this draft) and is remembered in a ref (so two quick nudges add up).
  function changeDebounced(field, value, { immediate }) {
    seqRef.current[field] = (seqRef.current[field] ?? 0) + 1;
    latestRef.current[field] = value;
    pendingRef.current[field] = value;
    setDraft((previous) => ({ ...previous, [field]: value }));
    window.clearTimeout(timersRef.current[field]);
    if (immediate) flushField(field);
    else timersRef.current[field] = window.setTimeout(() => flushField(field), DEBOUNCE_MS);
  }

  function nudgeOffset(delta) {
    const base = latestRef.current.offsetMs ?? currentRef.current.offsetMs;
    const next = Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, Math.round((base + delta) / OFFSET_STEP) * OFFSET_STEP));
    changeDebounced("offsetMs", next, { immediate: true });
    // A button that just disabled itself at a limit would drop focus to the page; the slider keeps it.
    if (next <= OFFSET_MIN || next >= OFFSET_MAX) sliderRef.current?.focus();
  }

  // Focus never leaves the panel: when it falls to the page body (a control disabling, a capture
  // ending), it comes back to the panel.
  const keepFocus = () => {
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && (document.activeElement === document.body || document.activeElement === null)) panel.focus();
    });
  };

  // Escape closes the panel wherever focus is. During a key capture the capture listener below takes
  // the event first (and stops it), so Escape then only cancels the capture.
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

  // While a key button waits, the next keydown is the candidate. It is taken in the capture phase so
  // nothing else (a focused button, the focus trap, the game) sees it.
  useEffect(() => {
    if (capture === null) return undefined;
    const lane = capture;
    const onKeyDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || MODIFIER_CODES.has(event.code)) return;
      setCapture(null);
      // The button keeps focus through the capture.
      keyButtonsRef.current[lane]?.focus();
      if (event.code === "Escape") return;
      const before = keysRef.current;
      if (event.code === before[lane]) {
        setKeyError(null);
        return;
      }
      const next = before.slice();
      next[lane] = event.code;
      const problem = keysProblem(next);
      if (problem) {
        setKeyError(problem);
        return;
      }
      setKeyError(null);
      send({ keys: next });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capture, send]);

  const offsetMs = valueOf("offsetMs");
  const scrollSpeed = valueOf("scrollSpeed");

  return (
    <div className="mb-settings-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mb-settings" ref={panelRef} role="dialog" aria-label="Game settings" tabIndex={-1} onBlur={keepFocus}>
        <div className="mb-settings-head">
          <h2 className="mb-settings-title">Settings</h2>
          <button type="button" className="mb-btn" onClick={onClose}>
            Done <kbd className="mb-kbd">Esc</kbd>
          </button>
        </div>

        <section className="mb-field">
          <div className="mb-field-head"><span className="mb-label">Keys</span></div>
          <div className="mb-keycaps">
            {keys.map((code, lane) => (
              <button
                key={lane}
                ref={(node) => { keyButtonsRef.current[lane] = node; }}
                type="button"
                className={`mb-btn mb-keycap ${capture === lane ? "mb-toggle-on" : ""}`.trim()}
                aria-label={`Lane ${lane + 1} key`}
                onClick={() => {
                  setKeyError(null);
                  setCapture(capture === lane ? null : lane);
                }}
              >
                {capture === lane ? "Press a key…" : keyLabel(code)}
              </button>
            ))}
          </div>
          {keyError ? <p className="mb-field-error" role="alert">{keyError}</p> : <p className="mb-field-help">Click a key, then press the one you want. Space is FEVER.</p>}
        </section>

        <section className="mb-field">
          <div className="mb-field-head">
            <label className="mb-label" htmlFor="mb-offset">Audio offset</label>
            <output className="mb-field-value" htmlFor="mb-offset">{formatOffset(offsetMs)}</output>
          </div>
          <div className="mb-offset-row">
            <button type="button" className="mb-btn mb-step" aria-label="Offset minus 5 ms" disabled={offsetMs <= OFFSET_MIN} onClick={() => nudgeOffset(-OFFSET_STEP)}>−5</button>
            <input
              id="mb-offset"
              ref={sliderRef}
              className="mb-range"
              type="range"
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              step={OFFSET_STEP}
              value={offsetMs}
              aria-valuetext={formatOffset(offsetMs)}
              onChange={(event) => changeDebounced("offsetMs", Number(event.target.value), { immediate: false })}
            />
            <button type="button" className="mb-btn mb-step" aria-label="Offset plus 5 ms" disabled={offsetMs >= OFFSET_MAX} onClick={() => nudgeOffset(OFFSET_STEP)}>+5</button>
          </div>
          <p className="mb-field-help">Raise it if notes reach the line before you hear the beat.</p>
        </section>

        <section className="mb-field">
          <div className="mb-field-head">
            <span className="mb-label">Calibrate from taps</span>
            {timing?.offsetMs !== null && timing?.offsetMs !== undefined ? (
              <output className="mb-field-value">{formatOffset(timing.offsetMs)}</output>
            ) : null}
          </div>
          <Segmented label="Auto offset" options={AUTO_OFFSET} value={autoOffset} onChange={(value) => onAutoOffset?.(value)} />
          <p className="mb-field-help" role="status">
            {timing?.offsetMs === null || !timing
              ? `Play and tap along to what you hear: ${timing?.taps ?? 0}/${MIN_TAPS} taps.`
              : `Your last ${timing.taps} taps suggest ${formatOffset(timing.offsetMs)} (taps spread ±${timing.spreadMs} ms).${autoOffset ? " Auto offset keeps it updated." : ""}`}
          </p>
          <div className="mb-calib-row">
            <button
              type="button"
              className="mb-btn"
              disabled={timing?.offsetMs === null || !timing || timing.offsetMs === offsetMs}
              onClick={() => changeDebounced("offsetMs", timing.offsetMs, { immediate: true })}
            >
              Apply suggestion
            </button>
            <button type="button" className="mb-btn" disabled={!timing?.taps} onClick={() => onResetTiming?.()}>
              Reset taps
            </button>
          </div>
        </section>

        <section className="mb-field">
          <div className="mb-field-head">
            <label className="mb-label" htmlFor="mb-speed">Scroll speed</label>
            <output className="mb-field-value" htmlFor="mb-speed">{scrollSpeed}</output>
          </div>
          <input
            id="mb-speed"
            className="mb-range"
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={1}
            value={scrollSpeed}
            onChange={(event) => changeDebounced("scrollSpeed", Number(event.target.value), { immediate: false })}
          />
        </section>

        <section className="mb-field">
          <div className="mb-field-head"><span className="mb-label">Live difficulty</span></div>
          <Segmented label="Live difficulty" options={DIFFICULTIES} value={valueOf("liveDifficulty")} onChange={(value) => send({ liveDifficulty: value })} />
          <p className="mb-field-help">Applies from the next track.</p>
        </section>

        <section className="mb-field">
          <div className="mb-field-head"><span className="mb-label">Effects</span></div>
          <Segmented label="Effects" options={EFFECTS} value={valueOf("effects")} onChange={(value) => send({ effects: value })} />
        </section>

        <section className="mb-field">
          <div className="mb-field-head"><span className="mb-label">Hit sounds</span></div>
          <Segmented label="Hit sounds" options={HIT_SOUNDS} value={Boolean(valueOf("hitSounds"))} onChange={(value) => send({ hitSounds: value })} />
        </section>
      </div>
    </div>
  );
}
