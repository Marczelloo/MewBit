const assert = require("node:assert");
const { beforeEach, describe, it } = require("node:test");

const { createLiveBoard, EXPIRE_MS, PUSH_INTERVAL_MS } = require("../../../helpers/mewbeat/liveBoard");

const G = "g1";
const LIVE = "live:youtube:abc:200000";

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
const progress = (overrides) => ({
  session: LIVE, audioKey: "youtube:abc:200000", difficulty: "normal", score: 100, combo: 3, accuracy: 90, ended: false, ...overrides,
});

function setup() {
  const clock = fakeTime();
  const pushes = [];
  let members = [];
  const board = createLiveBoard({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    broadcast: (guildId, userIds, payload) => pushes.push({ guildId, userIds: [...userIds], payload, at: clock.now() }),
    membersOf: () => members,
  });
  const post = (userId, overrides) => board.update(G, userId, profile(userId), progress(overrides));
  return {
    board, clock, pushes, post, setMembers: (list) => { members = list; },
  };
}

const rowsOf = (push) => push.payload.entries.map((entry) => [entry.userId, entry.score]);

describe("mewbeat live board", () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it("pushes the entry to the session with the profile and the numbers", () => {
    assert.deepStrictEqual(ctx.post("ann", { score: 250, combo: 4, accuracy: 88.5, ended: true }), { ok: true });
    assert.strictEqual(ctx.pushes.length, 1);
    assert.deepStrictEqual(ctx.pushes[0].userIds, ["ann"]);
    assert.deepStrictEqual(ctx.pushes[0].payload, {
      type: "mewbeat_live_board",
      session: LIVE,
      entries: [{
        userId: "ann", username: "ANN", avatarUrl: "https://a/ann.png", difficulty: "normal", score: 250, combo: 4, accuracy: 88.5, vibe: null, fever: false, ended: true,
      }],
    });
  });

  it("passes the player's vibe and FEVER on to everyone in the session", () => {
    ctx.post("ann", { vibe: 0.75, fever: true });
    const [entry] = ctx.pushes[0].payload.entries;
    assert.deepStrictEqual([entry.vibe, entry.fever], [0.75, true]);
  });

  it("takes an update without vibe and FEVER, as an older client sends it", () => {
    assert.deepStrictEqual(ctx.post("ann"), { ok: true });
    const [entry] = ctx.pushes[0].payload.entries;
    assert.deepStrictEqual([entry.vibe, entry.fever], [null, false]);
  });

  it("keeps one entry per user however often or from however many sockets they post", () => {
    ctx.post("ann", { score: 100 });
    ctx.clock.advance(PUSH_INTERVAL_MS);
    ctx.post("ann", { score: 200 }); // a second window of the same user
    ctx.clock.advance(PUSH_INTERVAL_MS);
    ctx.post("bo", { score: 50 });
    const last = ctx.pushes.at(-1);
    assert.deepStrictEqual(rowsOf(last), [["ann", 200], ["bo", 50]]);
    assert.deepStrictEqual(last.userIds.sort(), ["ann", "bo"]);
  });

  describe("expiry", () => {
    it("drops an entry 5 s after its last update and pushes once for it", () => {
      ctx.post("ann", { score: 100 });
      ctx.clock.advance(1000);
      ctx.post("bo", { score: 50 });
      const before = ctx.pushes.length;
      ctx.clock.advance(EXPIRE_MS - 1000 - 1);
      assert.strictEqual(ctx.pushes.length, before); // ann's last update was 4999 ms ago
      ctx.clock.advance(1);
      assert.strictEqual(ctx.pushes.length, before + 1);
      assert.deepStrictEqual(rowsOf(ctx.pushes.at(-1)), [["bo", 50]]);
      assert.deepStrictEqual(ctx.pushes.at(-1).userIds, ["bo"]);
    });

    it("an update postpones it", () => {
      ctx.post("ann", { score: 100 });
      ctx.clock.advance(4000);
      ctx.post("ann", { score: 150 });
      ctx.clock.advance(4000);
      assert.deepStrictEqual(rowsOf(ctx.pushes.at(-1)), [["ann", 150]]);
      ctx.clock.advance(1000);
      // Nobody is left to push to, and no timer stays behind.
      assert.strictEqual(ctx.clock.pending(), 0);
    });

    it("clears every timer once the session empties", () => {
      ctx.post("ann");
      ctx.post("bo");
      ctx.clock.advance(EXPIRE_MS + 1000);
      assert.strictEqual(ctx.clock.pending(), 0);
    });
  });

  describe("throttle", () => {
    it("pushes at most every 250 ms and always delivers the last update", () => {
      ctx.post("ann", { score: 1 }); // leading push
      for (let step = 2; step <= 10; step++) {
        ctx.clock.advance(50);
        ctx.post("ann", { score: step });
      }
      ctx.clock.advance(PUSH_INTERVAL_MS);
      const times = ctx.pushes.map((push) => push.at);
      assert.ok(times.length >= 2 && times.length <= 4, `pushes: ${times.length}`);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= PUSH_INTERVAL_MS);
      assert.strictEqual(ctx.pushes.at(-1).payload.entries[0].score, 10);
    });

    it("holds a burst to 4 pushes per second", () => {
      for (let i = 0; i < 40; i++) {
        ctx.post("ann", { score: i });
        ctx.clock.advance(25);
      }
      ctx.clock.advance(PUSH_INTERVAL_MS);
      // 1 s of updates: the leading push, then one per interval.
      assert.ok(ctx.pushes.length <= 5, `pushes: ${ctx.pushes.length}`);
      assert.strictEqual(ctx.pushes.at(-1).payload.entries[0].score, 39);
    });

    it("pushes right away after a quiet spell", () => {
      ctx.post("ann", { score: 1 });
      ctx.clock.advance(1000);
      ctx.post("ann", { score: 2 });
      assert.strictEqual(ctx.pushes.length, 2);
      assert.strictEqual(ctx.pushes.at(-1).at, ctx.clock.now());
    });
  });

  describe("sessions", () => {
    it("keeps sessions apart", () => {
      ctx.post("ann", { score: 100 });
      ctx.post("bo", { session: "live:other:song:1", audioKey: "other:song:1", score: 70 });
      assert.deepStrictEqual(ctx.pushes.map((push) => [push.payload.session, push.userIds]), [[LIVE, ["ann"]], ["live:other:song:1", ["bo"]]]);
    });

    it("moves a user to a new session and out of the old one", () => {
      ctx.post("ann", { score: 100 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      ctx.post("bo", { score: 80 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      ctx.post("ann", { session: "live:other:song:1", audioKey: "other:song:1", score: 5 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      const oldBoard = ctx.pushes.filter((push) => push.payload.session === LIVE).at(-1);
      assert.deepStrictEqual(rowsOf(oldBoard), [["bo", 80]]);
      assert.deepStrictEqual(oldBoard.userIds, ["bo"]);
      assert.deepStrictEqual(rowsOf(ctx.pushes.at(-1)), [["ann", 5]]);
    });

    it("an emptied old session loses its timers", () => {
      ctx.post("ann");
      ctx.post("ann", { session: "live:other:song:1", audioKey: "other:song:1" });
      ctx.clock.advance(EXPIRE_MS + 1000);
      assert.strictEqual(ctx.clock.pending(), 0);
    });
  });

  describe("sorting", () => {
    it("ranks by score at one difficulty, ties by accuracy", () => {
      ctx.post("ann", { score: 100, accuracy: 99 });
      ctx.post("bo", { score: 300, accuracy: 70 });
      ctx.post("cy", { score: 100, accuracy: 95 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      assert.deepStrictEqual(ctx.pushes.at(-1).payload.entries.map((entry) => entry.userId), ["bo", "ann", "cy"]);
    });

    it("ranks by accuracy when difficulties are mixed", () => {
      ctx.post("ann", { difficulty: "hell", score: 900, accuracy: 80 });
      ctx.post("bo", { difficulty: "easy", score: 100, accuracy: 97 });
      ctx.post("cy", { difficulty: "hell", score: 500, accuracy: 80 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      assert.deepStrictEqual(ctx.pushes.at(-1).payload.entries.map((entry) => entry.userId), ["bo", "ann", "cy"]);
    });

    it("puts a player with no accuracy yet last when ranking by accuracy", () => {
      ctx.post("ann", { difficulty: "easy", accuracy: null, score: 0 });
      ctx.post("bo", { difficulty: "hard", accuracy: 10, score: 5 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      const entries = ctx.pushes.at(-1).payload.entries;
      assert.deepStrictEqual(entries.map((entry) => entry.userId), ["bo", "ann"]);
      assert.strictEqual(entries[1].accuracy, null);
    });
  });

  describe("room", () => {
    const room = (...spectators) => [
      { userId: "ann", spectator: false }, { userId: "bo", spectator: false },
      ...spectators.map((userId) => ({ userId, spectator: true })),
    ];

    it("reaches every member of the room, spectators included", () => {
      ctx.setMembers(room("sam"));
      ctx.post("ann", { session: "room", audioKey: undefined, score: 120 });
      assert.deepStrictEqual(ctx.pushes[0].userIds, ["ann", "bo", "sam"]);
      assert.strictEqual(ctx.pushes[0].payload.session, "room");
      assert.deepStrictEqual(rowsOf(ctx.pushes[0]), [["ann", 120]]);
    });

    it("refuses a user who is not in the room, or only watches", () => {
      ctx.setMembers(room("sam"));
      assert.deepStrictEqual(ctx.post("zed", { session: "room" }), { ok: false, reason: "not_in_room" });
      assert.deepStrictEqual(ctx.post("sam", { session: "room" }), { ok: false, reason: "spectator" });
      assert.strictEqual(ctx.pushes.length, 0);
    });

    it("tells the room when the last player's entry expires", () => {
      ctx.setMembers(room());
      ctx.post("ann", { session: "room", score: 10 });
      ctx.clock.advance(EXPIRE_MS);
      assert.deepStrictEqual(ctx.pushes.at(-1).payload.entries, []);
      assert.deepStrictEqual(ctx.pushes.at(-1).userIds, ["ann", "bo"]);
      ctx.clock.advance(1000);
      assert.strictEqual(ctx.clock.pending(), 0);
    });

    it("leaves out a player who left the room", () => {
      ctx.setMembers(room());
      ctx.post("ann", { session: "room", score: 10 });
      ctx.post("bo", { session: "room", score: 20 });
      ctx.setMembers([{ userId: "bo", spectator: false }]);
      ctx.clock.advance(PUSH_INTERVAL_MS);
      assert.deepStrictEqual(rowsOf(ctx.pushes.at(-1)), [["bo", 20]]);
    });
  });

  describe("remove", () => {
    it("drops the user's entry and tells the others", () => {
      ctx.post("ann", { score: 100 });
      ctx.post("bo", { score: 50 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      ctx.board.remove(G, "ann");
      ctx.clock.advance(PUSH_INTERVAL_MS);
      assert.deepStrictEqual(rowsOf(ctx.pushes.at(-1)), [["bo", 50]]);
      assert.deepStrictEqual(ctx.pushes.at(-1).userIds, ["bo"]);
    });

    it("ignores someone with no entry, and can be limited to one session", () => {
      ctx.board.remove(G, "nobody");
      ctx.post("ann");
      ctx.board.remove(G, "ann", "room");
      ctx.clock.advance(PUSH_INTERVAL_MS);
      assert.deepStrictEqual(rowsOf(ctx.pushes.at(-1)), [["ann", 100]]);
      ctx.board.remove(G, "ann", LIVE);
      ctx.clock.advance(EXPIRE_MS);
      assert.strictEqual(ctx.clock.pending(), 0);
    });

    it("clears the room board for the room's members", () => {
      ctx.setMembers([{ userId: "ann", spectator: false }, { userId: "bo", spectator: true }]);
      ctx.post("ann", { session: "room" });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      ctx.board.remove(G, "ann");
      ctx.clock.advance(PUSH_INTERVAL_MS);
      assert.deepStrictEqual(ctx.pushes.at(-1).payload.entries, []);
      assert.deepStrictEqual(ctx.pushes.at(-1).userIds, ["ann", "bo"]);
      assert.strictEqual(ctx.clock.pending(), 0);
    });
  });

  describe("validation", () => {
    it("rejects a bad session, audioKey or difficulty", () => {
      const reason = (overrides) => ctx.post("ann", overrides).reason;
      assert.strictEqual(reason({ session: "lobby" }), "bad_session");
      assert.strictEqual(reason({ session: "live:" }), "bad_session");
      assert.strictEqual(reason({ session: undefined }), "bad_session");
      assert.strictEqual(reason({ session: `live:${"x".repeat(300)}` }), "bad_session");
      assert.strictEqual(reason({ audioKey: "other:key:1" }), "bad_session");
      assert.strictEqual(reason({ difficulty: "insane" }), "bad_difficulty");
      assert.strictEqual(ctx.pushes.length, 0);
    });

    it("rejects numbers that aren't finite", () => {
      const reason = (overrides) => ctx.post("ann", overrides).reason;
      assert.strictEqual(reason({ score: NaN }), "bad_numbers");
      assert.strictEqual(reason({ score: "9" }), "bad_numbers");
      assert.strictEqual(reason({ combo: Infinity }), "bad_numbers");
      assert.strictEqual(reason({ accuracy: "high" }), "bad_numbers");
      assert.strictEqual(reason({ vibe: "full" }), "bad_numbers");
      assert.strictEqual(reason({ vibe: NaN }), "bad_numbers");
      assert.strictEqual(reason({ score: undefined }), "bad_numbers");
      assert.strictEqual(ctx.pushes.length, 0);
    });

    it("clamps numbers into range", () => {
      ctx.post("ann", { score: -50.4, combo: -3, accuracy: 140 });
      ctx.post("bo", { score: 1e15, combo: 12.6, accuracy: -5 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      const [bo, ann] = ctx.pushes.at(-1).payload.entries;
      assert.deepStrictEqual([ann.score, ann.combo, ann.accuracy], [0, 0, 100]);
      assert.deepStrictEqual([bo.score, bo.combo, bo.accuracy], [1_000_000_000, 13, 0]);
    });

    it("clamps vibe into 0..1", () => {
      ctx.post("ann", { score: 200, vibe: 3 });
      ctx.post("bo", { score: 100, vibe: -1 });
      ctx.clock.advance(PUSH_INTERVAL_MS);
      const [ann, bo] = ctx.pushes.at(-1).payload.entries;
      assert.deepStrictEqual([ann.vibe, bo.vibe], [1, 0]);
    });
  });
});
