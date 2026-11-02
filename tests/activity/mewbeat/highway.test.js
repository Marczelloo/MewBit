const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let approachMsFor;
let noteY;
let scrollTrack;
let tempoScrollFactor;

test.before(async () => {
  ({ approachMsFor, noteY, scrollTrack, tempoScrollFactor } = await import(
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
  assert.equal(tempoScrollFactor(70), 0.85);
});

test("scrollTrack without points is the song time", () => {
  const track = scrollTrack(null);
  assert.equal(track.pos(1234), 1234);
  assert.equal(track.minX, 1);
  assert.equal(noteY(2574, 2000, 1148, 500, track), 250);
});

test("scrollTrack integrates the section speed, ramps included", () => {
  // 0.8 until 4000, ramping to 1.1 by 4500, then 1.1.
  const track = scrollTrack([{ t: 0, x: 0.8 }, { t: 4000, x: 0.8 }, { t: 4500, x: 1.1 }]);
  assert.equal(track.minX, 0.8);
  assert.equal(track.pos(-500), -400);
  assert.equal(track.pos(2000), 1600);
  assert.equal(track.pos(4500), 3200 + 475);
  assert.ok(Math.abs(track.pos(5500) - (3675 + 1100)) < 1e-9);
});

test("noteY with a scroll track: a note nears the line faster through a fast section", () => {
  const slow = scrollTrack([{ t: 0, x: 0.8 }]);
  const fast = scrollTrack([{ t: 0, x: 1.1 }]);
  assert.ok(noteY(2574, 2000, 1148, 500, fast) < noteY(2574, 2000, 1148, 500, slow));
  assert.equal(noteY(2000, 2000, 1148, 500, fast), 500);
  // A slow section shows the note later: at 0.8 it reaches the top 1148 / 0.8 ms ahead.
  assert.ok(Math.abs(noteY(2000 + 1148 / 0.8, 2000, 1148, 500, slow)) < 1e-9);
});
