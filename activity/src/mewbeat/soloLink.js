import { createMewbeatLink } from "./link.js";
import { createServerClock } from "./clock.js";

const PREPARE_TIMEOUT_MS = 30_000;
const COUNT_IN_STEPS = 3;
const COUNT_IN_STEP_MS = 500;
// Silence added before the song: a solo run starts this far before song time 0, so the first notes can
// lie on the first sound and still be reached. Nothing of the song is muted or cut.
export const SONG_SILENCE_MS = 2000;

// Song clock of a solo run. Same surface as createSongClock, but the time comes from the Activity's own
// audio instead of a server anchor. While the audio is not playing (waiting for the chart, count-in,
// pause) it holds positionMs, so the game can build its run on a real, non-null clock. Its time is
// negative in the silence before the song.
export function createSoloClock(audio) {
  let key = null;
  let paused = true;
  let positionMs = 0;
  let durationMs = 0;
  const clamp = (ms) => (durationMs > 0 ? Math.min(ms, durationMs) : ms);
  return {
    // Server anchors don't drive a solo run (the link still pings the server for status and charts).
    setAnchor: () => "ignore",
    songTimeAt(perfMs) {
      if (!key) return null;
      return clamp(paused ? positionMs : (audio.songTimeAt(perfMs) ?? positionMs));
    },
    audioKey: () => key,
    paused: () => paused,
    set(next) {
      if ("key" in next) key = next.key;
      if ("paused" in next) paused = next.paused;
      if ("positionMs" in next) positionMs = next.positionMs;
      if ("durationMs" in next) durationMs = next.durationMs;
    },
  };
}

const IDLE_STATE = { stage: "idle", count: null, error: null, audioKey: null, track: null };

