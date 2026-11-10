const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let trap;

test.before(async () => {
  trap = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/tour/trap.js")).href);
});

const RATE = 1000;
const tone = (amplitude, length = 2000) => Float32Array.from({ length }, (_, i) => (i % 2 ? amplitude : -amplitude)); // rms == peak == amplitude
const peakOf = (channels, gain) => Math.max(...channels.map((data) => Math.max(...data.map(Math.abs)))) * gain;
const rmsOf = (channels, gain) => {
  let sum = 0;
  let n = 0;
  for (const data of channels) for (const v of data) { sum += (v * gain) ** 2; n += 1; }
  return Math.sqrt(sum / n);
};
const dB = (x) => 20 * Math.log10(x);

test("safeGain brings a loud stretch down to about -26 dBFS and keeps its peak under the ceiling", () => {
  const channels = [tone(0.9), tone(0.9)];
  const gain = trap.safeGain(channels, 0, 2000, { musicVolume: 80 });
  assert.ok(gain > 0 && gain < 0.1, `gain ${gain}`);
  assert.ok(Math.abs(dB(rmsOf(channels, gain)) - -26) < 0.5);
  assert.ok(peakOf(channels, gain) <= 0.45);
});

test("safeGain lifts a quiet stretch to the target but never past the peak ceiling", () => {
  const quiet = [tone(0.01)];
  const gain = trap.safeGain(quiet, 0, 2000, { musicVolume: 80 });
  assert.ok(gain > 1);
  assert.ok(peakOf(quiet, gain) <= 0.45);
  // Spiky: a low body with one loud sample. The target would push the peak over the ceiling, so the ceiling rules.
  const spiky = tone(0.01);
  spiky[100] = 0.9;
  const limited = trap.safeGain([spiky], 0, 2000, { musicVolume: 100 });
  assert.ok(peakOf([spiky], limited) <= 0.45 + 1e-9);
});

test("safeGain measures exactly the stretch that will play", () => {
  const data = new Float32Array(4000);
  data.fill(0.01, 0, 2000);
  data.fill(0.9, 2000, 4000); // a blast after the stretch
  const quietPart = trap.safeGain([data], 0, 2000, { musicVolume: 80 });
  const loudPart = trap.safeGain([data], 2000, 4000, { musicVolume: 80 });
  assert.ok(quietPart > 1 && loudPart < 0.1);
  assert.ok(peakOf([data.subarray(0, 2000)], quietPart) <= 0.45);
});

test("safeGain only lowers with the music volume: squared below 80, silent at 0, no louder above 80", () => {
  const channels = [tone(0.2)];
  const at = (musicVolume) => trap.safeGain(channels, 0, 2000, { musicVolume });
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(40) / at(80) - 0.25) < 1e-9);
  assert.equal(at(100), at(80));
  for (const volume of [100, 250, Infinity]) assert.ok(peakOf(channels, at(volume)) <= 0.45, `volume ${volume}`);
  // An unknown volume is the default one, not full blast.
  assert.equal(at(undefined), at(80));
  assert.equal(at(NaN), at(80));
});

test("safeGain gives 0 for an empty, silent or broken stretch", () => {
  assert.equal(trap.safeGain([new Float32Array(100)], 0, 100, { musicVolume: 80 }), 0);
  assert.equal(trap.safeGain([], 0, 100, { musicVolume: 80 }), 0);
  assert.equal(trap.safeGain([tone(0.5)], 500, 500, { musicVolume: 80 }), 0);
  assert.equal(trap.safeGain([tone(0.5, 100)], 5000, 6000, { musicVolume: 80 }), 0);
  assert.equal(trap.safeGain([Float32Array.of(NaN, NaN)], 0, 2, { musicVolume: 80 }), 0);
});

