const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createJudge;

test.before(async () => {
  ({ createJudge } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/judge.js")).href));
});

const sample = () => [
  { t: 1000, lane: 0 },
  { t: 1100, lane: 0 },
  { t: 1000, lane: 1 },
];

test("press takes the earliest note in the lane and reports a signed error", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.press(0, 1060), { index: 0, judgement: "great", errorMs: 60, part: "head" });
  assert.equal(judge.outcomeOf(0), "great");
  assert.equal(judge.outcomeOf(1), "pending");
});

test("an early press has a negative error", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.press(1, 970), { index: 2, judgement: "perfect", errorMs: -30, part: "head" });
});

test("a press with no note in reach is a ghost tap", () => {
  const judge = createJudge(sample());
  assert.equal(judge.press(2, 1000), null);
  assert.equal(judge.press(0, 800), null);
  assert.equal(judge.remaining(), 3);
});

test("a press in the early miss band takes the note as a miss", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.press(1, 1000 - 126), { index: 2, judgement: "miss", errorMs: -126, part: "head" });
  assert.equal(judge.outcomeOf(2), "miss");
  assert.deepEqual(judge.press(0, 1000 - 150), { index: 0, judgement: "miss", errorMs: -150, part: "head" });
  assert.equal(judge.press(0, 1100 - 151), null); // index 1 is out of reach again
  assert.equal(judge.remaining(), 1);
});

test("sweep misses notes only once past the GOOD window, in index order", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.sweep(1125), []);
  assert.deepEqual(judge.sweep(1126), [
    { index: 0, judgement: "miss", errorMs: null, part: "head" },
    { index: 2, judgement: "miss", errorMs: null, part: "head" },
  ]);
  assert.deepEqual(judge.sweep(1226), [{ index: 1, judgement: "miss", errorMs: null, part: "head" }]);
  assert.equal(judge.remaining(), 0);
  assert.deepEqual(judge.sweep(5000), []);
});

test("sweep does not re-miss a note that press already judged ahead of it", () => {
  const judge = createJudge(sample());
  judge.press(0, 1100); // index 0, 100ms late -> good
  judge.press(0, 1100); // index 1, perfect
  assert.deepEqual(judge.sweep(1236), [{ index: 2, judgement: "miss", errorMs: null, part: "head" }]);
});

test("a late press can hit a note that has not been swept yet", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.press(1, 1110), { index: 2, judgement: "good", errorMs: 110, part: "head" });
  assert.equal(judge.press(1, 1111), null);
});

test("starting from fromMs skips earlier notes", () => {
  const judge = createJudge(sample(), { fromMs: 1050 });
  assert.equal(judge.outcomeOf(0), "skipped");
  assert.equal(judge.outcomeOf(1), "pending");
  assert.equal(judge.outcomeOf(2), "skipped");
  assert.equal(judge.remaining(), 1);
  assert.equal(judge.press(0, 900), null);
});

test("skipBefore returns how many notes it skipped and leaves judged ones alone", () => {
  const judge = createJudge(sample());
  judge.press(0, 1000);
  assert.equal(judge.skipBefore(1050), 1);
  assert.equal(judge.outcomeOf(0), "perfect");
  assert.equal(judge.outcomeOf(2), "skipped");
  assert.equal(judge.skipBefore(1050), 0);
  assert.deepEqual(judge.sweep(1236), [{ index: 1, judgement: "miss", errorMs: null, part: "head" }]);
});

test("a chord can be hit on both lanes", () => {
  const judge = createJudge([{ t: 2000, lane: 0 }, { t: 2000, lane: 3 }]);
  assert.equal(judge.press(0, 2010).index, 0);
  assert.equal(judge.press(3, 2012).index, 1);
  assert.equal(judge.remaining(), 0);
});

test("pressing the same lane twice judges two different notes", () => {
  const judge = createJudge([{ t: 3000, lane: 1 }, { t: 3060, lane: 1 }]);
  assert.equal(judge.press(1, 3030).index, 0);
  assert.equal(judge.press(1, 3031).index, 1);
  assert.equal(judge.press(1, 3032), null);
});