// A solo link implements createMewbeatLink's surface, so useMewbeatGame runs unchanged on it, plus the
// solo controls. The chart conversation and the server status reuse a real mewbeat link (sync pings tell
// whether the socket works); the clock and anchors are the link's own.
//
// Stages: idle (no song) -> preparing (server resolves the track) -> loading (audio download+decode)
// -> ready (anchored and paused before the song, waiting for the chart) -> countin -> playing <-> paused -> ended.
// "error" carries a message; "paused" with an error means the audio could not start (autoplay policy).
export function createSoloLink({
  send,
  audio,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const soloClock = createSoloClock(audio);
  const inner = createMewbeatLink({ send, now, setTimer, clearTimer, serverClock: createServerClock(), songClock: soloClock });
  const anchorListeners = new Set();
  const stateListeners = new Set();
  const pending = new Map(); // prepare id -> { resolve, reject, timer }
  let counter = 0;
  let state = IDLE_STATE;
  let token = 0; // bumps whenever the current song is abandoned, so late async results are dropped
  let countTimer = null;
  let countSeq = 0; // bumps whenever a count-in is cancelled, so its pending audio start can tell it was

  function setState(patch) {
    state = { ...state, ...patch };
    for (const fn of [...stateListeners]) fn(state);
  }

  function emitAnchor(result) {
    for (const fn of [...anchorListeners]) fn(result);
  }

  function cancelCountIn() {
    clearTimer(countTimer);
    countTimer = null;
    countSeq += 1;
  }

  function trackInfoOf(track) {
    return track ? { title: track.title ?? null, artist: track.artist ?? null, durationMs: track.durationMs ?? 0, artworkUrl: track.artworkUrl ?? null, queued: false } : null;
  }

  // ---- prepare: ask the bot to resolve a search result into a playable, chartable song ----
  function prepare({ uri, source }) {
    // Called from the Play click: this is where the AudioContext gets its user gesture.
    audio.unlock?.();
    const mine = ++token;
    cancelCountIn();
    audio.stop();
    return new Promise((resolve, reject) => {
      const fail = (message) => {
        if (mine === token) setState({ stage: "error", error: message });
        reject(new Error(message));
      };
      const id = `p${++counter}`;
      const timer = setTimer(() => {
        pending.delete(id);
        fail("The bot took too long to find this song.");
      }, PREPARE_TIMEOUT_MS);
      pending.set(id, {
        mine,
        timer,
        resolve: (reply) => resolve({ audioKey: reply.audioKey, track: reply.track }),
        reject: fail,
      });
      if (soloClock.audioKey()) {
        // Leaving the previous song: the game drops its run.
        soloClock.set({ key: null });
        emitAnchor("clear");
      }
      setState({ stage: "preparing", count: null, error: null, audioKey: null, track: null });
      if (send({ type: "mewbeat_solo_prepare", id, uri, source }) === false) {
        clearTimer(timer);
        pending.delete(id);
        fail("Not connected to the bot yet. Try again in a moment.");
      }
    });
  }

  function handlePrepare(message) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimer(entry.timer);
    if (entry.mine !== token) return; // the player left or picked again meanwhile
    if (message.status === "ok" && message.audioKey && message.track) entry.resolve(message);
    else entry.reject(message.reason || "This song can't be played here.");
  }

  // ---- begin: download + decode, then anchor the game before the song (paused) so it charts the song ----
  async function begin(audioKey, track) {
    audio.unlock?.();
    const mine = ++token;
    cancelCountIn();
    audio.stop();
    if (soloClock.audioKey()) {
      soloClock.set({ key: null });
      emitAnchor("clear");
    }
    setState({ stage: "loading", count: null, error: null, audioKey, track: trackInfoOf(track) });
    let loaded;
    try {
      loaded = await audio.load(audioKey);
    } catch (error) {
      if (mine !== token) return false;
      setState({ stage: "error", error: "Couldn't load the song audio. Try another song." });
      return false;
    }
    if (mine !== token) return false;
    startAt(audioKey, loaded.durationMs);
    return true;
  }

  // Anchors the run at the start of the silence, paused: the game charts the song and builds its run on
  // this clock, and the link counts in as soon as the chart is ready.
  function startAt(audioKey, durationMs) {
    const first = !soloClock.audioKey();
    soloClock.set({ key: audioKey, paused: true, positionMs: -SONG_SILENCE_MS, durationMs });
    setState({ stage: "ready", count: null, error: null, audioKey });
    emitAnchor(first ? "init" : "keyChange");
  }

  // The game calls this once it accepted the chart and built its run (on the paused clock): only then does
  // the count-in start, so a chart the game ignored (another difficulty, a dropped song) never starts the audio.
  function chartAccepted(chart) {
    if (state.stage !== "ready") return;
    if (chart?.notes) audio.align?.(chart.notes.map((note) => note.t));
    countIn(-SONG_SILENCE_MS, true);
  }

  // ---- count-in, pause, resume ----
  // `opening` marks the count before a run, which ends on GO; the one after a pause does not.
  function countIn(fromMs, opening = false) {
    cancelCountIn();
    const mine = token;
    const seq = countSeq;
    let count = COUNT_IN_STEPS;
    setState({ stage: "countin", count, opening, error: null });
    const step = () => {
      countTimer = null;
      if (mine !== token || seq !== countSeq || state.stage !== "countin") return;
      count -= 1;
      if (count > 0) {
        setState({ count });
        countTimer = setTimer(step, COUNT_IN_STEP_MS);
        return;
      }
      audio.play(fromMs).then(
        () => {
          if (mine !== token || seq !== countSeq || state.stage !== "countin") return;
          soloClock.set({ paused: false, positionMs: fromMs });
          setState({ stage: "playing", count: null });
          emitAnchor("resume");
        },
        (error) => {
          if (mine !== token || seq !== countSeq || state.stage !== "countin") return;
          // Never a silent run: stay paused and say why; Resume (a click) tries again.
          soloClock.set({ paused: true, positionMs: fromMs });
          setState({ stage: "paused", count: null, error: error?.message || "The audio couldn't start." });
        }
      );
    };
    countTimer = setTimer(step, COUNT_IN_STEP_MS);
  }

  function pause() {
    if (state.stage !== "playing" && state.stage !== "countin") return;
    const wasCountIn = state.stage === "countin";
    cancelCountIn();
    // A pause during the count-in also drops an audio start that may still be waiting on the context.
    if (wasCountIn) audio.stop();
    const positionMs = wasCountIn ? soloClock.songTimeAt(now()) ?? 0 : audio.pause();
    soloClock.set({ paused: true, positionMs });
    setState({ stage: "paused", count: null, error: null });
    emitAnchor("pause");
  }

  function resume() {
    if (state.stage !== "paused") return;
    audio.unlock?.();
    countIn(soloClock.songTimeAt(now()) ?? 0);
  }

  // A fresh run of the same song from the silence: the game drops its run and charts again.
  function restart() {
    if (!state.audioKey || !soloClock.audioKey()) return;
    audio.unlock?.();
    token += 1;
    cancelCountIn();
    audio.stop();
    startAt(state.audioKey, audio.durationMs());
  }

  // Back to "no song": the game drops its run and the picker comes back.
  function leave() {
    token += 1;
    cancelCountIn();
    audio.stop();
    const had = Boolean(soloClock.audioKey());
    soloClock.set({ key: null, paused: true, positionMs: 0 });
    setState(IDLE_STATE);
    if (had) emitAnchor("clear");
  }

  let offEnded = null;
  function start() {
    // Subscribed in start() and dropped in stop(): the audio outlives the link when the mode switches.
    offEnded?.();
    offEnded = audio.onEnded?.(() => {
      if (state.stage === "playing") setState({ stage: "ended" });
    });
    inner.start();
  }

  // ---- createMewbeatLink surface ----
  function handle(message) {
    if (message?.type === "mewbeat_solo_prepare") handlePrepare(message);
    else inner.handle(message);
  }

  function stop() {
    token += 1;
    cancelCountIn();
    audio.stop();
    for (const [id, entry] of pending) {
      clearTimer(entry.timer);
      pending.delete(id);
    }
    offEnded?.();
    offEnded = null;
    inner.stop();
  }

  return {
    start,
    stop,
    handle,
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
    // solo controls
    prepare,
    begin,
    pause,
    resume,
    restart,
    leave,
    state: () => state,
    onState: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    audio,
  };
}
