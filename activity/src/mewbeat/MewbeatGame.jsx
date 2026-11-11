import { ArrowCounterClockwise, Bug, GearSix, House, List, MusicNotesSimple, Pause, Play, SignOut } from "@phosphor-icons/react";
import { cloneElement, lazy, memo, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fetchMewbeatAudio } from "../api.js";
import { createAlignClient } from "./alignClient.js";
import { makeAlignWorker } from "./alignWorkerFactory.js";
import { TrackCard } from "./GameHud.jsx";
import CalibrationPanel from "./CalibrationPanel.jsx";
import ReportPanel from "./ReportPanel.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import { Aura, FailedBanner, FeverBanner, FeverTime, HealthBar, MissFlash, Readout, StageBackdrop, StageHost, StagedFeverBar, StagedGameHud, UnrankedChip } from "./StageLeaves.jsx";
import { MIN_TAPS } from "./calibration.js";
import { createServerClock, createSongClock } from "./clock.js";
import { fpsFlagOn, startFrameMonitor } from "./frameMonitor.js";
import { createKeyHold, keyLabel } from "./input.js";
import { createMewbeatLink } from "./link.js";
import { createLiveBoardStore } from "./liveBoard.js";
import { createMockLink, createStillLink } from "./mockLink.js";
import TourLayer from "./tour/TourLayer.jsx";
import { AFTER_INDEX, AFTER_NO_TRAP_INDEX, END_INDEX, TOUR_STEPS, tourNext } from "./tour/steps.js";
import { CUT_FADE_MS, HEAVY_MS, START_LEAD_S, TRAP_IDLE, TRAP_PAUSE_MS, createTrapPlayer, prepareTrap, trapReducer, trapSceneOf, trapScreenOf } from "./tour/trap.js";
import { pickLine } from "./mewbit/lines.js";
import { createMewbeatRequests } from "./requests.js";
import { PrivatePlace } from "./placeContext.js";
import { createRoomLink } from "./roomLink.js";
import { createRoomStore } from "./roomStore.js";
import { roomModifiersToSend } from "./modifierPick.js";
import { createSoloAudio, musicGain } from "./soloAudio.js";
import { createSoloLink } from "./soloLink.js";
import { presenceOf } from "./presence.js";
import Lobby, { LeaveConfirm } from "./Lobby.jsx";
import LiveBoard from "./LiveBoard.jsx";
import Results from "./Results.jsx";
import { isFullCombo } from "./resultTimeline.js";
import SongSelect, { DIFFICULTIES } from "./SongSelect.jsx";
import SpectateCard from "./SpectateCard.jsx";
import Mewbit, { usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import { useHud } from "./useHud.js";
import { countdownSounds, loadedCount, memberOf, roomErrorText, roomView, serverToPerf, standingsOf, upNextOf, voteOf } from "./room.js";
import { useCountdownSounds } from "./useCountdownSounds.js";
import { useMewbeatGame } from "./useMewbeatGame.js";
import { useScreenExit } from "./useScreenExit.js";
import ChartWaitLine from "./ChartWaitLine.jsx";
import { PlainTile, RunTile, useSongFraction } from "./MinimizedTile.jsx";
import { readyOf, shouldAutoPause, tileOf } from "./minimized.js";
import { useMinimized } from "./useMinimized.js";
import "./mewbeat.css";

// Same switch as MOCK_PREVIEW in App.jsx (a dev-server-only ?mock=1 page with no bot).
const MOCK_PREVIEW = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");
// The mock game has no bot to ask, so the report window's list of runs is answered by mockRequests.js there.
const mockRequest = MOCK_PREVIEW ? (type, body) => import("./mockRequests.js").then(({ createMockRequest }) => createMockRequest()(type, body)) : null;
// ?mock=1&select=1 shows the Solo song select on fake replies (mockRequests.js) instead of the mock game.
const MOCK_SELECT = MOCK_PREVIEW && new URLSearchParams(window.location.search).has("select");
// ?mock=1&lobby=1 shows the room lobby on a fake room (&results=1: the end-of-run Results with standings). The file
// is a dynamic import behind the DEV flag, so the production build leaves it and its fake names out.
const MOCK_LOBBY = MOCK_PREVIEW && new URLSearchParams(window.location.search).has("lobby");
const MockLobby = MOCK_LOBBY ? lazy(() => import("./MockLobby.jsx")) : null;
// ?mock=1&firstrun&trap runs the tour's trap (tour/trap.js) on two silent mock songs instead of the bot's (trapMock.js).
const MOCK_TRAP = MOCK_PREVIEW && new URLSearchParams(window.location.search).has("trap");
// ?fps=1 shows a corner box with the frames over 20 ms and the worst one (frameMonitor.js); off without it.
const FPS_FLAG = typeof window !== "undefined" && fpsFlagOn(window.location.search);

const SCREEN_IN_MS = 240; // same as mb-screen-in in mewbeat.css
const SOLO_GO_MS = 900; // Mewbit's GO after a solo run's count
const ENTRY_POSE_MS = 2600; // how long the entry pose (the Konami wink) stays up; .mb-entry-pose fades over the same time
const SCREEN_OUT_MS = 160; // same as mb-screen-out
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

const RESULTS_HOLD_MS = 5000;
const FAILED_HOLD_MS = 1500; // a lost run keeps the stage for the FAILED banner, shorter than a song's end: the song did not finish
const PRESENCE_MS = 5000;
const RESTART_HOLD_MS = 600;
const NOOP = () => {};
const NOOP_ASYNC = () => Promise.resolve();
const NO_MODIFIERS = [];
const CHART_WAIT_SHOW_MS = 1500; // a chart that comes back at once never flashes a wait line
const TOUR_ROOM_CLOCK_MS = 45 * 60_000; // the tour's sample room runs its clock this far, so the round never starts under it

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
  uncharted: { title: "This song can't be charted.", detail: "Try again, or pick another song." },
  failed: { title: "Charting failed.", detail: "Try again, or pick another song." },
  ended: { title: "Song finished" },
};
const SOLO_STAGE_COPY = {
  preparing: { title: "Finding the song…" },
  loading: { title: "Loading the song…", detail: "Downloading and decoding the audio." },
};

const liveSessionForLive = (audioKey) => `live:${audioKey}`;
const liveSessionForRoom = () => "room";

