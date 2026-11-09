const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createSoloAudio;
let musicGain;
let MUSIC_MAX_GAIN;

test.before(async () => {
  ({ createSoloAudio, musicGain, MUSIC_MAX_GAIN } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/soloAudio.js")).href
  ));
});

// A fake AudioContext driven by a manual perf clock: currentTime advances with perf time, no output latency
// unless asked for, and getOutputTimestamp pairs the context time with the matching perf time.
function harness({ durationSec = 200, state = "running", withTimestamp = true, outputLatency = 0, baseLatency = 0, fetchAudio } = {}) {
  const env = { perf: 1000, sources: [], gains: [], resumeCalls: 0, fetches: [] };
  const ctx = {
    state,
    outputLatency,
    baseLatency,
    destination: {},
    get currentTime() {
      return (env.perf - 1000) / 1000;
    },
    createGain: () => {
      const ramps = [];
      const node = {
        ramps,
        gain: {
          value: 1,
          cancelScheduledValues() {},
          setValueAtTime(value, at) { ramps.push({ value, at }); },
          linearRampToValueAtTime(value, at) { ramps.push({ value, at }); },
        },
        connect() {},
        disconnect() {},
      };
      env.gains.push(node);
      return node;
    },
    createBuffer: (channels, length, sampleRate) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      copyToChannel() {},
    }),
    createBufferSource: () => {
      const node = {
        buffer: null,
        started: null,
        stopped: false,
        connect() {},
        disconnect() {},
        start(when, offset, length) {
          node.started = { when, offset, length };
        },
        stop() {
          node.stopped = true;
        },
      };
      env.sources.push(node);
      return node;
    },
    decodeAudioData: async () => ({
      duration: durationSec,
      sampleRate: 100,
      length: durationSec * 100,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(durationSec * 100),
    }),
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
    fetchAudio: fetchAudio ?? (async (key) => {
      env.fetches.push(key);
      return new ArrayBuffer(8);
    }),
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
  // An immediate start is scheduled 50 ms ahead and the clock knows it.
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 50) < 1e-6);
  env.perf += 2500;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 2450) < 1e-6);
  // A perf time in the past or future maps through the same clock.
  assert.ok(Math.abs(audio.songTimeAt(env.perf + 100) - 2550) < 1e-6);
});

test("pause holds the position and resume continues from it", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(0);
  env.perf += 4000;
  assert.ok(Math.abs(audio.pause() - 3950) < 1e-6);
  env.perf += 10_000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 3950) < 1e-6);
  assert.equal(audio.playing(), false);
  await audio.resume();
  assert.equal(audio.playing(), true);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 3900) < 1e-6);
  env.perf += 1000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 4900) < 1e-6);
});

test("play(fromMs) starts at that offset", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(30_000);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 30);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 29_950) < 1e-6);
  env.perf += 500;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 30_450) < 1e-6);
});

test("a negative start waits in silence with the clock running, then the song plays from its beginning", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(-2000);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 0);
  assert.ok(Math.abs(node.started.when - 2.05) < 1e-6);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 2050) < 1e-6);
  env.perf += 2050;
  assert.ok(Math.abs(audio.songTimeAt(env.perf)) < 1e-6);
  env.perf += 500;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 500) < 1e-6);
});

test("a pause in the silence holds its negative position and resume waits out the rest", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(-2000);
  env.perf += 1050;
  assert.ok(Math.abs(audio.pause() + 1000) < 1e-6);
  env.perf += 10_000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 1000) < 1e-6);
  await audio.resume();
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 0);
  env.perf += 1050;
  assert.ok(Math.abs(audio.songTimeAt(env.perf)) < 1e-6);
});

test("a scheduled negative start plays the song that long after its perf time", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(-2000, env.perf + 3000);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 0);
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 5000) < 1e-6);
  env.perf += 5000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf)) < 1e-6);
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
  // The first sample is scheduled 50 ms ahead and heard 60 ms after that.
  assert.ok(Math.abs(audio.songTimeAt(env.perf) + 110) < 1e-6);
  env.perf += 1000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 890) < 1e-6);
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

test("an immediate start is scheduled 50 ms ahead of the context clock", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  env.perf += 1000;
  await audio.play(0);
  assert.ok(Math.abs(env.sources.at(-1).started.when - 1.05) < 1e-9);
});

