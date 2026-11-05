const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createHistoryStore } = require("../../../helpers/mewbeat/historyStore");
const { createScoreStore } = require("../../../helpers/mewbeat/scoreStore");
const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");

const KEY = "youtube:abc:200000";
const VERSION = 5;
const ANN = { id: "ann", username: "Ann", avatarUrl: "https://a/ann.png" };
const BO = { id: "bo", username: "Bo", avatarUrl: null };

function fakeTrack(overrides) {
  return {
    info: {
      sourceName: "youtube", identifier: "abc", length: 200000, title: "Song", author: "Artist", uri: "https://y/abc", ...overrides,
    },
  };
}

// Three taps and a hold: four heads and one tail, five judgements; the first note is at 1000.
function makeCharts({ version = VERSION } = {}) {
  const notes = [
    { t: 1000, lane: 0 }, { t: 1500, lane: 1 }, { t: 2000, lane: 2 }, { t: 2500, lane: 3, len: 400 }, { t: 3500, lane: 0 },
  ];
  const chart = (difficulty, extra) => ({ version, audioKey: KEY, difficulty, notes, ...extra });
  return { easy: chart("easy", { stars: 1.5 }), normal: chart("normal"), hard: chart("hard"), hell: chart("hell") };
}

function perfectEvents(offset = 0) {
  return [
    { n: 0, part: "head", j: "perfect", t: 1000 + offset, d: 0 },
    { n: 1, part: "head", j: "perfect", t: 1500 + offset, d: 0 },
    { n: 2, part: "head", j: "great", t: 2000 + offset, d: 50 },
    { n: 3, part: "head", j: "perfect", t: 2500 + offset, d: 0 },
    { n: 3, part: "tail", j: "perfect", t: 2900 + offset, d: 0 },
    { n: 4, part: "head", j: "good", t: 3500 + offset, d: 90 },
  ];
}

function submitMessage(overrides) {
  return {
    type: "mewbeat_submit",
    id: "s1",
    mode: "solo",
    audioKey: KEY,
    difficulty: "hard",
    chartVersion: VERSION,
    events: perfectEvents(),
    fevers: [],
    flags: { autoplay: false, calibration: false, difficultyChanged: false },
    ...overrides,
  };
}

