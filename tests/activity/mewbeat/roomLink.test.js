const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createRoomLink;

test.before(async () => {
  ({ createRoomLink } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/roomLink.js")).href
  ));
});

function createScheduler() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
        }
        if (!next) break;
        timers.delete(next.id);
        time = next.timer.at;
        next.timer.fn();
      }
      time = end;
    },
    now: () => time,
  };
}

function setup({ loadFails = false } = {}) {
  const scheduler = createScheduler();
  const sent = [];
  const plays = [];
  const calls = [];
  const anchors = [];
  let onEnded = () => {};
  const audio = {
    unlock: () => Promise.resolve(),
    stop: () => calls.push("stop"),
    pause: () => 0,
    load: async (key) => {
      calls.push(`load:${key}`);
      if (loadFails) throw new Error("nope");
      return { durationMs: 200_000 };
    },
    play: (fromMs, whenPerfMs) => {
      calls.push(`play:${fromMs}:${whenPerfMs ?? "-"}`);
      return new Promise((resolve, reject) => plays.push({ fromMs, whenPerfMs, resolve, reject }));
    },
    align: (times) => calls.push(`align:${times.join(",")}`),
    durationMs: () => 200_000,
    songTimeAt: () => 0,
    onEnded: (fn) => {
      onEnded = fn;
      return () => {};
    },
  };
  const link = createRoomLink({
    send: (payload) => {
      sent.push(payload);
      return true;
    },
    audio,
    getUserId: () => "me",
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
  link.onAnchor((result) => anchors.push(result));
  link.start();
  return { link, scheduler, sent, plays, calls, anchors, fireEnded: () => onEnded() };
}

const member = (userId, extra = {}) => ({ userId, username: userId, avatarUrl: null, difficulty: "normal", ready: false, loaded: false, spectator: false, submitted: false, ...extra });
const current = { audioKey: "song", title: "Song", artist: "A", durationMs: 200_000, addedBy: "host" };
const snapshot = (extra = {}) => ({
  hostId: "host", phase: "loading", round: 1, endedAt: null, members: [member("host"), member("me")], queue: [], current,
  startAt: null, nextAt: null, results: [], serverNow: 1000, ...extra,
});
const loadedMe = [member("host", { loaded: true }), member("me", { loaded: true })];

async function loaded(env, extra = {}) {
  env.link.setRoom(snapshot(extra), env.scheduler.now());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.link.state().stage, "ready");
}

test("a loading snapshot loads the song, anchors a paused clock and reports loaded only after the chart is taken", async () => {
  const env = setup();
  await loaded(env);
  assert.deepEqual(env.anchors, ["init"]);
  assert.equal(env.link.songClock.audioKey(), "song");
  assert.equal(env.link.songClock.paused(), true);
  assert.equal(env.sent.some((m) => m.type === "mewbeat_room_loaded"), false);
  env.link.chartAccepted();
  assert.deepEqual(env.sent.filter((m) => m.type === "mewbeat_room_loaded"), [{ type: "mewbeat_room_loaded", id: "rl1", audioKey: "song" }]);
  assert.equal(env.link.state().stage, "waiting");
  assert.equal(env.link.state().prepared, true);
});

test("the accepted chart lines the audio up before the room hears it is loaded", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted({ notes: [{ t: 100 }, { t: 200 }] });
  assert.ok(env.calls.includes("align:100,200"));
  assert.equal(env.sent.filter((m) => m.type === "mewbeat_room_loaded").length, 1);
});

test("further loading snapshots of the same round do not reload", async () => {
  const env = setup();
  await loaded(env);
  env.link.setRoom(snapshot({ members: [member("host", { loaded: true }), member("me")] }), 0);
  assert.equal(env.calls.filter((c) => c.startsWith("load:")).length, 1);
  assert.deepEqual(env.anchors, ["init"]);
});

const spectatorMe = [member("host", { loaded: true }), member("me", { spectator: true })];

