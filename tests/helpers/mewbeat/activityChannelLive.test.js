const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");

const KEY = "youtube:abc:200000";
const SESSION = `live:${KEY}`;
const ANN = { id: "ann", username: "Ann", avatarUrl: "https://a/ann.png" };
const BO = { id: "bo", username: "Bo", avatarUrl: null };

describe("mewbeat channel live board", () => {
  function setup({ unlocked = true } = {}) {
    let time = 1_000_000;
    let nextTimer = 1;
    const timers = new Map();
    const pushes = [];
    const channel = createMewbeatChannel({
      readPlayback: () => null,
      chartStore: { getCharts: async () => ({ status: "ready", charts: {} }) },
      isUnlocked: () => unlocked,
      now: () => time,
      resolveTrack: async () => null,
      broadcast: (guildId, userIds, payload) => pushes.push({ guildId, userIds: [...userIds], payload }),
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
    const live = (profile, overrides) => send(profile, {
      type: "mewbeat_live", session: SESSION, audioKey: KEY, difficulty: "normal", score: 100, combo: 2, accuracy: 95, ended: false, ...overrides,
    });
    return {
      channel, pushes, send, live, advance,
    };
  }

  it("takes a live update without a reply and pushes the board", async () => {
    const { live, pushes } = setup();
    assert.strictEqual(await live(ANN), null);
    assert.strictEqual(pushes.length, 1);
    assert.deepStrictEqual(pushes[0].userIds, ["ann"]);
    assert.deepStrictEqual(pushes[0].payload.entries.map((entry) => [entry.userId, entry.username, entry.avatarUrl, entry.score]), [
      ["ann", "Ann", "https://a/ann.png", 100],
    ]);
  });

  it("ignores a locked account", async () => {
    const { live, pushes, advance } = setup({ unlocked: false });
    assert.strictEqual(await live(ANN), null);
    advance(10_000);
    assert.strictEqual(pushes.length, 0);
  });

  it("answers nothing to a bad update and pushes nothing", async () => {
    const { live, pushes } = setup();
    assert.strictEqual(await live(ANN, { score: "lots" }), null);
    assert.strictEqual(await live(ANN, { session: "elsewhere" }), null);
    assert.strictEqual(pushes.length, 0);
  });

  it("lets only a room player post to the room, and sends the board to all members", async () => {
    const { send, live, pushes, advance } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    pushes.length = 0;
    await live(ANN, { session: "room" });
    assert.deepStrictEqual(pushes.map((push) => [push.payload.session, push.userIds]), [["room", ["ann", "bo"]]]);
    advance(1000);
    pushes.length = 0;
    await live({ id: "zed", username: "Zed", avatarUrl: null }, { session: "room" });
    assert.strictEqual(pushes.length, 0);
  });

  it("brings a player's vibe and FEVER to a room spectator", async () => {
    const { send, live, pushes } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    await send(BO, { type: "mewbeat_room_ready", id: "3", spectate: true });
    pushes.length = 0;
    await live(ANN, { session: "room", vibe: 0.5, fever: true });
    const board = pushes.filter((push) => push.payload.type === "mewbeat_live_board").at(-1);
    assert.deepStrictEqual(board.userIds, ["ann", "bo"]);
    assert.deepStrictEqual(board.payload.entries.map((entry) => [entry.userId, entry.vibe, entry.fever]), [["ann", 0.5, true]]);
  });

  it("drops the player's live entry when the last socket closes", async () => {
    const { live, channel, pushes, advance } = setup();
    await live(ANN, { score: 100 });
    advance(300);
    await live(BO, { score: 50 });
    advance(300);
    channel.disconnect("g1", "ann");
    advance(300);
    const last = pushes.at(-1);
    assert.deepStrictEqual(last.userIds, ["bo"]);
    assert.deepStrictEqual(last.payload.entries.map((entry) => entry.userId), ["bo"]);
  });

  it("drops the room entry on leave", async () => {
    const { send, live, pushes, advance } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    await live(ANN, { session: "room" });
    advance(300);
    await send(ANN, { type: "mewbeat_room_leave", id: "3" });
    advance(300);
    const last = pushes.filter((push) => push.payload.type === "mewbeat_live_board").at(-1);
    assert.deepStrictEqual(last.payload.entries, []);
    assert.deepStrictEqual(last.userIds, ["bo"]);
  });

  it("answers a locked account with the request id", async () => {
    const { send } = setup({ unlocked: false });
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_played", id: "p1", scope: "server" }),
      { type: "mewbeat_played", id: "p1", status: "error", reason: "locked" },
    );
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_board", id: "b1", audioKey: KEY, difficulty: "hard", scope: "server" }),
      { type: "mewbeat_board", id: "b1", status: "error", reason: "locked" },
    );
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_submit", id: "s1" }),
      { type: "mewbeat_submit", id: "s1", status: "error", reason: "locked" },
    );
    // Without an id there is nobody to answer by id.
    assert.strictEqual((await send(ANN, { type: "mewbeat_played", scope: "server" })).type, "error");
  });
});
