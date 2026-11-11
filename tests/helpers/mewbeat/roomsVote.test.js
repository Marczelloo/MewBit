const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createRooms, FINAL_COUNTDOWN_MS } = require("../../../helpers/mewbeat/rooms");

// The vote for the next map. It belongs to the time after a round: nothing starts by itself, the next round starts (after
// the final 5 s) once MORE THAN HALF of the players voted or the host forces it, and the lobby's Ready button is the same
// flag. Before the room's first round the lobby works as it always did (rooms.test.js); the section at the end here
// only checks where the two meet. See the header of helpers/mewbeat/rooms.js for who counts.

const G = "g1";

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

const profile = (id) => ({ id, username: id.toUpperCase(), avatarUrl: null });
const keyOf = (uri) => `youtube:${uri}:200000`;

function setup() {
  const clock = fakeTime();
  const rooms = createRooms({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    prepareTrack: async ({ uri }) => ({
      audioKey: keyOf(uri),
      track: { title: `Song ${uri}`, artist: "Artist", durationMs: 200_000, artworkUrl: null, uri: `https://y/${uri}`, source: "youtube" },
    }),
  });
  return { rooms, clock };
}

// A room of the given players (the first is the host) before its first round, with the given songs queued by the host.
async function firstRound(users, songs = ["a", "b"]) {
  const ctx = setup();
  for (const user of users) ctx.rooms.join(G, profile(user));
  for (const uri of songs) await ctx.rooms.queueAdd(G, users[0], { uri });
  return ctx;
}

// The same room right after its first round, on the results screen, with the given songs still queued. This is where
// the vote lives.
async function lobby(users, songs = ["a", "b"]) {
  const ctx = await firstRound(users, ["first", ...songs]);
  ctx.rooms.start(G, users[0]); // before the first round the host starts at once
  assert.strictEqual(snap(ctx.rooms).phase, "loading");
  playRound(ctx, users);
  assert.strictEqual(snap(ctx.rooms).phase, "lobby");
  return ctx;
}

const snap = (rooms) => rooms.snapshot(G);
const phaseOf = (rooms) => snap(rooms).phase;
const member = (rooms, userId) => snap(rooms).members.find((entry) => entry.userId === userId);
const voters = (rooms) => snap(rooms).members.filter((entry) => entry.ready).map((entry) => entry.userId);
const vote = (rooms, userId, ready = true) => rooms.ready(G, userId, { ready });
const result = (score) => ({ score, accuracy: 0.9, grade: "A", difficulty: "normal" });

// Runs the round that is up next with everyone who is a player, to the results.
function playRound(ctx, users) {
  const key = snap(ctx.rooms).current.audioKey;
  for (const user of users) ctx.rooms.loaded(G, user, key);
  ctx.clock.advance(3000);
  for (const user of users) ctx.rooms.submitted(G, user, result(100));
}

