const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createStillLink;
let MOCK_AUDIO_KEY;

test.before(async () => {
  const dir = path.resolve(__dirname, "../../../activity/src/mewbeat");
  ({ createStillLink, MOCK_AUDIO_KEY } = await import(pathToFileURL(path.join(dir, "mockLink.js")).href));
});

// The tour's link: an empty song stands still at its start so the board is clear, and nothing can be sent.
test("the still link holds its song clock at the start while time passes", () => {
  let time = 1000;
  const link = createStillLink({ now: () => time });
  const anchors = [];
  link.onAnchor((kind) => anchors.push(kind));
  link.start();
  assert.equal(link.songClock.audioKey(), MOCK_AUDIO_KEY);
  assert.equal(link.songClock.paused(), true);
  assert.equal(link.songClock.songTimeAt(time), 0);
  time += 60_000;
  assert.equal(link.songClock.songTimeAt(time), 0);
  assert.equal(link.status(), "live");
  assert.equal(anchors.length, 1);
});

test("the still link serves an empty chart for the standing song and exposes no send", async () => {
  const link = createStillLink({ now: () => 0 });
  link.start();
  const got = new Promise((resolve) => link.onChart(resolve));
  assert.equal(link.requestChart(MOCK_AUDIO_KEY, "normal"), true);
  const message = await got;
  assert.equal(message.status, "ready");
  assert.deepEqual(message.chart, { audioKey: MOCK_AUDIO_KEY, difficulty: "normal", notes: [] });
  assert.equal(link.send, undefined);
  // No stage to follow, and nothing special about a run while no scene is on.
  assert.equal(link.onState, undefined);
  assert.deepEqual(link.state(), {});
});

test("the still link restarts at the start and stays quiet after stop", () => {
  let time = 0;
  const link = createStillLink({ now: () => time });
  link.start();
  link.stop();
  time += 5000;
  link.start();
  assert.equal(link.songClock.songTimeAt(time), 0);
  assert.equal(link.track(), null);
});

// The trap's scene: a real song's chart runs on the highway as an autoplay, then the link goes quiet again.
test("a scene moves the clock, answers its key with its chart and says spectating", async () => {
  let time = 1000;
  const link = createStillLink({ now: () => time });
  const anchors = [];
  link.onAnchor((kind) => anchors.push(kind));
  link.start();
  const chart = { audioKey: "yt:fox", difficulty: "hell", notes: [{ t: 18_500, lane: 1 }, { t: 18_700, lane: 2 }] };
  link.playScene({ audioKey: "yt:fox", chart, positionMs: 18_260, durationMs: 200_000, at: time });
  assert.deepEqual(anchors, ["init", "keyChange"]);
  assert.equal(link.songClock.audioKey(), "yt:fox");
  assert.equal(link.songClock.paused(), false);
  assert.equal(link.songClock.songTimeAt(time + 500), 18_760);
  assert.deepEqual(link.state(), { spectating: true });

  const got = new Promise((resolve) => link.onChart(resolve));
  link.requestChart("yt:fox", "hell");
  const message = await got;
  assert.equal(message.status, "ready");
  assert.equal(message.difficulty, "hell");
  assert.deepEqual(message.chart.notes, chart.notes);
  // Whatever level the game asks for, the scene's chart is the answer, and says that level.
  const again = new Promise((resolve) => link.onChart(resolve));
  link.requestChart("yt:fox", "easy");
  assert.equal((await again).chart.difficulty, "easy");

  time += 5000;
  link.pauseScene(time);
  assert.equal(anchors.at(-1), "pause");
  assert.equal(link.songClock.songTimeAt(time + 9000), 23_260);

  link.endScene();
  assert.equal(link.songClock.audioKey(), MOCK_AUDIO_KEY);
  assert.equal(link.songClock.paused(), true);
  assert.equal(link.songClock.songTimeAt(time), 0);
  assert.deepEqual(link.state(), {});
  link.endScene(); // already over: nothing more is announced
  assert.equal(anchors.at(-1), "keyChange");
});

test("a scene ends when the link starts again, and a stale key gets no chart", async () => {
  const link = createStillLink({ now: () => 0 });
  link.start();
  link.playScene({ audioKey: "yt:fox", chart: { notes: [] }, positionMs: 0, durationMs: 1000, at: 0 });
  link.start();
  assert.deepEqual(link.state(), {});
  const got = new Promise((resolve) => link.onChart(resolve));
  link.requestChart("yt:fox", "hell");
  assert.equal((await got).status, "stale");
});
