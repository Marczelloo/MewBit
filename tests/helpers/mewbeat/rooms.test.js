const assert = require("node:assert");
const { beforeEach, describe, it } = require("node:test");

const { createRooms } = require("../../../helpers/mewbeat/rooms");

const G = "g1";

// A clock that only moves when the test advances it, with timers that fire in order.
function fakeTime() {
  let time = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(run, ms) {
      const id = nextId++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].run();
      }
      time = target;
    },
  };
}

const profile = (id) => ({ id, username: id.toUpperCase(), avatarUrl: `https://a/${id}.png` });

function setup({ prepare } = {}) {
  const clock = fakeTime();
  const pushes = [];
  const rooms = createRooms({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    prepareTrack: prepare ?? (async ({ uri }) => ({
      audioKey: `youtube:${uri}:200000`,
      track: { title: `Song ${uri}`, artist: "Artist", durationMs: 200_000, artworkUrl: null, uri: `https://y/${uri}`, source: "youtube" },
    })),
    broadcast: (guildId, userIds, payload) => pushes.push({ guildId, userIds: [...userIds], payload }),
  });
  return { rooms, clock, pushes };
}

const memberOf = (rooms, userId) => rooms.snapshot(G).members.find((member) => member.userId === userId);
const phaseOf = (rooms) => rooms.snapshot(G).phase;
const result = (score, accuracy, difficulty = "normal") => ({ score, accuracy, grade: "A", difficulty });

describe("mewbeat rooms membership", () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it("creates the room on first join and makes that user host", () => {
    const { rooms } = ctx;
    assert.strictEqual(rooms.snapshot(G), null);
    assert.deepStrictEqual(rooms.join(G, profile("ann")), { ok: true });
    const room = rooms.snapshot(G);
    assert.strictEqual(room.hostId, "ann");
    assert.strictEqual(room.phase, "lobby");
    assert.deepStrictEqual(room.members, [{
      userId: "ann", username: "ANN", avatarUrl: "https://a/ann.png", difficulty: "normal",
      ready: false, loaded: false, spectator: false, submitted: false,
    }]);
    assert.deepStrictEqual(room.queue, []);
    assert.strictEqual(room.current, null);
    assert.strictEqual(room.startAt, null);
    assert.strictEqual(room.nextAt, null);
    assert.deepStrictEqual(room.results, []);
    assert.strictEqual(room.serverNow, ctx.clock.now());
  });

  it("broadcasts the snapshot to every member after a change", () => {
    const { rooms, pushes } = ctx;
    rooms.join(G, profile("ann"));
    pushes.length = 0;
    rooms.join(G, profile("bo"));
    assert.strictEqual(pushes.length, 1);
    assert.deepStrictEqual(pushes[0].userIds, ["ann", "bo"]);
    assert.strictEqual(pushes[0].guildId, G);
    assert.strictEqual(pushes[0].payload.type, "mewbeat_room");
    assert.strictEqual(pushes[0].payload.room.members.length, 2);
  });

  it("keeps one member when a user joins twice", () => {
    const { rooms } = ctx;
    rooms.join(G, profile("ann"));
    rooms.join(G, profile("ann"));
    assert.strictEqual(rooms.snapshot(G).members.length, 1);
  });

  it("keeps one room per guild", () => {
    const { rooms } = ctx;
    rooms.join("g1", profile("ann"));
    rooms.join("g2", profile("bo"));
    assert.strictEqual(rooms.snapshot("g1").members.length, 1);
    assert.strictEqual(rooms.snapshot("g2").hostId, "bo");
  });

  it("seats ten players and makes the rest spectators", () => {
    const { rooms } = ctx;
    for (let i = 0; i < 12; i += 1) rooms.join(G, profile(`u${i}`));
    const { members } = rooms.snapshot(G);
    assert.strictEqual(members.filter((member) => !member.spectator).length, 10);
    assert.deepStrictEqual(members.filter((member) => member.spectator).map((member) => member.userId), ["u10", "u11"]);
  });

  it("promotes the oldest spectator when a player leaves in the lobby", () => {
    const { rooms } = ctx;
    for (let i = 0; i < 12; i += 1) rooms.join(G, profile(`u${i}`));
    rooms.leave(G, "u3");
    const { members } = rooms.snapshot(G);
    assert.strictEqual(members.find((member) => member.userId === "u10").spectator, false);
    assert.strictEqual(members.find((member) => member.userId === "u11").spectator, true);
  });

  it("passes the host role to the oldest remaining member", () => {
    const { rooms } = ctx;
    rooms.join(G, profile("ann"));
    rooms.join(G, profile("bo"));
    rooms.join(G, profile("cy"));
    rooms.leave(G, "ann");
    assert.strictEqual(rooms.snapshot(G).hostId, "bo");
    rooms.leave(G, "cy");
    assert.strictEqual(rooms.snapshot(G).hostId, "bo");
  });

  it("tells the leaver the room is gone and the rest the new state", () => {
    const { rooms, pushes } = ctx;
    rooms.join(G, profile("ann"));
    rooms.join(G, profile("bo"));
    pushes.length = 0;
    assert.deepStrictEqual(rooms.leave(G, "bo"), { ok: true });
    assert.deepStrictEqual(pushes[0].userIds, ["bo"]);
    assert.strictEqual(pushes[0].payload.room, null);
    assert.deepStrictEqual(pushes[1].userIds, ["ann"]);
    assert.strictEqual(pushes[1].payload.room.members.length, 1);
    assert.deepStrictEqual(rooms.leave(G, "bo"), { ok: false, reason: "not_in_room" });
  });

  it("deletes an empty room and its timers", async () => {
    const { rooms, clock } = ctx;
    rooms.join(G, profile("ann"));
    await rooms.queueAdd(G, "ann", { uri: "a", source: "youtube" });
    rooms.start(G, "ann");
    assert.ok(clock.pending() > 0);
    rooms.leave(G, "ann");
    assert.strictEqual(rooms.snapshot(G), null);
    assert.strictEqual(clock.pending(), 0);
    // A new join starts a fresh lobby.
    rooms.join(G, profile("bo"));
    assert.strictEqual(phaseOf(rooms), "lobby");
    assert.deepStrictEqual(rooms.snapshot(G).queue, []);
  });

  it("stores ready and difficulty per member", () => {
    const { rooms } = ctx;
    rooms.join(G, profile("ann"));
    assert.deepStrictEqual(rooms.ready(G, "ann", { ready: true, difficulty: "hell" }), { ok: true });
    assert.strictEqual(memberOf(rooms, "ann").ready, true);
    assert.strictEqual(memberOf(rooms, "ann").difficulty, "hell");
    assert.deepStrictEqual(rooms.ready(G, "ann", { ready: false, difficulty: "impossible" }), { ok: false, reason: "bad_difficulty" });
    assert.deepStrictEqual(rooms.ready(G, "ghost", { ready: true }), { ok: false, reason: "not_in_room" });
  });
});

