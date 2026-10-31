import { createSongClock } from "./clock.js";

export const MOCK_AUDIO_KEY = "mock:demo:150000";
const MOCK_DURATION_MS = 150_000;
const FIRST_NOTE_MS = 2000;
const LAST_NOTE_MS = 148_000;
const BEAT_MS = 500; // 120 BPM
const LANE_CYCLE = [0, 1, 2, 3, 2, 1];

// A fixed 120 BPM chart: a note on every beat, lanes cycling, and a second
// note in the mirrored lane on every 8th beat. Difficulty doesn't change it.
export function buildMockChart(audioKey, difficulty) {
  const notes = [];
  for (let beat = 0, t = FIRST_NOTE_MS; t <= LAST_NOTE_MS; beat += 1, t += BEAT_MS) {
    const lane = LANE_CYCLE[beat % LANE_CYCLE.length];
    notes.push({ t, lane });
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
