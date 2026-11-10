import { createSongClock } from "./clock.js";

export const MOCK_AUDIO_KEY = "mock:demo:150000";
const MOCK_DURATION_MS = 150_000;
const FIRST_NOTE_MS = 2000;
const LAST_NOTE_MS = 148_000;
const BEAT_MS = 500; // 120 BPM
const LANE_CYCLE = [0, 1, 2, 3, 2, 1];
// Beats whose note is a hold, and for how many beats. A hold ends 100 ms before the beat it
// spans, so a longer one only sits where the next beat(s) fall in the other hand (lanes 0-1 vs 2-3).
const HOLD_GAP_MS = 100;
const HOLDS = { 10: 2, 12: 1, 21: 1, 25: 2 }; // lanes 2, 0, 3, 1

// A fixed 120 BPM chart: a note on every beat, lanes cycling, a second note in the
// mirrored lane on every 8th beat, and four hold notes. Difficulty doesn't change it.
export function buildMockChart(audioKey, difficulty) {
  const notes = [];
  for (let beat = 0, t = FIRST_NOTE_MS; t <= LAST_NOTE_MS; beat += 1, t += BEAT_MS) {
    const lane = LANE_CYCLE[beat % LANE_CYCLE.length];
    const beats = HOLDS[beat];
    notes.push(beats ? { t, lane, len: beats * BEAT_MS - HOLD_GAP_MS } : { t, lane });
    if ((beat + 1) % 8 === 0) notes.push({ t, lane: 3 - lane });
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return { audioKey, difficulty, notes };
}

// Same surface as createMewbeatLink, backed by a fake 150 s track so the game
// runs in a browser with no bot (?mock=1).
export function createMockLink({
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  // The fake server shares the client's clock, so server time is perf time.
  const songClock = createSongClock({ serverTimeAt: (perfMs) => perfMs, ready: () => true }, { now });
  const anchorListeners = new Set();
  const chartListeners = new Set();
  const statusListeners = new Set();
  const timers = new Set();
  let status = "connecting";
  let playing = false;

  function emit(listeners, value) {
    for (const fn of [...listeners]) fn(value);
  }

  function subscribe(listeners, fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function later(fn, ms) {
    const timer = setTimer(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  }

  function start() {
    stop();
    playing = true;
    emit(anchorListeners, songClock.setAnchor({
      audioKey: MOCK_AUDIO_KEY,
      positionMs: 0,
      at: now(),
      paused: false,
      durationMs: MOCK_DURATION_MS,
    }));
    if (status !== "live") {
      status = "live";
      emit(statusListeners, status);
    }
    later(() => {
      playing = false;
      emit(anchorListeners, songClock.setAnchor(null));
    }, MOCK_DURATION_MS);
  }

  function stop() {
    for (const timer of timers) clearTimer(timer);
    timers.clear();
  }

  function requestChart(audioKey, difficulty) {
    later(() => {
      const current = audioKey === songClock.audioKey();
      emit(chartListeners, current
        ? { audioKey, difficulty, status: "ready", chart: buildMockChart(audioKey, difficulty) }
        : { audioKey, difficulty, status: "stale" });
    }, 0);
    return true;
  }

  return {
    start,
    stop,
    handle: () => {},
    syncNow: () => {},
    requestChart,
    songClock,
    status: () => status,
    onAnchor: (fn) => subscribe(anchorListeners, fn),
    onChart: (fn) => subscribe(chartListeners, fn),
    onStatus: (fn) => subscribe(statusListeners, fn),
    setTrackInfo: () => {},
    track: () => (playing ? { title: "Demo track", artist: "mewbeat", queued: false } : null),
  };
}

// The first-run tour's link: an empty song standing still at its start, so the play screen shows a clear board while
// Mewbit explains it, with nothing to score and nothing to send. Same surface as createMockLink (no send, no solo stage).
// The tour's trap borrows it for a scene (playScene): a real song's chart running on the highway as an autoplay.
export function createStillLink({ now = () => performance.now() } = {}) {
  const songClock = createSongClock({ serverTimeAt: (perfMs) => perfMs, ready: () => true }, { now });
  const anchorListeners = new Set();
  const chartListeners = new Set();
  const statusListeners = new Set();
  const timers = new Set();
  let status = "connecting";
  let scene = null; // { audioKey, chart, durationMs } while a scene is on, else the empty song stands still

  function subscribe(listeners, fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emitAnchor(next) {
    const change = songClock.setAnchor(next);
    for (const fn of [...anchorListeners]) fn(change);
  }

  function start() {
    stop();
    scene = null;
    emitAnchor({ audioKey: MOCK_AUDIO_KEY, positionMs: 0, at: now(), paused: true, durationMs: 0 });
    if (status !== "live") {
      status = "live";
      for (const fn of [...statusListeners]) fn(status);
    }
  }

  function stop() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  // A scene: the given chart moving from positionMs, as if the song were playing. The link answers requestChart for
  // its key with that chart (whatever level is asked: the caller decides which level the HUD shows), and state() says
  // spectating, so the game runs it as an autoplay that scores nothing, leaves no summary and sends nothing.
  function playScene({ audioKey, chart, positionMs, durationMs, at = now() }) {
    scene = { audioKey, chart, durationMs };
    emitAnchor({ audioKey, positionMs, at, paused: false, durationMs });
  }

  // Freezes the scene where it is: the clock stops and the highway keeps its last frame.
  function pauseScene(at = now()) {
    if (!scene) return;
    emitAnchor({ audioKey: scene.audioKey, positionMs: songClock.songTimeAt(at) ?? 0, at, paused: true, durationMs: scene.durationMs });
  }

  // Back to the empty song standing still, with nothing special about the run.
  function endScene() {
    if (!scene) return;
    scene = null;
    emitAnchor({ audioKey: MOCK_AUDIO_KEY, positionMs: 0, at: now(), paused: true, durationMs: 0 });
  }

  function requestChart(audioKey, difficulty) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      const current = audioKey === songClock.audioKey();
      const message = current
        ? { audioKey, difficulty, status: "ready", chart: scene && scene.audioKey === audioKey ? { ...scene.chart, audioKey, difficulty } : { audioKey, difficulty, notes: [] } }
        : { audioKey, difficulty, status: "stale" };
      for (const fn of [...chartListeners]) fn(message);
    }, 0);
    timers.add(timer);
    return true;
  }

  return {
    start,
    stop,
    handle: () => {},
    syncNow: () => {},
    requestChart,
    playScene,
    pauseScene,
    endScene,
    songClock,
    status: () => status,
    // No onState: the game asks for spectating at every run, and the screen has no stage to follow.
    state: () => (scene ? { spectating: true } : {}),
    onAnchor: (fn) => subscribe(anchorListeners, fn),
    onChart: (fn) => subscribe(chartListeners, fn),
    onStatus: (fn) => subscribe(statusListeners, fn),
    setTrackInfo: () => {},
    track: () => null,
  };
}
