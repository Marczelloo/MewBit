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
function harness({ durationSec = 200, state = "running", withTimestamp = true, outputLatency = 0, baseLatency = 0, fetchAudio, fetchClip, aligner, decode, measure, yieldToUi } = {}) {
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
        stoppedAt: null,
        playbackRate: {
          value: 1,
          ramps: [],
          cancelScheduledValues() {},
          setValueAtTime(value, at) { this.ramps.push({ value, at }); },
          linearRampToValueAtTime(value, at) { this.ramps.push({ value, at }); },
        },
        connect() {},
        disconnect() {},
        start(when, offset, length) {
          node.started = { when, offset, length };
        },
        stop(at) {
          node.stopped = true;
          node.stoppedAt = at ?? null;
        },
      };
      env.sources.push(node);
      return node;
    },
    decodeAudioData: async (data) => (decode ? decode(data) : {
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
    fetchClip,
    createContext: () => ctx,
    now: () => env.perf,
    aligner,
    ...(measure ? { measure } : {}),
    yieldToUi,
  });
  return { env, ctx, audio };
}

test("playSampleAt lands a sample at the perf time it should be heard, and can be cancelled", () => {
  const { env, audio } = harness();
  const sample = { duration: 0.1 };
  const cancel = audio.playSampleAt(sample, env.perf + 200, 0.5);
  const node = env.sources.at(-1);
  assert.equal(node.buffer, sample);
  assert.ok(Math.abs(node.started.when - 0.2) < 1e-6);
  assert.equal(env.gains.at(-1).gain.value, 0.5);
  cancel();
  assert.equal(node.stopped, true);
  // Already past: it plays at once rather than being scheduled in the past.
  env.perf += 1000;
  audio.playSampleAt(sample, env.perf - 100);
  assert.equal(env.sources.at(-1).started.when, 1);
});

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

test("a faster song plays with a higher rate and song time runs at that rate", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  audio.setRate(1.5);
  await audio.play(30_000);
  const node = env.sources.at(-1);
  assert.equal(node.playbackRate.value, 1.5);
  assert.equal(node.started.offset, 30, "the buffer offset stays in song seconds");
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - (30_000 - 75)) < 1e-6, "the 50 ms lead is 75 ms of song");
  env.perf += 2000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - (30_000 - 75 + 3000)) < 1e-6);
});

test("a rate leaves the normal start alone, and the silence before the song is shorter in real time", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(0);
  assert.equal(env.sources.at(-1).playbackRate.value, 1, "no rate set for 1x");
  audio.setRate(1.2);
  await audio.play(-2400);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 0);
  assert.ok(Math.abs(node.started.when - (0.05 + 2)) < 1e-6, "2400 ms of song is 2 s at 1.2x");
  env.perf += 2050;
  assert.ok(Math.abs(audio.songTimeAt(env.perf)) < 1e-6);
});

test("pause and resume keep the song position at a rate; a rate set meanwhile applies to the next start only", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  audio.setRate(0.85);
  await audio.play(10_000);
  env.perf += 1000;
  const paused = audio.pause();
  assert.ok(Math.abs(paused - (10_000 - 50 * 0.85 + 850)) < 1e-6);
  audio.setRate(1);
  await audio.resume();
  assert.equal(env.sources.at(-1).playbackRate.value, 1);
  env.perf += 1000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - (paused - 50 + 1000)) < 1e-6);
  assert.equal(audio.rate(), 1);
  audio.setRate(Number.NaN);
  assert.equal(audio.rate(), 1);
});

test("a lost run's music slows to a stop and the clock follows it down and then holds", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  await audio.play(0);
  env.perf += 1050; // song time 1000
  let ended = 0;
  audio.onEnded(() => { ended += 1; });
  audio.slowToStop(1);
  const node = env.sources.at(-1);
  assert.deepEqual(node.playbackRate.ramps.map((r) => r.value), [1, 0]);
  assert.ok(Math.abs(node.stoppedAt - (env.perf - 1000 + 1000) / 1000) < 1e-6, "stops when the ramp ends");
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 1000) < 1e-6);
  env.perf += 500; // area under the ramp: 0.5 - 0.125 s of song
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 1375) < 1e-6);
  env.perf += 5000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 1500) < 1e-6, "it stops half a second further on");
  node.onended?.();
  assert.equal(ended, 0, "the run is over, nothing hears an end");
  // A new play brings the clock back to the normal rate.
  await audio.play(0);
  env.perf += 1000;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 950) < 1e-6);
});

