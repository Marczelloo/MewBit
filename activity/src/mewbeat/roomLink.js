import { createMewbeatLink } from "./link.js";
import { createServerClock } from "./clock.js";
import { createSoloClock } from "./soloLink.js";
import { memberOf, roundActive, startPerfMs } from "./room.js";

// The run starts this long before the audio is due, so the game is already "playing" when the first
// sound comes out; the clock reads 0 until then.
const RESUME_LEAD_MS = 40;
// A start that is already in the past plays from where the song would be now, plus the audio's own lead.
const LATE_LEAD_MS = 60;

const IDLE_STATE = { stage: "idle", round: null, audioKey: null, error: null, prepared: false, startPerf: null, playedRound: null };

// The link of a room round. Same surface as createSoloLink/createMewbeatLink, so useMewbeatGame runs
// unchanged on it. It is driven by room snapshots (setRoom):
//   loading   -> download + decode the song, anchor the game on a paused clock at 0 so it charts my
//                difficulty; once the game took the chart, tell the server (mewbeat_room_loaded)
//   countdown -> start the audio exactly at startAt, mapped onto the audio clock
//   anything else (the round ended, I left, a new round) drops the run.
//
// Stages: idle -> loading -> ready (anchored, waiting for the chart) -> waiting (chart taken, "loaded"
// sent) -> countdown -> playing -> ended; "error" carries a message (the audio could not start).
export function createRoomLink({
  send,
  audio,
  getUserId = () => null,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const serverClock = createServerClock();
  const soloClock = createSoloClock(audio);
  const inner = createMewbeatLink({ send, now, setTimer, clearTimer, serverClock, songClock: soloClock });
  const anchorListeners = new Set();
  const stateListeners = new Set();
  let state = IDLE_STATE;
  let latest = null; // { room, receivedAt } of the newest snapshot
  let engaged = null; // the round this client is loading / playing
  let scheduled = false; // the audio start of the engaged round is set
  let token = 0; // bumps whenever a round is abandoned, so late async results are dropped
  let startTimer = null;
  let counter = 0;
  let failedRound = null; // a round whose audio did not load: not retried on every snapshot

  function setState(patch) {
    state = { ...state, ...patch };
    for (const fn of [...stateListeners]) fn(state);
  }

  function emitAnchor(result) {
    for (const fn of [...anchorListeners]) fn(result);
  }

  function clearStartTimer() {
    clearTimer(startTimer);
    startTimer = null;
  }

  // Drops whatever round this client was in: the audio stops and the game drops its run.
  function abandon(patch = {}) {
    token += 1;
    clearStartTimer();
    engaged = null;
    scheduled = false;
    audio.stop();
    const had = Boolean(soloClock.audioKey());
    soloClock.set({ key: null, paused: true, positionMs: 0 });
    setState({ ...IDLE_STATE, playedRound: state.playedRound, ...patch });
    if (had) emitAnchor("clear");
  }

  async function begin(room) {
    audio.unlock?.();
    // Leaving a previous round's song: the game drops its run before the new one is charted.
    abandon();
    const mine = token;
    const audioKey = room.current.audioKey;
    engaged = room.round;
    setState({ stage: "loading", round: room.round, audioKey });
    let loaded;
    try {
      loaded = await audio.load(audioKey);
    } catch {
      if (mine !== token) return;
      // Not reported as loaded: the server leaves this player out of the round.
      failedRound = room.round;
      abandon({ error: "Couldn't load the song audio." });
      return;
    }
    if (mine !== token) return;
    soloClock.set({ key: audioKey, paused: true, positionMs: 0, durationMs: loaded.durationMs });
    setState({ stage: "ready" });
    emitAnchor("init");
  }

  // The game calls this once it accepted my chart and built its run on the paused clock. Only then is this
  // client ready for the countdown, and only a round still in its loading phase can take the report.
  function chartAccepted() {
    if (state.stage !== "ready") return;
    const phase = latest?.room?.phase;
    if (phase !== "loading" || latest.room.round !== engaged) {
      // Too late: the server already moved on without this player.
      setState({ stage: "waiting", prepared: false });
      return;
    }
    setState({ stage: "waiting", prepared: true });
    // The server answers every room request, so it needs an id (the reply itself is of no interest).
    send({ type: "mewbeat_room_loaded", id: `rl${++counter}`, audioKey: state.audioKey });
  }

  // Sets the audio start for the engaged round's startAt and the run's resume a moment before it.
  function schedule(room, receivedAt) {
    scheduled = true;
    const startPerf = startPerfMs(room.startAt, { offsetMs: serverClock.offsetMs(), serverNow: room.serverNow, receivedAtMs: receivedAt });
    if (startPerf == null) {
      scheduled = false;
      return;
    }
    const mine = token;
    const nowPerf = now();
    setState({ stage: "countdown", startPerf, playedRound: room.round });
    const late = nowPerf >= startPerf - 5;
    const play = late
      ? audio.play(Math.max(0, nowPerf - startPerf) + LATE_LEAD_MS)
      : audio.play(0, startPerf);
    Promise.resolve(play).then(null, () => {
      if (mine !== token) return;
      abandon({ error: "The audio couldn't start. Tap the screen and join the next round." });
    });
    const resume = () => {
      startTimer = null;
      if (mine !== token || state.stage !== "countdown") return;
      soloClock.set({ paused: false, positionMs: 0 });
      setState({ stage: "playing" });
      emitAnchor("resume");
    };
    const wait = startPerf - RESUME_LEAD_MS - nowPerf;
    if (wait <= 0) resume();
    else startTimer = setTimer(resume, wait);
  }

  function drive() {
    if (!latest) return;
    const { room, receivedAt } = latest;
    const userId = getUserId();
    const me = memberOf(room, userId);
    const inRound = roundActive(room) && room.current && me && !me.spectator;
    // The round ended, a new one started, or I left it: the run is dropped (its Results stay with the game).
    if (engaged != null && (!inRound || room.round !== engaged)) abandon();
    if (!inRound) return;
    if (engaged == null && room.phase === "loading" && failedRound !== room.round) {
      begin(room);
      return;
    }
    if (engaged === room.round && !scheduled && state.stage === "waiting" && state.prepared && me.loaded && (room.phase === "countdown" || room.phase === "playing") && Number.isFinite(room.startAt)) {
      schedule(room, receivedAt);
    }
  }

  // A new room snapshot (or null after leaving). `receivedAt` is when it arrived, in now()'s time.
  function setRoom(room, receivedAt = now()) {
    latest = room ? { room, receivedAt } : null;
    if (!room) {
      if (engaged != null || state.stage !== "idle") abandon();
      return;
    }
    drive();
  }

  // The player leaves the round (or the room) on their own.
  function leaveRound() {
    latest = null;
    abandon();
  }

  let offEnded = null;
  function start() {
    offEnded?.();
    offEnded = audio.onEnded?.(() => {
      if (state.stage === "playing") setState({ stage: "ended" });
    });
    inner.start();
  }

  function stop() {
    token += 1;
    clearStartTimer();
    audio.stop();
    offEnded?.();
    offEnded = null;
    inner.stop();
  }

  return {
    start,
    stop,
    handle: inner.handle,
    syncNow: inner.syncNow,
    requestChart: inner.requestChart,
    chartAccepted,
    songClock: soloClock,
    status: inner.status,
    onAnchor: (fn) => {
      anchorListeners.add(fn);
      return () => anchorListeners.delete(fn);
    },
    onChart: inner.onChart,
    onStatus: inner.onStatus,
    setTrackInfo: inner.setTrackInfo,
    track: inner.track,
    // room controls
    setRoom,
    leaveRound,
    serverClock,
    state: () => state,
    onState: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    audio,
  };
}
