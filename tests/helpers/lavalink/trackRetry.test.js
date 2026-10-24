const assert = require("node:assert/strict");
const test = require("node:test");

const {
  planTrackRetry,
  holdQueueForRecovery,
  releaseHeldQueue,
  consumeReplay,
  replayFailedTrack,
} = require("../../../helpers/lavalink/trackRetry");

const suspicious = { exception: { severity: "suspicious", message: "All clients failed" } };
const song = (extra = {}) => ({ track: "wind-encoded", info: { title: "Wind", length: 240_000, isSeekable: true }, ...extra });

test("a mid-song failure is replayed from where it stopped before anything else", () => {
  const track = song();

  assert.deepEqual(planTrackRetry(track, 5_000, suspicious), { attempt: 1, delayMs: 1_000, resumeAt: 5_000 });
  assert.deepEqual(planTrackRetry(track, 5_000, suspicious), { attempt: 2, delayMs: 3_000, resumeAt: 5_000 });
  assert.equal(planTrackRetry(track, 5_000, suspicious), null, "the same spot twice hands over to the mirror");
});

test("a replay that got further earns a fresh retry budget, up to a hard cap", () => {
  const track = song();

  planTrackRetry(track, 5_000, suspicious);
  planTrackRetry(track, 5_000, suspicious);
  assert.equal(planTrackRetry(track, 60_000, suspicious)?.delayMs, 1_000);

  for (let position = 90_000; position < 240_000; position += 30_000) planTrackRetry(track, position, suspicious);
  assert.equal(planTrackRetry(track, 239_000, suspicious), null);
});

test("permanent refusals and unseekable media skip the replay or restart it", () => {
  assert.equal(planTrackRetry(song(), 5_000, { exception: { severity: "common" } }), null);
  assert.equal(planTrackRetry({ info: { title: "unresolved" } }, 5_000, suspicious), null);
  assert.equal(planTrackRetry(song({ info: { title: "Radio", isStream: true } }), 5_000, suspicious).resumeAt, 0);
  assert.equal(planTrackRetry(song(), 238_000, suspicious).resumeAt, 0, "no point resuming into the last seconds");
});

test("the held queue hides songs from Poru's auto-advance and returns them in order", () => {
  const player = { guildId: "hold-order", queue: ["next", "after"] };

  holdQueueForRecovery(player);
  assert.equal(player.queue.length, 0, "Poru's TrackEnd must see an empty queue");

  player.queue.push("added-during-recovery");
  assert.equal(releaseHeldQueue(player), true);
  assert.deepEqual(player.queue, ["next", "after", "added-during-recovery"]);
  assert.equal(releaseHeldQueue(player), false, "releasing twice must not duplicate songs");
});

test("an empty queue is never held", () => {
  const player = { guildId: "hold-empty", queue: [] };

  holdQueueForRecovery(player);
  assert.equal(releaseHeldQueue(player), false);
});

test("the replay arms the start watchdog before asking Lavalink to resume", async () => {
  const calls = [];
  const track = song();
  const player = {
    guildId: "replay-resume",
    currentTrack: track,
    isPlaying: false,
    node: { rest: { updatePlayer: async (payload) => calls.push(["update", payload]) } },
  };

  const replayed = await replayFailedTrack(player, track, { delayMs: 1_000, resumeAt: 5_000 }, {
    wait: async (ms) => calls.push(["wait", ms]),
    isCurrent: () => true,
    beforeStart: () => calls.push(["watchdog"]),
  });

  assert.equal(replayed, true);
  assert.deepEqual(calls, [
    ["wait", 1_000],
    ["watchdog"],
    ["update", { guildId: "replay-resume", data: { track: { encoded: "wind-encoded" }, position: 5_000 } }],
  ]);
  assert.equal(player.isPlaying, true);
  assert.equal(player.position, 5_000);
  assert.deepEqual(consumeReplay(track), { resumeAt: 5_000 });
  assert.equal(consumeReplay(track), null, "a later loop of the song counts as a new play");
});

test("a replay is abandoned when the listeners moved on during the wait", async () => {
  const track = song();
  let requested = false;
  const player = { guildId: "replay-abandoned", node: { rest: { updatePlayer: async () => (requested = true) } } };

  const replayed = await replayFailedTrack(player, track, { delayMs: 1_000, resumeAt: 0 }, {
    wait: async () => {},
    isCurrent: () => false,
  });

  assert.equal(replayed, false);
  assert.equal(requested, false);
});

test("a provider error replays the same song instead of moving on to the next one", async () => {
  process.env.LAVALINK_PASSWORD ||= "test";
  const { createPoru } = require("../../../helpers/lavalink/client");
  const fakeClient = { user: { id: "1" }, channels: { fetch: async () => null }, on: () => {}, once: () => {} };
  const poru = createPoru(fakeClient);

  const failed = song();
  const next = song({ track: "next-encoded", info: { title: "Next" } });
  const updates = [];
  const player = {
    guildId: "replay-flow",
    textChannel: "text",
    currentTrack: failed,
    isPlaying: false,
    position: 41_000,
    queue: [next],
    poru: { resolve: async () => ({ tracks: [] }) },
    node: { rest: { updatePlayer: async (payload) => updates.push(payload) } },
  };
  poru.players.set(player.guildId, player);

  try {
    const pending = poru.listeners("trackError")[0](player, failed, suspicious);
    assert.equal(player.queue.length, 0, "Poru's auto-advance must not see the next song");
    await pending;

    assert.deepEqual(updates, [
      { guildId: "replay-flow", data: { track: { encoded: "wind-encoded" }, position: 41_000 } },
    ]);
    assert.equal(player.currentTrack, failed);
    assert.deepEqual(player.queue, [next], "the next song waits its turn");
  } finally {
    poru.players.delete(player.guildId);
    require("../../../helpers/lavalink/startWatchdog").clearTrackStartWatchdog(player.guildId, "test");
  }
});