describe("mewbeat room vote: nothing starts by itself", () => {
  it("stays on the results screen with a song queued when nobody votes (the glitch)", async () => {
    const ctx = await lobby(["ann", "bo"]);
    const { rooms, clock } = ctx;

    const ended = snap(rooms);
    assert.strictEqual(ended.phase, "lobby");
    assert.strictEqual(ended.queue.length, 2); // "a" and "b" are waiting
    assert.strictEqual(ended.nextAt, null);
    assert.strictEqual(ended.finalCountdown, false);
    assert.strictEqual(clock.pending(), 0);

    clock.advance(30 * 60_000);
    const later = snap(rooms);
    assert.strictEqual(later.phase, "lobby");
    assert.strictEqual(later.round, 1);
    assert.strictEqual(later.nextAt, null);
    assert.deepStrictEqual(voters(rooms), []);
  });

  it("does not carry a vote from one round into the next wait", async () => {
    const ctx = await lobby(["ann", "bo"], ["a", "b", "c"]);
    const { rooms, clock } = ctx;
    vote(rooms, "ann");
    vote(rooms, "bo");
    clock.advance(FINAL_COUNTDOWN_MS); // the vote started round 2
    assert.strictEqual(phaseOf(rooms), "loading");
    assert.strictEqual(snap(rooms).round, 2);
    assert.deepStrictEqual(voters(rooms), []); // cleared when the round starts
    playRound(ctx, ["ann", "bo"]);
    assert.deepStrictEqual(voters(rooms), []); // and again when it ends
    assert.strictEqual(snap(rooms).nextAt, null);
    clock.advance(10 * 60_000);
    assert.strictEqual(snap(rooms).round, 2);
  });

  it("refuses a vote while a round runs, but accepts taking one back", async () => {
    const ctx = await lobby(["ann", "bo"]);
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    clock.advance(FINAL_COUNTDOWN_MS);
    for (const phase of ["loading", "countdown", "playing"]) {
      assert.strictEqual(phaseOf(rooms), phase);
      assert.deepStrictEqual(vote(rooms, "ann"), { ok: false, reason: "wrong_phase" });
      assert.strictEqual(member(rooms, "ann").ready, false);
      assert.deepStrictEqual(vote(rooms, "ann", false), { ok: true });
      if (phase === "loading") {
        rooms.loaded(G, "ann", keyOf("a"));
        rooms.loaded(G, "bo", keyOf("a"));
      } else if (phase === "countdown") {
        clock.advance(3000);
      }
    }
  });

  it("refuses a vote with nothing queued", async () => {
    const { rooms } = await lobby(["ann"], []);
    assert.deepStrictEqual(vote(rooms, "ann"), { ok: false, reason: "empty_queue" });
    assert.strictEqual(snap(rooms).votes, 0);
  });
});

describe("mewbeat room vote: more than half of the players", () => {
  const cases = [[1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [10, 6]];
  for (const [players, needed] of cases) {
    it(`needs ${needed} of ${players} players`, async () => {
      const users = Array.from({ length: players }, (_, i) => `u${i}`);
      const { rooms, clock } = await lobby(users);
      assert.strictEqual(snap(rooms).votesNeeded, needed);
      for (let i = 0; i < needed - 1; i += 1) vote(rooms, users[i]);
      assert.strictEqual(snap(rooms).votes, needed - 1);
      assert.strictEqual(snap(rooms).finalCountdown, false);
      assert.strictEqual(snap(rooms).nextAt, null);
      clock.advance(10 * 60_000);
      assert.strictEqual(phaseOf(rooms), "lobby");

      vote(rooms, users[needed - 1]);
      const room = snap(rooms);
      assert.strictEqual(room.votes, needed);
      assert.strictEqual(room.finalCountdown, true);
      assert.strictEqual(room.forced, false);
      assert.strictEqual(room.nextAt, clock.now() + FINAL_COUNTDOWN_MS);
      clock.advance(FINAL_COUNTDOWN_MS - 1);
      assert.strictEqual(phaseOf(rooms), "lobby");
      clock.advance(1);
      assert.strictEqual(phaseOf(rooms), "loading");
      assert.strictEqual(snap(rooms).current.audioKey, keyOf("a"));
    });
  }

  it("reports who voted in the member list and the count in the snapshot", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "bo");
    const room = snap(rooms);
    assert.deepStrictEqual(room.members.map((entry) => [entry.userId, entry.ready]), [["ann", false], ["bo", true], ["cy", false]]);
    assert.strictEqual(room.votes, 1);
    assert.strictEqual(room.votesNeeded, 2);
  });

  it("lets a player take the vote back before and during the final seconds", async () => {
    const { rooms, clock } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    vote(rooms, "bo");
    assert.strictEqual(snap(rooms).finalCountdown, true);
    clock.advance(2000);
    vote(rooms, "bo", false);
    const room = snap(rooms);
    assert.strictEqual(room.votes, 1);
    assert.strictEqual(room.finalCountdown, false);
    assert.strictEqual(room.nextAt, null);
    assert.strictEqual(clock.pending(), 0); // the 5 s timer is gone, not just hidden
    clock.advance(60_000);
    assert.strictEqual(phaseOf(rooms), "lobby");
    vote(rooms, "bo"); // and the vote can be cast again
    assert.strictEqual(snap(rooms).finalCountdown, true);
  });

  it("does not let a player vote twice", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    vote(rooms, "ann");
    assert.strictEqual(snap(rooms).votes, 1);
  });

  it("keeps the votes when the difficulty changes", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    rooms.ready(G, "ann", { difficulty: "hard" });
    assert.strictEqual(member(rooms, "ann").ready, true);
  });
});

