const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");

const NOW = 1_700_000_000_000;
const trackOf = (identifier, extra = {}) => ({ track: `enc-${identifier}`, info: { sourceName: "youtube", identifier, length: 180000, title: `Song ${identifier}`, author: "Band", uri: `https://youtu.be/${identifier}`, ...extra } });
const keyOf = (identifier) => `youtube:${identifier}:180000`;
const STARS = { easy: { stars: 1.2, notes: 100 }, normal: { stars: 2.4, notes: 200 }, hard: { stars: 3.6, notes: 300 }, hell: { stars: 4.8, notes: 400 } };

// A chart store whose charting waits until the test settles it.
function setup({ maps = {}, perPlayerClock = NOW } = {}) {
  const peeked = new Map(); // identifier -> peekCharts result
  const queues = new Map(); // identifier -> what queueOf answers
  const getCalls = [];
  const settlers = [];
  let clock = perPlayerClock;
  const chartStore = {
    getCharts: (track, node, options) => new Promise((resolve) => {
      getCalls.push({ identifier: track.info.identifier, node, options });
      settlers.push((result) => resolve(result));
    }),
    peekCharts: (track) => peeked.get(track.info.identifier) ?? null,
    queueOf: (track) => queues.get(track.info.identifier) ?? null,
    summaryReader: () => (track) => (peeked.get(track.info.identifier)?.status === "ready" ? STARS : null),
  };
  const resolveTrack = async (_guildId, query) => {
    const identifier = query.uri.split("/").pop();
    if (identifier === "unknown") return null;
    return { track: trackOf(identifier), node: "node-1" };
  };
  const channel = createMewbeatChannel({
    readPlayback: () => null,
    chartStore,
    resolveTrack,
    soloTracks: createSoloTracks(),
    now: () => clock,
    log: { warning() {} },
  });
  const ask = (userId, identifier, extra = {}) => channel.handle("g", userId, { type: "mewbeat_chart_map", id: `m-${identifier}`, uri: `https://youtu.be/${identifier}`, source: "youtube", ...extra });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return { channel, ask, peeked, queues, getCalls, settlers, tick, advance: (ms) => { clock += ms; } };
}

