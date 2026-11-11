const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let alignmentLagMs;
let formatSongOffset;
let MAX_APPLIED_OFFSET_MS;
let createSoloAudio;
let createSoloLink;
let createRoomLink;
let createMewbeatLink;

test.before(async () => {
  const dir = path.resolve(__dirname, "../../../activity/src/mewbeat");
  const load = (name) => import(pathToFileURL(path.join(dir, name)).href);
  ({ alignmentLagMs, formatSongOffset, MAX_APPLIED_OFFSET_MS } = await load("audioAlignment.js"));
  ({ createSoloAudio } = await load("soloAudio.js"));
  ({ createSoloLink } = await load("soloLink.js"));
  ({ createRoomLink } = await load("roomLink.js"));
  ({ createMewbeatLink } = await load("link.js"));
});

// ---- the sign convention -------------------------------------------------------------------------------------------
// audioOffsetMs (D) > 0: the chart lies later than the same sounds in the stored audio, so a note at chart time T is
// heard at audio time T - D. The song clock the game plays on is chart time, and soloAudio plays buffer time
// (chart time + lagMs), so lagMs = -D.

const on = { enabled: true, mode: "solo", calibration: false };

test("the lag is minus the offset: a chart later than the audio (+20) plays the audio 20 ms earlier into the buffer", () => {
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: 20 }), -20);
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: -40 }), 40);
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: -65 }), 65);
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: 40 }), -40);
});

test("a zero offset is a zero lag, never minus zero", () => {
  const lag = alignmentLagMs({ ...on, audioOffsetMs: 0 });
  assert.equal(lag, 0);
  assert.equal(Object.is(lag, -0), false);
});

test("rooms get the lag too", () => {
  assert.equal(alignmentLagMs({ ...on, mode: "room", audioOffsetMs: 20 }), -20);
});

test("nothing is applied when the setting is off", () => {
  for (const enabled of [false, undefined, null, 0, "on", 1]) {
    assert.equal(alignmentLagMs({ ...on, enabled, audioOffsetMs: 20 }), null, String(enabled));
  }
});

test("nothing is applied in Live, in an unknown mode, or on the calibration chart", () => {
  assert.equal(alignmentLagMs({ ...on, mode: "live", audioOffsetMs: 20 }), null);
  assert.equal(alignmentLagMs({ ...on, mode: undefined, audioOffsetMs: 20 }), null);
  assert.equal(alignmentLagMs({ ...on, calibration: true, audioOffsetMs: 20 }), null);
});

test("an unknown or unusable offset applies nothing", () => {
  for (const audioOffsetMs of [null, undefined, Number.NaN, Infinity, -Infinity, "20", {}, [], true]) {
    assert.equal(alignmentLagMs({ ...on, audioOffsetMs }), null, String(audioOffsetMs));
  }
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: MAX_APPLIED_OFFSET_MS + 1 }), null);
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: -MAX_APPLIED_OFFSET_MS - 1 }), null);
  assert.equal(alignmentLagMs({ ...on, audioOffsetMs: MAX_APPLIED_OFFSET_MS }), -MAX_APPLIED_OFFSET_MS);
});

test("formatSongOffset shows the sign the way the measurement has it", () => {
  assert.equal(formatSongOffset(20), "+20 ms");
  assert.equal(formatSongOffset(-40), "-40 ms");
  assert.equal(formatSongOffset(0), "0 ms");
  assert.equal(formatSongOffset(-0), "0 ms");
  assert.equal(formatSongOffset(-65), "-65 ms");
});

// ---- soloAudio.setLagMs --------------------------------------------------------------------------------------------

function harness({ aligner } = {}) {
  const env = { perf: 1000, sources: [] };
  const ctx = {
    state: "running",
    outputLatency: 0,
    baseLatency: 0,
    destination: {},
    get currentTime() {
      return (env.perf - 1000) / 1000;
    },
    createGain: () => ({
      gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {},
      disconnect() {},
    }),
    createBuffer: (channels, length, sampleRate) => ({ numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, copyToChannel() {} }),
    createBufferSource: () => {
      const node = {
        buffer: null,
        started: null,
        playbackRate: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
        start(when, offset, length) {
          node.started = { when, offset, length };
        },
        stop() {},
      };
      env.sources.push(node);
      return node;
    },
    decodeAudioData: async () => ({ duration: 200, sampleRate: 100, length: 20_000, numberOfChannels: 2, getChannelData: () => new Float32Array(20_000) }),
    resume: async () => {},
    close() {},
    getOutputTimestamp: () => ({ contextTime: ctx.currentTime, performanceTime: env.perf }),
  };
  const audio = createSoloAudio({
    fetchAudio: async () => new ArrayBuffer(8),
    createContext: () => ctx,
    now: () => env.perf,
    aligner,
  });
  return { env, ctx, audio };
}

