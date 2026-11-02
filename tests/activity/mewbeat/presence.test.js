const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let presenceOf;

test.before(async () => {
  ({ presenceOf } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/presence.js")).href));
});

const TRACK = { title: "WATCH ME", artworkUrl: "https://example.com/a.jpg" };
const HUD = { score: 123400.4, combo: 52, accuracy: 96.4 };
const RUN = { track: TRACK, difficulty: "normal", hud: HUD, summary: null, playing: true, paused: false, autoplay: false, calibrating: false, spectating: false };

test("a run shows its song, score, combo, accuracy and grade", () => {
  assert.deepEqual(presenceOf(RUN), { details: "WATCH ME · Normal", state: "123,400 · 52x · 96.40% · S", artworkUrl: TRACK.artworkUrl });
});

test("a run with nothing judged yet stands at 100%", () => {
  assert.equal(presenceOf({ ...RUN, hud: { score: 0, combo: 0, accuracy: null } }).state, "0 · 0x · 100.00% · S");
});

test("a paused run says so", () => {
  assert.equal(presenceOf({ ...RUN, paused: true }).state, "Paused · 123,400 · 52x · 96.40% · S");
});

test("a run that isn't the player's own shows no numbers", () => {
  assert.equal(presenceOf({ ...RUN, autoplay: true }).state, "Autoplay");
  assert.equal(presenceOf({ ...RUN, calibrating: true }).state, "Calibrating");
  assert.equal(presenceOf({ ...RUN, spectating: true }).state, "Watching a run");
});

test("the results show how the run finished", () => {
  const summary = { title: "Song", difficulty: "hard", artworkUrl: null, grade: "A", accuracy: 91.5, score: 9000 };
  assert.deepEqual(presenceOf({ ...RUN, summary, playing: false }), { details: "Song · Hard", state: "Finished · A · 91.50% · 9,000", artworkUrl: TRACK.artworkUrl });
  assert.equal(presenceOf({ ...RUN, summary: { ...summary, autoplay: true }, playing: false }).state, "Finished");
});

test("with no run on, the player is choosing a song", () => {
  assert.deepEqual(presenceOf({ ...RUN, track: null, difficulty: null, playing: false }), { details: "Playing mewbeat", state: "Choosing a song", artworkUrl: null });
  assert.equal(presenceOf({ ...RUN, playing: false }).details, "Playing mewbeat");
});
