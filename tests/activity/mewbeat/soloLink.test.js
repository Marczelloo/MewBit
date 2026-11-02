const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createSoloLink;

test.before(async () => {
  ({ createSoloLink } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/soloLink.js")).href
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

// A fake audio engine: play() hands out promises the test settles by hand.
function setup() {
  const scheduler = createScheduler();
  const sent = [];
  const plays = [];
  const calls = [];
  const audio = {
    unlock: () => Promise.resolve(),
    stop: () => calls.push("stop"),
    pause: () => {
      calls.push("pause");
      return 4000;
    },
    load: async () => ({ durationMs: 200_000 }),
    play: (fromMs) => {
      calls.push(`play:${fromMs}`);
      return new Promise((resolve, reject) => plays.push({ fromMs, resolve, reject }));
    },
    durationMs: () => 200_000,
    songTimeAt: () => 0,
    onEnded: () => () => {},
  };
  const link = createSoloLink({
    send: (payload) => {
      sent.push(payload);
      return true;
    },
    audio,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
  return { link, scheduler, sent, plays, calls, audio };
}

async function ready(env, audioKey = "k") {
  env.link.start();
  await env.link.begin(audioKey, { title: "T", durationMs: 200_000 });
  assert.equal(env.link.state().stage, "ready");
}

const chartReady = (audioKey = "k", difficulty = "normal") => ({ type: "mewbeat_chart", audioKey, difficulty, status: "ready", chart: { notes: [] } });

test("a chart reply alone does not start the count-in; chartAccepted does", async () => {
  const env = setup();
  await ready(env);
  env.link.requestChart("k", "normal");
  env.link.handle(chartReady());
  env.scheduler.advance(5000);
  assert.equal(env.link.state().stage, "ready");
  assert.equal(env.plays.length, 0);
  env.link.chartAccepted();
  assert.equal(env.link.state().stage, "countin");
  assert.equal(env.link.state().count, 3);
});

test("chartAccepted outside the ready stage does nothing", async () => {
  const env = setup();
  env.link.chartAccepted();
  assert.equal(env.link.state().stage, "idle");
  await ready(env);
  env.link.chartAccepted();
  env.link.chartAccepted(); // a second call during the count-in must not restart it
  env.scheduler.advance(500);
  assert.equal(env.link.state().count, 2);
});

test("the count-in runs 3-2-1, then plays from 0 and goes to playing", async () => {
  const env = setup();
  await ready(env);
  env.link.chartAccepted();
  env.scheduler.advance(500);
  assert.equal(env.link.state().count, 2);
  env.scheduler.advance(500);
  assert.equal(env.link.state().count, 1);
  env.scheduler.advance(500);
  assert.equal(env.plays.length, 1);
  assert.equal(env.plays[0].fromMs, 0);
  env.plays[0].resolve();
  await Promise.resolve();
  assert.equal(env.link.state().stage, "playing");
  assert.equal(env.link.songClock.paused(), false);
});

test("pausing during the count-in stops the audio start that is still pending", async () => {
  const env = setup();
  await ready(env);
  env.link.chartAccepted();
  env.scheduler.advance(1500); // play() is awaiting the context
  assert.equal(env.plays.length, 1);
  env.calls.length = 0;
  env.link.pause();
  assert.deepEqual(env.calls, ["stop"]);
  assert.equal(env.link.state().stage, "paused");
  env.plays[0].resolve();
  await Promise.resolve();
  assert.equal(env.link.state().stage, "paused");
  assert.equal(env.link.songClock.paused(), true);
});

test("a stale audio start never flips a newer count-in to playing", async () => {
  const env = setup();
  await ready(env);
  env.link.chartAccepted();
  env.scheduler.advance(1500);
  env.link.pause();
  env.link.resume();
  assert.equal(env.link.state().stage, "countin");
  env.plays[0].resolve(); // the first count-in's play settles late
  await Promise.resolve();
  assert.equal(env.link.state().stage, "countin");
  assert.equal(env.link.songClock.paused(), true);
  env.scheduler.advance(1500);
  assert.equal(env.plays.length, 2);
  env.plays[1].resolve();
  await Promise.resolve();
  assert.equal(env.link.state().stage, "playing");
});

test("a failed audio start stays paused with the reason", async () => {
  const env = setup();
  await ready(env);
  env.link.chartAccepted();
  env.scheduler.advance(1500);
  env.plays[0].reject(new Error("Audio is blocked."));
  await Promise.resolve();
  assert.equal(env.link.state().stage, "paused");
  assert.equal(env.link.state().error, "Audio is blocked.");
});
