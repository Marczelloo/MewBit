const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let approachMsFor;
let noteY;
let tempoScrollFactor;
let scrollFactor;
let approachFor;
let hitYRatio;
let REF_HIT_Y;
let ghostAlpha;
let MAX_APPROACH_MS;

test.before(async () => {
  ({ approachMsFor, approachFor, hitYRatio, REF_HIT_Y, MAX_APPROACH_MS, noteY, scrollFactor, tempoScrollFactor, ghostAlpha } = await import(
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

test("scrollFactor takes the larger of the tempo's and the pace's nudge, the pace's in step up to 1.4", () => {
  assert.ok(Math.abs(scrollFactor({ bpm: 132, pace: 5.25 }) - 1.25) < 1e-9);
  assert.equal(scrollFactor({ bpm: 132, pace: 6 }), 1.4);
  assert.equal(scrollFactor({ bpm: 220, pace: 4 }), 1.2);
  assert.equal(scrollFactor({ bpm: 90, pace: 3 }), 1);
  assert.equal(scrollFactor({ bpm: 100, pace: 20 }), 1.4);
  assert.equal(scrollFactor({ bpm: 132 }), tempoScrollFactor(132));
  assert.equal(scrollFactor(null), 1);
});

test("approachFor at the reference hit line is today's approach, with and without the tempo nudge", () => {
  assert.equal(approachFor(1, REF_HIT_Y), 2200);
  assert.equal(approachFor(5, REF_HIT_Y), 1148);
  assert.equal(approachFor(5, REF_HIT_Y, 1.25), Math.floor(1148 / 1.25));
});

test("approachFor keeps the pixel speed the same on a tall highway: a hit line 2.2 times as far, a window 2.2 times as long", () => {
  const tall = Math.round(REF_HIT_Y * 2.2); // a 1440 px tall viewport against a 720 px one
  assert.equal(approachFor(5, tall), Math.floor(1148 * (tall / REF_HIT_Y)));
  assert.ok(Math.abs(approachFor(5, tall) / approachFor(5, REF_HIT_Y) - 2.2) < 0.01);
  // pixels a second = hitY / approach: the same at both heights
  assert.ok(Math.abs(tall / approachFor(5, tall) - REF_HIT_Y / approachFor(5, REF_HIT_Y)) < 0.001);
});

test("hitYRatio is clamped to 0.6 .. 3 and ignores a hit line it cannot read", () => {
  assert.equal(hitYRatio(REF_HIT_Y), 1);
  assert.equal(hitYRatio(10), 0.6);
  assert.equal(hitYRatio(REF_HIT_Y * 10), 3);
  assert.equal(hitYRatio(0), 1);
  assert.equal(hitYRatio(NaN), 1);
  assert.equal(hitYRatio(undefined), 1);
});

test("MAX_APPROACH_MS covers the longest approach approachFor can give", () => {
  assert.equal(MAX_APPROACH_MS, 6600);
  for (const speed of [1, 5, 10]) {
    for (const hitY of [1, REF_HIT_Y, 5000]) assert.ok(approachFor(speed, hitY) <= MAX_APPROACH_MS);
  }
});

test("ghostAlpha is solid to 65% of the way to the line, gone from 85%, linear in between", () => {
  assert.equal(ghostAlpha(0), 1);
  assert.equal(ghostAlpha(0.65), 1);
  assert.equal(ghostAlpha(0.85), 0);
  assert.equal(ghostAlpha(1.2), 0);
  assert.ok(Math.abs(ghostAlpha(0.75) - 0.5) < 1e-9);
  assert.ok(Math.abs(ghostAlpha(0.7) - 0.75) < 1e-9);
  // a note's progress is its y over the hit line
  assert.ok(Math.abs(ghostAlpha(noteY(1000, 500, 1000, 600) / 600) - 1) < 1e-9);
  assert.equal(ghostAlpha(noteY(1000, 900, 1000, 600) / 600), 0);
});
