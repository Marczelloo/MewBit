const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let LAYOUT_MODE, layoutMinimized, sizeMinimized, shouldAutoPause, tileOf, tileScale, ordinal, placeOf, readyOf;

test.before(async () => {
  ({ LAYOUT_MODE, layoutMinimized, sizeMinimized, shouldAutoPause, tileOf, tileScale, ordinal, placeOf, readyOf } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/minimized.js")).href
  ));
});

test("picture-in-picture and grid are minimized, focused and unhandled are not", () => {
  assert.equal(layoutMinimized(LAYOUT_MODE.PIP), true);
  assert.equal(layoutMinimized(LAYOUT_MODE.GRID), true);
  assert.equal(layoutMinimized(LAYOUT_MODE.FOCUSED), false);
  assert.equal(layoutMinimized(LAYOUT_MODE.UNHANDLED), false);
  assert.equal(layoutMinimized(undefined), false);
});

test("a window of at most 480x300 is minimized by its size", () => {
  assert.equal(sizeMinimized(320, 180), true);
  assert.equal(sizeMinimized(240, 135), true);
  assert.equal(sizeMinimized(480, 300), true);
  assert.equal(sizeMinimized(481, 270), false);
  assert.equal(sizeMinimized(400, 301), false);
  assert.equal(sizeMinimized(1280, 720), false);
});

test("a window with no size yet is not taken for a minimized one", () => {
  assert.equal(sizeMinimized(0, 0), false);
  assert.equal(sizeMinimized(320, 0), false);
  assert.equal(sizeMinimized(undefined, undefined), false);
});

const RUN = { minimized: true, mode: "solo", stage: "playing", ended: false };

test("minimizing a solo run pauses it, also during the count-in", () => {
  assert.equal(shouldAutoPause(RUN), true);
  assert.equal(shouldAutoPause({ ...RUN, stage: "countin" }), true);
});

test("a full-size window pauses nothing", () => {
  assert.equal(shouldAutoPause({ ...RUN, minimized: false }), false);
});

test("a run that is already paused is not paused again, so a flicker cannot pause twice", () => {
  assert.equal(shouldAutoPause({ ...RUN, stage: "paused" }), false);
});

test("a flicker of the layout asks for one pause, and none once the run is paused", () => {
  // minimized, back to full size, minimized again: the pause lands on the first, the stage is paused for the rest.
  const seq = [
    { minimized: true, stage: "playing" },
    { minimized: false, stage: "paused" },
    { minimized: true, stage: "paused" },
  ];
  assert.deepEqual(seq.map((step) => shouldAutoPause({ ...RUN, ...step })), [true, false, false]);
});

test("no pause outside a running solo song: loading, song select, results", () => {
  for (const stage of ["idle", "preparing", "loading", "error", "ended"]) {
    assert.equal(shouldAutoPause({ ...RUN, stage }), false, stage);
  }
  assert.equal(shouldAutoPause({ ...RUN, ended: true }), false);
});

test("Live and Room runs are never paused", () => {
  assert.equal(shouldAutoPause({ ...RUN, mode: "live" }), false);
  assert.equal(shouldAutoPause({ ...RUN, mode: "room" }), false);
  assert.equal(shouldAutoPause({ ...RUN, mode: "room", stage: "countdown" }), false);
});

test("each mode picks its tile, and what has none falls back to song select", () => {
  assert.equal(tileOf({ mode: "solo", running: true }), "paused");
  assert.equal(tileOf({ mode: "solo", running: false }), "select");
  assert.equal(tileOf({ mode: "live", running: true }), "live");
  assert.equal(tileOf({ mode: "live", running: false }), "select");
  assert.equal(tileOf({ mode: "room", running: true }), "live");
  assert.equal(tileOf({ mode: "room", running: false }), "lobby");
});

test("the tile scales to the window, fits it whole and stops growing at 1.5x", () => {
  assert.equal(tileScale(320, 180), 1);
  assert.equal(tileScale(240, 135), 0.75);
  assert.equal(tileScale(480, 300), 1.5);
  assert.equal(tileScale(200, 400), 0.625);
  assert.equal(tileScale(0, 0), 1);
});

test("ordinals", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("the place is the player's rank on the sorted board, out of everyone on it", () => {
  const entries = [{ userId: "a" }, { userId: "b" }, { userId: "c" }, { userId: "d" }];
  assert.deepEqual(placeOf(entries, "b"), { place: 2, total: 4 });
  assert.deepEqual(placeOf(entries, "d"), { place: 4, total: 4 });
});

test("no place without a board or when the player is not on it", () => {
  assert.equal(placeOf(null, "a"), null);
  assert.equal(placeOf([], "a"), null);
  assert.equal(placeOf([{ userId: "a" }], "z"), null);
  assert.equal(placeOf([{ userId: "a" }], null), null);
});

test("ready counts players only, not spectators", () => {
  const room = { members: [{ ready: true }, { ready: false }, { ready: true }, { ready: true, spectator: true }] };
  assert.deepEqual(readyOf(room), { ready: 2, total: 3 });
  assert.deepEqual(readyOf(null), { ready: 0, total: 0 });
});
