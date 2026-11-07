const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let approachMsFor;
let noteY;
let tempoScrollFactor;
let scrollFactor;

test.before(async () => {
  ({ approachMsFor, noteY, scrollFactor, tempoScrollFactor } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/highway.js")).href
  ));
});

test("approachMsFor gives 2200, 1148 and 509 for speeds 1, 5 and 10", () => {
  assert.equal(approachMsFor(1), 2200);
  assert.equal(approachMsFor(5), 1148);
  assert.equal(approachMsFor(10), 509);
});

test("noteY is 0 at the top and hitLineY on the line", () => {
  assert.equal(noteY(2000 + 1148, 2000, 1148, 500), 0);
  assert.equal(noteY(2000, 2000, 1148, 500), 500);
});

test("noteY is below the hit line for a note already past", () => {
  assert.ok(noteY(1900, 2000, 1148, 500) > 500);
});

test("noteY moves linearly between the endpoints", () => {
  assert.equal(noteY(2574, 2000, 1148, 500), 250);
});

test("tempoScrollFactor follows the tempo gently, within bounds", () => {
  assert.equal(tempoScrollFactor(120), 1);
  assert.equal(tempoScrollFactor(null), 1);
  assert.ok(Math.abs(tempoScrollFactor(150) - Math.sqrt(150 / 120)) < 1e-9);
  assert.equal(tempoScrollFactor(200), 1.2);
  assert.equal(tempoScrollFactor(70), 1);
});

test("scrollFactor takes the larger of the tempo's and the pace's nudge, within the same bounds", () => {
  assert.ok(Math.abs(scrollFactor({ bpm: 132, pace: 6 }) - Math.sqrt(6 / 4.2)) < 1e-9);
  assert.equal(scrollFactor({ bpm: 220, pace: 4 }), 1.2);
  assert.equal(scrollFactor({ bpm: 90, pace: 3 }), 1);
  assert.equal(scrollFactor({ bpm: 100, pace: 20 }), 1.2);
  assert.equal(scrollFactor({ bpm: 132 }), tempoScrollFactor(132));
  assert.equal(scrollFactor(null), 1);
});
