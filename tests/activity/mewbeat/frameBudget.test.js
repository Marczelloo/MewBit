const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let frameBytes;
let budgetBytes;

test.before(async () => {
  ({ frameBytes, budgetBytes } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/mewbit/frameBudget.js")).href
  ));
});

test("a frame is four bytes a pixel of a square canvas", () => {
  assert.equal(frameBytes(256), 256 * 256 * 4);
});

test("the budget holds the longest loop, the screen's poses, the warm window and the lookahead", () => {
  const args = { size: 256, loopFrames: 64, screenPoses: 12, warmFrames: 16, lookahead: 8 };
  assert.equal(budgetBytes(args), frameBytes(256) * (64 + 12 + 16 + 8));
  assert.ok(budgetBytes(args) >= frameBytes(256) * args.loopFrames, "a whole loop always fits");
});

test("the kept miss reactions come on top of everything else", () => {
  const args = { size: 256, loopFrames: 64, screenPoses: 12, warmFrames: 16, lookahead: 8 };
  assert.equal(budgetBytes({ ...args, keptFrames: 40 }) - budgetBytes(args), frameBytes(256) * 40);
});

test("a bigger canvas gets a bigger budget, so the loop still fits", () => {
  const base = { loopFrames: 64, screenPoses: 12, warmFrames: 16, lookahead: 8 };
  const small = budgetBytes({ ...base, size: 192 });
  const large = budgetBytes({ ...base, size: 320 });
  assert.ok(large > small);
  assert.ok(large >= frameBytes(320) * base.loopFrames);
});