test("a spectator loads the round to watch it and never reports loaded", async () => {
  const env = setup();
  env.link.setRoom(snapshot({ members: spectatorMe }), 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.calls.filter((c) => c.startsWith("load:")), ["load:song"]);
  assert.equal(env.link.state().stage, "ready");
  assert.equal(env.link.state().spectating, true);
  env.link.chartAccepted();
  assert.equal(env.link.state().stage, "waiting");
  assert.equal(env.sent.some((m) => m.type === "mewbeat_room_loaded"), false);
  assert.equal(env.link.state().prepared, false);
});

test("a spectator plays along with the countdown although the server never counts them as loaded", async () => {
  const env = setup();
  env.link.setRoom(snapshot({ members: spectatorMe }), 0);
  await new Promise((resolve) => setImmediate(resolve));
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "countdown", members: spectatorMe, startAt: 6000, serverNow: 1000 }), 0);
  assert.deepEqual(env.calls.filter((c) => c.startsWith("play:")), ["play:0:5000"]);
  assert.equal(env.link.state().stage, "countdown");
  env.scheduler.advance(5000);
  assert.equal(env.link.state().stage, "playing");
  assert.equal(env.anchors.includes("snap"), false, "an on-time start needs no catching up");
});

test("a round with silence starts its clock before the song and the sound after the silence", async () => {
  const env = setup();
  await loaded(env, { silenceMs: 2000 });
  assert.equal(env.link.songClock.songTimeAt(0), -2000);
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "countdown", silenceMs: 2000, members: loadedMe, startAt: 6000, serverNow: 1000 }), 0);
  assert.deepEqual(env.calls.filter((c) => c.startsWith("play:")), ["play:-2000:5000"]);
  env.scheduler.advance(5000);
  assert.equal(env.link.state().stage, "playing");
  assert.equal(env.link.songClock.paused(), false);
});

test("the audio ending in a round puts the song clock at its end, which the game finishes the run on", async () => {
  const env = setup();
  await loaded(env, { silenceMs: 2000 });
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "countdown", silenceMs: 2000, members: loadedMe, startAt: 6000, serverNow: 1000 }), 0);
  env.scheduler.advance(5000);
  assert.equal(env.link.state().stage, "playing");
  assert.equal(env.link.songClock.atEnd(0), false);
  env.fireEnded();
  assert.equal(env.link.state().stage, "ended");
  assert.equal(env.link.songClock.atEnd(0), true);
});

test("a spectator who joins during the silence waits for the song with the others", async () => {
  const env = setup();
  env.scheduler.advance(7000);
  const room = snapshot({ phase: "playing", silenceMs: 2000, members: spectatorMe, startAt: 6000, serverNow: 7000 });
  env.link.setRoom(room, 7000);
  await new Promise((resolve) => setImmediate(resolve));
  env.link.chartAccepted();
  assert.deepEqual(env.calls.filter((c) => c.startsWith("play:")), ["play:-940:-"]);
});

test("a spectator who joins after the silence plays from where the song is", async () => {
  const env = setup();
  env.scheduler.advance(11_000);
  const room = snapshot({ phase: "playing", silenceMs: 2000, members: spectatorMe, startAt: 6000, serverNow: 11_000 });
  env.link.setRoom(room, 11_000);
  await new Promise((resolve) => setImmediate(resolve));
  env.link.chartAccepted();
  assert.deepEqual(env.calls.filter((c) => c.startsWith("play:")), ["play:3060:-"]);
});

test("a spectator who joins a song in progress starts at the song's true position, with no burst", async () => {
  const env = setup();
  const seen = [];
  env.link.onAnchor((kind) => seen.push([kind, env.link.songClock.songTimeAt(0), env.link.songClock.paused()]));
  env.scheduler.advance(7000);
  const room = snapshot({ phase: "playing", members: spectatorMe, startAt: 6000, serverNow: 7000 });
  env.link.setRoom(room, 7000);
  await new Promise((resolve) => setImmediate(resolve));
  env.link.chartAccepted();
  assert.equal(env.calls.find((c) => c.startsWith("play:")), "play:1060:-");
  // The run jumps to the position while the clock is still paused on it, and only then resumes.
  assert.deepEqual(seen.map(([kind]) => kind), ["init", "snap", "resume"]);
  assert.equal(seen[1][1], 1060);
  assert.equal(seen[1][2], true);
  assert.equal(seen[2][2], false);
  assert.equal(env.link.state().stage, "playing");
  assert.equal(env.sent.some((m) => m.type === "mewbeat_room_loaded"), false);
});

