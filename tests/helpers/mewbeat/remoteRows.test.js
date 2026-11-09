const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createHistoryStore, historyFromRow, historyRowOf } = require("../../../helpers/mewbeat/historyStore");
const { TABLES } = require("../../../helpers/mewbeat/remoteSchema");
const { createScoreStore, scoreFromRow, scoreRowOf } = require("../../../helpers/mewbeat/scoreStore");
const { createStatsStore, statsFromRow, statsRowOf } = require("../../../helpers/mewbeat/statsStore");

// A remote that only writes down what the store sends.
function recorder() {
  const writes = [];
  return {
    writes,
    ready: () => true,
    upsert: (table, id, row) => writes.push({ kind: "upsert", table, id, row }),
    insert: (table, id, row) => writes.push({ kind: "insert", table, id, row }),
    defer: () => assert.fail("a ready store does not defer"),
  };
}

// What the hub sends back for a row we sent: through JSON, jsonb parsed, bigint maybe as a string.
function asRead(row, { bigintAsString = false, parseJsonb = true } = {}, table) {
  const copy = JSON.parse(JSON.stringify(row));
  for (const column of table.columns) {
    if (column.type === "jsonb" && parseJsonb && typeof copy[column.name] === "string") copy[column.name] = JSON.parse(copy[column.name]);
    if (column.type === "bigint" && bigintAsString && copy[column.name] !== null) copy[column.name] = String(copy[column.name]);
  }
  return copy;
}

const everyColumn = (table, row) => table.columns.every((column) => column.name in row);

function entriesOf(store) {
  const entries = [];
  store.forEachEntry((chartKey, entry) => entries.push([chartKey, entry]));
  return entries;
}

