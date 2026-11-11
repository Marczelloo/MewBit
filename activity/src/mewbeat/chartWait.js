// What a player who waits for a chart is told: the step the song is at, its place in line and the time since they asked.
// The bot says where a song stands as `queue` = { step, ahead, running } (helpers/mewbeat/chartStore.js queueOf); this file
// turns that into one short line and keeps the clock of the wait. The line is drawn by ChartWaitLine.jsx.

// The steps chartStore.queueOf reports, in the order a song goes through them, in plain words.
export const STEP_WORDS = {
  analysis: "Listening to the song…",
  melody: "Following the melody…",
  charts: "Writing the notes…",
};
// No queue in the reply (nothing is queued for the song yet, or the chart is nearly done), or a step this client does not know.
export const GENERIC_WORDS = "Getting the charts ready…";

// m:ss, minutes not padded ("0:07", "2:35", "12:00").
export function formatElapsed(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// The reply's queue as { step, ahead, running }, or null when it has none or it is not the shape the bot sends.
export function readQueue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { step, ahead, running } = raw;
  if (typeof step !== "string" || !step) return null;
  if (!Number.isInteger(ahead) || ahead < 0) return null;
  return { step, ahead, running: running === true };
}

// One line: "2 songs ahead of yours · 0:21" while it waits behind others, "Next in line · 0:21" when it is first, the step
// ("Listening to the song… 0:07") when its own job is being worked on, and "Getting the charts ready… 0:12" with no queue.
export function waitLine(queue, elapsedMs) {
  const time = formatElapsed(elapsedMs);
  const place = readQueue(queue);
  if (place && !place.running) {
    if (place.ahead > 0) return `${place.ahead} ${place.ahead === 1 ? "song" : "songs"} ahead of yours · ${time}`;
    return `Next in line · ${time}`;
  }
  if (place && STEP_WORDS[place.step]) return `${STEP_WORDS[place.step]} ${time}`;
  return `${GENERIC_WORDS} ${time}`;
}

const IDLE = Object.freeze({ key: null, since: null, queue: null, seen: false });

// The wait of one song: `since` is when this player first asked (a wall-clock time), `queue` the latest answer of the bot and
// `seen` whether it ever carried one. Asking again for the same song does not restart it; a new song, or a restart (a
// player's "Try again"), does. The snapshot is replaced on every change, so it works with useSyncExternalStore.
export function createChartWait({ now = () => Date.now() } = {}) {
  let state = IDLE;
  const listeners = new Set();

  function set(next) {
    state = next;
    for (const fn of [...listeners]) fn();
  }

  return {
    // `at` is the time the wait really began when the caller knows it (a song select job); else it begins now.
    begin(key, { at, restart = false } = {}) {
      if (key === null || key === undefined) return;
      if (state.key === key && at !== undefined && at === state.since) return; // the same wait, asked about again
      if (state.key === key && !restart && at === undefined) return;
      const same = state.key === key && !restart;
      set({ key, since: at ?? now(), queue: same ? state.queue : null, seen: same ? state.seen : false });
    },
    // The bot's latest answer for the song; ignored when the wait is not about that song (a late reply).
    report(key, queue) {
      if (state.key !== key) return;
      const next = readQueue(queue);
      if (next === null && state.queue === null) return;
      set({ ...state, queue: next, seen: state.seen || next !== null });
    },
    end() {
      if (state !== IDLE) set(IDLE);
    },
    elapsed: (at = now()) => (state.since === null ? 0 : Math.max(0, at - state.since)),
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
