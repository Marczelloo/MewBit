const path = require("node:path");

const { createDebouncedJson } = require("./debouncedJson");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "mewbeat", "scores.json");

const VERSION_SUFFIX = /^(.*)\|(\d+)$/;

// Best score per user per chart (`audioKey|difficulty|chartVersion`), with the
// guilds the user scored it in: the server board is the users who scored the
// chart in that guild, the global board is everyone.
//
// File shape: { charts: { [chartKey]: { [userId]: entry } } }. Scores of
// older chart versions stay on disk, but only the newest version of a song and
// difficulty is looked up (through an index kept next to the map).
function createScoreStore({ file = DEFAULT_FILE, now = Date.now, debounceMs = 2000 } = {}) {
  const disk = createDebouncedJson({ file, debounceMs });
  const loaded = disk.load();
  const charts = new Map(); // chartKey -> Map(userId -> entry)
  const latest = new Map(); // `audioKey|difficulty` -> { version, chartKey }

  function indexChart(chartKey) {
    const match = VERSION_SUFFIX.exec(chartKey);
    if (!match) return;
    const version = Number(match[2]);
    const known = latest.get(match[1]);
    if (!known || version > known.version) latest.set(match[1], { version, chartKey });
  }

  for (const [chartKey, users] of Object.entries(loaded?.charts ?? {})) {
    if (!users || typeof users !== "object") continue;
    charts.set(chartKey, new Map(Object.entries(users).filter(([, entry]) => entry && Number.isFinite(entry.score))));
    indexChart(chartKey);
  }

  const persist = () => disk.schedule(() => ({
    charts: Object.fromEntries([...charts].map(([key, users]) => [key, Object.fromEntries(users)])),
  }));

  function publicEntry(entry) {
    return {
      userId: entry.userId,
      username: entry.username,
      avatarUrl: entry.avatarUrl ?? null,
      score: entry.score,
      accuracy: entry.accuracy,
      grade: entry.grade,
      maxCombo: entry.maxCombo,
      at: entry.at,
    };
  }

  function submit({ chartKey, userId, guildId, profile, score, accuracy, grade, maxCombo, difficulty, at = now() }) {
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

    const base = newBest ? { score, accuracy, grade, maxCombo, difficulty, at } : previous;
    const entry = {
      ...base,
      userId,
      // The profile of the latest round keeps the name and avatar fresh.
      username: profile?.username ?? previous?.username ?? "Unknown",
      avatarUrl: profile ? profile.avatarUrl ?? null : previous?.avatarUrl ?? null,
      guildIds: [...guildIds],
    };
    users.set(userId, entry);
    persist();
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

  // The chartKey with the highest chart version anyone has scored for this
  // song and difficulty; null when there is none.
  function latestChartKey(audioKey, difficulty) {
    return latest.get(`${audioKey}|${difficulty}`)?.chartKey ?? null;
  }

  return { submit, board, rankOf, bestOf, latestChartKey, flush: disk.flush };
}

module.exports = { createScoreStore };
