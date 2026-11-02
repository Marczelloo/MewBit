import { GearSix, List, Pause } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMewbeatAudio } from "../api.js";
import GameHud, { HighwayReadout, TrackCard } from "./GameHud.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import Stage from "./Stage.jsx";
import { MIN_TAPS } from "./calibration.js";
import { createServerClock, createSongClock } from "./clock.js";
import { keyLabel } from "./input.js";
import { createMewbeatLink } from "./link.js";
import { createLiveBoardStore } from "./liveBoard.js";
import { createMockLink } from "./mockLink.js";
import { createMewbeatRequests } from "./requests.js";
import { createRoomLink } from "./roomLink.js";
import { createRoomStore } from "./roomStore.js";
import { createSoloAudio } from "./soloAudio.js";
import { createSoloLink } from "./soloLink.js";
import Lobby, { CountdownOverlay, LeaveConfirm } from "./Lobby.jsx";
import LiveBoard from "./LiveBoard.jsx";
import Results from "./Results.jsx";
import SongSelect from "./SongSelect.jsx";
import Mewbit from "./mewbit/Mewbit.jsx";
import { loadedCount, memberOf, roomErrorText, roomView, standingsOf, upNextOf } from "./room.js";
import { useMewbeatGame } from "./useMewbeatGame.js";
import "./mewbeat.css";

// Same switch as MOCK_PREVIEW in App.jsx (a dev-server-only ?mock=1 page with no bot).
const MOCK_PREVIEW = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

const POSITION_JUMP_MS = 1500;
const AUTO_OFFSET_EVERY = 16; // new taps between auto offset updates
const AUTO_OFFSET_MIN_CHANGE_MS = 10; // smaller drifts are tap noise, not a wrong offset
const DEFAULT_KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
const DEFAULT_MUSIC_VOLUME = 80; // same default as musicVolume in helpers/mewbeat/userSettings.js
const MODES = [
  { id: "live", label: "Live" },
  { id: "solo", label: "Solo" },
  { id: "room", label: "Room" },
];

const PHASE_COPY = {
  connecting: { title: "Connecting…" },
  offline: { title: "Reconnecting…" },
  idle: { title: "Nothing is playing." },
  charting: { title: "Charting this track…", detail: "You'll join from the current position." },
  uncharted: { title: "This track can't be charted." },
  failed: { title: "Charting failed. We'll try the next track." },
  paused: { title: "Paused" },
};

// Solo has no "next track" to wait for, and charting a fresh song can take a while.
const SOLO_PHASE_COPY = {
  charting: { title: "Charting this song…", detail: "The first time can take a little while." },
  uncharted: { title: "This song can't be charted.", detail: "Press Esc to pick another one." },
  failed: { title: "Charting failed.", detail: "Press Esc to pick another song." },
  ended: { title: "Song finished" },
};
const SOLO_STAGE_COPY = {
  preparing: { title: "Finding the song…" },
  loading: { title: "Loading the song…", detail: "Downloading and decoding the audio." },
};

const liveSessionForLive = (audioKey) => `live:${audioKey}`;
const liveSessionForRoom = () => "room";

function createLink(mode, mewbeatSocketRef, audio, getUserId) {
  if (MOCK_PREVIEW) return createMockLink();
  const send = (payload) => mewbeatSocketRef.current?.send?.(payload) ?? false;
  if (mode === "solo") return createSoloLink({ send, audio });
  if (mode === "room") return createRoomLink({ send, audio, getUserId });
  const serverClock = createServerClock();
  return createMewbeatLink({
    send,
    serverClock,
    songClock: createSongClock(serverClock),
  });
}

// The solo or room link's stage as React state (null for the live link).
function useLinkState(link) {
  const [linkState, setLinkState] = useState(() => link.state?.() ?? null);
  useEffect(() => {
    if (!link.onState) return undefined;
    setLinkState(link.state());
    return link.onState(setLinkState);
  }, [link]);
  return linkState;
}

