const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { CLASSICS } = require("../../../helpers/mewbeat/classics");
const { createHistoryStore } = require("../../../helpers/mewbeat/historyStore");
const { createScoreStore } = require("../../../helpers/mewbeat/scoreStore");
const { createStatsStore } = require("../../../helpers/mewbeat/statsStore");

const ANN = { id: "ann", username: "Ann", avatarUrl: null };
const NOW = 1_700_000_000_000;

const keyOf = (id) => `youtube:${id}:200000`;
const round = (id, extra) => ({
  audioKey: keyOf(id), uri: `https://y/${id}`, source: "youtube", title: `Song ${id}`, artist: `Artist ${id}`, artworkUrl: null, durationMs: 200_000,
  difficulty: "normal", score: 9000, accuracy: 96, grade: "S", ranked: true, mode: "solo", guildId: "g1", failed: false, at: NOW - 86_400_000, ...extra,
});

describe("mewbeat channel suggestions", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-recs-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Charts exist for "known" only (all four levels); every other song has none and must stay that way.
  function setup({ withStores = true, discover = null, listening = null } = {}) {
    const chartCalls = [];
    const scoreStore = createScoreStore({ file: path.join(dir, "scores.json"), now: () => NOW });
    const historyStore = createHistoryStore({ file: path.join(dir, "history.json"), now: () => NOW });
    const statsStore = createStatsStore({ file: path.join(dir, "stats.json"), now: () => NOW });
    const charts = Object.fromEntries(["easy", "normal", "hard", "hell"].map((difficulty, i) => [difficulty, { version: 5, audioKey: keyOf("known"), difficulty, stars: 2 + i, notes: [{ t: 1000, lane: 0 }] }]));
    const channel = createMewbeatChannel({
      readPlayback: () => null,
      chartStore: {
        getCharts: async (...args) => { chartCalls.push(["getCharts", ...args]); return { status: "ready", charts }; },
        peekCharts: (track) => (audioKeyOf(track) === keyOf("known") ? { status: "ready", charts } : null),
        summaryReader: () => (track) => (audioKeyOf(track) === keyOf("known")
          ? Object.fromEntries(Object.entries(charts).map(([difficulty, chart]) => [difficulty, { stars: chart.stars, notes: 1 }]))
          : null),
      },
      now: () => NOW,
      ...(withStores ? { scoreStore, historyStore, statsStore } : {}),
      discover,
      listening,
    });
    return { channel, historyStore, chartCalls };
  }
  const ask = (channel, message = {}, userId = "ann") => channel.handle("g1", userId, { type: "mewbeat_recs", id: "r1", ...message }, ANN);

  it("answers with sections, a strip and the charts that exist, and charts nothing", async () => {
    const { channel, historyStore, chartCalls } = setup();
    historyStore.add("ann", round("known"));
    const reply = await ask(channel);
    assert.strictEqual(reply.type, "mewbeat_recs");
    assert.strictEqual(reply.id, "r1");
    assert.strictEqual(reply.status, "ok");
    assert.deepStrictEqual(reply.sections.map((section) => section.kind), ["similar", "again", "here", "classic"]);
    assert.strictEqual(reply.pending, false);
    assert.strictEqual(reply.skill.basis, "good");
    assert.ok(reply.strip.length > 0 && reply.strip.length <= 4);
    assert.strictEqual(reply.sections[3].rows.length, CLASSICS.length);
    for (const row of reply.sections.flatMap((section) => section.rows)) {
      assert.ok(row.audioKey && row.uri && row.reason, row.audioKey);
      assert.strictEqual(row.playIssue, null);
      assert.ok("stars" in row && "bests" in row && "bpm" in row && "highlightMs" in row);
    }
    // Looking only: not one request to make or fetch a chart.
    assert.deepStrictEqual(chartCalls, []);
  });

  it("carries the stars and the player's best on a song to try again", async () => {
    const { channel, historyStore } = setup();
    historyStore.add("ann", round("known", { accuracy: 80, grade: "B" }));
    const reply = await ask(channel);
    const again = reply.sections.find((section) => section.kind === "again").rows.find((row) => row.audioKey === keyOf("known"));
    assert.ok(again, "the close run is worth another go");
    assert.strictEqual(again.reason, "80% on Normal, one more go");
    assert.deepStrictEqual(again.stars, { easy: 2, normal: 3, hard: 4, hell: 5 });
    assert.strictEqual(again.level, "normal");
    assert.strictEqual(again.levelStars, 3);
  });

  it("does not offer the song just played", async () => {
    const { channel, historyStore } = setup();
    historyStore.add("ann", round("known", { accuracy: 80 }));
    const reply = await ask(channel, { seedKey: keyOf("known") });
    const keys = reply.sections.flatMap((section) => section.rows).concat(reply.strip).map((row) => row.audioKey);
    assert.ok(!keys.includes(keyOf("known")));
  });

  it("asks for new songs in the background and says when they are still coming", async () => {
    const asked = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { channel, historyStore } = setup({ discover: async (seed) => { asked.push(seed); await gate; return []; } });
    historyStore.add("ann", round("known"));
    const reply = await ask(channel);
    assert.strictEqual(reply.status, "ok");
    assert.strictEqual(reply.pending, true);
    assert.deepStrictEqual(asked, [{ title: "Song known", artist: "Artist known" }]);
    release();
  });

  it("refuses a bad id or seed, and says so when the stores are missing", async () => {
    const { channel } = setup();
    assert.strictEqual((await ask(channel, { id: 7 })).type, "error");
    assert.strictEqual((await ask(channel, { id: "x".repeat(41) })).type, "error");
    const bad = await ask(channel, { seedKey: 5 });
    assert.deepStrictEqual([bad.status, bad.reason], ["error", "bad_request"]);
    const bare = setup({ withStores: false });
    const reply = await ask(bare.channel);
    assert.deepStrictEqual([reply.type, reply.status, reply.reason], ["mewbeat_recs", "error", "unavailable"]);
  });

  it("keeps one player's history out of another's suggestions", async () => {
    const { channel, historyStore } = setup();
    historyStore.add("ann", round("known", { accuracy: 80 }));
    const other = await ask(channel, {}, "bo");
    assert.strictEqual(other.status, "ok");
    assert.strictEqual(other.skill, null);
    assert.strictEqual(other.sections[1].rows.length, 0);
    assert.ok(other.sections[3].rows.length > 0, "a player with no history still gets the classics");
  });

  // The music bot's records, made up: ann asked for Band A, bo for Band Z; an autoplay pick is nobody's request.
  const listeningOf = () => ({
    topTracks: (userId) => ({ ann: [{ track: "Band A - Song One", count: 8 }], bo: [{ track: "Band Z - Zed Song", count: 8 }] })[userId] ?? [],
    topArtists: (userId) => ({ ann: [{ artist: "Band A", count: 8 }], bo: [{ artist: "Band Z", count: 8 }] })[userId] ?? [],
    roomTracks: () => [{ info: { title: "Auto Song", author: "Band Auto", requesterId: "ann", autoplayed: true }, userData: { autoplayPlayedAt: NOW - 1000 } }],
    liked: () => [],
  });

  it("suggests from what the player listens to through the bot, and keeps it from other players", async () => {
    const asked = [];
    const { channel, chartCalls } = setup({ discover: async (seed, options) => { asked.push([seed.artist, options?.anchor?.artist ?? null]); return []; }, listening: listeningOf() });
    const reply = await ask(channel);
    assert.strictEqual(reply.status, "ok");
    assert.strictEqual(reply.pending, true);
    assert.deepStrictEqual(asked, [["Band A", null]]);
    assert.strictEqual(reply.skill, null);

    await ask(channel, { id: "r2" }, "bo");
    assert.deepStrictEqual(asked, [["Band A", null], ["Band Z", null]]);
    assert.ok(!asked.some(([artist]) => artist === "Band Auto"), "what autoplay chose is not the player's taste");
    assert.deepStrictEqual(chartCalls, []);
  });

  it("answers a player the bot has never heard from with the classics, even with the listening wired in", async () => {
    const { channel } = setup({ discover: async () => [], listening: listeningOf() });
    const reply = await ask(channel, {}, "newcomer");
    assert.strictEqual(reply.status, "ok");
    assert.strictEqual(reply.pending, false);
    assert.strictEqual(reply.sections[0].rows.length, 0);
    assert.strictEqual(reply.sections[3].rows.length, CLASSICS.length);
  });
});