describe("mewbeat rooms queue", () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
    ctx.rooms.join(G, profile("ann"));
    ctx.rooms.join(G, profile("bo"));
    ctx.rooms.join(G, profile("cy"));
  });

  it("lets anyone add and records who did", async () => {
    const { rooms } = ctx;
    assert.deepStrictEqual(await rooms.queueAdd(G, "bo", { uri: "a", source: "youtube" }), { ok: true });
    assert.deepStrictEqual(rooms.snapshot(G).queue, [{
      audioKey: "youtube:a:200000", title: "Song a", artist: "Artist", durationMs: 200_000,
      artworkUrl: null, uri: "https://y/a", source: "youtube", addedBy: "bo",
    }]);
  });

  it("refuses non-members and relays the reason when the song can't be prepared", async () => {
    const failing = setup({ prepare: async () => { throw Object.assign(new Error("nope"), { reason: "not_found" }); } });
    failing.rooms.join(G, profile("ann"));
    assert.deepStrictEqual(await failing.rooms.queueAdd(G, "ann", { uri: "x" }), { ok: false, reason: "not_found" });
    assert.deepStrictEqual(failing.rooms.snapshot(G).queue, []);
    assert.deepStrictEqual(await ctx.rooms.queueAdd(G, "ghost", { uri: "a" }), { ok: false, reason: "not_in_room" });
  });

  // Five songs per member, so filling the queue takes several of them.
  async function fillQueue(rooms, count) {
    const users = ["ann", "bo", "cy", "dy", "ed"];
    for (const user of users.slice(3)) rooms.join(G, profile(user));
    for (let i = 0; i < count; i += 1) {
      assert.deepStrictEqual(await rooms.queueAdd(G, users[Math.floor(i / 5)], { uri: `s${i}` }), { ok: true });
    }
  }

  it("caps the queue at 20", async () => {
    const { rooms } = ctx;
    await fillQueue(rooms, 20);
    rooms.join(G, profile("fy"));
    assert.deepStrictEqual(await rooms.queueAdd(G, "fy", { uri: "extra" }), { ok: false, reason: "queue_full" });
    assert.strictEqual(rooms.snapshot(G).queue.length, 20);
  });

  it("caps the queue even for adds that were in flight together", async () => {
    const { rooms } = ctx;
    await fillQueue(rooms, 19);
    rooms.join(G, profile("fy"));
    rooms.join(G, profile("gy"));
    const outcomes = await Promise.all([rooms.queueAdd(G, "fy", { uri: "p" }), rooms.queueAdd(G, "gy", { uri: "q" })]);
    assert.deepStrictEqual(outcomes.map((outcome) => outcome.ok).sort(), [false, true]);
    assert.strictEqual(rooms.snapshot(G).queue.length, 20);
  });

  it("limits one member to 5 songs in the queue", async () => {
    const { rooms } = ctx;
    for (let i = 0; i < 5; i += 1) assert.deepStrictEqual(await rooms.queueAdd(G, "ann", { uri: `s${i}` }), { ok: true });
    assert.deepStrictEqual(await rooms.queueAdd(G, "ann", { uri: "sixth" }), { ok: false, reason: "queue_full" });
    assert.deepStrictEqual(await rooms.queueAdd(G, "bo", { uri: "other" }), { ok: true });
    // Removing one frees a slot.
    rooms.queueRemove(G, "ann", 0);
    assert.deepStrictEqual(await rooms.queueAdd(G, "ann", { uri: "again" }), { ok: true });
  });

  it("counts adds in flight against the per-member limit and starts no work for a full queue", async () => {
    let calls = 0;
    const slow = setup({ prepare: async ({ uri }) => {
      calls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return { audioKey: `youtube:${uri}:1`, track: { title: uri, uri, source: "youtube" } };
    } });
    slow.rooms.join(G, profile("ann"));
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => slow.rooms.queueAdd(G, "ann", { uri: `s${i}` })));
    assert.deepStrictEqual(outcomes.map((outcome) => outcome.ok), [true, true, true, true, true, false, false, false]);
    assert.strictEqual(calls, 5);
    assert.strictEqual(slow.rooms.snapshot(G).queue.length, 5);
  });

  it("lets the host or the adder remove an entry, nobody else", async () => {
    const { rooms } = ctx;
    await rooms.queueAdd(G, "bo", { uri: "a" });
    await rooms.queueAdd(G, "cy", { uri: "b" });
    await rooms.queueAdd(G, "bo", { uri: "c" });
    assert.deepStrictEqual(rooms.queueRemove(G, "cy", 0), { ok: false, reason: "forbidden" });
    assert.deepStrictEqual(rooms.queueRemove(G, "bo", 0), { ok: true }); // the adder
    assert.deepStrictEqual(rooms.queueRemove(G, "ann", 0), { ok: true }); // the host
    assert.deepStrictEqual(rooms.snapshot(G).queue.map((entry) => entry.title), ["Song c"]);
    assert.deepStrictEqual(rooms.queueRemove(G, "bo", 5), { ok: false, reason: "bad_index" });
    assert.deepStrictEqual(rooms.queueRemove(G, "bo", "0"), { ok: false, reason: "bad_index" });
  });

  it("never removes the song being played", async () => {
    const { rooms } = ctx;
    await rooms.queueAdd(G, "ann", { uri: "a" });
    rooms.start(G, "ann");
    assert.strictEqual(rooms.snapshot(G).current.title, "Song a");
    assert.deepStrictEqual(rooms.queueRemove(G, "ann", 0), { ok: false, reason: "bad_index" });
    assert.strictEqual(rooms.snapshot(G).current.title, "Song a");
  });

  it("lets spectators queue", async () => {
    const { rooms } = ctx;
    for (let i = 0; i < 9; i += 1) rooms.join(G, profile(`x${i}`));
    assert.strictEqual(memberOf(rooms, "x8").spectator, true);
    assert.deepStrictEqual(await rooms.queueAdd(G, "x8", { uri: "z" }), { ok: true });
  });
});

