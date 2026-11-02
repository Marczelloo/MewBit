const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { createHistoryStore } = require("../../../helpers/mewbeat/historyStore");
const { createScoreStore } = require("../../../helpers/mewbeat/scoreStore");

const KEY = "youtube:abc:200000";
const VERSION = 5;
const ANN = { id: "ann", username: "Ann", avatarUrl: "https://a/ann.png" };
const BO = { id: "bo", username: "Bo", avatarUrl: null };

function fakeTrack(identifier) {
  return {
    info: {
      sourceName: "youtube", identifier, length: 200000, title: `Song ${identifier}`, author: "Artist", uri: `https://y/${identifier}`,
    },
  };
}

function makeCharts() {
  const notes = [
    { t: 1000, lane: 0 }, { t: 1500, lane: 1 }, { t: 2000, lane: 2 }, { t: 2500, lane: 3, len: 400 }, { t: 3500, lane: 0 },
  ];
  const chart = (difficulty) => ({ version: VERSION, audioKey: KEY, difficulty, notes });
  return { easy: chart("easy"), normal: chart("normal"), hard: chart("hard"), hell: chart("hell") };
}

function perfectEvents() {
  return [
    { n: 0, part: "head", j: "perfect", t: 1000, d: 0 },
    { n: 1, part: "head", j: "perfect", t: 1500, d: 0 },
    { n: 2, part: "head", j: "great", t: 2000, d: 50 },
    { n: 3, part: "head", j: "perfect", t: 2500, d: 0 },
    { n: 3, part: "tail", j: "perfect", t: 2900, d: 0 },
    { n: 4, part: "head", j: "good", t: 3500, d: 90 },
  ];
}

