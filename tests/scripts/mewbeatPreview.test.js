const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { join } = require("node:path");

const loadPreview = () =>
  import(pathToFileURL(join(__dirname, "..", "..", "scripts", "mewbeat-preview.mjs")).href);

const audio = (frames, sampleRate = 24000) => ({
  sampleRate,
  channels: 1,
  samples: new Int16Array(frames),
});

test("encodeWav output parses back to the same audio", async () => {
  const { encodeWav, parseWav } = await loadPreview();
  const source = audio(100);
  source.samples.forEach((_, i) => (source.samples[i] = (i - 50) * 300));
  const parsed = parseWav(encodeWav(source));
  assert.equal(parsed.sampleRate, 24000);
  assert.equal(parsed.channels, 1);
  assert.deepEqual([...parsed.samples], [...source.samples]);
});

test("parseWav finds the data chunk after extra chunks", async () => {
  const { encodeWav, parseWav } = await loadPreview();
  const plain = encodeWav({ ...audio(4), samples: Int16Array.from([1, -2, 3, -4]) });
  const list = Buffer.concat([Buffer.from("LIST", "latin1"), Buffer.from([3, 0, 0, 0]), Buffer.from([7, 7, 7, 0])]);
  const padded = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)]);
  assert.deepEqual([...parseWav(padded).samples], [1, -2, 3, -4]);
});

test("parseWav rejects data that is not a WAV", async () => {
  const { parseWav } = await loadPreview();
  assert.throws(() => parseWav(Buffer.from("not a wav file at all")), /RIFF/);
});

test("mixClicks adds a click at each note and leaves the rest untouched", async () => {
  const { mixClicks } = await loadPreview();
  const mixed = mixClicks(audio(24000), [
    { t: 100, lane: 0 },
    { t: 500, lane: 3 },
  ]);
  const peak = (fromMs, toMs) => {
    let max = 0;
    for (let i = (fromMs * 24); i < toMs * 24; i += 1) max = Math.max(max, Math.abs(mixed.samples[i]));
    return max;
  };
  assert.ok(peak(100, 116) > 3000, "click at 100 ms");
  assert.ok(peak(500, 516) > 3000, "click at 500 ms");
  assert.equal(peak(120, 480), 0);
  assert.equal(peak(520, 1000), 0);
});

test("mixClicks clamps to int16 and ignores notes outside the audio", async () => {
  const { mixClicks } = await loadPreview();
  const loud = audio(2400);
  loud.samples.fill(32767);
  const mixed = mixClicks(loud, [
    { t: 0, lane: 1 },
    { t: 99999, lane: 1 },
  ]);
  assert.ok(mixed.samples.every((sample) => sample <= 32767 && sample >= -32768));
  assert.equal(loud.samples[0], 32767, "the input is not modified");
});

test("parseArgs reads the query, options and rejects bad ones", async () => {
  const { parseArgs, slugOf } = await loadPreview();
  const options = parseArgs(["daft", "punk", "--difficulty", "all", "--out", "x", "--json-only"]);
  assert.equal(options.query, "daft punk");
  assert.equal(options.difficulty, "all");
  assert.equal(options.out, "x");
  assert.equal(options.jsonOnly, true);
  assert.equal(parseArgs(["--from", "a.json"]).from, "a.json");
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["q", "--difficulty", "insane"]), /difficulty/);
  assert.throws(() => parseArgs(["q", "--nope"]), /Unknown option/);
  assert.equal(slugOf("Daft Punk - Around the World!"), "daft-punk-around-the-world");
});

test("mixClicks adds a softer release click and a quiet tone for a hold", async () => {
  const { mixClicks } = await loadPreview();
  const mixed = mixClicks(audio(48000), [{ t: 100, lane: 1, len: 500 }]);
  const peak = (fromMs, toMs) => {
    let max = 0;
    for (let i = fromMs * 24; i < toMs * 24; i += 1) max = Math.max(max, Math.abs(mixed.samples[i]));
    return max;
  };
  const head = peak(100, 116);
  const release = peak(600, 616);
  const sustain = peak(300, 500);
  assert.ok(release > 0, "release click at t + len");
  assert.ok(release < head, "release click is softer than the head click");
  assert.ok(sustain > 0 && sustain < release, "a quiet tone between head and release");
  assert.equal(peak(650, 1000), 0, "nothing after the release");
});

test("describe prints the chart proxies", async () => {
  const { describe } = await loadPreview();
  const { generateAll } = require("../../helpers/mewbeat/charts/generate");
  const { makeLayeredFeatures } = require("../helpers/mewbeat/fixtures");
  const features = makeLayeredFeatures({ holdsEveryBeats: 2 });
  const chart = generateAll(features, "youtube:fixture:preview").normal;
  const text = describe(chart, features);
  assert.match(text, /on-layer \d+%/);
  assert.match(text, /repeat identity \d+% \(\d+ repeats\)/);
  assert.match(text, /hands L\d+% R\d+%/);
  assert.match(text, /nps mean [\d.]+ peak [\d.]+ \/ max 4\.5/);
  assert.match(text, /holds \d+/);
  assert.match(text, /leaders lead×\d+/);
});
