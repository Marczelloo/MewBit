const assert = require("node:assert");
const { describe, it } = require("node:test");

const { describeSocketClose, evaluateFrameStats, startStreamHealthMonitor } = require("../../../helpers/lavalink/streamHealth");

describe("Lavalink stream health", () => {
  it("flags dropped audio frames above the noise floor", () => {
    const report = evaluateFrameStats({ frameStats: { sent: 2900, nulled: 80, deficit: 20 } });
    assert.strictEqual(report.degraded, true);
    assert.ok(report.lossPct > 3);
  });

  it("ignores a handful of lost frames and nodes without players", () => {
    assert.strictEqual(evaluateFrameStats({ frameStats: { sent: 3000, nulled: 3, deficit: 2 } }).degraded, false);
    assert.strictEqual(evaluateFrameStats({ frameStats: null }), null);
  });

  it("reports each stats packet once", () => {
    const node = { name: "main", stats: { uptime: 1000, playingPlayers: 1, frameStats: { sent: 2000, nulled: 200, deficit: 0 } } };
    const monitor = startStreamHealthMonitor({ nodes: new Map([["main", node]]) }, { intervalMs: 60_000 });
    try {
      assert.strictEqual(monitor.check(), 1);
      assert.strictEqual(monitor.check(), 0);
      node.stats = { ...node.stats, uptime: 61_000 };
      assert.strictEqual(monitor.check(), 1);
    } finally {
      monitor.stop();
    }
  });

  it("describes a voice socket close without track details", () => {
    const info = describeSocketClose({ guildId: "g1" }, { code: 4015, reason: "", byRemote: true });
    assert.deepStrictEqual(info, { guildId: "g1", code: 4015, reason: null, byRemote: true });
  });
});
