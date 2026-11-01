const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");

const NOW = 1_700_000_000_000;
const KEY = "youtube:abc:200000";

function fakeTrack(info) {
  return { info: { sourceName: "youtube", identifier: "abc", length: 200000, ...info } };
}

function setup({ playback, unlocked = true, result } = {}) {
  const calls = [];
  const charts = { easy: { id: "e" }, normal: { id: "n" }, hard: { id: "h", notes: [1, 2] } };
  const channel = createMewbeatChannel({
    readPlayback: () => (playback === undefined
      ? { track: fakeTrack(), node: "node-1", positionMs: 61234.4, paused: false, durationMs: 200000 }
      : playback),
    chartStore: {
      getCharts: async (track, node) => {
        calls.push({ track, node });
        return result ?? { status: "ready", charts };
      },
    },
    isUnlocked: () => unlocked,
    now: () => NOW,
  });
  return { channel, calls, charts };
}

describe("mewbeat activity channel", () => {
  it("answers sync with the echoed ids, the server clock and an anchor", async () => {
    const { channel } = setup();
    const reply = await channel.handle("g", "u", { type: "mewbeat_sync", id: "s1", clientSentAt: 42.5 });
    assert.deepStrictEqual(reply, {
      type: "mewbeat_sync",
      id: "s1",
      clientSentAt: 42.5,
      serverNow: NOW,
      anchor: { audioKey: KEY, positionMs: 61234, at: NOW, paused: false, durationMs: 200000 },
    });
  });

  it("dates the anchor by the audio latency so the position is when it is heard", async () => {
    const channel = createMewbeatChannel({
      readPlayback: () => ({ track: fakeTrack(), node: "n", positionMs: 1000, paused: false, durationMs: 200000 }),
      chartStore: { getCharts: async () => ({ status: "ready", charts: {} }) },
      isUnlocked: () => true,
      now: () => NOW,
      audioLatencyMs: 500,
    });
    const reply = await channel.handle("g", "u", { type: "mewbeat_sync", id: "s1", clientSentAt: 1 });
    assert.strictEqual(reply.serverNow, NOW);
    assert.deepStrictEqual(reply.anchor, { audioKey: KEY, positionMs: 1000, at: NOW + 500, paused: false, durationMs: 200000 });
  });

  it("gives a null anchor when nothing plays", async () => {
    const { channel } = setup({ playback: null });
    const reply = await channel.handle("g", "u", { type: "mewbeat_sync", id: "s1", clientSentAt: 1 });
    assert.strictEqual(reply.type, "mewbeat_sync");
    assert.strictEqual(reply.anchor, null);
  });

  it("gives a null anchor for a stream", async () => {
    const { channel } = setup({
      playback: { track: fakeTrack({ isStream: true }), node: null, positionMs: 5, paused: false, durationMs: 0 },
    });
    const reply = await channel.handle("g", "u", { type: "mewbeat_sync", id: "s1", clientSentAt: 1 });
    assert.strictEqual(reply.anchor, null);
  });

  it("syncs for a locked account", async () => {
    const { channel } = setup({ unlocked: false });
    const reply = await channel.handle("g", "u", { type: "mewbeat_sync", id: "s1", clientSentAt: 1 });
    assert.strictEqual(reply.type, "mewbeat_sync");
  });

  it("rejects a sync with a bad id or timestamp", async () => {
    const { channel } = setup();
    for (const bad of [
      { id: 7, clientSentAt: 1 },
      { id: "x".repeat(41), clientSentAt: 1 },
      { id: "s1", clientSentAt: "1" },
      { id: "s1", clientSentAt: Infinity },
      { clientSentAt: 1 },
    ]) {
      const reply = await channel.handle("g", "u", { type: "mewbeat_sync", ...bad });
      assert.strictEqual(reply.type, "error");
    }
  });

  it("refuses a chart for a locked account without touching the store", async () => {
    const { channel, calls } = setup({ unlocked: false });
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "hard" });
    assert.deepStrictEqual(reply, { type: "error", error: "Unlock mewbeat first." });
    assert.strictEqual(calls.length, 0);
  });

  it("answers stale when the playing track is not the requested one", async () => {
    const { channel, calls } = setup();
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: "youtube:other:1", difficulty: "hard" });
    assert.deepStrictEqual(reply, { type: "mewbeat_chart", audioKey: "youtube:other:1", difficulty: "hard", status: "stale" });
    assert.strictEqual(calls.length, 0);
  });

  it("answers stale when nothing plays", async () => {
    const { channel, calls } = setup({ playback: null });
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "easy" });
    assert.strictEqual(reply.status, "stale");
    assert.strictEqual(calls.length, 0);
  });

  it("sends only the requested difficulty when the charts are ready", async () => {
    const { channel, calls, charts } = setup();
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "hard" });
    assert.strictEqual(reply.type, "mewbeat_chart");
    assert.strictEqual(reply.audioKey, KEY);
    assert.strictEqual(reply.difficulty, "hard");
    assert.strictEqual(reply.status, "ready");
    assert.deepStrictEqual(reply.chart, charts.hard);
    assert.strictEqual("charts" in reply, false);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].node, "node-1");
  });

  it("passes an uncharted status and reason through without a chart", async () => {
    const { channel } = setup({ result: { status: "uncharted", reason: "too_few_notes" } });
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "normal" });
    assert.deepStrictEqual(reply, {
      type: "mewbeat_chart", audioKey: KEY, difficulty: "normal", status: "uncharted", reason: "too_few_notes",
    });
  });

  it("passes pending through without a reason or chart", async () => {
    const { channel } = setup({ result: { status: "pending" } });
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "normal" });
    assert.deepStrictEqual(reply, { type: "mewbeat_chart", audioKey: KEY, difficulty: "normal", status: "pending" });
  });

  it("rejects an unknown difficulty", async () => {
    const { channel, calls } = setup();
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "expert" });
    assert.strictEqual(reply.type, "error");
    assert.strictEqual(calls.length, 0);
  });

  it("rejects an unknown mewbeat type", async () => {
    const { channel } = setup();
    const reply = await channel.handle("g", "u", { type: "mewbeat_dance" });
    assert.deepStrictEqual(reply, { type: "error", error: "Unknown mewbeat message." });
  });

  it("lets a failing chart store reject so the socket can report it", async () => {
    const channel = createMewbeatChannel({
      readPlayback: () => ({ track: fakeTrack(), node: null, positionMs: 0, paused: false, durationMs: 200000 }),
      chartStore: { getCharts: async () => { throw new Error("disk gone"); } },
      isUnlocked: () => true,
    });
    await assert.rejects(channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "easy" }), /disk gone/);
  });
});
