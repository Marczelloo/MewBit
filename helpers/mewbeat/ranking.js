const { playPp, ratingOf } = require("./rating");

const CHART_KEY = /^(.*)\|(easy|normal|hard|hell)\|(.+)$/;
// The local test player scores under this id; it is not a person to rank.
const LOCAL_USER = "local-user";

// Ranks players by rating over every best score of the chart version that is current now. Scores of an
// older chart version of a song count for nothing, since the stars and the notes behind them are gone.
// The table is rebuilt from `walk` (scoreStore.forEachEntry) at most once per ttlMs, because every
// request would otherwise walk the whole score file.
//
// currentOf(audioKey, difficulty) -> { chartKey, stars } | null: the current chart, if the song has one.
// trackOf(userId, audioKey) -> { title, artist, artworkUrl } | null: for scores saved without a title.
function createRanking({ walk, currentOf, trackOf, now = Date.now, ttlMs = 60000 }) {
  let table = null; // { builtAt, players: Map(userId -> player), ordered: player[] }

  function build() {
    const players = new Map();
    walk((chartKey, entry) => {
      const match = CHART_KEY.exec(chartKey);
      if (!match || entry.userId === LOCAL_USER) return;
      const [, audioKey, difficulty] = match;
      const current = currentOf(audioKey, difficulty);
      if (!current || current.chartKey !== chartKey) return;

      let player = players.get(entry.userId);
      if (!player) {
        player = { userId: entry.userId, username: entry.username, avatarUrl: entry.avatarUrl ?? null, seenAt: -Infinity, guildIds: new Set(), plays: [] };
        players.set(entry.userId, player);
      }
      // The name and avatar of the most recently played entry are the freshest.
      if ((entry.at ?? 0) >= player.seenAt) {
        player.seenAt = entry.at ?? 0;
        player.username = entry.username;
        player.avatarUrl = entry.avatarUrl ?? null;
      }
      for (const guildId of entry.guildIds ?? []) player.guildIds.add(guildId);
      player.plays.push({
        audioKey,
        difficulty,
        stars: current.stars,
        // A run that stopped early is rated on the share of the map it played; the accuracy shown stays its own.
        pp: playPp({ stars: current.stars, accuracy: entry.accuracy * (entry.completion ?? 1) }),
        accuracy: entry.accuracy,
        grade: entry.grade,
        score: entry.score,
        entry,
      });
    });

    for (const player of players.values()) {
      player.plays.sort((a, b) => b.pp - a.pp);
      player.pp = ratingOf(player.plays.map((play) => play.pp));
      player.accuracy = player.plays.reduce((sum, play) => sum + play.accuracy, 0) / player.plays.length;
    }
    const ordered = [...players.values()].sort((a, b) => b.pp - a.pp || String(a.userId).localeCompare(String(b.userId)));
    return { builtAt: now(), players, ordered };
  }

  function current() {
    if (!table || now() - table.builtAt >= ttlMs) table = build();
    return table;
  }

  // Players with a counted play in the guild; null: everyone. Their rating stays the global one.
  function scoped(guildId) {
    const { ordered } = current();
    return guildId ? ordered.filter((player) => player.guildIds.has(guildId)) : ordered;
  }

  function rowsFor({ guildId = null, limit = 50 } = {}) {
    return scoped(guildId).slice(0, limit).map((player, index) => ({
      rank: index + 1,
      userId: player.userId,
      username: player.username,
      avatarUrl: player.avatarUrl,
      pp: player.pp,
      accuracy: player.accuracy,
    }));
  }

  function rankOf({ userId, guildId = null }) {
    const index = scoped(guildId).findIndex((player) => player.userId === userId);
    return index === -1 ? null : index + 1;
  }

  function playerOf(userId) {
    const player = current().players.get(userId);
    if (!player) return null;
    return {
      username: player.username,
      avatarUrl: player.avatarUrl,
      pp: player.pp,
      accuracy: player.accuracy,
      plays: player.plays.map(({ audioKey, difficulty, stars, pp, accuracy, grade, score, entry }) => {
        const track = entry.title ? entry : trackOf(userId, audioKey);
        return {
          audioKey, difficulty, stars, pp, accuracy, grade, score,
          title: track?.title ?? "Unknown title",
          artist: track?.artist ?? "",
          artworkUrl: track?.artworkUrl ?? null,
        };
      }),
    };
  }

  function invalidate() {
    table = null;
  }

  return { rowsFor, rankOf, playerOf, invalidate };
}

module.exports = { createRanking };
