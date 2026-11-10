const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");
const { TABLES } = require("./remoteSchema");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "stats.json");

const TABLE = TABLES.stats;

const JUDGEMENTS = ["perfect", "great", "good", "miss"];

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

function emptyTotals(firstAt) {
  return {
    username: "",
    avatarUrl: null,
    firstAt,
    plays: 0,
    playMs: 0,
    accuracySum: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    presses: 0,
    emptyPresses: 0,
    holdMs: 0,
    longestHoldMs: 0,
    fevers: 0,
    fullCombos: 0,
    timing: { n: 0, sum: 0, sumSq: 0, early: 0, late: 0 },
    // `${audioKey}|${difficulty}` -> { audioKey, difficulty, title, maxCombo, parts, fullCombo }
    maps: {},
  };
}

// Brings a stored record back to the shape above, so a hand-edited or older file cannot put NaN on a profile.
function revive(stored) {
  const totals = emptyTotals(count(stored.firstAt));
  totals.username = typeof stored.username === "string" ? stored.username : "";
  totals.avatarUrl = typeof stored.avatarUrl === "string" ? stored.avatarUrl : null;
  for (const key of ["plays", "playMs", "accuracySum", "presses", "emptyPresses", "holdMs", "longestHoldMs", "fevers", "fullCombos"]) {
    totals[key] = count(stored[key]);
  }
  for (const judgement of JUDGEMENTS) totals.counts[judgement] = count(stored.counts?.[judgement]);
  for (const key of ["n", "sumSq", "early", "late"]) totals.timing[key] = count(stored.timing?.[key]);
  // The sum is the one timing total that may be negative (a player who hits early).
  if (Number.isFinite(stored.timing?.sum)) totals.timing.sum = stored.timing.sum;
  for (const [key, map] of Object.entries(stored.maps ?? {})) {
    if (!map?.audioKey) continue;
    totals.maps[key] = {
      audioKey: map.audioKey,
      difficulty: map.difficulty,
      title: typeof map.title === "string" ? map.title : "",
      artworkUrl: typeof map.artworkUrl === "string" ? map.artworkUrl : "",
      maxCombo: count(map.maxCombo),
      parts: count(map.parts),
      fullCombo: map.fullCombo === true,
    };
  }
  return totals;
}

const whole = (value) => (Number.isFinite(value) ? Math.round(value) : 0);

// A player's totals as a row of mewbeat_stats: the few that are worth a column, and the rest as one jsonb
// value, sent as a JSON string (a JS object would reach Postgres as is, a JS array as an array literal).
// The whole row goes every time, so a resend sets the same totals instead of counting a run twice.
function statsRowOf(userId, totals, at) {
  return {
    user_id: userId,
    username: totals.username,
    avatar_url: totals.avatarUrl,
    first_at: whole(totals.firstAt),
    plays: whole(totals.plays),
    play_ms: whole(totals.playMs),
    data: JSON.stringify({
      counts: totals.counts,
      presses: totals.presses,
      emptyPresses: totals.emptyPresses,
      holdMs: totals.holdMs,
      longestHoldMs: totals.longestHoldMs,
      fevers: totals.fevers,
      fullCombos: totals.fullCombos,
      accuracySum: totals.accuracySum,
      timing: totals.timing,
      maps: totals.maps,
    }),
    at: whole(at),
  };
}

// The other way: { userId, totals }, or null for a row without a user. The data goes through revive, so a
// row edited by hand cannot put NaN on a profile.
function statsFromRow(row) {
  if (typeof row?.user_id !== "string") return null;
  let data = row.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return {
    userId: row.user_id,
    totals: revive({
      ...(data && typeof data === "object" ? data : {}),
      username: row.username,
      avatarUrl: row.avatar_url,
      firstAt: Number(row.first_at),
      plays: Number(row.plays),
      playMs: Number(row.play_ms),
    }),
  };
}

