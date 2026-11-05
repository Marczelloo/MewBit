const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createLiveSender;

test.before(async () => {
  ({ createLiveSender } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/liveSender.js")).href
  ));
});

function createScheduler() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
        }
        if (!next) break;
        timers.delete(next.id);
        time = next.timer.at;
        next.timer.fn();
      }
      time = end;
    },
    now: () => time,
    pending: () => timers.size,
  };
}

function setup(options = {}) {
  const scheduler = createScheduler();
  const sent = [];
  const sender = createLiveSender({
    send: (payload) => sent.push({ at: scheduler.now(), ...payload }),
    session: "live:k",
    audioKey: "k",
    difficulty: "normal",
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...options,
  });
  return { sender, scheduler, sent };
}

const sample = (score, combo = 0, accuracy = null) => ({ score, combo, accuracy });

test("the first update goes out at once with the protocol fields", () => {
  const { sender, sent } = setup();
  sender.update(sample(0));
  assert.deepEqual(sent, [{ at: 0, type: "mewbeat_live", session: "live:k", audioKey: "k", difficulty: "normal", score: 0, combo: 0, accuracy: null, vibe: null, fever: false, ended: false }]);
});

test("vibe and FEVER go out with the numbers", () => {
  const { sender, sent } = setup();
  sender.update({ ...sample(100, 3, 95), vibe: 0.42, fever: false });
  assert.equal(sent[0].vibe, 0.42);
  assert.equal(sent[0].fever, false);
});

test("FEVER turning on or off is a change even when the numbers stand still", () => {
  const { sender, scheduler, sent } = setup({ keepAliveMs: 1e9 });
  sender.update({ ...sample(100, 3, 95), vibe: 1, fever: false });
  scheduler.advance(300);
  sender.update({ ...sample(100, 3, 95), vibe: 1, fever: true });
  scheduler.advance(300);
  sender.update({ ...sample(100, 3, 95), vibe: 0, fever: false });
  assert.deepEqual(sent.map((m) => [m.vibe, m.fever]), [[1, false], [1, true], [0, false]]);
});

test("a vibe change alone is sent, and the keep-alive repeats vibe and FEVER", () => {
  const { sender, scheduler, sent } = setup();
  sender.update({ ...sample(100, 3, 95), vibe: 0.5, fever: false });
  scheduler.advance(300);
  sender.update({ ...sample(100, 3, 95), vibe: 0.6, fever: true });
  assert.equal(sent.length, 2);
  scheduler.advance(2000);
  assert.equal(sent.length, 3);
  assert.deepEqual([sent[2].vibe, sent[2].fever], [0.6, true]);
});

test("the final message carries the vibe and FEVER it ended on", () => {
  const { sender, sent } = setup();
  sender.update({ ...sample(100, 3, 95), vibe: 0.5, fever: false });
  sender.end({ ...sample(120, 4, 95), vibe: 0.7, fever: true });
  assert.deepEqual([sent.at(-1).vibe, sent.at(-1).fever, sent.at(-1).ended], [0.7, true, true]);
});

test("changes inside 250 ms collapse into one trailing message with the latest numbers", () => {
  const { sender, scheduler, sent } = setup();
  sender.update(sample(0));
  scheduler.advance(100);
  sender.update(sample(300, 1, 100));
  scheduler.advance(50);
  sender.update(sample(650, 2, 100));
  assert.equal(sent.length, 1);
  scheduler.advance(99);
  assert.equal(sent.length, 1);
  scheduler.advance(1);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].at, 250);
  assert.equal(sent[1].score, 650);
  assert.equal(sent[1].combo, 2);
});

test("never more than 4 messages a second under a constant stream of changes", () => {
  const { sender, scheduler, sent } = setup({ keepAliveMs: 1e9 });
  for (let t = 0; t <= 2000; t += 10) {
    scheduler.advance(10);
    sender.update(sample(t, t / 10, 90));
  }
  const inFirstSecond = sent.filter((m) => m.at < 1000).length;
  assert.ok(inFirstSecond <= 4, `sent ${inFirstSecond} in a second`);
  assert.ok(sent.length >= 7);
});

test("an unchanged value sends nothing new", () => {
  const { sender, scheduler, sent } = setup({ keepAliveMs: 1e9 });
  sender.update(sample(100, 3, 95));
  scheduler.advance(1000);
  sender.update(sample(100, 3, 95));
  scheduler.advance(1000);
  assert.equal(sent.length, 1);
});

test("a change that reverts before the trailing send sends nothing", () => {
  const { sender, scheduler, sent } = setup({ keepAliveMs: 1e9 });
  sender.update(sample(100, 3, 95));
  scheduler.advance(100);
  sender.update(sample(200, 4, 95));
  sender.update(sample(100, 3, 95));
  scheduler.advance(1000);
  assert.equal(sent.length, 1);
});

test("a quiet run repeats its numbers every 2 s so the board entry does not expire", () => {
  const { sender, scheduler, sent } = setup();
  sender.update(sample(100, 3, 95));
  scheduler.advance(6100);
  assert.deepEqual(sent.map((m) => m.at), [0, 2000, 4000, 6000]);
  assert.ok(sent.every((m) => m.score === 100 && m.ended === false));
});

test("end() sends one final message with ended: true and stops everything", () => {
  const { sender, scheduler, sent } = setup();
  sender.update(sample(100, 3, 95));
  scheduler.advance(50);
  sender.update(sample(200, 4, 96));
  sender.end(sample(250, 5, 96));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].ended, true);
  assert.equal(sent[1].score, 250);
  assert.equal(scheduler.pending(), 0);
  sender.end(sample(999, 9, 99));
  sender.update(sample(500, 1, 50));
  scheduler.advance(10_000);
  assert.equal(sent.length, 2);
  assert.equal(sender.ended(), true);
});

test("end() without numbers uses the latest update, and does nothing when there was none", () => {
  const first = setup();
  first.sender.update(sample(40, 2, 80));
  first.sender.end();
  assert.deepEqual(first.sent.map((m) => [m.score, m.ended]), [[40, false], [40, true]]);
  const none = setup();
  none.sender.end();
  assert.equal(none.sent.length, 0);
});

test("a throwing send never breaks the loop", () => {
  const scheduler = createScheduler();
  const sender = createLiveSender({ send: () => { throw new Error("closed"); }, session: "room", audioKey: "k", difficulty: "hard", now: scheduler.now, setTimer: scheduler.setTimer, clearTimer: scheduler.clearTimer });
  sender.update(sample(1));
  scheduler.advance(3000);
  sender.end(sample(2));
  assert.equal(sender.ended(), true);
});

test("a room session is passed through", () => {
  const { sender, sent } = setup({ session: "room" });
  sender.update(sample(5, 1, 100));
  assert.equal(sent[0].session, "room");
});

test("setDifficulty changes the difficulty on every later message", () => {
  const { sender, scheduler, sent } = setup();
  sender.update(sample(10, 1, 100));
  sender.setDifficulty("hard");
  scheduler.advance(300);
  sender.update(sample(20, 2, 100));
  assert.equal(sent[0].difficulty, "normal");
  assert.equal(sent.at(-1).difficulty, "hard");
  sender.end(sample(30, 3, 100));
  assert.equal(sent.at(-1).difficulty, "hard");
  assert.equal(sent.at(-1).ended, true);
});