test("a load that finishes after close() never creates an AudioContext", async () => {
  let contexts = 0;
  let release;
  const audio = createSoloAudio({
    fetchAudio: () => new Promise((resolve) => { release = () => resolve(new ArrayBuffer(1)); }),
    createContext: () => {
      contexts += 1;
      return { state: "running", currentTime: 0, createGain: () => ({ gain: { value: 1 }, connect() {} }), decodeAudioData: async () => ({ duration: 1 }), destination: {}, close() {} };
    },
  });
  const pending = audio.load("a");
  audio.close();
  release();
  await assert.rejects(pending, /superseded/i);
  assert.equal(contexts, 0);
  assert.equal(audio.loadedKey(), null);
});

test("close() and a newer load abort the download in flight", async () => {
  const signals = [];
  const audio = createSoloAudio({
    fetchAudio: (key, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
    createContext: () => ({ state: "running", currentTime: 0, createGain: () => ({ gain: { value: 1 }, connect() {} }), destination: {}, close() {} }),
  });
  audio.load("a").catch(() => {});
  audio.load("b").catch(() => {});
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  audio.close();
  assert.equal(signals[1].aborted, true);
});

const turn = () => new Promise((resolve) => { setImmediate(resolve); });

test("a preview plays to the song's end beside the game and leaves its song and clock alone", async () => {
  const { env, audio } = harness();
  assert.equal(await audio.preview("k1", { fromMs: 50_000 }), true);
  assert.equal(audio.loadedKey(), null);
  assert.equal(audio.songTimeAt(env.perf), null);
  assert.equal(audio.playing(), false);
  const node = env.sources.at(-1);
  // It runs on from the highlight, and it fades in from silence.
  assert.equal(node.started.offset, 50);
  assert.equal(node.started.length, 150);
  assert.equal(env.gains.at(-1).ramps[0].value, 0);
  // At the end of the song it stops rather than going round again.
  const played = env.sources.length;
  node.onended();
  assert.equal(env.sources.length, played);
});

test("a preview with no known highlight starts 40% into the song", async () => {
  const { env, audio } = harness();
  await audio.preview("k1");
  assert.equal(env.sources.at(-1).started.offset, 80);
});

test("a newer preview replaces an older one still downloading, and only one download runs at a time", async () => {
  const releases = {};
  const asked = [];
  const { env, audio } = harness({
    fetchAudio: (key) => {
      asked.push(key);
      return new Promise((resolve) => { releases[key] = () => resolve(new ArrayBuffer(8)); });
    },
  });
  const first = audio.preview("a");
  const second = audio.preview("b");
  await turn();
  assert.deepEqual(asked, ["a"]);
  releases.a();
  assert.equal(await first, false);
  await turn();
  assert.deepEqual(asked, ["a", "b"]);
  releases.b();
  assert.equal(await second, true);
  assert.equal(env.sources.length, 1);
});

test("a stopped preview never starts, and a failed one resolves false", async () => {
  let release;
  const held = harness({ fetchAudio: () => new Promise((resolve) => { release = () => resolve(new ArrayBuffer(8)); }) });
  const pending = held.audio.preview("a");
  await turn();
  held.audio.stopClip();
  release();
  assert.equal(await pending, false);
  assert.equal(held.env.sources.length, 0);

  const failing = harness({ fetchAudio: async () => { throw new Error("nope"); } });
  assert.equal(await failing.audio.preview("a"), false);
});

test("a previewed song isn't fetched again by Play or a second preview", async () => {
  const { env, audio } = harness();
  await audio.preview("k1");
  await audio.load("k1");
  await audio.preview("k1");
  assert.deepEqual(env.fetches, ["k1"]);
});

test("the game loading its song silences a clip at once", async () => {
  const { env, audio } = harness();
  await audio.preview("k1");
  const clip = env.sources.at(-1);
  await audio.load("k1");
  assert.equal(clip.stopped, true);
  assert.equal(audio.durationMs(), 200_000);
});

test("highlight plays the loaded song on from fromMs once, without touching the clock", async () => {
  const { env, audio } = harness();
  assert.equal(audio.highlight(60_000), false, "nothing loaded yet");
  await audio.load("k1");
  assert.equal(audio.highlight(60_000), true);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 60);
  assert.equal(node.started.length, 140);
  assert.equal(audio.songTimeAt(env.perf), null);
  node.onended();
  assert.equal(env.sources.at(-1), node);
  // A stopped clip fades out and stays stopped when its end arrives.
  audio.highlight(60_000);
  const next = env.sources.at(-1);
  audio.stopClip();
  assert.equal(next.stopped, true);
  next.onended();
  assert.equal(env.sources.at(-1), next);
});

