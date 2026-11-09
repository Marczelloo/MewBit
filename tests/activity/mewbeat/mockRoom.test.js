const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let mockRoom;
let room;
let mockRequests;

test.before(async () => {
  const dir = "../../../activity/src/mewbeat/";
  mockRoom = await import(pathToFileURL(path.resolve(__dirname, `${dir}mockRoom.js`)).href);
  room = await import(pathToFileURL(path.resolve(__dirname, `${dir}room.js`)).href);
  mockRequests = await import(pathToFileURL(path.resolve(__dirname, `${dir}mockRequests.js`)).href);
});

const ME = "mock-me";

test("the mock lobby has four players with an owner, three queued songs and a running clock", () => {
  const snapshot = mockRoom.createMockRoom({ now: 1000 });
  assert.equal(snapshot.members.length, 4);
  assert.ok(room.isHost(snapshot, ME));
  assert.equal(snapshot.queue.length, 3);
  assert.equal(snapshot.nextAt, 1000 + mockRoom.ROUND_CLOCK_MS);
  assert.equal(room.roomView(snapshot, ME), "lobby");
  assert.ok(snapshot.members.some((member) => member.ready) && snapshot.members.some((member) => !member.ready));
  // The owner can be somebody else, and then comes first in the list.
  const guest = mockRoom.createMockRoom({ hostId: "kuba" });
  assert.equal(room.ownerFirst(guest)[0].userId, "kuba");
  assert.equal(room.isHost(guest, ME), false);
});

test("every queued song is one the fake replies know, so its levels and board load", async () => {
  const request = mockRequests.createMockRequest();
  for (const track of mockRoom.createMockRoom().queue) {
    const reply = await request("mewbeat_song_stats", { audioKey: track.audioKey });
    assert.ok(reply.stats, track.title);
  }
});

test("ready, level and spectate change only the asked player, and a spectator cannot be ready", () => {
  const start = mockRoom.createMockRoom();
  const ready = mockRoom.applyReady(start, ME, { ready: true });
  assert.equal(ready.reply.status, "ok");
  assert.equal(room.memberOf(ready.room, ME).ready, true);
  assert.equal(room.memberOf(ready.room, "ola").ready, false);
  assert.equal(room.memberOf(start, ME).ready, false); // the old snapshot is untouched

  const level = mockRoom.applyReady(ready.room, ME, { difficulty: "hell" });
  assert.equal(room.memberOf(level.room, ME).difficulty, "hell");
  assert.equal(room.memberOf(level.room, ME).ready, true);
  assert.equal(mockRoom.applyReady(start, ME, { difficulty: "nope" }).reply.reason, "bad_difficulty");

  const watching = mockRoom.applyReady(ready.room, ME, { spectate: true });
  assert.deepEqual([room.memberOf(watching.room, ME).watching, room.memberOf(watching.room, ME).ready], [true, false]);
  assert.equal(mockRoom.applyReady(watching.room, ME, { ready: true }).reply.reason, "spectator");
  assert.equal(room.memberOf(mockRoom.applyReady(watching.room, ME, { spectate: false }).room, ME).watching, false);
  assert.equal(mockRoom.applyReady(start, "stranger", { ready: true }).reply.reason, "not_in_room");
});

test("adding songs queues one nobody queued yet, and the queue is capped", () => {
  let current = mockRoom.createMockRoom();
  const before = new Set(current.queue.map((track) => track.title));
  const added = mockRoom.addNextSong(current, ME);
  assert.equal(added.room.queue.length, 4);
  const fresh = added.room.queue[3];
  assert.ok(!before.has(fresh.title));
  assert.equal(fresh.addedBy, ME);
  // Always valid for the lobby: the song has an audio key the fake replies know.
  assert.ok(fresh.audioKey);
  current = { ...current, queue: Array.from({ length: mockRoom.MAX_QUEUE }, () => current.queue[0]) };
  assert.equal(mockRoom.addNextSong(current, ME).reply.reason, "queue_full");
});

test("removing from the queue follows the room's rules", () => {
  const owner = mockRoom.createMockRoom();
  const removed = mockRoom.removeFromQueue(owner, ME, 0);
  assert.equal(removed.room.queue.length, 2);
  assert.equal(removed.room.queue[0].title, "Hopes and Dreams");
  assert.equal(mockRoom.removeFromQueue(owner, ME, 9).reply.reason, "bad_index");
  const guest = mockRoom.createMockRoom({ hostId: "kuba" });
  assert.equal(mockRoom.removeFromQueue(guest, ME, 0).reply.reason, "forbidden"); // kuba's song
  assert.equal(mockRoom.removeFromQueue(guest, ME, 1).reply.status, "ok"); // my own
});

test("moveInQueue reorders for the owner only", () => {
  const owner = mockRoom.createMockRoom();
  const moved = mockRoom.moveInQueue(owner, ME, 2, 0);
  assert.deepEqual(moved.room.queue.map((track) => track.title), ["Rude Buster", "MEGALOVANIA", "Hopes and Dreams"]);
  assert.equal(owner.queue[0].title, "MEGALOVANIA");
  assert.equal(mockRoom.moveInQueue(owner, ME, 0, 9).reply.reason, "bad_index");
  assert.equal(mockRoom.moveInQueue(mockRoom.createMockRoom({ hostId: "kuba" }), ME, 0, 1).reply.reason, "not_host");
});

test("restartClock moves only the clock", () => {
  const start = mockRoom.createMockRoom({ now: 1000 });
  const restarted = mockRoom.restartClock(start, 5000, 2000);
  assert.deepEqual([restarted.serverNow, restarted.nextAt], [2000, 7000]);
  assert.equal(restarted.queue, start.queue);
});

test("the finished room gives Results standings with the player among them, and the queue's head as up next", () => {
  const finished = mockRoom.createMockFinishedRoom({ now: 10_000 });
  const rows = room.standingsOf(finished, ME);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.me).length, 1);
  assert.deepEqual(rows.map((row) => row.score), [...rows.map((row) => row.score)].sort((a, b) => b - a));
  assert.equal(room.upNextOf(finished).title, "Rude Buster");
});

test("the mock run is a finished full combo on a song the fake board knows", async () => {
  const summary = mockRoom.createMockSummary();
  assert.equal(summary.finished && !summary.autoplay && !summary.calibration && summary.counts.miss === 0, true);
  assert.ok(summary.hitErrors.length >= 8);
  const request = mockRequests.createMockRequest();
  const board = await request("mewbeat_board", { audioKey: summary.audioKey, difficulty: summary.difficulty, scope: "server" });
  assert.ok(board.entries.length > 0);
});