describe("mewbeat rows of the AtlasHub tables", () => {
  describe("scores", () => {
    const track = { title: "Song", artist: "Band", artworkUrl: "https://a/1.png" };
    const runs = [
      { chartKey: "youtube:abc:200000|hard|4", userId: "u1", guildId: "g1", profile: { username: "Ann", avatarUrl: "https://a/1.png" }, score: 1000, accuracy: 90.5, grade: "A", maxCombo: 20, difficulty: "hard", at: 100, completion: 0.97, track },
      { chartKey: "youtube:abc:200000|hard|4", userId: "u2", profile: { username: "Bo" }, score: 500, accuracy: 70, grade: "C", maxCombo: 9, difficulty: "hard", at: 200 },
      { chartKey: "local:x|y|z:1|easy|31-holds", userId: "u1", guildId: "g2", score: 77, accuracy: 55.25, grade: "D", maxCombo: 3, difficulty: "easy", at: 300, completion: 1, track: { title: "Other", artist: "", artworkUrl: null } },
    ];

    for (const options of [{}, { bigintAsString: true }, { parseJsonb: false }]) {
      it(`round-trips a store exactly (${JSON.stringify(options)})`, () => {
        const remote = recorder();
        const original = createScoreStore({ remote });
        for (const run of runs) original.submit(run);
        original.submit({ ...runs[0], guildId: "g9", score: 1500, at: 400 }); // a new best that adds a guild

        const rows = remote.writes.map((write) => asRead(write.row, options, TABLES.scores));
        assert.ok(rows.every((row) => everyColumn(TABLES.scores, row)), "every column is sent, null when empty");
        const restored = createScoreStore({ remote: recorder() });
        restored.hydrate(rows);

        const sortKey = ([chartKey, entry]) => `${chartKey}|${entry.userId}`;
        assert.deepStrictEqual(entriesOf(restored).sort((a, b) => sortKey(a).localeCompare(sortKey(b))), entriesOf(original).sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
        assert.strictEqual(restored.latestChartKey("youtube:abc:200000", "hard"), "youtube:abc:200000|hard|4");
      });
    }

    it("keeps a completion that is missing missing, and a zero a zero", () => {
      const remote = recorder();
      const store = createScoreStore({ remote });
      store.submit({ ...runs[1] });
      store.submit({ ...runs[0], userId: "u3", completion: 0 });
      const [without, zero] = remote.writes.map((write) => scoreFromRow(write.row).entry);
      assert.strictEqual(without.completion, undefined);
      assert.ok("completion" in without);
      assert.strictEqual(zero.completion, 0);
    });

    it("sends guild_ids as a JSON string and whole numbers for the integer columns", () => {
      const row = scoreRowOf("a|hard|4", { userId: "u", score: 10.4, maxCombo: 7.6, at: 99.5, guildIds: ["g1", "g2"] });
      assert.strictEqual(row.guild_ids, '["g1","g2"]');
      assert.deepStrictEqual([row.score, row.max_combo, row.at], [10, 8, 100]);
      assert.strictEqual(row.id, "a|hard|4|u");
      assert.deepStrictEqual([row.audio_key, row.chart_version], ["a", "4"]);
    });

    it("skips a row that is no score", () => {
      assert.strictEqual(scoreFromRow({ chart_key: "a|hard|4", user_id: "u", score: null }), null);
      assert.strictEqual(scoreFromRow({ chart_key: null, user_id: "u", score: 5 }), null);
      assert.strictEqual(scoreFromRow(undefined), null);
    });
  });

  describe("history", () => {
    const rounds = [
      { audioKey: "youtube:a", uri: "https://y/a", source: "youtube", title: "A", artist: "Band", artworkUrl: "https://a/a.png", durationMs: 200000, difficulty: "hard", score: 1234, accuracy: 91.25, grade: "S", ranked: true, mode: "live", guildId: "g1", chartVersion: 31, at: 1000 },
      { audioKey: "youtube:a", uri: null, source: "", title: "A", artist: "", artworkUrl: null, durationMs: 0, difficulty: "easy", score: 0, accuracy: 0, grade: "F", ranked: false, mode: "solo", guildId: null, chartVersion: "31-holds", at: 2000 },
      { audioKey: "local:b", uri: null, source: "local", title: "B", artist: "", artworkUrl: null, durationMs: 90000, difficulty: "normal", score: 5, accuracy: 10, grade: "D", ranked: true, mode: "live", guildId: "g1", at: 3000 }, // from before chartVersion
    ];

    for (const options of [{}, { bigintAsString: true }]) {
      it(`round-trips a user's rounds exactly (${JSON.stringify(options)})`, () => {
        const remote = recorder();
        const original = createHistoryStore({ remote });
        for (const round of rounds) original.add("u1", round);
        original.add("u2", rounds[0]);

        const rows = remote.writes.map((write) => asRead(write.row, options, TABLES.history));
        assert.ok(rows.every((row) => everyColumn(TABLES.history, row)));
        const restored = createHistoryStore({ remote: recorder() });
        restored.hydrate(rows.reverse()); // in any order

        assert.deepStrictEqual(restored.recent("u1", 10), original.recent("u1", 10));
        assert.deepStrictEqual(restored.recent("u2", 10), original.recent("u2", 10));
        assert.deepStrictEqual(restored.played({ limit: 10 }), original.played({ limit: 10 }));
      });
    }

    it("keeps a chartVersion as text in the row and as a number when it was one", () => {
      assert.strictEqual(historyRowOf("u", { audioKey: "a", difficulty: "easy", at: 1, chartVersion: 31 }).chart_version, "31");
      assert.strictEqual(historyFromRow({ user_id: "u", audio_key: "a", chart_version: "31" }).entry.chartVersion, 31);
      assert.strictEqual(historyFromRow({ user_id: "u", audio_key: "a", chart_version: "31-holds" }).entry.chartVersion, "31-holds");
      assert.ok(!("chartVersion" in historyFromRow({ user_id: "u", audio_key: "a", chart_version: null }).entry));
    });

    it("gives a round the same id however often it is sent", () => {
      const first = historyRowOf("u", rounds[0]);
      assert.strictEqual(historyRowOf("u", { ...rounds[0] }).id, first.id);
      assert.notStrictEqual(historyRowOf("u", { ...rounds[0], difficulty: "easy" }).id, first.id);
      assert.notStrictEqual(historyRowOf("v", rounds[0]).id, first.id);
    });

    it("keeps the last perUser rounds in memory while every round is a row", () => {
      const remote = recorder();
      const store = createHistoryStore({ remote, perUser: 3 });
      for (let at = 1; at <= 5; at += 1) store.add("u", { ...rounds[0], at });
      assert.strictEqual(remote.writes.length, 5);
      assert.deepStrictEqual(store.recent("u", 10).map((round) => round.at), [5, 4, 3]);
      const restored = createHistoryStore({ remote: recorder(), perUser: 3 });
      restored.hydrate(remote.writes.map((write) => write.row));
      assert.deepStrictEqual(restored.recent("u", 10).map((round) => round.at), [5, 4, 3]);
    });

    it("does not add a round twice when the journal holds one the database has", () => {
      const remote = recorder();
      const store = createHistoryStore({ remote });
      store.add("u", rounds[0]);
      store.add("u", rounds[1]);
      const rows = remote.writes.map((write) => write.row);

      const restored = createHistoryStore({ remote: recorder() });
      restored.hydrate([rows[0]]);
      for (const row of rows) restored.applyOp({ kind: "insert", table: TABLES.history.name, rowId: row.id, row });
      assert.deepStrictEqual(restored.recent("u", 10), store.recent("u", 10));
    });
  });

  describe("stats", () => {
    const run = (extra) => ({
      profile: { username: "Ann", avatarUrl: "https://a/1.png" }, audioKey: "youtube:a", difficulty: "hard", track: { title: "A" }, durationMs: 120000,
      accuracy: 93.5, counts: { perfect: 100, great: 20, good: 5, miss: 0 }, maxCombo: 125, parts: 125, fevers: 2, presses: 140, emptyPresses: 15,
      holdMs: 4000, longestHoldMs: 1500, timing: { n: 125, sum: -250, sumSq: 9000, early: 70, late: 40 }, ...extra,
    });

    for (const options of [{}, { bigintAsString: true }, { parseJsonb: false }]) {
      it(`round-trips a player's totals exactly (${JSON.stringify(options)})`, () => {
        const remote = recorder();
        const original = createStatsStore({ remote, now: () => 5000 });
        original.add("u1", run());
        original.add("u1", run({ audioKey: "youtube:b", difficulty: "easy", track: { title: "B" }, counts: { perfect: 3, great: 0, good: 0, miss: 4 }, maxCombo: 40, parts: 90, profile: { username: "Ann2" } }), 6000);
        original.add("u2", run({ profile: null }));

        const last = new Map(remote.writes.map((write) => [write.id, write]));
        const rows = [...last.values()].map((write) => asRead(write.row, options, TABLES.stats));
        assert.ok(rows.every((row) => everyColumn(TABLES.stats, row)));
        const restored = createStatsStore({ remote: recorder() });
        restored.hydrate(rows);

        for (const userId of ["u1", "u2"]) assert.deepStrictEqual(restored.summaryOf(userId), original.summaryOf(userId));
        assert.strictEqual(restored.summaryOf("u1").firstAt, 5000);
        assert.strictEqual(restored.summaryOf("u1").plays, 2);
        assert.strictEqual(restored.has("nobody"), false);
      });
    }

    it("sends the full row every time, so a resend sets the same totals", () => {
      const remote = recorder();
      const store = createStatsStore({ remote });
      store.add("u1", run());
      store.add("u1", run());
      const [first, second] = remote.writes;
      assert.strictEqual(first.id, "u1");
      assert.strictEqual(first.row.plays, 1);
      assert.strictEqual(second.row.plays, 2);
      assert.strictEqual(typeof second.row.data, "string", "jsonb goes in as a JSON string");
    });

    it("lets revive repair a row that was edited by hand", () => {
      const parsed = statsFromRow({ user_id: "u", username: null, avatar_url: 5, first_at: "x", plays: "3", play_ms: null, data: { counts: { perfect: "many", miss: -2 }, timing: { sum: "no", n: 4 }, maps: { k: { audioKey: "a", maxCombo: 9 }, bad: {} } } });
      const { totals } = parsed;
      assert.strictEqual(totals.username, "");
      assert.strictEqual(totals.avatarUrl, null);
      assert.strictEqual(totals.firstAt, 0);
      assert.strictEqual(totals.plays, 3);
      assert.strictEqual(totals.playMs, 0);
      assert.deepStrictEqual(totals.counts, { perfect: 0, great: 0, good: 0, miss: 0 });
      assert.strictEqual(totals.timing.n, 4);
      assert.strictEqual(totals.timing.sum, 0);
      assert.deepStrictEqual(Object.keys(totals.maps), ["k"]);
      assert.strictEqual(statsFromRow({ user_id: "u", data: "not json" }).totals.plays, 0);
      assert.strictEqual(statsFromRow({ data: "{}" }), null);
    });

    it("rounds the columns that are integers", () => {
      const row = statsRowOf("u", { username: "", avatarUrl: null, firstAt: 10.4, plays: 2, playMs: 1999.6, counts: {}, timing: {}, maps: {} }, 77.5);
      assert.deepStrictEqual([row.first_at, row.play_ms, row.at], [10, 2000, 78]);
    });
  });
});
