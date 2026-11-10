const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");

const NOW = 1_700_000_000_000;
const KEY = "youtube:abc:200000";

function fakeTrack(info) {
  return { info: { sourceName: "youtube", identifier: "abc", length: 200000, ...info } };
}

function setup({ playback, result } = {}) {
  const calls = [];
  const charts = { easy: { id: "e" }, normal: { id: "n" }, hard: { id: "h", notes: [1, 2] } };
  const channel = createMewbeatChannel({
    readPlayback: () => (playback === undefined
      ? { track: fakeTrack(), node: "node-1", positionMs: 61234.4, paused: false, durationMs: 200000 }
      : playback),
    chartStore: {
      getCharts: async (track, node, options) => {
        calls.push({ track, node, options });
        return result ?? { status: "ready", charts };
      },
    },
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

  it("echoes a request id on the chart reply, ready or stale, and only a sane one", async () => {
    const { channel } = setup();
    const ready = await channel.handle("g", "u", { type: "mewbeat_chart", id: "r7", audioKey: KEY, difficulty: "hard" });
    assert.strictEqual(ready.id, "r7");
    assert.strictEqual(ready.status, "ready");
    const stale = await channel.handle("g", "u", { type: "mewbeat_chart", id: "r8", audioKey: "youtube:other:1", difficulty: "hard" });
    assert.strictEqual(stale.id, "r8");
    for (const id of [undefined, "", 5, "x".repeat(41)]) {
      const reply = await channel.handle("g", "u", { type: "mewbeat_chart", id, audioKey: KEY, difficulty: "hard" });
      assert.strictEqual("id" in reply, false);
    }
  });

  it("passes an explicit retry on, and only an explicit one", async () => {
    const { channel, calls } = setup();
    await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "hard" });
    await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "hard", retry: "yes" });
    await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "hard", retry: true });
    assert.deepStrictEqual(calls.map((call) => call.options.retry), [false, false, true]);
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
    });
    await assert.rejects(channel.handle("g", "u", { type: "mewbeat_chart", audioKey: KEY, difficulty: "easy" }), /disk gone/);
  });
  describe("solo prepare", () => {
    const SOLO_KEY = "spotify:xyz:180000";
    const soloTrack = { track: "encoded", info: { sourceName: "spotify", identifier: "xyz", length: 180000, title: "Song", author: "Band", uri: "https://open.spotify.com/track/xyz", artworkUrl: "https://img/a.jpg" } };

    function soloSetup({ resolved = { track: soloTrack, node: "node-2" }, playback, peekCharts } = {}) {
      const soloTracks = createSoloTracks();
      const resolveCalls = [];
      const chartCalls = [];
      const channel = createMewbeatChannel({
        readPlayback: () => (playback === undefined
          ? { track: fakeTrack(), node: "node-1", positionMs: 0, paused: false, durationMs: 200000 }
          : playback),
        chartStore: {
          getCharts: async (track, node) => {
            chartCalls.push({ track, node });
            return { status: "ready", charts: { easy: { id: "e" }, normal: { id: "n" }, hard: { id: "h" }, hell: { id: "x" } } };
          },
          peekCharts,
        },
        resolveTrack: async (guildId, query) => { resolveCalls.push({ guildId, ...query }); return resolved; },
        soloTracks,
        log: { warning() {} },
      });
      return { channel, soloTracks, resolveCalls, chartCalls };
    }

    it("a preview registers the song without charting it", async () => {
      const { channel, soloTracks, chartCalls } = soloSetup();
      const reply = await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", uri: "https://open.spotify.com/track/xyz", source: "spotify", preview: true });
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(soloTracks.get(SOLO_KEY).node, "node-2");
      assert.deepStrictEqual(chartCalls, []);
    });

    it("prepare replies with the highlight of charts that already exist", async () => {
      const charts = { easy: { highlightMs: 42000 }, normal: { highlightMs: 42000 }, hard: { highlightMs: 42000 }, hell: { highlightMs: 42000 } };
      const { channel } = soloSetup({ peekCharts: () => ({ status: "ready", charts }) });
      const reply = await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", uri: "https://open.spotify.com/track/xyz", source: "spotify", preview: true });
      assert.strictEqual(reply.highlightMs, 42000);
    });

    it("resolves the song, registers it and starts charting", async () => {
      const { channel, soloTracks, resolveCalls, chartCalls } = soloSetup();
      const reply = await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", uri: "https://open.spotify.com/track/xyz", source: "spotify" });
      assert.deepStrictEqual(reply, {
        type: "mewbeat_solo_prepare",
        id: "p1",
        status: "ok",
        audioKey: SOLO_KEY,
        track: { title: "Song", artist: "Band", durationMs: 180000, artworkUrl: "https://img/a.jpg", uri: "https://open.spotify.com/track/xyz", source: "spotify" },
        highlightMs: null,
      });
      assert.deepStrictEqual(resolveCalls, [{ guildId: "g", uri: "https://open.spotify.com/track/xyz", source: "spotify" }]);
      assert.strictEqual(soloTracks.get(SOLO_KEY).node, "node-2");
      assert.deepStrictEqual(chartCalls, [{ track: soloTrack, node: "node-2" }]);
    });


    it("answers an error when nothing resolves", async () => {
      const { channel, soloTracks } = soloSetup({ resolved: null });
      const reply = await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", uri: "nothing", source: "youtube" });
      assert.deepStrictEqual(reply, { type: "mewbeat_solo_prepare", id: "p1", status: "error", reason: "not_found" });
      assert.strictEqual(soloTracks.get(SOLO_KEY), null);
    });

    it("rejects a bad uri or source", async () => {
      const { channel, resolveCalls } = soloSetup();
      for (const bad of [{ uri: 5 }, { uri: "" }, { uri: "x".repeat(1001) }, { uri: "x", source: "y".repeat(41) }, { uri: "x", source: 3 }]) {
        const reply = await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", ...bad });
        assert.strictEqual(reply.status, "error");
      }
      assert.strictEqual(resolveCalls.length, 0);
    });

    it("serves charts for a registered song while the bot plays something else", async () => {
      const { channel, chartCalls } = soloSetup();
      await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", uri: "u", source: "spotify" });
      chartCalls.length = 0;
      const reply = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: SOLO_KEY, difficulty: "hard" });
      assert.deepStrictEqual(reply, { type: "mewbeat_chart", audioKey: SOLO_KEY, difficulty: "hard", status: "ready", chart: { id: "h" } });
      assert.deepStrictEqual(chartCalls, [{ track: soloTrack, node: "node-2" }]);
    });

    it("serves a registered song when nothing plays, and stays stale for unknown keys", async () => {
      const { channel } = soloSetup({ playback: null });
      await channel.handle("g", "u", { type: "mewbeat_solo_prepare", id: "p1", uri: "u", source: "spotify" });
      const known = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: SOLO_KEY, difficulty: "easy" });
      assert.strictEqual(known.status, "ready");
      const unknown = await channel.handle("g", "u", { type: "mewbeat_chart", audioKey: "spotify:other:1", difficulty: "easy" });
      assert.strictEqual(unknown.status, "stale");
    });

    it("accepts a profile and exposes disconnect", async () => {
      const { channel } = soloSetup();
      const reply = await channel.handle("g", "u", { type: "mewbeat_sync", id: "s", clientSentAt: 1 }, { id: "u", username: "U", avatarUrl: null });
      assert.strictEqual(reply.type, "mewbeat_sync");
      assert.strictEqual(channel.disconnect("g", "u"), undefined);
    });
  });

  describe("tour songs", () => {
    const warm = { heavy: { audioKey: "k:h", track: { title: "H" }, chartReady: true }, calm: { audioKey: "k:c", track: { title: "C", uri: "u", source: "youtube" }, chartReady: true } };
    const channelOf = (tourSongs) => createMewbeatChannel({
      readPlayback: () => null,
      chartStore: { getCharts: async () => ({ status: "ready", charts: {} }) },
      now: () => NOW,
      tourSongs,
    });

    it("answers with both songs once the bot has them warm", async () => {
      const reply = await channelOf({ state: () => warm }).handle("g", "u", { type: "mewbeat_tour_songs", id: "t1" });
      assert.deepStrictEqual(reply, { type: "mewbeat_tour_songs", id: "t1", status: "ok", heavy: warm.heavy, calm: warm.calm });
    });

    it("says not_ready while either is still being found, charted or rendered, and when there is no warm-up at all", async () => {
      const waiting = await channelOf({ state: () => null }).handle("g", "u", { type: "mewbeat_tour_songs", id: "t2" });
      assert.deepStrictEqual(waiting, { type: "mewbeat_tour_songs", id: "t2", status: "not_ready" });
      const none = await channelOf(null).handle("g", "u", { type: "mewbeat_tour_songs", id: "t3" });
      assert.deepStrictEqual(none, { type: "mewbeat_tour_songs", id: "t3", status: "not_ready" });
    });

    it("refuses a request without a usable id", async () => {
      const reply = await channelOf({ state: () => warm }).handle("g", "u", { type: "mewbeat_tour_songs" });
      assert.strictEqual(reply.type, "error");
    });
  });
});
