const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createRanking } = require("../../../helpers/mewbeat/ranking");
const { playPp, ratingOf } = require("../../../helpers/mewbeat/rating");

const entry = (userId, overrides) => ({
  userId, username: userId.toUpperCase(), avatarUrl: null, score: 1000, accuracy: 90, grade: "A", guildIds: ["g1"], at: 1, ...overrides,
});

// `rows` is [chartKey, entry][]. A chart is current unless its `audioKey|difficulty` is listed in `stale`
// (then the current chart has another version).
function setup(rows, { stale = [], stars = 3, tracks = {}, ttlMs, clock = { t: 0 } } = {}) {
  const calls = { walk: 0 };
  const ranking = createRanking({
    walk: (fn) => { calls.walk += 1; for (const [chartKey, e] of rows) fn(chartKey, e); },
    currentOf: (audioKey, difficulty) => {
      if (stale.includes(`${audioKey}|${difficulty}`)) return { chartKey: `${audioKey}|${difficulty}|99`, stars };
      const known = rows.find(([key]) => key.startsWith(`${audioKey}|${difficulty}|`));
      return known ? { chartKey: known[0], stars } : null;
    },
    trackOf: (userId, audioKey) => tracks[`${userId}:${audioKey}`] ?? null,
    now: () => clock.t,
    ttlMs,
  });
  return { ranking, calls, clock };
}

