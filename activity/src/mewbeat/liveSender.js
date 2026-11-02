// Send loop of the live leaderboard: turns "the run's numbers changed" into mewbeat_live messages.
// At most one message per minIntervalMs while the run runs (a change inside the interval waits and goes out
// as one message with the latest numbers), nothing when nothing changed, a keep-alive resend of the
// unchanged numbers so a quiet stretch of the chart doesn't expire the player from the board (the server
// drops an entry 5 s after its last update), and exactly one final message with ended: true.
// No browser globals: send, now and the timers are injected.

const MIN_INTERVAL_MS = 250; // 4 Hz
const KEEP_ALIVE_MS = 2000;

export function createLiveSender({
  send,
  session,
  audioKey,
  difficulty,
  minIntervalMs = MIN_INTERVAL_MS,
  keepAliveMs = KEEP_ALIVE_MS,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let latest = null; // { score, combo, accuracy } of the last update()
  let lastSent = null;
  let lastAt = null;
  let trailing = null;
  let keepAlive = null;
  let ended = false;

  const same = (a, b) => Boolean(a && b) && a.score === b.score && a.combo === b.combo && a.accuracy === b.accuracy;

  function clearTimers() {
    clearTimer(trailing);
    clearTimer(keepAlive);
    trailing = null;
    keepAlive = null;
  }

  function transmit(sample, isEnd) {
    try {
      send({ type: "mewbeat_live", session, audioKey, difficulty, score: sample.score, combo: sample.combo, accuracy: sample.accuracy, ended: isEnd });
    } catch {
      /* a refused or failed send is just a missed update */
    }
  }

  function sendNow() {
    clearTimers();
    lastSent = latest;
    lastAt = now();
    transmit(latest, false);
    keepAlive = setTimer(() => {
      keepAlive = null;
      if (!ended) sendNow();
    }, keepAliveMs);
  }

  // Call with the run's current numbers whenever they may have changed (cheap when they did not).
  function update(sample) {
    if (ended || !sample) return;
    latest = { score: sample.score, combo: sample.combo, accuracy: sample.accuracy ?? null };
    if (same(latest, lastSent)) {
      clearTimer(trailing);
      trailing = null;
      return;
    }
    const wait = lastAt === null ? 0 : Math.max(0, lastAt + minIntervalMs - now());
    if (wait === 0) {
      sendNow();
    } else if (trailing === null) {
      trailing = setTimer(() => {
        trailing = null;
        if (!ended && latest && !same(latest, lastSent)) sendNow();
      }, wait);
    }
  }

  // The run is over (finished, quit or left): one last message, with the numbers it ended on. Idempotent.
  function end(sample) {
    if (ended) return;
    ended = true;
    clearTimers();
    const final = sample ? { score: sample.score, combo: sample.combo, accuracy: sample.accuracy ?? null } : latest;
    if (final) transmit(final, true);
  }

  return { update, end, ended: () => ended };
}
