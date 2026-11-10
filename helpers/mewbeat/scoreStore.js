const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");
const { TABLES } = require("./remoteSchema");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "scores.json");

const VERSION_SUFFIX = /^(.*)\|(\d+)$/;
const CHART_KEY = /^(.*)\|([^|]*)\|([^|]*)$/; // audioKey|difficulty|chartVersion
const RULES_SUFFIX = /^(.*)\|r(\d+)$/; // |r<scoring rules version> after the chart version; keys from before it have none

// A key apart: what is left of the rules suffix, and the rules version (1 for a key without one).
function splitRules(chartKey) {
  const match = RULES_SUFFIX.exec(chartKey);
  return match ? { base: match[1], rules: Number(match[2]) } : { base: chartKey, rules: 1 };
}

const TABLE = TABLES.scores;

const orNull = (value) => (value === undefined ? null : value);
const whole = (value) => (Number.isFinite(value) ? Math.round(value) : null);
// A bigint column can come back as a string, and a null column has no number.
const numberOf = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value));

function listOf(value) {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list : [];
}

// A best score as a row of mewbeat_scores. Every column is sent, null when the entry has no value, because an
// update leaves the columns it does not name alone. The guilds go in as a JSON string: a JS array would reach
// Postgres as an array literal, which jsonb refuses.
function scoreRowOf(chartKey, entry) {
  const parts = CHART_KEY.exec(splitRules(chartKey).base);
  return {
    id: `${chartKey}|${entry.userId}`,
    chart_key: chartKey,
    audio_key: parts?.[1] ?? null,
    difficulty: orNull(entry.difficulty),
    chart_version: parts?.[3] ?? null,
    user_id: entry.userId,
    username: orNull(entry.username),
    avatar_url: orNull(entry.avatarUrl),
    score: whole(entry.score),
    accuracy: orNull(entry.accuracy),
    grade: orNull(entry.grade),
    max_combo: whole(entry.maxCombo),
    completion: orNull(entry.completion),
    title: orNull(entry.title),
    artist: orNull(entry.artist),
    artwork_url: orNull(entry.artworkUrl),
    guild_ids: JSON.stringify(entry.guildIds ?? []),
    modifiers: JSON.stringify(entry.modifiers ?? []),
    at: whole(entry.at),
  };
}

// The other way: { chartKey, entry }, or null for a row that is no score. The entry has the shape submit() makes,
// an unknown value as undefined (a score without a track has no artwork either).
function scoreFromRow(row) {
  const score = numberOf(row?.score);
  if (typeof row?.chart_key !== "string" || typeof row.user_id !== "string" || score === undefined) return null;
  const title = row.title ?? undefined;
  return {
    chartKey: row.chart_key,
    entry: {
      score,
      accuracy: numberOf(row.accuracy),
      grade: row.grade ?? undefined,
      maxCombo: numberOf(row.max_combo),
      difficulty: row.difficulty ?? undefined,
      at: numberOf(row.at),
      completion: numberOf(row.completion),
      title,
      artist: row.artist ?? undefined,
      artworkUrl: title === undefined ? undefined : row.artwork_url ?? null,
      userId: row.user_id,
      username: row.username ?? "Unknown",
      avatarUrl: row.avatar_url ?? null,
      guildIds: listOf(row.guild_ids),
      modifiers: listOf(row.modifiers),
    },
  };
}

