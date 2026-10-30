const assert = require("node:assert/strict");
const test = require("node:test");

const autoplayPath = require.resolve("../../../helpers/lavalink/autoplay");
const v3Path = require.resolve("../../../helpers/lavalink/autoplayV3");
const exposurePath = require.resolve("../../../helpers/lavalink/autoplayExposure");
const guildStatePath = require.resolve("../../../helpers/guildState");

let fetchImpl = async () => null;
const fetchCalls = [];

function stubModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function loadAutoplay() {
  stubModule(v3Path, {
    fetchAutoplayV3Track: async (reference, guildId, options = {}) => {
      fetchCalls.push({ reference, guildId, options });
      return fetchImpl(reference, options);
    },
  });
  stubModule(exposurePath, { recordAutoplayExposure: async () => {} });
  stubModule(guildStatePath, { getGuildState: () => ({ autoplay: true }) });
  delete require.cache[autoplayPath];
  return require(autoplayPath);
}

function track(title, extra = {}) {
  return { track: `enc-${title}`, info: { title, author: "Artist", identifier: `id-${title}`, length: 200000 }, userData: {}, ...extra };
}

function autoplayPick(title, afterKey) {
  return {
    track: `enc-${title}`,
    info: { title, author: "Artist", identifier: `id-${title}`, length: 200000, autoplayed: true },
    userData: { autoplay: true, autoplayAfterKey: afterKey },
  };
}

function createPlayer(guildId, { queue = [], currentTrack = track("Current"), registry } = {}) {
  const items = [...queue];
  items.add = async (item) => items.push(item);
  const player = {
    guildId,
    voiceChannel: "voice",
    textChannel: "text",
    currentTrack,
    position: 10_000,
    queue: items,
    play: async () => {},
    poru: {
      players: registry,
      client: {
        user: { id: "bot", username: "MewBit" },
        guilds: { cache: { get: () => ({ channels: { cache: { get: () => ({ members: { has: () => true } }) } } }) } },
      },
    },
  };
  registry?.set(guildId, player);
  return player;
}

test.beforeEach(() => {
  fetchCalls.length = 0;
  fetchImpl = async () => null;
});

test("a lookup started for a stopped player neither feeds the new player nor lands in the old queue", async () => {
  const { queueAutoplayTrack, prefetchAutoplayTrack } = loadAutoplay();
  const registry = new Map();
  const oldPlayer = createPlayer("guild-stop", { registry });

  let releaseOld;
  fetchImpl = (reference) => reference.info.title === "Current"
    ? new Promise((resolve) => { releaseOld = () => resolve(track("Old Pick")); })
    : Promise.resolve(track("Fresh Pick"));

  const oldTask = queueAutoplayTrack(oldPlayer, oldPlayer.currentTrack, "text");
  await new Promise((resolve) => setImmediate(resolve));

  // /stop destroys the player and a new song starts on a fresh one.
  registry.delete("guild-stop");
  const newPlayer = createPlayer("guild-stop", { registry, currentTrack: track("KICK BACK") });
  const added = await prefetchAutoplayTrack(newPlayer, newPlayer.currentTrack, "text");

  assert.equal(added, true);
  assert.deepEqual(newPlayer.queue.map((item) => item.info.title), ["Fresh Pick"]);

  releaseOld();
  assert.equal(await oldTask, false);
  assert.equal(oldPlayer.queue.length, 0);
});

test("prefetch never queues a second pick behind a waiting one", async () => {
  const { prefetchAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Second Pick");
  const current = track("Manual Song");
  const player = createPlayer("guild-double", {
    currentTrack: current,
    queue: [autoplayPick("First Pick", "id-Manual Song")],
  });

  assert.equal(await prefetchAutoplayTrack(player, current, "text"), false);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(player.queue.map((item) => item.info.title), ["First Pick"]);
});

test("picks remember the track they were chosen to follow", async () => {
  const { prefetchAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Next");
  const current = track("Now");
  const player = createPlayer("guild-key", { currentTrack: current, queue: [track("Queued")] });

  await prefetchAutoplayTrack(player, current, "text");
  assert.equal(player.queue.at(-1).userData.autoplayAfterKey, "id-Queued");
});

test("a manual add re-picks the waiting pick for the newly queued track", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Better Pick");
  const manual = track("Added Song");
  const later = track("Another Added");
  const player = createPlayer("guild-refresh", {
    queue: [manual, later, autoplayPick("Old Pick", "id-Current"), autoplayPick("Chained Pick", "id-Old Pick")],
  });

  assert.equal(await refreshQueuedAutoplayTrack(player), true);
  assert.equal(fetchCalls[0].reference, later);
  assert.deepEqual(fetchCalls[0].options.pendingManualTracks.map((item) => item.info.title), ["Added Song"]);
  assert.equal(fetchCalls[0].options.selectionIntent.mode, "refresh");
  assert.deepEqual(player.queue.map((item) => item.info.title), ["Added Song", "Another Added", "Better Pick"]);
  assert.equal(player.queue[2].userData.autoplayAfterKey, "id-Another Added");
  assert.equal(player.queue[2].info.autoplayed, true);
});

test("a re-pick knows the playing track and the queue, but may keep the pick it replaces", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Better Pick");
  const added = track("IRIS OUT");
  const stale = autoplayPick("Otonoke", "id-KICK BACK");
  const player = createPlayer("guild-refresh-live", { currentTrack: track("KICK BACK"), queue: [added, stale] });

  assert.equal(await refreshQueuedAutoplayTrack(player), true);
  assert.deepEqual(fetchCalls[0].options.liveTracks.map((item) => item.info.title), ["KICK BACK", "IRIS OUT"]);
});

