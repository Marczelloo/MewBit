const assert = require("node:assert");
const { describe, it } = require("node:test");

const { TOUR_SONGS, createTourSongs } = require("../../../helpers/mewbeat/tourSongs");
const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");

const SONGS = {
  heavy: { query: "heavy song", level: "hell" },
  calm: { query: "calm song", level: "normal" },
};

const trackOf = (id) => ({ info: { sourceName: "youtube", identifier: id, length: 100_000, title: `T ${id}`, author: "A", uri: `https://y/${id}` } });

// A manual clock: setTimer queues a run, tick() fires the oldest, so each wait of the loop is stepped by hand.
function setup({ resolve, charts, warm, soloTracks = createSoloTracks() } = {}) {
  const timers = [];
  const log = { info: () => {}, warning: (...args) => log.warned.push(args), warned: [] };
  const resolved = [];
  const warmed = [];
  const tourSongs = createTourSongs({
    resolveTrack: async (_guildId, { uri }) => {
      resolved.push(uri);
      return (resolve ?? (async (query) => ({ track: trackOf(query.split(" ")[0]), node: "n", info: null })))(uri);
    },
    soloTracks,
    chartStore: { getCharts: charts ?? (async () => ({ status: "ready", charts: {} })) },
    warmAudio: warm ?? (async (audioKey) => { warmed.push(audioKey); }),
    songs: SONGS,
    setTimer: (run, ms) => {
      const timer = { run, ms, fired: false, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    log,
  });
  const live = () => timers.filter((timer) => !timer.fired && !timer.cleared);
  // Lets the loop reach its next wait, then fires that wait.
  async function tick() {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    const timer = live()[0];
    assert.ok(timer, "the loop is waiting for a timer");
    timer.fired = true;
    timer.run();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    return timer;
  }
  async function settle() {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  }
  return { tourSongs, soloTracks, timers, live, tick, settle, resolved, warmed, log };
}

describe("tour songs", () => {
  it("names the two songs, with their search texts and levels, in one place", () => {
    assert.ok(TOUR_SONGS.heavy.query && TOUR_SONGS.calm.query);
    assert.strictEqual(TOUR_SONGS.heavy.level, "hell");
    assert.strictEqual(TOUR_SONGS.calm.level, "normal");
  });

  it("starts no timer and does nothing before start()", async () => {
    const { tourSongs, timers, resolved } = setup();
    await Promise.resolve();
    assert.strictEqual(timers.length, 0);
    assert.strictEqual(resolved.length, 0);
    assert.strictEqual(tourSongs.state(), null);
  });

  it("resolves, registers, charts and renders both songs, one at a time, then reports them", async () => {
    const { tourSongs, soloTracks, settle, resolved, warmed, live } = setup();
    tourSongs.start();
    await settle();
    assert.deepStrictEqual(resolved, ["heavy song", "calm song"]);
    assert.deepStrictEqual(warmed, ["youtube:heavy:100000", "youtube:calm:100000"]);
    assert.ok(soloTracks.get("youtube:heavy:100000"));
    assert.ok(soloTracks.get("youtube:calm:100000"));
    const state = tourSongs.state();
    assert.strictEqual(state.heavy.audioKey, "youtube:heavy:100000");
    assert.strictEqual(state.heavy.chartReady, true);
    assert.deepStrictEqual(state.calm.track, { title: "T calm", artist: "A", durationMs: 100_000, artworkUrl: null, uri: "https://y/calm", source: "youtube" });
    assert.strictEqual(live().length, 1); // the next refresh is waiting
    tourSongs.stop();
  });

  it("start() twice runs one loop", async () => {
    const { tourSongs, settle, resolved } = setup();
    tourSongs.start();
    tourSongs.start();
    await settle();
    assert.strictEqual(resolved.length, 2);
    tourSongs.stop();
  });

  it("Lavalink not ready at first, then ready", async () => {
    let ready = false;
    const { tourSongs, settle, tick, resolved } = setup({
      resolve: async (query) => {
        if (!ready) throw Object.assign(new Error("no node"), { statusCode: 503 });
        return { track: trackOf(query.split(" ")[0]), node: "n", info: null };
      },
    });
    tourSongs.start();
    await settle();
    assert.strictEqual(tourSongs.state(), null);
    assert.deepStrictEqual(resolved, ["heavy song"]); // the second would meet the same wall
    ready = true;
    const waited = await tick();
    assert.strictEqual(waited.ms, 30_000);
    await settle();
    assert.ok(tourSongs.state());
    tourSongs.stop();
  });

  it("one song fails, the other is still warm; the failure is logged and tried again", async () => {
    let calmFound = false;
    const { tourSongs, soloTracks, settle, tick, log } = setup({
      resolve: async (query) => {
        if (query === "calm song" && !calmFound) return { track: null };
        return { track: trackOf(query.split(" ")[0]), node: "n", info: null };
      },
    });
    tourSongs.start();
    await settle();
    assert.ok(soloTracks.get("youtube:heavy:100000")); // the first is warm and stays registered
    assert.strictEqual(tourSongs.state(), null); // but the tour is told both or nothing
    assert.strictEqual(log.warned.length, 1);
    calmFound = true;
    const waited = await tick();
    assert.strictEqual(waited.ms, 5 * 60_000);
    await settle();
    assert.ok(tourSongs.state());
    tourSongs.stop();
  });

  it("keeps the last resolve when a later one fails", async () => {
    let fail = false;
    const { tourSongs, settle, tick } = setup({
      resolve: async (query) => {
        if (fail) throw new Error("search down");
        return { track: trackOf(query.split(" ")[0]), node: "n", info: null };
      },
    });
    tourSongs.start();
    await settle();
    fail = true;
    const waited = await tick(); // the refresh
    assert.strictEqual(waited.ms, 4 * 3600e3);
    await settle();
    assert.ok(tourSongs.state()); // still warm from the earlier resolve
    tourSongs.stop();
  });

  it("waits for a pending chart and gives up on a failed one", async () => {
    let calls = 0;
    const { tourSongs, settle, tick } = setup({
      charts: async () => {
        calls += 1;
        return calls === 1 ? { status: "pending" } : { status: "ready", charts: {} };
      },
    });
    tourSongs.start();
    await settle();
    assert.strictEqual(tourSongs.state(), null);
    const waited = await tick();
    assert.strictEqual(waited.ms, 5000);
    await settle();
    assert.ok(tourSongs.state());
    tourSongs.stop();

    const failed = setup({ charts: async () => ({ status: "failed", reason: "analysis" }) });
    failed.tourSongs.start();
    await failed.settle();
    assert.strictEqual(failed.tourSongs.state(), null);
    assert.ok(failed.log.warned.length >= 1);
    failed.tourSongs.stop();
  });

  it("puts a song back that soloTracks forgot", async () => {
    let clock = 0;
    const store = createSoloTracks({ ttlMs: 1000, now: () => clock });
    const { tourSongs, settle } = setup({ soloTracks: store });
    tourSongs.start();
    await settle();
    clock = 5000; // past the entries' lifetime
    assert.strictEqual(store.get("youtube:heavy:100000"), null);
    assert.ok(tourSongs.state());
    assert.ok(store.get("youtube:heavy:100000"));
    assert.ok(store.get("youtube:calm:100000"));
    tourSongs.stop();
  });

  it("stop() clears the pending timer and ends the loop", async () => {
    const { tourSongs, settle, live, timers } = setup();
    const running = tourSongs.start();
    await settle();
    assert.strictEqual(live().length, 1);
    tourSongs.stop();
    await running;
    assert.strictEqual(live().length, 0);
    assert.ok(timers.every((timer) => timer.cleared || timer.fired));
  });
});