describe("mewbeat room vote: the electorate is recounted", () => {
  it("recounts when a player leaves, so an absent player does not block forever", async () => {
    const { rooms, clock } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    assert.strictEqual(snap(rooms).votesNeeded, 2);
    rooms.leave(G, "cy"); // closed the Activity: one of two
    assert.strictEqual(snap(rooms).votesNeeded, 2);
    assert.strictEqual(snap(rooms).finalCountdown, false);
    rooms.leave(G, "bo"); // one of one
    const room = snap(rooms);
    assert.strictEqual(room.votesNeeded, 1);
    assert.strictEqual(room.finalCountdown, true);
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(phaseOf(rooms), "loading");
  });

  it("drops the vote of a player who leaves", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy", "dy"]);
    vote(rooms, "bo");
    vote(rooms, "cy");
    rooms.leave(G, "cy"); // 1 vote of 3 players is short of two
    const room = snap(rooms);
    assert.strictEqual(room.votes, 1);
    assert.strictEqual(room.votesNeeded, 2);
    assert.strictEqual(room.finalCountdown, false);
  });

  it("recounts when a player joins: a bigger room needs more votes", async () => {
    const { rooms, clock } = await lobby(["ann", "bo"]);
    vote(rooms, "ann");
    vote(rooms, "bo");
    clock.advance(1000);
    rooms.join(G, profile("cy")); // two of three still passes
    assert.strictEqual(snap(rooms).finalCountdown, true);
    assert.strictEqual(snap(rooms).votesNeeded, 2);
    rooms.join(G, profile("dy")); // two of four does not
    const room = snap(rooms);
    assert.strictEqual(room.votesNeeded, 3);
    assert.strictEqual(room.finalCountdown, false);
    assert.strictEqual(clock.pending(), 0);
    clock.advance(60_000);
    assert.strictEqual(phaseOf(rooms), "lobby");
  });

  it("counts the players who are still on the results screen", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    assert.strictEqual(snap(rooms).votesNeeded, 2);
    vote(rooms, "ann");
    assert.strictEqual(snap(rooms).finalCountdown, false); // bo and cy are reading, but they still count
    vote(rooms, "cy");
    assert.strictEqual(snap(rooms).finalCountdown, true);
  });

  it("does not count spectators, and a spectator can not vote", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy", "dy"]);
    rooms.ready(G, "cy", { spectate: true });
    rooms.ready(G, "dy", { spectate: true });
    assert.deepStrictEqual(vote(rooms, "cy"), { ok: false, reason: "spectating" });
    assert.strictEqual(snap(rooms).votesNeeded, 2); // two players
    vote(rooms, "ann");
    assert.strictEqual(snap(rooms).finalCountdown, false);
    vote(rooms, "bo");
    assert.strictEqual(snap(rooms).finalCountdown, true);
  });

  it("drops the vote of a player who switches to watching, and counts them again when they come back", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    rooms.ready(G, "ann", { spectate: true });
    assert.strictEqual(member(rooms, "ann").ready, false);
    assert.strictEqual(snap(rooms).votes, 0);
    assert.strictEqual(snap(rooms).votesNeeded, 2); // bo and cy
    rooms.ready(G, "ann", { spectate: false });
    assert.strictEqual(snap(rooms).votesNeeded, 2); // three players again
    assert.strictEqual(member(rooms, "ann").ready, false); // and their old vote did not come back
  });

  it("does not let a spectator who joined mid-round vote or count", async () => {
    const ctx = await lobby(["ann", "bo"]);
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    clock.advance(FINAL_COUNTDOWN_MS);
    rooms.join(G, profile("cy")); // arrives during the round: a spectator until it ends
    assert.strictEqual(member(rooms, "cy").spectator, true);
    playRound(ctx, ["ann", "bo"]);
    assert.strictEqual(member(rooms, "cy").spectator, false); // seated for the next map
    assert.strictEqual(snap(rooms).votesNeeded, 2);
  });
});