function createLink(mode, mewbeatSocketRef, audio, getUserId, touring) {
  if (touring) return createStillLink(); // the first-run tour: a sample song standing still, nothing to send
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

const poseOf = (pose) => pose;

// The Mewbit on the board. His pose comes from the run's pose store, so a pose change renders this and not the session;
// `override` (the solo count-in) wins while there is one.
const BoardMewbit = memo(function BoardMewbit({ poseStore, override, effects }) {
  const pose = useHud(poseStore, poseOf);
  return <Mewbit pose={override ?? pose} effects={effects} />;
});

// One full screen (results, lobby, song select) in the second grid row. While it fades out it stays mounted but
// takes no input: inert for focus and keys, and `dead` props (Results' active={false}) for what listens on window.
function ScreenSlot({ screen, dead }) {
  const { held, leaving } = screen;
  if (!held) return null;
  return (
    <div className={`mb-screen${leaving ? " mb-screen-out" : ""}`} aria-hidden={leaving || undefined} inert={leaving || undefined}>
      {leaving && dead ? cloneElement(held, dead) : held}
    </div>
  );
}

// The game's one menu, opened with the header button or Esc. A solo run is paused under it; Live and rooms
// can't stop the song, so the game only ignores its keys while it is up. Esc resumes from anywhere
// (MewbeatSession captures it, so it works whatever has focus); Enter does too, unless it is on another button.
// With `level` and `onLevel` it also offers the four levels; picking one starts the map over on it.
function GameMenu({ quiet, title, note, error, focusButton, level, onLevel, onResume, onRestart, onPick, onSettings, onReport, onExit }) {
  const resumeRef = useRef(null);
  const settingsRef = useRef(null);
  const reportRef = useRef(null);
  useEffect(() => {
    if (quiet) return; // the tour's copy leaves the focus on the tour
    ({ settings: settingsRef, report: reportRef }[focusButton] ?? resumeRef).current?.focus();
  }, [focusButton, quiet]);
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
        {level && onLevel ? (
          <div className={`mb-pause-level mb-lv-${level}`}>
            <div className="mb-diff-seg" role="group" aria-label="Level">
              {DIFFICULTIES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`mb-diff-btn${id === level ? " mb-diff-on" : ""}`}
                  aria-pressed={id === level}
                  onClick={() => onLevel(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <small className="mb-diff-note">Changing the level starts the map over.</small>
          </div>
        ) : null}
        <div className="mb-pause-actions">
          <button type="button" className="mb-btn mb-btn-primary" ref={resumeRef} onClick={onResume}>
            <Play size={16} weight="bold" aria-hidden="true" /> Resume <kbd className="mb-kbd">Esc</kbd>
          </button>
          {onRestart ? (
            <button type="button" className="mb-btn" onClick={onRestart}>
              <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" /> Restart <kbd className="mb-kbd">Hold R</kbd>
            </button>
          ) : null}
          {onPick ? (
            <button type="button" className="mb-btn" onClick={onPick}>
              <MusicNotesSimple size={16} weight="bold" aria-hidden="true" /> Song select
            </button>
          ) : null}
          <button type="button" className="mb-btn" ref={settingsRef} onClick={onSettings}>
            <GearSix size={16} weight="bold" aria-hidden="true" /> Settings
          </button>
          <button type="button" className="mb-btn" ref={reportRef} onClick={onReport} data-tour="report">
            <Bug size={16} weight="bold" aria-hidden="true" /> Report a bug
          </button>
        </div>
        <button type="button" className="mb-btn mb-pause-exit" onClick={onExit}>
          <SignOut size={16} weight="bold" aria-hidden="true" /> Quit mewbeat
        </button>
      </div>
    </div>
  );
}

// The song select in the game's frame, answered by fake replies. Nothing plays and no preview is asked for.
function MockSongSelect() {
  const [mock, setMock] = useState(null);
  const [modifiers, setModifiers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    import("./mockRequests.js").then(({ createMockRequest, MOCK_USER_ID }) => {
      if (!cancelled) setMock({ request: createMockRequest(), player: { userId: MOCK_USER_ID } });
    });
    return () => { cancelled = true; };
  }, []);
  const onPlay = useCallback(() => Promise.resolve(), []);
  if (!mock) return null;
  return (
    <div className="mb-game mb-fx-full" role="dialog" aria-modal="true" aria-label="mewbeat">
      <header className="mb-header">
        <div className="mb-header-brand"><span className="mb-wordmark">mewbeat</span></div>
      </header>
      <div className="mb-screen">
        <SongSelect request={mock.request} player={mock.player} onPlay={onPlay} modifiers={modifiers} onModifiers={setModifiers} />
      </div>
    </div>
  );
}

function MewbeatGame(props) {
  if (MOCK_LOBBY && MockLobby) return <Suspense fallback={null}><MockLobby search={window.location.search} /></Suspense>;
  return MOCK_SELECT ? <MockSongSelect /> : <MewbeatRoot {...props} />;
}

// App passes stable props (the player cut down to what the screen shows, a feed for the rest), so a state push that
// changes none of them leaves the whole game alone.
export default memo(MewbeatGame);

// Mode, audio engine and music volume live here; the session below is keyed by mode, so switching tears the
// whole run and link down and builds the other one.
function MewbeatRoot(props) {
  const { context, player, settings } = props;
  const botPlaying = Boolean(player?.currentTrack);
  const liveAvailable = MOCK_PREVIEW || botPlaying;
  const roomInviteRef = useRef(context?.roomInvite ?? null);
  // The pose Mewbit shows over the screen on entry (the Konami wink), once; it lives here so a mode switch does not replay it.
  const [entryPose, setEntryPose] = useState(props.entryPose ?? null);
  useEffect(() => {
    if (!entryPose) return undefined;
    const timer = window.setTimeout(() => setEntryPose(null), ENTRY_POSE_MS);
    return () => window.clearTimeout(timer);
  }, [entryPose]);
  const [mode, setMode] = useState(() => (roomInviteRef.current ? "room" : liveAvailable ? "live" : "solo"));
  const contextRef = useRef(context);
  contextRef.current = context;
  // One audio engine (and AudioContext) for the screen's life, shared by every solo link.
  // The song bytes from the bot, for the game's audio engine and for the tour's trap.
  const [fetchAudio] = useState(() => (audioKey, signal) => fetchMewbeatAudio({ guildId: contextRef.current?.guildId, accessToken: contextRef.current?.accessToken, audioKey, signal }));
  // About 30 s of a song around its highlight, for song select's preview (the bot cuts it out of the rendered file).
  const [fetchClip] = useState(() => (audioKey, fromMs, signal) => fetchMewbeatAudio({ guildId: contextRef.current?.guildId, accessToken: contextRef.current?.accessToken, audioKey, signal, clip: true, fromMs, timeoutMs: 45_000 }));
  const [audio] = useState(() => createSoloAudio({
    fetchAudio,
    fetchClip,
    aligner: createAlignClient({ makeWorker: makeAlignWorker }),
    yieldToUi: () => new Promise((resolve) => setTimeout(resolve, 0)),
  }));
  const normalizeLoudness = settings?.normalizeLoudness !== false;
  useEffect(() => {
    audio.setNormalize(normalizeLoudness);
  }, [audio, normalizeLoudness]);
  const musicVolume = Number.isFinite(settings?.musicVolume) ? settings.musicVolume : DEFAULT_MUSIC_VOLUME;
  useEffect(() => {
    audio.setVolume(musicGain(musicVolume));
  }, [audio, musicVolume]);
  const musicVolumeRef = useRef(musicVolume);
  musicVolumeRef.current = musicVolume;
  const previewMusic = useCallback((value) => audio.setVolume(musicGain(value)), [audio]);
  useEffect(() => () => audio.close(), [audio]);
  useEffect(() => (FPS_FLAG ? startFrameMonitor() : undefined), []);
  const minimized = useMinimized(context?.sdk ?? null);
  // Request/reply over the socket (played lists now; results and rooms later), shared by every session and
  // fed by the session's message handler.
  const socketRef = props.mewbeatSocketRef;
  const [requests] = useState(() => createMewbeatRequests((payload) => socketRef?.current?.send?.(payload) ?? false));

  // The first-run tour (and Settings' Replay): null, or the step it is on. It runs on the real Solo screens, but on a
  // session of its own (key "tour") with the sample song, a link that only stands still and no way to send anything
  // (see tourProps below). The mode is never written, so the game comes back as it was. Only the first run tells the
  // bot it was seen, once, when its first part ends; a replay tells nothing. After a played map there is a second part
  // (the "after-*" steps): it waits in afterDueRef and the solo session says when the player is back at song select
  // (soloBack). Skip anywhere in the first part means there is none.
  const { firstRun, onAction } = props;
  const [tour, setTour] = useState(firstRun ? 0 : null);
  const [tourKit, setTourKit] = useState(null);
  const unseenRef = useRef(Boolean(firstRun));
  const afterDueRef = useRef(null); // the step the second part starts on, once the player is back at song select after a map
  const secondPartRef = useRef(false); // the tour is in its second part, which prepares no trap
  // The sample data is loaded when a tour starts, so a game that never tours does not carry it.
  const tourWanted = tour !== null;
  useEffect(() => {
    if (!tourWanted || tourKit) return undefined;
    let alive = true;
    Promise.all([import("./mockRequests.js"), import("./mockRoom.js")]).then(([{ audioKeyOf, createMockRequest: sampleRequest, MOCK_USER_ID: sampleUserId, SONGS }, { createMockRoom }]) => {
      if (!alive) return;
      const song = SONGS[0];
      const request = sampleRequest();
      // The room step's lobby: a sample room (its clock set far off, so no countdown starts) and a store that changes nothing.
      const now = Date.now();
      const refused = async () => ({ status: "error" });
      setTourKit({
        requests: { request, handle: () => false }, // no send: nothing can reach the socket
        userId: sampleUserId,
        selectedKey: audioKeyOf(song),
        room: { room: createMockRoom({ clockMs: TOUR_ROOM_CLOCK_MS, now }), receivedAt: performance.now() },
        roomStore: {
          ready: refused, start: refused, queueAdd: refused, queueRemove: refused, queueMove: refused, invite: refused,
          songStats: async (audioKey, { onQueue } = {}) => {
            const reply = await request("mewbeat_song_stats", { audioKey });
            onQueue?.(reply.status === "ok" ? reply.queue ?? null : null);
            return reply.status === "ok" ? reply.stats ?? null : null;
          },
        },
      });
    }, () => {
      if (alive) setTour(null); // no sample, no tour; the first run is not marked seen and comes again
    });
    return () => { alive = false; };
  }, [tourWanted, tourKit]);
  const touring = tourWanted && tourKit !== null;
  const markSeen = useCallback(() => {
    if (!unseenRef.current) return;
    unseenRef.current = false;
    onAction?.("mewbeat_tutorial_seen");
  }, [onAction]);
  const endTour = useCallback(() => {
    setTour(null);
    afterDueRef.current = null;
    markSeen();
  }, [markSeen]);
  // The last step's Next ends it too (unless the trap takes it over, see tourPrimary), like every Skip. "Let's go" with no
  // trap ready opens Solo for a song of the player's own, and the second part waits for that map like it does for the calm one.
  const nextTour = useCallback(() => {
    const next = tourNext(tour);
    if (next !== null) {
      setTour(next);
      return;
    }
    endTour();
    if (tour === END_INDEX) {
      setMode("solo");
      afterDueRef.current = AFTER_NO_TRAP_INDEX;
    }
  }, [tour, endTour]);
  const replayTour = useCallback(() => {
    afterDueRef.current = null;
    secondPartRef.current = false;
    setTour(0);
  }, []);
  // The second part, in the tour's own session.
  const startSecondPart = useCallback((index = AFTER_INDEX) => {
    afterDueRef.current = null;
    secondPartRef.current = true;
    setTour(index);
  }, []);
  // The player is back at song select after a map (the solo session reports it).
  const soloBack = useCallback(() => {
    if (afterDueRef.current !== null) startSecondPart(afterDueRef.current);
  }, [startSecondPart]);
  // The trap's "rude" ends the tour and opens the game in Solo on the calm song, as a run like any other. The song waits
  // here for the new session (keyed by mode), which takes it once on mount.
  const [autoStart, setAutoStart] = useState(null);
  const playCalm = useCallback((song) => {
    setAutoStart(song);
    setMode("solo");
    endTour();
    afterDueRef.current = AFTER_INDEX; // after endTour, which clears it
  }, [endTour]);
  const clearAutoStart = useCallback(() => setAutoStart(null), []);
  // The tour's trap (tour/trap.js). While a tour runs, the bot is asked for its two prepared songs and the heavy one is
  // fetched, over the REAL requests (the tour's own are the sample ones), which needs the socket's replies: the tour
  // session installs no handler, so this one takes the place. Whatever is not ready at the last step is no trap at all,
  // and a tour that ends cancels the rest and gives the handler back.
  const trapPrepRef = useRef(null);
  const mewbeatHandlerRef = props.mewbeatHandlerRef;
  useEffect(() => {
    if (!touring || secondPartRef.current) return undefined; // the second part has no trap to prepare
    const handler = (message) => requests.handle(message);
    if (mewbeatHandlerRef) mewbeatHandlerRef.current = handler;
    let alive = true;
    let prep = null;
    if (MOCK_TRAP) {
      import("./tour/trapMock.js").then(({ mockTrapPrep }) => {
        if (!alive) return;
        prep = mockTrapPrep(() => audio.ctx());
        trapPrepRef.current = prep;
      }, () => {});
    } else if (socketRef?.current && !botPlaying) {
      prep = prepareTrap({ requests, fetchAudio, getContext: () => audio.ctx() });
      trapPrepRef.current = prep;
    }
    return () => {
      alive = false;
      prep?.cancel();
      trapPrepRef.current = null;
      if (mewbeatHandlerRef && mewbeatHandlerRef.current === handler) mewbeatHandlerRef.current = null;
    };
    // Once per tour: what it reads (the socket, whether the bot plays) is what it was when the tour began.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touring]);
  // The first run has mounted nothing yet, so it waits for the sample instead of starting a real link for a moment.
  if (tourWanted && !tourKit && firstRun) return null;
  const tourProps = touring
    ? { tour, tourKit, requests: tourKit.requests, mewbeatHandlerRef: undefined, onAction: NOOP, onPresence: undefined, onModeChange: NOOP, onTourNext: nextTour, onTourSkip: endTour, onTourPlay: playCalm, onTourAfter: startSecondPart, trapPrepRef, autoStart: null, onSoloBack: undefined }
    : { tour: null, tourKit: null, requests, onModeChange: setMode, autoStart, onAutoStartDone: clearAutoStart, onSoloBack: soloBack };
  return <PrivatePlace value={Boolean(context?.guildId?.startsWith("dm:"))}><MewbeatSession key={touring ? "tour" : mode} {...props} {...tourProps} onReplayTour={replayTour} minimized={minimized} mode={touring ? "solo" : mode} liveAvailable={liveAvailable} botPlaying={botPlaying} audio={audio} musicVolumeRef={musicVolumeRef} previewMusic={previewMusic} roomInviteRef={roomInviteRef} />{entryPose ? <div className="mb-entry-pose" aria-hidden="true"><Mewbit pose={entryPose} effects={settings?.effects} /></div> : null}</PrivatePlace>;
}

// A preview resolves the song on the bot first, which can take a while for a search result.
const PREVIEW_PREPARE_TIMEOUT_MS = 30_000;

function MewbeatSession({ mode, onModeChange, liveAvailable, botPlaying, audio, musicVolumeRef, previewMusic, requests, context, player, feed, settings, mewbeatHandlerRef, mewbeatSocketRef, onAction, onClose, onPresence, minimized, voiceChannelName, roomInviteRef, tour, tourKit, onTourNext, onTourSkip, onTourPlay, onTourAfter, onReplayTour, trapPrepRef, autoStart, onAutoStartDone, onSoloBack }) {
  // The first-run tour's session (Root keys it apart): fixed for its life, so effects may read it without re-running.
  const touring = tour !== null;
  const tourStep = touring ? TOUR_STEPS[tour] : null;
  const solo = mode === "solo";
  const roomMode = mode === "room" && !MOCK_PREVIEW;
  const userId = context?.user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const dialogRef = useRef(null);
  const menuButtonRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blockCalibration, setBlockCalibration] = useState(null); // the block calibration window: "activity" or "live"
  const [botClicks, setBotClicks] = useState(null); // the bot's clicks for it: "starting", "running" or "failed"
  const botClicksMineRef = useRef(false); // this player asked for them, so their run ends in the window, not in Results
  const [menuOpen, setMenuOpen] = useState(false); // the menu over Live, a room, or solo outside a run
  const [settingsFromMenu, setSettingsFromMenu] = useState(false);
  const [reportOpen, setReportOpen] = useState(false); // the "Report a bug" window, opened from the menu
  const [reportFromMenu, setReportFromMenu] = useState(false); // the menu comes back with focus on its Report button
  const [pickedSong, setPickedSong] = useState(null); // what song select has selected, for the minimized tile
  const [link] = useState(() => createLink(mode, mewbeatSocketRef, audio, () => userIdRef.current, touring));
  const [liveBoard] = useState(createLiveBoardStore);
  // A room's snapshots go to the store, which hands them on to the link (it loads and times the round).
  const [store] = useState(() => (roomMode ? createRoomStore({ requests, onRoom: (next, at) => link.setRoom(next, at), invite: roomInviteRef?.current ?? null, onInviteDone: () => { if (roomInviteRef) roomInviteRef.current = null; } }) : null));
  const linkState = useLinkState(link);
  const soloState = solo ? linkState : null;
  const roomLinkState = roomMode ? linkState : null;
  const roomStoreView = useRoomStore(store);
  const room = roomStoreView?.room ?? null;
  // A player whose chart failed can go back to the lobby while the others still load: they stay in the room and
  // the lobby shows the round going on without them, until the next round (a different number) takes them in again.
  const [satOutRound, setSatOutRound] = useState(null);
  const roomViewNow = roomMode ? roomView(room, userId, { prepared: Boolean(roomLinkState?.prepared) }) : null;
  const view = roomViewNow === "loading" && satOutRound != null && satOutRound === room?.round ? "watching" : roomViewNow;
  const me = roomMode ? memberOf(room, userId) : null;
  const [addOpen, setAddOpen] = useState(false); // the room's "add songs" picker
  const [leaveConfirm, setLeaveConfirm] = useState(null); // { target } while "Leave round?" is up
  const [actionNotice, setActionNotice] = useState(null);
  // The level picked on song select counts at once: it saves over HTTP while the song starts over the socket, and
  // a song whose chart is ready would otherwise start on the old level. Once nothing is saving, a new saved value
  // rules again (settings changed it); a save that failed leaves the pick in place for this session.
  const [pickedLevel, setPickedLevel] = useState(null);
  const levelSaves = useRef(0);
  const savedLevel = settings?.liveDifficulty ?? "normal";
  useEffect(() => {
    if (levelSaves.current === 0) setPickedLevel(null);
  }, [savedLevel]);
  const savedDifficulty = pickedLevel ?? savedLevel;
  const soloStage = soloState?.stage ?? null;
  const pauseOpen = solo && soloStage === "paused";
  // Settings and the report window open from the menu and cover it; closing them brings the menu back.
  // The tour's menu step shows it too (a copy nothing in it can press, see its render).
  const menuShown = (pauseOpen || menuOpen || Boolean(tourStep?.menu)) && !settingsOpen && !reportOpen;
  // Song select is up with no song, while a pick is being resolved, and after a pick the server refused
  // (which has no audioKey yet; an audio load failure has one and shows its message on the stage).
  // The tour shows song select or the play screen by its step.
  const pickerOpen = touring ? tourStep.view === "select" : solo && (soloStage === "idle" || soloStage === "preparing" || (soloStage === "error" && !soloState.audioKey));
  const tourGroup = tourStep?.settings ?? null; // the Settings group the tour has open behind it
  // The tour's trap (tour/trap.js): its phase, the two prepared songs, and the small player of their sound. While a
  // scene is on, its song is the track, its level the level, and the still link plays its notes as an autoplay.
  const [trapState, dispatchTrap] = useReducer(trapReducer, TRAP_IDLE);
  const trapPhase = trapState.phase;
  const trapResultRef = useRef(null);
  const [trapPlayer] = useState(() => createTrapPlayer(() => audio.ctx()));
  const sceneSong = trapResultRef.current?.[trapSceneOf(trapPhase)] ?? null;
  const sceneTrack = useMemo(() => (sceneSong ? { ...sceneSong.track, queued: false } : null), [sceneSong]);

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

  // `player` is the bot's player cut down to what this screen shows (App.jsx), so a state push that changes none of it
  // does not render the session; the clock-like fields come through `feed` instead.
  const current = player?.currentTrack ?? null;
  const trackId = current?.id ?? null;
  const title = current?.title ?? null;
  const artist = current?.author ?? null;
  const durationMs = current?.durationMs ?? 0;
  const artworkUrl = current?.artworkUrl ?? null;
  const queued = (player?.queueLength ?? 0) > 0;
  const liveTrackInfo = useMemo(
    () => (trackId === null ? null : { title, artist, durationMs, artworkUrl, queued }),
    [trackId, title, artist, durationMs, artworkUrl, queued]
  );
  const roomTrack = room?.current ?? null;
  const roomTitle = roomTrack?.title ?? null;
  const roomArtist = roomTrack?.artist ?? null;
  const roomDurationMs = roomTrack?.durationMs ?? 0;
  const roomArtworkUrl = roomTrack?.artworkUrl ?? null;
  const roomQueued = (room?.queue?.length ?? 0) > 0;
  const roomTrackInfo = useMemo(
    () => (roomTitle === null ? null : { title: roomTitle, artist: roomArtist, durationMs: roomDurationMs, artworkUrl: roomArtworkUrl, queued: roomQueued }),
    [roomTitle, roomArtist, roomDurationMs, roomArtworkUrl, roomQueued]
  );
  const trackInfo = touring ? sceneTrack : solo ? soloState?.track ?? null : roomMode ? roomTrackInfo : liveTrackInfo;
  // In a room the difficulty is the one picked in the lobby, and the run reports which round it belongs to.
  // Live and the Activity's own audio have different delays, so each has its offset. The game reads the one it plays to.
  const offsetField = mode === "live" ? "offsetMs" : "soloOffsetMs";
  const savedOffset = settings?.[offsetField] ?? 0;
  // Spectating: a watching member, or a player whose chart came too late, follows one player of the round on
  // the highway. The run is an autoplay of that player's difficulty; their numbers come from the live board.
  const spectating = roomMode && Boolean(roomLinkState?.spectating);
  const watchingLive = spectating && (roomLinkState?.stage === "countdown" || roomLinkState?.stage === "playing");
  const [watchedId, setWatchedId] = useState(null);
  const watchable = (room?.members ?? []).filter((member) => !member.spectator && (room.phase === "loading" || member.loaded));
  // If the player being watched leaves, the first one still there takes over.
  const target = watchable.find((member) => member.userId === watchedId) ?? watchable[0] ?? null;
  const targetDifficulty = target?.difficulty ?? null;
  const stepWatched = (by) => {
    const at = watchable.findIndex((member) => member.userId === target?.userId);
    const next = watchable[(at + by + watchable.length) % watchable.length];
    if (next) setWatchedId(next.userId);
  };
  const [boardEntries, setBoardEntries] = useState(null);
  useEffect(() => {
    if (!spectating) return undefined;
    setBoardEntries(liveBoard.entries());
    return liveBoard.subscribe(setBoardEntries);
  }, [spectating, liveBoard]);
  const targetEntry = boardEntries?.find((entry) => entry.userId === target?.userId) ?? null;
  // The modifiers picked on song select or in the lobby: shown and played at once, saved with the other settings
  // (the server's echo then takes over from the local copy).
  const [pickedModifiers, setPickedModifiers] = useState(null);
  const [modifiersOpen, setModifiersOpen] = useState(false);
  useEffect(() => setPickedModifiers(null), [settings?.modifiers]);
  const playerModifiers = pickedModifiers ?? settings?.modifiers ?? NO_MODIFIERS;
  const saveModifiers = useCallback((ids) => {
    setPickedModifiers(ids);
    onAction?.("mewbeat_settings", { settings: { modifiers: ids } });
  }, [onAction]);
  // Tell the room what this player picked so the others see the badges. The key is the list the member still lacks
  // (null = in sync); the ref keeps one send per list while it is in flight, and a rejoin (the server resets to none)
  // makes the key differ again, so it goes out once more. A refused send is not retried until the key changes.
  const sentModifiersRef = useRef(null);
  const toSend = roomMode && me && !me.spectator ? roomModifiersToSend(playerModifiers, me.modifiers) : null;
  const sendKey = toSend ? toSend.join(",") : null;
  useEffect(() => {
    if (!store) return;
    if (sendKey === null) {
      sentModifiersRef.current = null;
      return;
    }
    if (sentModifiersRef.current === sendKey) return;
    sentModifiersRef.current = sendKey;
    store.ready({ modifiers: sendKey ? sendKey.split(",") : [] });
  }, [store, sendKey]);
  const gameSettings = useMemo(
    () => ({
      ...settings,
      modifiers: playerModifiers,
      offsetMs: savedOffset,
      ...(pickedLevel ? { liveDifficulty: pickedLevel } : null),
      ...(sceneSong ? { liveDifficulty: sceneSong.level } : null), // the tour never saves a level: only the game's copy
      ...(roomMode && me?.difficulty ? { liveDifficulty: me.difficulty } : null),
      ...(spectating ? { spectating: true, ...(targetDifficulty ? { liveDifficulty: targetDifficulty } : null) } : null),
    }),
    [roomMode, settings, playerModifiers, savedOffset, pickedLevel, sceneSong, me?.difficulty, spectating, targetDifficulty]
  );
  const roomRound = roomLinkState?.playedRound ?? room?.round ?? null;
  const submitExtra = useMemo(() => (roomMode ? { round: roomRound } : null), [roomMode, roomRound]);
  // The lobby, spectating and joining screens own the keyboard (their buttons need Space and Enter); the game
  // only has it while a round is loading, counting down or running.
  const lobbyScreen = roomMode && (view === "none" || view === "lobby" || view === "watching") && !watchingLive;

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
    inputPaused: touring || settingsOpen || reportOpen || pauseOpen || menuOpen || pickerOpen || addOpen || Boolean(leaveConfirm) || lobbyScreen,
    minimized,
    touring,
    liveSession: liveSessionOf,
    submitExtra,
    onExit: () => exitRef.current(),
  });
  const { phase, chartWait, failed, failedHold, autoplay, retryCharting, hudStore, runDifficulty, swap, changeDifficulty, runSession, endSummary, poseStore, track, canvasRef, progressRef, progressTimeRef, effectsLevel, unlockAudio, soundReady, previewHit, previewSfx, playSfx, timing, resetTiming, calibrating, calibrationNotes } = game;

  // The trap, one phase at a time. The notes run on the still link (an autoplay: nothing is scored, sent or left in a
  // summary) and the sound on the trap's own player, from the same moment. Heavy: the chart plays for HEAVY_MS and the
  // cut comes. Joke: the music fades out in 100 ms, the clock freezes and the glitch plays; the tour is over for good once
  // the player presses a button. The sound starts at once, at a level measured on what it plays (trap.js).
  useEffect(() => {
    const song = trapResultRef.current?.[trapSceneOf(trapPhase)];
    if (trapPhase === "heavy" && song) {
      // The highway runs TRAP_PAUSE_MS before the music, so the player sees the notes coming; the sound starts that much
      // later and plays HEAVY_MS (song.chart has no note before song.fromMs, trimChart in trap.js).
      const startMs = Math.max(0, song.fromMs - TRAP_PAUSE_MS);
      link.playScene?.({ audioKey: song.audioKey, chart: song.chart, positionMs: startMs, durationMs: song.durationMs, at: performance.now() + START_LEAD_S * 1000 });
      trapPlayer.play(song.buffer, 0, 0, { musicVolume: musicVolumeRef.current, lengthMs: HEAVY_MS, delayMs: song.fromMs - startMs });
      const timer = window.setTimeout(() => dispatchTrap({ type: "cut" }), song.fromMs - startMs + HEAVY_MS);
      return () => window.clearTimeout(timer);
    }
    if (trapPhase === "joke") {
      trapPlayer.stop(CUT_FADE_MS);
      link.pauseScene?.();
      playSfx("glitch");
    }
    return undefined;
  }, [trapPhase, link, trapPlayer, musicVolumeRef, playSfx]);
  // The tour ends (Next on the last step, Skip, Escape) or the screen closes: the music fades out and goes.
  useEffect(() => () => trapPlayer.stop(), [trapPlayer]);

  // The last step's "Let's go" starts the trap, if both songs are ready by now and the sound can run (true then). Nothing
  // else says no: a missing socket, a song not found, a chart that failed or one still coming all mean the tour just
  // ends. The click unlocks the audio context so the sound can start at once.
  const beginTrap = () => {
    try { audio.unlock(); } catch { /* no sound, no trap */ }
    const prep = trapPrepRef?.current;
    const ready = prep?.result();
    if (!ready || botPlaying) return false;
    if (!prep.mock) {
      const ctx = audio.ctx();
      if (!ctx || ctx.state !== "running") return false;
    }
    trapResultRef.current = ready;
    dispatchTrap({ type: "begin", line: pickLine("trap") });
    return true;
  };
  const tourPrimary = () => {
    if (tour === END_INDEX && beginTrap()) return;
    onTourNext();
  };
  // "rude": the first part is over and the game opens on the calm song; the second part comes after it. The dev mock has
  // no real song to play, so there it goes straight on to the second part.
  const trapRude = () => {
    const calm = trapResultRef.current?.calm;
    if (calm?.uri) onTourPlay(calm);
    else {
      dispatchTrap({ type: "end" });
      onTourAfter();
    }
  };
  const unlockTourAudio = () => {
    unlockAudio();
    audio.unlock();
  };
  // The tour's session mounts on the player's first look at it, before any click: bring the sounds up now (the context
  // and the sample load start here), so the very first line already has its blips. A context the browser keeps asleep
  // until a gesture wakes on the first press.
  useEffect(() => {
    if (touring) unlockAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The calm song of the trap's "rude", started as a normal run: the same path as a pick on song select (the player's own
  // saved level, the count-in, scoring, Results). Taken once, by this session, on mount: a timer, so the development
  // double mount takes it only the second time; a song that cannot be started leaves the player on song select.
  useEffect(() => {
    if (!autoStart || !solo || touring) return undefined;
    const timer = window.setTimeout(() => {
      onAutoStartDone?.();
      // A song that cannot be started leaves the player on song select; the second part waits for the next map they play.
      pickSong({ uri: autoStart.uri, source: autoStart.source }).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back at song select after a run (it left the idle stage and came back to it): the tour's second part, when it is due.
  // A song that failed to start is not a run.
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (!solo || touring || !onSoloBack) return;
    if (soloStage === "error") wasBusyRef.current = false;
    else if (soloStage && soloStage !== "idle") wasBusyRef.current = true;
    else if (wasBusyRef.current) {
      wasBusyRef.current = false;
      onSoloBack();
    }
  }, [solo, touring, soloStage, onSoloBack]);
  const trapScreen = trapScreenOf(trapPhase);

  const playBotClicks = () => {
    botClicksMineRef.current = true;
    setBotClicks("starting");
    Promise.resolve(onAction?.("mewbeat_calibrate")).then((done) => {
      if (done === false) setBotClicks("failed");
    });
  };
  const openBlockCalibration = (kind) => {
    setBlockCalibration(kind);
    if (kind === "live") playBotClicks();
  };
  const closeBlockCalibration = () => {
    // The clicks would run on for everyone in the channel.
    if (blockCalibration === "live" && calibrating) onAction?.("skip", { quiet: true, ...(trackId ? { expectedTrackId: trackId } : {}) });
    else botClicksMineRef.current = false;
    setBlockCalibration(null);
    setBotClicks(null);
  };

  useEffect(() => {
    if (calibrationNotes) setBotClicks((current) => (current === "starting" ? "running" : current));
  }, [calibrationNotes]);
  // The player being watched has their own difficulty: while the run is on another one, swap its chart.
  useEffect(() => {
    if (!watchingLive || phase !== "playing" || !targetDifficulty || !runDifficulty || runDifficulty === targetDifficulty) return;
    changeDifficulty(targetDifficulty);
  }, [watchingLive, phase, targetDifficulty, runDifficulty, changeDifficulty]);
  // The add-songs window belongs to the lobby: when a round takes the screen it goes.
  useEffect(() => {
    if (addOpen && view !== "lobby") setAddOpen(false);
  }, [addOpen, view]);
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
    setReportFromMenu(false);
  };
  // A solo song that starts under the menu (it was opened while loading) is paused right away.
  useEffect(() => {
    if (menuOpen && soloRunning) {
      link.pause();
      setMenuOpen(false);
    }
  }, [menuOpen, soloRunning, link]);
  // A minimized window pauses a solo run; Live and Room go on. Back at full size it is the pause menu that waits, and
  // resuming (with its count-in) is the player's call.
  useEffect(() => {
    if (shouldAutoPause({ minimized, mode, stage: soloStage, ended: phase === "ended" })) link.pause();
  }, [minimized, mode, soloStage, phase, link]);
  // Esc opens the menu, except over a solo song that failed to load, where it goes back to song select.
  exitRef.current = () => {
    if (solo && soloStage === "error") link.leave();
    else openMenu();
  };

  // Song select's Play. The chosen difficulty becomes the live difficulty the game charts with. Rejects with
  // the server's reason when the song can't be prepared; begin() reports its own failures on the stage.
  const saveLevel = useCallback((next) => {
    setPickedLevel(next);
    levelSaves.current += 1;
    Promise.resolve(onAction?.("mewbeat_settings", { settings: { liveDifficulty: next } }))
      .catch(() => {})
      .finally(() => { levelSaves.current -= 1; });
  }, [onAction]);
  const pickSong = useCallback(async (picked, pickedDifficulty) => {
    if (pickedDifficulty && pickedDifficulty !== savedDifficulty) saveLevel(pickedDifficulty);
    const { audioKey, track: prepared } = await link.prepare({ uri: picked.uri, source: picked.source });
    link.begin(audioKey, prepared);
  }, [link, saveLevel, savedDifficulty]);
  // The results' "Suggested next": a solo player starts the song on the level it suggests (the saved one when the song
  // has no charts yet), through the same path as song select's Play. In a room it goes into the queue (addToRoom).
  const suggestSolo = useCallback((row) => pickSong(row, row.level && row.levelStars !== null ? row.level : undefined), [pickSong]);
  const suggestMock = useCallback(() => Promise.resolve(), []); // the dev preview has no bot to start anything
  // Song select's preview. The song is resolved without charting it, so browsing costs no analysis.
  const previewTokenRef = useRef(0);
  const previewSong = useCallback(async (row) => {
    const token = ++previewTokenRef.current;
    if (!row) {
      audio.stopClip();
      return false;
    }
    if (audio.playing()) return false; // a room round is on: its music stays alone
    // A song already decoded or downloaded needs no round trip to the bot.
    if (row.audioKey && audio.hasPreview(row.audioKey, row.highlightMs)) return audio.preview(row.audioKey, { fromMs: row.highlightMs });
    let reply;
    try {
      // With the song's audioKey the bot skips resolving it again. A failure is returned, so song select can say so.
      reply = await requests.request("mewbeat_solo_prepare", { uri: row.uri, source: row.source, audioKey: row.audioKey ?? undefined, preview: true }, PREVIEW_PREPARE_TIMEOUT_MS);
    } catch (error) {
      return token === previewTokenRef.current ? { error: error?.message || "The bot did not answer." } : false;
    }
    if (token !== previewTokenRef.current) return false;
    if (reply?.status !== "ok") return { error: reply?.reason || reply?.error || "The bot could not prepare this song." };
    return audio.preview(reply.audioKey, { fromMs: reply.highlightMs ?? row.highlightMs });
  }, [audio, requests]);
  // Called inside the click that picks a song row, so the browser lets the preview start later from a timer.
  const unlockPreview = useCallback(() => { audio.unlock(); }, [audio]);
  const backToGame = () => window.requestAnimationFrame(() => dialogRef.current?.focus());
  const startNext = async () => {
    if (endSummary) setDismissedId(endSummary.id);
    const reply = await store.start();
    if (reply?.status !== "ok") setActionNotice(roomErrorText(reply));
  };
  // The vote for the next map: casts it, or takes it back. The results stay open, the round only starts once the
  // server counts more than half of the players (or the host forced it).
  const voteNext = async () => {
    const reply = await store.ready({ ready: !me?.ready });
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
  const restartFromMenu = pauseOpen ? () => { link.restart(); closeMenu(); backToGame(); } : null;
  // A level picked in the pause menu restarts the map on it. The restart waits for the render that carries the new
  // level: the game charts with the level it read while rendering, so restarting in the click would chart the old one.
  const restartOnLevel = useRef(null);
  // The level lit is the one on stage, which a Settings change to the default does not move. Picking the saved default
  // while another level plays has no render to wait for: the game already charts with it.
  const menuLevel = runDifficulty ?? savedDifficulty;
  const changeLevelFromMenu = (next) => {
    if (next === menuLevel) return;
    if (next === savedDifficulty) {
      link.restart({ abandon: true });
      closeMenu();
      backToGame();
      return;
    }
    restartOnLevel.current = next;
    saveLevel(next);
  };
  useEffect(() => {
    if (restartOnLevel.current !== savedDifficulty) return;
    restartOnLevel.current = null;
    link.restart({ abandon: true });
    closeMenu();
    backToGame();
  }, [savedDifficulty]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc closes the menu (and resumes a paused run) wherever the focus is (a click on the scrim's blank part
  // leaves it outside the menu). The settings panel, when open, takes Esc first.
  useEffect(() => {
    if (!menuShown || touring) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      resumeRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [menuShown, touring]);

  // Esc in the "Leave round?" confirmation keeps playing, wherever the focus is.
  useEffect(() => {
    if (!leaveConfirm || settingsOpen || touring) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveConfirm(null);
      backToGame();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [leaveConfirm, settingsOpen, touring]);
  // The game's keys are paused on song select and the room's own screens, Esc among them, so it opens the menu from here.
  const ownScreen = lobbyScreen || pickerOpen;
  useEffect(() => {
    if (!ownScreen || touring || menuShown || settingsOpen || reportOpen || addOpen || leaveConfirm || modifiersOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ownScreen, touring, menuShown, settingsOpen, reportOpen, addOpen, leaveConfirm, modifiersOpen]);
  // Esc closes the "add songs" window wherever the focus is. The settings panel, when open, takes Esc first.
  useEffect(() => {
    if (!addOpen || settingsOpen || touring) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setAddOpen(false);
      backToGame();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [addOpen, settingsOpen, touring]);
  // An error shown in the lobby goes away once the lobby is left.
  useEffect(() => {
    if (view !== "lobby") setActionNotice(null);
  }, [view]);

  // Auto offset (this session only): every AUTO_OFFSET_EVERY new taps, a suggestion that differs
  // enough from the saved offset is saved as the offset.
  const [autoOffset, setAutoOffset] = useState(false);
  const appliedAtRef = useRef(0); // timing.total when auto offset last looked
  useEffect(() => {
    if (!autoOffset || timing.offsetMs === null || timing.total - appliedAtRef.current < AUTO_OFFSET_EVERY) return;
    appliedAtRef.current = timing.total;
    if (Math.abs(timing.offsetMs - savedOffset) < AUTO_OFFSET_MIN_CHANGE_MS) return;
    onAction?.("mewbeat_settings", { settings: { [offsetField]: timing.offsetMs } });
  }, [autoOffset, timing, savedOffset, offsetField, onAction]);

  // Closing the panel goes back to the menu it was opened from (which focuses its Settings button); otherwise
  // focus goes to the menu button.
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    audio.setVolume(musicGain(musicVolumeRef.current)); // drop any slider preview that was never saved
    if (!settingsFromMenu) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, [audio, musicVolumeRef, settingsFromMenu]);

  // The report window sits over the menu it came from; closing it brings the menu back with focus on Report a bug.
  const closeReport = useCallback(() => setReportOpen(false), []);
  const sendReport = useCallback(async ({ type, text, run }) => {
    if (!onAction) return false;
    try {
      const done = await onAction("mewbeat_report", {
        type,
        text,
        mode,
        song: trackInfo ? [trackInfo.title, trackInfo.artist].filter(Boolean).join(" - ") || null : null,
        level: runDifficulty ?? me?.difficulty ?? savedDifficulty,
        run, // a map report's run; the bot reads the song and result from its own record of it
      });
      return done !== false;
    } catch {
      return false;
    }
  }, [onAction, mode, trackInfo, runDifficulty, me?.difficulty, savedDifficulty]);

  // The bot sends an anchor on its own schedule; a pause, track change or seek in the state is a reason to ask now.
  // The feed is written by App on each state push (the position moves four times a second), outside React state.
  useEffect(() => {
    let prev = null;
    const check = () => {
      const { trackId: nextTrackId, paused, positionMs } = feed.get();
      const now = performance.now();
      const before = prev;
      prev = { trackId: nextTrackId, paused, positionMs, at: now };
      if (!before) return;
      const expected = before.positionMs + (before.paused ? 0 : now - before.at);
      if (before.trackId !== nextTrackId || before.paused !== paused || Math.abs(positionMs - expected) > POSITION_JUMP_MS) link.syncNow();
    };
    check();
    return feed.subscribe(check);
  }, [link, feed]);

  // Move focus into the dialog and keep Tab inside it.
  useEffect(() => {
    if (touring) return undefined; // the tour layer keeps focus and Tab on its own buttons
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key !== "Tab") return;
      // With the settings or report panel or the pause overlay open, Tab stays inside it.
      const root = dialogRef.current?.querySelector(".mb-settings, .mb-pause") ?? dialogRef.current;
      const buttons = [...(root?.querySelectorAll("button:not(:disabled), input, select, textarea") || [])];
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
  }, [touring]);

  const keys = Array.isArray(settings?.keys) && settings.keys.length === 4 ? settings.keys : DEFAULT_KEYS;
  const running = phase === "playing" || phase === "paused";
  // The card shows the difficulty of the chart on stage (it can differ from the saved default after a live change).
  const difficulty = runDifficulty ?? savedDifficulty;
  // Back (Live) hides the results of that run; the next run's summary has a new id and shows again. Solo keeps the
  // last summary around until the next run starts, so it only shows while the run it belongs to is on stage.
  const [dismissedId, setDismissedId] = useState(null);
  const cardPlace = roomMode ? view === "playing" || view === "lobby" : !solo || soloStage === "playing" || soloStage === "ended";
  // A song played to its end stays on stage for a moment before its results. Live has the next track to get to.
  const [heldId, setHeldId] = useState(null); // the summary whose moment is over
  // A lost run is held too, for less: the FAILED banner, then the results (Live keeps them back until the song is over).
  const lost = Boolean(endSummary?.failed) && !endSummary.calibration;
  const holdingCard = (Boolean(endSummary?.finished) || lost) && (solo || roomMode) && !endSummary.calibration && heldId !== endSummary.id;
  const heldSummaryId = holdingCard ? endSummary.id : null;
  const heldMs = lost ? FAILED_HOLD_MS : RESULTS_HOLD_MS;
  useEffect(() => {
    if (heldSummaryId == null) return undefined;
    const id = window.setTimeout(() => setHeldId(heldSummaryId), heldMs);
    return () => window.clearTimeout(id);
  }, [heldSummaryId, heldMs]);
  const endBanner = holdingCard && !lost ? (isFullCombo(endSummary) ? "FULL COMBO!" : "SONG COMPLETE") : null;
  // FAILED: over a lost run's hold, and for as long as Live keeps its results back.
  const failedBanner = (holdingCard && lost) || (mode === "live" && failed);
  const ownBotClicks = Boolean(endSummary?.calibration) && botClicksMineRef.current;
  useEffect(() => {
    if (!ownBotClicks) return;
    botClicksMineRef.current = false;
    setDismissedId(endSummary.id);
  }, [ownBotClicks, endSummary]);
  // A player who lost the round watches the rest of it before their results; Live waits for its song to end.
  const showCard = Boolean(endSummary) && !holdingCard && !failedHold && !(lost && watchingLive) && !ownBotClicks && dismissedId !== endSummary.id && !pickerOpen && cardPlace;
  // The hook keeps a finished run's numbers for its end card. Past that, the stage shows an empty run: the next song
  // spends a while loading and charting before its own run exists.
  // A run lost in Live keeps its numbers up beside the FAILED banner until the song (and its results) is over.
  const stagedShown = running || holdingCard || showCard || failedHold;
  // The health bar belongs to a run the player plays and can lose.
  const showHealth = stagedShown && !watchingLive && !spectating && !touring && !calibrating && !autoplay;
  // A spectator's stage follows the watched player, not the autoplay that draws their notes (the leaves read the HUD
  // themselves; this only says whom to follow).
  const watchVibe = watchingLive && typeof targetEntry?.vibe === "number" ? targetEntry.vibe : null;
  const watchFever = watchVibe !== null && Boolean(targetEntry.fever) && !targetEntry.ended;
  const follow = { store: hudStore, shown: stagedShown, watchVibe, watchFever };
  // Holding R restarts a solo song: during a run, on its pause menu and under its results. A lane bound to R keeps
  // the key while there are notes to hit.
  const restartAction = useRef(null);
  if (!solo || touring || settingsOpen || reportOpen || leaveConfirm || addOpen) restartAction.current = null;
  else if (pauseOpen) restartAction.current = restartFromMenu;
  else if (menuShown) restartAction.current = null;
  else if (showCard) restartAction.current = () => link.restart();
  else restartAction.current = !keys.includes("KeyR") && ["playing", "countin", "ended"].includes(soloStage) ? () => link.restart() : null;
  const [restartHeld, setRestartHeld] = useState(false);
  useEffect(() => {
    if (touring) return undefined; // R restarts nothing during the tour (restartAction is null then as well)
    const hold = createKeyHold({
      code: "KeyR",
      ms: RESTART_HOLD_MS,
      // Only typing blocks it: buttons don't use R.
      canStart: ({ target }) => Boolean(restartAction.current) && !(target instanceof HTMLElement && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)),
      onChange: setRestartHeld,
      onDone: () => restartAction.current?.(),
    });
    const onKeyDown = (event) => {
      if (!hold.keydown(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", hold.keyup, true);
    window.addEventListener("blur", hold.cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", hold.keyup, true);
      window.removeEventListener("blur", hold.cancel);
      hold.cancel();
    };
  }, [touring]);
  // What Discord shows for the player, sent every few seconds at most: it allows about 5 updates in 20 s.
  const presenceRef = useRef(null);
  // Built when it is sent, so the score is read from the store then and a judgement does not render the session.
  presenceRef.current = () => presenceOf({
    track,
    difficulty: runDifficulty,
    hud: hudStore.get(),
    summary: showCard ? endSummary : null,
    playing: running,
    paused: pauseOpen,
    autoplay: Boolean(game.autoplay),
    calibrating,
    spectating,
  });
  useEffect(() => {
    if (!onPresence) return undefined;
    let sent = "";
    const send = () => {
      const presence = presenceRef.current();
      const next = JSON.stringify(presence);
      if (next === sent) return;
      sent = next;
      onPresence(presence);
    };
    send();
    const id = window.setInterval(send, PRESENCE_MS);
    return () => {
      window.clearInterval(id);
      onPresence(null);
    };
  }, [onPresence]);
  useEffect(() => {
    if (endBanner === "FULL COMBO!") playSfx("full-combo");
  }, [endBanner, playSfx]);
  // The room's countdown to its next round, and Solo's count-in: each digit ticks, and the opening one ends on GO.
  const roomStartPerf = view === "lobby" && room?.nextAt != null
    ? serverToPerf(room.nextAt, { offsetMs: link.serverClock?.offsetMs?.() ?? null, serverNow: room.serverNow, receivedAtMs: roomStoreView.receivedAt })
    : null;
  useCountdownSounds({ startPerf: roomStartPerf, started: inRound, calm: showCard || holdingCard, play: playSfx });
  // What Results shows of the room's vote; its seconds only run once the vote passed or the host forced the start.
  const roomVote = roomMode && room
    ? (() => {
      const tally = voteOf(room);
      return { votes: tally.votes, needed: tally.needed, names: tally.voters.map((m) => m.username ?? m.name ?? "Player"), forced: tally.forced, startPerf: tally.counting ? roomStartPerf : null };
    })()
    : null;
  const soloCount = soloStage === "countin" ? soloState.count : null;
  const lastSoloCount = useRef(null);
  const [soloWent, setSoloWent] = useState(false); // the moment after a run's count, when Mewbit calls GO
  useEffect(() => {
    const counting = lastSoloCount.current != null;
    lastSoloCount.current = soloCount;
    const second = soloCount ?? (counting && soloStage === "playing" && soloState?.opening ? 0 : null);
    if (second == null) return;
    for (const { name, level } of countdownSounds(second)) playSfx(name, { level });
    if (second === 0) setSoloWent(true);
  }, [soloCount, soloStage, soloState?.opening, playSfx]);
  useEffect(() => {
    if (!soloWent) return undefined;
    const timer = window.setTimeout(() => setSoloWent(false), SOLO_GO_MS);
    return () => window.clearTimeout(timer);
  }, [soloWent]);
  // Mewbit on the board counts a solo run in, bumping and sending a ring out on every step, as in the room.
  const boardTick = soloCount ?? (soloWent ? 0 : null);
  const boardPose = soloCount >= 1 && soloCount <= 3 ? `count${soloCount}` : soloCount != null ? "hype" : soloWent ? "go" : null; // null: Mewbit follows the run's pose store
  // The results play the song's highlight, once the song itself is over. In Live the bot plays the music.
  // Keyed on the run, not the summary object: the score reply replaces that object and must not restart the music.
  const clipSummary = showCard && (solo || roomMode) && !endSummary.calibration ? endSummary : null;
  const clipId = clipSummary?.id ?? null;
  const clipAudioKey = clipSummary?.audioKey ?? null;
  const clipFromMs = clipSummary?.highlightMs ?? null;
  useEffect(() => {
    if (clipId === null || audio.loadedKey() !== clipAudioKey) return undefined;
    // An outro can still be playing: the highlight crossfades over it, however long it would have run.
    audio.highlight(clipFromMs);
    return () => audio.stopClip();
  }, [audio, clipId, clipAudioKey, clipFromMs]);
  const chartFailed = phase === "failed" || phase === "uncharted";
  // The detail line of a waiting card: while this player waits for a chart it says where the song stands and for how long
  // (ChartWaitLine); until then, and when nothing is waited for, it keeps the plain `text`.
  const waitingDetail = (text) => <ChartWaitLine store={chartWait} fallback={text} showAfterMs={CHART_WAIT_SHOW_MS} />;
  const sitOutToLobby = () => {
    setSatOutRound(room?.round ?? null);
    link.sitOut?.();
  };
  let stateCopy;
  if (failed && phase === "ended") stateCopy = null; // the banner says it
  else if (roomMode) {
    if (showCard || holdingCard) stateCopy = null;
    else if (view === "loading") {
      const { loaded, total } = loadedCount(room);
      if (roomLinkState?.prepared) stateCopy = { title: "Waiting for the others…", detail: `${loaded} of ${total} loaded` };
      else if (chartFailed) {
        stateCopy = {
          title: "This song can't be charted for you.",
          detail: "Try again, or sit this round out in the lobby.",
          actions: [
            { label: "Try again", icon: ArrowCounterClockwise, primary: true, onClick: retryCharting },
            { label: "Back to lobby", icon: House, onClick: sitOutToLobby },
          ],
        };
      }
      else stateCopy = { title: "Getting ready…", detail: waitingDetail("Loading the song and your chart.") };
    } else if (view === "playing" && phase === "ended") stateCopy = { title: "Song finished", detail: "Waiting for the others…" };
    else stateCopy = null;
  } else if (solo) {
    if (pickerOpen || showCard || holdingCard) stateCopy = null;
    else if (soloStage === "preparing" || soloStage === "loading") stateCopy = SOLO_STAGE_COPY[soloStage];
    else if (soloStage === "error") stateCopy = { title: soloState.error, detail: "Press Esc to pick another song." };
    // "paused" is the pause overlay or the count-in, which have their own copy.
    else if (phase === "paused") stateCopy = null;
    else {
      stateCopy = SOLO_PHASE_COPY[phase] ?? PHASE_COPY[phase];
      if (phase === "charting" && stateCopy) stateCopy = { ...stateCopy, detail: waitingDetail(stateCopy.detail) };
      if (chartFailed && stateCopy) {
        stateCopy = {
          ...stateCopy,
          actions: [
            { label: "Try again", icon: ArrowCounterClockwise, primary: true, onClick: retryCharting },
            { label: "Song select", icon: MusicNotesSimple, onClick: () => link.leave() },
          ],
        };
      }
    }
  } else {
    // A run that ended with no card (joined in its last second) just waits.
    stateCopy = showCard ? null : phase === "ended" ? { title: "Waiting for the next track…" } : PHASE_COPY[phase];
    if (phase === "charting" && stateCopy) stateCopy = { ...stateCopy, detail: waitingDetail(stateCopy.detail) };
    // Live follows the bot's song and has no screen to go back to (Esc opens the menu with Quit), so only a retry.
    if (chartFailed && stateCopy) stateCopy = { ...stateCopy, actions: [{ label: "Try again", icon: ArrowCounterClockwise, primary: true, onClick: retryCharting }] };
  }

  // Screens fade out instead of vanishing: each stays mounted for screenOutMs after its condition turns false
  // (effects off and reduced motion skip that). The scene they cover stays laid out under them while one fades in or out.
  const reducedMotion = usePrefersReducedMotion();
  const screenOutMs = effectsLevel === "off" || reducedMotion ? 0 : SCREEN_OUT_MS;
  // The lobby is not mounted while a round's results are up: the results let the song's scene show through, so a lobby
  // in the same cell showed through them too.
  const lobbyEl = roomMode && room && (view === "lobby" || view === "watching") && !watchingLive && !holdingCard && !showCard ? (
    <Lobby
      room={room}
      userId={userId}
      view={view}
      receivedAt={roomStoreView.receivedAt}
      serverClock={link.serverClock}
      store={store}
      request={requests.request}
      board={liveBoard}
      standings={standingsOf(room, userId)}
      modifiers={playerModifiers}
      onModifiers={saveModifiers}
      onModifiersOpen={setModifiersOpen}
      effects={effectsLevel}
      showMewbit={settings?.showMewbit !== false}
      keys={keys}
      offsetMs={savedOffset}
      notice={roomLinkState?.error ?? actionNotice ?? (roomStoreView?.inviteExpired ? roomErrorText("invite_expired") : null)}
      sdk={context?.sdk ?? null}
      onAddSongs={() => setAddOpen(true)}
      onCalibrate={() => { setSettingsFromMenu(false); setSettingsOpen(true); }}
    />
  ) : null;
  // The tour's room step: the real lobby on a sample room, with a store that changes nothing.
  const tourLobbyEl = touring && tourStep.view === "lobby" ? (
    <Lobby
      room={tourKit.room.room}
      userId={tourKit.userId}
      view="lobby"
      receivedAt={tourKit.room.receivedAt}
      serverClock={null}
      store={tourKit.roomStore}
      request={requests.request}
      board={null}
      standings={standingsOf(tourKit.room.room, tourKit.userId)}
      effects={effectsLevel}
      showMewbit={settings?.showMewbit !== false}
      keys={keys}
      offsetMs={savedOffset}
      notice={null}
      onAddSongs={NOOP}
      onCalibrate={NOOP}
    />
  ) : null;
  const lobbyFade = useScreenExit(lobbyEl ?? tourLobbyEl, screenOutMs);
  const joinEl = roomMode && view === "none" ? (
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
  ) : null;
  const joinFade = useScreenExit(joinEl, screenOutMs);
  const resultsEl = showCard ? (
    <Results
      key={endSummary.id}
      summary={endSummary}
      mode={mode}
      phase={phase}
      effects={effectsLevel}
      onSound={playSfx}
      active={!settingsOpen && !reportOpen && !menuShown && !leaveConfirm && !addOpen}
      queued={Boolean(track?.queued)}
      upNext={roomMode ? upNextOf(room) : !solo && player?.nextTitle ? { title: player.nextTitle, ready: false } : null}
      standings={roomMode ? standingsOf(room, userId) : null}
      request={requests.request}
      userId={userId}
      onNext={roomMode && view === "lobby" && me && !me.spectator && (room?.queue?.length ?? 0) > 0 ? voteNext : undefined}
      nextOn={Boolean(me?.ready)}
      nextLabel="Play next"
      nextCount={roomVote ? `${roomVote.votes}/${roomVote.needed}` : null}
      vote={roomVote}
      onForce={roomMode && view === "lobby" && room?.hostId === userId && (room?.queue?.length ?? 0) > 0 ? startNext : undefined}
      forceLabel={room?.finalCountdown ? "Start now" : "Force start"}
      onSuggest={solo ? suggestSolo : roomMode && view === "lobby" ? addToRoom : MOCK_PREVIEW ? suggestMock : undefined}
      suggestLabel={roomMode ? "Add" : "Play"}
      suggestDoneLabel={roomMode ? "Added" : null}
      timing={timing}
      savedOffset={savedOffset}
      onApplyOffset={(offsetMs) => onAction?.("mewbeat_settings", { settings: { [offsetField]: offsetMs } })}
      onBack={() => { setDismissedId(endSummary.id); if (solo) onSoloBack?.(); }}
      onSongSelect={solo ? () => link.leave() : undefined}
      onRestart={solo ? () => link.restart() : undefined}
    />
  ) : null;
  const resultsFade = useScreenExit(resultsEl, screenOutMs);
  // The tour's picker runs on the sample replies with its song already picked; it previews and plays nothing.
  const pickerEl = pickerOpen ? (
    <SongSelect
      context={touring ? null : context}
      request={requests.request}
      player={{ userId: touring ? tourKit.userId : userId }}
      defaultDifficulty={savedDifficulty}
      startSelectedKey={touring ? tourKit.selectedKey : null}
      onPlay={touring ? NOOP_ASYNC : pickSong}
      onPreview={touring ? undefined : previewSong}
      onUnlockAudio={touring ? undefined : unlockPreview}
      onSelected={setPickedSong}
      modifiers={touring ? NO_MODIFIERS : playerModifiers}
      onModifiers={touring ? NOOP : saveModifiers}
      onModifiersOpen={setModifiersOpen}
    />
  ) : null;
  const pickerFade = useScreenExit(pickerEl, screenOutMs);
  const screenUp = Boolean(lobbyEl || tourLobbyEl || joinEl || resultsEl || pickerEl);
  const screenLeaving = lobbyFade.leaving || joinFade.leaving || resultsFade.leaving || pickerFade.leaving;
  const [screenWasUp, setScreenWasUp] = useState(screenUp);
  const [screenEntering, setScreenEntering] = useState(false);
  if (screenUp !== screenWasUp) {
    setScreenWasUp(screenUp);
    if (screenUp) setScreenEntering(true);
  }
  useEffect(() => {
    if (!screenEntering) return undefined;
    const timer = window.setTimeout(() => setScreenEntering(false), SCREEN_IN_MS);
    return () => window.clearTimeout(timer);
  }, [screenEntering]);
  const stageUnder = screenOutMs > 0 && (screenEntering || (!screenUp && screenLeaving));

  // The minimized window shows a tile in place of the stage. The run, the audio and the socket go on under it; only the
  // drawing stops (the highway, the backdrop, Mewbit).
  const songFraction = useSongFraction(link, track?.durationMs ?? 0);
  const tileKind = tileOf({ mode, running });
  let tileEl = null;
  if (minimized) {
    const tileSong = pickerOpen && pickedSong ? pickedSong : track ?? (endSummary ? { title: endSummary.title, artist: endSummary.artist, artworkUrl: endSummary.artworkUrl } : null);
    if (tileKind === "paused" || tileKind === "live") {
      tileEl = <RunTile kind={tileKind} hudStore={hudStore} board={liveBoard} meId={userId} songFraction={songFraction} title={track?.title ?? ""} artworkUrl={track?.artworkUrl ?? null} />;
    } else if (tileKind === "lobby") {
      const head = room?.queue?.[0];
      tileEl = <PlainTile kind="lobby" room={voiceChannelName || "Room"} ready={readyOf(room)} next={head ? { title: head.title ?? "Untitled", artworkUrl: head.artworkUrl ?? null } : null} effects={effectsLevel} />;
    } else {
      tileEl = <PlainTile kind="select" title={tileSong?.title ?? (pickerOpen ? "Pick a song" : "mewbeat")} artist={tileSong?.artist ?? ""} artworkUrl={tileSong?.artworkUrl ?? null} effects={effectsLevel} />;
    }
  }

  return (
    <div
      className={`mb-game mb-fx-${effectsLevel}${minimized ? " mb-game-min" : ""}`}
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
        unlockAudio();
        if (roomMode) audio.unlock();
      }}
    >
      {tileEl}
      <header className="mb-header">
        <div className="mb-header-brand">
          <span className="mb-wordmark">mewbeat</span>
          <UnrankedChip store={hudStore} show={running && !watchingLive} />
          {calibrating && running ? <span className="mb-chip">calibration · tap any key on each click · {timing.taps}/{MIN_TAPS}</span> : null}
        </div>
        <div className="mb-modes" role="group" aria-label="Mode">
          {MODES.map(({ id, label }) => {
            const active = id === mode;
            const disabled = !active && ((id === "live" && !liveAvailable) || ((id === "solo" || id === "room") && MOCK_PREVIEW));
            return (
              <button
                key={id}
                type="button"
                data-tour={id}
                className={`mb-mode${active ? " mb-mode-on" : ""}`}
                aria-pressed={active}
                disabled={disabled}
                title={disabled ? (id === "live" ? "The bot isn't playing anything" : "Not available in the mock preview") : undefined}
                onClick={active ? undefined : () => (roomMode ? requestLeave(id) : onModeChange(id))}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mb-header-actions">
          {solo && botPlaying ? <span className="mb-hint">Lower MewBit in Discord to hear the song</span> : null}
          {roomMode && room ? (
            <button type="button" className="mb-btn" onClick={() => requestLeave(fallbackMode)}>
              <SignOut size={16} weight="bold" aria-hidden="true" /> Leave room
            </button>
          ) : null}
          {menuShown ? null : (
            <button type="button" className="mb-btn" ref={menuButtonRef} aria-haspopup="dialog" onClick={openMenu}>
              {running ? <Pause size={16} weight="bold" aria-hidden="true" /> : <List size={16} weight="bold" aria-hidden="true" />}
              {running ? "Pause" : "Menu"} <kbd className="mb-kbd">Esc</kbd>
            </button>
          )}
        </div>
      </header>

      <StageHost {...follow} effects={effectsLevel} under={stageUnder}>
        {minimized ? null : <StageBackdrop {...follow} track={track} hold={phase === "playing"} />}
        {minimized ? null : <FeverBanner {...follow} />}
        {endBanner ? <div className="mb-feverbanner mb-endbanner" role="status">{endBanner}</div> : null}
        <FailedBanner show={failedBanner} />
        {minimized ? null : <MissFlash store={hudStore} watching={watchingLive} effects={effectsLevel} poseStore={poseStore} />}
        <div className="mb-scene">
          <div className="mb-char">
            {settings?.showMewbit === false || minimized ? null : (
              <div className="mb-char-box">
                <Aura {...follow} />
                <div className={`mb-lobby-mewbox${boardTick != null ? ` mb-lobby-beat-${boardTick % 2 ? "a" : "b"}` : ""}`}>
                  {boardTick != null ? <span key={boardTick} className="mb-lobby-ring mb-lobby-ring-final" aria-hidden="true" /> : null}
                  <BoardMewbit poseStore={poseStore} override={boardPose} effects={effectsLevel} />
                </div>
              </div>
            )}
          </div>

          <div className="mb-highway-slot">
            <HealthBar store={hudStore} shown={stagedShown} show={showHealth} effects={effectsLevel} />
            <div className={`mb-highway${mode === "live" && failed ? " mb-highway-lost" : ""}`}>
              <canvas className={`mb-canvas${failed && !spectating ? " mb-canvas-failed" : ""}`} ref={canvasRef} aria-hidden="true" />
              <div className="mb-keys" aria-hidden="true" data-tour="keys">
                {keys.map((code) => (
                  <kbd key={code} className="mb-kbd mb-lanekey">{keyLabel(code)}</kbd>
                ))}
              </div>
              <FeverTime {...follow} />
              {running ? <Readout {...follow} watching={watchingLive} combo={targetEntry?.combo ?? 0} /> : null}
              {soloStage === "countin" ? (
                <div className="mb-countin" role="status" aria-live="assertive">
                  <b key={soloState.count}>{soloState.count}</b>
                </div>
              ) : null}
              {stateCopy ? (
                <div className="mb-state" role="status">
                  <b>{stateCopy.title}</b>
                  {stateCopy.detail ? <span>{stateCopy.detail}</span> : null}
                  {stateCopy.actions ? (
                    <div className="mb-state-actions">
                      {stateCopy.actions.map(({ label, icon: Icon, primary, onClick }) => (
                        <button key={label} type="button" className={`mb-btn${primary ? " mb-btn-primary" : ""}`} onClick={onClick}>
                          <Icon size={16} weight="bold" aria-hidden="true" /> {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {watchingLive ? null : <StagedFeverBar store={hudStore} shown={stagedShown} />}
          </div>

          <aside className="mb-side">
            <div className={`mb-board mb-lv-${difficulty}`}>
              <TrackCard track={track} difficulty={difficulty} progressRef={progressRef} progressTimeRef={progressTimeRef} disabled={!running || calibrating} swap={swap} onDifficulty={mode === "live" ? changeDifficulty : undefined} />
              {watchingLive ? <SpectateCard target={target} players={watchable} entry={targetEntry} onStep={stepWatched} /> : <StagedGameHud store={hudStore} shown={stagedShown} />}
              {(mode === "live" || roomMode) && (running || failedHold) ? <LiveBoard store={liveBoard} session={watchingLive ? "room" : runSession} meId={context?.user?.id ?? null} /> : null}
            </div>
          </aside>
        </div>
      </StageHost>

      <ScreenSlot screen={lobbyFade} />

      <ScreenSlot screen={joinFade} />

      <ScreenSlot screen={resultsFade} dead={{ active: false }} />

      <ScreenSlot screen={pickerFade} />

      {roomMode && addOpen ? (
        // A window over the lobby, so the room stays in view while songs are added.
        <div className="mb-add-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) { setAddOpen(false); backToGame(); } }}>
          <div className="mb-add-window" role="dialog" aria-modal="true" aria-label="Add songs to the room">
            <SongSelect
              context={context}
              request={requests.request}
              onAddToRoom={addToRoom}
              onPreview={previewSong}
              onUnlockAudio={unlockPreview}
              onClose={() => { setAddOpen(false); backToGame(); }}
            />
          </div>
        </div>
      ) : null}

      {restartHeld ? (
        <div className="mb-restart-hold" role="status" style={{ "--mb-hold-ms": `${RESTART_HOLD_MS}ms` }}>
          <ArrowCounterClockwise size={14} weight="bold" aria-hidden="true" /> Hold to restart
          <i aria-hidden="true" />
        </div>
      ) : null}

      {leaveConfirm ? (
        <LeaveConfirm onStay={() => { setLeaveConfirm(null); backToGame(); }} onLeave={() => leaveRoom(leaveConfirm.target)} />
      ) : null}

      {menuShown ? (
        <GameMenu
          quiet={touring}
          title={pauseOpen ? "Paused" : "Menu"}
          note={running && !solo ? (roomMode ? "The round keeps going." : "The song keeps playing in voice.") : null}
          error={pauseOpen ? soloState.error : null}
          focusButton={settingsFromMenu ? "settings" : reportFromMenu ? "report" : null}
          onResume={touring ? NOOP : resumeFromMenu}
          onRestart={restartFromMenu ?? undefined}
          level={restartFromMenu && solo ? menuLevel : undefined}
          onLevel={restartFromMenu && solo ? changeLevelFromMenu : undefined}
          onPick={solo && !pickerOpen ? () => { link.leave(); closeMenu(); backToGame(); } : undefined}
          onSettings={touring ? NOOP : () => { setSettingsFromMenu(true); setSettingsOpen(true); }}
          onReport={touring ? NOOP : () => { setReportFromMenu(true); setReportOpen(true); }}
          onExit={touring ? NOOP : () => {
            closeMenu();
            if (roomMode) requestLeave("close");
            else onClose();
          }}
        />
      ) : null}
      {settingsOpen && blockCalibration ? <CalibrationPanel
          audio={audio}
          settings={settings}
          live={blockCalibration === "live" ? { notes: calibrationNotes, songTimeAt: link.songClock.songTimeAt, request: botClicks, onReplay: playBotClicks } : null}
          onApply={(offsetMs) => onAction?.("mewbeat_settings", { settings: { [blockCalibration === "live" ? "offsetMs" : "soloOffsetMs"]: offsetMs } })}
          onClose={closeBlockCalibration}
        /> : null}
      {(settingsOpen || tourGroup) && !blockCalibration ? <SettingsPanel
          onBlockCalibration={openBlockCalibration}
          settings={settings}
          onAction={onAction}
          onClose={touring ? NOOP : closeSettings}
          forcedGroup={tourGroup}
          onReplayTour={touring ? undefined : () => { closeSettings(); closeMenu(); onReplayTour(); }}
          replayTourBlocked={mode === "room"}
          timing={timing}
          autoOffset={autoOffset}
          onAutoOffset={setAutoOffset}
          onResetTiming={resetTiming}
          onPreviewHit={previewHit}
          onPreviewSfx={previewSfx}
          onPreviewMusic={previewMusic}
          liveCalibration={mode === "live"}
          offsetField={offsetField}
        /> : null}
      {reportOpen ? <ReportPanel onSend={sendReport} onClose={closeReport} request={mockRequest ?? requests.request} /> : null}
      {touring ? <TourLayer step={tourStep} keys={keys.map(keyLabel)} effects={effectsLevel} onNext={tourPrimary} onSkip={onTourSkip} playSfx={playSfx} unlockAudio={unlockTourAudio} soundReady={soundReady} trap={trapScreen ? { screen: trapScreen, line: trapState.line, onRude: trapRude } : null} /> : null}
    </div>
  );
}
