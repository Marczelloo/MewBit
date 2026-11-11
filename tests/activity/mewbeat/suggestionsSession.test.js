const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let session;

test.before(async () => {
  session = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/suggestionsSession.js")).href);
});
test.beforeEach(() => session.resetSuggestionsSession());

test("starts empty", () => {
  assert.deepEqual(session.suggestionsSession(), { runs: 0, seedKey: null });
});

test("counts a saved run and remembers its song as the one just played", () => {
  assert.equal(session.noteRunSaved({ id: 1, audioKey: "youtube:a:200000" }), true);
  assert.deepEqual(session.suggestionsSession(), { runs: 1, seedKey: "youtube:a:200000" });
  assert.equal(session.noteRunSaved({ id: 2, audioKey: "youtube:b:200000" }), true);
  assert.deepEqual(session.suggestionsSession(), { runs: 2, seedKey: "youtube:b:200000" });
});

test("counts one run once, however often it is told", () => {
  session.noteRunSaved({ id: 4, audioKey: "youtube:a:200000" });
  assert.equal(session.noteRunSaved({ id: 4, audioKey: "youtube:a:200000" }), false);
  assert.equal(session.suggestionsSession().runs, 1);
});

test("ignores calibration, autoplay and runs without a song", () => {
  assert.equal(session.noteRunSaved({ id: 1, audioKey: "youtube:a:200000", calibration: true }), false);
  assert.equal(session.noteRunSaved({ id: 2, audioKey: "youtube:a:200000", autoplay: true }), false);
  assert.equal(session.noteRunSaved({ id: 3, audioKey: null }), false);
  assert.equal(session.noteRunSaved(), false);
  assert.deepEqual(session.suggestionsSession(), { runs: 0, seedKey: null });
});

test("hands out a copy, so the screen cannot change the session", () => {
  session.noteRunSaved({ id: 1, audioKey: "youtube:a:200000" });
  const read = session.suggestionsSession();
  read.runs = 99;
  assert.equal(session.suggestionsSession().runs, 1);
});