describe("mewbeat chart this map", () => {
  it("queues a song without charts as background work and answers queued", async () => {
    const { ask, getCalls, tick } = setup();
    const reply = await ask("u", "a");
    assert.deepStrictEqual(reply, { type: "mewbeat_chart_map", id: "m-a", status: "ok", state: "queued", audioKey: keyOf("a") });
    await tick();
    assert.deepStrictEqual(getCalls, [{ identifier: "a", node: "node-1", options: { priority: "background", retry: false } }]);
  });

  it("tells where the song stands in line on every queued answer, and leaves the key out when nothing is pending", async () => {
    const { ask, queues, tick } = setup();
    const first = await ask("u", "a");
    assert.strictEqual("queue" in first, false);
    await tick();
    queues.set("a", { step: "analysis", ahead: 2, running: false });
    const behind = await ask("u", "a");
    assert.strictEqual(behind.state, "queued");
    assert.deepStrictEqual(behind.queue, { step: "analysis", ahead: 2, running: false });
    queues.set("a", { step: "charts", ahead: 0, running: true });
    assert.deepStrictEqual((await ask("u", "a")).queue, { step: "charts", ahead: 0, running: true });
    queues.delete("a");
    assert.strictEqual("queue" in (await ask("u", "a")), false);
  });

  it("does not add a queue to a ready answer", async () => {
    const { ask, peeked, queues } = setup();
    peeked.set("a", { status: "ready" });
    queues.set("a", { step: "charts", ahead: 0, running: true });
    assert.strictEqual("queue" in (await ask("u", "a")), false);
  });

  it("is idempotent: asking again while it runs queues nothing new, and it answers ready with the stats once charted", async () => {
    const { ask, getCalls, settlers, peeked, tick } = setup();
    await ask("u", "a");
    const again = await ask("u", "a");
    assert.strictEqual(again.state, "queued");
    await tick();
    assert.strictEqual(getCalls.length, 1);

    peeked.set("a", { status: "ready" });
    settlers[0]({ status: "ready", charts: {} });
    await tick();
    const ready = await ask("u", "a");
    assert.strictEqual(ready.state, "ready");
    assert.strictEqual(ready.audioKey, keyOf("a"));
    assert.strictEqual(ready.stats.hard.stars, 3.6);
    assert.strictEqual(ready.stats.easy.notes, 100);
    assert.strictEqual(getCalls.length, 1, "a ready song is not charted again");
  });

  it("answers ready at once for a song that already has charts", async () => {
    const { ask, getCalls, peeked } = setup();
    peeked.set("a", { status: "ready" });
    const reply = await ask("u", "a");
    assert.strictEqual(reply.state, "ready");
    assert.strictEqual(reply.stats.normal.stars, 2.4);
    assert.strictEqual(getCalls.length, 0);
  });

  it("refuses a fourth map of one player with too_many, while another player may still ask", async () => {
    const { ask } = setup();
    for (const identifier of ["a", "b", "c"]) assert.strictEqual((await ask("u", identifier)).state, "queued");
    const refused = await ask("u", "d");
    assert.deepStrictEqual(refused, { type: "mewbeat_chart_map", id: "m-d", status: "error", reason: "too_many" });
    assert.strictEqual((await ask("other", "d")).state, "queued");
    // A map somebody else queued is shared, and does not need a free place.
    assert.strictEqual((await ask("u", "d")).state, "queued");
    assert.strictEqual((await ask("u", "a")).state, "queued", "asking about a map of one's own again is not a new one");
  });

  it("gives a place back when a map finishes", async () => {
    const { ask, settlers, peeked, tick } = setup();
    for (const identifier of ["a", "b", "c"]) await ask("u", identifier);
    peeked.set("a", { status: "ready" });
    settlers[0]({ status: "ready", charts: {} });
    await tick();
    assert.strictEqual((await ask("u", "d")).state, "queued");
  });

  it("answers not_found for a song nobody can find", async () => {
    const { ask, getCalls } = setup();
    const reply = await ask("u", "unknown");
    assert.deepStrictEqual(reply, { type: "mewbeat_chart_map", id: "m-unknown", status: "error", reason: "not_found" });
    assert.strictEqual(getCalls.length, 0);
  });

  it("answers uncharted for a song that cannot be charted", async () => {
    const { ask, peeked, getCalls } = setup();
    peeked.set("a", { status: "uncharted", reason: "too_long" });
    assert.strictEqual((await ask("u", "a")).reason, "uncharted");
    assert.strictEqual(getCalls.length, 0);
  });

  it("reports a failure on the next poll, and retry:true tries again", async () => {
    const { ask, settlers, getCalls, tick } = setup();
    await ask("u", "a");
    settlers[0]({ status: "failed" });
    await tick();
    const failed = await ask("u", "a");
    assert.deepStrictEqual(failed, { type: "mewbeat_chart_map", id: "m-a", status: "error", reason: "failed" });
    assert.strictEqual((await ask("u", "a")).reason, "failed", "the verdict stays until somebody retries");
    assert.strictEqual(getCalls.length, 1);

    const retried = await ask("u", "a", { retry: true });
    assert.strictEqual(retried.state, "queued");
    await tick();
    assert.strictEqual(getCalls.length, 2);
    assert.strictEqual(getCalls[1].options.retry, true);
  });

  it("says busy when the background line is full", async () => {
    const { ask, settlers, tick } = setup();
    await ask("u", "a");
    settlers[0]({ status: "full" });
    await tick();
    assert.strictEqual((await ask("u", "a")).reason, "busy");
  });

  it("treats a throwing chart store as a failure and does not throw", async () => {
    const channel = createMewbeatChannel({
      readPlayback: () => null,
      chartStore: { getCharts: async () => { throw new Error("disk gone"); }, peekCharts: () => null },
      resolveTrack: async () => ({ track: trackOf("a"), node: "n" }),
      soloTracks: createSoloTracks(),
      now: () => NOW,
      log: { warning() {} },
    });
    const message = { type: "mewbeat_chart_map", id: "m", uri: "https://youtu.be/a", source: "youtube" };
    assert.strictEqual((await channel.handle("g", "u", message)).state, "queued");
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual((await channel.handle("g", "u", message)).reason, "failed");
  });

  it("forgets an old failure after a while so the song can be asked for again", async () => {
    const { ask, settlers, tick, advance, getCalls } = setup();
    await ask("u", "a");
    settlers[0]({ status: "failed" });
    await tick();
    assert.strictEqual((await ask("u", "a")).reason, "failed");
    advance(11 * 60_000);
    assert.strictEqual((await ask("u", "a")).state, "queued");
    await tick();
    assert.strictEqual(getCalls.length, 2);
  });

  it("refuses a request without an id", async () => {
    const { channel } = setup();
    const reply = await channel.handle("g", "u", { type: "mewbeat_chart_map", uri: "https://youtu.be/a" });
    assert.strictEqual(reply.type, "error");
  });
});

describe("mewbeat search results carry stars", () => {
  it("gives each track its audio key and its stars per level when charts exist, else null", () => {
    const { channel, peeked } = setup();
    peeked.set("a", { status: "ready" });
    const info = channel.chartInfoOf([trackOf("a"), trackOf("b"), { info: { sourceName: "youtube", identifier: "live", length: 0, isStream: true } }]);
    assert.deepStrictEqual(info, [
      { audioKey: keyOf("a"), stars: { easy: 1.2, normal: 2.4, hard: 3.6, hell: 4.8 } },
      { audioKey: keyOf("b"), stars: null },
      { audioKey: null, stars: null },
    ]);
  });
});
