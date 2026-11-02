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
      "artist", "artworkUrl", "audioKey", "durationMs", "lastAt", "plays", "source", "title", "uri",
    ]);

    const global = store.played({ guildId: null, limit: 10 });
    assert.deepStrictEqual(global.map((t) => [t.audioKey, t.plays]), [["c", 1], ["a", 3], ["b", 1]]);
    assert.strictEqual(store.played({ guildId: null, limit: 2 }).length, 2);
    assert.deepStrictEqual(store.played({ guildId: "nowhere", limit: 5 }), []);
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
