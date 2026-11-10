const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let s;

test.before(async () => {
  s = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/scoring.js")).href);
});

function hits(state, judgement, count, songMs = 0, part = "head") {
  for (let i = 0; i < count; i += 1) state = s.applyJudgement(state, judgement, songMs, part);
  return state;
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("health starts at 0.5 and moves by the judgement", () => {
  const start = s.createScore();
  near(s.healthOf(start), 0.5);
  near(s.applyJudgement(start, "perfect", 0).health, 0.51);
  near(s.applyJudgement(start, "great", 0).health, 0.51);
  near(s.applyJudgement(start, "good", 0).health, 0.505);
  near(s.applyJudgement(start, "miss", 0).health, 0.42);
  near(s.applyJudgement(start, "miss", 0, "tail").health, 0.46);
});

test("health stays within 0..1", () => {
  assert.equal(s.healthOf(hits(s.createScore(), "perfect", 100)), 1);
  assert.equal(s.healthOf(hits({ ...s.createScore(), health: 0.99 }, "perfect", 3)), 1);
});

test("the run fails when health reaches 0, and the fail is frozen", () => {
  let state = hits(s.createScore(), "miss", 6, 100);
  near(state.health, 0.02);
  assert.equal(s.isFailed(state), false);
  state = s.applyJudgement(state, "miss", 4000);
  assert.equal(state.health, 0);
  assert.equal(state.failedAt, 4000);
  assert.equal(s.isFailed(state), true);
  assert.equal(s.applyJudgement(state, "perfect", 5000), state);
  assert.equal(s.startFever({ ...state, vibe: 1 }, 5000).fevers, 0);
});

test("a hold tail miss costs less than a head miss", () => {
  near(s.applyJudgement({ ...s.createScore(), health: 0.2 }, "miss", 1, "tail").health, 0.16);
  near(s.applyJudgement({ ...s.createScore(), health: 0.2 }, "miss", 1, "head").health, 0.12);
  // 0.04 left is exactly one tail miss.
  assert.equal(s.isFailed(s.applyJudgement({ ...s.createScore(), health: 0.04 }, "miss", 1, "tail")), true);
});

test("One Life fails on the first miss", () => {
  let state = hits(s.createScore({ modifiers: ["ol"] }), "perfect", 20, 10);
  assert.equal(s.isFailed(state), false);
  state = s.applyJudgement(state, "miss", 777);
  assert.equal(state.failedAt, 777);
  assert.equal(state.health, 0);
  assert.equal(state.counts.miss, 1);
});

test("Four Lives: each miss costs a life and the fourth fails, health aside", () => {
  let state = s.createScore({ modifiers: ["fl"] });
  assert.equal(state.lives, 4);
  state = hits(state, "miss", 3, 10);
  assert.equal(state.lives, 1);
  assert.equal(s.isFailed(state), false);
  state = s.applyJudgement(state, "miss", 55);
  assert.equal(state.lives, 0);
  assert.equal(state.failedAt, 55);
});

test("No Fail never fails, and halves points only after health first hit 0", () => {
  let state = hits(s.createScore({ modifiers: ["nf"] }), "perfect", 1, 0);
  assert.equal(state.score, 300);
  state = hits(state, "miss", 7, 100);
  assert.equal(state.health, 0);
  assert.equal(state.depletedAt, 100);
  assert.equal(s.isFailed(state), false);
  const before = state.score;
  state = s.applyJudgement(state, "perfect", 200);
  assert.equal(state.score - before, 150); // combo is 0 after the misses: 300 * 0.5
  assert.equal(state.depletedAt, 100);
});

test("the implicit noFail flag never fails and carries no penalty", () => {
  const state = hits(s.createScore({ noFail: true }), "miss", 20, 0);
  assert.equal(s.isFailed(state), false);
  assert.equal(state.depletedAt, null);
  assert.equal(s.applyJudgement(state, "perfect", 1).score, 300);
  assert.equal(s.isFailed(hits(s.createScore({ noFail: true, modifiers: ["ol"] }), "miss", 3)), false);
});

test("the modifier multiplier scales points and rounds each judgement", () => {
  assert.equal(s.createScore({ modifiers: ["gn"] }).modMult, 1.16);
  assert.equal(s.applyJudgement(s.createScore({ modifiers: ["gn"] }), "perfect", 0).score, 348);
  assert.equal(s.createScore({ modifiers: ["ss"] }).modMult, 0.6);
  assert.equal(s.applyJudgement(s.createScore({ modifiers: ["ss"] }), "great", 0).score, 120);
  // 100 * 1.43
  assert.equal(s.applyJudgement(s.createScore({ modifiers: ["gn", "st", "fs"] }), "good", 0).score, 143);
  assert.equal(s.applyJudgement(s.createScore({ modifiers: ["st"] }), "good", 0).score, 112);
});

test("the fever bar is sized by the chart: N is max(30, 20% of the parts)", () => {
  assert.equal(s.feverNFor(0), 30);
  assert.equal(s.feverNFor(undefined), 30);
  assert.equal(s.feverNFor(100), 30);
  assert.equal(s.feverNFor(150), 30);
  assert.equal(s.feverNFor(1000), 200);
  assert.equal(s.createScore({ parts: 1000 }).feverN, 200);
});

test("N perfects fill the bar exactly, on a small chart and on a large one", () => {
  for (const parts of [10, 400, 1000, 3333]) {
    const n = s.feverNFor(parts);
    let state = hits(s.createScore({ parts, noFail: true }), "perfect", n - 1);
    assert.ok(state.vibe < 1, `parts ${parts}`);
    state = hits(state, "perfect", 1);
    assert.equal(state.vibe, 1, `parts ${parts}`);
    assert.equal(s.canFever(state, 0), true);
  }
});

test("fever weights: great 0.6, good 0.25, miss -0.05", () => {
  const start = s.createScore({ parts: 1000 }); // N = 200
  near(s.applyJudgement(start, "perfect", 0).vibe, 1 / 200);
  near(s.applyJudgement(start, "great", 0).vibe, 0.6 / 200);
  near(s.applyJudgement(start, "good", 0).vibe, 0.25 / 200);
  near(s.applyJudgement({ ...start, vibe: 0.5 }, "miss", 0).vibe, 0.45);
});

test("createScore() works without arguments", () => {
  const state = s.createScore();
  assert.equal(state.feverN, 30);
  assert.equal(state.modMult, 1);
  assert.equal(state.lives, null);
});