test("the sequence runs idle, heavy, joke, and ends from anywhere", () => {
  let state = trap.TRAP_IDLE;
  const phases = [];
  for (const action of [{ type: "cut" }, { type: "rude" }, { type: "begin", line: "gotcha" }, { type: "begin", line: "again" }, { type: "cut" }, { type: "cut" }]) {
    state = trap.trapReducer(state, action);
    phases.push(state.phase);
  }
  assert.deepEqual(phases, ["idle", "idle", "heavy", "heavy", "joke", "joke"]);
  assert.equal(state.line, "gotcha");
  for (const phase of ["heavy", "joke"]) assert.deepEqual(trap.trapReducer({ phase, line: "x" }, { type: "end" }), trap.TRAP_IDLE);
  assert.equal(trap.trapReducer(trap.TRAP_IDLE, { type: "end" }), trap.TRAP_IDLE);
  assert.equal(trap.trapReducer(trap.TRAP_IDLE, { type: "nonsense" }), trap.TRAP_IDLE);
});

test("the scene and the screen follow the phase", () => {
  assert.deepEqual(["idle", "heavy", "joke"].map(trap.trapSceneOf), [null, "heavy", "heavy"]);
  assert.deepEqual(["idle", "heavy", "joke"].map(trap.trapScreenOf), [null, "heavy", "joke"]);
});

// ---- player ----
function fakeContext() {
  const calls = [];
  const ctx = {
    state: "running",
    currentTime: 10,
    destination: {},
    createGain() {
      const params = [];
      const gain = {
        value: 1,
        setValueAtTime: (v, t) => params.push(["set", v, t]),
        linearRampToValueAtTime: (v, t) => params.push(["ramp", v, t]),
        cancelScheduledValues: (t) => params.push(["cancel", t]),
      };
      const node = { gain, params, connect() {}, disconnect() {} };
      calls.push(node);
      return node;
    },
    createBufferSource() {
      const source = { started: null, stopped: null, connect() {}, disconnect() {}, start: (...args) => { source.started = args; }, stop: (...args) => { source.stopped = args; } };
      calls.push(source);
      return source;
    },
  };
  return { ctx, calls };
}
const bufferOf = (amplitude, seconds = 4) => {
  const data = tone(amplitude, seconds * RATE);
  return { sampleRate: RATE, length: data.length, numberOfChannels: 1, getChannelData: () => data };
};

test("the player fades in from silence to the safe level, and fades out by itself at the end", () => {
  const { ctx, calls } = fakeContext();
  const player = trap.createTrapPlayer(() => ctx);
  assert.equal(player.play(bufferOf(0.9), 500, 1200, { musicVolume: 80, lengthMs: 2000 }), true);
  const gain = calls.find((c) => c.params);
  const source = calls.find((c) => c.start);
  assert.equal(gain.gain.value, 0);
  assert.deepEqual(gain.params[0].slice(0, 2), ["set", 0]);
  const ramp = gain.params.find((p) => p[0] === "ramp");
  assert.ok(ramp[1] > 0 && ramp[1] * 0.9 <= 0.45);
  assert.ok(Math.abs(ramp[2] - (10.05 + 1.2)) < 1e-9);
  const last = gain.params.at(-1);
  assert.deepEqual(last.slice(0, 2), ["ramp", 0]);
  assert.ok(Math.abs(last[2] - (10.05 + 2)) < 1e-9);
  assert.equal(source.started[1], 0.5);
  assert.ok(player.playing());
  player.stop(100);
  assert.equal(player.playing(), false);
  assert.ok(source.stopped[0] < 10.2);
  player.stop(100); // nothing playing: nothing happens
});

test("the player holds the sound back by delayMs and fades in when it starts", () => {
  const { ctx, calls } = fakeContext();
  const player = trap.createTrapPlayer(() => ctx);
  assert.equal(player.play(bufferOf(0.9), 0, 1000, { musicVolume: 80, lengthMs: 2000, delayMs: trap.TRAP_PAUSE_MS }), true);
  const gain = calls.find((c) => c.params);
  const source = calls.find((c) => c.start);
  const start = 10.05 + 1;
  assert.ok(Math.abs(source.started[0] - start) < 1e-9);
  assert.deepEqual(gain.params[0].slice(0, 2), ["set", 0]);
  assert.ok(Math.abs(gain.params[0][2] - start) < 1e-9);
  assert.ok(Math.abs(gain.params.find((p) => p[0] === "ramp")[2] - (start + 1)) < 1e-9);
  assert.ok(Math.abs(gain.params.at(-1)[2] - (start + 2)) < 1e-9); // the end is counted from the sound, not from the call
});

