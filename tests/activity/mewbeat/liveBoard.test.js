const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let boardRows;
let createLiveBoardStore;

test.before(async () => {
  ({ boardRows, createLiveBoardStore } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/liveBoard.js")).href
  ));
});

const entries = (n) => Array.from({ length: n }, (_, i) => ({ userId: `u${i + 1}`, username: `P${i + 1}`, score: 1000 - i, ended: false }));

test("boardRows shows the top 5", () => {
  const rows = boardRows(entries(8), "u2");
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows.map((r) => r.me), [false, true, false, false, false]);
});

test("boardRows adds the own row when outside the top 5, with the real rank", () => {
  const rows = boardRows(entries(8), "u7");
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 7]);
  assert.equal(rows[5].me, true);
  assert.equal(rows[5].entry.userId, "u7");
});

test("boardRows without the player, or with few entries, shows what there is", () => {
  assert.equal(boardRows(entries(8), "nobody").length, 5);
  assert.equal(boardRows(entries(2), null).length, 2);
  assert.deepEqual(boardRows(null, "u1"), []);
});

function timers() {
  let time = 0;
  let nextId = 1;
  const map = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      map.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer: (id) => map.delete(id),
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...map]) {
        if (timer.at <= time) {
          map.delete(id);
          timer.fn();
        }
      }
    },
  };
}

test("the store keeps pushes of its session, ignores other sessions, and consumes every board message", () => {
  const t = timers();
  const store = createLiveBoardStore({ setTimer: t.setTimer, clearTimer: t.clearTimer });
  const heard = [];
  store.subscribe((e) => heard.push(e?.length ?? null));
  assert.equal(store.handle({ type: "mewbeat_live_board", session: "live:a", entries: entries(2) }), true);
  assert.equal(store.entries(), null, "no session set yet: ignored");
  store.setSession("live:a");
  store.handle({ type: "mewbeat_live_board", session: "live:a", entries: entries(3) });
  assert.equal(store.entries().length, 3);
  assert.equal(store.handle({ type: "mewbeat_live_board", session: "live:b", entries: entries(1) }), true);
  assert.equal(store.entries().length, 3);
  assert.equal(store.handle({ type: "mewbeat_sync" }), false);
  assert.deepEqual(heard, [3]);
});

test("the board is dropped 5 s after the last push, and every push re-arms the timer", () => {
  const t = timers();
  const store = createLiveBoardStore({ setTimer: t.setTimer, clearTimer: t.clearTimer });
  store.setSession("room");
  store.handle({ type: "mewbeat_live_board", session: "room", entries: entries(2) });
  t.advance(4000);
  store.handle({ type: "mewbeat_live_board", session: "room", entries: entries(2) });
  t.advance(4000);
  assert.equal(store.entries().length, 2);
  t.advance(1000);
  assert.equal(store.entries(), null);
});

test("changing the session clears the board", () => {
  const t = timers();
  const store = createLiveBoardStore({ setTimer: t.setTimer, clearTimer: t.clearTimer });
  store.setSession("live:a");
  store.handle({ type: "mewbeat_live_board", session: "live:a", entries: entries(2) });
  store.setSession(null);
  assert.equal(store.entries(), null);
  store.handle({ type: "mewbeat_live_board", session: "live:a", entries: entries(2) });
  assert.equal(store.entries(), null);
});
