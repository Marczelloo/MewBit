const assert = require("node:assert/strict");
const path = require("node:path");
const { before, describe, it } = require("node:test");
const { pathToFileURL } = require("node:url");

let COUNT_MS;
let IMPACT_DELAY_MS;
let JUDGE_COUNT_MS;
let JUDGE_STEP_MS;
let REVEAL;
let countTicks;
let easeOut;
let resultSoundEvents;

before(async () => {
  ({ COUNT_MS, IMPACT_DELAY_MS, JUDGE_COUNT_MS, JUDGE_STEP_MS, REVEAL, countTicks, easeOut, resultSoundEvents } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/resultTimeline.js")).href
  ));
});

const RUN = { grade: "A", score: 842310, accuracy: 96.4, maxCombo: 312, fevers: 3 };
const SWOOSH_MS = 1500; // sfx/swoosh.wav, which peaks at its very end

describe("mewbeat results timeline", () => {
  it("puts each tick where the number has climbed that step of its value", () => {
    const ticks = countTicks(1000, 300, 1500, 24);
    assert.equal(ticks.length, 23);
    ticks.forEach(({ at, part }, index) => {
      assert.ok(Math.abs(easeOut((at - 300) / 1500) - (index + 1) / 24) < 1e-9);
      assert.equal(part, (index + 1) / 24);
      if (index) assert.ok(at > ticks[index - 1].at);
    });
  });

  it("slows its ticks into the landing", () => {
    const ticks = countTicks(1000, 0, 1500, 24);
    const gaps = ticks.slice(1).map(({ at }, index) => at - ticks[index].at);
    gaps.slice(1).forEach((gap, index) => assert.ok(gap > gaps[index]));
  });

  it("ticks a small count once per step, and an empty or missing one not at all", () => {
    assert.equal(countTicks(3, 0, 300, 6).length, 2);
    assert.equal(countTicks(6, 0, 300, 6).length, 5);
    assert.equal(countTicks(1, 0, 300, 6).length, 0);
    assert.equal(countTicks(0, 0, 300, 6).length, 0);
    assert.equal(countTicks(null, 0, 300, 6).length, 0);
    assert.equal(countTicks(96.4, 0, 300, 6).length, 5);
  });

  it("lands every stat before the next one starts", () => {
    assert.ok(REVEAL.score + COUNT_MS.score <= REVEAL.accuracy);
    assert.ok(REVEAL.accuracy + COUNT_MS.accuracy <= REVEAL.combo);
    assert.ok(REVEAL.combo + COUNT_MS.combo <= REVEAL.fevers);
    assert.ok(REVEAL.fevers + COUNT_MS.fevers <= REVEAL.offset);
    assert.ok(REVEAL.judges + 3 * JUDGE_STEP_MS + JUDGE_COUNT_MS <= REVEAL.timing);
  });

  it("dinks on each landing, with the score's on the swoosh's peak", () => {
    const events = resultSoundEvents(RUN);
    const dinkAt = events.filter(({ name }) => name === "dink").map(({ at }) => at);
    const scoreLands = REVEAL.score + COUNT_MS.score;
    assert.equal(events.find(({ name }) => name === "swoosh").at + SWOOSH_MS, scoreLands);
    for (const landing of [scoreLands, REVEAL.accuracy + COUNT_MS.accuracy, REVEAL.combo + COUNT_MS.combo, REVEAL.fevers + COUNT_MS.fevers]) {
      assert.ok(dinkAt.includes(landing), `no dink at ${landing}`);
    }
    for (let row = 0; row < 4; row += 1) {
      const landing = REVEAL.judges + row * JUDGE_STEP_MS + JUDGE_COUNT_MS;
      assert.ok(dinkAt.includes(landing), `no dink at row ${row}`);
    }
    assert.equal(events.filter(({ name }) => name === "dink-max").length, 1);
  });

  it("has nothing ticking after a count has landed", () => {
    const events = resultSoundEvents(RUN);
    const scoreLands = REVEAL.score + COUNT_MS.score;
    const scoreTicks = events.filter(({ name, at }) => name === "score-tick" && at < REVEAL.accuracy);
    assert.equal(scoreTicks.length, 23);
    assert.ok(scoreTicks.every(({ at }) => at < scoreLands));
    assert.ok(events.filter(({ name }) => name === "score-tick").every(({ at }) => at < REVEAL.offset));
  });

  it("gives no accuracy ticks when the run has no accuracy", () => {
    const ticking = resultSoundEvents({ ...RUN, accuracy: null }).filter(({ name, at }) => name === "score-tick" && at >= REVEAL.accuracy && at < REVEAL.combo);
    assert.deepEqual(ticking, []);
  });

  it("ends in order on the grade's own impact, as its pop settles", () => {
    const impacts = { S: "rank-impact-pass-ss", A: "rank-impact-pass", B: "rank-impact-fail", C: "rank-impact-fail", D: "rank-impact-fail-d" };
    for (const [grade, name] of Object.entries(impacts)) {
      const events = resultSoundEvents({ ...RUN, grade });
      events.slice(1).forEach(({ at }, index) => assert.ok(at >= events[index].at));
      assert.deepEqual(events.at(-1), { at: REVEAL.grade + IMPACT_DELAY_MS, name, level: 1, rate: 1 });
    }
  });
});