test("the player plays nothing at volume 0, for a silent stretch or when the context is gone", () => {
  const { ctx, calls } = fakeContext();
  const player = trap.createTrapPlayer(() => ctx);
  assert.equal(player.play(bufferOf(0.9), 0, 1000, { musicVolume: 0 }), false);
  assert.equal(player.play(bufferOf(0), 0, 1000, { musicVolume: 80 }), false);
  assert.equal(calls.length, 0);
  ctx.state = "closed";
  assert.equal(player.play(bufferOf(0.9), 0, 1000, { musicVolume: 80 }), false);
  assert.equal(trap.createTrapPlayer(() => { throw new Error("no audio"); }).play(bufferOf(0.9), 0, 1000, { musicVolume: 80 }), false);
});

// ---- preparation ----
// The bot's answer to mewbeat_tour_songs: its two songs, or not_ready for the first `notReady` asks.
function fakePrepKit({ chartStatuses = ["ready"], notReady = 0, songs = null, silent = 0 } = {}) {
  const asked = [];
  const polls = {};
  let songAsks = 0;
  const requests = {
    async request(type, body) {
      asked.push({ type, body });
      if (type === "mewbeat_tour_songs") {
        songAsks += 1;
        if (songAsks <= silent) throw new Error("timeout");
        if (songAsks <= silent + notReady) return { type, status: "not_ready" };
        return songs ?? {
          type,
          status: "ok",
          heavy: { audioKey: "key:H", track: { title: "H", artist: "a", durationMs: 30_000 }, chartReady: true },
          calm: { audioKey: "key:C", track: { title: "C", artist: "b", durationMs: 40_000, uri: "https://y/c", source: "youtube" }, chartReady: true },
        };
      }
      polls[body.audioKey] = (polls[body.audioKey] ?? 0) + 1;
      const status = chartStatuses[Math.min(polls[body.audioKey] - 1, chartStatuses.length - 1)];
      if (status !== "ready") return { status };
      const notes = Array.from({ length: 40 }, (_, i) => ({ t: 1000 + i * 700, lane: i % 4 }));
      return { status, chart: { audioKey: body.audioKey, difficulty: body.difficulty, notes } };
    },
  };
  const context = {
    sampleRate: RATE,
    createBuffer: (channels, length, rate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { sampleRate: rate, length, numberOfChannels: channels, duration: length / rate, getChannelData: (c) => data[c] };
    },
    async decodeAudioData() {
      const song = context.createBuffer(2, 30 * RATE, RATE);
      song.getChannelData(0).fill(0.3);
      return song;
    },
  };
  return { requests, context, asked, fetched: [] };
}

const HEAVY_SPEC = { level: "hell", fromMs: 2000 };
const CALM_SPEC = { level: "normal" };
const prepOf = (kit, extra = {}) => trap.prepareTrap({
  requests: kit.requests,
  fetchAudio: async (key) => { kit.fetched.push(key); return new ArrayBuffer(8); },
  getContext: () => kit.context,
  wait: async () => {},
  heavy: HEAVY_SPEC,
  calm: CALM_SPEC,
  ...extra,
});

