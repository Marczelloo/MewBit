const assert = require("node:assert/strict");
const test = require("node:test");
const { WebhookClient } = require("discord.js");
const { WebSocket } = require("ws");
const {
  createActivityServer,
  getActivityHandoff,
  getActivityPosition,
  isAllowedArtworkUrl,
  resolveActivityPlayback,
  serializeActivityActionResult,
  stateSignature,
  clientHasState,
  stringifyJson,
  withAutoplayRequesterLabel,
  getSerializedPlaybackHistory,
  getSerializedQueue,
  findQueueItemIndex,
} = require("../../../helpers/activity/server");
const { getActivityEvents } = require("../../../helpers/activity/feed");
const { getClient, setClient } = require("../../../helpers/clientRegistry");
const { resetActivitySessions } = require("../../../helpers/activity/sessions");
const { getActivityStateRevision, markActivityStateChanged, resetActivityStateRevision } = require("../../../helpers/activity/sync");
const { installFakePreferences } = require("../mewbeat/fakePreferences");

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

test("Activity state signature ignores the clock, the position and the history only", () => {
  const state = (player, rest = {}) => ({ generatedAt: 1000, queue: [{ id: "a" }], ...rest, player: { playing: true, positionMs: 500, updatedAt: 900, history: [1], historyKey: "h1", ...player } });
  const base = stateSignature(state({}));
  assert.equal(stateSignature(state({ positionMs: 9000, updatedAt: 1, history: [1, 2] }, { generatedAt: 5000 })), base);
  assert.notEqual(stateSignature(state({ paused: true })), base);
  assert.notEqual(stateSignature(state({ historyKey: "h2" })), base);
  assert.notEqual(stateSignature(state({}, { queue: [] })), base);
  assert.doesNotThrow(() => stateSignature({ generatedAt: 1, player: null }));
});

