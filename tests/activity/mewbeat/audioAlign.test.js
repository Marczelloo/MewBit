const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let audioLagMs;
let riseEnvelope;
let energyInto;
let riseFromEnergy;

test.before(async () => {
  ({ audioLagMs, riseEnvelope, energyInto, riseFromEnergy } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/audioAlign.js")).href
  ));
});

const RATE = 1000; // one sample per millisecond
const beats = (count, stepMs = 500, fromMs = 1000) => Array.from({ length: count }, (_, i) => fromMs + i * stepMs);

function clicks(times, seconds = 40) {
  const samples = new Float32Array(seconds * RATE);
  for (const t of times) {
    for (let i = 0; i < 20; i += 1) samples[t + i] = 0.8 * Math.exp(-i / 6);
  }
  return samples;
}

function lagOf(lag) {
  const times = beats(60);
  return audioLagMs(riseEnvelope([clicks(times.map((t) => t + lag))], RATE), times);
}

test("finds a song whose sounds come after its chart", () => {
  const lag = lagOf(30);
  assert.ok(Math.abs(lag - 30) <= 3, `${lag}`);
});

test("finds a song whose sounds come before its chart", () => {
  const lag = lagOf(-39);
  assert.ok(Math.abs(lag + 39) <= 3, `${lag}`);
});

test("a song on its chart stays there", () => {
  assert.ok(Math.abs(lagOf(0)) <= 3, `${lagOf(0)}`);
});

test("two channels count as their mix", () => {
  const times = beats(60);
  const left = clicks(times.map((t) => t + 20));
  const lag = audioLagMs(riseEnvelope([left, new Float32Array(left.length)], RATE), times);
  assert.ok(Math.abs(lag - 20) <= 3, `${lag}`);
});

test("a lag past the limit is the wrong beat, not a lag", () => {
  assert.equal(lagOf(75), 0);
  assert.equal(lagOf(-75), 0);
});

test("silence gives no answer", () => {
  assert.equal(audioLagMs(riseEnvelope([new Float32Array(40 * RATE)], RATE), beats(60)), 0);
});

test("sounds that have nothing to do with the notes give no answer", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const noise = Float32Array.from({ length: 40 * RATE }, () => random() - 0.5);
  assert.equal(audioLagMs(riseEnvelope([noise], RATE), beats(60)), 0);
});

test("too few notes give no answer", () => {
  const times = beats(29);
  assert.equal(audioLagMs(riseEnvelope([clicks(times.map((t) => t + 30))], RATE), times), 0);
});

test("a chord counts once", () => {
  const times = beats(20);
  assert.equal(audioLagMs(riseEnvelope([clicks(times.map((t) => t + 30))], RATE), [...times, ...times]), 0);
});

test("a song too short for the envelope gives an empty one", () => {
  assert.equal(riseEnvelope([new Float32Array(10)], 100).length, 0);
});

test("the energy folded in pieces gives the same envelope as the whole song at once", () => {
  const times = beats(60);
  const left = clicks(times.map((t) => t + 30));
  const right = clicks(times.map((t) => t + 30)).map((v) => v * 0.5);
  const whole = riseEnvelope([left, right], RATE);
  const frames = Math.floor(left.length / 1);
  const energy = new Float32Array(frames);
  for (let at = 0; at < frames; at += 777) {
    const to = Math.min(at + 777, frames);
    energyInto(energy, at, left.slice(at, to), right.slice(at, to), 1);
  }
  const pieces = riseFromEnergy(energy);
  assert.equal(pieces.length, whole.length);
  assert.deepEqual(Array.from(pieces), Array.from(whole));
  assert.equal(audioLagMs(pieces, times), audioLagMs(whole, times));
});

test("a mono song counts as both channels", () => {
  const left = clicks(beats(60).map((t) => t + 30));
  assert.deepEqual(Array.from(riseEnvelope([left], RATE)), Array.from(riseEnvelope([left, left], RATE)));
});
