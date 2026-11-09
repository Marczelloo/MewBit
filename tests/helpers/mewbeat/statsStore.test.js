const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createStatsStore } = require("../../../helpers/mewbeat/statsStore");

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const NO_TIMING = { n: 0, sum: 0, sumSq: 0, early: 0, late: 0 };

function run(overrides = {}) {
  return {
    profile: { username: "Mew", avatarUrl: "https://x/a.png" },
    audioKey: "a",
    difficulty: "hard",
    track: { title: "Song A", artist: "Artist", artworkUrl: null },
    durationMs: 1000,
    accuracy: 90,
    counts: { perfect: 5, great: 3, good: 1, miss: 1 },
    maxCombo: 6,
    parts: 10,
    fevers: 1,
    presses: 12,
    emptyPresses: 2,
    holdMs: 300,
    longestHoldMs: 200,
    timing: NO_TIMING,
    ...overrides,
  };
}

describe("mewbeat stats store", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-stats-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const open = (options) => createStatsStore({ file: path.join(dir, "stats.json"), debounceMs: 5, ...options });

  it("knows nobody until a run is added", () => {
    const store = open();
    assert.strictEqual(store.summaryOf("nobody"), null);
    assert.strictEqual(store.has("nobody"), false);
    store.add("u1", run());
    assert.strictEqual(store.has("u1"), true);
  });

  it("summarises one run without timing samples as nulls, never NaN", () => {
    const store = open({ now: () => 4242 });
    store.add("u1", run());
    const summary = store.summaryOf("u1");
    assert.deepStrictEqual(summary.timing, { meanMs: null, spreadMs: null, earlyShare: null, lateShare: null });
    assert.strictEqual(summary.avgAccuracy, 90);
    assert.strictEqual(summary.firstAt, 4242);
    assert.strictEqual(summary.username, "Mew");
    assert.strictEqual(summary.avatarUrl, "https://x/a.png");
    assert.strictEqual(summary.plays, 1);
    assert.strictEqual(summary.songs, 1);
    for (const value of [summary.avgAccuracy, summary.playMs, summary.presses, summary.holdMs, summary.fevers]) {
      assert.ok(Number.isFinite(value));
    }
  });

  it("adds runs up and derives the timing spread", () => {
    const store = open();
    store.add("u1", run({ accuracy: 80, timing: { n: 2, sum: 10, sumSq: 500, early: 1, late: 1 } }));
    store.add("u1", run({
      audioKey: "b", accuracy: 100, durationMs: 2000, counts: { perfect: 2, great: 0, good: 0, miss: 0 },
      holdMs: 100, longestHoldMs: 400, fevers: 0, presses: 3, emptyPresses: 0,
      timing: { n: 2, sum: 30, sumSq: 500, early: 0, late: 2 },
    }));
    const summary = store.summaryOf("u1");
    assert.strictEqual(summary.plays, 2);
    assert.strictEqual(summary.songs, 2);
    assert.strictEqual(summary.playMs, 3000);
    near(summary.avgAccuracy, 90);
    assert.deepStrictEqual(summary.counts, { perfect: 7, great: 3, good: 1, miss: 1 });
    assert.strictEqual(summary.presses, 15);
    assert.strictEqual(summary.emptyPresses, 2);
    assert.strictEqual(summary.holdMs, 400);
    assert.strictEqual(summary.longestHoldMs, 400);
    assert.strictEqual(summary.fevers, 1);
    // n=4, sum=40, sumSq=1000: mean 10, variance 250 - 100 = 150
    near(summary.timing.meanMs, 10);
    near(summary.timing.spreadMs, Math.sqrt(150));
    near(summary.timing.earlyShare, 0.25);
    near(summary.timing.lateShare, 0.75);
  });

  it("counts a song once across its difficulties", () => {
    const store = open();
    store.add("u1", run({ difficulty: "easy" }));
    store.add("u1", run({ difficulty: "hard" }));
    assert.strictEqual(store.summaryOf("u1").songs, 1);
    assert.strictEqual(store.summaryOf("u1").maps.length, 2);
  });

  it("marks a full combo once and keeps it after a worse run", () => {
    const store = open();
    store.add("u1", run({ counts: { perfect: 9, great: 1, good: 0, miss: 0 }, maxCombo: 10, parts: 10 }));
    store.add("u1", run({ maxCombo: 4 }));
    store.add("u1", run({ audioKey: "b", counts: { perfect: 9, great: 0, good: 0, miss: 1 }, maxCombo: 10, parts: 10 }));
    const summary = store.summaryOf("u1");
    assert.strictEqual(summary.fullCombos, 1);
    const a = summary.maps.find((map) => map.audioKey === "a");
    const b = summary.maps.find((map) => map.audioKey === "b");
    assert.strictEqual(a.fullCombo, true);
    assert.strictEqual(a.maxCombo, 10);
    assert.strictEqual(b.fullCombo, false);
  });

  it("does not call a run without any parts a full combo", () => {
    const store = open();
    store.add("u1", run({ counts: { perfect: 0, great: 0, good: 0, miss: 0 }, maxCombo: 0, parts: 0 }));
    assert.strictEqual(store.summaryOf("u1").fullCombos, 0);
    assert.strictEqual(store.summaryOf("u1").maps[0].fullCombo, false);
  });

  it("keeps the highest combo per map and names the best one", () => {
    const store = open();
    store.add("u1", run({ audioKey: "a", maxCombo: 6 }));
    store.add("u1", run({ audioKey: "a", maxCombo: 3 }));
    store.add("u1", run({ audioKey: "c", track: { title: "Song C", artist: "", artworkUrl: null }, maxCombo: 8 }));
    const summary = store.summaryOf("u1");
    assert.deepStrictEqual(summary.maps.map((map) => [map.audioKey, map.maxCombo]), [["c", 8], ["a", 6]]);
    assert.deepStrictEqual(summary.bestCombo, { value: 8, title: "Song C" });
    assert.strictEqual(summary.maps[0].title, "Song C");
    assert.strictEqual(summary.maps[0].difficulty, "hard");
    assert.strictEqual(summary.maps[0].parts, 10);
  });

  it("survives a flush and a reload, and tolerates a corrupt file", async () => {
    const store = open();
    store.add("u1", run({ timing: { n: 1, sum: 5, sumSq: 25, early: 0, late: 1 } }));
    await store.flush();
    assert.deepStrictEqual(open().summaryOf("u1"), store.summaryOf("u1"));

    fs.writeFileSync(path.join(dir, "stats.json"), "nope");
    assert.strictEqual(open().summaryOf("u1"), null);
  });
});
