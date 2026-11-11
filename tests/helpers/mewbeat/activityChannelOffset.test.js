const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");

const LIVE_KEY = "youtube:abc:200000";
const SOLO_KEY = "spotify:xyz:180000";
const live = { info: { sourceName: "youtube", identifier: "abc", length: 200000 } };
const solo = { track: "enc", info: { sourceName: "spotify", identifier: "xyz", length: 180000 } };

function setup({ audioOffset, withDependency = true } = {}) {
  const soloTracks = createSoloTracks();
  soloTracks.put(SOLO_KEY, { track: solo, node: "n2" });
  const charts = { easy: { id: "e" }, normal: { id: "n", notes: [{ t: 1000 }] }, hard: { id: "h" }, hell: { id: "x" } };
  const options = {
    readPlayback: () => ({ track: { info: live.info }, node: "n1", positionMs: 0, paused: false, durationMs: 200000 }),
    chartStore: { getCharts: async () => ({ status: "ready", charts }) },
    soloTracks,
    log: { warning() {} },
  };
  if (withDependency) options.audioOffset = audioOffset;
  return { channel: createMewbeatChannel(options), charts };
}

const ask = (channel, audioKey, difficulty = "normal") => channel.handle("g", "u", { type: "mewbeat_chart", audioKey, difficulty });

describe("mewbeat chart reply: audioOffsetMs", () => {
  it("carries the song's offset next to the chart, signed as measured", async () => {
    const asked = [];
    const { channel, charts } = setup({ audioOffset: { lookup: async (key) => { asked.push(key); return -40; } } });
    const reply = await ask(channel, SOLO_KEY);
    assert.strictEqual(reply.status, "ready");
    assert.strictEqual(reply.audioOffsetMs, -40);
    assert.deepStrictEqual(asked, [SOLO_KEY]);
    assert.strictEqual(reply.chart, charts.normal, "the chart itself is the stored one, untouched");
    assert.ok(!("audioOffsetMs" in reply.chart));
  });

  it("is null when the offset is unknown, and zero stays zero", async () => {
    assert.strictEqual((await ask(setup({ audioOffset: { lookup: async () => null } }).channel, SOLO_KEY)).audioOffsetMs, null);
    assert.strictEqual((await ask(setup({ audioOffset: { lookup: async () => 0 } }).channel, SOLO_KEY)).audioOffsetMs, 0);
  });

  it("is null when the lookup fails or answers something that is not a number", async () => {
    assert.strictEqual((await ask(setup({ audioOffset: { lookup: async () => { throw new Error("boom"); } } }).channel, SOLO_KEY)).audioOffsetMs, null);
    assert.strictEqual((await ask(setup({ audioOffset: { lookup: async () => "20" } }).channel, SOLO_KEY)).audioOffsetMs, null);
    assert.strictEqual((await ask(setup({ audioOffset: { lookup: async () => NaN } }).channel, SOLO_KEY)).audioOffsetMs, null);
  });

  it("is absent for a live song (it plays through Discord, no stored audio)", async () => {
    let asked = false;
    const { channel } = setup({ audioOffset: { lookup: async () => { asked = true; return 20; } } });
    const reply = await ask(channel, LIVE_KEY);
    assert.strictEqual(reply.status, "ready");
    assert.ok(!("audioOffsetMs" in reply));
    assert.strictEqual(asked, false);
  });

  it("is absent without the dependency, so the reply is exactly what it was before", async () => {
    const reply = await ask(setup({ withDependency: false }).channel, SOLO_KEY);
    assert.strictEqual(reply.status, "ready");
    assert.ok(!("audioOffsetMs" in reply));
  });

  it("is absent on replies that are not ready", async () => {
    const soloTracks = createSoloTracks();
    soloTracks.put(SOLO_KEY, { track: solo, node: "n2" });
    const channel = createMewbeatChannel({
      readPlayback: () => null,
      chartStore: { getCharts: async () => ({ status: "uncharted", reason: "too_few_notes" }) },
      soloTracks,
      audioOffset: { lookup: async () => 20 },
      log: { warning() {} },
    });
    const reply = await ask(channel, SOLO_KEY);
    assert.strictEqual(reply.status, "uncharted");
    assert.ok(!("audioOffsetMs" in reply));
  });
});
