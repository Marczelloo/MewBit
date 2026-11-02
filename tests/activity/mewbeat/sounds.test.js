const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createSounds;
let gainOf;
let DEFAULT_VOLUME;

test.before(async () => {
  ({ createSounds, gainOf, DEFAULT_VOLUME } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/sounds.js")).href
  ));
});

// A stand-in AudioContext that records what the module builds.
function fakeAudio({ failDecode = [] } = {}) {
  const made = [];
  class FakeContext {
    constructor() {
      this.state = "suspended";
      this.destination = {};
      this.decoded = [];
      this.sources = [];
      this.gains = [];
      this.resumed = 0;
      this.closed = false;
      made.push(this);
    }
    decodeAudioData(data) {
      this.decoded.push(data.url);
      if (failDecode.includes(data.url)) return Promise.reject(new Error("bad file"));
      return Promise.resolve({ decodedFrom: data.url });
    }
    createBufferSource() {
      const source = { buffer: null, playbackRate: { value: 1 }, started: 0, stopped: 0, connect() {}, start() { source.started += 1; }, stop() { source.stopped += 1; } };
      this.sources.push(source);
      return source;
    }
    createGain() {
      const gain = { gain: { value: 1 }, connect() {} };
      this.gains.push(gain);
      return gain;
    }
    resume() {
      this.resumed += 1;
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      return Promise.resolve();
    }
  }
  return { FakeContext, made };
}

const URLS = { hit: "/hit.wav", tick: "/tick.ogg" };

function fakeFetch({ status = {} } = {}) {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(url);
    const code = status[url] ?? 200;
    return Promise.resolve({ ok: code === 200, status: code, arrayBuffer: () => Promise.resolve({ url }) });
  };
  return { fetchImpl, calls };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

async function loaded(options = {}) {
  const { FakeContext, made } = fakeAudio(options);
  const { fetchImpl, calls } = fakeFetch(options);
  const sounds = createSounds({ urls: URLS, AudioContextClass: FakeContext, fetchImpl });
  sounds.unlock();
  await settled();
  return { sounds, audio: made[0], made, calls };
}

test("creating the sounds touches neither the AudioContext nor the network until a gesture", async () => {
  const { FakeContext, made } = fakeAudio();
  const { fetchImpl, calls } = fakeFetch();
  const sounds = createSounds({ urls: URLS, AudioContextClass: FakeContext, fetchImpl });
  sounds.play("hit");
  await settled();
  assert.equal(made.length, 0);
  assert.equal(calls.length, 0);
});

test("unlock creates the context once, resumes it and loads each file once", async () => {
  const { sounds, audio, made, calls } = await loaded();
  sounds.unlock();
  await settled();
  assert.equal(made.length, 1);
  assert.equal(audio.resumed >= 1, true);
  assert.deepEqual(calls.sort(), ["/hit.wav", "/tick.ogg"]);
  assert.deepEqual(audio.decoded.sort(), ["/hit.wav", "/tick.ogg"]);
});

test("play replays the named sound from its decoded buffer", async () => {
  const { sounds, audio } = await loaded();
  sounds.play("hit");
  sounds.play("tick");
  sounds.play("hit");
  assert.deepEqual(audio.sources.map((source) => source.buffer.decodedFrom), ["/hit.wav", "/tick.ogg", "/hit.wav"]);
  for (const source of audio.sources) assert.equal(source.started, 1);
});

test("a sound still loading stays silent rather than sounding late", async () => {
  const { FakeContext, made } = fakeAudio();
  const { fetchImpl } = fakeFetch();
  const sounds = createSounds({ urls: URLS, AudioContextClass: FakeContext, fetchImpl });
  sounds.unlock();
  sounds.play("hit");
  assert.equal(made[0].sources.length, 0);
  await settled();
  assert.equal(made[0].sources.length, 0, "it does not play once it arrives");
  sounds.play("hit");
  assert.equal(made[0].sources.length, 1);
});

test("a file that fails to fetch or decode only silences itself", async () => {
  for (const options of [{ status: { "/hit.wav": 404 } }, { failDecode: ["/hit.wav"] }]) {
    const { sounds, audio } = await loaded(options);
    assert.doesNotThrow(() => sounds.play("hit"));
    assert.equal(audio.sources.length, 0);
    sounds.play("tick");
    assert.equal(audio.sources.length, 1);
  }
});

test("an unknown sound and a missing fetch are no-ops", async () => {
  const { sounds, audio } = await loaded();
  sounds.play("nope");
  assert.equal(audio.sources.length, 0);
  const { FakeContext } = fakeAudio();
  const original = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    const bare = createSounds({ urls: URLS, AudioContextClass: FakeContext });
    assert.doesNotThrow(() => bare.unlock());
  } finally {
    globalThis.fetch = original;
  }
});

test("the volume setting scales the gain, quiet by default and silent at 0", async () => {
  const { sounds, audio } = await loaded();
  sounds.play("hit");
  sounds.play("hit", 100);
  sounds.play("hit", 10);
  sounds.play("hit", 0);
  const [byDefault, full, low] = audio.gains.map((g) => g.gain.value);
  assert.equal(audio.sources.length, 3, "volume 0 plays nothing");
  assert.equal(byDefault, gainOf(DEFAULT_VOLUME));
  assert.ok(byDefault < full / 5, "the default is far below full volume");
  assert.ok(low < byDefault && low > 0);
  assert.ok(full <= 1, "never above the sample's own level");
  assert.equal(gainOf(250), gainOf(100));
  assert.equal(gainOf(Number.NaN), gainOf(DEFAULT_VOLUME));
});

test("level scales one sound and rate sets its speed", async () => {
  const { sounds, audio } = await loaded();
  sounds.play("tick", 100, { level: 0.5, rate: 1.5 });
  sounds.play("tick", 100, { level: 0 });
  assert.equal(audio.sources.length, 1, "level 0 plays nothing");
  assert.equal(audio.gains[0].gain.value, gainOf(100) * 0.5);
  assert.equal(audio.sources[0].playbackRate.value, 1.5);
});

test("play hands back what stops that sound, and nothing when it stays silent", async () => {
  const { sounds, audio } = await loaded();
  const stop = sounds.play("hit");
  assert.equal(audio.sources[0].stopped, 0);
  stop();
  assert.equal(audio.sources[0].stopped, 1);
  audio.sources[0].stop = () => {
    throw new Error("already gone");
  };
  assert.doesNotThrow(stop);
  assert.equal(sounds.play("nope"), null);
});

test("a missing AudioContext makes everything a no-op", () => {
  const sounds = createSounds({ urls: URLS, AudioContextClass: null, fetchImpl: () => assert.fail("no fetch without a context") });
  assert.doesNotThrow(() => {
    sounds.unlock();
    sounds.play("hit");
    sounds.close();
  });
});

test("close shuts the context, later plays do nothing and a late decode is dropped", async () => {
  const { sounds, audio, made } = await loaded();
  sounds.play("hit");
  sounds.close();
  assert.equal(audio.closed, true);
  sounds.play("hit");
  sounds.unlock();
  assert.equal(made.length, 1);
  assert.equal(audio.sources.length, 1);

  const fresh = fakeAudio();
  const { fetchImpl } = fakeFetch();
  const closing = createSounds({ urls: URLS, AudioContextClass: fresh.FakeContext, fetchImpl });
  closing.unlock();
  closing.close();
  await settled();
  closing.play("hit");
  assert.equal(fresh.made[0].sources.length, 0);
});
