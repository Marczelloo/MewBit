import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, GameController, SpeakerHigh } from "@phosphor-icons/react";
import { MIN_TAPS } from "./calibration.js";
import { keyLabel, keysProblem } from "./input.js";
import { DEFAULT_SETTINGS } from "./useMewbeatGame.js";
import "./settings.css";

// Same limits as LIMITS in helpers/mewbeat/userSettings.js (the activity cannot import that CJS file).
const OFFSET_MIN = -300;
const OFFSET_MAX = 700;
const OFFSET_STEP = 5;
const SPEED_MIN = 1;
const SPEED_MAX = 10;
const VOLUME_MIN = 0;
const VOLUME_MAX = 100;
const VOLUME_STEP = 5;
const DEBOUNCE_MS = 300;
const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

const DIFFICULTIES = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
  { value: "hell", label: "Hell" },
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
const TEMPO_SCROLL = [
  { value: true, label: "By tempo" },
  { value: false, label: "Fixed" },
];
const SHOW_MEWBIT = [
  { value: true, label: "Show" },
  { value: false, label: "Hide" },
];

const GROUPS = [
  { id: "gameplay", label: "Gameplay", Icon: GameController },
  { id: "audio", label: "Audio & sync", Icon: SpeakerHigh },
  { id: "visual", label: "Visual", Icon: Eye },
];

// Share of a slider track to colour as filled.
function fillOf(value, min, max) {
  return `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`;
}