test("refresh leaves a pick alone when it still follows the right track", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  const fitting = createPlayer("guild-fit", { queue: [autoplayPick("Pick", "id-Current")] });
  assert.equal(await refreshQueuedAutoplayTrack(fitting), false);
  assert.equal(fetchCalls.length, 0);

  const legacy = createPlayer("guild-legacy", { queue: [track("Manual"), autoplayPick("Legacy", undefined)] });
  assert.equal(await refreshQueuedAutoplayTrack(legacy), false);

});

test("a failed re-pick drops a stale pick that is not up next, chain included", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => null;
  const failing = createPlayer("guild-fail", {
    queue: [track("Manual"), autoplayPick("Stale", "id-Current"), autoplayPick("Chained", "id-Stale")],
  });
  assert.equal(await refreshQueuedAutoplayTrack(failing), false);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(failing.queue.map((item) => item.info.title), ["Manual"]);
});

test("a crashed re-pick is handled like a failed one", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => { throw new Error("provider down"); };
  const failing = createPlayer("guild-crash", { queue: [track("Manual"), autoplayPick("Stale", "id-Current")] });
  assert.equal(await refreshQueuedAutoplayTrack(failing), false);
  assert.deepEqual(failing.queue.map((item) => item.info.title), ["Manual"]);
});

test("a pick up next gets one quick retry and is kept only when that fails too", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  let attempts = 0;
  fetchImpl = async () => (attempts++ === 0 ? null : track("Retry Pick"));
  const retried = createPlayer("guild-retry", { queue: [autoplayPick("Stale", "id-Earlier")] });
  assert.equal(await refreshQueuedAutoplayTrack(retried), true);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].options.aiTimeoutMs, null);
  assert.deepEqual(retried.queue.map((item) => item.info.title), ["Retry Pick"]);

  fetchCalls.length = 0;
  fetchImpl = async () => null;
  const kept = createPlayer("guild-keep", { queue: [autoplayPick("Kept", "id-Earlier")] });
  assert.equal(await refreshQueuedAutoplayTrack(kept), false);
  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(kept.queue.map((item) => item.info.title), ["Kept"]);
  assert.equal(kept.queue[0].userData.autoplayRefreshing, undefined);
});

test("a stale pick is flagged as refreshing until its re-pick settles", async () => {
  const { refreshQueuedAutoplayTrack, scheduleAutoplayRefresh } = loadAutoplay();
  const stale = autoplayPick("Stale", "id-Current");
  const player = createPlayer("guild-flag", { queue: [track("Manual"), stale] });

  scheduleAutoplayRefresh(player);
  // Flagged as soon as the queue changes, before the debounce runs.
  assert.equal(stale.userData.autoplayRefreshing, true);

  let flaggedDuringLookup = null;
  fetchImpl = async () => {
    flaggedDuringLookup = stale.userData.autoplayRefreshing;
    return track("Fresh");
  };
  assert.equal(await refreshQueuedAutoplayTrack(player), true);
  assert.equal(flaggedDuringLookup, true);
  assert.equal(stale.userData.autoplayRefreshing, undefined);
  assert.equal(player.queue[1].userData.autoplayRefreshing, undefined);
});

test("a refresh with nothing to re-pick clears a leftover flag", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  const pick = autoplayPick("Pick", "id-Current");
  pick.userData.autoplayRefreshing = true;
  const player = createPlayer("guild-clear", { queue: [pick] });
  assert.equal(await refreshQueuedAutoplayTrack(player), false);
  assert.equal(pick.userData.autoplayRefreshing, undefined);
});

test("a prefetch gives the AI DJ the queue's runway; a queue-end pick keeps the short budget", async () => {
  const { prefetchAutoplayTrack, queueAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Next");
  const current = track("Now");
  const player = createPlayer("guild-budget", { currentTrack: current });
  player.position = 20_000;

  await prefetchAutoplayTrack(player, current, "text");
  // 180 s left minus the reserve is far above the ceiling.
  assert.equal(fetchCalls[0].options.aiTimeoutMs, 28_000);

  fetchCalls.length = 0;
  const ended = createPlayer("guild-end", { currentTrack: null });
  await queueAutoplayTrack(ended, current, "text");
  assert.equal(fetchCalls[0].options.aiTimeoutMs, null);
});

test("a prefetch near the end of a short track falls back to the default budget", async () => {
  const { prefetchAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Next");
  const current = track("Short", { info: { title: "Short", author: "Artist", identifier: "id-Short", length: 30_000 } });
  const player = createPlayer("guild-short", { currentTrack: current });
  player.position = 0;

  await prefetchAutoplayTrack(player, current, "text");
  assert.equal(fetchCalls[0].options.aiTimeoutMs, 12_000);
});

test("refresh does not race a pick that is about to play", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  fetchImpl = async () => track("Late");
  const player = createPlayer("guild-late", { queue: [autoplayPick("Pick", "id-Earlier")] });
  player.position = 190_000;

  assert.equal(await refreshQueuedAutoplayTrack(player), false);
  assert.equal(fetchCalls.length, 0);
});

test("refresh drops its result when the pick was removed during the lookup", async () => {
  const { refreshQueuedAutoplayTrack } = loadAutoplay();
  const manual = track("Manual");
  const player = createPlayer("guild-gone", { queue: [manual, autoplayPick("Pick", "id-Current")] });
  fetchImpl = async () => {
    player.queue.splice(1, 1);
    return track("Replacement");
  };

  assert.equal(await refreshQueuedAutoplayTrack(player), false);
  assert.deepEqual(player.queue.map((item) => item.info.title), ["Manual"]);
});
