const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createSoloAudio;

test.before(async () => {
  ({ createSoloAudio } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/soloAudio.js")).href
  ));
});

// A fake AudioContext driven by a manual perf clock: currentTime advances with perf time, no output latency
// unless asked for, and getOutputTimestamp pairs the context time with the matching perf time.
function harness({ durationSec = 200, state = "running", withTimestamp = true, outputLatency = 0, baseLatency = 0 } = {}) {
  const env = { perf: 1000, sources: [], resumeCalls: 0 };
  const ctx = {
    state,
    outputLatency,
    baseLatency,
    destination: {},
    get currentTime() {
      return (env.perf - 1000) / 1000;
    },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBufferSource: () => {
      const node = {
        buffer: null,
        started: null,
        stopped: false,
        connect() {},
        disconnect() {},
        start(when, offset) {
          node.started = { when, offset };
        },
        stop() {
          node.stopped = true;
        },
      };
      env.sources.push(node);
      return node;
    },
    decodeAudioData: async () => ({ duration: durationSec }),
    resume: async () => {
      env.resumeCalls += 1;
      ctx.state = "running";
    },
    close() {},
  };
  if (withTimestamp) {
    ctx.getOutputTimestamp = () => ({ contextTime: ctx.currentTime, performanceTime: env.perf });
  }
  const audio = createSoloAudio({
    fetchAudio: async () => new ArrayBuffer(8),
    createContext: () => ctx,
    now: () => env.perf,
  });
  return { env, ctx, audio };
}

test("plays from 0 and tracks song time on the context clock", async () => {
  const { env, audio } = harness();
  assert.equal(audio.songTimeAt(env.perf), null);
  await audio.load("k1");
  assert.equal(audio.durationMs(), 200_000);
  await audio.play(0);
  assert.equal(audio.songTimeAt(env.perf), 0);
  env.perf += 2500;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 2500) < 1e-6);
  // A perf time in the past or future maps through the same clock.
  assert.ok(Math.abs(audio.songTimeAt(env.perf + 100) - 2600) < 1e-6);
});

test("pause holds the position and resume continues from it", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(0);
  env.perf += 4000;
  assert.ok(Math.abs(audio.pause() - 4000) < 1e-6);
  env.perf += 10_000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 4000) < 1e-6);
  assert.equal(audio.playing(), false);
  await audio.resume();
  assert.equal(audio.playing(), true);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 4000) < 1e-6);
  env.perf += 1000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 5000) < 1e-6);
});

test("play(fromMs) starts at that offset", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(30_000);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 30);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 30_000) < 1e-6);
  env.perf += 500;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 30_500) < 1e-6);
});

test("a scheduled start reads negative until its perf time", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  env.perf += 1000; // context time is 1 s
  await audio.play(0, env.perf + 3000);
  const node = env.sources.at(-1);
  assert.ok(Math.abs(node.started.when - 4) < 1e-6);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 3000) < 1e-6);
  env.perf += 3000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf)) < 1e-6);
  env.perf += 1500;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 1500) < 1e-6);
});

test("without getOutputTimestamp the output latency is subtracted", async () => {
  const { env, audio } = harness({ withTimestamp: false, outputLatency: 0.05, baseLatency: 0.01 });
  await audio.load("k1");
  await audio.play(0);
  // The first sample was scheduled at currentTime but is heard 60 ms later.
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 60) < 1e-6);
  env.perf += 1000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 940) < 1e-6);
});

test("a suspended context is resumed before playing", async () => {
  const { env, audio } = harness({ state: "suspended" });
  await audio.load("k1");
  await audio.play(0);
  assert.equal(env.resumeCalls, 1);
  assert.equal(audio.playing(), true);
});

test("a context that stays suspended rejects instead of running silently", async () => {
  const { ctx, audio } = harness({ state: "suspended" });
  ctx.resume = async () => {};
  await audio.load("k1");
  await assert.rejects(() => audio.play(0), /blocked/i);
  assert.equal(audio.playing(), false);
});

test("stop clears the clock and a pause during resume() cancels the start", async () => {
  const { env, ctx, audio } = harness({ state: "suspended" });
  await audio.load("k1");
  let release;
  ctx.resume = () => new Promise((resolve) => { release = () => { ctx.state = "running"; resolve(); }; });
  const pending = audio.play(0);
  audio.stop();
  release();
  await pending;
  assert.equal(env.sources.length, 0);
  assert.equal(audio.songTimeAt(env.perf), null);
});

test("load caches the last song and shares an in-flight load", async () => {
  let fetches = 0;
  const env = { perf: 1000 };
  const ctx = {
    state: "running",
    currentTime: 0,
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    decodeAudioData: async () => ({ duration: 10 }),
    destination: {},
    close() {},
  };
  const audio = createSoloAudio({
    fetchAudio: async () => {
      fetches += 1;
      return new ArrayBuffer(1);
    },
    createContext: () => ctx,
    now: () => env.perf,
  });
  await Promise.all([audio.load("a"), audio.load("a")]);
  await audio.load("a");
  assert.equal(fetches, 1);
  assert.equal(audio.loadedKey(), "a");
});