// The room store's view (snapshot, joining, join error) as React state.
function useRoomStore(store) {
  const [view, setView] = useState(() => store?.get() ?? null);
  useEffect(() => {
    if (!store) return undefined;
    setView(store.get());
    return store.subscribe(setView);
  }, [store]);
  return view;
}

// The game's one menu, opened with the header button or Esc. A solo run is paused under it; Live and rooms
// can't stop the song, so the game only ignores its keys while it is up. Esc resumes from anywhere
// (MewbeatSession captures it, so it works whatever has focus); Enter does too, unless it is on another button.
function GameMenu({ title, note, error, focusSettings, modes, autoplay, onAutoplay, onResume, onRestart, onPick, onSettings, onExit }) {
  const resumeRef = useRef(null);
  const settingsRef = useRef(null);
  useEffect(() => {
    (focusSettings ? settingsRef : resumeRef).current?.focus();
  }, [focusSettings]);
  const onKeyDown = (event) => {
    const onButton = event.target instanceof HTMLElement && event.target.tagName === "BUTTON";
    if (event.key === "Enter" && !onButton) {
      event.preventDefault();
      event.stopPropagation();
      onResume();
    }
  };
  return (
    <div className="mb-pause-scrim" onKeyDown={onKeyDown}>
      <div className="mb-pause" role="dialog" aria-modal="true" aria-label={title}>
        <b className="mb-pause-title">{title}</b>
        {note ? <p className="mb-pause-note">{note}</p> : null}
        {error ? <p className="mb-field-error" role="alert">{error}</p> : null}
        <div className="mb-pause-actions">
          <button type="button" className="mb-btn mb-btn-primary" ref={resumeRef} onClick={onResume}>
            Resume <kbd className="mb-kbd">Esc</kbd>
          </button>
          {onRestart ? <button type="button" className="mb-btn" onClick={onRestart}>Restart</button> : null}
          {onPick ? <button type="button" className="mb-btn" onClick={onPick}>Song select</button> : null}
          <button type="button" className="mb-btn" ref={settingsRef} onClick={onSettings}>
            <GearSix size={16} weight="bold" aria-hidden="true" /> Settings
          </button>
          {onAutoplay ? (
            <button type="button" className={`mb-btn mb-toggle ${autoplay ? "mb-toggle-on" : ""}`.trim()} aria-pressed={autoplay} onClick={() => onAutoplay(!autoplay)}>
              Autoplay
            </button>
          ) : null}
        </div>
        <div className="mb-pause-modes">
          <span className="mb-pause-label">Mode</span>
          <div className="mb-modes" role="group" aria-label="Mode">
            {modes.map(({ id, label, active, disabled, hint, onSelect }) => (
              <button
                key={id}
                type="button"
                className={`mb-mode${active ? " mb-mode-on" : ""}`}
                aria-pressed={active}
                disabled={disabled}
                title={disabled ? hint : undefined}
                onClick={active ? undefined : onSelect}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="mb-btn mb-pause-exit" onClick={onExit}>Exit</button>
      </div>
    </div>
  );
}

// Mode, audio engine and music volume live here; the session below is keyed by mode, so switching tears the
// whole run and link down and builds the other one.
export default function MewbeatGame(props) {
  const { context, state, settings } = props;
  const botPlaying = Boolean(state?.player?.currentTrack);
  const liveAvailable = MOCK_PREVIEW || botPlaying;
  const [mode, setMode] = useState(() => (liveAvailable ? "live" : "solo"));
  const contextRef = useRef(context);
  contextRef.current = context;
  // One audio engine (and AudioContext) for the screen's life, shared by every solo link.
  const [audio] = useState(() => createSoloAudio({
    fetchAudio: (audioKey, signal) => fetchMewbeatAudio({ guildId: contextRef.current?.guildId, accessToken: contextRef.current?.accessToken, audioKey, signal }),
  }));
  const musicVolume = Number.isFinite(settings?.musicVolume) ? settings.musicVolume : DEFAULT_MUSIC_VOLUME;
  useEffect(() => {
    audio.setVolume(musicVolume / 100);
  }, [audio, musicVolume]);
  const musicVolumeRef = useRef(musicVolume);
  musicVolumeRef.current = musicVolume;
  const previewMusic = useCallback((value) => audio.setVolume(value / 100), [audio]);
  useEffect(() => () => audio.close(), [audio]);
  // Request/reply over the socket (played lists now; results and rooms later), shared by every session and
  // fed by the session's message handler.
  const socketRef = props.mewbeatSocketRef;
  const [requests] = useState(() => createMewbeatRequests((payload) => socketRef?.current?.send?.(payload) ?? false));
  return <MewbeatSession key={mode} {...props} mode={mode} onModeChange={setMode} liveAvailable={liveAvailable} botPlaying={botPlaying} audio={audio} musicVolumeRef={musicVolumeRef} previewMusic={previewMusic} requests={requests} />;
}

function MewbeatSession({ mode, onModeChange, liveAvailable, botPlaying, audio, musicVolumeRef, previewMusic, requests, context, state, settings, mewbeatHandlerRef, mewbeatSocketRef, onAction, onClose }) {
  const solo = mode === "solo";
  const roomMode = mode === "room" && !MOCK_PREVIEW;
  const userId = context?.user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const dialogRef = useRef(null);
  const menuButtonRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // the menu over Live, a room, or solo outside a run
  const [settingsFromMenu, setSettingsFromMenu] = useState(false);
  const [link] = useState(() => createLink(mode, mewbeatSocketRef, audio, () => userIdRef.current));
  const [liveBoard] = useState(createLiveBoardStore);
  // A room's snapshots go to the store, which hands them on to the link (it loads and times the round).
  const [store] = useState(() => (roomMode ? createRoomStore({ requests, onRoom: (next, at) => link.setRoom(next, at) }) : null));
  const linkState = useLinkState(link);
  const soloState = solo ? linkState : null;
  const roomLinkState = roomMode ? linkState : null;
  const roomStoreView = useRoomStore(store);
  const room = roomStoreView?.room ?? null;
  const view = roomMode ? roomView(room, userId, { prepared: Boolean(roomLinkState?.prepared) }) : null;
  const me = roomMode ? memberOf(room, userId) : null;
  const [addOpen, setAddOpen] = useState(false); // the room's "add songs" picker
  const [leaveConfirm, setLeaveConfirm] = useState(null); // { target } while "Leave round?" is up
  const [actionNotice, setActionNotice] = useState(null);
  const soloStage = soloState?.stage ?? null;
  const pauseOpen = solo && soloStage === "paused";
  // Settings opens from the menu and covers it; closing it brings the menu back.
  const menuShown = (pauseOpen || menuOpen) && !settingsOpen;
  // Song select is up with no song, while a pick is being resolved, and after a pick the server refused
  // (which has no audioKey yet; an audio load failure has one and shows its message on the stage).
  const pickerOpen = solo && (soloStage === "idle" || soloStage === "preparing" || (soloStage === "error" && !soloState.audioKey));

  // The link has to be live before useMewbeatGame mounts its effects, so this effect stays above the hook.
  useEffect(() => {
    // Replies to request() are consumed first; everything else is the link's.
    const handler = (message) => requests.handle(message) || store?.handle(message) || liveBoard.handle(message) || link.handle(message);
    if (mewbeatHandlerRef) mewbeatHandlerRef.current = handler;
    link.start();
    return () => {
      link.stop();
      if (mewbeatHandlerRef && mewbeatHandlerRef.current === handler) mewbeatHandlerRef.current = null;
    };
  }, [link, requests, store, liveBoard, mewbeatHandlerRef]);

  // Joining the room is an effect of the screen being up: it needs the handler above to see the bot's reply,
  // and closing the screen (or leaving the mode) leaves the room.
  useEffect(() => {
    if (!store) return undefined;
    store.join();
    return () => store.leave();
  }, [store]);

  const player = state?.player;
  const current = player?.currentTrack ?? null;
  const trackId = current?.id ?? null;
  const title = current?.title ?? null;
  const artist = current?.author ?? null;
  const durationMs = current?.durationMs ?? 0;
  const queued = (player?.queue?.length ?? 0) > 0;
  const liveTrackInfo = useMemo(
    () => (trackId === null ? null : { title, artist, durationMs, queued }),
    [trackId, title, artist, durationMs, queued]
  );
  const roomTrack = room?.current ?? null;
  const roomTitle = roomTrack?.title ?? null;
  const roomArtist = roomTrack?.artist ?? null;
  const roomDurationMs = roomTrack?.durationMs ?? 0;
  const roomQueued = (room?.queue?.length ?? 0) > 0;
  const roomTrackInfo = useMemo(
    () => (roomTitle === null ? null : { title: roomTitle, artist: roomArtist, durationMs: roomDurationMs, queued: roomQueued }),
    [roomTitle, roomArtist, roomDurationMs, roomQueued]
  );
  const trackInfo = solo ? soloState?.track ?? null : roomMode ? roomTrackInfo : liveTrackInfo;
  // In a room the difficulty is the one picked in the lobby, and the run reports which round it belongs to.
  const gameSettings = useMemo(
    () => (roomMode && me?.difficulty ? { ...settings, liveDifficulty: me.difficulty } : settings),
    [roomMode, settings, me?.difficulty]
  );
  const roomRound = roomLinkState?.playedRound ?? room?.round ?? null;
  const submitExtra = useMemo(() => (roomMode ? { round: roomRound } : null), [roomMode, roomRound]);
  // The lobby, spectating and joining screens own the keyboard (their buttons need Space and Enter); the game
  // only has it while a round is loading, counting down or running.
  const lobbyScreen = roomMode && (view === "none" || view === "lobby" || view === "watching");

  // Esc, routed per mode: Live exits. Solo pauses a run and otherwise steps back (song pick, then exit).
  // Assigned below, once the game's phase is known.
  const exitRef = useRef(() => {});
  // Live runs report to the channel's board; solo reports nothing. A room passes () => "room" (spectators null).
  const liveSessionOf = mode === "live" ? liveSessionForLive : roomMode ? liveSessionForRoom : null;
  // The game ignores its keys while an overlay owns the keyboard: settings (capture buttons), the pause
  // overlay, and the song picker (its search input needs the letter keys).
  const game = useMewbeatGame({
    link,
    mode,
    requests,
    settings: gameSettings,
    effects: settings?.effects,
    trackInfo,
    inputPaused: settingsOpen || pauseOpen || menuOpen || pickerOpen || addOpen || Boolean(leaveConfirm) || lobbyScreen,
    liveSession: liveSessionOf,
    submitExtra,
    onExit: () => exitRef.current(),
  });
  const { phase, hud, runDifficulty, swap, changeDifficulty, runSession, endSummary, mewbitPose, track, canvasRef, progressRef, autoplay, setAutoplay, effectsLevel, unlockAudio, previewHit, timing, resetTiming, calibrating } = game;
  // A room round in flight (loading, counting down or playing, and my own run not over) asks before it is left.
  const fallbackMode = liveAvailable ? "live" : "solo";
  const inRound = roomMode && (view === "loading" || view === "countdown" || view === "playing") && phase !== "ended";
  const leaveRoom = (target) => {
    store?.leave();
    link.leaveRound?.();
    setLeaveConfirm(null);
    if (target === "close") onClose();
    else onModeChange(target);
  };
  const requestLeave = (target) => {
    if (inRound) setLeaveConfirm({ target });
    else leaveRoom(target);
  };
  // The menu pauses a solo run; anywhere else it just goes up over the game.
  const soloRunning = solo && (soloStage === "playing" || soloStage === "countin") && phase !== "ended";
  const openMenu = () => {
    if (soloRunning) link.pause();
    else setMenuOpen(true);
  };
  const closeMenu = () => {
    setMenuOpen(false);
    setSettingsFromMenu(false);
  };
  // A solo song that starts under the menu (it was opened while loading) is paused right away.
  useEffect(() => {
    if (menuOpen && soloRunning) {
      link.pause();
      setMenuOpen(false);
    }
  }, [menuOpen, soloRunning, link]);
  // Esc opens the menu, except over a solo song that failed to load, where it goes back to song select.
  exitRef.current = () => {
    if (solo && soloStage === "error") link.leave();
    else openMenu();
  };

  // Song select's Play. The chosen difficulty becomes the live difficulty the game charts with. Rejects with
  // the server's reason when the song can't be prepared; begin() reports its own failures on the stage.
  const savedDifficulty = settings?.liveDifficulty ?? "normal";
  const pickSong = useCallback(async (picked, pickedDifficulty) => {
    if (pickedDifficulty && pickedDifficulty !== savedDifficulty) {
      onAction?.("mewbeat_settings", { settings: { liveDifficulty: pickedDifficulty } });
    }
    const { audioKey, track: prepared } = await link.prepare({ uri: picked.uri, source: picked.source });
    link.begin(audioKey, prepared);
  }, [link, onAction, savedDifficulty]);
  const backToGame = () => window.requestAnimationFrame(() => dialogRef.current?.focus());
  const startNext = async () => {
    if (endSummary) setDismissedId(endSummary.id);
    const reply = await store.start();
    if (reply?.status !== "ok") setActionNotice(roomErrorText(reply));
  };
  // The room's add-songs picker: the bot prepares the song, so this can take a while; a refusal is shown there.
  const addToRoom = useCallback(async (picked) => {
    const reply = await store.queueAdd({ uri: picked.uri, source: picked.source });
    if (reply?.status !== "ok") throw new Error(roomErrorText(reply));
  }, [store]);

  const resumeFromMenu = () => {
    if (pauseOpen) link.resume();
    closeMenu();
    backToGame();
  };
  const resumeRef = useRef(resumeFromMenu);
  resumeRef.current = resumeFromMenu;
  // Esc closes the menu (and resumes a paused run) wherever the focus is (a click on the scrim's blank part
  // leaves it outside the menu). The settings panel, when open, takes Esc first.
  useEffect(() => {
    if (!menuShown) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      resumeRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [menuShown]);

  // Esc in the "Leave round?" confirmation keeps playing, wherever the focus is.
  useEffect(() => {
    if (!leaveConfirm || settingsOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveConfirm(null);
      backToGame();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [leaveConfirm, settingsOpen]);
  // An error shown in the lobby goes away once the lobby is left.
  useEffect(() => {
    if (view !== "lobby") setActionNotice(null);
  }, [view]);

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

  // Closing the panel goes back to the menu it was opened from (which focuses its Settings button); otherwise
  // focus goes to the menu button.
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    audio.setVolume(musicVolumeRef.current / 100); // drop any slider preview that was never saved
    if (!settingsFromMenu) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, [audio, musicVolumeRef, settingsFromMenu]);

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
      // With the settings panel or the pause overlay open, Tab stays inside it.
      const root = dialogRef.current?.querySelector(".mb-settings, .mb-pause") ?? dialogRef.current;
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
  const running = phase === "playing" || phase === "paused";
  // The card shows the difficulty of the chart on stage (it can differ from the saved default after a live change).
  const difficulty = runDifficulty ?? settings?.liveDifficulty ?? "normal";
  // Back (Live) hides the results of that run; the next run's summary has a new id and shows again. Solo keeps the
  // last summary around until the next run starts, so it only shows while the run it belongs to is on stage.
  const [dismissedId, setDismissedId] = useState(null);
  const cardPlace = roomMode ? view === "playing" || view === "lobby" : !solo || soloStage === "playing" || soloStage === "ended";
  const showCard = Boolean(endSummary) && dismissedId !== endSummary.id && !pickerOpen && cardPlace;
  let stateCopy;
  if (roomMode) {
    if (showCard) stateCopy = null;
    else if (view === "loading") {
      const { loaded, total } = loadedCount(room);
      if (roomLinkState?.prepared) stateCopy = { title: "Waiting for the others…", detail: `${loaded} of ${total} loaded` };
      else if (phase === "uncharted" || phase === "failed") stateCopy = { title: "This song can't be charted for you.", detail: "You sit this round out." };
      else stateCopy = { title: "Getting ready…", detail: "Loading the song and your chart." };
    } else if (view === "playing" && phase === "ended") stateCopy = { title: "Song finished", detail: "Waiting for the others…" };
    else stateCopy = null;
  } else if (solo) {
    if (pickerOpen || showCard) stateCopy = null;
    else if (soloStage === "preparing" || soloStage === "loading") stateCopy = SOLO_STAGE_COPY[soloStage];
    else if (soloStage === "error") stateCopy = { title: soloState.error, detail: "Press Esc to pick another song." };
    // "paused" is the pause overlay or the count-in, which have their own copy.
    else stateCopy = phase === "paused" ? null : SOLO_PHASE_COPY[phase] ?? PHASE_COPY[phase];
  } else {
    // A run that ended with no card (joined in its last second) just waits.
    stateCopy = showCard ? null : phase === "ended" ? { title: "Waiting for the next track…" } : PHASE_COPY[phase];
  }

  return (
    <div
      className={`mb-game mb-fx-${effectsLevel}`}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="mewbeat"
      tabIndex={-1}
      data-phase={phase}
      onPointerDown={() => {
        unlockAudio();
        if (solo || roomMode) audio.unlock();
      }}
      onKeyDown={() => {
        if (roomMode) audio.unlock();
      }}
    >
      <header className="mb-header">
        <div className="mb-header-brand">
          <span className="mb-wordmark">mewbeat</span>
          {hud.unranked && running ? <span className="mb-chip">unranked</span> : null}
          {calibrating && running ? <span className="mb-chip">calibration · tap any key on each click · {timing.taps}/{MIN_TAPS}</span> : null}
        </div>
        <div className="mb-header-actions">
          {solo && botPlaying ? <span className="mb-hint">Lower MewBit in Discord to hear the song</span> : null}
          {menuShown ? null : (
            <button type="button" className="mb-btn" ref={menuButtonRef} aria-haspopup="dialog" onClick={openMenu}>
              {running ? <Pause size={16} weight="bold" aria-hidden="true" /> : <List size={16} weight="bold" aria-hidden="true" />}
              {running ? "Pause" : "Menu"} <kbd className="mb-kbd">Esc</kbd>
            </button>
          )}
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
            {settings?.showMewbit === false ? null : (
              <div className="mb-char-box">
                <div className="mb-aura" aria-hidden="true" />
                <Mewbit pose={mewbitPose} effects={effectsLevel} />
              </div>
            )}
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
              {soloStage === "countin" ? (
                <div className="mb-countin" role="status" aria-live="assertive">
                  <b key={soloState.count}>{soloState.count}</b>
                </div>
              ) : null}
              {stateCopy ? (
                <div className="mb-state" role="status">
                  <b>{stateCopy.title}</b>
                  {stateCopy.detail ? <span>{stateCopy.detail}</span> : null}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="mb-side">
            <TrackCard track={track} difficulty={difficulty} progressRef={progressRef} mode={mode} disabled={!running || calibrating} swap={swap} onDifficulty={roomMode ? undefined : changeDifficulty} />
            <GameHud hud={hud} />
            {(mode === "live" || roomMode) && running ? <LiveBoard store={liveBoard} session={runSession} meId={context?.user?.id ?? null} /> : null}
          </aside>
        </div>
      </div>

      {roomMode && room && (view === "lobby" || view === "watching") ? (
        <Lobby
          room={room}
          userId={userId}
          view={view}
          receivedAt={roomStoreView.receivedAt}
          serverClock={link.serverClock}
          store={store}
          board={liveBoard}
          effects={effectsLevel}
          keys={keys}
          offsetMs={savedOffset}
          notice={roomLinkState?.error ?? actionNotice}
          onAddSongs={() => setAddOpen(true)}
          onLeave={() => leaveRoom(fallbackMode)}
          onCalibrate={() => { setSettingsFromMenu(false); setSettingsOpen(true); }}
        />
      ) : null}

      {roomMode && view === "none" ? (
        <div className="mb-lobby-join" role="status">
          {roomStoreView?.joinError ? (
            <>
              <b>Couldn't join the room</b>
              <span>{roomErrorText(roomStoreView.joinError)}</span>
              <button type="button" className="mb-btn mb-btn-primary" onClick={() => store.join()}>Try again</button>
            </>
          ) : (
            <b>Joining the room…</b>
          )}
        </div>
      ) : null}

      {showCard ? (
        <Results
          key={endSummary.id}
          summary={endSummary}
          mode={mode}
          phase={phase}
          effects={effectsLevel}
          active={!settingsOpen && !menuShown && !leaveConfirm && !addOpen}
          queued={Boolean(track?.queued)}
          upNext={roomMode ? upNextOf(room) : !solo && player?.queue?.[0]?.title ? { title: player.queue[0].title, ready: false } : null}
          standings={roomMode ? standingsOf(room, userId) : null}
          onNext={roomMode && view === "lobby" && room?.hostId === userId && (room?.queue?.length ?? 0) > 0 ? startNext : undefined}
          nextLabel="Start next round"
          timing={timing}
          savedOffset={savedOffset}
          onApplyOffset={(offsetMs) => onAction?.("mewbeat_settings", { settings: { offsetMs } })}
          onBack={() => setDismissedId(endSummary.id)}
          onSongSelect={solo ? () => link.leave() : undefined}
        />
      ) : null}

      {pickerOpen ? (
        <SongSelect
          context={context}
          request={requests.request}
          defaultDifficulty={savedDifficulty}
          onPlay={pickSong}
          onClose={onClose}
        />
      ) : null}

      {roomMode && addOpen ? (
        <SongSelect
          context={context}
          request={requests.request}
          defaultDifficulty={savedDifficulty}
          onAddToRoom={addToRoom}
          onClose={() => { setAddOpen(false); backToGame(); }}
        />
      ) : null}

      {leaveConfirm ? (
        <LeaveConfirm onStay={() => { setLeaveConfirm(null); backToGame(); }} onLeave={() => leaveRoom(leaveConfirm.target)} />
      ) : null}

      {roomMode && (view === "countdown" || view === "playing") && Number.isFinite(roomLinkState?.startPerf) ? (
        <CountdownOverlay startPerf={roomLinkState.startPerf} title={room?.current?.title} effects={effectsLevel} />
      ) : null}

      {menuShown ? (
        <GameMenu
          title={pauseOpen ? "Paused" : "Menu"}
          note={running && !solo ? (roomMode ? "The round keeps going." : "The song keeps playing in voice.") : null}
          error={pauseOpen ? soloState.error : null}
          focusSettings={settingsFromMenu}
          modes={MODES.map(({ id, label }) => {
            const active = id === mode;
            return {
              id,
              label,
              active,
              disabled: !active && ((id === "live" && !liveAvailable) || ((id === "solo" || id === "room") && MOCK_PREVIEW)),
              hint: id === "live" ? "The bot isn't playing anything" : "Not available in the mock preview",
              onSelect: () => {
                closeMenu();
                if (roomMode) requestLeave(id);
                else onModeChange(id);
              },
            };
          })}
          autoplay={autoplay}
          onAutoplay={roomMode ? undefined : setAutoplay}
          onResume={resumeFromMenu}
          onRestart={pauseOpen ? () => { link.restart(); closeMenu(); backToGame(); } : undefined}
          onPick={solo && !pickerOpen ? () => { link.leave(); closeMenu(); backToGame(); } : undefined}
          onSettings={() => { setSettingsFromMenu(true); setSettingsOpen(true); }}
          onExit={() => {
            closeMenu();
            if (roomMode) requestLeave("close");
            else onClose();
          }}
        />
      ) : null}
      {settingsOpen ? <SettingsPanel
          settings={settings}
          onAction={onAction}
          onClose={closeSettings}
          timing={timing}
          autoOffset={autoOffset}
          onAutoOffset={setAutoOffset}
          onResetTiming={resetTiming}
          onPreviewHit={previewHit}
          onPreviewMusic={previewMusic}
          liveCalibration={mode === "live"}
        /> : null}
    </div>
  );
}
