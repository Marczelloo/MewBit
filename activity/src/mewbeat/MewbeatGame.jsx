import { GearSix } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EndCard from "./EndCard.jsx";
import GameHud, { HighwayReadout, TrackCard } from "./GameHud.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import Stage from "./Stage.jsx";
import { MIN_TAPS } from "./calibration.js";
import { createServerClock, createSongClock } from "./clock.js";
import { keyLabel } from "./input.js";
import { createMewbeatLink } from "./link.js";
import { createMockLink } from "./mockLink.js";
import Mewbit from "./mewbit/Mewbit.jsx";
import { useMewbeatGame } from "./useMewbeatGame.js";
import "./mewbeat.css";

// Same switch as MOCK_PREVIEW in App.jsx (a dev-server-only ?mock=1 page with no bot).
const MOCK_PREVIEW = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

const POSITION_JUMP_MS = 1500;
const AUTO_OFFSET_EVERY = 16; // new taps between auto offset updates
const AUTO_OFFSET_MIN_CHANGE_MS = 10; // smaller drifts are tap noise, not a wrong offset
const DEFAULT_KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];

const PHASE_COPY = {
  connecting: { title: "Connecting…" },
  offline: { title: "Reconnecting…" },
  idle: { title: "Nothing is playing." },
  charting: { title: "Charting this track…", detail: "You'll join from the current position." },
  uncharted: { title: "This track can't be charted." },
  failed: { title: "Charting failed. We'll try the next track." },
  paused: { title: "Paused" },
};

function createLink(mewbeatSocketRef) {
  if (MOCK_PREVIEW) return createMockLink();
  const serverClock = createServerClock();
  return createMewbeatLink({
    send: (payload) => mewbeatSocketRef.current?.send?.(payload) ?? false,
    serverClock,
    songClock: createSongClock(serverClock),
  });
}

