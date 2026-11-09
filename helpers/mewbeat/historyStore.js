const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "history.json");

// The last rounds each user played, oldest first. File shape: { users: { [userId]: entry[] } }.
// An entry is { audioKey, uri, source, title, artist, artworkUrl, durationMs, difficulty, score, accuracy,
// grade, ranked, mode, guildId, chartVersion, at }. chartVersion is the stored chart's version (a number, or a
// string like "31-holds" with generator flags); rounds from before it was recorded have none.
function createHistoryStore({ file = DEFAULT_FILE, now = Date.now, perUser = 2000, debounceMs = 2000 } = {}) {
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

  // Distinct songs played in a guild (null: anywhere) by one user (null: anyone), last played first. The
  // track info comes from the latest round of the song; playsBy counts the rounds per level.
  function played({ guildId = null, userId = null, limit = 50 } = {}) {
    const byKey = new Map();
    for (const [ownerId, list] of users) {
      if (userId && ownerId !== userId) continue;
      for (const entry of list) {
        if (guildId && entry.guildId !== guildId) continue;
        let known = byKey.get(entry.audioKey);
        if (!known) {
          known = { entry, plays: 0, lastAt: entry.at, playsBy: { easy: 0, normal: 0, hard: 0, hell: 0 } };
          byKey.set(entry.audioKey, known);
        }
        known.plays += 1;
        if (Object.hasOwn(known.playsBy, entry.difficulty)) known.playsBy[entry.difficulty] += 1;
        if (entry.at >= known.lastAt) {
          known.entry = entry;
          known.lastAt = entry.at;
        }
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, limit)
      .map(({ entry, plays, playsBy, lastAt }) => ({
        audioKey: entry.audioKey,
        uri: entry.uri ?? null,
        source: entry.source ?? "",
        title: entry.title,
        artist: entry.artist ?? "",
        artworkUrl: entry.artworkUrl ?? null,
        durationMs: entry.durationMs ?? 0,
        plays,
        playsBy,
        lastAt,
      }));
  }

  // The track of the user's oldest kept round of the song; null when none is kept. A best score outlives
  // the history window, so the profile asks here when a score has no stored title.
  function firstTrackOf(userId, audioKey) {
    const round = (users.get(userId) ?? []).find((entry) => entry.audioKey === audioKey);
    if (!round) return null;
    return { title: round.title, artist: round.artist ?? "", artworkUrl: round.artworkUrl ?? null };
  }

  return { add, recent, played, firstTrackOf, flush: disk.flush };
}

module.exports = { createHistoryStore };
