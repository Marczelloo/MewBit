const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createRoomStore;

test.before(async () => {
  ({ createRoomStore } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/roomStore.js")).href
  ));
});

// requests whose replies the test controls: request() answers from `replies` by type.
function setup(replies = {}) {
  const sent = [];
  const rooms = [];
  const requests = {
    request: async (type, body) => {
      sent.push({ type, ...body });
      const reply = replies[type];
      if (reply instanceof Error) throw reply;
      return reply ?? { type, status: "ok" };
    },
    send: (message) => {
      sent.push(message);
      return true;
    },
  };
  const store = createRoomStore({ requests, now: () => 42, onRoom: (room, at) => rooms.push({ room, at }) });
  return { store, sent, rooms };
}

test("join sends the request and remembers that the client wants in", async () => {
  const { store, sent } = setup();
  await store.join();
  assert.deepEqual(sent.map((m) => m.type), ["mewbeat_room_join"]);
  assert.equal(store.wanted(), true);
  assert.equal(store.get().joinError, null);
});

test("a refused join is kept as the reason", async () => {
  const { store } = setup({ mewbeat_room_join: { type: "mewbeat_room_join", status: "error", reason: "locked" } });
  await store.join();
  assert.equal(store.get().joinError, "locked");
  assert.equal(store.get().joining, false);
});

test("a request that cannot reach the bot is reported as unreachable", async () => {
  const { store } = setup({ mewbeat_room_join: new Error("Not connected") });
  await store.join();
  assert.equal(store.get().joinError, "unreachable");
});

test("room pushes are consumed, stored and forwarded with their arrival time", async () => {
  const { store, rooms } = setup();
  await store.join();
  const room = { phase: "lobby", members: [] };
  assert.equal(store.handle({ type: "mewbeat_room", room }), true);
  assert.equal(store.get().room, room);
  assert.equal(store.get().receivedAt, 42);
  assert.deepEqual(rooms, [{ room, at: 42 }]);
});

test("a push after leaving is swallowed and does not bring the room back", async () => {
  const { store } = setup();
  await store.join();
  store.leave();
  assert.equal(store.handle({ type: "mewbeat_room", room: { phase: "lobby" } }), true);
  assert.equal(store.get().room, null);
});

test("leave sends mewbeat_room_leave once and clears the room", async () => {
  const { store, sent, rooms } = setup();
  await store.join();
  store.handle({ type: "mewbeat_room", room: { phase: "lobby" } });
  store.leave();
  store.leave();
  assert.equal(sent.filter((m) => m.type === "mewbeat_room_leave").length, 1);
  assert.equal(rooms.at(-1).room, null);
  assert.equal(store.wanted(), false);
});

test("socket ready re-joins only while the client wants to be in the room", async () => {
  const { store, sent } = setup();
  assert.equal(store.handle({ type: "mewbeat_socket_ready" }), false);
  assert.equal(sent.length, 0);
  await store.join();
  store.handle({ type: "mewbeat_socket_ready" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.filter((m) => m.type === "mewbeat_room_join").length, 2);
  store.leave();
  store.handle({ type: "mewbeat_socket_ready" });
  assert.equal(sent.filter((m) => m.type === "mewbeat_room_join").length, 2);
});

test("other messages are not consumed", () => {
  const { store } = setup();
  assert.equal(store.handle({ type: "mewbeat_sync" }), false);
  assert.equal(store.handle(null), false);
});

test("actions pass their bodies and never throw", async () => {
  const { store, sent } = setup({ mewbeat_room_start: new Error("down") });
  await store.ready({ difficulty: "hard" });
  await store.queueAdd({ uri: "u", source: "youtube" });
  await store.queueRemove(2);
  await store.invite();
  const reply = await store.start();
  assert.equal(reply.reason, "unreachable");
  assert.deepEqual(sent[0], { type: "mewbeat_room_ready", difficulty: "hard" });
  assert.deepEqual(sent[1], { type: "mewbeat_room_queue_add", uri: "u", source: "youtube" });
  assert.deepEqual(sent[2], { type: "mewbeat_room_queue_remove", index: 2 });
});

test("songStats asks for the song's numbers and returns them", async () => {
  const stats = { easy: { stars: 1.2, notes: 80, best: null }, hell: { stars: 7.9, notes: 900, best: { score: 812345, grade: "A" } } };
  const { store, sent } = setup({ mewbeat_song_stats: { type: "mewbeat_song_stats", status: "ok", stats } });
  assert.deepEqual(await store.songStats("song"), stats);
  assert.deepEqual(sent[0], { type: "mewbeat_song_stats", audioKey: "song" });
});

test("songStats gives null when the server has no numbers or the call fails", async () => {
  assert.equal(await setup({ mewbeat_song_stats: { type: "mewbeat_song_stats", status: "ok", stats: null } }).store.songStats("song"), null);
  assert.equal(await setup({ mewbeat_song_stats: { type: "mewbeat_song_stats", status: "error", reason: "unknown_song" } }).store.songStats("song"), null);
  assert.equal(await setup({ mewbeat_song_stats: new Error("down") }).store.songStats("song"), null);
});
