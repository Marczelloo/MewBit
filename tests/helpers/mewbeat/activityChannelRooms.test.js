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

  function setup({ postInvite, warmAudio } = {}) {
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
      now: () => time,
      resolveTrack: async (_guildId, { uri }) => (uri === "missing" ? null : { track: fakeTrack(uri), node: "n" }),
      scoreStore: createScoreStore({ file: path.join(dir, "scores.json"), now: () => time }),
      historyStore: createHistoryStore({ file: path.join(dir, "history.json"), now: () => time }),
      postInvite,
      warmAudio,
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

  describe("invite links and conversations", () => {
    const DM = "dm:instance1";
    const link = (send, profile, id = "link") => send(profile, { type: "mewbeat_room_invite", id, link: true });

    it("gives one code per room, and only to someone in it", async () => {
      const { send } = setup();
      assert.strictEqual((await link(send, ANN)).reason, "not_in_room");
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      const first = await link(send, ANN);
      assert.strictEqual(first.status, "ok");
      assert.strictEqual(typeof first.code, "string");
      assert.strictEqual((await link(send, ANN)).code, first.code);
    });

    it("joining by invite moves the socket out of its own room and into the invited one", async () => {
      const { channel, send, pushes } = setup();
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      const { code } = await link(send, ANN);
      const session = {};
      await channel.handle(DM, BO.id, { type: "mewbeat_room_join", id: "2" }, BO, session);

      const reply = await channel.handle(DM, BO.id, { type: "mewbeat_room_join", id: "3", invite: code }, BO, session);
      assert.strictEqual(reply.status, "ok");
      assert.strictEqual(session.roomScope, "g1");
      assert.deepStrictEqual(pushes.filter((push) => push.guildId === "g1").at(-1).userIds, ["ann", "bo"]);

      await send(ANN, { type: "mewbeat_room_queue_add", id: "3a", uri: "abc", source: "youtube" }); // a vote needs a song up next
      await channel.handle(DM, BO.id, { type: "mewbeat_room_ready", id: "4", ready: true }, BO, session);
      const member = pushes.filter((push) => push.guildId === "g1").at(-1).payload.room.members.find((m) => m.userId === "bo");
      assert.strictEqual(member.ready, true);

      await channel.handle(DM, BO.id, { type: "mewbeat_room_leave", id: "5" }, BO, session);
      assert.strictEqual(session.roomScope, undefined);
      assert.deepStrictEqual(pushes.filter((push) => push.guildId === "g1").at(-1).userIds, ["ann"]);
    });

    it("refuses a code that is unknown, past its time, or whose room is gone", async () => {
      const { channel, send, advance } = setup();
      const join = (code) => channel.handle(DM, BO.id, { type: "mewbeat_room_join", id: "2", invite: code }, BO, {});
      assert.strictEqual((await join("nope")).reason, "invite_expired");

      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      const { code } = await link(send, ANN);
      advance(6 * 60 * 60 * 1000);
      assert.strictEqual((await join(code)).reason, "invite_expired");

      const fresh = await link(send, ANN);
      await send(ANN, { type: "mewbeat_room_leave", id: "3" });
      assert.strictEqual((await join(fresh.code)).reason, "invite_expired");
    });

    it("leaves the socket unmoved when the invited room is full", async () => {
      const { channel, send } = setup();
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      const { code } = await link(send, ANN);
      for (let i = 0; i < 49; i += 1) await send({ id: `p${i}`, username: `P${i}` }, { type: "mewbeat_room_join", id: `j${i}` });
      const session = {};
      const reply = await channel.handle(DM, BO.id, { type: "mewbeat_room_join", id: "2", invite: code }, BO, session);
      assert.strictEqual(reply.reason, "room_full");
      assert.strictEqual(session.roomScope, undefined);
    });

    it("has no voice channel to post in from a conversation", async () => {
      const posted = [];
      const { channel } = setup({ postInvite: async (invite) => { posted.push(invite); return { ok: true }; } });
      await channel.handle(DM, ANN.id, { type: "mewbeat_room_join", id: "1" }, ANN);
      const reply = await channel.handle(DM, ANN.id, { type: "mewbeat_room_invite", id: "2" }, ANN);
      assert.strictEqual(reply.reason, "no_voice_channel");
      assert.deepStrictEqual(posted, []);
    });

    it("counts a run from a conversation globally and for no server", async () => {
      const { channel, send } = setup();
      const ask = (message) => channel.handle(DM, ANN.id, message, ANN);
      await ask({ type: "mewbeat_room_join", id: "1" });
      await ask({ type: "mewbeat_room_queue_add", id: "2", uri: "abc", source: "youtube" });
      const run = await ask({
        type: "mewbeat_submit", id: "3", mode: "solo", audioKey: KEY, difficulty: "hard", chartVersion: VERSION, events: perfectEvents(), fevers: [], flags: {},
      });
      assert.strictEqual(run.status, "ok");

      const board = (scope) => ({ type: "mewbeat_board", id: "4", audioKey: KEY, difficulty: "hard", scope, limit: 10 });
      assert.deepStrictEqual((await ask(board("global"))).entries.map((entry) => entry.userId), ["ann"]);
      assert.deepStrictEqual((await send(BO, board("server"))).entries, []);
    });

    it("a run from a conversation still finishes the round of the room it joined", async () => {
      const { channel, send, advance, lastRoom } = setup();
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      const { code } = await link(send, ANN);
      const session = {};
      await channel.handle(DM, BO.id, { type: "mewbeat_room_join", id: "2", invite: code }, BO, session);
      await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "abc", source: "youtube" });
      await send(ANN, { type: "mewbeat_room_ready", id: "4", difficulty: "hard" });
      await channel.handle(DM, BO.id, { type: "mewbeat_room_ready", id: "5", difficulty: "hard" }, BO, session);
      await send(ANN, { type: "mewbeat_room_start", id: "6" });
      advance(5000); // the host's start runs the final 5 s first
      await send(ANN, { type: "mewbeat_room_loaded", id: "7", audioKey: KEY });
      await channel.handle(DM, BO.id, { type: "mewbeat_room_loaded", id: "8", audioKey: KEY }, BO, session);
      advance(5000);
      assert.strictEqual(lastRoom().phase, "playing");

      await channel.handle(DM, BO.id, {
        type: "mewbeat_submit", id: "9", mode: "room", round: 1, audioKey: KEY, difficulty: "hard", chartVersion: VERSION, events: perfectEvents(), fevers: [], flags: {},
      }, BO, session);
      assert.strictEqual(lastRoom().members.find((member) => member.userId === "bo").submitted, true);
    });
  });

  it("needs an id like every mewbeat message", async () => {
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

  it("moves a queued song for the host and answers by reason", async () => {
    const { send, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "2", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "def", source: "youtube" });
    const titles = () => lastRoom().queue.map((entry) => entry.title);
    assert.deepStrictEqual(titles(), ["Song abc", "Song def"]);
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_room_queue_move", id: "4", from: 1, to: 0, audioKey: lastRoom().queue[1].audioKey }),
      { type: "mewbeat_room_queue_move", id: "4", status: "ok" },
    );
    assert.deepStrictEqual(titles(), ["Song def", "Song abc"]);
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_queue_move", id: "5", from: 0, to: 7 })).reason, "bad_index");
  });

  it("starts rendering a queued song's audio and survives a failed render", async () => {
    const warmed = [];
    const { send } = setup({
      warmAudio: async (audioKey, track, node) => {
        warmed.push([audioKey, track.info.identifier, node]);
        throw new Error("render failed");
      },
    });
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    const reply = await send(ANN, { type: "mewbeat_room_queue_add", id: "2", uri: "abc", source: "youtube" });
    assert.strictEqual(reply.status, "ok");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(warmed, [[KEY, "abc", "n"]]);
  });

  it("validates ready and answers errors with a reason", async () => {
    const { send, lastRoom } = setup();
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "1", ready: true })).reason, "not_in_room");
    await send(ANN, { type: "mewbeat_room_join", id: "2" });
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "3", ready: "yes" })).reason, "bad_request");
    // Nothing to vote for, nothing to start.
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "3c", ready: true })).reason, "empty_queue");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_start", id: "3d" })).reason, "empty_queue");
    await send(ANN, { type: "mewbeat_room_queue_add", id: "3e", uri: "abc", source: "youtube" });
    // A difficulty-only change keeps the ready state.
    await send(ANN, { type: "mewbeat_room_ready", id: "3a", ready: true });
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "3b", difficulty: "easy" })).status, "ok");
    const ann = lastRoom().members.find((member) => member.userId === "ann");
    assert.deepStrictEqual([ann.ready, ann.difficulty], [true, "easy"]);
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "4", ready: true, difficulty: "nope" })).reason, "bad_difficulty");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "5", ready: true, difficulty: "hell" })).status, "ok");
    assert.strictEqual((await send(BO, { type: "mewbeat_room_start", id: "6" })).reason, "not_in_room");
  });

  it("shows the room the modifiers a player picked, and refuses a tempo or a clash", async () => {
    const { send, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    const annOf = () => lastRoom().members.find((member) => member.userId === "ann");
    assert.deepStrictEqual(annOf().modifiers, []);
    await send(ANN, { type: "mewbeat_room_queue_add", id: "1a", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_ready", id: "2", ready: true });
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "3", modifiers: ["mr", "gn"] })).status, "ok");
    assert.deepStrictEqual([annOf().modifiers, annOf().ready], [["gn", "mr"], true], "in the list's order, the ready state kept");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "4", modifiers: ["fs"] })).reason, "solo_only");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "5", modifiers: ["nf", "ol"] })).reason, "conflict");
    assert.deepStrictEqual(annOf().modifiers, ["gn", "mr"], "a refused list changes nothing");
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_ready", id: "6", modifiers: [] })).status, "ok");
    assert.deepStrictEqual(annOf().modifiers, []);
  });

  it("passes spectate through, validates it, and runs the final seconds when the last Ready comes in", async () => {
    const { send, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    assert.strictEqual((await send(BO, { type: "mewbeat_room_ready", id: "3", spectate: "yes" })).reason, "bad_request");
    assert.deepStrictEqual(
      await send(BO, { type: "mewbeat_room_ready", id: "4", spectate: true }),
      { type: "mewbeat_room_ready", id: "4", status: "ok" },
    );
    const bo = () => lastRoom().members.find((member) => member.userId === "bo");
    assert.deepStrictEqual([bo().spectator, bo().watching], [true, true]);
    assert.deepStrictEqual(
      await send(BO, { type: "mewbeat_room_ready", id: "5", ready: true }),
      { type: "mewbeat_room_ready", id: "5", status: "error", reason: "spectating" },
    );

    await send(ANN, { type: "mewbeat_room_queue_add", id: "6", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_ready", id: "7", ready: true });
    assert.strictEqual(lastRoom().finalCountdown, true); // one player, one vote: the majority
    await send(ANN, { type: "mewbeat_room_start", id: "8" }); // the host skips what is left of the 5 s
    assert.strictEqual(lastRoom().phase, "loading");
    assert.deepStrictEqual(
      await send(ANN, { type: "mewbeat_room_ready", id: "9", spectate: true }),
      { type: "mewbeat_room_ready", id: "9", status: "error", reason: "in_round" },
    );
  });

  describe("invites", () => {
    const invite = (send, profile, id) => send(profile, { type: "mewbeat_room_invite", id });

    it("posts one invite for a member and rate-limits it per guild", async () => {
      const posts = [];
      const { send, advance } = setup({ postInvite: async (args) => { posts.push(args); return { ok: true }; } });
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      await send(BO, { type: "mewbeat_room_join", id: "2" });
      assert.deepStrictEqual(await invite(send, BO, "3"), { type: "mewbeat_room_invite", id: "3", status: "ok" });
      assert.deepStrictEqual(posts, [{
        guildId: "g1",
        userId: "bo",
        username: "Bo",
        avatarUrl: null,
        room: { title: null, artist: "", artworkUrl: null, players: 2, maxPlayers: 10, queued: 0, inRound: false },
      }]);

      advance(20_000);
      assert.deepStrictEqual(
        await invite(send, ANN, "4"),
        { type: "mewbeat_room_invite", id: "4", status: "error", reason: "cooldown", retryInMs: 40_000 },
      );
      assert.strictEqual(posts.length, 1);

      advance(40_000);
      assert.strictEqual((await invite(send, ANN, "5")).status, "ok");
      assert.strictEqual(posts.length, 2);
    });

    it("refuses a non-member without posting", async () => {
      const posts = [];
      const { send } = setup({ postInvite: async (args) => { posts.push(args); return { ok: true }; } });
      assert.deepStrictEqual(
        await invite(send, ANN, "1"),
        { type: "mewbeat_room_invite", id: "1", status: "error", reason: "not_in_room" },
      );
      assert.deepStrictEqual(posts, []);
    });

    it("reports a missing voice channel or a failed post and does not start the cooldown", async () => {
      let result = { ok: false, reason: "no_voice_channel" };
      const { send } = setup({ postInvite: async () => result });
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      assert.deepStrictEqual(
        await invite(send, ANN, "2"),
        { type: "mewbeat_room_invite", id: "2", status: "error", reason: "no_voice_channel" },
      );
      result = { ok: false, reason: "send_failed" };
      assert.strictEqual((await invite(send, ANN, "3")).reason, "send_failed");
      result = { ok: true };
      assert.strictEqual((await invite(send, ANN, "4")).status, "ok");
    });

    it("describes the queued song, then the song being played, for the invite", async () => {
      const posts = [];
      const { send, advance } = setup({ postInvite: async (args) => { posts.push(args); return { ok: true }; } });
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      await send(BO, { type: "mewbeat_room_join", id: "2" });
      await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "abc", source: "youtube" });
      await send(ANN, { type: "mewbeat_room_queue_add", id: "4", uri: "abc", source: "youtube" });
      await invite(send, ANN, "5");
      assert.deepStrictEqual(posts[0].room, {
        title: "Song abc", artist: "Artist", artworkUrl: null, players: 2, maxPlayers: 10, queued: 2, inRound: false,
      });
      assert.strictEqual(posts[0].avatarUrl, "https://a/ann.png");

      advance(60_000);
      await send(ANN, { type: "mewbeat_room_start", id: "6" });
      advance(5000); // the final seconds of the host's start
      await invite(send, BO, "7");
      assert.deepStrictEqual(posts[1].room, {
        title: "Song abc", artist: "Artist", artworkUrl: null, players: 2, maxPlayers: 10, queued: 1, inRound: true,
      });
    });

    it("treats a throwing poster as a failed send", async () => {
      const { send } = setup({ postInvite: async () => { throw new Error("boom"); } });
      await send(ANN, { type: "mewbeat_room_join", id: "1" });
      assert.strictEqual((await invite(send, ANN, "2")).reason, "send_failed");
    });
  });

  it("plays a room round and takes the room submit as the player's result", async () => {
    const { send, advance, lastRoom } = setup();
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_ready", id: "3a", difficulty: "hard" });
    await send(BO, { type: "mewbeat_room_ready", id: "3b", difficulty: "easy" });
    assert.strictEqual((await send(ANN, { type: "mewbeat_room_start", id: "4" })).status, "ok");
    assert.strictEqual(lastRoom().phase, "lobby"); // the final 5 s first
    advance(5000);
    assert.strictEqual(lastRoom().phase, "loading");
    assert.strictEqual(lastRoom().round, 1);
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
      round: 1,
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
    assert.strictEqual(room.endedAt, 1_010_000); // the 5 s of the host's start, then 5 s of countdown
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
    advance(5000);
    await send(ANN, { type: "mewbeat_room_loaded", id: "4", audioKey: KEY });
    advance(5000);
    // A solo run of the same song during the round doesn't finish the room's round.
    await send(ANN, {
      type: "mewbeat_submit", id: "5", mode: "solo", audioKey: KEY, difficulty: "hard", chartVersion: VERSION, events: perfectEvents(), fevers: [], flags: {},
    });
    assert.strictEqual(lastRoom().phase, "playing");
  });

  // Ann and Bo in a room with the same song queued twice, round 1 playing.
  async function playingRound() {
    const context = setup();
    const { send, advance, lastRoom } = context;
    await send(ANN, { type: "mewbeat_room_join", id: "1" });
    await send(BO, { type: "mewbeat_room_join", id: "2" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "3", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_queue_add", id: "4", uri: "abc", source: "youtube" });
    await send(ANN, { type: "mewbeat_room_ready", id: "5", difficulty: "hard" });
    await send(BO, { type: "mewbeat_room_ready", id: "6", difficulty: "hard" });
    await send(ANN, { type: "mewbeat_room_start", id: "7" });
    advance(5000);
    await send(ANN, { type: "mewbeat_room_loaded", id: "8", audioKey: KEY });
    await send(BO, { type: "mewbeat_room_loaded", id: "9", audioKey: KEY });
    const submit = (profile, id, extra) => send(profile, {
      type: "mewbeat_submit",
      id,
      mode: "room",
      round: lastRoom().round,
      audioKey: KEY,
      difficulty: "hard",
      chartVersion: VERSION,
      events: perfectEvents(),
      fevers: [],
      flags: {},
      ...extra,
    });
    return { ...context, submit, advance };
  }

  const submittedOf = (room, userId) => room.members.find((member) => member.userId === userId).submitted;

  it("scores but does not count a room submit that is early, stale or for another round", async () => {
    const { submit, advance, lastRoom } = await playingRound();
    // During the countdown nothing counts, though the run is still scored.
    const early = await submit(ANN, "10");
    assert.strictEqual(early.status, "ok");
    assert.strictEqual(early.result.ranked, true);
    assert.strictEqual(submittedOf(lastRoom(), "ann"), false);

    advance(5000);
    assert.strictEqual((await submit(ANN, "11", { round: 0 })).status, "ok");
    assert.strictEqual((await submit(ANN, "12", { round: 2 })).status, "ok");
    assert.strictEqual((await submit(ANN, "13", { round: undefined })).status, "ok");
    assert.strictEqual((await submit(ANN, "14", { round: "1" })).status, "ok");
    assert.strictEqual(submittedOf(lastRoom(), "ann"), false);

    // The right round counts.
    await submit(ANN, "15");
    assert.strictEqual(submittedOf(lastRoom(), "ann"), true);
  });

  it("does not let a submit from the previous round count in the next one with the same song", async () => {
    const { submit, send, advance, lastRoom } = await playingRound();
    advance(5000);
    await submit(ANN, "10");
    await submit(BO, "11");
    assert.strictEqual(lastRoom().phase, "lobby");
    advance(60_000);
    assert.strictEqual(lastRoom().round, 1); // nobody voted, so nothing starts
    await send(ANN, { type: "mewbeat_room_ready", id: "11a", ready: true });
    await send(BO, { type: "mewbeat_room_ready", id: "11b", ready: true });
    advance(5000);
    assert.strictEqual(lastRoom().round, 2);
    await send(ANN, { type: "mewbeat_room_loaded", id: "12", audioKey: KEY });
    await send(BO, { type: "mewbeat_room_loaded", id: "13", audioKey: KEY });
    advance(5000);
    assert.strictEqual(lastRoom().phase, "playing");
    // A late reply of round 1 still names round 1.
    assert.strictEqual((await submit(ANN, "14", { round: 1 })).status, "ok");
    assert.strictEqual(submittedOf(lastRoom(), "ann"), false);
    await submit(ANN, "15", { round: 2 });
    assert.strictEqual(submittedOf(lastRoom(), "ann"), true);
  });

  it("keeps autoplay runs and runs on another difficulty out of the room", async () => {
    const { submit, advance, lastRoom } = await playingRound();
    advance(5000);
    const auto = await submit(ANN, "10", { flags: { autoplay: true } });
    assert.strictEqual(auto.status, "ok");
    assert.strictEqual(auto.result.ranked, false);
    assert.strictEqual(submittedOf(lastRoom(), "ann"), false);

    // Ann chose hard in the room; an easy run is scored for her but not for the room.
    assert.strictEqual((await submit(ANN, "11", { difficulty: "easy" })).status, "ok");
    assert.strictEqual(submittedOf(lastRoom(), "ann"), false);
    await submit(ANN, "12");
    assert.strictEqual(submittedOf(lastRoom(), "ann"), true);
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