// What each player has played, in totals, so nothing has to be recomputed from old runs. File shape:
// { users: { [userId]: totals } }, see emptyTotals. Updated once per counted run.
//
// With `remote` (see remoteSync.js) the totals live in AtlasHub: the store starts empty, never touches `file`,
// hydrate() fills it, and each run upserts the player's full row. A run before the remote has been read would
// start the totals from zero and overwrite the real ones, so add() hands the call to remote.defer instead
// (with its time fixed), for a replay on top of the hydrated totals.
function createStatsStore({ file = DEFAULT_FILE, now = Date.now, debounceMs = 2000, remote = null } = {}) {
  const disk = remote ? null : createDebouncedJson({ file, debounceMs });
  const loaded = disk ? disk.load() : null;
  const users = new Map();
  for (const [userId, stored] of Object.entries(loaded?.users ?? {})) {
    if (stored && typeof stored === "object") users.set(userId, revive(stored));
  }

  function persist(userId, totals, at) {
    if (remote) {
      const row = statsRowOf(userId, totals, at);
      remote.upsert(TABLE.name, userId, row);
      return;
    }
    disk.schedule(() => ({ users: Object.fromEntries(users) }));
  }

  // run: { profile: { username, avatarUrl }, audioKey, difficulty, track: { title, artist, artworkUrl }, durationMs,
  // accuracy, counts, maxCombo, parts, fevers, presses, emptyPresses, holdMs, longestHoldMs, timing }.
  function add(userId, run, at = now()) {
    if (remote && !remote.ready()) {
      remote.defer("stats", "add", [userId, run, at]);
      return;
    }
    const totals = users.get(userId) ?? emptyTotals(at);
    users.set(userId, totals);

    if (run.profile?.username) totals.username = run.profile.username;
    if (run.profile?.avatarUrl) totals.avatarUrl = run.profile.avatarUrl;
    totals.plays += 1;
    totals.playMs += count(run.durationMs);
    totals.accuracySum += count(run.accuracy);
    for (const judgement of JUDGEMENTS) totals.counts[judgement] += count(run.counts?.[judgement]);
    totals.presses += count(run.presses);
    totals.emptyPresses += count(run.emptyPresses);
    totals.holdMs += count(run.holdMs);
    totals.longestHoldMs = Math.max(totals.longestHoldMs, count(run.longestHoldMs));
    totals.fevers += count(run.fevers);
    for (const key of ["n", "sumSq", "early", "late"]) totals.timing[key] += count(run.timing?.[key]);
    if (Number.isFinite(run.timing?.sum)) totals.timing.sum += run.timing.sum;

    const maxCombo = count(run.maxCombo);
    const parts = count(run.parts);
    const fullCombo = parts > 0 && count(run.counts?.miss) === 0 && maxCombo >= parts;
    if (fullCombo) totals.fullCombos += 1;

    const key = `${run.audioKey}|${run.difficulty}`;
    const map = totals.maps[key] ?? { audioKey: run.audioKey, difficulty: run.difficulty, title: "", artworkUrl: "", maxCombo: 0, parts, fullCombo: false };
    map.title = run.track?.title ?? map.title;
    if (typeof run.track?.artworkUrl === "string" && run.track.artworkUrl) map.artworkUrl = run.track.artworkUrl;
    map.parts = parts;
    map.maxCombo = Math.max(map.maxCombo, maxCombo);
    map.fullCombo = map.fullCombo || fullCombo;
    totals.maps[key] = map;
    persist(userId, totals, at);
  }

  // Replaces the memory with the rows of the remote table.
  function hydrate(rows) {
    users.clear();
    for (const row of rows) {
      const parsed = statsFromRow(row);
      if (parsed) users.set(parsed.userId, parsed.totals);
    }
  }

  // A write of an earlier run that the remote may not have seen: its row holds the newer totals.
  function applyOp(op) {
    if (op.kind !== "upsert" || op.table !== TABLE.name) return;
    const parsed = statsFromRow(op.row);
    if (parsed) users.set(parsed.userId, parsed.totals);
  }

  function has(userId) {
    return users.has(userId);
  }

  // null for a player nobody has seen.
  function summaryOf(userId) {
    const totals = users.get(userId);
    if (!totals) return null;

    const maps = Object.values(totals.maps)
      .map((map) => ({ ...map }))
      .sort((a, b) => b.maxCombo - a.maxCombo);
    const { n, sum, sumSq, early, late } = totals.timing;
    const mean = n > 0 ? sum / n : null;
    return {
      username: totals.username,
      avatarUrl: totals.avatarUrl,
      firstAt: totals.firstAt,
      plays: totals.plays,
      avgAccuracy: totals.plays > 0 ? totals.accuracySum / totals.plays : 0,
      songs: new Set(maps.map((map) => map.audioKey)).size,
      playMs: totals.playMs,
      counts: { ...totals.counts },
      presses: totals.presses,
      emptyPresses: totals.emptyPresses,
      holdMs: totals.holdMs,
      longestHoldMs: totals.longestHoldMs,
      fevers: totals.fevers,
      fullCombos: totals.fullCombos,
      timing: {
        meanMs: mean,
        // Rounding can push the variance a hair below zero when every sample is the same.
        spreadMs: n > 0 ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : null,
        earlyShare: n > 0 ? early / n : null,
        lateShare: n > 0 ? late / n : null,
      },
      bestCombo: maps.length > 0 ? { value: maps[0].maxCombo, title: maps[0].title } : null,
      maps,
    };
  }

  return { add, summaryOf, has, hydrate, applyOp, flush: disk ? disk.flush : () => Promise.resolve() };
}

module.exports = { createStatsStore, statsRowOf, statsFromRow, revive };