// Best score per user per chart (`audioKey|difficulty|chartVersion|r<rules>`), with the
// guilds the user scored it in: the server board is the users who scored the
// chart in that guild, the global board is everyone.
//
// File shape: { charts: { [chartKey]: { [userId]: entry } } }. Scores of
// older chart versions stay on disk, but only the newest version of a song and
// difficulty is looked up (through an index kept next to the map).
//
// With `remote` (see remoteSync.js) the scores live in AtlasHub instead: the store starts empty, never touches
// `file`, hydrate() loads it once the remote has been read, and every change is an upsert of the full row.
// Until then submit() cannot decide anything (the old best is unknown): it hands the call to remote.defer,
// which replays it after the hydration, with the time it was made.
function createScoreStore({ file = DEFAULT_FILE, now = Date.now, debounceMs = 2000, remote = null } = {}) {
  const disk = remote ? null : createDebouncedJson({ file, debounceMs });
  const loaded = disk ? disk.load() : null;
  const charts = new Map(); // chartKey -> Map(userId -> entry)
  const latest = new Map(); // `audioKey|difficulty|r<rules>` -> { version, chartKey }

  function indexChart(chartKey) {
    const { base, rules } = splitRules(chartKey);
    const match = VERSION_SUFFIX.exec(base);
    if (!match) return;
    const version = Number(match[2]);
    const slot = `${match[1]}|r${rules}`;
    const known = latest.get(slot);
    if (!known || version > known.version) latest.set(slot, { version, chartKey });
  }

  for (const [chartKey, users] of Object.entries(loaded?.charts ?? {})) {
    if (!users || typeof users !== "object") continue;
    charts.set(chartKey, new Map(Object.entries(users).filter(([, entry]) => entry && Number.isFinite(entry.score))));
    indexChart(chartKey);
  }

  function persist(chartKey, entry) {
    if (remote) {
      const row = scoreRowOf(chartKey, entry);
      remote.upsert(TABLE.name, row.id, row);
      return;
    }
    disk.schedule(() => ({
      charts: Object.fromEntries([...charts].map(([key, users]) => [key, Object.fromEntries(users)])),
    }));
  }

  function place(chartKey, entry) {
    let users = charts.get(chartKey);
    if (!users) {
      users = new Map();
      charts.set(chartKey, users);
      indexChart(chartKey);
    }
    users.set(entry.userId, entry);
  }

  function publicEntry(entry) {
    return {
      userId: entry.userId,
      username: entry.username,
      avatarUrl: entry.avatarUrl ?? null,
      score: entry.score,
      accuracy: entry.accuracy,
      grade: entry.grade,
      maxCombo: entry.maxCombo,
      modifiers: entry.modifiers ?? [],
      at: entry.at,
    };
  }

  function submit(run) {
    if (remote && !remote.ready()) {
      remote.defer("scores", "submit", [{ ...run, at: run.at ?? now() }]);
      return { newBest: false, best: null };
    }
    const { chartKey, userId, guildId, profile, score, accuracy, grade, maxCombo, difficulty, track, completion, modifiers = [], at = now() } = run;
    let users = charts.get(chartKey);
    if (!users) {
      users = new Map();
      charts.set(chartKey, users);
      indexChart(chartKey);
    }
    const previous = users.get(userId);
    const newBest = !previous || score > previous.score;
    const guildIds = new Set(previous?.guildIds ?? []);
    if (guildId) guildIds.add(guildId);

    // The track sits flat on the entry so the profile can name the song without the history; board replies
    // do not carry it. A chart is always one song, so an older title survives a new best that sends none.
    // The completion (the share of the chart judged, 0 to 1) sits there too, for the rating.
    const base = newBest
      ? {
        score, accuracy, grade, maxCombo, difficulty, at, completion, modifiers,
        title: track?.title ?? previous?.title,
        artist: track?.artist ?? previous?.artist,
        artworkUrl: track ? track.artworkUrl ?? null : previous?.artworkUrl,
      }
      : previous;
    const entry = {
      ...base,
      userId,
      // The profile of the latest round keeps the name and avatar fresh.
      username: profile?.username ?? previous?.username ?? "Unknown",
      avatarUrl: profile ? profile.avatarUrl ?? null : previous?.avatarUrl ?? null,
      guildIds: [...guildIds],
    };
    users.set(userId, entry);
    persist(chartKey, entry);
    return { newBest, best: publicEntry(entry) };
  }

  function sorted({ chartKey, guildId }) {
    const users = charts.get(chartKey);
    if (!users) return [];
    return [...users.values()]
      .filter((entry) => !guildId || entry.guildIds?.includes(guildId))
      .sort((a, b) => b.score - a.score || a.at - b.at);
  }

  function board({ chartKey, guildId = null, limit = 10 }) {
    return sorted({ chartKey, guildId }).slice(0, limit).map(publicEntry);
  }

  function rankOf({ chartKey, userId, guildId = null }) {
    const index = sorted({ chartKey, guildId }).findIndex((entry) => entry.userId === userId);
    return index === -1 ? null : index + 1;
  }

  function bestOf(chartKey, userId) {
    const entry = charts.get(chartKey)?.get(userId);
    return entry ? publicEntry(entry) : null;
  }

  // The chartKey with the highest chart version anyone has scored for this song and difficulty under this
  // scoring rules version (a key from before the rules version counts as 1); null when there is none.
  function latestChartKey(audioKey, difficulty, rules = 1) {
    return latest.get(`${audioKey}|${difficulty}|r${rules}`)?.chartKey ?? null;
  }

  // Visits every stored entry of every chart, guilds and track included. The ranking walks it.
  function forEachEntry(fn) {
    for (const [chartKey, users] of charts) {
      for (const entry of users.values()) fn(chartKey, entry);
    }
  }

  // Replaces the memory with the rows of the remote table.
  function hydrate(rows) {
    charts.clear();
    latest.clear();
    for (const row of rows) {
      const parsed = scoreFromRow(row);
      if (parsed) place(parsed.chartKey, parsed.entry);
    }
  }

  // A write of an earlier run that the remote may not have seen, put over the hydrated memory.
  function applyOp(op) {
    if (op.kind !== "upsert" || op.table !== TABLE.name) return;
    const parsed = scoreFromRow(op.row);
    if (parsed) place(parsed.chartKey, parsed.entry);
  }

  // Told when the stores are loaded and the deferred calls replayed, so a cache built from the empty memory
  // can be dropped: the ranking listens.
  const hydrationListeners = [];
  const onHydrated = (listener) => hydrationListeners.push(listener);
  const finishHydration = () => hydrationListeners.forEach((listener) => listener());

  return {
    submit, board, rankOf, bestOf, latestChartKey, forEachEntry, hydrate, applyOp, onHydrated, finishHydration,
    flush: disk ? disk.flush : () => Promise.resolve(),
  };
}

module.exports = { createScoreStore, scoreRowOf, scoreFromRow };
