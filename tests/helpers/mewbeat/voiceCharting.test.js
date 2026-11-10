const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { describe, it } = require("node:test");

const { createVoiceCharting } = require("../../../helpers/mewbeat/voiceCharting");

const trackOf = (identifier, length = 200_000, extra = {}) => ({ info: { sourceName: "youtube", identifier, length, isStream: false, ...extra } });

function setup({ playbacks = {}, result = { status: "ready" } } = {}) {
  const events = new EventEmitter();
  const calls = [];
  const chartStore = {
    getCharts: async (track, node, options) => {
      calls.push({ identifier: track.info.identifier, node, options });
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result(calls.length) : result;
    },
  };
  const voice = createVoiceCharting({
    events,
    readPlayback: (guildId) => playbacks[guildId] ?? null,
    chartStore,
    log: { info: () => {}, warning: () => {} },
  });
  return { voice, events, calls, playbacks };
}

describe("voice charting", () => {
  it("charts the track that starts, as background work with the player's node", async () => {
    const node = { id: "node" };
    const { voice, calls } = setup({ playbacks: { g1: { track: trackOf("abc"), node } } });
    await voice.onChange({ guildId: "g1", reason: "trackStart" });
    assert.deepStrictEqual(calls, [{ identifier: "abc", node, options: { priority: "background" } }]);
  });

  it("ignores every reason but a track start", async () => {
    const { voice, calls } = setup({ playbacks: { g1: { track: trackOf("abc"), node: {} } } });
    await voice.onChange({ guildId: "g1", reason: "pause" });
    await voice.onChange({ guildId: "g1", reason: "queue" });
    assert.strictEqual(calls.length, 0);
  });

  it("queues a track once however often it starts", async () => {
    const { voice, calls } = setup({ playbacks: { g1: { track: trackOf("abc"), node: {} } } });
    await voice.onChange({ guildId: "g1", reason: "trackStart" });
    await voice.onChange({ guildId: "g1", reason: "trackStart" });
    assert.strictEqual(calls.length, 1);
  });

  it("tries a track again on its next start when the charting did not finish", async () => {
    const { voice, calls } = setup({ playbacks: { g1: { track: trackOf("abc"), node: {} } }, result: { status: "pending" } });
    await voice.onChange({ guildId: "g1", reason: "trackStart" });
    await voice.onChange({ guildId: "g1", reason: "trackStart" });
    assert.strictEqual(calls.length, 2);
  });

  it("tries again after a failure and does not throw", async () => {
    const { voice, calls } = setup({ playbacks: { g1: { track: trackOf("abc"), node: {} } }, result: new Error("boom") });
    assert.strictEqual(await voice.onChange({ guildId: "g1", reason: "trackStart" }), null);
    await voice.onChange({ guildId: "g1", reason: "trackStart" });
    assert.strictEqual(calls.length, 2);
  });

  it("skips streams, tracks over ten minutes and an empty player", async () => {
    const { voice, calls } = setup({
      playbacks: {
        stream: { track: trackOf("live", 0, { isStream: true }), node: {} },
        long: { track: trackOf("mix", 10 * 60_000 + 1), node: {} },
        edge: { track: trackOf("edge", 10 * 60_000), node: {} },
      },
    });
    await voice.onChange({ guildId: "stream", reason: "trackStart" });
    await voice.onChange({ guildId: "long", reason: "trackStart" });
    await voice.onChange({ guildId: "empty", reason: "trackStart" });
    assert.strictEqual(calls.length, 0);
    await voice.onChange({ guildId: "edge", reason: "trackStart" });
    assert.deepStrictEqual(calls.map((call) => call.identifier), ["edge"], "exactly ten minutes is still charted");
  });

  it("listens for the Activity state changes between start() and stop()", async () => {
    const { voice, events, calls } = setup({ playbacks: { g1: { track: trackOf("abc"), node: {} } } });
    assert.strictEqual(events.listenerCount("change"), 0);
    voice.start();
    voice.start();
    assert.strictEqual(events.listenerCount("change"), 1);
    events.emit("change", { guildId: "g1", reason: "trackStart", revision: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(calls.length, 1);
    voice.stop();
    assert.strictEqual(events.listenerCount("change"), 0);
  });
});
