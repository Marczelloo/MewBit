const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createAtlasHubClient } = require("../../../helpers/mewbeat/atlasHub");
const { createHistoryStore } = require("../../../helpers/mewbeat/historyStore");
const { createOutbox } = require("../../../helpers/mewbeat/outbox");
const { createRemoteSync, senderOf } = require("../../../helpers/mewbeat/remoteSync");
const { TABLES } = require("../../../helpers/mewbeat/remoteSchema");
const { createScoreStore } = require("../../../helpers/mewbeat/scoreStore");
const { createStatsStore } = require("../../../helpers/mewbeat/statsStore");
const { createFakeAtlasHub } = require("./fakeAtlasHub");

const KEY = "youtube:abc:200000|hard|4";

const statsRun = (extra) => ({
  profile: { username: "Ann", avatarUrl: null }, audioKey: "youtube:abc", difficulty: "hard", track: { title: "A" }, durationMs: 1000,
  accuracy: 90, counts: { perfect: 10, great: 0, good: 0, miss: 0 }, maxCombo: 10, parts: 10, ...extra,
});

describe("mewbeat stores on AtlasHub", () => {
  let dir;
  let hub;
  let clock; // the stores' and the outbox's time
  let retries;
  let logged;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-remote-"));
    hub = createFakeAtlasHub();
    clock = 10_000;
    retries = [];
    logged = { warning: [], success: [], error: [] };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // One process: stores, outbox and sync over the same hub and journal. Several boots over one journal are restarts.
  function boot({ journal = "outbox.jsonl", requestsPerMinute = 600 } = {}) {
    const client = createAtlasHubClient({ url: "https://hub.example", secretKey: "test-key", fetchImpl: hub.fetch, timeoutMs: 500 });
    const log = { info() {}, warning: (...a) => logged.warning.push(a), success: (...a) => logged.success.push(a), error: (...a) => logged.error.push(a) };
    const outbox = createOutbox({
      file: path.join(dir, journal), send: senderOf(client), now: () => clock, random: () => 0, log, requestsPerMinute,
      schedule: () => () => {},
    });
    const sync = createRemoteSync({ client, outbox, log, random: () => 0, schedule: (fn, ms) => { retries.push(ms); return () => {}; } });
    const scores = createScoreStore({ remote: sync.remote, now: () => clock });
    const history = createHistoryStore({ remote: sync.remote, now: () => clock });
    const stats = createStatsStore({ remote: sync.remote, now: () => clock });
    sync.attach({ scores, history, stats });
    return { sync, outbox, scores, history, stats };
  }

  const play = (app, extra) => {
    app.scores.submit({ chartKey: KEY, userId: "u1", guildId: "g1", profile: { username: "Ann" }, score: 1000, accuracy: 90, grade: "A", maxCombo: 20, difficulty: "hard", ...extra });
  };

  it("creates the tables and indexes, then loads empty stores", async () => {
    const app = boot();
    assert.strictEqual(await app.sync.start(), true);
    assert.deepStrictEqual([...hub.tables.keys()].sort(), ["mewbeat_history", "mewbeat_scores", "mewbeat_stats"]);
    assert.strictEqual(hub.count("POST", "/schema/indexes"), 3);
    assert.strictEqual(app.scores.bestOf(KEY, "u1"), null);
    assert.strictEqual(app.sync.status().ready, true);
  });

  it("adds a column that a table made before it lacks, once, and the rows that name it go through", async () => {
    // The tables as an older bot made them: no modifiers on scores, no failed or modifiers on history.
    const older = (table, without) => ({ name: table.name, columns: table.columns.filter((column) => !without.includes(column.name)) });
    for (const [table, without] of [[TABLES.scores, ["modifiers"]], [TABLES.history, ["failed", "modifiers"]]]) {
      const { name, columns } = older(table, without);
      hub.tables.set(name, { columns: new Map(columns.map((column) => [column.name, column.type])), key: table.key, rows: new Map() });
    }
    const app = boot();
    assert.strictEqual(await app.sync.start(), true);
    assert.strictEqual(hub.count("POST", "/columns"), 3);
    play(app, { at: 111, modifiers: ["nf"] });
    app.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 1000, at: 111, failed: true, modifiers: ["nf"] });
    await app.outbox.flush(2000);
    assert.strictEqual(hub.rows("mewbeat_scores").length, 1);
    assert.strictEqual(hub.rows("mewbeat_history").length, 1);

    // A second boot finds the columns there and adds nothing.
    await boot().sync.start();
    assert.strictEqual(hub.count("POST", "/columns"), 3);
  });

  it("writes scores, history and stats to the hub through the journal", async () => {
    const app = boot();
    await app.sync.start();
    play(app, { at: 111 });
    app.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 1000, at: 111 });
    app.stats.add("u1", statsRun());
    assert.strictEqual(hub.rows("mewbeat_scores").length, 0, "nothing waits for the network");
    await app.outbox.flush(2000);

    assert.deepStrictEqual(hub.rows("mewbeat_scores").map((row) => [row.id, row.score, row.guild_ids]), [[`${KEY}|u1`, 1000, '["g1"]']]);
    assert.strictEqual(hub.rows("mewbeat_history").length, 1);
    assert.deepStrictEqual(hub.rows("mewbeat_stats").map((row) => [row.user_id, row.plays]), [["u1", 1]]);
  });

  it("loads the stores from the hub on the next start, bigint strings and all", async () => {
    const first = boot();
    await first.sync.start();
    play(first, { at: 111, completion: 0.9, track: { title: "Song", artist: "Band", artworkUrl: null } });
    first.history.add("u1", { audioKey: "youtube:abc", uri: null, source: "", title: "Song", artist: "", artworkUrl: null, durationMs: 0, difficulty: "hard", score: 1000, accuracy: 90, grade: "A", ranked: true, mode: "live", guildId: "g1", chartVersion: 4, at: 111 });
    first.stats.add("u1", statsRun());
    await first.outbox.flush(2000);

    hub.bigintAsString = true;
    const second = boot({ journal: "other.jsonl" });
    let heard = 0;
    second.scores.onHydrated(() => { heard += 1; });
    await second.sync.start();
    assert.strictEqual(heard, 1);
    assert.deepStrictEqual(second.scores.bestOf(KEY, "u1"), first.scores.bestOf(KEY, "u1"));
    assert.strictEqual(typeof second.scores.bestOf(KEY, "u1").score, "number");
    assert.deepStrictEqual(second.history.recent("u1"), first.history.recent("u1"));
    assert.deepStrictEqual(second.stats.summaryOf("u1"), first.stats.summaryOf("u1"));
  });

  it("does not wait for the network: a down hub leaves the stores empty and the game running", async () => {
    hub.down = true;
    const app = boot();
    assert.strictEqual(await app.sync.start(), false);
    assert.strictEqual(logged.warning.length, 1);
    assert.deepStrictEqual(retries, [5000]);

    assert.deepStrictEqual(app.scores.submit({ chartKey: KEY, userId: "u1", score: 5, at: 1 }), { newBest: false, best: null });
    assert.deepStrictEqual(app.history.recent("u1"), []);
    assert.strictEqual(app.stats.summaryOf("u1"), null);
    assert.strictEqual(app.sync.status().ready, false);
  });

  it("retries in the background, with the wait doubling to five minutes, and says when it recovers", async () => {
    hub.down = true;
    const app = boot();
    for (let attempt = 0; attempt < 9; attempt += 1) await app.sync.start();
    assert.deepStrictEqual(retries, [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
    assert.strictEqual(logged.warning.length, 1, "the same trouble is said once");

    hub.down = false;
    assert.strictEqual(await app.sync.start(), true);
    assert.strictEqual(logged.success.length, 1);
  });

  it("replays what was played before the load, in order, with the times it had", async () => {
    hub.down = true;
    const app = boot();
    await app.sync.start();
    clock = 20_000;
    play(app, { score: 100 });
    app.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 100 });
    app.stats.add("u1", statsRun());
    clock = 30_000;
    play(app, { score: 200 });
    app.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 200 });
    app.stats.add("u1", statsRun());
    assert.strictEqual(app.outbox.deferredOps().length, 6);

    clock = 99_000_000; // long after: a replay that asked the clock again would show it
    hub.down = false;
    assert.strictEqual(await app.sync.start(), true);
    assert.strictEqual(app.outbox.deferredOps().length, 0);
    assert.deepStrictEqual([app.scores.bestOf(KEY, "u1").score, app.scores.bestOf(KEY, "u1").at], [200, 30_000]);
    assert.deepStrictEqual(app.history.recent("u1").map((round) => [round.score, round.at]), [[200, 30_000], [100, 20_000]]);
    assert.strictEqual(app.stats.summaryOf("u1").plays, 2);
    assert.strictEqual(app.stats.summaryOf("u1").firstAt, 20_000);

    await app.outbox.flush(2000);
    assert.deepStrictEqual(hub.rows("mewbeat_scores").map((row) => [row.score, row.at]), [[200, 30_000]]);
    assert.deepStrictEqual(hub.rows("mewbeat_history").map((row) => row.at).sort(), [20_000, 30_000]);
    assert.deepStrictEqual(hub.rows("mewbeat_stats").map((row) => [row.plays, row.first_at]), [[2, 20_000]]);
  });

  it("finds the deferred calls again after a crash and replays them once", async () => {
    hub.down = true;
    const before = boot();
    await before.sync.start();
    clock = 20_000;
    play(before, { score: 100 });
    before.stats.add("u1", statsRun());

    clock = 40_000;
    hub.down = false;
    const after = boot(); // the process died; same journal
    assert.strictEqual(after.outbox.deferredOps().length, 2);
    await after.sync.start();
    assert.strictEqual(after.stats.summaryOf("u1").plays, 1);
    assert.strictEqual(after.scores.bestOf(KEY, "u1").at, 20_000);
    await after.outbox.flush(2000);

    const third = boot({ journal: "outbox.jsonl" });
    assert.strictEqual(third.outbox.deferredOps().length, 0);
    assert.strictEqual(third.outbox.rowOps().length, 0);
    await third.sync.start();
    assert.strictEqual(third.stats.summaryOf("u1").plays, 1, "not counted twice");
  });

  it("does not let a run before the load overwrite the totals in the database", async () => {
    const first = boot();
    await first.sync.start();
    for (let index = 0; index < 5; index += 1) first.stats.add("u1", statsRun());
    await first.outbox.flush(2000);
    assert.strictEqual(hub.rows("mewbeat_stats")[0].plays, 5);

    const second = boot({ journal: "second.jsonl" });
    const loading = second.sync.start();
    second.stats.add("u1", statsRun()); // the load has not reached the stores yet
    assert.strictEqual(second.stats.summaryOf("u1"), null);
    await loading;
    assert.strictEqual(second.stats.summaryOf("u1").plays, 6);
    await second.outbox.flush(2000);
    assert.strictEqual(hub.rows("mewbeat_stats")[0].plays, 6);
  });

  it("puts the journal over the loaded rows: a write the hub never saw is newer", async () => {
    const first = boot();
    await first.sync.start();
    play(first, { score: 100, at: 1 });
    first.stats.add("u1", statsRun());
    await first.outbox.flush(2000);

    hub.down = true; // the next round is played while the hub is out
    play(first, { score: 900, at: 2 });
    first.stats.add("u1", statsRun());
    first.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 900, at: 2 });
    await first.outbox.flush(100);
    assert.strictEqual(first.outbox.status().pending, 3);

    hub.down = false;
    const second = boot(); // restart, same journal
    await second.sync.start();
    assert.strictEqual(second.scores.bestOf(KEY, "u1").score, 900);
    assert.strictEqual(second.stats.summaryOf("u1").plays, 2);
    assert.strictEqual(second.history.recent("u1").length, 1);
    assert.strictEqual(hub.rows("mewbeat_scores")[0].score, 100, "the hub is still behind");

    await second.outbox.flush(2000);
    assert.strictEqual(hub.rows("mewbeat_scores")[0].score, 900);
    assert.strictEqual(hub.rows("mewbeat_stats")[0].plays, 2);
    assert.strictEqual(hub.rows("mewbeat_history").length, 1);
  });

  it("does not count a run twice when the answer to its write is lost and it is sent again", async () => {
    const app = boot();
    await app.sync.start();
    app.stats.add("u1", statsRun());
    await app.outbox.flush(2000);
    assert.strictEqual(hub.rows("mewbeat_stats")[0].plays, 1);

    app.stats.add("u1", statsRun());
    hub.loseNextResponse = true; // the hub applies the update, the answer never arrives
    await app.outbox.flush(2000);
    assert.strictEqual(app.outbox.status().pending, 1, "the writer cannot know it went through");
    assert.strictEqual(hub.rows("mewbeat_stats")[0].plays, 2);

    await app.outbox.flush(2000);
    assert.strictEqual(app.outbox.status().pending, 0);
    assert.strictEqual(hub.rows("mewbeat_stats")[0].plays, 2);
  });

  it("does not add a round twice when the answer to its insert is lost", async () => {
    const app = boot();
    await app.sync.start();
    app.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 1, at: 7 });
    hub.loseNextResponse = true;
    await app.outbox.flush(2000);
    assert.strictEqual(app.outbox.status().pending, 1);
    await app.outbox.flush(2000);
    assert.strictEqual(app.outbox.status().pending, 0);
    assert.strictEqual(app.outbox.status().dead, 0);
    assert.strictEqual(hub.rows("mewbeat_history").length, 1, "the resend met a duplicate key and counted as done");
  });

  it("keeps everything when the key is refused, and drains once it works", async () => {
    const app = boot();
    await app.sync.start();
    hub.rejectKey = true;
    play(app, { score: 5, at: 1 });
    app.stats.add("u1", statsRun());
    await app.outbox.flush(100);
    assert.strictEqual(app.outbox.status().pending, 2);
    assert.strictEqual(logged.error.length, 1);

    hub.rejectKey = false;
    clock += 5 * 60_000;
    await app.outbox.flush(2000);
    assert.strictEqual(app.outbox.status().pending, 0);
    assert.strictEqual(hub.rows("mewbeat_scores").length, 1);
  });

  it("keeps to the requests-per-minute budget when many writes pile up", async () => {
    const app = boot({ requestsPerMinute: 5 });
    await app.sync.start();
    const writes = hub.requests.length;
    for (let index = 0; index < 20; index += 1) app.stats.add(`u${index}`, statsRun());
    assert.strictEqual(await app.outbox.pump(), "tokens");
    // A new user is a patch and an insert, so two requests each: the third write takes the bucket from 1 to -1.
    assert.strictEqual(hub.requests.length - writes, 6);
    assert.strictEqual(hub.rows("mewbeat_stats").length, 3);
  });

  it("sends only well-formed values: no fractions in integer columns, jsonb as strings", async () => {
    const app = boot();
    await app.sync.start();
    app.scores.submit({ chartKey: KEY, userId: "u1", score: 1000.7, accuracy: 90.123, grade: "A", maxCombo: 20.2, difficulty: "hard", at: 12.5, guildId: "g1" });
    app.stats.add("u1", statsRun({ durationMs: 1000.5 }));
    app.history.add("u1", { audioKey: "youtube:abc", difficulty: "hard", title: "A", score: 3.5, durationMs: 99.5, at: 8 });
    await app.outbox.flush(2000);
    assert.strictEqual(app.outbox.status().dead, 0, "the hub refused nothing");
    assert.strictEqual(app.outbox.status().pending, 0);
    assert.strictEqual(TABLES.scores.name, "mewbeat_scores");
  });
});