test("a highlight takes over from an outro at once: the song fades but its clock runs on, and the next play is heard", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(190_000);
  const song = env.sources.at(-1);
  const bus = env.gains[1]; // master, then the song bus
  assert.equal(audio.highlight(60_000), true);
  assert.notEqual(env.sources.at(-1), song, "the clip starts now, it does not wait for the song to end");
  assert.equal(song.stopped, false, "the song keeps running, so the link still hears it end");
  assert.equal(audio.playing(), true);
  assert.equal(bus.ramps.at(-1).value, 0, "and it fades to silence");
  await audio.play(0);
  assert.equal(bus.ramps.at(-1).value, 1, "a new run is audible again");
});

test("a highlight near the end starts early enough to leave the window to hear, and none known falls back", async () => {
  const { env, audio } = harness({ durationSec: 100 });
  await audio.load("k1");
  audio.highlight(95_000);
  assert.equal(env.sources.at(-1).started.offset, 70);
  audio.highlight(null);
  assert.equal(env.sources.at(-1).started.offset, 40);
});

test("the music volume maps on a square curve under the ceiling", () => {
  assert.equal(musicGain(100), MUSIC_MAX_GAIN);
  assert.equal(musicGain(0), 0);
  assert.ok(Math.abs(musicGain(50) - MUSIC_MAX_GAIN / 4) < 1e-9);
  assert.ok(musicGain(5) < 0.002, "5% is close to silent");
  assert.equal(musicGain(150), MUSIC_MAX_GAIN);
  assert.equal(musicGain(-10), 0);
  assert.ok(musicGain(Number.NaN) > 0 && musicGain(Number.NaN) < MUSIC_MAX_GAIN);
});

// A decoded song of clicks at 1 kHz, the sounds `lag` ms from their notes.
function alignedSong(env, ctx, lag, times) {
  const samples = new Float32Array(40_000);
  for (const t of times) {
    for (let i = 0; i < 20; i += 1) samples[t + lag + i] = 0.8 * Math.exp(-i / 6);
  }
  ctx.decodeAudioData = async () => ({ duration: 40, sampleRate: 1000, length: 40_000, numberOfChannels: 1, getChannelData: () => samples });
}

const alignTimes = Array.from({ length: 60 }, (_, i) => 1000 + i * 500);
const near = (value, expected, slack = 0.0035) => assert.ok(Math.abs(value - expected) <= slack, `${value} near ${expected}`);

test("a song late against its chart plays from further in, on the chart's clock", async () => {
  const { env, ctx, audio } = harness();
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  const lag = audio.align(alignTimes);
  near(lag, 30, 3);
  await audio.play(1000);
  const { when, offset } = env.sources.at(-1).started;
  assert.equal(offset, (1000 + lag) / 1000);
  assert.ok(Math.abs(when - (ctx.currentTime + 0.05)) < 1e-6);
  // Song time is still chart time: fromMs is what plays at the start.
  env.perf += 50;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 1000) < 1e-6);
});

test("a song early against its chart waits a moment at the very start", async () => {
  const { env, ctx, audio } = harness();
  alignedSong(env, ctx, -30, alignTimes);
  await audio.load("k1");
  const lag = audio.align(alignTimes);
  near(lag, -30, 3);
  await audio.play(0);
  const { when, offset } = env.sources.at(-1).started;
  assert.equal(offset, 0);
  assert.ok(Math.abs(when - (0.05 - lag / 1000)) < 1e-6);
  env.perf += 50;
  assert.ok(Math.abs(audio.songTimeAt(env.perf)) < 1e-6, "the clock does not wait with it");
});

test("the lag holds across pause and resume, and goes with the song", async () => {
  const { env, ctx, audio } = harness();
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  const lag = audio.align(alignTimes);
  await audio.play(0);
  env.perf += 2050;
  const paused = audio.pause();
  await audio.resume();
  assert.ok(Math.abs(env.sources.at(-1).started.offset - (paused + lag) / 1000) < 1e-6);
  await audio.load("k1"); // the same song again keeps it
  await audio.play(0);
  assert.equal(env.sources.at(-1).started.offset, lag / 1000);
  await audio.load("k2");
  await audio.play(0);
  assert.equal(env.sources.at(-1).started.offset, 0);
});

test("align with no song loaded changes nothing", async () => {
  const { audio } = harness();
  assert.equal(audio.align(alignTimes), 0);
});
