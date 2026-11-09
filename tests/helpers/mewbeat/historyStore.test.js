const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createHistoryStore } = require("../../../helpers/mewbeat/historyStore");

function entry(audioKey, overrides) {
  return {
    audioKey,
    uri: `https://x/${audioKey}`,
    source: "youtube",
    title: `Title ${audioKey}`,
    artist: "Artist",
    artworkUrl: null,
    durationMs: 1000,
    difficulty: "hard",
    score: 10,
    accuracy: 90,
    grade: "A",
    ranked: true,
    mode: "solo",
    guildId: "g1",
    ...overrides,
  };
}

describe("mewbeat history store", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-history-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const open = (options) => createHistoryStore({ file: path.join(dir, "history.json"), debounceMs: 5, ...options });

  it("keeps the newest rounds per user, newest first", () => {
    let clock = 0;
    const store = open({ perUser: 200, now: () => (clock += 1) });
    for (let i = 0; i < 205; i += 1) store.add("u1", entry(`k${i}`));
    store.add("u2", entry("other"));
    const all = store.recent("u1", 500);
    assert.strictEqual(all.length, 200);
    assert.strictEqual(all[0].audioKey, "k204");
    assert.strictEqual(all[199].audioKey, "k5");
    assert.deepStrictEqual(store.recent("u1", 2).map((e) => e.audioKey), ["k204", "k203"]);
    assert.strictEqual(store.recent("u2", 5).length, 1);
    assert.deepStrictEqual(store.recent("nobody", 5), []);
  });

  it("aggregates the distinct songs played per server and anywhere", () => {
    const store = open();
    store.add("u1", entry("a", { at: 100, guildId: "g1" }));
    store.add("u2", entry("a", { at: 300, guildId: "g1", title: "A (new title)" }));
    store.add("u1", entry("b", { at: 200, guildId: "g1" }));
    store.add("u1", entry("c", { at: 400, guildId: "g2" }));
    store.add("u3", entry("a", { at: 50, guildId: "g2" }));

    const server = store.played({ guildId: "g1", limit: 10 });
    assert.deepStrictEqual(server.map((t) => [t.audioKey, t.plays, t.lastAt]), [["a", 2, 300], ["b", 1, 200]]);
    assert.strictEqual(server[0].title, "A (new title)");
    assert.deepStrictEqual(Object.keys(server[0]).sort(), [
      "artist", "artworkUrl", "audioKey", "durationMs", "lastAt", "plays", "playsBy", "source", "title", "uri",
    ]);

    const global = store.played({ guildId: null, limit: 10 });
    assert.deepStrictEqual(global.map((t) => [t.audioKey, t.plays]), [["c", 1], ["a", 3], ["b", 1]]);
    assert.strictEqual(store.played({ guildId: null, limit: 2 }).length, 2);
    assert.deepStrictEqual(store.played({ guildId: "nowhere", limit: 5 }), []);
  });

  it("keeps 2000 rounds per user by default", () => {
    const store = open();
    for (let i = 0; i < 2005; i += 1) store.add("u1", entry(`k${i}`));
    assert.strictEqual(store.recent("u1", 5000).length, 2000);
    assert.strictEqual(store.recent("u1", 1)[0].audioKey, "k2004");
  });

  it("lists one user's songs with the rounds per level", () => {
    const store = open();
    store.add("u1", entry("a", { at: 100, difficulty: "easy" }));
    store.add("u1", entry("a", { at: 200, difficulty: "hard" }));
    store.add("u1", entry("a", { at: 300, difficulty: "hard" }));
    store.add("u2", entry("a", { at: 400, difficulty: "hell" }));
    store.add("u2", entry("b", { at: 500, difficulty: "normal" }));
    const mine = store.played({ userId: "u1", limit: 10 });
    assert.deepStrictEqual(mine.map((t) => [t.audioKey, t.plays]), [["a", 3]]);
    assert.deepStrictEqual(mine[0].playsBy, { easy: 1, normal: 0, hard: 2, hell: 0 });
    const everyone = store.played({ limit: 10 });
    assert.deepStrictEqual(everyone.find((t) => t.audioKey === "a").playsBy, { easy: 1, normal: 0, hard: 2, hell: 1 });
  });

  it("finds the first track a user played for a song", () => {
    const store = open();
    store.add("u1", entry("a", { at: 100, title: "Old title" }));
    store.add("u1", entry("a", { at: 200, title: "New title" }));
    assert.deepStrictEqual(store.firstTrackOf("u1", "a"), { title: "Old title", artist: "Artist", artworkUrl: null });
    assert.strictEqual(store.firstTrackOf("u1", "zzz"), null);
    assert.strictEqual(store.firstTrackOf("nobody", "a"), null);
  });

  it("survives a restart after flush and tolerates a corrupt file", async () => {
    const store = open();
    store.add("u1", entry("a", { at: 1 }));
    await store.flush();
    assert.strictEqual(open().recent("u1", 5)[0].audioKey, "a");

    fs.writeFileSync(path.join(dir, "history.json"), "nope");
    assert.deepStrictEqual(open().recent("u1", 5), []);
  });
});