describe("mewbeat room vote: the host forces the start", () => {
  it("starts after the final 5 s without any vote", async () => {
    const { rooms, clock } = await lobby(["ann", "bo", "cy"]);
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: true });
    const room = snap(rooms);
    assert.strictEqual(room.phase, "lobby");
    assert.strictEqual(room.votes, 0);
    assert.strictEqual(room.finalCountdown, true);
    assert.strictEqual(room.forced, true);
    assert.strictEqual(room.nextAt, clock.now() + FINAL_COUNTDOWN_MS);
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(phaseOf(rooms), "loading");
  });

  it("is the way out when an absent player holds the vote under the majority", async () => {
    const { rooms, clock } = await lobby(["ann", "bo"]);
    vote(rooms, "bo"); // ann is away
    clock.advance(10 * 60_000);
    assert.strictEqual(phaseOf(rooms), "lobby");
    rooms.start(G, "ann");
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(phaseOf(rooms), "loading");
  });

  it("only works for the host", async () => {
    const { rooms } = await lobby(["ann", "bo"]);
    assert.deepStrictEqual(rooms.start(G, "bo"), { ok: false, reason: "not_host" });
    assert.strictEqual(snap(rooms).finalCountdown, false);
  });

  it("skips what is left of the countdown when pressed again, or when the vote already started it", async () => {
    const { rooms, clock } = await lobby(["ann", "bo"]);
    vote(rooms, "ann");
    vote(rooms, "bo");
    clock.advance(2000);
    rooms.start(G, "ann");
    assert.strictEqual(phaseOf(rooms), "loading");
    assert.strictEqual(snap(rooms).round, 2);
    clock.advance(60_000);
    assert.strictEqual(snap(rooms).round, 2); // the old timer did not start a second round
  });

  it("keeps counting down when votes are taken back, because the force needs none", async () => {
    const { rooms, clock } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "bo");
    rooms.start(G, "ann");
    vote(rooms, "bo", false);
    assert.strictEqual(snap(rooms).finalCountdown, true);
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(phaseOf(rooms), "loading");
  });

  it("does not carry over to the next map", async () => {
    const ctx = await lobby(["ann", "bo"], ["a", "b", "c"]);
    const { rooms, clock } = ctx;
    rooms.start(G, "ann");
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(snap(rooms).round, 2);
    assert.strictEqual(snap(rooms).forced, false);
    playRound(ctx, ["ann", "bo"]);
    assert.strictEqual(snap(rooms).forced, false);
    assert.strictEqual(snap(rooms).finalCountdown, false);
    clock.advance(10 * 60_000);
    assert.strictEqual(snap(rooms).round, 2);
  });

  it("is refused with nothing queued and in a round", async () => {
    const { rooms, clock } = await lobby(["ann"], []);
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: false, reason: "empty_queue" });
    await rooms.queueAdd(G, "ann", { uri: "a" });
    rooms.start(G, "ann");
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: false, reason: "wrong_phase" });
  });
});