describe("mewbeat rooms rounds", () => {
  let ctx;
  beforeEach(async () => {
    ctx = setup();
    ctx.rooms.join(G, profile("ann"));
    ctx.rooms.join(G, profile("bo"));
    await ctx.rooms.queueAdd(G, "ann", { uri: "a" });
    await ctx.rooms.queueAdd(G, "bo", { uri: "b" });
  });

  const KEY_A = "youtube:a:200000";
  const KEY_B = "youtube:b:200000";

  it("only the host starts, and only with a song queued in lobby or intermission", async () => {
    const { rooms } = ctx;
    assert.deepStrictEqual(rooms.start(G, "bo"), { ok: false, reason: "not_host" });
    assert.deepStrictEqual(rooms.start(G, "ghost"), { ok: false, reason: "not_in_room" });
    const empty = setup();
    empty.rooms.join(G, profile("ann"));
    assert.deepStrictEqual(empty.rooms.start(G, "ann"), { ok: false, reason: "empty_queue" });
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: true });
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: false, reason: "wrong_phase" });
  });

  it("runs lobby, loading, countdown, playing, results, intermission and the next round", () => {
    const { rooms, clock } = ctx;
    const t0 = clock.now();
    rooms.start(G, "ann");
    let room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "loading");
    assert.strictEqual(room.current.audioKey, KEY_A);
    assert.deepStrictEqual(room.queue.map((entry) => entry.audioKey), [KEY_B]);

    assert.deepStrictEqual(rooms.loaded(G, "ann", "youtube:other:1"), { ok: false, reason: "wrong_track" });
    rooms.loaded(G, "ann", KEY_A);
    assert.strictEqual(phaseOf(rooms), "loading");
    assert.strictEqual(memberOf(rooms, "ann").loaded, true);
    rooms.loaded(G, "bo", KEY_A);

    room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "countdown");
    assert.strictEqual(room.startAt, t0 + 5000);

    clock.advance(4999);
    assert.strictEqual(phaseOf(rooms), "countdown");
    clock.advance(1);
    assert.strictEqual(phaseOf(rooms), "playing");

    clock.advance(30_000);
    rooms.submitted(G, "ann", result(900, 0.9));
    assert.strictEqual(phaseOf(rooms), "playing");
    assert.strictEqual(memberOf(rooms, "ann").submitted, true);
    rooms.submitted(G, "bo", result(1200, 0.8));

    room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "intermission");
    assert.strictEqual(room.nextAt, clock.now() + 15_000);
    assert.deepStrictEqual(room.results.map((entry) => [entry.userId, entry.username, entry.score]), [["bo", "BO", 1200], ["ann", "ANN", 900]]);
    assert.strictEqual(room.current.audioKey, KEY_A);

    clock.advance(14_999);
    assert.strictEqual(phaseOf(rooms), "intermission");
    clock.advance(1);
    room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "loading");
    assert.strictEqual(room.current.audioKey, KEY_B);
    assert.deepStrictEqual(room.queue, []);
    assert.deepStrictEqual(room.results, []);
    assert.strictEqual(room.nextAt, null);
    assert.strictEqual(memberOf(rooms, "ann").loaded, false);
    assert.strictEqual(memberOf(rooms, "ann").submitted, false);
  });

  it("falls back to the lobby when no song is left after a round", () => {
    const { rooms, clock } = ctx;
    rooms.queueRemove(G, "ann", 1); // the host drops "b": "a" is the last song
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(1, 0.5));
    rooms.submitted(G, "bo", result(2, 0.6));
    const room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "lobby");
    assert.strictEqual(room.nextAt, null);
    assert.strictEqual(room.results.length, 2);
    assert.strictEqual(clock.pending(), 0);
  });

  it("lets the host start the next song during the intermission", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(1, 0.5));
    rooms.submitted(G, "bo", result(2, 0.6));
    assert.strictEqual(phaseOf(rooms), "intermission");
    assert.deepStrictEqual(rooms.start(G, "bo"), { ok: false, reason: "not_host" });
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: true });
    assert.strictEqual(rooms.snapshot(G).current.audioKey, KEY_B);
    clock.advance(15_000); // the old auto-start timer must not restart the round
    assert.strictEqual(rooms.snapshot(G).current.audioKey, KEY_B);
    assert.strictEqual(phaseOf(rooms), "loading");
  });

  it("starts the countdown after 20 s when someone has not loaded", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    clock.advance(19_999);
    assert.strictEqual(phaseOf(rooms), "loading");
    clock.advance(1);
    const room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "countdown");
    assert.strictEqual(room.startAt, clock.now() + 5000);
  });

  it("puts the song back when nobody loaded it in time", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    clock.advance(20_000);
    const room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "lobby");
    assert.strictEqual(room.current, null);
    assert.deepStrictEqual(room.queue.map((entry) => entry.audioKey), [KEY_A, KEY_B]);
    assert.strictEqual(clock.pending(), 0);
  });

  it("ends the round when the song and the grace period are over", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(500, 0.7));
    clock.advance(200_000 + 9999);
    assert.strictEqual(phaseOf(rooms), "playing");
    clock.advance(1);
    const room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "intermission");
    assert.deepStrictEqual(room.results.map((entry) => entry.userId), ["ann"]);
  });

  it("does not wait for a player whose audio never loaded", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    clock.advance(20_000);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(500, 0.7));
    assert.strictEqual(phaseOf(rooms), "intermission");
  });

  it("ranks by score when everyone played the same difficulty", () => {
    const { rooms, clock } = ctx;
    rooms.ready(G, "ann", { difficulty: "hard" });
    rooms.ready(G, "bo", { difficulty: "hard" });
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(1000, 0.9, "hard"));
    rooms.submitted(G, "bo", result(1500, 0.8, "hard"));
    assert.deepStrictEqual(rooms.snapshot(G).results.map((entry) => entry.userId), ["bo", "ann"]);
  });

  it("ranks by accuracy when difficulties are mixed", () => {
    const { rooms, clock } = ctx;
    rooms.ready(G, "ann", { difficulty: "easy" });
    rooms.ready(G, "bo", { difficulty: "hell" });
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(1000, 0.97, "easy"));
    rooms.submitted(G, "bo", result(5000, 0.85, "hell"));
    const { results } = rooms.snapshot(G);
    assert.deepStrictEqual(results.map((entry) => [entry.userId, entry.difficulty]), [["ann", "easy"], ["bo", "hell"]]);
  });

  it("refuses submissions outside the round and repeats", () => {
    const { rooms, clock } = ctx;
    assert.deepStrictEqual(rooms.submitted(G, "ann", result(1, 0.5)), { ok: false, reason: "wrong_phase" });
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    assert.deepStrictEqual(rooms.submitted(G, "ann", { score: "x" }), { ok: false, reason: "bad_result" });
    rooms.submitted(G, "ann", result(1, 0.5));
    assert.deepStrictEqual(rooms.submitted(G, "ann", result(2, 0.6)), { ok: false, reason: "already_submitted" });
  });

  it("lets the round continue when a player leaves while loading", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.leave(G, "bo");
    assert.strictEqual(phaseOf(rooms), "countdown");
    assert.strictEqual(rooms.snapshot(G).startAt, clock.now() + 5000);
  });

  it("lets the round end when the last unfinished player leaves while playing", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(500, 0.7));
    rooms.leave(G, "bo");
    const room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "intermission"); // "b" is still queued
    assert.deepStrictEqual(room.results.map((entry) => entry.userId), ["ann"]);
  });

  it("keeps the result of a player who finished and then left", () => {
    const { rooms, clock } = ctx;
    rooms.join(G, profile("cy"));
    rooms.start(G, "ann");
    for (const user of ["ann", "bo", "cy"]) rooms.loaded(G, user, KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "bo", result(700, 0.7));
    rooms.leave(G, "bo");
    rooms.submitted(G, "ann", result(900, 0.9));
    rooms.submitted(G, "cy", result(100, 0.1));
    assert.deepStrictEqual(rooms.snapshot(G).results.map((entry) => entry.userId), ["ann", "bo", "cy"]);
  });

  it("does not wedge in loading when every player leaves", () => {
    const { rooms, clock } = ctx;
    rooms.join(G, profile("cy"));
    for (let i = 0; i < 9; i += 1) rooms.join(G, profile(`x${i}`));
    rooms.start(G, "ann");
    assert.strictEqual(memberOf(rooms, "x8").spectator, true);
    for (const user of ["ann", "bo", "cy", ...Array.from({ length: 7 }, (_, i) => `x${i}`)]) rooms.leave(G, user);
    // Only the two spectators remain: they take the free seats and the song goes back.
    assert.deepStrictEqual(rooms.snapshot(G).members.map((member) => member.userId), ["x7", "x8"]);
    assert.strictEqual(phaseOf(rooms), "lobby");
    assert.strictEqual(rooms.snapshot(G).current, null);
    assert.strictEqual(rooms.snapshot(G).queue.length, 2);
    assert.strictEqual(clock.pending(), 0);
  });

  it("makes someone who joins mid-round a spectator until the round is over", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.join(G, profile("cy"));
    assert.strictEqual(memberOf(rooms, "cy").spectator, true);
    assert.deepStrictEqual(rooms.loaded(G, "cy", KEY_A), { ok: false, reason: "spectator" });
    rooms.loaded(G, "ann", KEY_A);
    rooms.loaded(G, "bo", KEY_A);
    clock.advance(5000);
    rooms.submitted(G, "ann", result(1, 0.5));
    rooms.submitted(G, "bo", result(2, 0.6));
    assert.strictEqual(phaseOf(rooms), "intermission");
    assert.strictEqual(memberOf(rooms, "cy").spectator, false);
  });

  it("deletes the room and clears timers when the last member leaves mid-round", () => {
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    rooms.leave(G, "ann");
    rooms.leave(G, "bo");
    assert.strictEqual(rooms.snapshot(G), null);
    assert.strictEqual(clock.pending(), 0);
    clock.advance(60_000); // nothing fires into a deleted room
    assert.strictEqual(rooms.snapshot(G), null);
  });

  it("broadcasts when a timer changes the phase", () => {
    const { rooms, clock, pushes } = ctx;
    rooms.start(G, "ann");
    pushes.length = 0;
    rooms.loaded(G, "ann", KEY_A);
    pushes.length = 0;
    clock.advance(20_000);
    assert.strictEqual(pushes.length, 1);
    assert.strictEqual(pushes[0].payload.room.phase, "countdown");
  });
});

