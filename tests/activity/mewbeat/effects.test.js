const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let effectiveEffects;

test.before(async () => {
  ({ effectiveEffects } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/effects.js")).href
  ));
});

test("reduced motion turns full into reduced", () => {
  assert.equal(effectiveEffects("full", true), "reduced");
});

test("off stays off whatever the OS prefers", () => {
  assert.equal(effectiveEffects("off", true), "off");
  assert.equal(effectiveEffects("off", false), "off");
});

test("full stays full without a reduced-motion preference", () => {
  assert.equal(effectiveEffects("full", false), "full");
});

test("reduced stays reduced either way", () => {
  assert.equal(effectiveEffects("reduced", true), "reduced");
  assert.equal(effectiveEffects("reduced", false), "reduced");
});

test("a missing or unknown setting behaves like full", () => {
  assert.equal(effectiveEffects(undefined, false), "full");
  assert.equal(effectiveEffects("loud", false), "full");
  assert.equal(effectiveEffects(undefined, true), "reduced");
});
