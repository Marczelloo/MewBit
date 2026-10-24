const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizePlayableTrack,
  requiresVerifiedMirror,
  resolveToPlayable,
} = require("../../../helpers/lavalink/autoplayCandidates");
const { withTimeout } = require("../../../helpers/lavalink/resolveTimeout");
const {
  armTrackStartWatchdog,
  clearTrackStartWatchdog,
  getTrackStartWatchdog,
} = require("../../../helpers/lavalink/startWatchdog");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("normalizes raw Lavalink candidate encodings before queueing", async () => {
  const rawTrack = {
    encoded: "encoded-deezer-track",
    info: { title: "Pornography", author: "Travis Scott", length: 239_000 },
  };

  const normalized = normalizePlayableTrack(rawTrack);
  assert.equal(normalized.track, "encoded-deezer-track");
  assert.equal(rawTrack.track, undefined);
  assert.notEqual(normalized.info, rawTrack.info);

  const resolved = await resolveToPlayable(
    {
      artist: "Travis Scott",
      title: "Pornography",
      track: rawTrack,
    },
    "resilience-normalization"
  );
  assert.equal(resolved.track, "encoded-deezer-track");
});

test("keeps Deezer and Spotify candidates on a verified mirror path", () => {
  const deezer = normalizePlayableTrack({
    encoded: "encoded-deezer-track",
    info: { title: "Like That", author: "Future", sourceName: "deezer" },
  });
  const spotify = normalizePlayableTrack({
    encoded: "encoded-spotify-track",
    info: { title: "Like That", author: "Future", sourceName: "spotify" },
  });
  const youtube = normalizePlayableTrack({
    encoded: "encoded-youtube-track",
    info: { title: "Like That", author: "Future", sourceName: "youtube" },
  });

  assert.equal(requiresVerifiedMirror({ source: "deezer" }, deezer), true);
  assert.equal(requiresVerifiedMirror({ source: "spotify" }, spotify), true);
  assert.equal(requiresVerifiedMirror({ source: "youtube" }, youtube), false);
});

test("resolver timeout rejects a stalled provider request", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "test resolver"),
    (error) => error.code === "RESOLVE_TIMEOUT" && /test resolver timed out/.test(error.message)
  );
});

test("track-start watchdog invokes recovery when no TrackStart arrives", async () => {
  const guildId = "watchdog-recovery";
  const expectedTrack = { track: "expected-track", info: { title: "Expected" } };
  const player = {
    guildId,
    currentTrack: expectedTrack,
    isPaused: false,
    poru: { players: new Map() },
  };
  player.poru.players.set(guildId, player);

  let recoveredTrack = null;
  armTrackStartWatchdog(player, expectedTrack, async (_, track) => {
    recoveredTrack = track;
  }, { timeoutMs: 10 });

  await delay(35);
  assert.equal(recoveredTrack, expectedTrack);
  assert.equal(getTrackStartWatchdog(guildId), null);
});

test("track-start watchdog is cancelled by TrackStart handling", async () => {
  const guildId = "watchdog-cleared";
  const expectedTrack = { track: "expected-track", info: { title: "Expected" } };
  const player = {
    guildId,
    currentTrack: expectedTrack,
    isPaused: false,
    poru: { players: new Map() },
  };
  player.poru.players.set(guildId, player);

  let recovered = false;
  armTrackStartWatchdog(player, expectedTrack, async () => {
    recovered = true;
  }, { timeoutMs: 20 });
  clearTrackStartWatchdog(guildId, "test-track-start");

  await delay(40);
  assert.equal(recovered, false);
  assert.equal(getTrackStartWatchdog(guildId), null);
});

test("a failed track without a mirror releases the player so queue end can continue", () => {
  const { releaseFailedTrack } = require("../../../helpers/lavalink/client");
  const failed = { track: "dead-track", info: { title: "Wind" } };
  const player = { guildId: "release-failed", currentTrack: failed, isPlaying: false, isPaused: false, position: 41_000 };

  assert.equal(releaseFailedTrack(player, failed), true);
  assert.equal(player.currentTrack, null);
  assert.equal(player.isPlaying, false);
  assert.equal(player.position, 0);
});

test("a late provider error never releases a track that replaced the failed one", () => {
  const { releaseFailedTrack } = require("../../../helpers/lavalink/client");
  const failed = { track: "dead-track", info: { title: "Wind" } };
  const replacement = { track: "mirror-track", info: { title: "Wind (mirror)" } };
  const player = { guildId: "release-replaced", currentTrack: replacement, isPlaying: true, isPaused: false, position: 3_000 };

  assert.equal(releaseFailedTrack(player, failed), false);
  assert.equal(player.currentTrack, replacement);
  assert.equal(player.isPlaying, true);
});
