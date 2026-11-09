const assert = require("node:assert/strict");
const path = require("node:path");
const { before, describe, it } = require("node:test");
const { pathToFileURL } = require("node:url");

let resultBoardTarget;

before(async () => {
  ({ resultBoardTarget } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/resultBoard.js")).href));
});

const RUN = { audioKey: "youtube:abc123:180000", difficulty: "normal", calibration: false, submit: { status: "ok" } };

describe("mewbeat results board target", () => {
  it("names the chart played at the difficulty played", () => {
    assert.deepEqual(resultBoardTarget(RUN), { audioKey: RUN.audioKey, difficulty: "normal", ready: true });
  });

  it("waits while the score is on its way, and asks once it settled either way", () => {
    assert.equal(resultBoardTarget({ ...RUN, submit: { status: "submitting" } }).ready, false);
    for (const status of ["ok", "error", "skipped"]) assert.equal(resultBoardTarget({ ...RUN, submit: { status } }).ready, true);
    assert.equal(resultBoardTarget({ ...RUN, submit: undefined }).ready, true);
  });

  it("is there for a refused or unranked run too, since only the submit status matters", () => {
    assert.equal(resultBoardTarget({ ...RUN, autoplay: true, difficultyChanged: true, skipped: 4, submit: { status: "skipped" } }).ready, true);
    assert.equal(resultBoardTarget({ ...RUN, submit: { status: "ok", result: { ranked: false } } }).ready, true);
  });

  it("has none for a calibration run or a run with no chart", () => {
    assert.equal(resultBoardTarget({ ...RUN, calibration: true }), null);
    assert.equal(resultBoardTarget({ ...RUN, audioKey: null }), null);
    assert.equal(resultBoardTarget({ ...RUN, difficulty: null }), null);
    assert.equal(resultBoardTarget(null), null);
  });
});
