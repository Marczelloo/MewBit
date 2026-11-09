const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createFrameStats;
let fpsFlagOn;
let startFrameMonitor;
let SLOW_FRAME_MS;

test.before(async () => {
  ({ createFrameStats, fpsFlagOn, startFrameMonitor, SLOW_FRAME_MS } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/frameMonitor.js")).href
  ));
});

test("only ?fps=1 turns the monitor on", () => {
  assert.equal(fpsFlagOn("?fps=1"), true);
  assert.equal(fpsFlagOn("?a=2&fps=1"), true);
  assert.equal(fpsFlagOn(""), false);
  assert.equal(fpsFlagOn("?fps=0"), false);
  assert.equal(fpsFlagOn("?fps"), false);
});

test("frames over the limit are counted and the worst one kept", () => {
  const stats = createFrameStats(20);
  for (const ms of [16, 17, 20, 21, 45, 16]) stats.push(ms);
  assert.deepEqual(stats.snapshot(), { frames: 6, slow: 2, worst: 45 });
  stats.reset();
  assert.deepEqual(stats.snapshot(), { frames: 0, slow: 0, worst: 0 });
});

test("the default limit is 20 ms", () => {
  assert.equal(SLOW_FRAME_MS, 20);
});

test("the monitor draws a box, measures between frames, and removes it on stop", () => {
  const boxes = [];
  const doc = {
    body: { appendChild: (el) => boxes.push(el) },
    createElement: () => ({
      style: {},
      textContent: "",
      removed: false,
      setAttribute() {},
      remove() { this.removed = true; },
    }),
  };
  let callback = null;
  const raf = (fn) => { callback = fn; return 7; };
  let cancelled = null;
  const stop = startFrameMonitor(doc, raf, (handle) => { cancelled = handle; });
  assert.equal(boxes.length, 1);
  callback(1000);
  callback(1016);
  callback(1066); // a 50 ms frame
  callback(1600); // a 534 ms frame, past the refresh time
  assert.match(boxes[0].textContent, /frames 3/);
  assert.match(boxes[0].textContent, /over 20 ms 2/);
  assert.match(boxes[0].textContent, /worst 534\.0 ms/);
  stop();
  assert.equal(cancelled, 7);
  assert.equal(boxes[0].removed, true);
});
