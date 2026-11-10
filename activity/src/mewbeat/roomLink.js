import { createMewbeatLink } from "./link.js";
import { createServerClock } from "./clock.js";
import { createSoloClock } from "./soloLink.js";
import { memberOf, roundActive, startPerfMs } from "./room.js";

// The run starts this long before the audio is due, so the game is already "playing" when the first
// sound comes out.
const RESUME_LEAD_MS = 40;
// A start that is already in the past plays from where the song would be now, plus the audio's own lead.
const LATE_LEAD_MS = 60;

const IDLE_STATE = { stage: "idle", round: null, audioKey: null, error: null, prepared: false, spectating: false, startPerf: null, playedRound: null };

// The link of a room round. Same surface as createSoloLink/createMewbeatLink, so useMewbeatGame runs
// unchanged on it. It is driven by room snapshots (setRoom):
//   loading   -> download + decode the song, anchor the game on a paused clock before the song so it charts
//                my difficulty; once the game took the chart, tell the server (mewbeat_room_loaded)
//   countdown -> run the clock from startAt, mapped onto the audio clock; the song follows after room.silenceMs
//   anything else (the round ended, I left, a new round) drops the run.
// A spectator (or a player whose chart came too late) engages the same way but in any active phase, never
// reports "loaded", and joins the audio wherever the song is: the game runs an autoplay chart for them.
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

  async function begin(room, spectate = false) {
    audio.unlock?.();
    // Leaving a previous round's song: the game drops its run before the new one is charted.
    abandon();
    const mine = token;
    const audioKey = room.current.audioKey;
    engaged = room.round;
    setState({ stage: "loading", round: room.round, audioKey, spectating: spectate });
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
    soloClock.set({ key: audioKey, paused: true, positionMs: -(room.silenceMs ?? 0), durationMs: loaded.durationMs });
    setState({ stage: "ready" });
    emitAnchor("init");
  }

  // The game calls this once it accepted my chart and built its run on the paused clock. Only then is this
  // client ready for the countdown, and only a round still in its loading phase can take the report.
  function chartAccepted(chart) {
    if (state.stage !== "ready") return;
    if (chart?.notes) audio.align?.(chart.notes.map((note) => note.t));
    if (state.spectating) {
      // A spectator is never counted as loaded: just wait for the start to join the audio.
      setState({ stage: "waiting", prepared: false });
      drive();
      return;
    }
    const phase = latest?.room?.phase;
    if (phase !== "loading" || latest.room.round !== engaged) {
      // Too late: the server already moved on without this player, so the round is only watched from here.
      setState({ stage: "waiting", prepared: false, spectating: true });
      drive();
      return;
    }
    setState({ stage: "waiting", prepared: true });
    // The server answers every room request, so it needs an id (the reply itself is of no interest).
    send({ type: "mewbeat_room_loaded", id: `rl${++counter}`, audioKey: state.audioKey });
  }

  // Sets the audio start for the engaged round's startAt and the run's resume a moment before it. The
  // round's clock starts at startAt with the silence before the song, so the sound itself comes after it.
  function schedule(room, receivedAt) {
    scheduled = true;
    const silence = room.silenceMs ?? 0;
    const startPerf = startPerfMs(room.startAt, { offsetMs: serverClock.offsetMs(), serverNow: room.serverNow, receivedAtMs: receivedAt });
    if (startPerf == null) {
      scheduled = false;
      return;
    }
    const mine = token;
    const nowPerf = now();
    setState({ stage: "countdown", startPerf, playedRound: room.round });
    const late = nowPerf >= startPerf - 5;
    const fromMs = Math.max(0, nowPerf - startPerf) + LATE_LEAD_MS - silence;
    // A spectator who joins a song in progress: the paused clock reads where the song is now and the run
    // jumps there before it resumes, so the autoplay does not burst through everything it "missed".
    const catchUp = late && state.spectating;
    if (catchUp) {
      soloClock.set({ positionMs: fromMs });
      emitAnchor("snap");
    }
    const play = late ? audio.play(fromMs) : audio.play(-silence, startPerf);
    Promise.resolve(play).then(null, () => {
      if (mine !== token) return;
      // Not retried on every snapshot: a spectator would otherwise re-engage the same round at once.
      failedRound = room.round;
      abandon({ error: "The audio couldn't start. Tap the screen and join the next round." });
    });
    const resume = () => {
      startTimer = null;
      if (mine !== token || state.stage !== "countdown") return;
      soloClock.set(catchUp ? { paused: false } : { paused: false, positionMs: -silence });
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
    const spectator = Boolean(me?.spectator);
    const inRound = roundActive(room) && room.current && me;
    // The round ended, a new one started, or I left it: the run is dropped (its Results stay with the game).
    // A player who turned spectator while loading is dropped too and re-engages as one.
    if (engaged != null && (!inRound || room.round !== engaged || (spectator && !state.spectating))) abandon();
    if (!inRound) return;
    // A player can only join a round in its loading phase; a spectator joins wherever the round is.
    if (engaged == null && failedRound !== room.round && (spectator || room.phase === "loading")) {
      begin(room, spectator);
      return;
    }
    const counted = state.spectating || (state.prepared && me.loaded);
    if (engaged === room.round && !scheduled && state.stage === "waiting" && counted && (room.phase === "countdown" || room.phase === "playing") && Number.isFinite(room.startAt)) {
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

  // The player sits this round out but stays in the room (their chart failed and they went back to the lobby):
  // the round is dropped and, like one whose audio failed, not engaged again on the next snapshot.
  function sitOut() {
    const round = engaged ?? latest?.room?.round ?? null;
    if (round != null) failedRound = round;
    abandon();
  }

  // The player lost their run: the round's audio plays on and the rest of it is only watched. Their score is
  // already submitted, so nothing is reported to the server and the round stays engaged.
  function spectate() {
    if (engaged == null || state.spectating) return;
    setState({ spectating: true });
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
    sitOut,
    spectate,
    serverClock,
    state: () => state,
    onState: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    audio,
  };
}