export default function MewbeatGame({ state, settings, mewbeatHandlerRef, mewbeatSocketRef, onAction, onClose }) {
  const dialogRef = useRef(null);
  const gearRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;
  const [link] = useState(() => createLink(mewbeatSocketRef));

  // The link has to be live before useMewbeatGame mounts its effects, so this effect stays above the hook.
  useEffect(() => {
    if (mewbeatHandlerRef) mewbeatHandlerRef.current = link.handle;
    link.start();
    return () => {
      link.stop();
      if (mewbeatHandlerRef && mewbeatHandlerRef.current === link.handle) mewbeatHandlerRef.current = null;
    };
  }, [link, mewbeatHandlerRef]);

  const player = state?.player;
  const current = player?.currentTrack ?? null;
  const trackId = current?.id ?? null;
  const title = current?.title ?? null;
  const artist = current?.author ?? null;
  const durationMs = current?.durationMs ?? 0;
  const queued = (player?.queue?.length ?? 0) > 0;
  const trackInfo = useMemo(
    () => (trackId === null ? null : { title, artist, durationMs, queued }),
    [trackId, title, artist, durationMs, queued]
  );

  const game = useMewbeatGame({ link, settings, effects: settings?.effects, trackInfo, inputPaused: settingsOpen, onExit: onClose });
  const { phase, hud, endSummary, mewbitPose, track, canvasRef, progressRef, autoplay, setAutoplay, effectsLevel, unlockAudio, timing, resetTiming, calibrating } = game;

  // Auto offset (this session only): every AUTO_OFFSET_EVERY new taps, a suggestion that differs
  // enough from the saved offset is saved as the offset.
  const [autoOffset, setAutoOffset] = useState(false);
  const appliedAtRef = useRef(0); // timing.total when auto offset last looked
  const savedOffset = settings?.offsetMs ?? 0;
  useEffect(() => {
    if (!autoOffset || timing.offsetMs === null || timing.total - appliedAtRef.current < AUTO_OFFSET_EVERY) return;
    appliedAtRef.current = timing.total;
    if (Math.abs(timing.offsetMs - savedOffset) < AUTO_OFFSET_MIN_CHANGE_MS) return;
    onAction?.("mewbeat_settings", { settings: { offsetMs: timing.offsetMs } });
  }, [autoOffset, timing, savedOffset, onAction]);

  // The panel returns focus to the gear button it was opened from.
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => gearRef.current?.focus());
  }, []);

  // The bot sends an anchor on its own schedule; a pause, track change or seek in the state is a reason to ask now.
  const paused = Boolean(player?.paused);
  const positionMs = player?.positionMs ?? 0;
  const lastStateRef = useRef(null);
  useEffect(() => {
    const now = performance.now();
    const prev = lastStateRef.current;
    lastStateRef.current = { trackId, paused, positionMs, at: now };
    if (!prev) return;
    const expected = prev.positionMs + (prev.paused ? 0 : now - prev.at);
    if (prev.trackId !== trackId || prev.paused !== paused || Math.abs(positionMs - expected) > POSITION_JUMP_MS) link.syncNow();
  }, [link, trackId, paused, positionMs]);

  // Move focus into the dialog and keep Tab inside it.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key !== "Tab") return;
      // With the settings panel open, Tab stays inside the panel.
      const root = settingsOpenRef.current ? dialogRef.current?.querySelector(".mb-settings") : dialogRef.current;
      const buttons = [...(root?.querySelectorAll("button:not(:disabled), input, select") || [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = document.activeElement;
      if (!root?.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (active === first || active === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Hits (not misses) kick the stage pulse. There is no beat clock in the UI, so each new judgement
  // swaps between two identical CSS animations, which restarts it without per-frame React state.
  const judgement = hud.judgement;
  const [pulse, setPulse] = useState({ id: 0, count: 0 });
  if (judgement && judgement.kind !== "miss" && judgement.id !== pulse.id) setPulse({ id: judgement.id, count: pulse.count + 1 });
  const pulseClass = pulse.count > 0 && effectsLevel !== "off" ? ` mb-pulse-${pulse.count % 2 ? "a" : "b"}` : "";
  const sad = mewbitPose === "crushed";
  // FEVER pushes the vibe look past full, a crushed Mewbit drains it.
  const stageVibe = hud.feverActive ? 1.4 : sad ? 0 : Math.min(1, Math.max(0, hud.vibe));
  const feverTimeStyle = hud.feverActive
    ? { opacity: 1, transform: "scaleX(0)", transition: `transform ${Math.max(0, hud.feverLeftMs)}ms linear` }
    : { opacity: 0, transform: "scaleX(1)", transition: "none" };

  const keys = Array.isArray(settings?.keys) && settings.keys.length === 4 ? settings.keys : DEFAULT_KEYS;
  const difficulty = settings?.liveDifficulty ?? "normal";
  const copy = PHASE_COPY[phase];
  const running = phase === "playing" || phase === "paused";
  const showCard = Boolean(endSummary);
  // A run that ended with no card (joined in its last second) just waits.
  const stateCopy = showCard ? null : phase === "ended" ? { title: "Waiting for the next track…" } : copy;

  return (
    <div
      className={`mb-game mb-fx-${effectsLevel}`}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="mewbeat"
      tabIndex={-1}
      data-phase={phase}
      onPointerDown={unlockAudio}
    >
      <header className="mb-header">
        <div className="mb-header-brand">
          <span className="mb-wordmark">mewbeat</span>
          {hud.unranked && running ? <span className="mb-chip">unranked</span> : null}
          {calibrating && running ? <span className="mb-chip">calibration · tap any key on each click · {timing.taps}/{MIN_TAPS}</span> : null}
        </div>
        <div className="mb-header-actions">
          <button type="button" className={`mb-btn mb-toggle ${autoplay ? "mb-toggle-on" : ""}`.trim()} aria-pressed={autoplay} onClick={() => setAutoplay(!autoplay)}>
            Autoplay
          </button>
          <button type="button" className="mb-btn mb-gear" ref={gearRef} aria-label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
            <GearSix size={18} weight="bold" aria-hidden="true" />
          </button>
          <button type="button" className="mb-btn" onClick={onClose}>
            Exit <kbd className="mb-kbd">Esc</kbd>
          </button>
        </div>
      </header>

      <div
        className={`mb-stage${sad ? " mb-sad" : ""}${hud.feverActive ? " mb-fever" : ""}${pulseClass}`}
        style={{ "--mb-vibe": stageVibe }}
      >
        <Stage />
        {hud.feverActive ? <div className="mb-feverbanner" aria-hidden="true">FEVER!</div> : null}
        <div className="mb-scene">
          <div className="mb-char">
            <div className="mb-char-box">
              <div className="mb-aura" aria-hidden="true" />
              <Mewbit pose={mewbitPose} effects={effectsLevel} />
            </div>
          </div>

          <div className="mb-highway-slot">
            <div className={`mb-highway ${hud.feverActive ? "mb-highway-fever" : ""}`.trim()}>
              <canvas className="mb-canvas" ref={canvasRef} aria-hidden="true" />
              <div className="mb-keys" aria-hidden="true">
                {keys.map((code) => (
                  <kbd key={code} className="mb-kbd mb-lanekey">{keyLabel(code)}</kbd>
                ))}
              </div>
              <div className="mb-fevertime" style={feverTimeStyle} aria-hidden="true" />
              {running ? <HighwayReadout hud={hud} /> : null}
              {stateCopy ? (
                <div className="mb-state" role="status">
                  <b>{stateCopy.title}</b>
                  {stateCopy.detail ? <span>{stateCopy.detail}</span> : null}
                </div>
              ) : null}
              {showCard ? (
                <EndCard
                  summary={endSummary}
                  phase={phase}
                  queued={Boolean(track?.queued)}
                  timing={timing}
                  savedOffset={savedOffset}
                  onApplyOffset={(offsetMs) => onAction?.("mewbeat_settings", { settings: { offsetMs } })}
                />
              ) : null}
            </div>
          </div>

          <aside className="mb-side">
            <TrackCard track={track} difficulty={difficulty} progressRef={progressRef} />
            <GameHud hud={hud} />
          </aside>
        </div>
      </div>

      {settingsOpen ? <SettingsPanel
          settings={settings}
          onAction={onAction}
          onClose={closeSettings}
          timing={timing}
          autoOffset={autoOffset}
          onAutoOffset={setAutoOffset}
          onResetTiming={resetTiming}
        /> : null}
    </div>
  );
}
