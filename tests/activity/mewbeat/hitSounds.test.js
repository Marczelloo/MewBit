const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createHitSounds;
let renderHit;
let HIT_S;
let gainOf;
let DEFAULT_VOLUME;

test.before(async () => {
  ({ createHitSounds, renderHit, HIT_S, gainOf, DEFAULT_VOLUME } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/hitSounds.js")).href
  ));
});

// A stand-in AudioContext that records what the module builds.
function fakeAudio() {
  const made = [];
  class FakeContext {
    constructor() {
      this.currentTime = 1;
      this.sampleRate = 48_000;
      this.state = "suspended";
      this.destination = {};
      this.buffers = [];
      this.sources = [];
      this.gains = [];
      this.resumed = 0;
      this.closed = false;
      made.push(this);
    }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      const buffer = { channels, length, sampleRate, getChannelData: () => data };
      this.buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      const source = { buffer: null, started: 0, connect() {}, start() { source.started += 1; } };
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

test("creating the sounds touches no AudioContext until a gesture", () => {
  const { FakeContext, made } = fakeAudio();
  createHitSounds({ AudioContextClass: FakeContext });
  assert.equal(made.length, 0);
});

test("unlock creates the context once and resumes it", () => {
  const { FakeContext, made } = fakeAudio();
  const sounds = createHitSounds({ AudioContextClass: FakeContext });
  sounds.unlock();
  sounds.unlock();
  assert.equal(made.length, 1);
  assert.equal(made[0].resumed >= 1, true);
});

test("the hit is short, starts at once and never clips", () => {
  const samples = renderHit(48_000);
  assert.equal(samples.length, Math.round(HIT_S * 48_000));
  const peak = Math.max(...samples.map(Math.abs));
  assert.ok(peak <= 0.9 + 1e-6);
  assert.ok(Math.max(...samples.slice(0, 480).map(Math.abs)) > 0.5, "loud within the first 10 ms");
  assert.ok(Math.max(...samples.slice(-480).map(Math.abs)) < 0.05, "faded out by the end");
  assert.deepEqual(renderHit(48_000), samples, "deterministic");
});

test("every play replays one rendered buffer quietly", () => {
  const { FakeContext, made } = fakeAudio();
  const sounds = createHitSounds({ AudioContextClass: FakeContext });
  sounds.unlock();
  sounds.play();
  sounds.play();
  const audio = made[0];
  assert.equal(audio.buffers.length, 1, "rendered once, at unlock");
  assert.equal(audio.sources.length, 2);
  for (const source of audio.sources) {
    assert.equal(source.buffer, audio.buffers[0]);
    assert.equal(source.started, 1);
  }
  for (const gain of audio.gains) assert.ok(gain.gain.value <= 0.5);
});

test("the volume setting scales the gain, quiet by default and silent at 0", () => {
  const { FakeContext, made } = fakeAudio();
  const sounds = createHitSounds({ AudioContextClass: FakeContext });
  sounds.play();
  sounds.play(100);
  sounds.play(10);
  sounds.play(0);
  const [byDefault, full, low] = made[0].gains.map((g) => g.gain.value);
  assert.equal(made[0].sources.length, 3, "volume 0 plays nothing");
  assert.equal(byDefault, gainOf(DEFAULT_VOLUME));
  assert.ok(byDefault < full / 5, "the default is far below full volume");
  assert.ok(low < byDefault && low > 0);
  assert.equal(gainOf(250), gainOf(100));
  assert.equal(gainOf(Number.NaN), gainOf(DEFAULT_VOLUME));
});

test("a missing AudioContext makes everything a no-op", () => {
  const sounds = createHitSounds({ AudioContextClass: null });
  assert.doesNotThrow(() => {
    sounds.unlock();
    sounds.play();
    sounds.close();
  });
});

test("close shuts the context and later plays do nothing", () => {
  const { FakeContext, made } = fakeAudio();
  const sounds = createHitSounds({ AudioContextClass: FakeContext });
  sounds.play();
  sounds.close();
  assert.equal(made[0].closed, true);
  sounds.play();
  sounds.unlock();
  assert.equal(made.length, 1);
  assert.equal(made[0].sources.length, 1);
});
