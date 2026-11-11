import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, GameController, SpeakerHigh, Timer } from "@phosphor-icons/react";
import { MIN_TAPS } from "./calibration.js";
import { HIT_SOUNDS as HIT_SOUND_OPTIONS } from "./hitSounds.js";
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
const FEVER_MODE = [
  { value: "manual", label: "Manual" },
  { value: "auto", label: "Auto" },
];
const SHOW_MEWBIT = [
  { value: true, label: "Show" },
  { value: false, label: "Hide" },
];

const GROUPS = [
  { id: "sound", label: "Sound", Icon: SpeakerHigh },
  { id: "gameplay", label: "Gameplay", Icon: GameController },
  { id: "sync", label: "Sync", Icon: Timer },
  { id: "visual", label: "Visual", Icon: Eye },
];

// Share of a slider track to colour as filled.
function fillOf(value, min, max) {
  return `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`;
}

export function formatOffset(ms) {
  return `${ms > 0 ? "+" : ""}${ms} ms`;
}

function Segmented({ label, options, value, onChange, fill = false, disabled = false }) {
  return (
    <div className={`mb-segmented${fill ? " mb-segmented-fill" : ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`mb-btn mb-seg ${option.value === value ? "mb-toggle-on" : ""}`.trim()}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A slider with its value beside it. `label` names it for screen readers when no visible label points at `id`.
function Slider({ id, label, value, min, max, step = 1, text, disabled = false, onChange }) {
  return (
    <div className="mb-slider">
      <input
        id={id}
        className="mb-range"
        style={{ "--fill": fillOf(value, min, max) }}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="mb-value" htmlFor={id}>{text}</output>
    </div>
  );
}

// One category of the pane: its title, then its rows in a single panel split by hairlines.
function Group({ id, title, children }) {
  return (
    <section className="mb-group" id={`mb-group-${id}`} aria-labelledby={`mb-group-${id}-title`}>
      <h3 className="mb-group-title" id={`mb-group-${id}-title`}>{title}</h3>
      <div className="mb-group-rows">{children}</div>
    </section>
  );
}

// The settings window. It renders from the `settings` prop (the server's echo) and keeps a local
// draft per field only while a change is in flight; a refused patch therefore snaps back by itself.
export default function SettingsPanel({ settings, onAction, onClose, timing = null, autoOffset = false, onAutoOffset, onResetTiming, onPreviewHit, onPreviewSfx, onPreviewMusic, liveCalibration = true, offsetField = "offsetMs", onBlockCalibration, forcedGroup = null, onReplayTour, replayTourBlocked = false }) {
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
    if (!forcedGroup) panelRef.current?.focus(); // in the first-run tour, focus stays on the tour's buttons
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
    const base = latestRef.current[offsetField] ?? currentRef.current[offsetField];
    const next = Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, Math.round((base + delta) / OFFSET_STEP) * OFFSET_STEP));
    changeDebounced(offsetField, next, { immediate: true });
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
  const [scrolledGroup, setActiveGroup] = useState(GROUPS[0].id);
  const activeGroup = forcedGroup ?? scrolledGroup; // the first-run tour pins the group it is talking about
  const paneRef = useRef(null);

  // The tour moves the pane to the group at once, no smooth scroll, so its target is in place when the popup measures.
  useEffect(() => {
    if (!forcedGroup) return;
    const pane = paneRef.current;
    const target = pane?.querySelector(`#mb-group-${forcedGroup}`);
    if (pane && target) pane.scrollTop = target.offsetTop;
  }, [forcedGroup]);

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

  const offsetMs = valueOf(offsetField);
  const scrollSpeed = valueOf("scrollSpeed");
  const hitSounds = Boolean(valueOf("hitSounds"));
  const hitVolume = valueOf("hitVolume");
  const sfx = Boolean(valueOf("sfx"));
  const sfxVolume = valueOf("sfxVolume");
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
            <Group id="sound" title="Sound">
              <section className="mb-row mb-row-stack" data-tour="sound">
                <label className="mb-row-label" htmlFor="mb-music-volume">Music volume</label>
                <Slider
                  id="mb-music-volume"
                  value={musicVolume}
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step={VOLUME_STEP}
                  text={`${musicVolume}%`}
                  onChange={(value) => {
                    changeDebounced("musicVolume", value, { immediate: false });
                    onPreviewMusic?.(value);
                  }}
                />
                <p className="mb-row-help">Solo and rooms only. In Live the bot plays the music, so use Discord's volume.</p>
              </section>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <span className="mb-row-label">Even out loudness</span>
                  <Segmented label="Even out loudness" options={HIT_SOUNDS} value={valueOf("normalizeLoudness") !== false} onChange={(value) => send({ normalizeLoudness: value })} />
                </div>
                <p className="mb-row-help">Plays every song at about the same loudness, so a quiet one is not drowned out by a loud one. Solo and rooms only.</p>
              </section>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <span className="mb-row-label">Hit sounds</span>
                  <Segmented label="Hit sounds" options={HIT_SOUNDS} value={hitSounds} onChange={(value) => send({ hitSounds: value })} />
                </div>
                <Segmented
                  label="Hit sound"
                  fill
                  disabled={!hitSounds}
                  options={HIT_SOUND_OPTIONS}
                  value={valueOf("hitSound") ?? "kick"}
                  onChange={(value) => {
                    send({ hitSound: value });
                    onPreviewHit?.(hitVolume, value);
                  }}
                />
                <Slider
                  id="mb-hit-volume"
                  label="Hit sound volume"
                  value={hitVolume}
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step={VOLUME_STEP}
                  text={`${hitVolume}%`}
                  disabled={!hitSounds}
                  onChange={(value) => {
                    changeDebounced("hitVolume", value, { immediate: false });
                    onPreviewHit?.(value);
                  }}
                />
              </section>
              <section className="mb-row mb-row-stack">
                <div className="mb-row-head">
                  <span className="mb-row-label">Sound effects</span>
                  <Segmented label="Sound effects" options={HIT_SOUNDS} value={sfx} onChange={(value) => send({ sfx: value })} />
                </div>
                <Slider
                  id="mb-sfx-volume"
                  label="Sound effects volume"
                  value={sfxVolume}
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step={VOLUME_STEP}
                  text={`${sfxVolume}%`}
                  disabled={!sfx}
                  onChange={(value) => {
                    changeDebounced("sfxVolume", value, { immediate: false });
                    onPreviewSfx?.(value);
                  }}
                />
                <p className="mb-row-help">Sounds from osu! by ppy Pty Ltd (github.com/ppy/osu-resources), CC BY-NC 4.0.</p>
              </section>
            </Group>

            <Group id="gameplay" title="Gameplay">
              <section className="mb-row mb-row-stack" data-tour="setkeys">
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
              <section className="mb-row">
                <div className="mb-row-text">
                  <span className="mb-row-label">FEVER</span>
                  <p className="mb-row-help">Manual: press Space when the bar is full. Auto: it starts by itself.</p>
                </div>
                <Segmented label="FEVER mode" options={FEVER_MODE} value={valueOf("feverMode") === "auto" ? "auto" : "manual"} onChange={(value) => send({ feverMode: value })} />
              </section>
              <section className="mb-row mb-row-stack">
                <label className="mb-row-label" htmlFor="mb-speed">Scroll speed</label>
                <Slider
                  id="mb-speed"
                  value={scrollSpeed}
                  min={SPEED_MIN}
                  max={SPEED_MAX}
                  text={String(scrollSpeed)}
                  onChange={(value) => changeDebounced("scrollSpeed", value, { immediate: false })}
                />
                <div className="mb-row-foot">
                  <p className="mb-row-help">By tempo: faster songs fall a little faster.</p>
                  <Segmented label="Scroll speed mode" options={TEMPO_SCROLL} value={valueOf("tempoScroll") !== false} onChange={(value) => send({ tempoScroll: value })} />
                </div>
              </section>
              <section className="mb-row">
                <div className="mb-row-text">
                  <span className="mb-row-label">Default difficulty</span>
                  <p className="mb-row-help">Used when a track starts. In Live you can change it mid-song from the track card.</p>
                </div>
                <Segmented label="Default difficulty" options={DIFFICULTIES} value={valueOf("liveDifficulty")} onChange={(value) => send({ liveDifficulty: value })} />
              </section>
            </Group>

            <Group id="sync" title="Sync">
              <section className="mb-row mb-row-stack" data-tour="offset">
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
                    onChange={(event) => changeDebounced(offsetField, Number(event.target.value), { immediate: false })}
                  />
                  <button type="button" className="mb-btn mb-step" aria-label="Offset plus 5 ms" disabled={offsetMs >= OFFSET_MAX} onClick={() => nudgeOffset(OFFSET_STEP)}>+5</button>
                </div>
                <p className="mb-row-help">Raise it if notes reach the line before you hear the beat. {liveCalibration ? "This one is for the bot's audio in Live; Solo and rooms have their own." : "This one is for Solo and rooms; the bot's audio in Live has its own."}</p>
              </section>
              <section className="mb-row mb-row-stack mb-calib">
                <div className="mb-row-head">
                  <span className="mb-row-label">Activity audio</span>
                  <output className="mb-value">{formatOffset(valueOf("soloOffsetMs"))}</output>
                </div>
                <p className="mb-row-help">One block falls and a click plays here in the Activity, no song needed. Sets the offset for Solo and rooms.</p>
                <div className="mb-calib-row">
                  <button type="button" className="mb-btn" onClick={() => onBlockCalibration?.("activity")}>Calibrate with a block</button>
                </div>
              </section>
              <section className="mb-row mb-row-stack mb-calib">
                <div className="mb-row-head">
                  <span className="mb-row-label">Bot audio</span>
                  <output className="mb-value">{formatOffset(valueOf("offsetMs"))}</output>
                </div>
                <p className="mb-row-help">{liveCalibration ? "The bot plays the clicks in your voice channel while a block falls for each. Sets the offset for Live." : "Sets the offset for Live, so it only works there: the clicks come from the bot in voice."}</p>
                <div className="mb-calib-row">
                  <button type="button" className="mb-btn" disabled={!liveCalibration} onClick={() => onBlockCalibration?.("live")}>Calibrate with a block</button>
                </div>
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
                <div className="mb-calib-row">
                  <button
                    type="button"
                    className="mb-btn"
                    disabled={timing?.offsetMs === null || !timing || timing.offsetMs === offsetMs}
                    onClick={() => changeDebounced(offsetField, timing.offsetMs, { immediate: true })}
                  >
                    Apply suggestion
                  </button>
                  <button type="button" className="mb-btn" disabled={!timing?.taps} onClick={() => onResetTiming?.()}>
                    Reset taps
                  </button>
                </div>
              </section>
            </Group>

            <Group id="visual" title="Visual">
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
              {onReplayTour ? (
                <section className="mb-row">
                  <div className="mb-row-text">
                    <span className="mb-row-label">Tutorial</span>
                    <p className="mb-row-help">{replayTourBlocked ? "Not in a room: leave the room to replay it." : "Mewbit shows you around mewbeat again."}</p>
                  </div>
                  <button type="button" className="mb-btn" disabled={replayTourBlocked} onClick={onReplayTour}>Replay tutorial</button>
                </section>
              ) : null}
            </Group>
          </div>
        </div>
      </div>
    </div>
  );
}