describe("mewbeat channel rooms", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-rooms-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup({ unlocked = true } = {}) {
    let time = 1_000_000;
    let nextTimer = 1;
    const timers = new Map();
    const pushes = [];
    const charts = makeCharts();
    const channel = createMewbeatChannel({
      readPlayback: () => null,
      chartStore: {
        getCharts: async () => ({ status: "ready", charts }),
        peekCharts: () => ({ status: "ready", charts }),
      },
      isUnlocked: () => unlocked,
      now: () => time,
      resolveTrack: async (_guildId, { uri }) => (uri === "missing" ? null : { track: fakeTrack(uri), node: "n" }),
      scoreStore: createScoreStore({ file: path.join(dir, "scores.json"), now: () => time }),
      historyStore: createHistoryStore({ file: path.join(dir, "history.json"), now: () => time }),
      broadcast: (guildId, userIds, payload) => pushes.push({ guildId, userIds, payload }),
      setTimer: (run, ms) => { const id = nextTimer++; timers.set(id, { at: time + ms, run }); return id; },
      clearTimer: (id) => timers.delete(id),
    });
    const advance = (ms) => {
      const target = time + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].run();
      }
      time = target;
    };
    const send = (profile, message) => channel.handle("g1", profile.id, message, profile);
    const lastRoom = () => pushes.filter((push) => push.payload.room).at(-1).payload.room;
    return { channel, pushes, send, advance, lastRoom, timers };
  }

  it("joins a room, answers the sender and broadcasts the room", async () => {
    const { send, pushes, lastRoom } = setup();
    assert.deepStrictEqual(await send(ANN, { type: "mewbeat_room_join", id: "1" }), { type: "mewbeat_room_join", id: "1", status: "ok" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    const push = pushes.at(-1);
    assert.deepStrictEqual(push.userIds, ["ann", "bo"]);
    assert.strictEqual(push.payload.type, "mewbeat_room");
    assert.strictEqual(lastRoom().hostId, "ann");
    assert.deepStrictEqual(lastRoom().members.map((member) => [member.userId, member.username]), [["ann", "Ann"], ["bo", "Bo"]]);
    assert.strictEqual(typeof lastRoom().serverNow, "number");
  });

  it("needs an id and the unlock like every mewbeat message", async () => {
    const locked = setup({ unlocked: false });
    assert.strictEqual((await locked.send(ANN, { type: "mewbeat_room_join", id: "1" })).type, "error");
    assert.strictEqual((await setup().send(ANN, { type: "mewbeat_room_join" })).type, "error");
  });

  it("queues a song through the solo prepare path and reports failures by reason", async () => {
    const { send, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_room_queue_add", id: "2", uri: "abc", source: "youtube" }),
      { type: "mewbeat_room_queue_add", id: "2", status: "ok" },
    );
    assert.deepStrictEqual(lastRoom().queue.map((entry) => [entry.audioKey, entry.addedBy, entry.title]), [[KEY, "ann", "Song abc"]]);
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "missing" }),
      { type: "mewbeat_room_queue_add", id: "3", status: "error", reason: "not_found" },
    );
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_queue_add", id: "4", uri: "" })).reason, "bad_uri");
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_room_queue_remove", id: "5", index: 0 }),
      { type: "mewbeat_room_queue_remove", id: "5", status: "ok" },
    );
  });

  it("validates ready and answers errors with a reason", async () => {
    const { send } = setup();
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "1", ready: true })).reason, "not_in_room");
    await send(ANN, { type: "mewbeat_room_join", id: "2" });
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "3", ready: "yes" })).reason, "bad_request");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "4", ready: true, difficulty: "nope" })).reason, "bad_difficulty");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "5", ready: true, difficulty: "hell" })).status, "ok");
    assert.strictEqual((await send(BO, { type: "mewbeat_room_start", id: "6" })).reason, "not_in_room");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_start", id: "7" })).reason, "empty_queue");
  });

  it("leaves invites for later", async () => {
    const { send } = setup();
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_room_invite", id: "1" }),
      { type: "mewbeat_room_invite", id: "1", status: "error", reason: "not_implemented" },
    );
  });

  it("plays a room round and takes the room submit as the player's result", async () => {
    const { send, advance, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "abc", source: "youtube" });
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_start", id: "4" })).status, "ok");
    assert.strictEqual(lastRoom().phase, "loading");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_loaded", id: "5", audioKey: "nope" })).reason, "wrong_track");
    await send(ANN, { type: "mewbeat_room_loaded", id: "6", audioKey: KEY });
    await send(BO, { type: "mewbeat_room_loaded", id: "7", audioKey: KEY });
    assert.strictEqual(lastRoom().phase, "countdown");
    advance(5000);
    assert.strictEqual(lastRoom().phase, "playing");

    const submit = (profile, id, extra) => send(profile, {
      type: "mewbeat_submit",
      id,
      mode: "room",
      audioKey: KEY,
      difficulty: "hard",
      chartVersion: VERSION,
      events: perfectEvents(),
      fevers: [],
      flags: {},
      ...extra,
    });
    const reply = await submit(ANN, "8");
    assert.strictEqual(reply.status, "ok");
    assert.strictEqual(lastRoom().phase, "playing");
    assert.strictEqual(lastRoom().members.find((member) => member.userId === "ann").submitted, true);

    // The recomputed result is what the room shows, not anything the client claims.
    await submit(BO, "9", { events: perfectEvents().slice(0, 4), difficulty: "easy" });
    const room = lastRoom();
    assert.strictEqual(room.phase, "lobby");
    // Different difficulties, so the standings go by accuracy: Bo's four hits were cleaner.
    assert.deepStrictEqual(room.results.map((entry) => [entry.userId, entry.score, entry.difficulty]), [
      ["bo", 1100, "easy"],
      ["ann", 1500, "hard"],
    ]);
    assert.ok(room.results[0].accuracy > room.results[1].accuracy);
  });

  it("ignores a room submit for a song that is not the room's current one", async () => {
    const { send, advance, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "2", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_start", id: "3" });
    await send(ANN, { type: "mewbeat_room_loaded", id: "4", audioKey: KEY });
    advance(5000);
    // A solo run of the same song during the round doesn't finish the room's round.
    await send(ANN, {
      type: "mewbeat_submit", id: "5", mode: "solo", audioKey: KEY, difficulty: "hard", chartVersion: VERSION, events: perfectEvents(), fevers: [], flags: {},
    });
    assert.strictEqual(lastRoom().phase, "playing");
  });

  it("removes a user from the room when they disconnect", async () => {
    const { channel, send, lastRoom, pushes, timers } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    channel.disconnect("g1", "ann");
    assert.deepStrictEqual(lastRoom().members.map((member) => member.userId), ["bo"]);
    assert.strictEqual(lastRoom().hostId, "bo");
    channel.disconnect("g1", "bo");
    assert.strictEqual(timers.size, 0);
    assert.strictEqual(pushes.at(-1).payload.room, null);
    // Rejoining after everyone left starts a new room.
    await send(ANN, { type: "mewbeat_room_join", id: "3" });
    assert.deepStrictEqual(lastRoom().members.map((member) => member.userId), ["ann"]);
  });
});