describe("mewbeat ranking", () => {
  it("rates a partial run on accuracy times completion, and an entry without one as complete", () => {
    const { ranking } = setup([
      ["a|hard|4", entry("part", { accuracy: 97, completion: 0.55 })],
      ["a|hard|4", entry("full", { accuracy: 97 })],
    ]);
    const [full, part] = ranking.rowsFor({ guildId: null, limit: 10 });
    assert.deepStrictEqual([full.userId, part.userId], ["full", "part"]);
    assert.strictEqual(full.pp, ratingOf([playPp({ stars: 3, accuracy: 97 })]));
    assert.strictEqual(part.pp, ratingOf([playPp({ stars: 3, accuracy: 97 * 0.55 })]));
    assert.ok(part.pp < full.pp);
    // What is shown stays the accuracy of the run.
    assert.strictEqual(part.accuracy, 97);
    assert.strictEqual(ranking.playerOf("part").plays[0].accuracy, 97);
  });

  it("counts only entries of the chart that is current", () => {
    const { ranking } = setup([["a|hard|4", entry("u1")]], { stale: ["a|hard"] });
    assert.strictEqual(ranking.rankOf({ userId: "u1" }), null);
    assert.deepStrictEqual(ranking.rowsFor({ guildId: null, limit: 10 }), []);
  });

  it("counts nothing when the song has no current chart", () => {
    const ranking = createRanking({ walk: (fn) => fn("a|hard|4", entry("u1")), currentOf: () => null, trackOf: () => null, now: () => 0 });
    assert.deepStrictEqual(ranking.rowsFor({ guildId: null, limit: 10 }), []);
    assert.strictEqual(ranking.playerOf("u1"), null);
  });

  it("sorts players by rating and ranks from 1", () => {
    const { ranking } = setup([
      ["a|hard|4", entry("low", { accuracy: 70 })],
      ["a|hard|4", entry("high", { accuracy: 98 })],
      ["b|hard|4", entry("low", { accuracy: 70 })],
    ]);
    const rows = ranking.rowsFor({ guildId: null, limit: 10 });
    assert.deepStrictEqual(rows.map((r) => [r.rank, r.userId]), [[1, "high"], [2, "low"]]);
    assert.strictEqual(rows[0].pp, ratingOf([playPp({ stars: 3, accuracy: 98 })]));
    assert.strictEqual(rows[0].username, "HIGH");
    assert.strictEqual(ranking.rankOf({ userId: "low" }), 2);
    assert.strictEqual(ranking.rowsFor({ guildId: null, limit: 1 }).length, 1);
  });

  it("keeps a server's players but their global rating", () => {
    const { ranking } = setup([
      ["a|hard|4", entry("u1", { guildIds: ["g1"], accuracy: 99 })],
      ["b|hard|4", entry("u1", { guildIds: ["g2"], accuracy: 99 })],
      ["a|hard|4", entry("u2", { guildIds: ["g1"], accuracy: 60 })],
      ["b|hard|4", entry("u3", { guildIds: ["g2"], accuracy: 95 })],
    ]);
    const rows = ranking.rowsFor({ guildId: "g1", limit: 10 });
    assert.deepStrictEqual(rows.map((r) => [r.rank, r.userId]), [[1, "u1"], [2, "u2"]]);
    const global = ranking.rowsFor({ guildId: null, limit: 10 }).find((r) => r.userId === "u1");
    assert.strictEqual(rows[0].pp, global.pp);
    assert.strictEqual(ranking.rankOf({ userId: "u2", guildId: "g1" }), 2);
    assert.strictEqual(ranking.rankOf({ userId: "u3", guildId: "g1" }), null);
  });

  it("leaves local-user out", () => {
    const { ranking } = setup([["a|hard|4", entry("local-user")]]);
    assert.deepStrictEqual(ranking.rowsFor({ guildId: null, limit: 10 }), []);
    assert.strictEqual(ranking.playerOf("local-user"), null);
  });

  it("averages the accuracy of the counted plays", () => {
    const { ranking } = setup([
      ["a|hard|4", entry("u1", { accuracy: 90 })],
      ["b|hard|4", entry("u1", { accuracy: 80 })],
    ]);
    assert.strictEqual(ranking.rowsFor({ guildId: null, limit: 10 })[0].accuracy, 85);
    assert.strictEqual(ranking.playerOf("u1").accuracy, 85);
  });

  it("describes a player with the plays best first and a track from the entry or the history", () => {
    const { ranking } = setup([
      ["a|hard|4", entry("u1", { accuracy: 70, title: "Song A", artist: "Art A", artworkUrl: "https://x/a.png" })],
      ["b|normal|4", entry("u1", { accuracy: 99 })],
      ["c|easy|4", entry("u1", { accuracy: 99 })],
    ], { tracks: { "u1:b": { title: "Song B", artist: "Art B", artworkUrl: null } } });
    const player = ranking.playerOf("u1");
    assert.strictEqual(player.username, "U1");
    assert.strictEqual(player.avatarUrl, null);
    assert.strictEqual(player.pp, ratingOf(player.plays.map((p) => p.pp)));
    assert.deepStrictEqual(player.plays.map((p) => p.audioKey), ["b", "c", "a"]);
    assert.deepStrictEqual(player.plays[2], {
      audioKey: "a", difficulty: "hard", stars: 3, pp: playPp({ stars: 3, accuracy: 70 }), accuracy: 70, grade: "A", score: 1000,
      title: "Song A", artist: "Art A", artworkUrl: "https://x/a.png",
    });
    assert.strictEqual(player.plays[0].title, "Song B");
    assert.strictEqual(player.plays[1].title, "Unknown title");
    assert.strictEqual(ranking.playerOf("nobody"), null);
  });

  it("parses chart keys that carry generator flags", () => {
    const { ranking } = setup([["yt:a:1|hard|44-easySameCuts-hardHolds", entry("u1", { title: "T" })]]);
    const [play] = ranking.playerOf("u1").plays;
    assert.strictEqual(play.audioKey, "yt:a:1");
    assert.strictEqual(play.difficulty, "hard");
  });

  it("reuses the table within the ttl, and rebuilds after it or on invalidate", () => {
    const { ranking, calls, clock } = setup([["a|hard|4", entry("u1")]], { ttlMs: 1000 });
    ranking.rowsFor({ guildId: null, limit: 5 });
    ranking.rankOf({ userId: "u1" });
    ranking.playerOf("u1");
    assert.strictEqual(calls.walk, 1);
    clock.t = 999;
    ranking.rowsFor({ guildId: null, limit: 5 });
    assert.strictEqual(calls.walk, 1);
    clock.t = 1000;
    ranking.rowsFor({ guildId: null, limit: 5 });
    assert.strictEqual(calls.walk, 2);
    ranking.invalidate();
    ranking.rowsFor({ guildId: null, limit: 5 });
    assert.strictEqual(calls.walk, 3);
  });
});
