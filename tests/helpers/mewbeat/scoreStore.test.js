const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createScoreStore } = require("../../../helpers/mewbeat/scoreStore");

const KEY = "youtube:abc:200000|hard|4";

function run(overrides) {
  return {
    chartKey: KEY,
    userId: "u1",
    guildId: "g1",
    profile: { id: "u1", username: "Ann", avatarUrl: "https://a/1.png" },
    score: 1000,
    accuracy: 90,
    grade: "A",
    maxCombo: 20,
    difficulty: "hard",
    at: 100,
    ...overrides,
  };
}

describe("mewbeat score store", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-scores-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const open = (options) => createScoreStore({ file: path.join(dir, "scores.json"), debounceMs: 5, ...options });

  it("keeps the best run and reports a new best only when beaten", () => {
    const store = open();
    assert.strictEqual(store.submit(run()).newBest, true);
    const worse = store.submit(run({ score: 900, at: 200 }));
    assert.strictEqual(worse.newBest, false);
    assert.strictEqual(worse.best.score, 1000);
    assert.strictEqual(worse.best.at, 100);
    const tie = store.submit(run({ score: 1000, at: 250 }));
    assert.strictEqual(tie.newBest, false);
    const better = store.submit(run({ score: 1200, grade: "S", at: 300 }));
    assert.strictEqual(better.newBest, true);
    assert.deepStrictEqual(store.bestOf(KEY, "u1"), {
      userId: "u1", username: "Ann", avatarUrl: "https://a/1.png", score: 1200, accuracy: 90, grade: "S", maxCombo: 20, modifiers: [], at: 300,
    });
    assert.strictEqual(store.bestOf(KEY, "nobody"), null);
  });

  it("hands back the best from before the run as previous, null on a first play", () => {
    const store = open();
    const first = store.submit(run());
    assert.strictEqual(first.previous, null);
    const worse = store.submit(run({ score: 900, accuracy: 80, at: 200 }));
    assert.strictEqual(worse.newBest, false);
    assert.deepStrictEqual([worse.previous.score, worse.previous.accuracy], [1000, 90]);
    const better = store.submit(run({ score: 1200, accuracy: 95, at: 300 }));
    assert.strictEqual(better.newBest, true);
    assert.deepStrictEqual([better.previous.score, better.previous.accuracy, better.best.score], [1000, 90, 1200]);
    assert.strictEqual(store.submit(run({ userId: "u2", profile: { username: "Bo" } })).previous, null, "another player has none");
  });

  describe("on a remote", () => {
    // What remoteSync gives a store, with the loading switched by hand.
    function remoteStore() {
      const state = { ready: false, deferred: [], upserts: [] };
      const remote = {
        ready: () => state.ready,
        upsert: (table, id, row) => state.upserts.push(row),
        defer: (store, method, args) => state.deferred.push({ store, method, args }),
      };
      return { state, store: createScoreStore({ remote }) };
    }

    it("has no previous best to give before it is loaded, and the call is deferred", () => {
      const { state, store } = remoteStore();
      const reply = store.submit(run());
      assert.deepStrictEqual(reply, { newBest: false, best: null });
      assert.strictEqual("previous" in reply, false);
      assert.strictEqual(state.deferred.length, 1);
    });

    it("gives the loaded best as previous once it is loaded", () => {
      const { state, store } = remoteStore();
      state.ready = true;
      const first = store.submit(run());
      assert.strictEqual(first.previous, null);
      store.hydrate([state.upserts[0]]);
      const second = store.submit(run({ score: 800, accuracy: 70, at: 200 }));
      assert.deepStrictEqual([second.newBest, second.previous.score, second.previous.accuracy], [false, 1000, 90]);
      const third = store.submit(run({ score: 1100, accuracy: 92, at: 300 }));
      assert.deepStrictEqual([third.newBest, third.previous.score], [true, 1000]);
    });
  });

  it("sorts boards by score then earlier time and ranks by scope", () => {
    const store = open();
    store.submit(run({ userId: "u1", guildId: "g1", score: 1000, at: 100 }));
    store.submit(run({ userId: "u2", guildId: "g1", profile: { username: "Bo" }, score: 1000, at: 50 }));
    store.submit(run({ userId: "u3", guildId: "g2", profile: { username: "Cy" }, score: 5000, at: 10 }));
    store.submit(run({ userId: "u4", guildId: "g1", profile: { username: "Di" }, score: 300, at: 10 }));

    assert.deepStrictEqual(store.board({ chartKey: KEY, guildId: null, limit: 10 }).map((e) => e.userId), ["u3", "u2", "u1", "u4"]);
    assert.deepStrictEqual(store.board({ chartKey: KEY, guildId: "g1", limit: 2 }).map((e) => e.userId), ["u2", "u1"]);
    assert.strictEqual(store.rankOf({ chartKey: KEY, userId: "u1", guildId: null }), 3);
    assert.strictEqual(store.rankOf({ chartKey: KEY, userId: "u1", guildId: "g1" }), 2);
    assert.strictEqual(store.rankOf({ chartKey: KEY, userId: "u3", guildId: "g1" }), null);
    assert.strictEqual(store.rankOf({ chartKey: "other|hard|4", userId: "u1", guildId: null }), null);
    assert.deepStrictEqual(store.board({ chartKey: "other|hard|4", guildId: null, limit: 5 }), []);
  });

  it("counts a user on every server they scored the chart in and refreshes their name", () => {
    const store = open();
    store.submit(run({ guildId: "g1", score: 1000 }));
    store.submit(run({ guildId: "g2", score: 500, profile: { id: "u1", username: "Anna", avatarUrl: null } }));
    assert.strictEqual(store.rankOf({ chartKey: KEY, userId: "u1", guildId: "g2" }), 1);
    const [entry] = store.board({ chartKey: KEY, guildId: "g1", limit: 5 });
    assert.strictEqual(entry.username, "Anna");
    assert.strictEqual(entry.score, 1000);
    assert.strictEqual(entry.avatarUrl, null);
  });

  it("finds the newest chart version scored for a song and difficulty", () => {
    const store = open();
    store.submit(run({ chartKey: "s:a:1|hard|3" }));
    store.submit(run({ chartKey: "s:a:1|hard|10" }));
    store.submit(run({ chartKey: "s:a:1|easy|12" }));
    assert.strictEqual(store.latestChartKey("s:a:1", "hard"), "s:a:1|hard|10");
    assert.strictEqual(store.latestChartKey("s:a:1", "hell"), null);
  });

  it("keeps the newest-version index across a submit of an older version and a restart", async () => {
    const store = open();
    store.submit(run({ chartKey: "s:a:1|hard|10" }));
    store.submit(run({ chartKey: "s:a:1|hard|3", userId: "u2", profile: { id: "u2", username: "Bo" } }));
    assert.strictEqual(store.latestChartKey("s:a:1", "hard"), "s:a:1|hard|10");
    // Older versions are still on disk and still readable by their key.
    assert.strictEqual(store.bestOf("s:a:1|hard|3", "u2").username, "Bo");
    await store.flush();
    const reopened = open();
    assert.strictEqual(reopened.latestChartKey("s:a:1", "hard"), "s:a:1|hard|10");
    reopened.submit(run({ chartKey: "s:a:1|hard|11" }));
    assert.strictEqual(reopened.latestChartKey("s:a:1", "hard"), "s:a:1|hard|11");
  });

  it("keeps the modifiers of the best run and returns them in board rows, [] for an old row", async () => {
    const store = open();
    store.submit(run({ modifiers: ["gn", "nf"] }));
    store.submit(run({ score: 400, at: 150, modifiers: [] })); // worse: the best keeps its modifiers
    assert.deepStrictEqual(store.bestOf(KEY, "u1").modifiers, ["gn", "nf"]);
    assert.deepStrictEqual(store.board({ chartKey: KEY, limit: 5 })[0].modifiers, ["gn", "nf"]);
    store.submit(run({ userId: "u2", profile: { id: "u2", username: "Bo" } })); // no modifiers sent
    assert.deepStrictEqual(store.bestOf(KEY, "u2").modifiers, []);
    await store.flush();
    assert.deepStrictEqual(open().bestOf(KEY, "u1").modifiers, ["gn", "nf"]);
    // A row stored before modifiers existed has no field at all.
    fs.writeFileSync(path.join(dir, "scores.json"), JSON.stringify({ charts: { [KEY]: { u9: { userId: "u9", username: "Old", score: 5, at: 1 } } } }));
    assert.deepStrictEqual(open().board({ chartKey: KEY, limit: 5 })[0].modifiers, []);
  });

  it("indexes the newest chart version per scoring rules version, a key without a suffix being rules 1", () => {
    const store = open();
    store.submit(run({ chartKey: "s:a:1|hard|10" }));
    store.submit(run({ chartKey: "s:a:1|hard|3|r2" }));
    assert.strictEqual(store.latestChartKey("s:a:1", "hard"), "s:a:1|hard|10");
    assert.strictEqual(store.latestChartKey("s:a:1", "hard", 1), "s:a:1|hard|10");
    assert.strictEqual(store.latestChartKey("s:a:1", "hard", 2), "s:a:1|hard|3|r2");
    store.submit(run({ chartKey: "s:a:1|hard|4|r2" }));
    assert.strictEqual(store.latestChartKey("s:a:1", "hard", 2), "s:a:1|hard|4|r2");
    assert.strictEqual(store.latestChartKey("s:a:1", "hard", 3), null);
    // The two boards never mix.
    assert.strictEqual(store.rankOf({ chartKey: "s:a:1|hard|4|r2", userId: "u1", guildId: null }), 1);
    assert.deepStrictEqual(store.board({ chartKey: "s:a:1|hard|4", limit: 5 }), []);
  });

  it("survives a restart after flush", async () => {
    const store = open();
    store.submit(run({ score: 777 }));
    await store.flush();
    const reopened = open();
    assert.strictEqual(reopened.bestOf(KEY, "u1").score, 777);
    assert.strictEqual(reopened.rankOf({ chartKey: KEY, userId: "u1", guildId: "g1" }), 1);
  });

  it("keeps the track on the best entry only, out of the board replies", () => {
    const store = open();
    store.submit(run({ track: { title: "Song", artist: "Art", artworkUrl: "https://a/art.png" } }));
    store.submit(run({ score: 500, at: 200, track: { title: "Other", artist: "X", artworkUrl: null } }));
    let stored;
    store.forEachEntry((chartKey, entry) => { stored = entry; });
    assert.strictEqual(stored.title, "Song");
    assert.strictEqual(stored.artworkUrl, "https://a/art.png");
    store.submit(run({ score: 2000, at: 300, track: { title: "Renamed", artist: "Art", artworkUrl: null } }));
    store.forEachEntry((chartKey, entry) => { stored = entry; });
    assert.strictEqual(stored.title, "Renamed");
    assert.ok(!("title" in store.bestOf(KEY, "u1")));
    assert.ok(!("title" in store.board({ chartKey: KEY })[0]));
  });

  it("keeps the completion flat on the entry of a new best only", () => {
    const store = open();
    const completionOf = () => { let stored; store.forEachEntry((chartKey, entry) => { stored = entry; }); return stored.completion; };
    store.submit(run({ completion: 0.55 }));
    assert.strictEqual(completionOf(), 0.55);
    store.submit(run({ score: 500, at: 200, completion: 1 }));
    assert.strictEqual(completionOf(), 0.55);
    store.submit(run({ score: 2000, at: 300, completion: 0.9 }));
    assert.strictEqual(completionOf(), 0.9);
    assert.ok(!("completion" in store.bestOf(KEY, "u1")));
  });

  it("visits every chart and user with the stored entry", () => {
    const store = open();
    store.submit(run({ userId: "u1", guildId: "g1" }));
    store.submit(run({ userId: "u2", guildId: "g2", profile: { username: "Bo" } }));
    store.submit(run({ chartKey: "other|easy|1", userId: "u1", guildId: "g1" }));
    const seen = [];
    store.forEachEntry((chartKey, entry) => seen.push(`${chartKey}:${entry.userId}:${entry.guildIds}`));
    assert.deepStrictEqual(seen.sort(), ["other|easy|1:u1:g1", `${KEY}:u1:g1`, `${KEY}:u2:g2`]);
  });

  it("writes by itself after the debounce", async () => {
    const store = open();
    store.submit(run());
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(fs.existsSync(path.join(dir, "scores.json")));
    assert.strictEqual(open().bestOf(KEY, "u1").score, 1000);
    await store.flush();
  });

  it("starts empty from a missing file and sets a corrupt one aside", () => {
    assert.strictEqual(open().bestOf(KEY, "u1"), null);
    fs.writeFileSync(path.join(dir, "scores.json"), "{not json");
    const store = open();
    assert.strictEqual(store.bestOf(KEY, "u1"), null);
    assert.ok(fs.readdirSync(dir).some((name) => name.startsWith("scores.json.corrupt-")));
  });
});
