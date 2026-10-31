import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keyLabel, keysProblem } from "./input.js";
import { DEFAULT_SETTINGS } from "./useMewbeatGame.js";

// Same limits as LIMITS in helpers/mewbeat/userSettings.js (the activity cannot import that CJS file).
const OFFSET_MIN = -300;
const OFFSET_MAX = 700;
const OFFSET_STEP = 5;
const SPEED_MIN = 1;
const SPEED_MAX = 10;
const OFFSET_DEBOUNCE_MS = 300;
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
export default function SettingsPanel({ settings, onAction, onClose }) {
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
  const offsetTimerRef = useRef(null);
  const pendingOffsetRef = useRef(null);

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
        setDraft((previous) => {
          const { [field]: _settled, ...rest } = previous;
          return rest;
        });
      });
  }, []);

  const flushOffset = useCallback(() => {
    window.clearTimeout(offsetTimerRef.current);
    offsetTimerRef.current = null;
    const pending = pendingOffsetRef.current;
    pendingOffsetRef.current = null;
    if (pending !== null) send({ offsetMs: pending });
  }, [send]);

  // Closing the panel must not drop a slider change that is still waiting out its debounce.
  useEffect(() => flushOffset, [flushOffset]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function changeOffset(value, { immediate }) {
    const next = Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, Math.round(value / OFFSET_STEP) * OFFSET_STEP));
    setDraft((previous) => ({ ...previous, offsetMs: next }));
    pendingOffsetRef.current = next;
    window.clearTimeout(offsetTimerRef.current);
    if (immediate) flushOffset();
    else offsetTimerRef.current = window.setTimeout(flushOffset, OFFSET_DEBOUNCE_MS);
  }

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

  const onPanelKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const offsetMs = valueOf("offsetMs");
  const scrollSpeed = valueOf("scrollSpeed");

  return (
    <div className="mb-settings-scrim" onKeyDown={onPanelKeyDown} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mb-settings" ref={panelRef} role="dialog" aria-label="Game settings" tabIndex={-1}>
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
            <button type="button" className="mb-btn mb-step" aria-label="Offset minus 5 ms" disabled={offsetMs <= OFFSET_MIN} onClick={() => changeOffset(offsetMs - OFFSET_STEP, { immediate: true })}>−5</button>
            <input
              id="mb-offset"
              className="mb-range"
              type="range"
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              step={OFFSET_STEP}
              value={offsetMs}
              aria-valuetext={formatOffset(offsetMs)}
              onChange={(event) => changeOffset(Number(event.target.value), { immediate: false })}
            />
            <button type="button" className="mb-btn mb-step" aria-label="Offset plus 5 ms" disabled={offsetMs >= OFFSET_MAX} onClick={() => changeOffset(offsetMs + OFFSET_STEP, { immediate: true })}>+5</button>
          </div>
          <p className="mb-field-help">Raise it if notes reach the line before you hear the beat.</p>
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
            onChange={(event) => send({ scrollSpeed: Number(event.target.value) })}
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
