const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let glitch;

test.before(async () => {
  glitch = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/glitch.js")).href);
});

const everyFrame = (end, fn) => {
  const out = [];
  for (let ms = 0; ms < end; ms += glitch.FRAME_MS) out.push(fn(ms));
  return out;
};

test("the same moment always gives the same frame", () => {
  assert.deepEqual(glitch.unlockAt(812), glitch.unlockAt(812));
  assert.deepEqual(glitch.cutAt(120), glitch.cutAt(120));
});

test("the unlock tears in bursts with quiet between them", () => {
  assert.equal(glitch.unlockAt(250).page.scale, 0);
  assert.equal(glitch.unlockAt(580).page.scale, 0);
  const strongest = Math.max(...everyFrame(1000, (ms) => glitch.unlockAt(ms).page.scale));
  assert.ok(strongest > 100, `strongest tear was ${strongest}`);
});

test("the stages run in order and end settled", () => {
  const stages = everyFrame(glitch.UNLOCK.closedMs + 200, (ms) => glitch.unlockStageAt(ms));
  assert.deepEqual([...new Set(stages)], ["glitch", "emerge", "card", "settled"]);
});

test("the unlock only ever darkens the screen", () => {
  const dims = everyFrame(glitch.UNLOCK.closedMs, (ms) => glitch.unlockAt(ms).dim);
  dims.slice(1).forEach((dim, index) => assert.ok(dim >= dims[index]));
  assert.equal(dims[0], 0);
  assert.equal(dims.at(-1), 0.9);
});

test("the rift is shut outside its window and never turns inside out", () => {
  assert.equal(glitch.riftShape(glitch.UNLOCK.riftMs - 1), null);
  assert.equal(glitch.riftShape(glitch.UNLOCK.closedMs), null);
  for (let ms = glitch.UNLOCK.riftMs; ms < glitch.UNLOCK.closedMs; ms += glitch.FRAME_MS) {
    glitch.riftShape(ms).forEach((row) => assert.ok(row.left <= row.right, `${ms}ms ${row.left} > ${row.right}`));
  }
});

test("the rift opens toward the left, past Mewbit", () => {
  const leftEdge = (ms) => Math.min(...glitch.riftShape(ms).map((row) => row.left));
  assert.ok(leftEdge(glitch.UNLOCK.emergeMs) > 50);
  assert.ok(leftEdge(glitch.UNLOCK.unclipMs) < 20);
});

test("Mewbit is clipped by the rift until she has stepped through", () => {
  assert.match(glitch.unlockAt(glitch.UNLOCK.emergeMs).spriteClip, /^polygon\(/);
  assert.equal(glitch.unlockAt(glitch.UNLOCK.unclipMs).spriteClip, "none");
  assert.equal(glitch.unlockAt(glitch.UNLOCK.unclipMs).riftClip.startsWith("polygon("), true);
});

test("the cut reaches black at its hold point and clears at its end", () => {
  assert.equal(glitch.cutAt(glitch.CUT.holdMs).dim, 1);
  assert.equal(glitch.cutAt(glitch.CUT.endMs).dim, 0);
  assert.equal(glitch.cutAt(glitch.CUT.endMs).page.scale, 0);
});

test("a cut from an already dark screen does not brighten it first", () => {
  everyFrame(glitch.CUT.holdMs, (ms) => assert.ok(glitch.cutAt(ms, 0.9).dim >= 0.9));
});