const lastStart = (env) => env.sources.at(-1).started;

test("setLagMs plays the buffer that far ahead of the chart clock, like a measured scan would", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  assert.equal(audio.setLagMs(-20), -20);
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 0.98);
  // Song time is still chart time.
  env.perf += 50;
  assert.ok(Math.abs(audio.songTimeAt(env.perf) - 1000) < 1e-6);
});

test("a positive lag (audio with extra lead against its chart, D < 0) plays further into the buffer", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  audio.setLagMs(40);
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 1.04);
});

test("a lag that points before the start of the buffer waits a moment instead, as the scan does", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  audio.setLagMs(-30);
  await audio.play(0);
  const { when, offset } = lastStart(env);
  assert.equal(offset, 0);
  assert.ok(Math.abs(when - 0.08) < 1e-6);
});

test("the explicit lag holds across pause and resume and for the same song again, and goes with a new song", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  audio.setLagMs(-20);
  await audio.play(0);
  env.perf += 2050;
  const paused = audio.pause();
  await audio.resume();
  assert.ok(Math.abs(lastStart(env).offset - (paused - 20) / 1000) < 1e-6);
  await audio.load("k1");
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 0.98);
  await audio.load("k2");
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 1);
});

test("setLagMs with no song loaded, or a lag that is not a number, changes nothing", async () => {
  const { env, audio } = harness();
  assert.equal(audio.setLagMs(-20), 0);
  await audio.load("k1");
  assert.equal(audio.setLagMs(Number.NaN), 0);
  assert.equal(audio.setLagMs(undefined), 0);
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 1);
});

test("a later align() scan replaces the explicit lag, so the old behaviour is untouched when the new one is not used", async () => {
  const { env, audio } = harness();
  await audio.load("k1");
  audio.setLagMs(-20);
  // The silent buffer gives the scan nothing to find: it answers 0 and the explicit lag does not linger.
  assert.equal(audio.align([1000, 2000]), 0);
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 1);
});

test("alignInBackground also drops an explicit lag before it asks the aligner", async () => {
  const calls = [];
  const aligner = {
    align(request) {
      calls.push(request);
      return Promise.resolve(null);
    },
    close() {},
  };
  const { env, audio } = harness({ aligner });
  await audio.load("k1");
  audio.setLagMs(-20);
  await audio.alignInBackground([1000, 2000]);
  assert.equal(calls.length, 1);
  await audio.play(1000);
  assert.equal(lastStart(env).offset, 1);
});

// ---- soloLink.chartAccepted ----------------------------------------------------------------------------------------

function soloSetup({ withSetLag = true } = {}) {
  const calls = [];
  const audio = {
    unlock: () => Promise.resolve(),
    stop() {},
    pause: () => 0,
    load: async () => ({ durationMs: 200_000 }),
    align: (times) => calls.push(`align:${times.join()}`),
    play: () => new Promise(() => {}),
    durationMs: () => 200_000,
    songTimeAt: () => 0,
    onEnded: () => () => {},
  };
  if (withSetLag) audio.setLagMs = (ms) => calls.push(`setLagMs:${ms}`);
  const link = createSoloLink({ send: () => true, audio, now: () => 0, setTimer: () => 1, clearTimer: () => {} });
  return { link, calls };
}

async function soloReady(env) {
  env.link.start();
  await env.link.begin("k", { title: "T", durationMs: 200_000 });
  assert.equal(env.link.state().stage, "ready");
}

const chartOf = { notes: [{ t: 100 }, { t: 200 }] };

test("solo: a measured lag is set and the scan is skipped; the count-in still starts", async () => {
  const env = soloSetup();
  await soloReady(env);
  env.link.chartAccepted(chartOf, { lagMs: -20 });
  assert.deepEqual(env.calls, ["setLagMs:-20"]);
  assert.equal(env.link.state().stage, "countin");
});

test("solo: a zero lag is still an explicit answer (no scan)", async () => {
  const env = soloSetup();
  await soloReady(env);
  env.link.chartAccepted(chartOf, { lagMs: 0 });
  assert.deepEqual(env.calls, ["setLagMs:0"]);
});

test("solo: without a lag the old scan runs exactly as before", async () => {
  const env = soloSetup();
  await soloReady(env);
  env.link.chartAccepted(chartOf);
  assert.deepEqual(env.calls, ["align:100,200"]);
});