test("a player whose chart arrives after the loading phase becomes a spectator of that round", async () => {
  const env = setup();
  await loaded(env);
  env.link.setRoom(snapshot({ phase: "countdown", members: [member("host", { loaded: true }), member("me")], startAt: 6000 }), 0);
  env.link.chartAccepted();
  assert.equal(env.sent.some((m) => m.type === "mewbeat_room_loaded"), false);
  assert.equal(env.link.state().prepared, false);
  assert.equal(env.link.state().spectating, true);
  assert.deepEqual(env.calls.filter((c) => c.startsWith("play:")), ["play:0:5000"]);
});

test("a player who is loaded and counted keeps the player path", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  assert.equal(env.link.state().spectating, false);
  env.link.setRoom(snapshot({ phase: "countdown", members: loadedMe, startAt: 6000 }), 0);
  assert.equal(env.link.state().spectating, false);
  assert.equal(env.link.state().prepared, true);
  assert.equal(env.anchors.includes("snap"), false);
});

test("abandoning a spectated round clears spectating", async () => {
  const env = setup();
  env.link.setRoom(snapshot({ members: spectatorMe }), 0);
  await new Promise((resolve) => setImmediate(resolve));
  env.link.chartAccepted();
  assert.equal(env.link.state().spectating, true);
  env.link.setRoom(snapshot({ phase: "intermission", endedAt: 9000, members: spectatorMe, nextAt: 99_000 }), 100);
  assert.equal(env.link.state().spectating, false);
  assert.equal(env.link.state().stage, "idle");
  assert.equal(env.anchors.at(-1), "clear");
  env.link.setRoom(snapshot({ round: 2, members: spectatorMe }), 200);
  await new Promise((resolve) => setImmediate(resolve));
  env.link.leaveRound();
  assert.equal(env.link.state().spectating, false);
});

test("a player who turns spectator mid-loading is dropped and re-engages as a spectator", async () => {
  const env = setup();
  await loaded(env);
  env.link.setRoom(snapshot({ members: [member("host"), member("me", { spectator: true })] }), 10);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.link.state().spectating, true);
  assert.equal(env.calls.filter((c) => c.startsWith("load:")).length, 2);
});

test("countdown: the audio is scheduled at startAt on the audio clock and the run resumes just before", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  // serverNow 1000 at t=0, startAt 6000 -> 5000 ms on the local clock.
  env.link.setRoom(snapshot({ phase: "countdown", members: loadedMe, startAt: 6000, serverNow: 1000 }), 0);
  assert.deepEqual(env.calls.filter((c) => c.startsWith("play:")), ["play:0:5000"]);
  assert.equal(env.link.state().stage, "countdown");
  assert.equal(env.link.state().startPerf, 5000);
  assert.equal(env.link.state().playedRound, 1);
  env.scheduler.advance(4900);
  assert.deepEqual(env.anchors, ["init"]);
  env.scheduler.advance(100);
  assert.deepEqual(env.anchors, ["init", "resume"]);
  assert.equal(env.link.songClock.paused(), false);
  assert.equal(env.link.state().stage, "playing");
});

test("countdown is not scheduled twice by repeated snapshots", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  const room = snapshot({ phase: "countdown", members: loadedMe, startAt: 6000 });
  env.link.setRoom(room, 0);
  env.link.setRoom({ ...room }, 10);
  assert.equal(env.calls.filter((c) => c.startsWith("play:")).length, 1);
});

