const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createKeyRouter;
let keyLabel;
let keysProblem;
let KEYS_MESSAGE;

test.before(async () => {
  ({ createKeyRouter, keyLabel, keysProblem, KEYS_MESSAGE } = await import(
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

test("R restarts when there is something to restart, and is left alone otherwise", () => {
  let restarts = 0;
  const handled = (answer) => createKeyRouter({ keys: KEYS, onLane() {}, onFever() {}, onExit() {}, onRestart: () => { restarts += 1; return answer; } });
  assert.equal(handled(true)({ code: "KeyR" }), true);
  assert.equal(handled(false)({ code: "KeyR" }), false);
  assert.equal(restarts, 2);
  assert.equal(handled(true)({ code: "KeyR", repeat: true }), false);
  assert.equal(handled(true)({ code: "KeyR", ctrlKey: true }), false);
  assert.equal(restarts, 2);
  assert.equal(setup().route({ code: "KeyR" }), false);
});

test("a lane bound to R keeps it", () => {
  let restarts = 0;
  const lanes = [];
  const route = createKeyRouter({ keys: ["KeyR", "KeyF", "KeyJ", "KeyK"], onLane: (lane) => lanes.push(lane), onFever() {}, onExit() {}, onRestart: () => { restarts += 1; return true; } });
  assert.equal(route({ code: "KeyR", timeStamp: 1 }), true);
  assert.deepEqual(lanes, [0]);
  assert.equal(restarts, 0);
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
