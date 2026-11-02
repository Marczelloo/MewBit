// Tracks a player prepared for solo play or a room, keyed by audioKey: the
// encoded track, the node that resolved it and the display info. In memory
// only, so a restart simply asks the client to prepare again.
function createSoloTracks({ max = 128, ttlMs = 6 * 3600e3, now = Date.now } = {}) {
  const entries = new Map(); // audioKey -> { entry, expiresAt }, oldest first

  function put(audioKey, entry) {
    entries.delete(audioKey);
    entries.set(audioKey, { entry, expiresAt: now() + ttlMs });
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }

  // Reading refreshes both recency and lifetime: a song still being played or
  // charted stays registered; one nobody asked for in ttlMs is dropped.
  function get(audioKey) {
    const stored = entries.get(audioKey);
    if (!stored) return null;
    if (now() >= stored.expiresAt) {
      entries.delete(audioKey);
      return null;
    }
    entries.delete(audioKey);
    entries.set(audioKey, { entry: stored.entry, expiresAt: now() + ttlMs });
    return stored.entry;
  }

  return { put, get };
}

module.exports = { createSoloTracks };
