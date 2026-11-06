const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let mod;

test.before(async () => {
  mod = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/missPose.js")).href);
});

test("a miss that breaks a long combo crushes Mewbit for the whole fall", () => {
  const { missPose, CRUSHED_POSE_MS, CRUSH_COMBO } = mod;
  const result = missPose({ combo: CRUSH_COMBO, now: 1000, crushed: false, until: 0 });
  assert.deepEqual(result, { crushed: true, until: 1000 + CRUSHED_POSE_MS });
});

test("the crushed window outlasts the 28 frames at 36 fps and holds the last one", () => {
  const { CRUSHED_POSE_MS } = mod;
  assert.ok(CRUSHED_POSE_MS > (28 / 36) * 1000 + 200);
});

test("a short combo gets the plain miss pose", () => {
  const { missPose, MISS_POSE_MS, CRUSH_COMBO } = mod;
  const result = missPose({ combo: CRUSH_COMBO - 1, now: 1000, crushed: false, until: 0 });
  assert.deepEqual(result, { crushed: false, until: 1000 + MISS_POSE_MS });
});

test("a second miss in the same tick (combo already 0) keeps the crush playing", () => {
  const { missPose, CRUSH_COMBO } = mod;
  const first = missPose({ combo: CRUSH_COMBO + 10, now: 1000, crushed: false, until: 0 });
  const second = missPose({ combo: 0, now: 1000, crushed: first.crushed, until: first.until });
  assert.deepEqual(second, first);
});

test("a miss after the crush window has passed is a plain miss again", () => {
  const { missPose, MISS_POSE_MS, CRUSHED_POSE_MS } = mod;
  const first = missPose({ combo: 40, now: 1000, crushed: false, until: 0 });
  const later = missPose({ combo: 0, now: 1000 + CRUSHED_POSE_MS, crushed: first.crushed, until: first.until });
  assert.deepEqual(later, { crushed: false, until: 1000 + CRUSHED_POSE_MS + MISS_POSE_MS });
});
