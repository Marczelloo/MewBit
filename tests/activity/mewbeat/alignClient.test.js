const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createAlignClient;
let audioLagMs;
let energyInto;
let riseEnvelope;
let riseFromEnergy;

test.before(async () => {
  const src = (file) => pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat", file)).href;
  ({ createAlignClient } = await import(src("alignClient.js")));
  ({ audioLagMs, energyInto, riseEnvelope, riseFromEnergy } = await import(src("audioAlign.js")));
});

const RATE = 1000;
const times = Array.from({ length: 60 }, (_, i) => 1000 + i * 500);

function song(lag, seconds = 40) {
  const samples = new Float32Array(seconds * RATE);
  for (const t of times) {
    for (let i = 0; i < 20; i += 1) samples[t + lag + i] = 0.8 * Math.exp(-i / 6);
  }
  return samples;
}

// The worker's own logic (audioAlign.worker.js) behind the Worker interface, answering as the real one does.
function fakeWorker() {
  const worker = {
    posted: [],
    terminated: false,
    job: null,
    kept: null,
    onmessage: null,
    onerror: null,
    reply(data) {
      queueMicrotask(() => worker.onmessage?.({ data }));
    },
    postMessage(data) {
      worker.posted.push(data);
      if (data.type === "begin") {
        worker.job = { id: data.id, key: data.key, hop: data.hop, energy: new Float32Array(data.frames) };
        worker.kept = null;
      } else if (data.type === "chunk") {
        energyInto(worker.job.energy, data.at, data.left, data.right ?? data.left, worker.job.hop);
      } else if (data.type === "finish") {
        worker.kept = { key: worker.job.key, rise: riseFromEnergy(worker.job.energy) };
        worker.reply({ id: data.id, lag: audioLagMs(worker.kept.rise, data.times) });
      } else if (data.type === "retime") {
        if (worker.kept?.key !== data.key) worker.reply({ id: data.id, missing: true });
        else worker.reply({ id: data.id, lag: audioLagMs(worker.kept.rise, data.times) });
      }
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

const immediate = (fn) => queueMicrotask(fn);

test("the song goes over in chunks and the lag comes back the same as computed here", async () => {
  const workers = [];
  const client = createAlignClient({ makeWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, schedule: immediate });
  const left = song(30);
  const channels = [left, left];
  const lag = await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  assert.equal(lag, audioLagMs(riseEnvelope(channels, RATE), times));
  assert.ok(Math.abs(lag - 30) <= 3);
  const types = workers[0].posted.map((m) => m.type);
  assert.equal(types[0], "begin");
  assert.equal(types.at(-1), "finish");
  assert.ok(types.filter((type) => type === "chunk").length >= 2, "a 40 s song is more than one piece");
  assert.equal(left.length, 40 * RATE, "the decoded arrays were copied, not emptied");
});

test("the same song again sends only the new times", async () => {
  const workers = [];
  const client = createAlignClient({ makeWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, schedule: immediate });
  const channels = [song(-20)];
  const first = await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  const sent = workers[0].posted.length;
  const second = await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  assert.equal(second, first);
  assert.deepEqual(workers[0].posted.slice(sent).map((m) => m.type), ["retime"]);
});

test("a worker that lost the song is sent it whole", async () => {
  const workers = [];
  const client = createAlignClient({ makeWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, schedule: immediate });
  const channels = [song(30)];
  await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  workers[0].kept = null; // the worker forgot it
  const lag = await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  assert.ok(Math.abs(lag - 30) <= 3);
  const types = workers[0].posted.map((m) => m.type);
  assert.ok(types.includes("retime"));
  assert.equal(types.filter((type) => type === "begin").length, 2);
});

test("a call overtaken by a newer one resolves null and the newer one answers", async () => {
  const client = createAlignClient({ makeWorker: fakeWorker, schedule: immediate });
  const channels = [song(30)];
  const old = client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  const current = client.align({ key: "b", channels, sampleRate: RATE, timesMs: times });
  assert.equal(await old, null);
  assert.ok(Math.abs((await current) - 30) <= 3);
});

test("close resolves a pending call null and ends the worker", async () => {
  const workers = [];
  const client = createAlignClient({ makeWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, schedule: () => {} });
  const pending = client.align({ key: "a", channels: [song(30)], sampleRate: RATE, timesMs: times });
  client.close();
  assert.equal(await pending, null);
  assert.equal(workers[0].terminated, true);
});

test("with no way to make a worker the answer is computed here", async () => {
  const channels = [song(30)];
  const expected = audioLagMs(riseEnvelope(channels, RATE), times);
  for (const makeWorker of [undefined, () => { throw new Error("blocked"); }, () => null]) {
    const client = createAlignClient({ makeWorker, schedule: immediate });
    assert.equal(await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times }), expected);
  }
});

test("a worker that errors hands the call back to the main thread", async () => {
  const channels = [song(30)];
  const expected = audioLagMs(riseEnvelope(channels, RATE), times);
  const workers = [];
  const client = createAlignClient({ makeWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, schedule: () => {} });
  const pending = client.align({ key: "a", channels, sampleRate: RATE, timesMs: times });
  workers[0].onerror();
  assert.equal(await pending, expected);
  assert.equal(workers[0].terminated, true);
  // Later calls stay on this side.
  assert.equal(await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times }), expected);
  assert.equal(workers.length, 1);
});

test("an error reply from the worker is answered here too", async () => {
  const channels = [song(-30)];
  const expected = audioLagMs(riseEnvelope(channels, RATE), times);
  const client = createAlignClient({
    makeWorker: () => {
      const w = fakeWorker();
      w.postMessage = (data) => { if (data.type === "begin") w.reply({ id: data.id, error: "boom" }); };
      return w;
    },
    schedule: immediate,
  });
  assert.equal(await client.align({ key: "a", channels, sampleRate: RATE, timesMs: times }), expected);
});
