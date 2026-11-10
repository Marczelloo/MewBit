const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let mod;

test.before(async () => {
  mod = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/runSetup.js")).href);
});

test("a solo run keeps the saved modifiers, in the order of the list", () => {
  assert.deepEqual(mod.modifiersFor(["st", "fs", "gn"], "solo"), ["gn", "st", "fs"]);
});

test("outside Solo a tempo is dropped and the rest stays", () => {
  assert.deepEqual(mod.modifiersFor(["gn", "fs"], "room"), ["gn"]);
  assert.deepEqual(mod.modifiersFor(["sf"], "live"), []);
});

test("a list the server would refuse becomes none", () => {
  assert.deepEqual(mod.modifiersFor(["nf", "ol"], "solo"), []);
  assert.deepEqual(mod.modifiersFor(["zz"], "solo"), []);
  assert.deepEqual(mod.modifiersFor(undefined, "solo"), []);
  assert.deepEqual(mod.modifiersFor("gn", "solo"), []);
});

test("a played run can be lost, an unscored one cannot", () => {
  assert.deepEqual(mod.runRulesFor({ modifiers: ["ol"], mode: "solo" }), { modifiers: ["ol"], noFail: false });
  assert.deepEqual(mod.runRulesFor({ modifiers: ["ol"], mode: "solo", autoplay: true }), { modifiers: ["ol"], noFail: true });
  for (const kind of ["calibration", "touring", "spectating"]) {
    assert.deepEqual(mod.runRulesFor({ modifiers: ["ol", "gn"], mode: "solo", [kind]: true }), { modifiers: [], noFail: true }, kind);
  }
});
