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
  assert.deepEqual(judge.press(0, 1050), { index: 0, judgement: "great", errorMs: 50 });
  assert.equal(judge.outcomeOf(0), "great");
  assert.equal(judge.outcomeOf(1), "pending");
});

test("an early press has a negative error", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.press(1, 970), { index: 2, judgement: "perfect", errorMs: -30 });
});

test("a press with no note in reach is a ghost tap", () => {
  const judge = createJudge(sample());
  assert.equal(judge.press(2, 1000), null);
  assert.equal(judge.press(0, 800), null);
  assert.equal(judge.remaining(), 3);
});

test("sweep misses notes only once past the GOOD window, in index order", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.sweep(1135), []);
  assert.deepEqual(judge.sweep(1136), [
    { index: 0, judgement: "miss", errorMs: null },
    { index: 2, judgement: "miss", errorMs: null },
  ]);
  assert.deepEqual(judge.sweep(1236), [{ index: 1, judgement: "miss", errorMs: null }]);
  assert.equal(judge.remaining(), 0);
  assert.deepEqual(judge.sweep(5000), []);
});

test("sweep does not re-miss a note that press already judged ahead of it", () => {
  const judge = createJudge(sample());
  judge.press(0, 1100); // index 0, 100ms late -> good
  judge.press(0, 1100); // index 1, perfect
  assert.deepEqual(judge.sweep(1236), [{ index: 2, judgement: "miss", errorMs: null }]);
});

test("a late press can hit a note that has not been swept yet", () => {
  const judge = createJudge(sample());
  assert.deepEqual(judge.press(1, 1135), { index: 2, judgement: "good", errorMs: 135 });
  assert.equal(judge.press(1, 1136), null);
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
  assert.deepEqual(judge.sweep(1236), [{ index: 1, judgement: "miss", errorMs: null }]);
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
