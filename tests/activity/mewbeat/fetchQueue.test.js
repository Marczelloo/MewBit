const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createQueue;

test.before(async () => {
  ({ createQueue } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/mewbit/fetchQueue.js")).href
  ));
});

// A job the test finishes by hand.
function manual(log, name) {
  let finish;
  let fail;
  const start = () => {
    log.push(name);
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  };
  return { start, done: (value) => finish(value), fail: (error) => fail(error) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("no more than the limit run at once, the rest wait their turn", async () => {
  const queue = createQueue(2);
  const log = [];
  const jobs = ["a", "b", "c", "d"].map((name) => manual(log, name));
  const handles = jobs.map((job) => queue.add(job.start));
  assert.deepEqual(log, ["a", "b"]);
  assert.equal(queue.running, 2);
  assert.equal(queue.waiting, 2);
  jobs[0].done(1);
  assert.equal(await handles[0].promise, 1);
  await tick();
  assert.deepEqual(log, ["a", "b", "c"]);
  jobs[1].done();
  await tick();
  assert.deepEqual(log, ["a", "b", "c", "d"]);
  jobs[2].done();
  jobs[3].done();
  await Promise.all(handles.map((handle) => handle.promise));
  await tick();
  assert.equal(queue.running, 0);
  assert.equal(queue.waiting, 0);
});

test("urgent jobs start before the background ones that were waiting", async () => {
  const queue = createQueue(1);
  const log = [];
  const first = manual(log, "first");
  const slow = manual(log, "background");
  const needed = manual(log, "urgent");
  queue.add(first.start);
  queue.add(slow.start);
  queue.add(needed.start, true);
  first.done();
  await tick();
  assert.deepEqual(log, ["first", "urgent"]);
});

test("promote moves a waiting job up, and does nothing to one already running", async () => {
  const queue = createQueue(1);
  const log = [];
  const running = manual(log, "running");
  const one = manual(log, "one");
  const two = manual(log, "two");
  const runningHandle = queue.add(running.start);
  queue.add(one.start);
  const twoHandle = queue.add(two.start);
  runningHandle.promote(); // already running: no effect
  twoHandle.promote();
  running.done();
  await tick();
  assert.deepEqual(log, ["running", "two"]);
});

test("a failing job rejects its own promise and frees its place", async () => {
  const queue = createQueue(1);
  const log = [];
  const bad = manual(log, "bad");
  const good = manual(log, "good");
  const badHandle = queue.add(bad.start);
  const goodHandle = queue.add(good.start);
  bad.fail(new Error("no"));
  await assert.rejects(badHandle.promise, /no/);
  await tick();
  assert.deepEqual(log, ["bad", "good"]);
  good.done(7);
  assert.equal(await goodHandle.promise, 7);
});

test("a job that throws as it starts is a rejection, not a stuck queue", async () => {
  const queue = createQueue(1);
  const handle = queue.add(() => { throw new Error("sync"); });
  await assert.rejects(handle.promise, /sync/);
  await tick();
  const next = queue.add(() => Promise.resolve(3));
  assert.equal(await next.promise, 3);
});
