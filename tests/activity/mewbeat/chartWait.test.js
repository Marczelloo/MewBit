const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let wait;

test.before(async () => {
  wait = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/chartWait.js")).href);
});

test("formats the elapsed time as m:ss, minutes not padded, bad input as 0:00", () => {
  assert.equal(wait.formatElapsed(0), "0:00");
  assert.equal(wait.formatElapsed(7_400), "0:07");
  assert.equal(wait.formatElapsed(21_999), "0:21");
  assert.equal(wait.formatElapsed(60_000), "1:00");
  assert.equal(wait.formatElapsed(155_000), "2:35");
  assert.equal(wait.formatElapsed(12 * 60_000), "12:00");
  assert.equal(wait.formatElapsed(-5), "0:00");
  assert.equal(wait.formatElapsed(NaN), "0:00");
  assert.equal(wait.formatElapsed(undefined), "0:00");
});

test("says the step in plain words when the song's own job is running", () => {
  assert.equal(wait.waitLine({ step: "analysis", ahead: 0, running: true }, 7_000), "Listening to the song… 0:07");
  assert.equal(wait.waitLine({ step: "melody", ahead: 0, running: true }, 34_000), "Following the melody… 0:34");
  assert.equal(wait.waitLine({ step: "charts", ahead: 0, running: true }, 61_000), "Writing the notes… 1:01");
});

test("says the place in line while the song waits behind others, singular and plural", () => {
  assert.equal(wait.waitLine({ step: "analysis", ahead: 2, running: false }, 21_000), "2 songs ahead of yours · 0:21");
  assert.equal(wait.waitLine({ step: "charts", ahead: 1, running: false }, 3_000), "1 song ahead of yours · 0:03");
  // Ahead of others in the line wins over the step, whichever step the song is at.
  assert.equal(wait.waitLine({ step: "melody", ahead: 3, running: false }, 0), "3 songs ahead of yours · 0:00");
});

test("is next in line when nothing is ahead and its own job has not started", () => {
  assert.equal(wait.waitLine({ step: "analysis", ahead: 0, running: false }, 9_000), "Next in line · 0:09");
});

test("without a queue it still shows the elapsed time, with the step left out", () => {
  assert.equal(wait.waitLine(null, 12_000), "Getting the charts ready… 0:12");
  assert.equal(wait.waitLine(undefined, 0), "Getting the charts ready… 0:00");
});

test("a queue that is not the shape the bot sends counts as none, and so does an unknown step", () => {
  for (const bad of [{}, "analysis", 5, { step: "analysis" }, { step: "analysis", ahead: -1 }, { step: "analysis", ahead: 1.5 }, { step: "", ahead: 0 }, { step: 7, ahead: 0 }]) {
    assert.equal(wait.readQueue(bad), null, JSON.stringify(bad));
    assert.equal(wait.waitLine(bad, 4_000), "Getting the charts ready… 0:04");
  }
  assert.equal(wait.waitLine({ step: "mastering", ahead: 0, running: true }, 4_000), "Getting the charts ready… 0:04");
  assert.deepEqual(wait.readQueue({ step: "melody", ahead: 0, running: "yes" }), { step: "melody", ahead: 0, running: false });
});

test("every step the bot reports has words", () => {
  assert.deepEqual(Object.keys(wait.STEP_WORDS).sort(), ["analysis", "charts", "melody"]);
});

function clocked() {
  let at = 1_000_000;
  const store = wait.createChartWait({ now: () => at });
  return { store, advance: (ms) => { at += ms; }, now: () => at };
}

test("the clock starts at the first ask and counts from there", () => {
  const { store, advance } = clocked();
  assert.equal(store.elapsed(), 0);
  assert.equal(store.getSnapshot().key, null);
  store.begin("k");
  advance(7_000);
  assert.equal(store.elapsed(), 7_000);
  assert.equal(store.getSnapshot().key, "k");
});

test("asking again for the same song keeps the clock and what the bot last said", () => {
  const { store, advance } = clocked();
  store.begin("k");
  advance(3_000);
  store.report("k", { step: "analysis", ahead: 1, running: false });
  advance(3_000);
  store.begin("k");
  assert.equal(store.elapsed(), 6_000);
  assert.deepEqual(store.getSnapshot().queue, { step: "analysis", ahead: 1, running: false });
});

test("another song, or a restart, starts a new wait", () => {
  const { store, advance } = clocked();
  store.begin("k");
  store.report("k", { step: "charts", ahead: 0, running: true });
  advance(9_000);
  store.begin("other");
  assert.equal(store.elapsed(), 0);
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().seen, false);
  advance(5_000);
  store.begin("other", { restart: true });
  assert.equal(store.elapsed(), 0);
});

test("a wait that began earlier (a song select job) counts from then, and is not reset by a repeat", () => {
  const { store, now } = clocked();
  store.begin("k", { at: now() - 12_000 });
  assert.equal(store.elapsed(), 12_000);
  store.report("k", { step: "melody", ahead: 0, running: true });
  store.begin("k", { at: now() - 12_000 });
  assert.equal(store.getSnapshot().seen, true);
  assert.equal(store.elapsed(), 12_000);
});

test("a reply for another song is ignored, a reply without a queue clears the place but not the clock", () => {
  const { store, advance } = clocked();
  store.begin("k");
  store.report("late", { step: "charts", ahead: 0, running: true });
  assert.equal(store.getSnapshot().queue, null);
  store.report("k", { step: "analysis", ahead: 2, running: false });
  assert.equal(store.getSnapshot().seen, true);
  advance(4_000);
  store.report("k", null);
  assert.equal(store.getSnapshot().queue, null);
  assert.equal(store.getSnapshot().seen, true, "it was heard once");
  assert.equal(store.elapsed(), 4_000);
});

test("ending the wait goes idle at once, and a late report after it does nothing", () => {
  const { store } = clocked();
  store.begin("k");
  store.end();
  assert.equal(store.getSnapshot().key, null);
  assert.equal(store.elapsed(), 0);
  store.report("k", { step: "charts", ahead: 0, running: true });
  assert.equal(store.getSnapshot().key, null);
});

test("listeners hear each change, only real ones, and unsubscribe", () => {
  const { store } = clocked();
  let heard = 0;
  const off = store.subscribe(() => { heard += 1; });
  store.begin("k");
  store.begin("k"); // a repeat: nothing changed
  assert.equal(heard, 1);
  store.report("k", { step: "analysis", ahead: 1, running: false });
  store.report("k", null);
  store.report("k", null); // already none: nothing changed
  assert.equal(heard, 3);
  store.end();
  store.end(); // already idle
  assert.equal(heard, 4);
  off();
  store.begin("k");
  assert.equal(heard, 4);
});

test("the snapshot is a new object per change, so useSyncExternalStore sees it", () => {
  const { store } = clocked();
  const idle = store.getSnapshot();
  assert.equal(store.getSnapshot(), idle);
  store.begin("k");
  const first = store.getSnapshot();
  assert.notEqual(first, idle);
  store.report("k", { step: "analysis", ahead: 1, running: false });
  assert.notEqual(store.getSnapshot(), first);
});
