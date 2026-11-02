// Socket housekeeping for the Activity gateway, kept apart from the server so
// it can be tested with fake sockets and timers.

const HEARTBEAT_MS = 25_000;

// Pings every socket each interval. A socket that hasn't answered the previous
// ping with a pong is terminated, which fires its `close` event (and with it
// the release of its room seat); a half-open connection would otherwise sit
// there until the TCP timeout. The sockets must call markAlive on `pong`.
function markAlive(socket) {
  socket.isAlive = true;
}

function startHeartbeat({
  sockets,
  intervalMs = HEARTBEAT_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const timer = setIntervalFn(() => {
    for (const socket of [...sockets]) {
      if (socket.isAlive === false) {
        try {
          socket.terminate();
        } catch {
          // Already gone; its close handler does the cleanup.
        }
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        // A socket that can't be pinged is dead; the next tick terminates it.
      }
    }
  }, intervalMs);
  timer?.unref?.();
  return { stop: () => clearIntervalFn(timer) };
}

// Tells the mewbeat channel a user is gone from a guild, but only when none of
// their other sockets in that guild are left. `socket` is the one being
// released and doesn't count as another window.
function releaseSession({ sockets, socket, guildId, identity, disconnect }) {
  if (!guildId || !identity) return false;
  const otherWindow = [...sockets].some((other) => other !== socket
    && other.authorized && other.guildId === guildId && other.identity?.id === identity.id);
  if (otherWindow) return false;
  disconnect(guildId, identity.id);
  return true;
}

module.exports = { HEARTBEAT_MS, markAlive, startHeartbeat, releaseSession };
