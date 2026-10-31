const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createHitSounds;

test.before(async () => {
  ({ createHitSounds } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/hitSounds.js")).href
  ));
});

// A stand-in AudioContext that records what the module builds.
function fakeAudio() {
  const made = [];
  class FakeContext {
    constructor() {
      this.currentTime = 1;
      this.state = "suspended";
      this.destination = {};
      this.oscillators = [];
      this.peaks = [];
      this.stops = [];
      this.resumed = 0;
      this.closed = false;
      made.push(this);
    }
    createOscillator() {
      const osc = { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop: (at) => this.stops.push(at) };
      this.oscillators.push(osc);
      return osc;
    }
    createGain() {
      const peaks = this.peaks;
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime: (value) => peaks.push(value), exponentialRampToValueAtTime() {} },
        connect() {},
      };
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

test("PERFECT is pitched higher than GOOD and the click stays short and quiet", () => {
  const { FakeContext, made } = fakeAudio();
  const sounds = createHitSounds({ AudioContextClass: FakeContext });
  sounds.play("perfect");
  sounds.play("good");
  const [perfect, good] = made[0].oscillators;
  assert.ok(perfect.frequency.value > good.frequency.value);
  assert.ok(Math.max(...made[0].peaks) <= 0.15);
  for (const stop of made[0].stops) assert.ok(stop - 1 <= 0.04 + 1e-9);
});

test("a missing AudioContext makes everything a no-op", () => {
  const sounds = createHitSounds({ AudioContextClass: null });
  assert.doesNotThrow(() => {
    sounds.unlock();
    sounds.play("perfect");
    sounds.close();
  });
});

test("close shuts the context and later plays do nothing", () => {
  const { FakeContext, made } = fakeAudio();
  const sounds = createHitSounds({ AudioContextClass: FakeContext });
  sounds.play("great");
  sounds.close();
  assert.equal(made[0].closed, true);
  sounds.play("great");
  sounds.unlock();
  assert.equal(made.length, 1);
  assert.equal(made[0].oscillators.length, 1);
});