describe("mewbeat rooms review fixes", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const keyOf = (uri) => `youtube:${uri}:200000`;

  // A prepare that can be told to fail for some songs from now on.
  function flaky() {
    const broken = new Set();
    const calls = [];
    return {
      broken,
      calls,
      prepare: async ({ uri, source }) => {
        calls.push([uri, source]);
        if (broken.has(uri)) throw Object.assign(new Error("gone"), { reason: "not_found" });
        return {
          audioKey: keyOf(uri),
          track: { title: `Song ${uri}`, artist: "Artist", durationMs: 200_000, artworkUrl: null, uri, source: "youtube" },
        };
      },
    };
  }

  async function started(ctx, users = ["ann", "bo"]) {
    for (const user of users) ctx.rooms.join(G, profile(user));
    await ctx.rooms.queueAdd(G, "ann", { uri: "a" });
    await ctx.rooms.queueAdd(G, "ann", { uri: "b" });
  }

  function playRound(rooms, clock, users, key) {
    rooms.start(G, rooms.snapshot(G).hostId);
    for (const user of users) rooms.loaded(G, user, key);
    clock.advance(5000);
  }

  it("counts rounds and stamps the end of the last one", async () => {
    const ctx = setup();
    await started(ctx);
    const { rooms, clock } = ctx;
    let room = rooms.snapshot(G);
    assert.strictEqual(room.round, 0);
    assert.strictEqual(room.endedAt, null);

    playRound(rooms, clock, ["ann", "bo"], keyOf("a"));
    room = rooms.snapshot(G);
    assert.strictEqual(room.round, 1);
    assert.strictEqual(room.endedAt, null);
    rooms.submitted(G, "ann", result(1, 0.5));
    rooms.submitted(G, "bo", result(2, 0.5));
    room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "intermission");
    assert.strictEqual(room.endedAt, clock.now());

    clock.advance(15_000);
    room = rooms.snapshot(G);
    assert.strictEqual(room.round, 2);
    assert.strictEqual(room.endedAt, null);
  });

  it("clears endedAt when a round is aborted", async () => {
    const ctx = setup();
    await started(ctx);
    ctx.rooms.start(G, "ann");
    ctx.clock.advance(20_000);
    const room = ctx.rooms.snapshot(G);
    assert.strictEqual(room.phase, "lobby");
    assert.strictEqual(room.endedAt, null);
    assert.strictEqual(room.round, 1);
  });

  it("refuses the 51st member", () => {
    const { rooms } = setup();
    for (let i = 0; i < 50; i += 1) assert.deepStrictEqual(rooms.join(G, profile(`u${i}`)), { ok: true });
    assert.deepStrictEqual(rooms.join(G, profile("late")), { ok: false, reason: "room_full" });
    // Someone who is already in can still rejoin.
    assert.deepStrictEqual(rooms.join(G, profile("u3")), { ok: true });
    assert.strictEqual(rooms.snapshot(G).members.length, 50);
  });

  it("lets the new host start the next round after the host left mid-round", async () => {
    const ctx = setup();
    await started(ctx, ["ann", "bo", "cy"]);
    const { rooms, clock } = ctx;
    playRound(rooms, clock, ["ann", "bo", "cy"], keyOf("a"));
    rooms.leave(G, "ann");
    assert.strictEqual(rooms.snapshot(G).hostId, "bo");
    rooms.submitted(G, "bo", result(10, 0.5));
    rooms.submitted(G, "cy", result(20, 0.5));
    assert.strictEqual(phaseOf(rooms), "intermission");
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: false, reason: "not_in_room" });
    assert.deepStrictEqual(rooms.start(G, "bo"), { ok: true });
    assert.strictEqual(rooms.snapshot(G).current.audioKey, keyOf("b"));
    assert.strictEqual(phaseOf(rooms), "loading");
  });

  it("only takes loaded during the loading phase", async () => {
    const ctx = setup();
    await started(ctx);
    const { rooms, clock } = ctx;
    assert.deepStrictEqual(rooms.loaded(G, "ann", keyOf("a")), { ok: false, reason: "wrong_phase" }); // lobby
    rooms.start(G, "ann");
    rooms.loaded(G, "ann", keyOf("a"));
    rooms.loaded(G, "bo", keyOf("a"));
    assert.deepStrictEqual(rooms.loaded(G, "ann", keyOf("a")), { ok: false, reason: "wrong_phase" }); // countdown
    clock.advance(5000);
    assert.deepStrictEqual(rooms.loaded(G, "ann", keyOf("a")), { ok: false, reason: "wrong_phase" }); // playing
  });

  it("keeps the queue within its cap when a round is aborted", async () => {
    const ctx = setup();
    const { rooms, clock } = ctx;
    const users = ["ann", "bo", "cy", "dy", "ed"];
    for (const user of users) rooms.join(G, profile(user));
    for (let i = 0; i < 20; i += 1) await rooms.queueAdd(G, users[Math.floor(i / 5)], { uri: `s${i}` });
    rooms.start(G, "ann");
    assert.strictEqual(rooms.snapshot(G).queue.length, 19);
    // dy already has 5 queued; ann has 4 left (s0 is playing).
    assert.deepStrictEqual(await rooms.queueAdd(G, "dy", { uri: "late" }), { ok: false, reason: "queue_full" });
    assert.deepStrictEqual(await rooms.queueAdd(G, "ann", { uri: "late" }), { ok: true });
    assert.strictEqual(rooms.snapshot(G).queue.length, 20);
    clock.advance(20_000); // nobody loaded
    const room = rooms.snapshot(G);
    assert.strictEqual(room.phase, "lobby");
    assert.strictEqual(room.queue.length, 20);
    assert.strictEqual(room.queue[0].audioKey, keyOf("s0"));
    assert.strictEqual(room.queue.at(-1).audioKey, keyOf("s19")); // the tail ("late") made room
  });

  it("keeps ready when only the difficulty changes", () => {
    const { rooms } = setup();
    rooms.join(G, profile("ann"));
    rooms.ready(G, "ann", { ready: true });
    rooms.ready(G, "ann", { difficulty: "hell" });
    assert.strictEqual(memberOf(rooms, "ann").ready, true);
    assert.strictEqual(memberOf(rooms, "ann").difficulty, "hell");
  });

  it("scores a room result on the member's own difficulty and refuses another one", async () => {
    const ctx = setup();
    await started(ctx);
    const { rooms, clock } = ctx;
    rooms.ready(G, "ann", { difficulty: "hard" });
    playRound(rooms, clock, ["ann", "bo"], keyOf("a"));
    assert.deepStrictEqual(rooms.submitted(G, "ann", result(5, 0.5, "easy")), { ok: false, reason: "wrong_difficulty" });
    assert.strictEqual(memberOf(rooms, "ann").submitted, false);
    assert.deepStrictEqual(rooms.submitted(G, "ann", result(5, 0.5, "hard")), { ok: true });
    // No difficulty in the submit: the member's is used.
    rooms.submitted(G, "bo", { score: 6, accuracy: 0.5, grade: "A" });
    const entries = rooms.snapshot(G).results;
    assert.deepStrictEqual(entries.map((entry) => [entry.userId, entry.difficulty]).sort(), [["ann", "hard"], ["bo", "normal"]]);
  });

  describe("re-preparing the song when its round starts", () => {
    it("prepares the entry again with its own uri and source", async () => {
      const f = flaky();
      const ctx = setup({ prepare: f.prepare });
      await started(ctx);
      f.calls.length = 0;
      ctx.rooms.start(G, "ann");
      await flush();
      assert.deepStrictEqual(f.calls, [["a", "youtube"]]);
      assert.strictEqual(phaseOf(ctx.rooms), "loading");
      assert.strictEqual(ctx.rooms.snapshot(G).current.audioKey, keyOf("a"));
    });

    it("drops an entry that can't be prepared and goes on with the next one", async () => {
      const f = flaky();
      const ctx = setup({ prepare: f.prepare });
      await started(ctx);
      f.broken.add("a");
      ctx.rooms.start(G, "ann");
      await flush();
      const room = ctx.rooms.snapshot(G);
      assert.strictEqual(room.phase, "loading");
      assert.strictEqual(room.current.audioKey, keyOf("b"));
      assert.deepStrictEqual(room.queue, []);
      assert.strictEqual(room.round, 2);
      // Everyone is told, and only the new song's loading timer is running.
      assert.strictEqual(ctx.pushes.at(-1).payload.room.current.audioKey, keyOf("b"));
      assert.strictEqual(ctx.clock.pending(), 1);
    });

    it("falls back to the lobby when no queued song can be prepared", async () => {
      const f = flaky();
      const ctx = setup({ prepare: f.prepare });
      await started(ctx);
      f.broken.add("a");
      f.broken.add("b");
      ctx.rooms.start(G, "ann");
      await flush();
      const room = ctx.rooms.snapshot(G);
      assert.strictEqual(room.phase, "lobby");
      assert.strictEqual(room.current, null);
      assert.deepStrictEqual(room.queue, []);
      assert.strictEqual(ctx.clock.pending(), 0);
    });

    it("leaves a room alone that moved on while the song was being prepared", async () => {
      let hold = null;
      const f = flaky();
      const ctx = setup({ prepare: async (args) => {
        if (hold) await hold;
        return f.prepare(args);
      } });
      await started(ctx);
      f.broken.add("a");
      let release;
      hold = new Promise((resolve) => { release = resolve; });
      ctx.rooms.start(G, "ann");
      // While the song is being prepared everybody leaves and a new room opens.
      ctx.rooms.leave(G, "ann");
      ctx.rooms.leave(G, "bo");
      ctx.rooms.join(G, profile("cy"));
      release();
      await flush();
      const room = ctx.rooms.snapshot(G);
      assert.deepStrictEqual(room.members.map((member) => member.userId), ["cy"]);
      assert.strictEqual(room.phase, "lobby");
      assert.strictEqual(room.round, 0);
    });
  });
});
