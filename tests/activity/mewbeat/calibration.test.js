const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let calibration;

test.before(async () => {
  calibration = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/calibration.js")).href);
});

// 80 notes, 500 ms apart from t:2000, lanes cycling 0-3 (each lane every 2 s).
const notes = Array.from({ length: 80 }, (_, i) => ({ t: 2000 + i * 500, lane: i % 4 }));

function tapAll(timing, { lateMs, offsetMs = 0, count = notes.length, jitter = () => 0 }) {
  for (let i = 0; i < count; i += 1) timing.add(notes, notes[i].lane, notes[i].t + lateMs + jitter(i), offsetMs);
}

test("nearestNote finds the closest note of the lane inside the capture window", () => {
  const { nearestNote, CAPTURE_MS } = calibration;
  assert.equal(nearestNote(notes, 1, 2540).t, 2500);
  assert.equal(nearestNote(notes, 1, 2460).t, 2500);
  assert.equal(nearestNote(notes, 0, 2500), null); // lane 0 notes sit at 2000 and 4000
  assert.equal(nearestNote(notes, 1, 2500 + CAPTURE_MS + 1), null);
});

test("blockError measures against the click and refuses what no offset could explain", () => {
  const { blockError } = calibration;
  assert.equal(blockError(1040, 1000), 40);
  assert.equal(blockError(960, 1000), -40);
  assert.equal(blockError(700, 1000), -300);
  assert.equal(blockError(699, 1000), null);
  assert.equal(blockError(1700, 1000), 700);
  assert.equal(blockError(1701, 1000), null);
});

test("blockEstimate answers from one press and takes the median of several", () => {
  const { blockEstimate } = calibration;
  assert.equal(blockEstimate([]), null);
  assert.deepEqual(blockEstimate([42]), { offsetMs: 40, spreadMs: 0, presses: 1 });
  assert.deepEqual(blockEstimate([40, 60, 500]), { offsetMs: 60, spreadMs: 20, presses: 3 });
  assert.equal(blockEstimate([900]).offsetMs, 700);
});

test("nextBlockNote gives each click its block, one at a time, on the offset in use", () => {
  const { nextBlockNote } = calibration;
  const clicks = [{ t: 3000 }, { t: 4500 }, { t: 6000 }];
  assert.equal(nextBlockNote(clicks, 1999, 0), null);
  assert.equal(nextBlockNote(clicks, 2000, 0).t, 3000);
  assert.equal(nextBlockNote(clicks, 3500, 0).t, 3000);
  assert.equal(nextBlockNote(clicks, 3500, 0, 3000).t, 4500); // the next block starts as the last window closes
  assert.equal(nextBlockNote(clicks, 2100, 200), null); // a later offset lands the block later, so it starts later
  assert.equal(nextBlockNote(clicks, 2200, 200).t, 3000);
  assert.equal(nextBlockNote(clicks, 6501, 0, 4500), null);
});

test("no suggestion before MIN_TAPS taps", () => {
  const timing = calibration.createTapTiming();
  tapAll(timing, { lateMs: 40, count: calibration.MIN_TAPS - 1 });
  const estimate = timing.estimate();
  assert.equal(estimate.offsetMs, null);
  assert.equal(estimate.taps, calibration.MIN_TAPS - 1);
});

test("taps consistently late suggest raising the offset by that much", () => {
  const timing = calibration.createTapTiming();
  tapAll(timing, { lateMs: 83, jitter: (i) => ((i * 37) % 41) - 20 });
  const estimate = timing.estimate();
  assert.ok(Math.abs(estimate.offsetMs - 85) <= 5, `offset ${estimate.offsetMs}`);
  assert.equal(estimate.offsetMs % 5, 0);
  assert.ok(estimate.spreadMs > 0 && estimate.spreadMs <= 20);
  assert.equal(estimate.taps, calibration.KEEP_TAPS);
  assert.equal(estimate.total, notes.length);
});

test("the suggestion does not depend on the offset the taps were made with", () => {
  const timing = calibration.createTapTiming();
  // Audio really is 150 ms late; the player already runs +120, so taps are only 30 ms late in heard time.
  tapAll(timing, { lateMs: 150, offsetMs: 120 });
  assert.equal(timing.estimate().offsetMs, 150);
});

test("early taps suggest a negative offset and the result is clamped to the slider", () => {
  const early = calibration.createTapTiming();
  tapAll(early, { lateMs: -60 });
  assert.equal(early.estimate().offsetMs, -60);
  const far = calibration.createTapTiming();
  tapAll(far, { lateMs: -380, offsetMs: -380 });
  assert.equal(far.estimate().offsetMs, -300);
});

test("stray presses far from any note are ignored and outliers barely move the median", () => {
  const timing = calibration.createTapTiming();
  assert.equal(timing.add(notes, 0, 3000, 0), null); // halfway between lane 0 notes
  tapAll(timing, { lateMs: 50, jitter: (i) => (i % 10 === 0 ? 160 : 0) });
  assert.equal(timing.estimate().offsetMs, 50);
});

test("a null lane takes the nearest note of any lane, for taps aimed by ear", () => {
  const { nearestNote } = calibration;
  const any = [{ t: 1000, lane: 1 }, { t: 1500, lane: 2 }];
  assert.equal(nearestNote(any, null, 1440).t, 1500);
  assert.equal(nearestNote(any, null, 1100).t, 1000);
  assert.equal(nearestNote(any, 0, 1100), null);
});

test("reset forgets the taps", () => {
  const timing = calibration.createTapTiming();
  tapAll(timing, { lateMs: 50 });
  timing.reset();
  assert.equal(timing.estimate().taps, 0);
  assert.equal(timing.estimate().offsetMs, null);
});

test("runTimingOf is the median head-hit error once a run has enough hits", () => {
  const { runTimingOf } = calibration;
  assert.equal(runTimingOf([]), null);
  assert.equal(runTimingOf(Array.from({ length: 7 }, () => ({ errorMs: 10 }))), null);
  assert.equal(runTimingOf([-5, 1, 2, 3, 30, 31, 32, 90, 4].map((errorMs) => ({ errorMs }))), 4);
});
