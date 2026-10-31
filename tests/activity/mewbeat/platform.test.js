const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let isDesktopClient;

test.before(async () => {
  ({ isDesktopClient } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/platform.js")).href
  ));
});

test("local mode counts as desktop", () => {
  assert.equal(isDesktopClient({ mode: "local" }), true);
});

test("a discord desktop client is desktop", () => {
  assert.equal(isDesktopClient({ mode: "discord", sdk: { platform: "desktop" } }), true);
});

test("a discord mobile client is not desktop", () => {
  assert.equal(isDesktopClient({ mode: "discord", sdk: { platform: "mobile" } }), false);
});

test("a missing sdk or context is not desktop", () => {
  assert.equal(isDesktopClient({ mode: "discord" }), false);
  assert.equal(isDesktopClient(null), false);
  assert.equal(isDesktopClient(undefined), false);
});
