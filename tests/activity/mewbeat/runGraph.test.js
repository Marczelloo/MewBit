const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let runGraphOf;
let downsample;
let formatClock;
let FEVER_MS;

test.before(async () => {
  ({ runGraphOf, downsample, formatClock } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/runGraph.js")).href));
  ({ FEVER_MS } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/scoring.js")).href));
});

const hit = (t, j = "perfect") => ({ n: 0, part: "head", j, t });
const run = (count, from = 1000, step = 100, j = "perfect") => Array.from({ length: count }, (_, i) => hit(from + i * step, j));

test("health starts at half and a miss dips it", () => {
  const graph = runGraphOf({ events: [hit(1000), hit(2000, "miss"), hit(3000)], durationMs: 10_000 });
  assert.deepEqual(graph.health[0], { t: 0, v: 0.5 });
  assert.ok(Math.abs(graph.health[1].v - 0.51) < 1e-9);
  assert.ok(Math.abs(graph.health[2].v - 0.43) < 1e-9);
  assert.ok(graph.health[3].v > graph.health[2].v);
  assert.deepEqual(graph.misses, [2000]);
  assert.equal(graph.failedAt, null);
});

test("the line runs on to the end of the song", () => {
  const graph = runGraphOf({ events: [hit(1000)], durationMs: 10_000 });
  assert.equal(graph.endMs, 10_000);
  assert.equal(graph.health.at(-1).t, 10_000);
});

test("events are replayed in time order whatever order they come in", () => {
  const graph = runGraphOf({ events: [hit(3000), hit(1000, "miss")], durationMs: 5000 });
  assert.deepEqual(graph.misses, [1000]);
  assert.deepEqual(graph.health.map((point) => point.t), [0, 1000, 3000, 5000]);
});

test("a FEVER spans FEVER_MS from its start, and is cut off at the end of the song", () => {
  // 30 perfects fill the bar of a small chart (the fever minimum).
  const events = run(30, 1000, 100);
  const graph = runGraphOf({ events, feverStarts: [4000, 55_000], parts: 30, durationMs: 60_000 });
  assert.deepEqual(graph.fevers, [{ from: 4000, to: 4000 + FEVER_MS }]);
  const late = runGraphOf({ events, feverStarts: [4000], parts: 30, durationMs: 6000 });
  assert.deepEqual(late.fevers, [{ from: 4000, to: 6000 }]);
});

test("a FEVER the bar could not start is not drawn", () => {
  const graph = runGraphOf({ events: run(5), feverStarts: [2000], parts: 30, durationMs: 10_000 });
  assert.deepEqual(graph.fevers, []);
});

test("a FEVER at the instant of a judgement goes first", () => {
  const events = run(30, 1000, 100); // the 30th lands at 3900 and is the one that fills the bar
  const early = runGraphOf({ events, feverStarts: [3900], parts: 30, durationMs: 20_000 });
  assert.equal(early.fevers.length, 0);
  const after = runGraphOf({ events, feverStarts: [3901], parts: 30, durationMs: 20_000 });
  assert.equal(after.fevers.length, 1);
});

test("a lost run reports where it was lost, and the line stops there", () => {
  const events = [hit(1000), ...run(7, 2000, 500, "miss"), hit(9000, "miss")];
  const graph = runGraphOf({ events, durationMs: 20_000 });
  assert.equal(graph.failedAt, 5000);
  assert.equal(graph.health.at(-1).t, 5000);
  assert.equal(graph.health.at(-1).v, 0);
  assert.deepEqual(graph.misses, [2000, 2500, 3000, 3500, 4000, 4500, 5000]); // nothing after the loss counts
});

test("One Life is lost at the first miss, and No Fail plays on past empty", () => {
  assert.equal(runGraphOf({ events: [hit(1000), hit(2000, "miss"), hit(3000)], modifiers: ["ol"], durationMs: 9000 }).failedAt, 2000);
  const nf = runGraphOf({ events: run(8, 1000, 500, "miss"), modifiers: ["nf"], durationMs: 9000 });
  assert.equal(nf.failedAt, null);
  assert.equal(nf.depletedAt, 4000); // half the health goes in seven misses
  assert.equal(nf.health.at(-1).t, 9000);
});

test("no events give a flat line", () => {
  const graph = runGraphOf({ events: [], durationMs: 30_000 });
  assert.deepEqual(graph.health, [{ t: 0, v: 0.5 }, { t: 30_000, v: 0.5 }]);
  assert.deepEqual(graph.misses, []);
  assert.deepEqual(graph.fevers, []);
  assert.equal(graph.failedAt, null);
});

test("without a song length the axis ends at the last event", () => {
  assert.equal(runGraphOf({ events: [hit(7000)] }).endMs, 7000);
  assert.equal(runGraphOf({}).endMs, 1);
});

test("downsampling keeps the first and last points and the lowest one", () => {
  const points = Array.from({ length: 2000 }, (_, i) => ({ t: i * 10, v: 0.5 + 0.2 * Math.sin(i / 7) }));
  points[1234] = { t: 12_340, v: 0.01 };
  const thin = downsample(points, 240);
  assert.ok(thin.length <= 240);
  assert.equal(thin[0], points[0]);
  assert.equal(thin.at(-1), points.at(-1));
  assert.equal(Math.min(...thin.map((point) => point.v)), 0.01);
  assert.equal(Math.max(...thin.map((point) => point.v)), Math.max(...points.map((point) => point.v)));
  assert.ok(thin.every((point, i) => i === 0 || point.t >= thin[i - 1].t));
});

test("times read m:ss", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(83_000), "1:23");
  assert.equal(formatClock(599_600), "10:00");
  assert.equal(formatClock(null), "0:00");
  assert.equal(formatClock(-5), "0:00");
});

test("a short line is left as it is", () => {
  const few = [{ t: 0, v: 0.5 }, { t: 1, v: 0.4 }];
  assert.equal(downsample(few), few);
});

test("a long run keeps a lone miss's dip in the thinned line", () => {
  const events = run(1500, 1000, 50);
  events[700] = hit(1000 + 700 * 50, "miss");
  const graph = runGraphOf({ events, durationMs: 100_000 });
  assert.ok(graph.health.length <= 240);
  const dipAt = 1000 + 700 * 50;
  assert.ok(graph.health.some((point) => point.t === dipAt && point.v < 0.95)); // a lone miss costs 0.08 off full health
});
