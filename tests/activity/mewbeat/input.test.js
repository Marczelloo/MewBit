const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createKeyHold;
let createKeyRouter;
let keyLabel;
let keysProblem;
let KEYS_MESSAGE;

test.before(async () => {
  ({ createKeyHold, createKeyRouter, keyLabel, keysProblem, KEYS_MESSAGE } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/input.js")).href
  ));
});

const KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];

function setup() {
  const calls = { lane: [], fever: 0, exit: 0 };
  const route = createKeyRouter({
    keys: KEYS,
    onLane: (lane, timeStamp) => calls.lane.push([lane, timeStamp]),
    onFever: () => { calls.fever += 1; },
    onExit: () => { calls.exit += 1; },
  });
  return { calls, route };
}

test("a bound key calls onLane with the lane and the event timestamp", () => {
  const { calls, route } = setup();
  assert.equal(route({ code: "KeyF", timeStamp: 1234.5 }), true);
  assert.deepEqual(calls.lane, [[1, 1234.5]]);
});

test("a repeated key is ignored", () => {
  const { calls, route } = setup();
  assert.equal(route({ code: "KeyF", repeat: true, timeStamp: 1 }), false);
  assert.deepEqual(calls.lane, []);
});

test("events with a ctrl, meta or alt modifier are ignored", () => {
  const { calls, route } = setup();
  assert.equal(route({ code: "KeyD", ctrlKey: true, timeStamp: 1 }), false);
  assert.equal(route({ code: "KeyD", metaKey: true, timeStamp: 1 }), false);
  assert.equal(route({ code: "KeyD", altKey: true, timeStamp: 1 }), false);
  assert.deepEqual(calls.lane, []);
});

test("Space calls onFever and Escape calls onExit", () => {
  const { calls, route } = setup();
  assert.equal(route({ code: "Space", timeStamp: 1 }), true);
  assert.equal(route({ code: "Escape", timeStamp: 2 }), true);
  assert.equal(calls.fever, 1);
  assert.equal(calls.exit, 1);
});

test("an unbound key returns false and calls nothing", () => {
  const { calls, route } = setup();
  assert.equal(route({ code: "KeyQ", timeStamp: 1 }), false);
  assert.deepEqual(calls, { lane: [], fever: 0, exit: 0 });
});

test("a held Space or Escape does not repeat", () => {
  const { calls, route } = setup();
  assert.equal(route({ code: "Space", repeat: true, timeStamp: 1 }), false);
  assert.equal(route({ code: "Escape", repeat: true, timeStamp: 1 }), false);
  assert.equal(calls.fever + calls.exit, 0);
});

function holdSetup(t, canStart = () => true) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = { done: 0, changes: [] };
  const hold = createKeyHold({ code: "KeyR", ms: 600, canStart, onChange: (held) => calls.changes.push(held), onDone: () => { calls.done += 1; } });
  return { calls, hold, tick: (ms) => t.mock.timers.tick(ms) };
}

test("a key held long enough fires once", (t) => {
  const { calls, hold, tick } = holdSetup(t);
  assert.equal(hold.keydown({ code: "KeyR" }), true);
  tick(599);
  assert.equal(calls.done, 0);
  assert.deepEqual(calls.changes, [true]);
  tick(1);
  assert.equal(calls.done, 1);
  assert.deepEqual(calls.changes, [true, false]);
  assert.equal(hold.keydown({ code: "KeyR", repeat: true }), false);
  tick(1000);
  assert.equal(calls.done, 1);
});

test("letting go or losing focus before the end does nothing", (t) => {
  const { calls, hold, tick } = holdSetup(t);
  hold.keydown({ code: "KeyR" });
  tick(300);
  hold.keyup({ code: "KeyF" });
  tick(100);
  hold.keyup({ code: "KeyR" });
  tick(1000);
  hold.keydown({ code: "KeyR" });
  hold.cancel();
  tick(1000);
  assert.equal(calls.done, 0);
  assert.deepEqual(calls.changes, [true, false, true, false]);
});

test("a hold counts from its own press", (t) => {
  const { calls, hold, tick } = holdSetup(t);
  hold.keydown({ code: "KeyR" });
  tick(400);
  hold.keyup({ code: "KeyR" });
  hold.keydown({ code: "KeyR" });
  tick(400);
  assert.equal(calls.done, 0);
  tick(200);
  assert.equal(calls.done, 1);
});

test("a hold's auto-repeat is its own, and other keys and modifiers are left alone", (t) => {
  const { calls, hold, tick } = holdSetup(t);
  assert.equal(hold.keydown({ code: "KeyR", repeat: true }), false);
  assert.equal(hold.keydown({ code: "KeyF" }), false);
  assert.equal(hold.keydown({ code: "KeyR", ctrlKey: true }), false);
  assert.deepEqual(calls.changes, []);
  hold.keydown({ code: "KeyR" });
  assert.equal(hold.keydown({ code: "KeyR", repeat: true }), true);
  tick(600);
  assert.equal(calls.done, 1);
});

test("a hold doesn't start when the key means nothing right now", (t) => {
  const { calls, hold, tick } = holdSetup(t, () => false);
  assert.equal(hold.keydown({ code: "KeyR" }), false);
  tick(1000);
  assert.equal(calls.done, 0);
  assert.deepEqual(calls.changes, []);
});

test("keyLabel shows readable labels", () => {
  assert.equal(keyLabel("KeyD"), "D");
  assert.equal(keyLabel("Digit1"), "1");
  assert.equal(keyLabel("ArrowLeft"), "←");
  assert.equal(keyLabel("ArrowRight"), "→");
  assert.equal(keyLabel("Semicolon"), "Semicolon");
  assert.equal(keyLabel("Numpad1"), "Numpad1");
});

test("keysProblem refuses Space, Escape, duplicates and the wrong count with the server's message", () => {
  assert.equal(KEYS_MESSAGE, "Pick four different keys. Space and Escape are taken.");
  assert.equal(keysProblem(["KeyD", "KeyF", "KeyJ", "KeyK"]), null);
  assert.equal(keysProblem(["Space", "KeyF", "KeyJ", "KeyK"]), KEYS_MESSAGE);
  assert.equal(keysProblem(["KeyD", "Escape", "KeyJ", "KeyK"]), KEYS_MESSAGE);
  assert.equal(keysProblem(["KeyD", "KeyD", "KeyJ", "KeyK"]), KEYS_MESSAGE);
  assert.equal(keysProblem(["KeyD", "KeyF", "KeyJ"]), KEYS_MESSAGE);
  assert.equal(keysProblem(["KeyD", "Key F", "KeyJ", "KeyK"]), KEYS_MESSAGE);
});
