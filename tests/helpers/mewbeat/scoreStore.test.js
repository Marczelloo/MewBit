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
      userId: "u1", username: "Ann", avatarUrl: "https://a/1.png", score: 1200, accuracy: 90, grade: "S", maxCombo: 20, at: 300,
    });
    assert.strictEqual(store.bestOf(KEY, "nobody"), null);
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

  it("survives a restart after flush", async () => {
    const store = open();
    store.submit(run({ score: 777 }));
    await store.flush();
    const reopened = open();
    assert.strictEqual(reopened.bestOf(KEY, "u1").score, 777);
    assert.strictEqual(reopened.rankOf({ chartKey: KEY, userId: "u1", guildId: "g1" }), 1);
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