test("Activity heartbeat skips a state the client already has, but not a stale or moved one", () => {
  const playing = (positionMs, generatedAt) => ({ generatedAt, player: { playing: true, paused: false, buffering: false, currentTrack: { id: "t" }, positionMs } });
  const sent = playing(10_000, 1000);
  const last = { signature: "s", at: 1000, generatedAt: 1000, positionMs: 10_000 };
  const KEEPALIVE = 15_000;

  assert.equal(clientHasState(last, playing(11_500, 2500), "s", 2500, KEEPALIVE), true); // the client's own clock gets there
  assert.equal(clientHasState(last, playing(13_000, 2500), "s", 2500, KEEPALIVE), false); // a seek: the position jumped
  assert.equal(clientHasState(last, playing(11_500, 2500), "other", 2500, KEEPALIVE), false); // something else changed
  assert.equal(clientHasState(last, playing(11_500, 2500), "s", 1000 + KEEPALIVE, KEEPALIVE), false); // the keep-alive is due
  assert.equal(clientHasState(null, sent, "s", 2000, KEEPALIVE), false); // nothing sent yet
  assert.equal(clientHasState(last, playing(11_500, 2500), "s", 2500, 0), false); // heartbeat on every tick

  const paused = { generatedAt: 2500, player: { playing: true, paused: true, currentTrack: { id: "t" }, positionMs: 10_000 } };
  assert.equal(clientHasState(last, paused, "s", 2500, KEEPALIVE), true); // not ticking: the position stays
  assert.equal(clientHasState(last, { ...paused, player: { ...paused.player, positionMs: 11_500 } }, "s", 2500, KEEPALIVE), false);
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

test("Activity mewbeat unlock and settings are per-account, gated, and stay out of the room feed", async (t) => {
  const previous = {
    ACTIVITY_ENABLED: process.env.ACTIVITY_ENABLED,
    ACTIVITY_ALLOW_DEV: process.env.ACTIVITY_ALLOW_DEV,
    ACTIVITY_PORT: process.env.ACTIVITY_PORT,
    ACTIVITY_DEV_GUILD_ID: process.env.ACTIVITY_DEV_GUILD_ID,
    NODE_ENV: process.env.NODE_ENV,
  };
  const guildId = "activity-mewbeat-guild";
  Object.assign(process.env, {
    ACTIVITY_ENABLED: "true",
    ACTIVITY_ALLOW_DEV: "true",
    ACTIVITY_PORT: "0",
    ACTIVITY_DEV_GUILD_ID: guildId,
    NODE_ENV: "test",
  });
  const fakePreferences = installFakePreferences();

  const gateway = createActivityServer({ guilds: { cache: new Map() } });
  const server = gateway.start();
  t.after(() => {
    gateway.stop();
    resetActivitySessions();
    resetActivityStateRevision(guildId);
    fakePreferences.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await waitForListening(server);
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/activity/ws`);
  t.after(() => socket.close());

  const inbox = [];
  const waiting = [];
  socket.on("message", (raw) => {
    inbox.push(JSON.parse(raw.toString()));
    while (waiting.length) waiting.shift()();
  });
  async function nextMessage(types) {
    const deadline = Date.now() + 2000;
    for (;;) {
      const index = inbox.findIndex((message) => types.includes(message.type));
      if (index !== -1) return inbox.splice(index, 1)[0];
      if (Date.now() > deadline) throw new Error(`No ${types.join("/")} message from the Activity socket.`);
      await new Promise((resolve) => { waiting.push(resolve); setTimeout(resolve, 50); });
    }
  }

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "auth", guildId }));
  const initial = await nextMessage(["state"]);
  assert.deepEqual(Object.keys(initial.state.mewbeat).sort(), ["settings", "tutorialSeen"]);
  assert.equal(initial.state.mewbeat.tutorialSeen, false);

  // Open to everyone from the start: no unlock first.
  socket.send(JSON.stringify({ type: "action", action: "mewbeat_settings", payload: { settings: { offsetMs: 40 } } }));
  const updated = await nextMessage(["state"]);
  assert.equal(updated.state.mewbeat.settings.offsetMs, 40);
  assert.equal(updated.state.mewbeat.tutorialSeen, false);

  // The clicks play in voice like any other track.
  socket.send(JSON.stringify({ type: "action", action: "mewbeat_calibrate" }));
  assert.match((await nextMessage(["error"])).error, /voice channel/i);

  socket.send(JSON.stringify({ type: "action", action: "mewbeat_tutorial_seen" }));
  const seen = await nextMessage(["state"]);
  assert.equal(seen.state.mewbeat.tutorialSeen, true);
  assert.equal(seen.state.mewbeat.settings.offsetMs, 40);

  socket.send(JSON.stringify({ type: "action", action: "mewbeat_settings", payload: { settings: { offsetMs: 9999 } } }));
  assert.match((await nextMessage(["error"])).error, /offset/i);

  // A report: the reporter and the place are the server's to say, a refusal reaches the player and a failure
  // costs nothing; none of it shows in the room.
  const posted = [];
  const reportWebhookBefore = process.env.MEWBEAT_REPORT_WEBHOOK_URL;
  const registered = getClient();
  t.after(() => {
    setClient(registered);
    if (reportWebhookBefore === undefined) delete process.env.MEWBEAT_REPORT_WEBHOOK_URL;
    else process.env.MEWBEAT_REPORT_WEBHOOK_URL = reportWebhookBefore;
  });
  setClient({ guilds: { cache: new Map([[guildId, { name: "Test Server" }]]) } });
  t.mock.method(WebhookClient.prototype, "send", async (message) => posted.push(message));
  const report = { type: "bug", text: "The notes stop falling after the pause.", mode: "solo", song: "Some Song", level: "Normal" };

  delete process.env.MEWBEAT_REPORT_WEBHOOK_URL;
  socket.send(JSON.stringify({ type: "action", action: "mewbeat_report", payload: report }));
  assert.match((await nextMessage(["error"])).error, /not set up/i);

  process.env.MEWBEAT_REPORT_WEBHOOK_URL = `https://discord.com/api/webhooks/${"1".repeat(18)}/${"a".repeat(68)}`;
  socket.send(JSON.stringify({ type: "action", action: "mewbeat_report", payload: { ...report, text: "short" } }));
  assert.match((await nextMessage(["error"])).error, /at least 10/i);
  assert.equal(posted.length, 0);

  // A map report names a run of the player's own history; one that is not there is refused, whatever song text comes with it.
  socket.send(JSON.stringify({
    type: "action",
    action: "mewbeat_report",
    payload: { ...report, type: "map", song: "Forged Song", run: { audioKey: "youtube:nothing:1000", difficulty: "normal", at: 1 } },
  }));
  assert.match((await nextMessage(["error"])).error, /could not find that run/i);
  assert.equal(posted.length, 0);

  socket.send(JSON.stringify({
    type: "action",
    action: "mewbeat_report",
    payload: { ...report, reporter: { id: "forged", name: "Forged" }, place: "Elsewhere" },
  }));
  await nextMessage(["state"]);
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].allowedMentions, { parse: [] });
  const sentFields = Object.fromEntries(posted[0].embeds[0].toJSON().fields.map((field) => [field.name, field.value]));
  assert.match(sentFields.Reporter, /local-user/);
  assert.doesNotMatch(JSON.stringify(sentFields), /forged|Elsewhere/i);
  assert.equal(sentFields.Place, `Test Server (${guildId})`);
  assert.equal(sentFields.Song, "Some Song");

  socket.send(JSON.stringify({ type: "action", action: "mewbeat_report", payload: report }));
  assert.match((await nextMessage(["error"])).error, /wait a minute/i);

  assert.equal(JSON.stringify(getActivityEvents(guildId)).toLowerCase().includes("mewbeat"), false);
  assert.equal(JSON.stringify(getActivityEvents(guildId)).toLowerCase().includes("report"), false);
});

test("Activity routes mewbeat_ messages to the mewbeat channel", async (t) => {
  const previous = {
    ACTIVITY_ENABLED: process.env.ACTIVITY_ENABLED,
    ACTIVITY_ALLOW_DEV: process.env.ACTIVITY_ALLOW_DEV,
    ACTIVITY_PORT: process.env.ACTIVITY_PORT,
    ACTIVITY_DEV_GUILD_ID: process.env.ACTIVITY_DEV_GUILD_ID,
    NODE_ENV: process.env.NODE_ENV,
  };
  const guildId = "activity-mewbeat-sync-guild";
  Object.assign(process.env, {
    ACTIVITY_ENABLED: "true",
    ACTIVITY_ALLOW_DEV: "true",
    ACTIVITY_PORT: "0",
    ACTIVITY_DEV_GUILD_ID: guildId,
    NODE_ENV: "test",
  });
  const fakePreferences = installFakePreferences();

  const gateway = createActivityServer({ guilds: { cache: new Map() } });
  const server = gateway.start();
  t.after(() => {
    gateway.stop();
    resetActivitySessions();
    resetActivityStateRevision(guildId);
    fakePreferences.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await waitForListening(server);
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/activity/ws`);
  t.after(() => socket.close());

  const inbox = [];
  const waiting = [];
  socket.on("message", (raw) => {
    inbox.push(JSON.parse(raw.toString()));
    while (waiting.length) waiting.shift()();
  });
  async function nextMessage(types) {
    const deadline = Date.now() + 2000;
    for (;;) {
      const index = inbox.findIndex((message) => types.includes(message.type));
      if (index !== -1) return inbox.splice(index, 1)[0];
      if (Date.now() > deadline) throw new Error(`No ${types.join("/")} message from the Activity socket.`);
      await new Promise((resolve) => { waiting.push(resolve); setTimeout(resolve, 50); });
    }
  }

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "mewbeat_sync", id: "early", clientSentAt: 1 }));
  assert.match((await nextMessage(["error"])).error, /authenticate/i);

  socket.send(JSON.stringify({ type: "auth", guildId }));
  await nextMessage(["state"]);

  socket.send(JSON.stringify({ type: "mewbeat_sync", id: "sync-1", clientSentAt: 1234 }));
  const reply = await nextMessage(["mewbeat_sync"]);
  assert.equal(reply.id, "sync-1");
  assert.equal(reply.clientSentAt, 1234);
  assert.equal(typeof reply.serverNow, "number");
  assert.equal(reply.anchor, null);

  socket.send(JSON.stringify({ type: "mewbeat_chart", audioKey: "youtube:abc:1", difficulty: "easy" }));
  // No account gate: nothing is playing, so the chart is stale rather than refused.
  assert.equal((await nextMessage(["mewbeat_chart"])).status, "stale");

  // A finished run on a dense chart is one big message: it reaches the channel rather than closing the socket.
  const events = Array.from({ length: 2000 }, (_, n) => ({ n, part: "head", j: "great", t: 123456.78901234567, d: -12.345678901234567 }));
  const body = JSON.stringify({ type: "mewbeat_submit", id: "big-run", events });
  assert.ok(body.length > 64 * 1024);
  socket.send(body);
  const big = await nextMessage(["mewbeat_submit"]);
  assert.equal(big.id, "big-run");
  assert.equal(big.reason, "bad_difficulty");
});

test("Activity dev identity is only for the local preview: a Discord token on the dev server stays that person", async (t) => {
  const previous = {
    ACTIVITY_ENABLED: process.env.ACTIVITY_ENABLED,
    ACTIVITY_ALLOW_DEV: process.env.ACTIVITY_ALLOW_DEV,
    ACTIVITY_PORT: process.env.ACTIVITY_PORT,
    ACTIVITY_DEV_GUILD_ID: process.env.ACTIVITY_DEV_GUILD_ID,
    ACTIVITY_DEV_TOKEN: process.env.ACTIVITY_DEV_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
  };
  const guildId = "activity-dev-identity-guild";
  Object.assign(process.env, {
    ACTIVITY_ENABLED: "true",
    ACTIVITY_ALLOW_DEV: "true",
    ACTIVITY_PORT: "0",
    ACTIVITY_DEV_GUILD_ID: guildId,
    NODE_ENV: "test",
  });
  delete process.env.ACTIVITY_DEV_TOKEN;

  const people = {
    "dev-identity-token-ada": { id: "ada-id", username: "ada", global_name: "Ada", discriminator: "0" },
    "dev-identity-token-bo": { id: "bo-id", username: "bo", global_name: "Bo", discriminator: "0" },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://discord.com/api/v10/users/@me") return realFetch(url, options);
    const person = people[String(options.headers.Authorization).slice("Bearer ".length)];
    return { ok: Boolean(person), json: async () => person };
  };

  const guild = { id: guildId, name: "Dev", members: { fetch: async (id) => ({ id }) } };
  const gateway = createActivityServer({ guilds: { cache: new Map([[guildId, guild]]) } });
  const server = gateway.start();
  t.after(() => {
    gateway.stop();
    resetActivitySessions();
    resetActivityStateRevision(guildId);
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await waitForListening(server);
  const signIn = (token) => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/activity/ws`);
    t.after(() => socket.close());
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", guildId, token })));
    socket.on("error", reject);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "ready") resolve(message.identity);
      if (message.type === "error") reject(new Error(message.error));
    });
  });

  assert.deepEqual(await signIn("dev-identity-token-ada"), { id: "ada-id", username: "Ada" });
  assert.deepEqual(await signIn("dev-identity-token-bo"), { id: "bo-id", username: "Bo" });
  assert.deepEqual(await signIn(null), { id: "local-user", username: "Local Listener" });
  await assert.rejects(signIn("dev-identity-token-stranger"), /authentication expired/);

  // With a dev token set, that token is the preview; a Discord token is still its owner.
  process.env.ACTIVITY_DEV_TOKEN = "dev-identity-preview";
  assert.deepEqual(await signIn("dev-identity-preview"), { id: "local-user", username: "Local Listener" });
  assert.deepEqual(await signIn("dev-identity-token-ada"), { id: "ada-id", username: "Ada" });
  await assert.rejects(signIn(null), /authentication is required/);
});
