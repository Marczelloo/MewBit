const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "history.json");

// The last rounds each user played, oldest first. File shape: { users: { [userId]: entry[] } }.
// An entry is { audioKey, uri, source, title, artist, artworkUrl, durationMs, difficulty, score, accuracy,
// grade, ranked, mode, guildId, chartVersion, at }. chartVersion is the stored chart's version (a number, or a
// string like "31-holds" with generator flags); rounds from before it was recorded have none.
function createHistoryStore({ file = DEFAULT_FILE, now = Date.now, perUser = 200, debounceMs = 2000 } = {}) {
  const disk = createDebouncedJson({ file, debounceMs });
  const loaded = disk.load();
  const users = new Map();
  for (const [userId, entries] of Object.entries(loaded?.users ?? {})) {
    if (Array.isArray(entries)) users.set(userId, entries.filter((entry) => entry?.audioKey).slice(-perUser));
  }

  const persist = () => disk.schedule(() => ({ users: Object.fromEntries(users) }));

  function add(userId, entry) {
    const list = users.get(userId) ?? [];
    list.push({ at: now(), ...entry });
    if (list.length > perUser) list.splice(0, list.length - perUser);
    users.set(userId, list);
    persist();
  }

  // Newest first.
  function recent(userId, limit = 20) {
    return (users.get(userId) ?? []).slice(-limit).reverse();
  }

  // Distinct songs played in a guild (null: anywhere), last played first. The
  // track info comes from the latest round of the song.
  function played({ guildId = null, limit = 50 } = {}) {
    const byKey = new Map();
    for (const list of users.values()) {
      for (const entry of list) {
        if (guildId && entry.guildId !== guildId) continue;
        const known = byKey.get(entry.audioKey);
        if (!known) {
          byKey.set(entry.audioKey, { entry, plays: 1, lastAt: entry.at });
          continue;
        }
        known.plays += 1;
        if (entry.at >= known.lastAt) {
          known.entry = entry;
          known.lastAt = entry.at;
        }
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, limit)
      .map(({ entry, plays, lastAt }) => ({
        audioKey: entry.audioKey,
        uri: entry.uri ?? null,
        source: entry.source ?? "",
        title: entry.title,
        artist: entry.artist ?? "",
        artworkUrl: entry.artworkUrl ?? null,
        durationMs: entry.durationMs ?? 0,
        plays,
        lastAt,
      }));
  }

  return { add, recent, played, flush: disk.flush };
}

module.exports = { createHistoryStore };
