const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { starsOf } = require("../../../helpers/mewbeat/charts/stars");
const { createHistoryStore } = require("../../../helpers/mewbeat/historyStore");
const { createRanking, LOCAL_USER } = require("../../../helpers/mewbeat/ranking");
const { playPp, runPp } = require("../../../helpers/mewbeat/rating");
const { createScoreStore } = require("../../../helpers/mewbeat/scoreStore");
const { createStatsStore } = require("../../../helpers/mewbeat/statsStore");
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
  return { easy: chart("easy", { stars: 1.5 }), normal: chart("normal", { bpm: 128 }), hard: chart("hard"), hell: chart("hell") };
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

  function setup({ charts = makeCharts(), playback = null, register = true, log, durationMs = 200000, walks, queue, remote } = {}) {
    let clock = 1_000;
    const now = () => (clock += 10);
    const scoreStore = createScoreStore({ file: path.join(dir, "scores.json"), now, remote });
    if (walks) {
      const walk = scoreStore.forEachEntry;
      scoreStore.forEachEntry = (fn) => { walks.count += 1; return walk(fn); };
    }
    const historyStore = createHistoryStore({ file: path.join(dir, "history.json"), now });
    const statsStore = createStatsStore({ file: path.join(dir, "stats.json"), now });
    const soloTracks = createSoloTracks();
    const track = fakeTrack();
    if (register) {
      soloTracks.put(KEY, {
        track,
        node: "n",
        info: { title: "Song", artist: "Artist", durationMs, artworkUrl: "https://i/1.png", uri: "https://y/abc", source: "youtube" },
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
        queueOf: queue === undefined ? undefined : () => queue,
      },
      now,
      soloTracks,
      scoreStore,
      historyStore,
      statsStore,
      log,
    });
    return { channel, scoreStore, historyStore, statsStore, peeked };
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
        failed: false,
        modifiers: [],
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

  describe("pp and the previous best", () => {
    const KEY_R3 = `${KEY}|hard|${VERSION}|r3`;
    const worseEvents = () => perfectEvents().map((event) => (event.n === 1 ? { ...event, j: "miss" } : event));
    const hardStars = () => starsOf(makeCharts().hard);

    it("rates a ranked run by the function the ranking uses, and has no previous best on a first play", async () => {
      const { channel, scoreStore } = setup();
      const { result } = await submit(channel, submitMessage());
      assert.strictEqual(result.previousBest, null);
      assert.ok(result.pp > 0);
      assert.strictEqual(result.pp, runPp({ stars: hardStars(), accuracy: result.accuracy, completion: 1 }));
      assert.strictEqual(result.pp, playPp({ stars: hardStars(), accuracy: result.accuracy }));

      // The ranking reads the stored best back and rates it: the play it lists is worth what the reply said.
      const ranking = createRanking({
        walk: (visit) => scoreStore.forEachEntry(visit),
        currentOf: () => ({ chartKey: KEY_R3, stars: hardStars() }),
        trackOf: () => null,
      });
      const { plays } = ranking.playerOf("ann");
      assert.strictEqual(plays.length, 1);
      assert.strictEqual(plays[0].pp, result.pp);
    });

    it("uses the stars the chart stores when it has them", async () => {
      const { channel } = setup();
      const { result } = await submit(channel, submitMessage({ difficulty: "easy" }));
      assert.strictEqual(result.pp, playPp({ stars: 1.5, accuracy: result.accuracy }));
    });

    it("rates a run that stopped early on its accuracy times the share it played", async () => {
      const { channel } = setup();
      const { result } = await submit(channel, submitMessage({ events: perfectEvents().slice(0, 4) }));
      assert.strictEqual(result.ranked, true);
      // Four of the six parts: 0.6667 of the map.
      assert.strictEqual(result.pp, playPp({ stars: hardStars(), accuracy: result.accuracy * 0.6667 }));
      assert.ok(result.pp < playPp({ stars: hardStars(), accuracy: result.accuracy }));
    });

    it("gives the best from before the run, whether the run beats it or not", async () => {
      const { channel } = setup();
      const first = await submit(channel, submitMessage({ events: worseEvents() }));
      assert.strictEqual(first.result.previousBest, null);
      const second = await submit(channel, submitMessage());
      assert.strictEqual(second.result.newBest, true);
      assert.deepStrictEqual(second.result.previousBest, { score: first.result.score, accuracy: first.result.accuracy });
      // The best has moved on to the second run, and the third is measured against it.
      const third = await submit(channel, submitMessage({ events: worseEvents() }));
      assert.strictEqual(third.result.newBest, false);
      assert.deepStrictEqual(third.result.previousBest, { score: second.result.score, accuracy: second.result.accuracy });
      assert.deepStrictEqual(Object.keys(third.result.previousBest).sort(), ["accuracy", "score"]);
      assert.strictEqual(third.result.best.score, second.result.score);
    });

    it("keeps each player's previous best apart", async () => {
      const { channel } = setup();
      await submit(channel, submitMessage());
      const other = await submit(channel, submitMessage(), { userId: "bo", profile: BO });
      assert.strictEqual(other.result.previousBest, null);
    });

    it("carries neither for a run that is not ranked", async () => {
      const notes = Array.from({ length: 13 }, (_, i) => ({ t: 1000 + i * 500, lane: i % 4 }));
      const chart = (difficulty) => ({ version: VERSION, audioKey: KEY, difficulty, notes });
      const lostCharts = { easy: chart("easy"), normal: chart("normal"), hard: chart("hard"), hell: chart("hell") };
      const lost = ["perfect", "perfect", "perfect", "perfect", "perfect", "miss", "miss", "miss", "miss", "miss", "miss", "miss"]
        .map((j, n) => ({ n, part: "head", j, t: notes[n].t, d: 0 }));
      const cases = [
        [{ flags: { autoplay: true } }, undefined],
        [{ flags: { difficultyChanged: true } }, undefined],
        [{ flags: { calibration: true } }, undefined],
        [{ events: perfectEvents().slice(0, 2) }, undefined],
        [{ events: lost }, lostCharts],
      ];
      for (const [overrides, charts] of cases) {
        // With a best already stored: a run that does not count must not be set against it.
        const { channel } = setup(charts && { charts });
        if (!charts) await submit(channel, submitMessage({ id: "s0" }));
        const { result } = await submit(channel, submitMessage(overrides));
        assert.strictEqual(result.ranked, false, JSON.stringify(overrides));
        assert.strictEqual("pp" in result, false, JSON.stringify(overrides));
        assert.strictEqual("previousBest" in result, false, JSON.stringify(overrides));
      }
    });

    it("rates a No Fail run that survives, like any ranked one", async () => {
      const notes = Array.from({ length: 13 }, (_, i) => ({ t: 1000 + i * 500, lane: i % 4 }));
      const chart = (difficulty) => ({ version: VERSION, audioKey: KEY, difficulty, notes });
      const charts = { easy: chart("easy"), normal: chart("normal"), hard: chart("hard"), hell: chart("hell") };
      const events = ["perfect", "perfect", "perfect", "perfect", "perfect", "miss", "miss", "miss", "miss", "miss", "miss", "miss", "perfect"]
        .map((j, n) => ({ n, part: "head", j, t: notes[n].t, d: 0 }));
      const { channel } = setup({ charts });
      const { result } = await submit(channel, submitMessage({ events, modifiers: ["nf"] }));
      assert.strictEqual(result.ranked, true);
      assert.strictEqual(result.pp, playPp({ stars: starsOf(charts.hard), accuracy: result.accuracy }));
      assert.strictEqual(result.previousBest, null);
    });

    it("leaves the pp out for the local test user, whom the ranking does not count, but still gives the previous best", async () => {
      const { channel } = setup();
      await submit(channel, submitMessage(), { userId: LOCAL_USER, profile: { username: "Local" } });
      const { result } = await submit(channel, submitMessage({ events: worseEvents() }), { userId: LOCAL_USER, profile: { username: "Local" } });
      assert.strictEqual("pp" in result, false);
      assert.strictEqual(result.previousBest.score, 1500);
    });

    describe("on a remote score store", () => {
      // The store of a process whose AtlasHub read has not finished, or has.
      function remoteOf(state) {
        return { ready: () => state.ready, upsert: () => {}, defer: (store, method, args) => state.deferred.push(args), insert: () => {} };
      }

      it("says nothing of either while the store is not loaded, and the run is kept for the replay", async () => {
        const state = { ready: false, deferred: [] };
        const { channel } = setup({ remote: remoteOf(state) });
        const { result } = await submit(channel, submitMessage());
        assert.strictEqual(result.ranked, true);
        assert.strictEqual(result.newBest, false);
        assert.strictEqual("pp" in result, false);
        assert.strictEqual("previousBest" in result, false);
        assert.strictEqual(state.deferred.length, 1);
      });

      it("carries both once the store is loaded, the previous best being the loaded row", async () => {
        const state = { ready: true, deferred: [] };
        const { channel, scoreStore } = setup({ remote: remoteOf(state) });
        const first = await submit(channel, submitMessage({ events: worseEvents() }));
        assert.strictEqual(first.result.previousBest, null);
        assert.strictEqual(first.result.pp, playPp({ stars: hardStars(), accuracy: first.result.accuracy }));
        const second = await submit(channel, submitMessage());
        assert.deepStrictEqual(second.result.previousBest, { score: first.result.score, accuracy: first.result.accuracy });
        assert.strictEqual(scoreStore.bestOf(KEY_R3, "ann").score, second.result.score);
      });
    });
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
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}|r3`, guildId: null, limit: 5 }), []);
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
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}|r3`, guildId: null, limit: 5 }), []);
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

  describe("failing and modifiers", () => {
    // Thirteen taps; five perfects then seven misses take the health to 0 on the twelfth judgement.
    const notes = Array.from({ length: 13 }, (_, i) => ({ t: 1000 + i * 500, lane: i % 4 }));
    const chart = (difficulty) => ({ version: VERSION, audioKey: KEY, difficulty, notes });
    const charts = { easy: chart("easy"), normal: chart("normal"), hard: chart("hard"), hell: chart("hell") };
    const eventsOf = (judgements) => judgements.map((j, n) => ({ n, part: "head", j, t: notes[n].t, d: 0 }));
    const losing = eventsOf([...Array(5).fill("perfect"), "miss", "miss", "miss", "miss", "miss", "miss", "miss", "perfect"]);
    const KEY_R3 = `${KEY}|hard|${VERSION}|r3`;

    it("scores a lost run, but does not rank it or send it to the board; the history keeps it", async () => {
      const { channel, scoreStore, historyStore } = setup({ charts });
      const reply = await submit(channel, submitMessage({ events: losing }));
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.result.failed, true);
      assert.strictEqual(reply.result.ranked, false);
      assert.strictEqual(reply.result.newBest, false);
      assert.strictEqual(reply.result.best, null);
      assert.deepStrictEqual(reply.result.modifiers, []);
      assert.deepStrictEqual(scoreStore.board({ chartKey: KEY_R3, guildId: null, limit: 5 }), []);
      const [round] = historyStore.recent("ann", 5);
      assert.strictEqual(round.failed, true);
      assert.strictEqual(round.ranked, false);
    });

    it("ignores the events after the fail", async () => {
      const { channel } = setup({ charts });
      const reply = await submit(channel, submitMessage({ events: losing }));
      // The thirteenth judgement (a perfect) came after the fail.
      assert.deepStrictEqual(reply.result.counts, { perfect: 5, great: 0, good: 0, miss: 7 });
      assert.strictEqual(reply.result.score, 5 * 300); // the combo multiplier has not reached 2 yet
    });

    it("a clean run is not failed", async () => {
      const { channel } = setup({ charts });
      const reply = await submit(channel, submitMessage({ events: eventsOf(Array(13).fill("perfect")) }));
      assert.strictEqual(reply.result.failed, false);
      assert.strictEqual(reply.result.ranked, true);
    });

    it("keeps a No Fail run alive and ranks it, with the modifier on the board row", async () => {
      const { channel, scoreStore } = setup({ charts });
      const reply = await submit(channel, submitMessage({ events: losing, modifiers: ["nf"] }));
      assert.strictEqual(reply.result.failed, false);
      assert.strictEqual(reply.result.ranked, true);
      assert.deepStrictEqual(reply.result.modifiers, ["nf"]);
      assert.deepStrictEqual(reply.result.best.modifiers, ["nf"]);
      assert.strictEqual(reply.result.counts.perfect, 6);
      assert.deepStrictEqual(scoreStore.board({ chartKey: KEY_R3, guildId: null, limit: 5 })[0].modifiers, ["nf"]);
    });

    it("stores the modifiers with the history and returns them in the board", async () => {
      const { channel, historyStore } = setup();
      const reply = await submit(channel, submitMessage({ modifiers: ["st", "gn"] }));
      assert.deepStrictEqual(reply.result.modifiers, ["gn", "st"]);
      // 1500 * 1.28, each judgement rounded.
      assert.strictEqual(reply.result.score, 384 + 384 + 256 + 384 + 384 + 128);
      assert.deepStrictEqual(historyStore.recent("ann", 1)[0].modifiers, ["gn", "st"]);
      const board = await submit(channel, { type: "mewbeat_board", id: "b", audioKey: KEY, difficulty: "hard", scope: "server" });
      assert.deepStrictEqual(board.entries[0].modifiers, ["gn", "st"]);
    });

    it("scores under the board key with the rules version", async () => {
      const { channel, scoreStore } = setup();
      await submit(channel, submitMessage());
      assert.strictEqual(scoreStore.board({ chartKey: KEY_R3, guildId: null, limit: 5 }).length, 1);
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}`, guildId: null, limit: 5 }), []);
    });

    it("keeps a calibration run and an autoplay run from failing", async () => {
      for (const flags of [{ calibration: true }, { autoplay: true }]) {
        const { channel } = setup({ charts });
        const reply = await submit(channel, submitMessage({ events: losing, flags }));
        assert.strictEqual(reply.result.failed, false, JSON.stringify(flags));
        assert.strictEqual(reply.result.counts.perfect, 6, JSON.stringify(flags));
      }
    });

    it("refuses bad modifiers with the reason, and nothing is stored", async () => {
      const { channel, scoreStore, historyStore } = setup();
      const cases = [
        [{ modifiers: ["zz"] }, "unknown_modifier"],
        [{ modifiers: "nf" }, "unknown_modifier"],
        [{ modifiers: ["nf", "ol"] }, "conflict"],
        [{ modifiers: ["fs"], mode: "live" }, "solo_only"],
        [{ modifiers: ["fs"], mode: "room" }, "solo_only"],
        [{ modifiers: ["fs", "ss"] }, "conflict"],
      ];
      for (const [overrides, reason] of cases) {
        const reply = await submit(channel, submitMessage(overrides));
        assert.deepStrictEqual(reply, { type: "mewbeat_submit", id: "s1", status: "error", reason }, JSON.stringify(overrides));
      }
      assert.deepStrictEqual(scoreStore.board({ chartKey: KEY_R3, guildId: null, limit: 5 }), []);
      assert.strictEqual(historyStore.recent("ann", 5).length, 0);
    });

    it("accepts a speed modifier in solo", async () => {
      const { channel } = setup();
      const reply = await submit(channel, submitMessage({ modifiers: ["fs"] }));
      assert.strictEqual(reply.status, "ok");
      assert.deepStrictEqual(reply.result.modifiers, ["fs"]);
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
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}|r3`, guildId: null, limit: 5 }), []);
    });

    it("charts made with generator flags have their own score key, and a run on the unflagged ones goes stale", async () => {
      const flagged = `${VERSION}-holds`;
      const { channel, scoreStore } = setup({ charts: makeCharts({ version: flagged }) });
      const stale = await submit(channel, submitMessage({ chartVersion: VERSION }));
      assert.strictEqual(stale.reason, "stale_chart");

      const reply = await submit(channel, submitMessage({ chartVersion: flagged }));
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.result.ranked, true);
      assert.strictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${flagged}|r3`, guildId: null, limit: 5 }).length, 1);
      assert.deepStrictEqual(scoreStore.board({ chartKey: `${KEY}|hard|${VERSION}|r3`, guildId: null, limit: 5 }), []);
      assert.strictEqual(scoreStore.latestChartKey(KEY, "hard", 2), null);
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
        "accuracy", "at", "avatarUrl", "grade", "maxCombo", "modifiers", "score", "userId", "username",
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
        chartKey: `${KEY}|hard|7|r3`, userId: "ann", guildId: "g1", profile: ANN, score: 50, accuracy: 50, grade: "D", maxCombo: 1, difficulty: "hard",
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
      const reply = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "world" });
      assert.strictEqual(reply.status, "error");
      assert.strictEqual(reply.reason, "bad_scope");
    });

    it("scope mine lists only your own songs, with the tempo of the stored chart and the rounds per level", async () => {
      const { channel, historyStore } = setup();
      await submit(channel, submitMessage(), { guildId: "g1" });
      await submit(channel, submitMessage({ id: "s2", difficulty: "easy" }), { guildId: "g1" });
      historyStore.add("bo", {
        audioKey: "youtube:other:1000", uri: null, source: "youtube", title: "Bo's", artist: "", artworkUrl: null, durationMs: 1, difficulty: "hard",
        score: 1, accuracy: 1, grade: "D", ranked: false, mode: "solo", guildId: "g2",
      });

      const mine = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "mine" });
      assert.deepStrictEqual(mine.tracks.map((track) => track.audioKey), [KEY]);
      assert.strictEqual(mine.tracks[0].bpm, 128);
      assert.deepStrictEqual(mine.tracks[0].playsBy, { easy: 1, normal: 0, hard: 1, hell: 0 });

      const global = await submit(channel, { type: "mewbeat_played", id: "p2", scope: "global" });
      assert.deepStrictEqual(global.tracks.map((track) => track.audioKey).sort(), ["youtube:other:1000", KEY].sort());
      // A song whose charts are not stored has no tempo to give.
      assert.strictEqual(global.tracks.find((track) => track.audioKey === "youtube:other:1000").bpm, null);
    });

    it("takes the tempo from any difficulty when normal has none", async () => {
      const charts = makeCharts();
      delete charts.normal.bpm;
      charts.hard.bpm = 140;
      const { channel } = setup({ charts });
      await submit(channel, submitMessage());
      const reply = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "mine" });
      assert.strictEqual(reply.tracks[0].bpm, 140);
    });

    it("answers up to 500 songs", async () => {
      const { channel, historyStore } = setup({ charts: null });
      for (let i = 0; i < 520; i += 1) {
        historyStore.add("ann", {
          audioKey: `youtube:s${i}:1000`, uri: null, source: "youtube", title: `S${i}`, artist: "", artworkUrl: null, durationMs: 1, difficulty: "hard",
          score: 1, accuracy: 1, grade: "D", ranked: false, mode: "solo", guildId: "g1",
        });
      }
      const reply = await submit(channel, { type: "mewbeat_played", id: "p1", scope: "mine", limit: 9999 });
      assert.strictEqual(reply.tracks.length, 500);
    });
  });

  describe("stats, profile and ranking", () => {
    const profileMessage = (overrides) => ({ type: "mewbeat_profile", id: "pr1", ...overrides });
    const statsMessage = (overrides) => ({ type: "mewbeat_stats", id: "st1", ...overrides });
    const rankingMessage = (overrides) => ({ type: "mewbeat_ranking", id: "rk1", scope: "global", ...overrides });
    const CY = { id: "cy", username: "Cy", avatarUrl: null };
    const asCy = { userId: "cy", profile: CY };

    it("shows yourself with no rounds as zeros and no rank", async () => {
      const { channel } = setup();
      const reply = await submit(channel, profileMessage(), asCy);
      assert.deepStrictEqual(reply, {
        type: "mewbeat_profile",
        id: "pr1",
        status: "ok",
        player: { userId: "cy", username: "Cy", avatarUrl: null, firstAt: null },
        rating: { pp: 0, global: null, server: null },
        summary: { plays: 0, avgAccuracy: 0, songs: 0, playMs: 0, bestGrades: { S: 0, A: 0, B: 0, C: 0, D: 0 } },
        recent: [],
        best: [],
      });
    });

    it("refuses an unknown player and a bad user id", async () => {
      const { channel } = setup();
      assert.deepStrictEqual(await submit(channel, profileMessage({ userId: "nobody" }), asCy), { type: "mewbeat_profile", id: "pr1", status: "error", reason: "not_found" });
      for (const userId of [5, "", "x".repeat(41), { a: 1 }]) {
        assert.strictEqual((await submit(channel, profileMessage({ userId }), asCy)).reason, "bad_request", String(userId));
      }
      assert.strictEqual((await submit(channel, profileMessage({ id: "" }), asCy)).type, "error");
    });

    it("lists your own latest runs, newest first and at most twenty, for a map report to name one", async () => {
      const { channel, historyStore } = setup();
      assert.deepStrictEqual(await submit(channel, { type: "mewbeat_report_runs", id: "rr0" }), { type: "mewbeat_report_runs", id: "rr0", status: "ok", runs: [] });
      for (let i = 0; i < 25; i += 1) {
        historyStore.add("ann", {
          audioKey: "youtube:r" + i + ":1000", uri: null, source: "youtube", title: "R" + i, artist: "", artworkUrl: null, durationMs: 1, difficulty: "normal",
          score: 1, accuracy: 90 + i / 100, grade: "A", ranked: true, mode: "solo", guildId: "g1", at: 1000 + i,
        });
      }
      historyStore.add("bo", { audioKey: "youtube:bo:1000", title: "Bo's", difficulty: "hard", mode: "solo", at: 5000 });
      const reply = await submit(channel, { type: "mewbeat_report_runs", id: "rr1" });
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.runs.length, 20);
      assert.deepStrictEqual(reply.runs[0], { audioKey: "youtube:r24:1000", difficulty: "normal", at: 1024, title: "R24", artist: "", grade: "A", accuracy: 90.24 });
      assert.strictEqual(reply.runs[19].title, "R5");
      assert.ok(reply.runs.every((run) => run.title !== "Bo's"));
      assert.strictEqual((await submit(channel, { type: "mewbeat_report_runs", id: "" })).type, "error");
    });

    it("shows a profile with the rounds, the best plays and the rating after a ranked run", async () => {
      const { channel } = setup();
      const run = await submit(channel, submitMessage());
      const mine = await submit(channel, profileMessage());
      assert.strictEqual(mine.status, "ok");
      assert.deepStrictEqual({ ...mine.player, firstAt: typeof mine.player.firstAt }, { userId: "ann", username: "Ann", avatarUrl: "https://a/ann.png", firstAt: "number" });
      assert.strictEqual(mine.summary.plays, 1);
      assert.strictEqual(mine.summary.songs, 1);
      assert.strictEqual(mine.summary.playMs, 3500);
      assert.strictEqual(mine.summary.avgAccuracy, run.result.accuracy);
      assert.deepStrictEqual(mine.summary.bestGrades, { S: 0, A: 0, B: 1, C: 0, D: 0 });
      assert.ok(mine.rating.pp > 0);
      assert.deepStrictEqual([mine.rating.global, mine.rating.server], [1, 1]);

      assert.deepStrictEqual(mine.recent.map((round) => [round.audioKey, round.title, round.difficulty, round.grade, round.score]), [[KEY, "Song", "hard", "B", 1500]]);
      assert.deepStrictEqual(Object.keys(mine.recent[0]).sort(), ["accuracy", "artist", "artworkUrl", "at", "audioKey", "difficulty", "grade", "score", "title"]);
      assert.strictEqual(mine.best.length, 1);
      assert.deepStrictEqual(Object.keys(mine.best[0]).sort(), ["accuracy", "artist", "artworkUrl", "audioKey", "difficulty", "grade", "pp", "stars", "title"]);
      assert.strictEqual(mine.best[0].title, "Song");
      assert.strictEqual(mine.best[0].pp, mine.rating.pp);

      // Anyone can look at another player.
      const other = await submit(channel, profileMessage({ userId: "ann" }), { userId: "bo", profile: BO });
      assert.strictEqual(other.status, "ok");
      assert.strictEqual(other.player.username, "Ann");
      assert.strictEqual(other.summary.plays, 1);
    });

    it("lists eight rows at most in each list", async () => {
      const { channel } = setup();
      for (let i = 0; i < 10; i += 1) await submit(channel, submitMessage({ id: `s${i}` }));
      const reply = await submit(channel, profileMessage());
      assert.strictEqual(reply.recent.length, 8);
    });

    it("answers stats in the shape of the stats store", async () => {
      const { channel, statsStore } = setup();
      await submit(channel, submitMessage({ presses: 42, emptyPresses: 7 }));
      const reply = await submit(channel, statsMessage());
      assert.strictEqual(reply.type, "mewbeat_stats");
      assert.strictEqual(reply.id, "st1");
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(reply.player.userId, "ann");
      assert.deepStrictEqual(reply.stats, statsStore.summaryOf("ann"));
      assert.deepStrictEqual(await submit(channel, statsMessage({ userId: "nobody" })), { type: "mewbeat_stats", id: "st1", status: "error", reason: "not_found" });
      assert.strictEqual((await submit(channel, statsMessage({ userId: 5 }))).reason, "bad_request");
    });

    it("lists the 50 maps with the highest max combo, the rest of the stats whole", async () => {
      const { channel, statsStore } = setup();
      for (let index = 0; index < 60; index++) {
        statsStore.add("ann", { audioKey: `youtube|song${index}|180000`, difficulty: "normal", track: { title: `Song ${index}` }, durationMs: 1000, accuracy: 90, maxCombo: index + 1, parts: 100, counts: {} });
      }
      const { stats } = await submit(channel, statsMessage());
      assert.strictEqual(stats.maps.length, 50);
      assert.strictEqual(stats.maps[0].maxCombo, 60);
      assert.strictEqual(stats.maps[49].maxCombo, 11);
      assert.strictEqual(stats.songs, 60);
      assert.strictEqual(stats.plays, 60);
      assert.deepStrictEqual(stats.bestCombo, { value: 60, title: "Song 59" });
    });

    it("counts a real run in the stats, also an unranked one, but not calibration or autoplay", async () => {
      const { channel, statsStore } = setup();
      await submit(channel, submitMessage({ flags: { calibration: true } }));
      await submit(channel, submitMessage({ flags: { autoplay: true } }));
      assert.strictEqual(statsStore.has("ann"), false);

      const unranked = await submit(channel, submitMessage({ flags: { difficultyChanged: true } }));
      assert.strictEqual(unranked.result.ranked, false);
      const summary = statsStore.summaryOf("ann");
      assert.strictEqual(summary.plays, 1);
      assert.deepStrictEqual(summary.counts, { perfect: 4, great: 1, good: 1, miss: 0 });
      assert.strictEqual(summary.playMs, 3500);
      assert.strictEqual(summary.username, "Ann");
      // The hold of 400 ms was held to its tail at 2900, a hold of 400.
      assert.strictEqual(summary.holdMs, 400);
      assert.strictEqual(summary.timing.earlyShare, 0);
    });

    it("keeps the song on the score, so the ranking can name it", async () => {
      const { channel, scoreStore } = setup();
      await submit(channel, submitMessage());
      let seen;
      scoreStore.forEachEntry((chartKey, entry) => { seen = entry; });
      assert.deepStrictEqual([seen.title, seen.artist, seen.artworkUrl], ["Song", "Artist", "https://i/1.png"]);
    });

    it("counts key presses only when they are whole numbers within bounds", async () => {
      for (const presses of [-1, 1.5, "9", 1e9, null]) {
        const { channel, statsStore } = setup();
        const reply = await submit(channel, submitMessage({ presses, emptyPresses: presses }));
        assert.strictEqual(reply.status, "ok", String(presses));
        assert.strictEqual(statsStore.summaryOf("ann").presses, 0, String(presses));
        assert.strictEqual(statsStore.summaryOf("ann").emptyPresses, 0, String(presses));
      }
      const { channel, statsStore } = setup();
      await submit(channel, submitMessage({ presses: 42, emptyPresses: 7 }));
      assert.strictEqual(statsStore.summaryOf("ann").presses, 42);
      assert.strictEqual(statsStore.summaryOf("ann").emptyPresses, 7);
    });

    it("never counts more empty presses than presses", async () => {
      const { channel, statsStore } = setup();
      await submit(channel, submitMessage({ presses: 5, emptyPresses: 50 }));
      assert.strictEqual(statsStore.summaryOf("ann").emptyPresses, 5);
    });

    it("ranks players by rating, per server or everywhere, with your own place", async () => {
      const { channel } = setup();
      await submit(channel, submitMessage(), { guildId: "g1" });
      await submit(channel, submitMessage({
        events: perfectEvents().map((event) => (event.n === 0 ? { ...event, j: "good" } : event)),
      }), { guildId: "g2", userId: "bo", profile: BO });

      const global = await submit(channel, rankingMessage(), { guildId: "g2", userId: "bo", profile: BO });
      assert.strictEqual(global.type, "mewbeat_ranking");
      assert.strictEqual(global.id, "rk1");
      assert.strictEqual(global.status, "ok");
      assert.deepStrictEqual(global.entries.map((entry) => [entry.rank, entry.userId]), [[1, "ann"], [2, "bo"]]);
      // Your own row carries the name, picture and accuracy the pinned row needs, as a ranking row would.
      assert.deepStrictEqual(global.own, { rank: 2, pp: global.entries[1].pp, username: "Bo", avatarUrl: null, accuracy: global.entries[1].accuracy });
      const asAnn = await submit(channel, rankingMessage(), { guildId: "g1" });
      assert.deepStrictEqual(asAnn.own, { rank: 1, pp: asAnn.entries[0].pp, username: "Ann", avatarUrl: "https://a/ann.png", accuracy: asAnn.entries[0].accuracy });

      const server = await submit(channel, rankingMessage({ scope: "server" }), { guildId: "g2", userId: "bo", profile: BO });
      assert.deepStrictEqual(server.entries.map((entry) => entry.userId), ["bo"]);
      assert.strictEqual(server.own.rank, 1);

      assert.strictEqual((await submit(channel, rankingMessage({ limit: 1 }))).entries.length, 1);
      const nobody = await submit(channel, rankingMessage(), asCy);
      // Without a rated play there is no accuracy; the name and picture come from the requester's profile.
      assert.deepStrictEqual(nobody.own, { rank: null, pp: 0, username: "Cy", avatarUrl: null, accuracy: null });
    });

    it("refuses a bad scope", async () => {
      assert.strictEqual((await submit(setup().channel, rankingMessage({ scope: "mine" }))).reason, "bad_scope");
    });

    it("does not rebuild the ranking for a run that is no new best", async () => {
      const walks = { count: 0 };
      const { channel } = setup({ walks });
      await submit(channel, submitMessage());
      await submit(channel, rankingMessage());
      assert.strictEqual(walks.count, 1);
      const worse = await submit(channel, submitMessage({ events: perfectEvents().map((event) => ({ ...event, j: "good" })) }));
      assert.strictEqual(worse.result.newBest, false);
      await submit(channel, rankingMessage());
      assert.strictEqual(walks.count, 1);
    });

    it("stores the share of the chart that was judged next to a new best", async () => {
      const { channel, scoreStore } = setup();
      const stored = () => { let seen; scoreStore.forEachEntry((chartKey, entry) => { seen = entry; }); return seen; };
      // Four of the six judgements (a hold has two).
      await submit(channel, submitMessage({ events: perfectEvents().slice(0, 4) }));
      assert.strictEqual(stored().completion, 0.6667);
      await submit(channel, submitMessage());
      assert.strictEqual(stored().completion, 1);
    });

    it("rates a partial run lower than the whole map at the same accuracy", async () => {
      const whole = setup();
      await submit(whole.channel, submitMessage());
      const partial = setup();
      await submit(partial.channel, submitMessage({ events: perfectEvents().slice(0, 3) }));
      const ppOf = async (env) => (await submit(env.channel, { type: "mewbeat_profile", id: "p" })).rating.pp;
      assert.ok((await ppOf(partial)) < (await ppOf(whole)));
    });

    it("counts a run in the stats only when at least half of it was judged", async () => {
      const { channel, statsStore } = setup();
      await submit(channel, submitMessage({ events: perfectEvents().slice(0, 2) }));
      assert.strictEqual(statsStore.has("ann"), false);
      // Three of six judgements, the furthest being the tap at 2000: that much of the song was played.
      await submit(channel, submitMessage({ events: perfectEvents().slice(0, 3) }));
      assert.strictEqual(statsStore.summaryOf("ann").plays, 1);
      assert.strictEqual(statsStore.summaryOf("ann").playMs, 2000);
    });

    it("adds the time up to the furthest judged note, a hold counting to its end, never past the song", async () => {
      const { channel, statsStore } = setup();
      await submit(channel, submitMessage());
      assert.strictEqual(statsStore.summaryOf("ann").playMs, 3500);
      const brief = setup({ durationMs: 3000 });
      await submit(brief.channel, submitMessage());
      assert.strictEqual(brief.statsStore.summaryOf("ann").playMs, 3000);
    });

    it("shows a ranked submit in the ranking at once, although the table is cached", async () => {
      const { channel } = setup();
      assert.deepStrictEqual((await submit(channel, rankingMessage())).entries, []);
      await submit(channel, submitMessage());
      assert.deepStrictEqual((await submit(channel, rankingMessage())).entries.map((entry) => entry.userId), ["ann"]);
    });

    it("works without a stats store, answering unavailable for the profile messages", async () => {
      const channel = createMewbeatChannel({
        readPlayback: () => null,
        chartStore: { getCharts: async () => ({ status: "ready", charts: makeCharts() }), peekCharts: () => ({ status: "ready", charts: makeCharts() }) },
        soloTracks: (() => { const tracks = createSoloTracks(); tracks.put(KEY, { track: fakeTrack(), node: "n", info: { title: "Song" } }); return tracks; })(),
        scoreStore: createScoreStore({ file: path.join(dir, "scores2.json") }),
        historyStore: createHistoryStore({ file: path.join(dir, "history2.json") }),
      });
      assert.strictEqual((await submit(channel, submitMessage())).status, "ok");
      assert.strictEqual((await submit(channel, profileMessage())).reason, "unavailable");
      assert.strictEqual((await submit(channel, statsMessage())).reason, "unavailable");
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

    it("says where the song stands in line while its charts are still being made, and only then", async () => {
      const place = { step: "melody", ahead: 0, running: true };
      const waiting = setup({ charts: null, queue: place });
      assert.deepStrictEqual(await submit(waiting.channel, statsMessage()), { type: "mewbeat_song_stats", id: "t1", status: "ok", stats: null, queue: place });
      // Nothing pending for the song (queueOf answers null), or a song the bot does not know: no queue key.
      assert.deepStrictEqual(await submit(setup({ charts: null, queue: null }).channel, statsMessage()), { type: "mewbeat_song_stats", id: "t1", status: "ok", stats: null });
      assert.deepStrictEqual(await submit(waiting.channel, statsMessage({ audioKey: "youtube:other:1" })), { type: "mewbeat_song_stats", id: "t1", status: "ok", stats: null });
      // A charted song carries stats and no queue, even when the store still has a line entry for it.
      const charted = await submit(setup({ queue: place }).channel, statsMessage());
      assert.strictEqual(charted.queue, undefined);
      assert.strictEqual(charted.stats.easy.stars, 1.5);
    });

    it("refuses a bad key and a bad id", async () => {
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