describe("mewbeat room vote: the queue changes under it", () => {
  it("voids the votes when the song up next is removed", async () => {
    const { rooms, clock } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    vote(rooms, "bo");
    assert.strictEqual(snap(rooms).finalCountdown, true);
    rooms.queueRemove(G, "ann", 0);
    const room = snap(rooms);
    assert.strictEqual(room.queue[0].audioKey, keyOf("b"));
    assert.strictEqual(room.votes, 0);
    assert.strictEqual(room.finalCountdown, false);
    assert.strictEqual(clock.pending(), 0);
    clock.advance(60_000);
    assert.strictEqual(snap(rooms).round, 1);
  });

  it("voids the votes when the host moves another song to the front", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    rooms.queueMove(G, "ann", 1, 0);
    assert.strictEqual(snap(rooms).queue[0].audioKey, keyOf("b"));
    assert.strictEqual(snap(rooms).votes, 0);
    assert.deepStrictEqual(voters(rooms), []);
  });

  it("drops a forced start when the song up next changes", async () => {
    const { rooms, clock } = await lobby(["ann", "bo"]);
    rooms.start(G, "ann");
    rooms.queueMove(G, "ann", 1, 0);
    assert.strictEqual(snap(rooms).finalCountdown, false);
    assert.strictEqual(snap(rooms).forced, false);
    clock.advance(60_000);
    assert.strictEqual(snap(rooms).round, 1);
  });

  it("keeps the votes when a song is added behind or removed from behind the one up next", async () => {
    const { rooms } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    await rooms.queueAdd(G, "bo", { uri: "c" });
    assert.strictEqual(snap(rooms).votes, 1);
    rooms.queueRemove(G, "ann", 2);
    assert.strictEqual(snap(rooms).votes, 1);
    rooms.queueMove(G, "ann", 1, 1);
    assert.strictEqual(snap(rooms).votes, 1);
  });

  it("clears the votes and the clock when the queue runs empty", async () => {
    const { rooms, clock } = await lobby(["ann", "bo"], ["a"]);
    vote(rooms, "ann");
    vote(rooms, "bo");
    rooms.queueRemove(G, "ann", 0);
    const room = snap(rooms);
    assert.strictEqual(room.votes, 0);
    assert.strictEqual(room.finalCountdown, false);
    assert.strictEqual(clock.pending(), 0);
    await rooms.queueAdd(G, "ann", { uri: "z" }); // a new song starts a new vote, not an old one
    assert.strictEqual(snap(rooms).votes, 0);
    clock.advance(60_000);
    assert.strictEqual(snap(rooms).round, 1);
  });
});

describe("mewbeat room vote: solo flows", () => {
  it("lets a player alone start the next map with one vote", async () => {
    const ctx = await lobby(["ann"], ["a", "b"]);
    const { rooms, clock } = ctx;
    vote(rooms, "ann");
    assert.strictEqual(snap(rooms).votesNeeded, 1);
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(phaseOf(rooms), "loading");
    playRound(ctx, ["ann"]);
    assert.strictEqual(phaseOf(rooms), "lobby");
    assert.strictEqual(snap(rooms).nextAt, null);
    vote(rooms, "ann");
    clock.advance(FINAL_COUNTDOWN_MS);
    assert.strictEqual(snap(rooms).current.audioKey, keyOf("b"));
  });
});

