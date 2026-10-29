const assert = require("node:assert/strict");
const test = require("node:test");
const { WebSocket } = require("ws");
const {
  createActivityServer,
  getActivityHandoff,
  getActivityPosition,
  isAllowedArtworkUrl,
  resolveActivityPlayback,
  serializeActivityActionResult,
  stringifyJson,
  withAutoplayRequesterLabel,
  getSerializedPlaybackHistory,
  getSerializedQueue,
  findQueueItemIndex,
} = require("../../../helpers/activity/server");
const { resetActivitySessions } = require("../../../helpers/activity/sessions");
const { getActivityStateRevision, markActivityStateChanged, resetActivityStateRevision } = require("../../../helpers/activity/sync");

test("Activity state revisions only move forward for a guild", () => {
  const guildId = "activity-revision-test";
  resetActivityStateRevision(guildId);

  assert.equal(getActivityStateRevision(guildId), 0);
  assert.equal(markActivityStateChanged(guildId, "trackStart"), 1);
  assert.equal(markActivityStateChanged(guildId, "trackEnd"), 2);
  assert.equal(getActivityStateRevision(guildId), 2);

  resetActivityStateRevision(guildId);
});

test("Activity responses stay JSON-safe for Lavalink objects", () => {
  const circular = { encoded: 123n };
  circular.self = circular;

  assert.deepEqual(JSON.parse(stringifyJson(circular)), { encoded: "123", self: "[Circular]" });
  assert.deepEqual(serializeActivityActionResult("play", { player: circular, track: null }), {
    success: true,
    track: null,
    isPlaylist: false,
    playlistTrackCount: 0,
  });
});

test("Activity surprise results omit circular player data", () => {
  const circular = {};
  circular.self = circular;

  assert.deepEqual(serializeActivityActionResult("surprise_me", {
    player: circular,
    track: null,
    surpriseIntent: "discovery",
  }), {
    success: true,
    track: null,
    isPlaylist: false,
    playlistTrackCount: 0,
    surpriseIntent: "discovery",
  });
});

test("Activity artwork proxy only accepts known HTTPS media hosts", () => {
  assert.equal(isAllowedArtworkUrl("https://i.ytimg.com/vi/example/maxresdefault.jpg"), true);
  assert.equal(isAllowedArtworkUrl("https://i1.sndcdn.com/artworks-example-t500x500.jpg"), true);
  assert.equal(isAllowedArtworkUrl("https://cdn-images.dzcdn.net/images/cover/example/500x500.jpg"), true);
  assert.equal(isAllowedArtworkUrl("http://127.0.0.1:8787/private"), false);
  assert.equal(isAllowedArtworkUrl("https://example.test/not-allowed.jpg"), false);
});

test("Activity uses the event-backed state track during a transient player transition", () => {
  const staleTrack = { track: "old", info: { identifier: "old", title: "Old", length: 120000 } };
  const liveTrack = { track: "new", info: { identifier: "new", title: "New", length: 240000 } };
  const playback = resolveActivityPlayback(staleTrack, liveTrack);

  assert.equal(playback.track, staleTrack);
  assert.equal(playback.durationMs, 120000);
  assert.equal(playback.usesPlayerTrack, false);
});

test("Activity keeps an explicit ended state instead of resurrecting Poru's track", () => {
  const playback = resolveActivityPlayback(null, { track: "stale", info: { identifier: "stale", title: "Stale" } });

  assert.equal(playback.track, null);
  assert.equal(playback.usesPlayerTrack, false);
  assert.equal(playback.durationMs, 0);
});

test("Activity holds the ended track until the next one starts", () => {
  const now = 1_000_000;
  const ended = { track: "old", info: { identifier: "old", title: "Old", length: 120000 } };
  const player = { queue: [] };
  const state = { currentTrack: null, handoffTrack: { track: ended, positionMs: 42_000, since: now - 5_000 } };

  assert.equal(getActivityHandoff(player, state, now)?.track, ended);
  assert.equal(getActivityHandoff(player, state, now)?.positionMs, 42_000);
  // The next track started, the player left, or nothing came within the hold.
  assert.equal(getActivityHandoff(player, { ...state, currentTrack: ended }, now), null);
  assert.equal(getActivityHandoff(null, state, now), null);
  assert.equal(getActivityHandoff(player, state, now + 60_000), null);
});

test("Activity progress follows the event-backed position anchor across view remounts", () => {
  const now = 1_000_000;
  const state = { lastPosition: 46_000, lastTimestamp: now - 3_000, paused: false };
  const player = { position: 0, isPaused: false };

  assert.equal(getActivityPosition(player, state, 180_000, now), 49_000);
  assert.equal(getActivityPosition({ position: 0, isPaused: true }, state, 180_000, now), 46_000);
  assert.equal(getActivityPosition(player, state, 48_000, now), 48_000);
});

test("Activity holds the position of a track that has not been heard yet", () => {
  const now = Date.now();
  const state = { lastPosition: 0, lastTimestamp: now - 3_000, paused: false, audioPendingSince: now - 3_000, audioPendingFrom: 0 };
  assert.equal(getActivityPosition({ position: 0, isPaused: false }, state, 180_000, now), 0);

  state.audioPendingSince = null;
  assert.equal(getActivityPosition({ position: 0, isPaused: false }, state, 180_000, now), 3_000);
});

