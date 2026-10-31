const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let s;

test.before(async () => {
  s = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/scoring.js")).href);
});

function hits(state, judgement, count, songMs = 0) {
  for (let i = 0; i < count; i += 1) state = s.applyJudgement(state, judgement, songMs);
  return state;
}

test("judgement windows are inclusive at their upper bound", () => {
  assert.equal(s.judgementFor(0), "perfect");
  assert.equal(s.judgementFor(45), "perfect");
  assert.equal(s.judgementFor(45.01), "great");
  assert.equal(s.judgementFor(46), "great");
  assert.equal(s.judgementFor(90), "great");
  assert.equal(s.judgementFor(135), "good");
  assert.equal(s.judgementFor(136), null);
});

test("multiplier steps up every ten combo and caps at 4", () => {
  assert.deepEqual([0, 9, 10, 19, 20, 29, 30, 99].map(s.multiplierFor), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test("a fresh score is all zeros", () => {
  assert.deepEqual(s.createScore(), {
    score: 0,
    combo: 0,
    maxCombo: 0,
    vibe: 0,
    feverUntil: null,
    fevers: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
  });
});

test("applyJudgement does not mutate its input", () => {
  const before = s.createScore();
  const frozen = JSON.stringify(before);
  s.applyJudgement(before, "perfect", 0);
  assert.equal(JSON.stringify(before), frozen);
});

test("ten PERFECTs score 3000 and the 11th is worth 600", () => {
  let state = hits(s.createScore(), "perfect", 10);
  assert.equal(state.score, 3000);
  state = s.applyJudgement(state, "perfect", 0);
  assert.equal(state.score, 3600);
  assert.equal(state.counts.perfect, 11);
  assert.equal(state.combo, 11);
});

test("a MISS breaks the combo, costs vibe and keeps maxCombo", () => {
  let state = hits(s.createScore(), "perfect", 25);
  const vibeBefore = state.vibe;
  const scoreBefore = state.score;
  state = s.applyJudgement(state, "miss", 0);
  assert.equal(state.combo, 0);
  assert.equal(state.maxCombo, 25);
  assert.equal(state.score, scoreBefore);
  assert.equal(state.counts.miss, 1);
  assert.ok(Math.abs(state.vibe - (vibeBefore - 0.06)) < 1e-9);
});

test("vibe clamps to 0..1", () => {
  assert.equal(hits(s.createScore(), "perfect", 40).vibe, 1);
  assert.equal(hits(s.createScore(), "miss", 5).vibe, 0);
});

test("FEVER doubles points for 8 seconds and drains vibe linearly", () => {
  let state = { ...s.createScore(), vibe: 1 };
  assert.equal(s.canFever(state, 10000), true);
  state = s.startFever(state, 10000);
  assert.equal(state.feverUntil, 18000);
  assert.equal(state.fevers, 1);
  assert.equal(s.canFever(state, 12000), false);
  assert.equal(s.vibeAt(state, 10000), 1);
  assert.equal(s.vibeAt(state, 14000), 0.5);

  const during = s.applyJudgement(state, "perfect", 12000);
  assert.equal(during.score, 600);
  assert.equal(during.vibe, state.vibe);

  const after = s.applyJudgement(during, "perfect", 18000);
  assert.equal(after.score, 600 + 300);
  assert.equal(after.feverUntil, null);
  assert.equal(after.vibe, 0.03);
  assert.equal(s.vibeAt(after, 18000), 0.03);
});

test("a hit exactly when FEVER ends gets no doubling", () => {
  const state = s.startFever({ ...s.createScore(), vibe: 1 }, 10000);
  const after = s.applyJudgement(state, "perfect", 18000);
  assert.equal(after.score, 300);
});

test("vibe is 0 once FEVER has ended and FEVER cannot restart on stale vibe", () => {
  const state = s.startFever({ ...s.createScore(), vibe: 1 }, 0);
  assert.equal(s.vibeAt(state, 8000), 0);
  assert.equal(s.vibeAt(state, 9000), 0);
  assert.equal(s.canFever(state, 9000), false);
});

test("startFever refuses unless vibe is full", () => {
  const state = { ...s.createScore(), vibe: 0.99 };
  assert.equal(s.canFever(state, 5000), false);
  assert.equal(s.startFever(state, 5000), state);
});

test("accuracyOf is the weighted mean, or null with nothing judged", () => {
  assert.equal(s.accuracyOf({ perfect: 1, great: 1, good: 1, miss: 1 }), 50);
  assert.equal(s.accuracyOf({ perfect: 3, great: 0, good: 0, miss: 0 }), 100);
  assert.equal(s.accuracyOf({ perfect: 0, great: 1, good: 0, miss: 2 }), 22.23);
  assert.equal(s.accuracyOf({ perfect: 0, great: 0, good: 0, miss: 0 }), null);
});

test("gradeOf maps accuracy to a letter", () => {
  assert.deepEqual([95, 94.99, 90, 80, 70, 69.99].map(s.gradeOf), ["S", "A", "A", "B", "C", "D"]);
  assert.equal(s.gradeOf(null), null);
});
