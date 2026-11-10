const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let mod;

test.before(async () => {
  mod = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/health.js")).href);
});

test("health is kept in hundredths and clamped, so small steps do not move the bar", () => {
  assert.equal(mod.quantizeHealth(0.504), 0.5);
  assert.equal(mod.quantizeHealth(0.506), 0.51);
  assert.equal(mod.quantizeHealth(-1), 0);
  assert.equal(mod.quantizeHealth(2), 1);
  assert.equal(mod.quantizeHealth(NaN), 0);
});

test("the tone turns low under 0.3 and critical under 0.2", () => {
  assert.equal(mod.healthTone(0.5), "ok");
  assert.equal(mod.healthTone(0.3), "ok");
  assert.equal(mod.healthTone(0.29), "low");
  assert.equal(mod.healthTone(0.2), "low");
  assert.equal(mod.healthTone(0.19), "critical");
  assert.equal(mod.healthTone(0), "critical");
});

test("the colour runs green, yellow, red as health falls", () => {
  assert.equal(mod.healthColor(1), "hsl(140 82% 56%)");
  assert.equal(mod.healthColor(0.5), "hsl(140 82% 56%)");
  assert.equal(mod.healthColor(0.3), "hsl(55 82% 56%)");
  assert.equal(mod.healthColor(0), "hsl(0 82% 56%)");
});

test("Four Lives and One Life show pips, the plain bar none", () => {
  assert.deepEqual(mod.lifePips({ modifiers: ["fl"], lives: 3, failed: false }), { count: 4, filled: 3 });
  assert.deepEqual(mod.lifePips({ modifiers: ["fl"], lives: 0, failed: true }), { count: 4, filled: 0 });
  assert.deepEqual(mod.lifePips({ modifiers: ["ol"], lives: null, failed: false }), { count: 1, filled: 1 });
  assert.deepEqual(mod.lifePips({ modifiers: ["ol"], lives: null, failed: true }), { count: 1, filled: 0 });
  assert.equal(mod.lifePips({ modifiers: ["gn"], lives: null, failed: false }), null);
  assert.equal(mod.lifePips({ modifiers: [], lives: null, failed: false }), null);
});
