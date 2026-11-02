const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createMewbeatRequests;

test.before(async () => {
  ({ createMewbeatRequests } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/requests.js")).href
  ));
});

// A manual timer queue so timeouts run without waiting.
function harness(sendResult = true) {
  const sent = [];
  const timers = new Map();
  let nextTimer = 1;
  const requests = createMewbeatRequests(
    (message) => {
      sent.push(message);
      return sendResult;
    },
    {
      setTimer: (fn, ms) => {
        const handle = nextTimer++;
        timers.set(handle, { fn, ms });
        return handle;
      },
      clearTimer: (handle) => timers.delete(handle),
    }
  );
  return { requests, sent, timers };
}

test("request sends the type, body and a fresh id, and resolves on the matching reply", async () => {
  const { requests, sent } = harness();
  const first = requests.request("mewbeat_played", { scope: "server", limit: 10 });
  const second = requests.request("mewbeat_played", { scope: "global" });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].type, "mewbeat_played");
  assert.equal(sent[0].scope, "server");
  assert.notEqual(sent[0].id, sent[1].id);
  assert.equal(typeof sent[0].id, "string");

  // Replies can arrive out of order.
  assert.equal(requests.handle({ type: "mewbeat_played", id: sent[1].id, tracks: ["b"] }), true);
  assert.equal(requests.handle({ type: "mewbeat_played", id: sent[0].id, tracks: ["a"] }), true);
  assert.deepEqual((await first).tracks, ["a"]);
  assert.deepEqual((await second).tracks, ["b"]);
});

test("handle ignores unknown ids, other types and a reply that was already consumed", async () => {
  const { requests, sent } = harness();
  const reply = requests.request("mewbeat_board", {});
  const { id } = sent[0];
  assert.equal(requests.handle({ type: "mewbeat_board", id: "nope" }), false);
  assert.equal(requests.handle({ type: "mewbeat_played", id }), false);
  assert.equal(requests.handle({ type: "mewbeat_board" }), false);
  assert.equal(requests.handle(null), false);
  assert.equal(requests.handle({ type: "mewbeat_board", id }), true);
  await reply;
  assert.equal(requests.handle({ type: "mewbeat_board", id }), false);
});

test("a request rejects when its timeout fires, and a late reply is not consumed", async () => {
  const { requests, sent, timers } = harness();
  const reply = requests.request("mewbeat_played", {}, 2500);
  assert.equal([...timers.values()][0].ms, 2500);
  [...timers.values()][0].fn();
  await assert.rejects(reply, /timed out/);
  assert.equal(requests.handle({ type: "mewbeat_played", id: sent[0].id }), false);
});

test("the default timeout is ten seconds and a reply clears the timer", async () => {
  const { requests, sent, timers } = harness();
  const reply = requests.request("mewbeat_played", {});
  assert.equal([...timers.values()][0].ms, 10_000);
  requests.handle({ type: "mewbeat_played", id: sent[0].id });
  await reply;
  assert.equal(timers.size, 0);
});

test("a send that reports failure rejects at once", async () => {
  const { requests, timers } = harness(false);
  await assert.rejects(requests.request("mewbeat_played", {}), /Not connected/);
  assert.equal(timers.size, 0);
});

test("send() fires a message without a reply and says whether it went out", () => {
  const ok = harness(true);
  assert.equal(ok.requests.send({ type: "mewbeat_live", score: 1 }), true);
  assert.deepEqual(ok.sent, [{ type: "mewbeat_live", score: 1 }]);
  const refused = harness(false);
  assert.equal(refused.requests.send({ type: "mewbeat_live", score: 2 }), false);
});

test("send() swallows a throwing socket", () => {
  const requests = createMewbeatRequests(() => {
    throw new Error("closed");
  });
  assert.equal(requests.send({ type: "mewbeat_live" }), false);
});