test("Activity always labels autoplay rows as MewBit even when a provider preserved a user requester", () => {
  const track = withAutoplayRequesterLabel({
    info: { title: "Queued by autoplay", requesterTag: "marczelloo#0001", autoplayed: true },
    userData: { autoplay: true },
  }, { user: { username: "MewBit" } });

  assert.equal(track.info.requesterTag, "MewBit");
});

test("Activity queue actions resolve a stable row identity after another client reordered the queue", () => {
  const first = { info: { identifier: "first", title: "First", author: "Artist" }, userData: {} };
  const second = { info: { identifier: "second", title: "Second", author: "Artist" }, userData: {} };
  const queue = [first, second];
  const serialized = getSerializedQueue({ queue }, { user: { username: "MewBit" } });

  queue.reverse();
  assert.equal(findQueueItemIndex(queue, serialized[0].queueItemId, 0), 1);
  assert.equal(findQueueItemIndex(queue, "missing-row", 0), -1);
});

test("Activity serializes playback history newest first with a played timestamp", () => {
  const history = [
    { track: "older", info: { identifier: "older", title: "Older", author: "Artist", length: 120000 }, userData: { autoplayPlayedAt: 100 } },
    { track: "newer", info: { identifier: "newer", title: "Newer", author: "Artist", length: 120000, autoplayed: true }, userData: { autoplay: true, autoplayPlayedAt: 200 } },
  ];
  const serialized = getSerializedPlaybackHistory(history, { user: { username: "MewBit" } });

  assert.deepEqual(serialized.map((track) => track.id), ["newer", "older"]);
  assert.deepEqual(serialized.map((track) => track.playedAt), [200, 100]);
  assert.equal(serialized[0].requester, "MewBit");
});

function waitForListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

test("Activity gateway exposes authenticated local state over HTTP and WebSocket", async (t) => {
  const previous = {
    enabled: process.env.ACTIVITY_ENABLED,
    allowDev: process.env.ACTIVITY_ALLOW_DEV,
    port: process.env.ACTIVITY_PORT,
    devGuild: process.env.ACTIVITY_DEV_GUILD_ID,
    nodeEnv: process.env.NODE_ENV,
  };

  process.env.ACTIVITY_ENABLED = "true";
  process.env.ACTIVITY_ALLOW_DEV = "true";
  process.env.ACTIVITY_PORT = "0";
  process.env.ACTIVITY_DEV_GUILD_ID = "activity-test-guild";
  process.env.NODE_ENV = "test";

  const client = { guilds: { cache: new Map() } };
  const gateway = createActivityServer(client);
  const server = gateway.start();
  t.after(() => {
    gateway.stop();
    resetActivitySessions();
    for (const [key, value] of Object.entries(previous)) {
      const envKey = {
        enabled: "ACTIVITY_ENABLED",
        allowDev: "ACTIVITY_ALLOW_DEV",
        port: "ACTIVITY_PORT",
        devGuild: "ACTIVITY_DEV_GUILD_ID",
        nodeEnv: "NODE_ENV",
      }[key];
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  });

  await waitForListening(server);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await fetch(`${baseUrl}/api/activity/health`).then((response) => response.json());
  const state = await fetch(`${baseUrl}/api/activity/state?guildId=activity-test-guild`).then((response) => response.json());
  const blockedArtworkResponse = await fetch(`${baseUrl}/api/activity/artwork?url=${encodeURIComponent("http://127.0.0.1/private.jpg")}`);
  const blockedArtwork = await blockedArtworkResponse.json();

  assert.equal(health.ok, true);
  assert.equal(state.ok, true);
  assert.equal(state.state.guild.id, "activity-test-guild");
  assert.equal(typeof state.state.revision, "number");
  assert.equal(typeof state.state.generatedAt, "number");
  assert.equal(state.state.player.currentTrack, null);
  assert.deepEqual(state.state.player.history, []);
  assert.equal(state.state.player.sessionStartedAt, null);
  assert.equal(state.state.activity.active, false);
  assert.equal(blockedArtworkResponse.status, 400);
  assert.match(blockedArtwork.error, /not allowed/i);

  const messages = [];
  const revisions = [];
  const socketStates = [];
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/activity/ws`);
    const timeout = setTimeout(() => reject(new Error("Activity WebSocket handshake timed out.")), 2000);
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", guildId: "activity-test-guild" })));
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString());
      messages.push(payload.type);
      if (payload.type === "state") {
        revisions.push(payload.state.revision);
        socketStates.push(payload.state);
        if (revisions.length === 1) {
          markActivityStateChanged("activity-test-guild", "gateway-test");
        } else {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }
      }
    });
    socket.on("error", reject);
  });

  assert.deepEqual(messages, ["ready", "state", "state"]);
  assert.equal(revisions[1], revisions[0] + 1);
  assert.equal(socketStates[0].activity.active, true);
  resetActivityStateRevision("activity-test-guild");
});