test("solo: a null or malformed alignment is no alignment, so the scan runs", async () => {
  for (const alignment of [null, undefined, {}, { lagMs: null }, { lagMs: Number.NaN }, { lagMs: "20" }]) {
    const env = soloSetup();
    await soloReady(env);
    env.link.chartAccepted(chartOf, alignment);
    assert.deepEqual(env.calls, ["align:100,200"], JSON.stringify(alignment));
  }
});

test("solo: an audio engine without setLagMs falls back to the scan", async () => {
  const env = soloSetup({ withSetLag: false });
  await soloReady(env);
  env.link.chartAccepted(chartOf, { lagMs: -20 });
  assert.deepEqual(env.calls, ["align:100,200"]);
});

// ---- roomLink.chartAccepted ----------------------------------------------------------------------------------------

function roomSetup({ withSetLag = true } = {}) {
  const calls = [];
  const sent = [];
  const audio = {
    unlock: () => Promise.resolve(),
    stop() {},
    pause: () => 0,
    load: async () => ({ durationMs: 200_000 }),
    play: () => new Promise(() => {}),
    align: (times) => calls.push(`align:${times.join(",")}`),
    durationMs: () => 200_000,
    songTimeAt: () => 0,
    onEnded: () => () => {},
  };
  if (withSetLag) audio.setLagMs = (ms) => calls.push(`setLagMs:${ms}`);
  const link = createRoomLink({ send: (payload) => (sent.push(payload), true), audio, getUserId: () => "me", now: () => 0, setTimer: () => 1, clearTimer: () => {} });
  link.start();
  return { link, calls, sent };
}

const member = (userId) => ({ userId, username: userId, avatarUrl: null, difficulty: "normal", ready: false, loaded: false, spectator: false, submitted: false });
const roomSnapshot = () => ({
  hostId: "host",
  phase: "loading",
  round: 1,
  endedAt: null,
  members: [member("host"), member("me")],
  queue: [],
  current: { audioKey: "song", title: "Song", artist: "A", durationMs: 200_000, addedBy: "host" },
  startAt: null,
  nextAt: null,
  results: [],
  serverNow: 1000,
});

async function roomLoaded(env) {
  env.link.setRoom(roomSnapshot(), 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.link.state().stage, "ready");
}

test("room: a measured lag is set, the scan skipped, and the room still hears the player is loaded", async () => {
  const env = roomSetup();
  await roomLoaded(env);
  env.link.chartAccepted(chartOf, { lagMs: 40 });
  assert.deepEqual(env.calls, ["setLagMs:40"]);
  assert.equal(env.sent.filter((m) => m.type === "mewbeat_room_loaded").length, 1);
});

test("room: without a lag the old scan runs exactly as before", async () => {
  const env = roomSetup();
  await roomLoaded(env);
  env.link.chartAccepted(chartOf);
  assert.deepEqual(env.calls, ["align:100,200"]);
});

test("room: an audio engine without setLagMs falls back to the scan", async () => {
  const env = roomSetup({ withSetLag: false });
  await roomLoaded(env);
  env.link.chartAccepted(chartOf, { lagMs: 40 });
  assert.deepEqual(env.calls, ["align:100,200"]);
});

// ---- link.js carries the field -------------------------------------------------------------------------------------

function linkSetup() {
  const link = createMewbeatLink({
    send: () => true,
    now: () => 0,
    setTimer: () => 1,
    clearTimer: () => {},
    serverClock: { addSample() {}, ready: () => true },
    songClock: { setAnchor: () => "init", audioKey: () => "k" },
  });
  const events = [];
  link.onChart((event) => events.push(event));
  link.start();
  return { link, events };
}

test("a chart reply with audioOffsetMs hands it to the game, number or null", () => {
  for (const value of [20, -40, 0, null]) {
    const { link, events } = linkSetup();
    link.requestChart("k", "normal");
    link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "ready", chart: { notes: [] }, audioOffsetMs: value });
    assert.equal(events.length, 1);
    assert.equal(events[0].audioOffsetMs, value);
  }
});

test("a chart reply without the field gives the same event as before, with no audioOffsetMs key at all", () => {
  const { link, events } = linkSetup();
  link.requestChart("k", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "ready", chart: { notes: [] } });
  assert.equal("audioOffsetMs" in events[0], false);
  assert.deepEqual(Object.keys(events[0]).sort(), ["audioKey", "best", "chart", "difficulty", "reason", "status"]);
});