test("sweep stays fast on a 5000-note chart", () => {
  const notes = Array.from({ length: 5000 }, (_, i) => ({ t: i * 50, lane: i % 4 }));
  const judge = createJudge(notes);
  const end = notes[notes.length - 1].t + 200;
  let missed = 0;
  const started = performance.now();
  for (let ms = 0; ms <= end; ms += 1) missed += judge.sweep(ms).length;
  const elapsed = performance.now() - started;
  assert.equal(missed, 5000);
  assert.ok(elapsed < 200, `sweep took ${elapsed.toFixed(1)}ms`);
});

// Holds: head at 1000, end at 2000 (lane 0). A tap in lane 1 at 3000.
const withHold = () => [
  { t: 1000, lane: 0, len: 1000 },
  { t: 3000, lane: 1 },
];

test("a hold head is judged like a tap and makes the hold active", () => {
  const judge = createJudge(withHold());
  assert.deepEqual(judge.press(0, 1010), { index: 0, judgement: "perfect", errorMs: 10, part: "head" });
  assert.equal(judge.tailOutcomeOf(0), "pending");
  assert.equal(judge.tailOutcomeOf(1), null);
  assert.equal(judge.remaining(), 2); // tail + tap
});

test("release at the end is a PERFECT tail", () => {
  const judge = createJudge(withHold());
  judge.press(0, 1000);
  assert.deepEqual(judge.release(0, 2000), [{ index: 0, judgement: "perfect", errorMs: 0, part: "tail" }]);
  assert.equal(judge.tailOutcomeOf(0), "perfect");
  assert.equal(judge.outcomeOf(0), "perfect");
});

test("tail windows are the tap windows times 1.5", () => {
  const at = (songMs) => {
    const judge = createJudge(withHold());
    judge.press(0, 1000);
    return judge.release(0, songMs)[0].judgement;
  };
  assert.equal(at(2000 - 75), "perfect");
  assert.equal(at(2000 - 76), "great");
  assert.equal(at(2000 - 135), "great");
  assert.equal(at(2000 - 136), "good");
  assert.equal(at(2000 - 150), "good");
  assert.equal(at(2000 - 187.5), "good");
  assert.equal(at(2000 - 188), "miss");
  assert.equal(at(2000 + 100), "great");
  assert.equal(at(2000 + 500), "good"); // late beyond the window still counts
});

test("an early miss on a hold settles its tail as a miss too", () => {
  const judge = createJudge(withHold());
  assert.deepEqual(judge.press(0, 1000 - 130), { index: 0, judgement: "miss", errorMs: -130, part: "head", tailMissed: true });
  assert.equal(judge.tailOutcomeOf(0), "miss");
  assert.deepEqual(judge.release(0, 2000), []);
  assert.deepEqual(judge.sweep(2500), []);
});

test("an early release is a drop: tail MISS and the hold is dead", () => {
  const judge = createJudge(withHold());
  judge.press(0, 1000);
  assert.deepEqual(judge.release(0, 1700), [{ index: 0, judgement: "miss", errorMs: null, part: "tail" }]);
  assert.equal(judge.tailOutcomeOf(0), "miss");
  assert.deepEqual(judge.release(0, 1800), []);
  assert.deepEqual(judge.sweep(5000).map((o) => o.index), [1]);
});

test("holding past the end auto-completes on sweep", () => {
  const judge = createJudge(withHold());
  judge.press(0, 1000);
  assert.deepEqual(judge.sweep(1999), []);
  assert.deepEqual(judge.sweep(2000), [{ index: 0, judgement: "perfect", errorMs: 0, part: "tail" }]);
  assert.deepEqual(judge.release(0, 2100), []);
});

