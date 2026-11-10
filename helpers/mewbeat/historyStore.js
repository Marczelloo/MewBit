const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");
const { TABLES } = require("./remoteSchema");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "history.json");

const TABLE = TABLES.history;

const orNull = (value) => (value === undefined ? null : value);
const whole = (value) => (Number.isFinite(value) ? Math.round(value) : null);
const numberOf = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value));

// A round gets the same id however often it is sent, so a resend after a lost answer cannot add it twice.
const historyIdOf = (userId, entry) => `${userId}|${entry.at}|${entry.audioKey}|${entry.difficulty}`;

// A round as a row of mewbeat_history. chartVersion is text (a number or a string like "31-holds").
function historyRowOf(userId, entry) {
  return {
    id: historyIdOf(userId, entry),
    user_id: userId,
    audio_key: orNull(entry.audioKey),
    uri: orNull(entry.uri),
    source: orNull(entry.source),
    title: orNull(entry.title),
    artist: orNull(entry.artist),
    artwork_url: orNull(entry.artworkUrl),
    duration_ms: whole(entry.durationMs),
    difficulty: orNull(entry.difficulty),
    score: whole(entry.score),
    accuracy: orNull(entry.accuracy),
    grade: orNull(entry.grade),
    ranked: typeof entry.ranked === "boolean" ? entry.ranked : null,
    mode: orNull(entry.mode),
    guild_id: orNull(entry.guildId),
    chart_version: entry.chartVersion === undefined || entry.chartVersion === null ? null : String(entry.chartVersion),
    at: whole(entry.at),
  };
}

// The other way: { userId, entry }, or null for a row that is no round. The entry looks like the one add() kept:
// uri, artworkUrl and guildId are null when empty (the callers send them that way), any other column with no
// value is no key, and a chartVersion that is all digits was a number.
function historyFromRow(row) {
  if (typeof row?.user_id !== "string" || !row.audio_key) return null;
  const entry = {};
  const put = (key, value) => {
    if (value !== null && value !== undefined) entry[key] = value;
  };
  put("audioKey", row.audio_key);
  entry.uri = row.uri ?? null;
  put("source", row.source);
  put("title", row.title);
  put("artist", row.artist);
  entry.artworkUrl = row.artwork_url ?? null;
  put("durationMs", numberOf(row.duration_ms));
  put("difficulty", row.difficulty);
  put("score", numberOf(row.score));
  put("accuracy", numberOf(row.accuracy));
  put("grade", row.grade);
  put("ranked", row.ranked === null || row.ranked === undefined ? undefined : row.ranked === true || row.ranked === "true");
  put("mode", row.mode);
  entry.guildId = row.guild_id ?? null;
  if (row.chart_version !== null && row.chart_version !== undefined) {
    entry.chartVersion = /^\d+$/.test(row.chart_version) ? Number(row.chart_version) : String(row.chart_version);
  }
  put("at", numberOf(row.at));
  return { userId: row.user_id, entry };
}

// The last rounds each user played, oldest first. File shape: { users: { [userId]: entry[] } }.
// An entry is { audioKey, uri, source, title, artist, artworkUrl, durationMs, difficulty, score, accuracy,
// grade, ranked, mode, guildId, chartVersion, at }. chartVersion is the stored chart's version (a number, or a
// string like "31-holds" with generator flags); rounds from before it was recorded have none.
//
// With `remote` (see remoteSync.js) the rounds go to AtlasHub: the store starts empty, never touches `file`,
// hydrate() fills it, and each add is an insert. The database keeps every round, the memory the last `perUser`.
// Until the remote has been read, add() hands the call to remote.defer (with its time fixed) for a replay.
function createHistoryStore({ file = DEFAULT_FILE, now = Date.now, perUser = 2000, debounceMs = 2000, remote = null } = {}) {
  const disk = remote ? null : createDebouncedJson({ file, debounceMs });
  const loaded = disk ? disk.load() : null;
  const users = new Map();
  for (const [userId, entries] of Object.entries(loaded?.users ?? {})) {
    if (Array.isArray(entries)) users.set(userId, entries.filter((entry) => entry?.audioKey).slice(-perUser));
  }

  function keep(userId, entry) {
    const list = users.get(userId) ?? [];
    list.push(entry);
    if (list.length > perUser) list.splice(0, list.length - perUser);
    users.set(userId, list);
  }

  function add(userId, entry) {
    if (remote && !remote.ready()) {
      remote.defer("history", "add", [userId, { at: now(), ...entry }]);
      return;
    }
    const full = { at: now(), ...entry };
    keep(userId, full);
    if (remote) {
      const row = historyRowOf(userId, full);
      remote.insert(TABLE.name, row.id, row);
      return;
    }
    disk.schedule(() => ({ users: Object.fromEntries(users) }));
  }

  // Replaces the memory with the rows of the remote table.
  function hydrate(rows) {
    const parsed = rows.map(historyFromRow).filter(Boolean).sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0));
    users.clear();
    for (const { userId, entry } of parsed) keep(userId, entry);
  }

  // A round of an earlier run that the remote may not have seen. It may be in the hydrated rows already (the
  // insert went through and the ack was lost), so a round the user has at that time is not added twice.
  function applyOp(op) {
    if (op.kind !== "insert" || op.table !== TABLE.name) return;
    const parsed = historyFromRow(op.row);
    if (!parsed) return;
    const list = users.get(parsed.userId) ?? [];
    for (let index = list.length - 1; index >= 0 && list[index].at >= parsed.entry.at; index -= 1) {
      if (historyIdOf(parsed.userId, list[index]) === op.row.id) return;
    }
    // Keep the list oldest first when the round is not the newest.
    const at = list.findLastIndex((entry) => entry.at <= parsed.entry.at);
    if (at === list.length - 1) {
      keep(parsed.userId, parsed.entry);
      return;
    }
    list.splice(at + 1, 0, parsed.entry);
    if (list.length > perUser) list.splice(0, list.length - perUser);
    users.set(parsed.userId, list);
  }

  // Newest first.
  function recent(userId, limit = 20) {
    return (users.get(userId) ?? []).slice(-limit).reverse();
  }

  // One round of the user, found by the three things that name it; null when the user has no such round.
  function roundOf(userId, audioKey, difficulty, at) {
    return (users.get(userId) ?? []).findLast((entry) => entry.audioKey === audioKey && entry.difficulty === difficulty && entry.at === at) ?? null;
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

  return { add, recent, roundOf, played, firstTrackOf, hydrate, applyOp, flush: disk ? disk.flush : () => Promise.resolve() };
}

module.exports = { createHistoryStore, historyIdOf, historyRowOf, historyFromRow };