describe("mewbeat room vote: where the first round ends and the vote begins", () => {
  it("keeps the lobby Ready before the first round: one of three opens the wait and nobody has to vote", async () => {
    const { rooms, clock } = await firstRound(["ann", "bo", "cy"]);
    assert.strictEqual(snap(rooms).voting, false);
    vote(rooms, "ann");
    const room = snap(rooms);
    assert.strictEqual(room.finalCountdown, false);
    assert.strictEqual(room.nextAt, clock.now() + 60_000); // the 60 s wait the first Ready opens
    clock.advance(60_000);
    assert.strictEqual(phaseOf(rooms), "loading"); // it ran out, with one Ready of three
  });

  it("keeps the lobby Ready before the first round: everyone ready cuts the wait to 5 s", async () => {
    const { rooms, clock } = await firstRound(["ann", "bo", "cy"]);
    vote(rooms, "ann");
    vote(rooms, "bo");
    assert.strictEqual(snap(rooms).finalCountdown, false); // two of three is a majority only after a round
    vote(rooms, "cy");
    assert.strictEqual(snap(rooms).finalCountdown, true);
    assert.strictEqual(snap(rooms).nextAt, clock.now() + FINAL_COUNTDOWN_MS);
  });

  it("starts at once on the host start before the first round, with no countdown", async () => {
    const { rooms } = await firstRound(["ann", "bo"]);
    assert.deepStrictEqual(rooms.start(G, "ann"), { ok: true });
    assert.strictEqual(phaseOf(rooms), "loading");
    assert.strictEqual(snap(rooms).finalCountdown, false);
  });

  it("takes Ready with nothing queued before the first round, and refuses it after a round", async () => {
    const first = await firstRound(["ann"], []);
    assert.deepStrictEqual(vote(first.rooms, "ann"), { ok: true });
    assert.strictEqual(snap(first.rooms).nextAt, null); // nothing to count down to
    const after = await lobby(["ann"], []);
    assert.deepStrictEqual(vote(after.rooms, "ann"), { ok: false, reason: "empty_queue" });
  });

  it("tells the clients which of the two it is in the snapshot", async () => {
    const ctx = await firstRound(["ann", "bo"]);
    assert.strictEqual(snap(ctx.rooms).voting, false);
    ctx.rooms.start(G, "ann");
    assert.strictEqual(snap(ctx.rooms).voting, false); // a round in progress is not a vote yet
    playRound(ctx, ["ann", "bo"]);
    assert.strictEqual(snap(ctx.rooms).voting, true);
  });

  it("makes the lobby Ready after a round the same flag as Play next, and starts nothing the others did not vote for", async () => {
    const { rooms, clock } = await lobby(["ann", "bo", "cy"]);
    vote(rooms, "ann"); // Play next on the results screen
    assert.strictEqual(member(rooms, "ann").ready, true);
    // bo is in the lobby view and has not pressed Ready: nothing starts, however long they stay there.
    clock.advance(10 * 60_000);
    assert.strictEqual(phaseOf(rooms), "lobby");
    assert.strictEqual(snap(rooms).nextAt, null);
    assert.strictEqual(member(rooms, "bo").ready, false);
    vote(rooms, "bo"); // Ready in the lobby view counts as the vote
    assert.strictEqual(snap(rooms).votes, 2);
    assert.strictEqual(snap(rooms).finalCountdown, true);
    vote(rooms, "bo", false); // and taking it back stops the countdown
    assert.strictEqual(snap(rooms).finalCountdown, false);
    assert.strictEqual(clock.pending(), 0);
  });

  it("stays in the window regime when the first round is aborted, and in the vote regime when a later one is", async () => {
    const first = await firstRound(["ann", "bo"]);
    first.rooms.start(G, "ann");
    first.clock.advance(140_000); // nobody loads the song
    assert.strictEqual(phaseOf(first.rooms), "lobby");
    assert.strictEqual(snap(first.rooms).voting, false);
    assert.strictEqual(snap(first.rooms).queue.length, 2); // the song went back to the front

    const later = await lobby(["ann", "bo"]);
    later.rooms.start(G, "ann");
    later.clock.advance(FINAL_COUNTDOWN_MS + 140_000);
    assert.strictEqual(phaseOf(later.rooms), "lobby");
    assert.strictEqual(snap(later.rooms).voting, true);
    assert.strictEqual(snap(later.rooms).nextAt, null);
  });
});