test("a missed head misses its tail in the same sweep", () => {
  const judge = createJudge(withHold());
  assert.deepEqual(judge.sweep(1136), [
    { index: 0, judgement: "miss", errorMs: null, part: "head" },
    { index: 0, judgement: "miss", errorMs: null, part: "tail" },
  ]);
  assert.equal(judge.tailOutcomeOf(0), "miss");
  assert.equal(judge.remaining(), 1);
});

test("release without an active hold is a no-op", () => {
  const judge = createJudge(withHold());
  assert.deepEqual(judge.release(0, 1500), []);
  assert.deepEqual(judge.release(2, 1500), []);
});

test("skipBefore in the middle of a hold skips it whole", () => {
  const judge = createJudge(withHold());
  assert.equal(judge.skipBefore(1500), 2);
  assert.equal(judge.outcomeOf(0), "skipped");
  assert.equal(judge.tailOutcomeOf(0), "skipped");
  assert.equal(judge.remaining(), 1);
  assert.deepEqual(judge.release(0, 2000), []);
  assert.deepEqual(judge.sweep(2500), []);
});

test("skipBefore skips the tail of an active hold whose end has passed", () => {
  const judge = createJudge(withHold());
  judge.press(0, 1000);
  assert.equal(judge.skipBefore(1500), 0); // still active
  assert.equal(judge.skipBefore(2100), 1);
  assert.equal(judge.tailOutcomeOf(0), "skipped");
  assert.deepEqual(judge.release(0, 2100), []);
});

test("fromMs inside a hold skips the whole hold", () => {
  const judge = createJudge(withHold(), { fromMs: 1500 });
  assert.equal(judge.outcomeOf(0), "skipped");
  assert.equal(judge.tailOutcomeOf(0), "skipped");
  assert.equal(judge.remaining(), 1);
});

test("two holds in different lanes overlap and are judged independently", () => {
  const judge = createJudge([
    { t: 1000, lane: 0, len: 1000 },
    { t: 1500, lane: 2, len: 1000 },
  ]);
  assert.equal(judge.press(0, 1000).judgement, "perfect");
  assert.equal(judge.press(2, 1500).judgement, "perfect");
  assert.deepEqual(judge.release(2, 2500), [{ index: 1, judgement: "perfect", errorMs: 0, part: "tail" }]);
  assert.equal(judge.tailOutcomeOf(0), "pending"); // lane 0 is still held
  assert.deepEqual(judge.release(0, 2000), [{ index: 0, judgement: "perfect", errorMs: 0, part: "tail" }]);
  assert.equal(judge.remaining(), 0);
});

test("dropping one overlapping hold leaves the other intact", () => {
  const judge = createJudge([
    { t: 1000, lane: 0, len: 1000 },
    { t: 1500, lane: 3, len: 1000 },
  ]);
  judge.press(0, 1000);
  judge.press(3, 1500);
  assert.equal(judge.release(0, 1200)[0].judgement, "miss");
  assert.equal(judge.tailOutcomeOf(1), "pending");
  assert.deepEqual(judge.sweep(2500).map((r) => [r.index, r.judgement, r.part]), [[1, "perfect", "tail"]]);
});

test("a tap on the same lane right after a hold's end is judged as its own note", () => {
  const judge = createJudge([
    { t: 1000, lane: 0, len: 500 },
    { t: 1600, lane: 0 },
  ]);
  judge.press(0, 1000);
  judge.release(0, 1500);
  assert.deepEqual(judge.press(0, 1600), { index: 1, judgement: "perfect", errorMs: 0, part: "head" });
  assert.equal(judge.remaining(), 0);
});

test("a tap right after a hold that auto-completed on sweep is still judged", () => {
  const judge = createJudge([
    { t: 1000, lane: 0, len: 500 },
    { t: 1600, lane: 0 },
  ]);
  judge.press(0, 1000);
  assert.equal(judge.sweep(1550)[0].part, "tail"); // held through the end
  assert.deepEqual(judge.press(0, 1600), { index: 1, judgement: "perfect", errorMs: 0, part: "head" });
});