test("a player the server did not count as loaded does not start the audio", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "countdown", members: [member("host", { loaded: true }), member("me")], startAt: 6000 }), 0);
  assert.equal(env.calls.some((c) => c.startsWith("play:")), false);
});

test("a chart accepted after the loading phase is not reported", async () => {
  const env = setup();
  await loaded(env);
  env.link.setRoom(snapshot({ phase: "countdown", members: [member("host", { loaded: true }), member("me")], startAt: 6000 }), 0);
  env.link.chartAccepted();
  assert.equal(env.sent.some((m) => m.type === "mewbeat_room_loaded"), false);
  assert.equal(env.link.state().prepared, false);
});

test("a start already in the past plays from where the song is now", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  env.scheduler.advance(7000);
  env.link.setRoom(snapshot({ phase: "playing", members: loadedMe, startAt: 6000, serverNow: 7000 }), 7000);
  const play = env.calls.find((c) => c.startsWith("play:"));
  assert.equal(play, "play:1060:-");
  assert.equal(env.anchors.at(-1), "resume");
});

test("the round ending drops the run: audio stops and the game gets a clear", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "countdown", members: loadedMe, startAt: 6000 }), 0);
  env.link.setRoom(snapshot({ phase: "intermission", round: 1, endedAt: 9000, members: loadedMe, nextAt: 99_000 }), 100);
  assert.equal(env.anchors.at(-1), "clear");
  assert.equal(env.link.songClock.audioKey(), null);
  assert.equal(env.link.state().stage, "idle");
  assert.equal(env.link.state().playedRound, 1, "the round that was played is remembered for the standings");
  // the pending resume timer is gone
  env.scheduler.advance(10_000);
  assert.equal(env.anchors.includes("resume"), false);
});

test("a new round after a finished one loads again from a clean anchor", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "intermission", endedAt: 9000, members: loadedMe }), 0);
  env.link.setRoom(snapshot({ phase: "loading", round: 2, endedAt: null }), 100);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.anchors, ["init", "clear", "init"]);
  assert.equal(env.link.state().round, 2);
});

test("a failed load is reported nowhere and not retried on every snapshot", async () => {
  const env = setup({ loadFails: true });
  env.link.setRoom(snapshot(), 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(env.link.state().error, /load the song/);
  env.link.setRoom(snapshot({ members: [member("host", { loaded: true }), member("me")] }), 10);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.calls.filter((c) => c.startsWith("load:")).length, 1);
  assert.equal(env.sent.some((m) => m.type === "mewbeat_room_loaded"), false);
});

test("an audio start that fails drops the round with a message", async () => {
  const env = setup();
  await loaded(env);
  env.link.chartAccepted();
  env.link.setRoom(snapshot({ phase: "countdown", members: loadedMe, startAt: 6000 }), 0);
  env.plays[0].reject(new Error("blocked"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(env.link.state().error, /audio/);
  assert.equal(env.anchors.at(-1), "clear");
});

test("leaving the room (null snapshot) drops the run", async () => {
  const env = setup();
  await loaded(env);
  env.link.setRoom(null);
  assert.equal(env.anchors.at(-1), "clear");
  assert.equal(env.link.state().stage, "idle");
});

test("sitOut drops the round, keeps the room, and does not engage the same round again", async () => {
  const env = setup();
  await loaded(env);
  env.link.sitOut();
  assert.equal(env.anchors.at(-1), "clear");
  assert.equal(env.link.state().stage, "idle");
  env.link.setRoom(snapshot({ serverNow: 2000 }), env.scheduler.now());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.link.state().stage, "idle");
  assert.equal(env.calls.filter((c) => c.startsWith("load:")).length, 1);
  // the next round is joined as usual
  env.link.setRoom(snapshot({ round: 2 }), env.scheduler.now());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.link.state().stage, "ready");
});

test("leaveRound drops the run and ignores the stale snapshot", async () => {
  const env = setup();
  await loaded(env);
  env.link.leaveRound();
  assert.equal(env.anchors.at(-1), "clear");
  assert.equal(env.link.songClock.audioKey(), null);
});