describe("mewbeat channel scores", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-channel-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup({ charts = makeCharts(), unlocked = true, playback = null, register = true, log } = {}) {
    let clock = 1_000;
    const now = () => (clock += 10);
    const scoreStore = createScoreStore({ file: path.join(dir, "scores.json"), now });
    const historyStore = createHistoryStore({ file: path.join(dir, "history.json"), now });
    const soloTracks = createSoloTracks();
    const track = fakeTrack();
    if (register) {
      soloTracks.put(KEY, {
        track,
        node: "n",
        info: { title: "Song", artist: "Artist", durationMs: 200000, artworkUrl: "https://i/1.png", uri: "https://y/abc", source: "youtube" },
      });
    }
    const peeked = [];
    const channel = createMewbeatChannel({
      readPlayback: () => playback,
      chartStore: {
        getCharts: async () => ({ status: "ready", charts }),
        peekCharts: (candidate) => {
          peeked.push(candidate);
          return charts && audioKeyOf(candidate) === KEY ? { status: "ready", charts } : null;
        },
      },
      isUnlocked: () => unlocked,
      now,
      soloTracks,
      scoreStore,
      historyStore,
      log,
    });
    return { channel, scoreStore, historyStore, peeked };
  }

  const submit = (channel, message, { guildId = "g1", userId = "ann", profile = ANN } = {}) =>
    channel.handle(guildId, userId, message, profile);

  it("scores a ranked solo run, ranks it and records the history", async () => {
    const { channel, historyStore } = setup();
    const reply = await submit(channel, submitMessage());
    assert.strictEqual(reply.type, "mewbeat_submit");
    assert.strictEqual(reply.id, "s1");
    assert.strictEqual(reply.status, "ok");
    const { result } = reply;
    // 300 + 300 + 200 + 300 + 300 (tail) + 100, no multiplier below 10 combo.
    assert.strictEqual(result.score, 1500);
    assert.deepStrictEqual(result.counts, { perfect: 4, great: 1, good: 1, miss: 0 });
    assert.strictEqual(result.maxCombo, 6);
    assert.strictEqual(result.ranked, true);
    assert.strictEqual(result.newBest, true);
    assert.strictEqual(result.best.score, 1500);
    assert.deepStrictEqual(result.rank, { server: 1, global: 1 });
    assert.deepStrictEqual(result.serverTop.map((entry) => [entry.userId, entry.username, entry.score]), [["ann", "Ann", 1500]]);

    const [round] = historyStore.recent("ann", 5);
    assert.deepStrictEqual(
      { ...round, at: undefined },
      {
        audioKey: KEY,
        uri: "https://y/abc",
        source: "youtube",
        title: "Song",
        artist: "Artist",
        artworkUrl: "https://i/1.png",
        durationMs: 200000,
        difficulty: "hard",
        score: 1500,
        accuracy: result.accuracy,
        grade: result.grade,
        ranked: true,
        mode: "solo",
        guildId: "g1",
        chartVersion: VERSION,
        at: undefined,
      },
    );
  });

  it("records the version of the chart that was played, flags included", async () => {
    const flagged = `${VERSION}-holds-lead`;
    const { channel, historyStore } = setup({ charts: makeCharts({ version: flagged }) });
    await submit(channel, submitMessage({ chartVersion: flagged }));
    assert.strictEqual(historyStore.recent("ann", 1)[0].chartVersion, flagged);
  });

  it("keeps reading history from before the chart version was recorded", async () => {
    const file = path.join(dir, "history.json");
    const old = { audioKey: KEY, title: "Old", difficulty: "hard", accuracy: 80, grade: "B", mode: "solo", guildId: "g1", at: 5 };
    fs.writeFileSync(file, JSON.stringify({ users: { ann: [old] } }));
    const { channel, historyStore } = setup({ charts: makeCharts() });
    assert.strictEqual("chartVersion" in historyStore.recent("ann", 1)[0], false);
    await submit(channel, submitMessage());
    assert.deepStrictEqual(historyStore.recent("ann", 5).map((round) => round.chartVersion), [VERSION, undefined]);
    const reply = await submit(channel, { type: "mewbeat_played", id: "p", scope: "server", limit: 5 });
    assert.strictEqual(reply.tracks.length, 1);
  });

  it("keeps the best and reports a worse run as no new best", async () => {
    const { channel, historyStore } = setup();
    await submit(channel, submitMessage());
    const worse = await submit(channel, submitMessage({
      id: "s2",
      events: perfectEvents().map((event) => (event.n === 1 ? { ...event, j: "miss" } : event)),
    }));
    assert.strictEqual(worse.result.ranked, true);
    assert.strictEqual(worse.result.newBest, false);
    assert.strictEqual(worse.result.best.score, 1500);
    assert.ok(worse.result.score < 1500);
    assert.strictEqual(historyStore.recent("ann", 5).length, 2);
  });

  it("sends the player's own best with the chart, once there is one", async () => {
    const { channel } = setup();
    const chartOf = (userId) => channel.handle("g1", userId, { type: "mewbeat_chart", audioKey: KEY, difficulty: "hard" }, ANN);
    const first = await chartOf("ann");
    assert.strictEqual(first.status, "ready");
    assert.strictEqual("best" in first, false);
    await submit(channel, submitMessage());
    const again = await chartOf("ann");
    assert.strictEqual(again.best.score, 1500);
    assert.strictEqual(typeof again.best.grade, "string");
    assert.deepStrictEqual(Object.keys(again.best).sort(), ["grade", "score"]);
    assert.strictEqual("best" in (await chartOf("bob")), false);
    assert.strictEqual("best" in again.chart, false);
  });

  it("ranks players across servers", async () => {
    const { channel } = setup();
    await submit(channel, submitMessage(), { guildId: "g1" });
    const other = await submit(channel, submitMessage({
      events: perfectEvents().map((event) => (event.n === 0 ? { ...event, j: "good" } : event)),
    }), { guildId: "g2", userId: "bo", profile: BO });
    assert.deepStrictEqual(other.result.rank, { server: 1, global: 2 });
    assert.deepStrictEqual(other.result.serverTop.map((entry) => entry.userId), ["bo"]);
  });

  it("scores a live run against the track the bot is playing", async () => {
    const { channel, historyStore } = setup({
      register: false,
      playback: { track: fakeTrack(), node: "n", positionMs: 0, paused: false, durationMs: 200000 },
    });
    const reply = await submit(channel, submitMessage({ mode: "live" }));
    assert.strictEqual(reply.status, "ok");
    assert.strictEqual(reply.result.ranked, true);
    const [round] = historyStore.recent("ann", 1);
    assert.strictEqual(round.mode, "live");
    assert.strictEqual(round.title, "Song");
    assert.strictEqual(round.artist, "Artist");
    assert.strictEqual(round.durationMs, 200000);
  });

  describe("unranked runs", () => {
    async function assertUnranked(overrides, { history = true } = {}) {
      const { channel, scoreStore, historyStore } = setup();
      const reply = await submit(channel, submitMessage(overrides));
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.result.ranked, false);
      assert.strictEqual(reply.result.newBest, false);
      assert.strictEqual(reply.result.best, null);
      assert.deepStrictEqual(reply.result.rank, { server: null, global: null });
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}`, guildId: null, limit: 5 }), []);
      assert.strictEqual(historyStore.recent("ann", 5).length, history ? 1 : 0);
      if (history) assert.strictEqual(historyStore.recent("ann", 1)[0].ranked, false);
      return reply;
    }

    it("autoplay", async () => {
      const reply = await assertUnranked({ flags: { autoplay: true } });
      assert.strictEqual(reply.result.score, 1500);
    });
    it("a difficulty change", () => assertUnranked({ flags: { difficultyChanged: true } }));
    it("a late join, judged by the chart's note times", async () => {
      // Ten taps from 1000 to 5500; the run only covers the second half.
      const notes = Array.from({ length: 10 }, (_, i) => ({ t: 1000 + i * 500, lane: i % 4 }));
      const chart = (difficulty) => ({ version: VERSION, audioKey: KEY, difficulty, notes });
      const charts = { easy: chart("easy"), normal: chart("normal"), hard: chart("hard"), hell: chart("hell") };
      const { channel, scoreStore } = setup({ charts });
      const events = notes.slice(5).map((note, i) => ({
        n: 5 + i, part: "head", j: "perfect", t: i === 0 ? 1000 : note.t, d: 0,
      }));
      // The first event claims to be at 1000; the chart says it is note 5, at 3500.
      const reply = await submit(channel, submitMessage({ events }));
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.result.ranked, false);
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}`, guildId: null, limit: 5 }), []);
    });
    it("fewer than half of the notes judged", () => assertUnranked({ events: perfectEvents().slice(0, 2) }));
    it("a calibration run, which also stays out of the history", () =>
      assertUnranked({ flags: { calibration: true } }, { history: false }));

    it("still ranks a run that joined within the first two seconds", async () => {
      const { channel } = setup();
      // Starting at note 2 (t 2000) is within 2000 ms of the first note (1000).
      const reply = await submit(channel, submitMessage({ events: perfectEvents().slice(2) }));
      assert.strictEqual(reply.result.ranked, true);
    });
  });

  describe("rejections", () => {
    it("a song that is not in the registry any more is a stale chart", async () => {
      const { channel, historyStore } = setup();
      const reply = await submit(channel, submitMessage({ audioKey: "youtube:zzz:1000" }));
      assert.deepStrictEqual(reply, { type: "mewbeat_submit", id: "s1", status: "error", reason: "stale_chart" });
      assert.strictEqual(historyStore.recent("ann", 5).length, 0);
    });

    it("a chart version that is not the stored one is a stale chart", async () => {
      const { channel, historyStore, scoreStore } = setup();
      const reply = await submit(channel, submitMessage({ chartVersion: VERSION - 1 }));
      assert.deepStrictEqual(reply, { type: "mewbeat_submit", id: "s1", status: "error", reason: "stale_chart" });
      assert.strictEqual(historyStore.recent("ann", 5).length, 0);
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}`, guildId: null, limit: 5 }), []);
    });

    it("charts made with generator flags have their own score key, and a run on the unflagged ones goes stale", async () => {
      const flagged = `${VERSION}-holds`;
      const { channel, scoreStore } = setup({ charts: makeCharts({ version: flagged }) });
      const stale = await submit(channel, submitMessage({ chartVersion: VERSION }));
      assert.strictEqual(stale.reason, "stale_chart");

      const reply = await submit(channel, submitMessage({ chartVersion: flagged }));
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.result.ranked, true);
      assert.strictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${flagged}`, guildId: null, limit: 5 }).length, 1);
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}`, guildId: null, limit: 5 }), []);
      assert.strictEqual(scoreStore.latestChartKey(KEY, "hard"), null);
      const board = await submit(channel, { type: "mewbeat_board", id: "b", audioKey: KEY, difficulty: "hard", scope: "server" });
      assert.deepStrictEqual(board.entries.map((entry) => entry.userId), ["ann"]);
    });

    it("a song whose chart is not stored yet", async () => {
      const { channel, peeked } = setup({ charts: null });
      const reply = await submit(channel, submitMessage());
      assert.strictEqual(reply.reason, "unknown_chart");
      assert.ok(peeked.length > 0);
    });

    it("too many events, bad events, duplicates and a missing list", async () => {
      const { channel } = setup();
      assert.strictEqual((await submit(channel, submitMessage({ events: [...perfectEvents(), ...perfectEvents()] }))).reason, "too_many_events");
      assert.strictEqual((await submit(channel, submitMessage({ events: new Array(20001).fill({}) }))).reason, "too_many_events");
      assert.strictEqual((await submit(channel, submitMessage({ events: [perfectEvents()[0], perfectEvents()[0]] }))).reason, "bad_event");
      assert.strictEqual((await submit(channel, submitMessage({ events: [{ n: 0, part: "tail", j: "perfect", t: 1000 }] }))).reason, "bad_event");
      assert.strictEqual((await submit(channel, submitMessage({ fevers: new Array(201).fill(1000) }))).reason, "bad_event");
      assert.strictEqual((await submit(channel, submitMessage({ events: [] }))).reason, "no_events");
      assert.strictEqual((await submit(channel, submitMessage({ events: undefined }))).reason, "no_events");
      assert.strictEqual((await submit(channel, submitMessage({ difficulty: "insane" }))).reason, "bad_difficulty");
    });

    it("a locked account", async () => {
      const { channel } = setup({ unlocked: false });
      // The reply carries the request id, so the client doesn't wait out its timeout.
      for (const message of [
        submitMessage(),
        { type: "mewbeat_board", id: "b", audioKey: KEY, difficulty: "hard", scope: "server" },
        { type: "mewbeat_played", id: "p", scope: "server" },
      ]) {
        const reply = await submit(channel, message);
        assert.deepStrictEqual({ type: reply.type, id: reply.id, status: reply.status, reason: reply.reason }, {
          type: message.type, id: message.id, status: "error", reason: "locked",
        });
      }
    });
  });

  describe("boards", () => {
    async function seeded() {
      const context = setup();
      await submit(context.channel, submitMessage(), { guildId: "g1" });
      await submit(context.channel, submitMessage({
        events: perfectEvents().map((event) => (event.n === 0 ? { ...event, j: "good" } : event)),
      }), { guildId: "g2", userId: "bo", profile: BO });
      return context;
    }
    const boardMessage = (overrides) => ({ type: "mewbeat_board", id: "b1", audioKey: KEY, difficulty: "hard", scope: "server", ...overrides });

    it("lists the server board with the player's own rank and best", async () => {
      const { channel } = await seeded();
      const reply = await submit(channel, boardMessage());
      assert.strictEqual(reply.type, "mewbeat_board");
      assert.strictEqual(reply.id, "b1");
      assert.deepStrictEqual(reply.entries.map((entry) => entry.userId), ["ann"]);
      assert.deepStrictEqual(Object.keys(reply.entries[0]).sort(), [
        "accuracy", "at", "avatarUrl", "grade", "maxCombo", "score", "userId", "username",
      ]);
      assert.strictEqual(reply.own.rank, 1);
      assert.strictEqual(reply.own.best.score, 1500);
    });

    it("lists the global board and ranks the player in it", async () => {
      const { channel } = await seeded();
      const reply = await submit(channel, boardMessage({ scope: "global" }), { guildId: "g2", userId: "bo", profile: BO });
      assert.deepStrictEqual(reply.entries.map((entry) => entry.userId), ["ann", "bo"]);
      assert.strictEqual(reply.own.rank, 2);
      assert.strictEqual((await submit(channel, boardMessage({ scope: "global", limit: 1 }))).entries.length, 1);
    });

    it("reports no rank for a player without a score, and nothing for an unscored chart", async () => {
      const { channel } = await seeded();
      const stranger = await submit(channel, boardMessage(), { userId: "cy", profile: { id: "cy", username: "Cy" } });
      assert.deepStrictEqual(stranger.own, { rank: null, best: null });
      const empty = await submit(channel, boardMessage({ difficulty: "easy" }));
      assert.deepStrictEqual(empty.entries, []);
      assert.deepStrictEqual(empty.own, { rank: null, best: null });
    });

    it("reads the newest scored version when the chart is no longer known", async () => {
      const context = setup({ charts: null });
      context.scoreStore.submit({
        chartKey: `${KEY}|hard|7`, userId: "ann", guildId: "g1", profile: ANN, score: 50, accuracy: 50, grade: "D", maxCombo: 1, difficulty: "hard",
      });
      const reply = await submit(context.channel, boardMessage());
      assert.deepStrictEqual(reply.entries.map((entry) => entry.score), [50]);
    });

    it("rejects a bad scope or difficulty", async () => {
      const { channel } = setup();
      assert.strictEqual((await submit(channel, boardMessage({ scope: "world" }))).reason, "bad_scope");
      assert.strictEqual((await submit(channel, boardMessage({ difficulty: "x" }))).reason, "bad_request");
    });
  });

  describe("played songs", () => {
    it("lists the songs with stars and the player's bests", async () => {
      const { channel } = setup();
      await submit(channel, submitMessage(), { guildId: "g1" });
      await submit(channel, submitMessage({ id: "s2", difficulty: "easy" }), { guildId: "g1" });
      await submit(channel, submitMessage(), { guildId: "g2", userId: "bo", profile: BO });

      const server = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "server" });
      assert.strictEqual(server.type, "mewbeat_played");
      assert.strictEqual(server.id, "p1");
      assert.strictEqual(server.tracks.length, 1);
      const [track] = server.tracks;
      assert.strictEqual(track.audioKey, KEY);
      assert.strictEqual(track.title, "Song");
      assert.strictEqual(track.plays, 2);
      assert.strictEqual(track.stars.easy, 1.5);
      assert.strictEqual(typeof track.stars.hell, "number");
      assert.deepStrictEqual(track.notes, { easy: 5, normal: 5, hard: 5, hell: 5 });
      assert.deepStrictEqual(Object.keys(track.bests).sort(), ["easy", "hard"]);
      assert.strictEqual(track.bests.hard.score, 1500);
      assert.strictEqual(track.bests.hard.grade, "B");

      const global = await submit(channel, { type: "mewbeat_played", id: "p2", scope: "global" });
      assert.strictEqual(global.tracks[0].plays, 3);
      const other = await submit(channel, { type: "mewbeat_played", id: "p3", scope: "global" }, { userId: "bo", profile: BO });
      assert.deepStrictEqual(Object.keys(other.tracks[0].bests), ["hard"]);
    });

    it("gives null stars for a song whose charts are not stored", async () => {
      const { channel, historyStore } = setup({ charts: null });
      historyStore.add("ann", {
        audioKey: KEY, uri: null, source: "youtube", title: "Old", artist: "", artworkUrl: null, durationMs: 1, difficulty: "hard",
        score: 1, accuracy: 1, grade: "D", ranked: false, mode: "solo", guildId: "g1",
      });
      const reply = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "server", limit: 500 });
      assert.strictEqual(reply.tracks[0].stars, null);
      assert.deepStrictEqual(reply.tracks[0].notes, {});
      assert.deepStrictEqual(reply.tracks[0].bests, {});
    });

    it("rejects a bad scope", async () => {
      const { channel } = setup();
      const reply = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "mine" });
      assert.strictEqual(reply.status, "error");
    });
  });

  describe("song stats", () => {
    const statsMessage = (overrides) => ({ type: "mewbeat_song_stats", id: "t1", audioKey: KEY, ...overrides });

    it("gives stars, note count and the player's best per difficulty", async () => {
      const { channel } = setup();
      await submit(channel, submitMessage());
      const reply = await submit(channel, statsMessage());
      assert.strictEqual(reply.type, "mewbeat_song_stats");
      assert.strictEqual(reply.id, "t1");
      assert.strictEqual(reply.status, "ok");
      assert.deepStrictEqual(Object.keys(reply.stats), ["easy", "normal", "hard", "hell"]);
      assert.strictEqual(reply.stats.easy.stars, 1.5);
      assert.strictEqual(typeof reply.stats.hell.stars, "number");
      assert.strictEqual(reply.stats.hard.notes, 5);
      assert.deepStrictEqual(reply.stats.hard.best, { score: 1500, grade: "B" });
      assert.strictEqual(reply.stats.easy.best, null);
      // Another player has no best of their own.
      const other = await submit(channel, statsMessage(), { userId: "bo", profile: BO });
      assert.strictEqual(other.stats.hard.best, null);
    });

    it("answers null stats while no charts are known", async () => {
      const { channel } = setup({ charts: null });
      assert.deepStrictEqual(await submit(channel, statsMessage()), { type: "mewbeat_song_stats", id: "t1", status: "ok", stats: null });
      assert.strictEqual((await submit(setup().channel, statsMessage({ audioKey: "youtube:other:1" }))).stats, null);
    });

    it("refuses a locked user, a bad key and a bad id", async () => {
      assert.deepStrictEqual(
        await submit(setup({ unlocked: false }).channel, statsMessage()),
        { type: "mewbeat_song_stats", id: "t1", status: "error", reason: "locked" },
      );
      const { channel } = setup();
      assert.strictEqual((await submit(channel, statsMessage({ audioKey: 5 }))).reason, "bad_request");
      assert.strictEqual((await submit(channel, statsMessage({ audioKey: undefined }))).reason, "bad_request");
      assert.strictEqual((await submit(channel, statsMessage({ id: "" }))).type, "error");
    });
  });

  describe("failed submits", () => {
    it("log one warning with the reason and what was claimed, without the events", async () => {
      const warnings = [];
      const { channel } = setup({ log: { warning: (...args) => warnings.push(args) } });
      const reply = await submit(channel, submitMessage({ chartVersion: VERSION + 1 }));
      assert.strictEqual(reply.reason, "stale_chart");
      assert.strictEqual(warnings.length, 1);
      const text = warnings[0].join(" ");
      assert.match(text, /stale_chart/);
      assert.match(text, /mode=solo/);
      assert.match(text, /user=ann/);
      assert.match(text, new RegExp(`audioKey=${KEY}`));
      assert.match(text, new RegExp(`chartVersion=${VERSION + 1}`));
      assert.match(text, new RegExp(`stored=${VERSION}`));

      await submit(channel, submitMessage({ difficulty: "nope" }));
      assert.strictEqual(warnings.length, 2);
      assert.match(warnings[1].join(" "), /bad_difficulty.*stored=-/);
      await submit(channel, submitMessage());
      assert.strictEqual(warnings.length, 2);
    });
  });
});