test("prepareTrap asks the bot for its songs, charts and fetches the heavy one, and hands the calm one on by its link", async () => {
  const kit = fakePrepKit();
  const prep = prepOf(kit);
  assert.equal(prep.result(), null);
  await prep.done;
  const { heavy: h, calm: c } = prep.result();
  assert.deepEqual(kit.fetched, ["key:H"]); // only the heavy stretch is downloaded
  assert.deepEqual(kit.asked.filter((a) => a.type === "mewbeat_tour_songs").map((a) => a.body), [{}]); // no search text from the client
  assert.deepEqual(kit.asked.filter((a) => a.type === "mewbeat_chart").map((a) => a.body), [{ audioKey: "key:H", difficulty: "hell" }]);
  assert.equal(h.level, "hell");
  assert.equal(h.fromMs, 2000);
  assert.equal(h.buffer.length, (trap.HEAVY_MS + 600) * (RATE / 1000)); // exactly the heavy stretch and a little slack
  assert.equal(h.track.title, "H");
  assert.equal(h.durationMs, 30_000);
  assert.deepEqual({ audioKey: c.audioKey, uri: c.uri, source: c.source, level: c.level }, { audioKey: "key:C", uri: "https://y/c", source: "youtube", level: "normal" });
});

test("trimChart drops every note before the start, holds that begin earlier too", () => {
  const chart = { audioKey: "k", difficulty: "hell", notes: [{ t: 100, lane: 0 }, { t: 900, lane: 1, len: 400 }, { t: 1000, lane: 2 }, { t: 1500, lane: 3, len: 200 }] };
  const trimmed = trap.trimChart(chart, 1000);
  assert.deepEqual(trimmed.notes, [{ t: 1000, lane: 2 }, { t: 1500, lane: 3, len: 200 }]);
  assert.equal(trimmed.audioKey, "k");
  assert.equal(chart.notes.length, 4); // the original is left alone
});

test("the prepared heavy chart has nothing before the stretch starts", async () => {
  const prep = prepOf(fakePrepKit());
  await prep.done;
  const { chart } = prep.result().heavy;
  assert.ok(chart.notes.length > 0);
  assert.ok(chart.notes.every((note) => note.t >= HEAVY_SPEC.fromMs));
});

test("prepareTrap asks again while the bot is not ready and while it does not answer", async () => {
  const kit = fakePrepKit({ notReady: 2, silent: 1 });
  const waits = [];
  const prep = prepOf(kit, { wait: async (ms) => { waits.push(ms); } });
  await prep.done;
  assert.ok(prep.result());
  assert.equal(kit.asked.filter((a) => a.type === "mewbeat_tour_songs").length, 4); // no answer, 2 x not_ready, then ok
  assert.equal(waits.length, 3);
  assert.ok(waits.every((ms) => ms >= 2000));
});

test("prepareTrap polls a pending chart and gives up quietly when the heavy song fails", async () => {
  const kit = fakePrepKit({ chartStatuses: ["pending", "pending", "ready"] });
  const waits = [];
  const ok = prepOf(kit, { wait: async (ms) => { waits.push(ms); } });
  await ok.done;
  assert.ok(ok.result());
  assert.equal(waits.length, 2);
  assert.ok(waits.every((ms) => ms >= 2000 && ms <= 3000));

  const failed = prepOf(fakePrepKit({ chartStatuses: ["failed"] }));
  await failed.done; // never rejects
  assert.equal(failed.result(), null);

  const stuck = prepOf(fakePrepKit({ chartStatuses: ["pending"] }));
  await stuck.done;
  assert.equal(stuck.result(), null);
});

test("prepareTrap gives no trap when the calm song has no link to start it by", async () => {
  const kit = fakePrepKit({
    songs: {
      status: "ok",
      heavy: { audioKey: "key:H", track: { title: "H" }, chartReady: true },
      calm: { audioKey: "key:C", track: { title: "C" }, chartReady: true },
    },
  });
  const prep = prepOf(kit);
  await prep.done;
  assert.equal(prep.result(), null);
});

test("a cancelled preparation drops what arrives late, and stops asking", async () => {
  const kit = fakePrepKit();
  const prep = prepOf(kit);
  prep.cancel();
  await prep.done;
  assert.equal(prep.result(), null);

  const waiting = fakePrepKit({ notReady: 100 });
  let waits = 0;
  const later = prepOf(waiting, { wait: async () => { waits += 1; if (waits === 3) later.cancel(); } });
  await later.done;
  assert.equal(later.result(), null);
  assert.ok(waiting.asked.length <= 4);
});
