// Receiving side of the live leaderboard: the server pushes { type: "mewbeat_live_board", session, entries }
// (already sorted). The store keeps the latest push for the current session and drops it when nothing new
// came for ttlMs, so a board of players who all left disappears. No browser globals.

const TTL_MS = 5000;
const TOP_ROWS = 5;

// Top rows plus the player's own row when it is outside them. Each row: { rank, entry, me }.
export function boardRows(entries, meId, top = TOP_ROWS) {
  if (!Array.isArray(entries)) return [];
  const rows = entries.map((entry, index) => ({ rank: index + 1, entry, me: meId !== null && meId !== undefined && entry.userId === meId }));
  const shown = rows.slice(0, top);
  if (!shown.some((row) => row.me)) {
    const mine = rows.slice(top).find((row) => row.me);
    if (mine) shown.push(mine);
  }
  return shown;
}

// The hud a spectator's stage reads: the watched player's vibe and FEVER from their board entry. Without
// them (no entry yet, or a player or bot older than these fields) it stays the local run's hud.
export function watchedStage(hud, entry) {
  if (typeof entry?.vibe !== "number") return hud;
  return { ...hud, vibe: entry.vibe, feverActive: Boolean(entry.fever) && !entry.ended };
}

export function createLiveBoardStore({ ttlMs = TTL_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const listeners = new Set();
  let session = null;
  let entries = null;
  let timer = null;

  function notify() {
    for (const fn of [...listeners]) fn(entries);
  }

  function clear() {
    clearTimer(timer);
    timer = null;
    if (entries === null) return;
    entries = null;
    notify();
  }

  // The session of the run on screen (null when no run is): a board of another session is never shown.
  function setSession(next) {
    if (next === session) return;
    session = next;
    clear();
  }

  // Returns true for every mewbeat_live_board (consumed, even when it is ignored).
  function handle(message) {
    if (message?.type !== "mewbeat_live_board") return false;
    if (session === null || message.session !== session || !Array.isArray(message.entries)) return true;
    entries = message.entries;
    clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      clear();
    }, ttlMs);
    notify();
    return true;
  }

  return {
    handle,
    setSession,
    clear,
    entries: () => entries,
    session: () => session,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
