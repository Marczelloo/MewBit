const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "stats.json");

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
      maxCombo: count(map.maxCombo),
      parts: count(map.parts),
      fullCombo: map.fullCombo === true,
    };
  }
  return totals;
}

// What each player has played, in totals, so nothing has to be recomputed from old runs. File shape:
// { users: { [userId]: totals } }, see emptyTotals. Updated once per counted run.
function createStatsStore({ file = DEFAULT_FILE, now = Date.now, debounceMs = 2000 } = {}) {
  const disk = createDebouncedJson({ file, debounceMs });
  const loaded = disk.load();
  const users = new Map();
  for (const [userId, stored] of Object.entries(loaded?.users ?? {})) {
    if (stored && typeof stored === "object") users.set(userId, revive(stored));
  }

  const persist = () => disk.schedule(() => ({ users: Object.fromEntries(users) }));

  // run: { profile: { username, avatarUrl }, audioKey, difficulty, track: { title, artist, artworkUrl }, durationMs,
  // accuracy, counts, maxCombo, parts, fevers, presses, emptyPresses, holdMs, longestHoldMs, timing }.
  function add(userId, run) {
    const totals = users.get(userId) ?? emptyTotals(now());
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
    const map = totals.maps[key] ?? { audioKey: run.audioKey, difficulty: run.difficulty, title: "", maxCombo: 0, parts, fullCombo: false };
    map.title = run.track?.title ?? map.title;
    map.parts = parts;
    map.maxCombo = Math.max(map.maxCombo, maxCombo);
    map.fullCombo = map.fullCombo || fullCombo;
    totals.maps[key] = map;
    persist();
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

  return { add, summaryOf, has, flush: disk.flush };
}

module.exports = { createStatsStore };