test("slowToStop does nothing when nothing plays, and a pause during it holds the position", async () => {
  const { env, audio } = harness();
  audio.slowToStop(1);
  await audio.load("k1");
  audio.slowToStop(1);
  assert.equal(env.sources.length, 0);
  await audio.play(0);
  env.perf += 1050;
  audio.slowToStop(1);
  env.perf += 500;
  assert.ok(Math.abs(audio.pause() - 1375) < 1e-6);
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
  await turn(); // the song's loudness scan finishes first, then play() asks the context to resume
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

test("a preview plays a 30 s window from the highlight beside the game and leaves its song and clock alone", async () => {
  const { env, audio } = harness();
  assert.equal(await audio.preview("k1", { fromMs: 50_000 }), true);
  assert.equal(audio.loadedKey(), null);
  assert.equal(audio.songTimeAt(env.perf), null);
  assert.equal(audio.playing(), false);
  const node = env.sources.at(-1);
  // It runs on from the highlight, and it fades in from silence.
  assert.equal(node.started.offset, 50);
  assert.equal(node.started.length, 30);
  assert.equal(env.gains.at(-1).ramps[0].value, 0);
  // At the end of the window it stops rather than going round again.
  const played = env.sources.length;
  node.onended();
  assert.equal(env.sources.length, played);
});

test("a preview with no known highlight starts 40% into the song", async () => {
  const { env, audio } = harness();
  await audio.preview("k1");
  assert.equal(env.sources.at(-1).started.offset, 80);
});

test("a newer pick aborts the older preview's download and starts its own at once", async () => {
  const releases = {};
  const signals = {};
  const asked = [];
  const { env, audio } = harness({
    fetchAudio: (key, signal) => {
      asked.push(key);
      signals[key] = signal;
      return new Promise((resolve) => { releases[key] = () => resolve(new ArrayBuffer(8)); });
    },
  });
  const first = audio.preview("a");
  await turn();
  const second = audio.preview("b");
  await turn();
  assert.deepEqual(asked, ["a", "b"], "b does not wait for a");
  assert.equal(signals.a.aborted, true);
  assert.equal(signals.b.aborted, false);
  releases.a();
  assert.equal(await first, false);
  releases.b();
  assert.equal(await second, true);
  assert.equal(env.sources.length, 1);
});

test("asking for the same song again joins the download in flight", async () => {
  let calls = 0;
  let release;
  const { audio } = harness({
    fetchAudio: () => { calls += 1; return new Promise((resolve) => { release = () => resolve(new ArrayBuffer(8)); }); },
  });
  const first = audio.preview("a");
  await turn();
  const second = audio.preview("a");
  await turn();
  release();
  assert.equal(await first, false, "the older call is superseded");
  assert.equal(await second, true);
  assert.equal(calls, 1);
});

test("a stopped preview never starts and aborts its download, and a failed one reports why", async () => {
  let release;
  let signal;
  const held = harness({ fetchAudio: (key, s) => { signal = s; return new Promise((resolve) => { release = () => resolve(new ArrayBuffer(8)); }); } });
  const pending = held.audio.preview("a");
  await turn();
  held.audio.stopClip();
  assert.equal(signal.aborted, true);
  release();
  assert.equal(await pending, false);
  assert.equal(held.env.sources.length, 0);

  const failing = harness({ fetchAudio: async () => { throw new Error("nope"); } });
  assert.deepEqual(await failing.audio.preview("a"), { error: "nope" });
  assert.deepEqual(failing.audio.previewError(), { key: "a", message: "nope" });
  assert.equal(failing.env.sources.length, 0);
});

test("with fetchClip a preview downloads the cut and plays from the highlight inside it", async () => {
  const asked = [];
  const { env, audio } = harness({
    durationSec: 35,
    fetchAudio: async () => { throw new Error("the whole song is not wanted"); },
    fetchClip: async (key, fromMs) => {
      asked.push([key, fromMs]);
      // The server cut starts 2.5 s before the highlight.
      return { data: new ArrayBuffer(8), clipped: true, clipStartMs: 97_500, fromMs: 100_000 };
    },
  });
  assert.equal(await audio.preview("k1", { fromMs: 100_000 }), true);
  assert.deepEqual(asked, [["k1", 100_000]]);
  const node = env.sources.at(-1);
  assert.equal(node.started.offset, 2.5);
  assert.equal(node.started.length, 30);
});

test("picking the previewed song again plays at once from the decoded cut", async () => {
  let fetches = 0;
  const { env, audio } = harness({
    durationSec: 35,
    fetchClip: async () => { fetches += 1; return { data: new ArrayBuffer(8), clipped: true, clipStartMs: 97_500, fromMs: 100_000 }; },
  });
  await audio.preview("k1", { fromMs: 100_000 });
  await audio.preview("k2", { fromMs: 10_000 });
  await audio.preview("k1", { fromMs: 100_000 });
  assert.equal(fetches, 3, "only the last one is kept");
  await audio.preview("k1", { fromMs: 100_000 });
  assert.equal(fetches, 3, "re-picking the last one fetches nothing");
  assert.equal(env.sources.at(-1).started.offset, 2.5);
  // Another stretch of the same song is another cut.
  await audio.preview("k1", { fromMs: 40_000 });
  assert.equal(fetches, 4);
});

test("a server that answers with the whole song is used whole, and kept for Play", async () => {
  const { env, audio } = harness({
    fetchClip: async () => ({ data: new ArrayBuffer(8), clipped: false }),
  });
  assert.equal(await audio.preview("k1", { fromMs: 50_000 }), true);
  assert.equal(env.sources.at(-1).started.offset, 50);
  await audio.load("k1");
  assert.deepEqual(env.fetches, [], "Play needs no second download");
});

test("a cut that will not decode falls back to the whole song", async () => {
  const calls = [];
  const { env, audio } = harness({
    durationSec: 200,
    fetchAudio: async (key) => { calls.push("whole"); return new ArrayBuffer(16); },
    fetchClip: async () => { calls.push("clip"); return { data: new ArrayBuffer(8), clipped: true, clipStartMs: 0, fromMs: 60_000 }; },
    decode: async (data) => {
      if (data.byteLength === 8) throw new Error("Unable to decode audio data");
      return { duration: 200, sampleRate: 100, length: 20_000, numberOfChannels: 2, getChannelData: () => new Float32Array(1) };
    },
  });
  assert.equal(await audio.preview("k1", { fromMs: 60_000 }), true);
  assert.deepEqual(calls, ["clip", "whole"]);
  assert.equal(env.sources.at(-1).started.offset, 60);
});

test("a preview of the song the game has loaded plays from its buffer, without a download", async () => {
  const { env, audio } = harness({
    fetchClip: async () => { throw new Error("no download expected"); },
  });
  await audio.load("k1");
  assert.equal(await audio.preview("k1", { fromMs: 20_000 }), true);
  assert.equal(env.sources.at(-1).started.offset, 20);
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

// An aligner whose answer the test gives by hand.
function manualAligner() {
  const calls = [];
  return {
    calls,
    closed: 0,
    align(request) {
      return new Promise((resolve) => calls.push({ request, resolve }));
    },
    close() { this.closed += 1; },
  };
}

test("alignInBackground sets the lag from the aligner, and play waits for it", async () => {
  const aligner = manualAligner();
  const { env, ctx, audio } = harness({ aligner });
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  const done = audio.alignInBackground(alignTimes);
  assert.equal(aligner.calls.length, 1);
  assert.equal(aligner.calls[0].request.key, "k1");
  assert.equal(aligner.calls[0].request.sampleRate, 1000);
  assert.deepEqual(aligner.calls[0].request.timesMs, alignTimes);
  let started = false;
  const playing = audio.play(1000).then(() => { started = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, false, "the source does not start before the lag is known");
  aligner.calls[0].resolve(30);
  assert.equal(await done, 30);
  await playing;
  assert.equal(env.sources.at(-1).started.offset, (1000 + 30) / 1000);
});

test("alignInBackground with no song loaded changes nothing", async () => {
  const aligner = manualAligner();
  const { audio } = harness({ aligner });
  assert.equal(await audio.alignInBackground(alignTimes), 0);
  assert.equal(aligner.calls.length, 0);
});

test("a superseded or null answer does not set the lag", async () => {
  const aligner = manualAligner();
  const { env, ctx, audio } = harness({ aligner });
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  const first = audio.alignInBackground(alignTimes);
  const second = audio.alignInBackground(alignTimes);
  aligner.calls[0].resolve(40);
  aligner.calls[1].resolve(null);
  await Promise.all([first, second]);
  await audio.play(0);
  assert.equal(env.sources.at(-1).started.offset, 0, "neither answer was kept");
});

test("a failing aligner leaves the lag alone and play goes on", async () => {
  const aligner = { align: () => Promise.reject(new Error("worker died")), close() {} };
  const { env, ctx, audio } = harness({ aligner });
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  assert.equal(await audio.alignInBackground(alignTimes), 0);
  await audio.play(0);
  assert.equal(env.sources.at(-1).started.offset, 0);
});

test("a late answer for a song that was replaced is dropped", async () => {
  const aligner = manualAligner();
  const { env, ctx, audio } = harness({ aligner });
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  const stale = audio.alignInBackground(alignTimes);
  await audio.load("k2");
  aligner.calls[0].resolve(35);
  await stale;
  await audio.play(0);
  assert.equal(env.sources.at(-1).started.offset, 0);
});

test("without an aligner alignInBackground is the sync align", async () => {
  const { env, ctx, audio } = harness();
  alignedSong(env, ctx, 30, alignTimes);
  await audio.load("k1");
  const lag = await audio.alignInBackground(alignTimes);
  near(lag, 30, 3);
  await audio.play(0);
  assert.equal(env.sources.at(-1).started.offset, lag / 1000);
});

test("close closes the aligner", async () => {
  const aligner = manualAligner();
  const { audio } = harness({ aligner });
  audio.close();
  assert.equal(aligner.closed, 1);
});

// Loudness normalisation. The context makes its gains in order: master volume, song bus, song level.
const MASTER = 0;
const SONG_LEVEL = 2;
let loudness;
test.before(async () => {
  loudness = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/loudness.js")).href);
});
const dbOf = (gain) => 20 * Math.log10(gain);
// A measurement that says the song sits `under` LU below the target (so it is lifted by that much).
const measuredUnder = (under, peakDb = -30) => async () => ({ lufs: loudness.TARGET_LUFS - under, peakDb });
const close = (actual, expected, slack, label = "") => assert.ok(Math.abs(actual - expected) <= slack, `${label} ${actual} is not within ${slack} of ${expected}`);

test("a loaded song plays through its loudness gain, a node of its own", async () => {
  const { env, audio } = harness({ measure: measuredUnder(6) });
  await audio.load("k1");
  await audio.play(0);
  const level = env.gains[SONG_LEVEL].gain.value;
  close(dbOf(level), 6, 1e-6);
  assert.equal(audio.songLevel().gain, level);
  // The music volume is the master gain alone: the two combine instead of replacing each other.
  audio.setVolume(musicGain(50));
  assert.equal(env.gains[MASTER].gain.value, musicGain(50));
  assert.equal(env.gains[SONG_LEVEL].gain.value, level);
});

test("every song is brought to the same loudness, each by its own gain", async () => {
  const lufs = { k1: -8, k2: -15, k3: -11 };
  let key = null;
  const { env, audio } = harness({
    measure: async () => ({ lufs: lufs[key], peakDb: -20 }),
    fetchAudio: async (k) => { key = k; return new ArrayBuffer(8); },
  });
  const heard = [];
  for (const k of ["k1", "k2", "k3"]) {
    await audio.load(k);
    await audio.play(0);
    heard.push(lufs[k] + dbOf(env.gains[SONG_LEVEL].gain.value));
  }
  for (const value of heard) close(value, loudness.TARGET_LUFS, 1e-6);
});

test("the loudness gain moves neither the start nor the song clock", async () => {
  const run = async (measure) => {
    const { env, audio } = harness({ measure });
    await audio.load("k1");
    await audio.play(1500);
    const started = { ...env.sources.at(-1).started };
    env.perf += 3000;
    return { started, time: audio.songTimeAt(env.perf) };
  };
  assert.deepEqual(await run(measuredUnder(7)), await run(measuredUnder(0)));
  assert.deepEqual(await run(measuredUnder(7)), await run(async () => { throw new Error("no scan"); }));
});

test("play waits for the measurement, so a song never starts at one level and moves to another", async () => {
  let finish;
  const { env, audio } = harness({ measure: () => new Promise((resolve) => { finish = resolve; }) });
  await audio.load("k1");
  const starting = audio.play(0);
  await turn();
  assert.equal(env.sources.length, 0, "not started yet");
  finish({ lufs: loudness.TARGET_LUFS - 6, peakDb: -30 });
  await starting;
  assert.equal(env.sources.length, 1);
  close(dbOf(env.gains[SONG_LEVEL].gain.value), 6, 1e-6);
});

test("the setting off plays the song as rendered and measures nothing; on again takes effect at once", async () => {
  let scans = 0;
  const { env, audio } = harness({ measure: async () => { scans += 1; return { lufs: loudness.TARGET_LUFS - 6, peakDb: -30 }; } });
  audio.setNormalize(false);
  await audio.load("k1");
  await audio.play(0);
  assert.equal(scans, 0);
  assert.equal(env.gains[SONG_LEVEL].gain.value, 1);
  assert.equal(audio.songLevel(), null);
  // Switched on while the song plays: it is measured and lifted without a restart.
  const source = env.sources.at(-1);
  audio.setNormalize(true);
  await turn();
  assert.equal(scans, 1);
  close(dbOf(env.gains[SONG_LEVEL].gain.value), 6, 1e-6);
  assert.equal(env.sources.at(-1), source, "the source was not restarted");
  audio.setNormalize(false);
  assert.equal(env.gains[SONG_LEVEL].gain.value, 1);
  audio.setNormalize(true);
  assert.equal(scans, 1, "a song is measured once");
  close(dbOf(env.gains[SONG_LEVEL].gain.value), 6, 1e-6);
});

test("a song that cannot be measured still plays, unchanged", async () => {
  const failing = [
    async () => { throw new Error("scan failed"); },
    async () => ({ lufs: null, peakDb: 0 }),
    () => { throw new Error("sync failure"); },
  ];
  for (const measure of failing) {
    const { env, audio } = harness({ measure });
    await audio.load("old-song");
    await audio.play(0);
    assert.equal(env.sources.length, 1);
    assert.equal(env.gains[SONG_LEVEL].gain.value, 1);
  }
  // A decoded buffer with no channel data to read plays unchanged as well.
  const { env, audio } = harness({ decode: async () => ({ duration: 10, sampleRate: 100, length: 1000, numberOfChannels: 2 }) });
  await audio.load("bare");
  await audio.play(0);
  assert.equal(env.sources.length, 1);
  assert.equal(env.gains[SONG_LEVEL].gain.value, 1);
});

test("the real measurement reads the decoded buffer: a quiet song is lifted, a loud one is lowered", async () => {
  const tone = (amp) => {
    const out = new Float32Array(48000 * 12);
    for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin((2 * Math.PI * 997 * i) / 48000);
    return out;
  };
  const gains = {};
  for (const [name, amp] of [["quiet", 0.01], ["loud", 0.5]]) {
    const data = tone(amp);
    const { env, audio } = harness({
      decode: async () => ({ duration: 12, sampleRate: 48000, length: data.length, numberOfChannels: 2, getChannelData: () => data }),
    });
    await audio.load(name);
    await audio.play(0);
    gains[name] = dbOf(env.gains[SONG_LEVEL].gain.value);
  }
  // A 0.01 tone is -40 LUFS: far under the target, so the boost cap holds. A 0.5 tone is -6 LUFS: lowered to the target.
  close(gains.quiet, loudness.MAX_BOOST_DB, 1e-6);
  close(gains.loud, loudness.TARGET_LUFS - (20 * Math.log10(0.5)), 0.1);
});

test("a preview and a highlight are lifted by their own gain, outside the clock", async () => {
  const { env, audio } = harness({ measure: measuredUnder(6) });
  assert.equal(await audio.preview("k1", { fromMs: 50_000, level: 0.5 }), true);
  close(env.gains.at(-1).ramps[1].value / 0.5, 10 ** (6 / 20), 1e-6);
  assert.equal(audio.songTimeAt(env.perf), null);
  await audio.load("k2");
  await audio.play(0);
  assert.equal(audio.highlight(60_000, { level: 0.5 }), true);
  close(env.gains.at(-1).ramps[1].value / 0.5, 10 ** (6 / 20), 1e-6);
  // With the setting off the clips are as rendered.
  audio.setNormalize(false);
  audio.highlight(60_000, { level: 0.5 });
  close(env.gains.at(-1).ramps[1].value, 0.5, 1e-9);
});