export function formatOffset(ms) {
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

// The settings window. It renders from the `settings` prop (the server's echo) and keeps a local
// draft per field only while a change is in flight; a refused patch therefore snaps back by itself.
export default function SettingsPanel({ settings, onAction, onClose, timing = null, autoOffset = false, onAutoOffset, onResetTiming, onPreviewHit, onPreviewMusic, liveCalibration = true }) {
  const current = useMemo(() => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    if (!Array.isArray(merged.keys) || merged.keys.length !== 4) merged.keys = DEFAULT_SETTINGS.keys;
    return merged;
  }, [settings]);

  const [draft, setDraft] = useState({});
  const [capture, setCapture] = useState(null); // lane index waiting for a key
  const [keyError, setKeyError] = useState(null);
  const [clicksPending, setClicksPending] = useState(false);
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

  // Category rail: clicking scrolls the pane to the group, scrolling the pane highlights the group in view.
  const [activeGroup, setActiveGroup] = useState(GROUPS[0].id);
  const paneRef = useRef(null);

  const scrollToGroup = (id) => {
    const pane = paneRef.current;
    const target = pane?.querySelector(`#mb-group-${id}`);
    if (!pane || !target) return;
    setActiveGroup(id);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    pane.scrollTo({ top: target.offsetTop, behavior: reduce ? "auto" : "smooth" });
  };

  const onPaneScroll = () => {
    const pane = paneRef.current;
    if (!pane) return;
    const line = pane.scrollTop + 48;
    let found = GROUPS[0].id;
    for (const group of GROUPS) {
      const node = pane.querySelector(`#mb-group-${group.id}`);
      if (node && node.offsetTop <= line) found = group.id;
    }
    setActiveGroup(found);
  };

  const offsetMs = valueOf("offsetMs");
  const scrollSpeed = valueOf("scrollSpeed");
  const hitSounds = Boolean(valueOf("hitSounds"));
  const hitVolume = valueOf("hitVolume");
  const musicVolume = valueOf("musicVolume");

  return (
    <div className="mb-settings-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mb-settings" ref={panelRef} role="dialog" aria-label="Game settings" tabIndex={-1} onBlur={keepFocus}>
        <div className="mb-settings-head">
          <h2 className="mb-settings-title">Settings</h2>
          <button type="button" className="mb-btn mb-settings-done" onClick={onClose}>
            Done <kbd className="mb-kbd">Esc</kbd>
          </button>
        </div>

        <div className="mb-settings-body">
          <nav className="mb-settings-rail" aria-label="Settings categories">
            {GROUPS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`mb-rail-item ${activeGroup === id ? "is-active" : ""}`.trim()}
                aria-current={activeGroup === id ? "true" : undefined}
                onClick={() => scrollToGroup(id)}
              >
                <Icon size={20} weight="bold" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="mb-settings-pane" ref={paneRef} onScroll={onPaneScroll}>
            <section className="mb-group" id="mb-group-gameplay" aria-labelledby="mb-group-gameplay-title">
              <h3 className="mb-group-title" id="mb-group-gameplay-title">Gameplay</h3>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-text">
                  <span className="mb-row-label">Keys</span>
                  {keyError ? <p className="mb-field-error" role="alert">{keyError}</p> : <p className="mb-row-help">Click a key, then press the one you want. Space is FEVER.</p>}
                </div>
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
              </section>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <label className="mb-row-label" htmlFor="mb-speed">Scroll speed</label>
                  <output className="mb-value" htmlFor="mb-speed">{scrollSpeed}</output>
                </div>
                <input
                  id="mb-speed"
                  className="mb-range"
                  style={{ "--fill": fillOf(scrollSpeed, SPEED_MIN, SPEED_MAX) }}
                  type="range"
                  min={SPEED_MIN}
                  max={SPEED_MAX}
                  step={1}
                  value={scrollSpeed}
                  onChange={(event) => changeDebounced("scrollSpeed", Number(event.target.value), { immediate: false })}
                />
                <div className="mb-row-foot">
                  <p className="mb-row-help">By tempo: faster songs fall a little faster, slower ones a little slower.</p>
                  <Segmented label="Scroll speed mode" options={TEMPO_SCROLL} value={valueOf("tempoScroll") !== false} onChange={(value) => send({ tempoScroll: value })} />
                </div>
              </section>
              <section className="mb-row">
                <div className="mb-row-text">
                  <span className="mb-row-label">Default difficulty</span>
                  <p className="mb-row-help">Used when a track starts. Change it mid-song from the track card.</p>
                </div>
                <Segmented label="Default difficulty" options={DIFFICULTIES} value={valueOf("liveDifficulty")} onChange={(value) => send({ liveDifficulty: value })} />
              </section>
            </section>

            <section className="mb-group" id="mb-group-audio" aria-labelledby="mb-group-audio-title">
              <h3 className="mb-group-title" id="mb-group-audio-title">Audio &amp; sync</h3>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <label className="mb-row-label" htmlFor="mb-offset">Audio offset</label>
                  <output className="mb-value" htmlFor="mb-offset">{formatOffset(offsetMs)}</output>
                </div>
                <div className="mb-offset-row">
                  <button type="button" className="mb-btn mb-step" aria-label="Offset minus 5 ms" disabled={offsetMs <= OFFSET_MIN} onClick={() => nudgeOffset(-OFFSET_STEP)}>−5</button>
                  <input
                    id="mb-offset"
                    ref={sliderRef}
                    className="mb-range"
                    style={{ "--fill": fillOf(offsetMs, OFFSET_MIN, OFFSET_MAX) }}
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
                <p className="mb-row-help">Raise it if notes reach the line before you hear the beat.</p>
              </section>
              <section className="mb-row mb-row-stack mb-calib">
                <div className="mb-row-head">
                  <span className="mb-row-label">Calibrate from taps</span>
                  <div className="mb-row-head-end">
                    {timing?.offsetMs !== null && timing?.offsetMs !== undefined ? (
                      <output className="mb-value">{formatOffset(timing.offsetMs)}</output>
                    ) : null}
                    <Segmented label="Auto offset" options={AUTO_OFFSET} value={autoOffset} onChange={(value) => onAutoOffset?.(value)} />
                  </div>
                </div>
                <p className="mb-row-help" role="status">
                  {timing?.offsetMs === null || !timing
                    ? `Play and tap along to what you hear: ${timing?.taps ?? 0}/${MIN_TAPS} taps.`
                    : `Your last ${timing.taps} taps suggest ${formatOffset(timing.offsetMs)} (taps spread ±${timing.spreadMs} ms).${autoOffset ? " Auto offset keeps it updated." : ""}`}
                </p>
                <p className="mb-row-help">
                  {liveCalibration
                    ? "Calibration clicks: the bot plays a metronome in voice. Close settings and press any lane key on each click as you hear it. The notes stay hidden, so only your ears count."
                    : "Calibration clicks play through the bot in voice, so they only work in Live. Here, tap along to a song instead."}
                </p>
                <div className="mb-calib-row">
                  <button
                    type="button"
                    className="mb-btn"
                    disabled={clicksPending || !liveCalibration}
                    onClick={() => {
                      setClicksPending(true);
                      Promise.resolve(onActionRef.current?.("mewbeat_calibrate")).finally(() => setClicksPending(false));
                    }}
                  >
                    Play calibration clicks
                  </button>
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
              <section className="mb-row">
                <div className="mb-row-text">
                  <span className="mb-row-label">Hit sounds</span>
                </div>
                <Segmented label="Hit sounds" options={HIT_SOUNDS} value={hitSounds} onChange={(value) => send({ hitSounds: value })} />
              </section>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <label className="mb-row-label" htmlFor="mb-hit-volume">Hit sound volume</label>
                  <output className="mb-value" htmlFor="mb-hit-volume">{hitVolume}%</output>
                </div>
                <input
                  id="mb-hit-volume"
                  className="mb-range"
                  style={{ "--fill": fillOf(hitVolume, VOLUME_MIN, VOLUME_MAX) }}
                  type="range"
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step={VOLUME_STEP}
                  value={hitVolume}
                  disabled={!hitSounds}
                  aria-valuetext={`${hitVolume}%`}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    changeDebounced("hitVolume", value, { immediate: false });
                    onPreviewHit?.(value);
                  }}
                />
              </section>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <label className="mb-row-label" htmlFor="mb-music-volume">Music volume</label>
                  <output className="mb-value" htmlFor="mb-music-volume">{musicVolume}%</output>
                </div>
                <input
                  id="mb-music-volume"
                  className="mb-range"
                  style={{ "--fill": fillOf(musicVolume, VOLUME_MIN, VOLUME_MAX) }}
                  type="range"
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step={VOLUME_STEP}
                  value={musicVolume}
                  aria-valuetext={`${musicVolume}%`}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    changeDebounced("musicVolume", value, { immediate: false });
                    onPreviewMusic?.(value);
                  }}
                />
                <p className="mb-row-help">Solo and rooms only. In Live the bot plays the music, so use Discord's volume.</p>
              </section>
            </section>

            <section className="mb-group" id="mb-group-visual" aria-labelledby="mb-group-visual-title">
              <h3 className="mb-group-title" id="mb-group-visual-title">Visual</h3>
              <section className="mb-row">
                <div className="mb-row-text">
                  <span className="mb-row-label">Effects</span>
                </div>
                <Segmented label="Effects" options={EFFECTS} value={valueOf("effects")} onChange={(value) => send({ effects: value })} />
              </section>
              <section className="mb-row">
                <div className="mb-row-text">
                  <span className="mb-row-label">Show Mewbit</span>
                </div>
                <Segmented label="Show Mewbit" options={SHOW_MEWBIT} value={valueOf("showMewbit") !== false} onChange={(value) => send({ showMewbit: value })} />
              </section>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
