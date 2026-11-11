const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let mock;
let request;

test.before(async () => {
  mock = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/mockRequests.js")).href);
  request = mock.createMockRequest();
});

test("lists enough songs for the list, one of them never charted", async () => {
  const reply = await request("mewbeat_played", { scope: "server" });
  assert.ok(reply.tracks.length >= 8);
  const uncharted = reply.tracks.filter((track) => track.stars === null);
  assert.equal(uncharted.length, 1);
  assert.equal(uncharted[0].bpm, null);
  assert.ok(reply.tracks.every((track) => track.uri && track.audioKey));
  const mine = await request("mewbeat_played", { scope: "mine" });
  assert.ok(mine.tracks.length > 0 && mine.tracks.every((track) => Object.keys(track.bests).length > 0));
});

test("answers a new player with zeros and no stats, and a missing one with not_found", async () => {
  const profile = await request("mewbeat_profile", { userId: mock.NEW_PLAYER_ID });
  assert.equal(profile.status, "ok");
  assert.deepEqual(profile.rating, { pp: 0, global: null, server: null });
  assert.equal(profile.summary.plays, 0);
  assert.deepEqual([profile.recent, profile.best], [[], []]);
  assert.equal((await request("mewbeat_stats", { userId: mock.NEW_PLAYER_ID })).stats, null);

  for (const type of ["mewbeat_profile", "mewbeat_stats"]) {
    const reply = await request(type, { userId: mock.MISSING_PLAYER_ID });
    assert.deepEqual([reply.status, reply.reason], ["error", "not_found"]);
  }
});

test("answers yourself when no user is asked for", async () => {
  const profile = await request("mewbeat_profile", {});
  assert.equal(profile.player.userId, mock.MOCK_USER_ID);
  const stats = await request("mewbeat_stats", {});
  assert.equal(stats.status, "ok");
  assert.ok(stats.stats.maps.length > 0);
});

test("puts both awkward players in the ranking, and gives your own row a name and a picture slot", async () => {
  for (const scope of ["global", "server"]) {
    const reply = await request("mewbeat_ranking", { scope });
    const ids = reply.entries.map((entry) => entry.userId);
    assert.ok(ids.includes(mock.NEW_PLAYER_ID) && ids.includes(mock.MISSING_PLAYER_ID), scope);
    assert.deepEqual(Object.keys(reply.own).sort(), ["accuracy", "avatarUrl", "pp", "rank", "username"]);
  }
  // On the server list you are further down than the rows, so the pinned row has something to show.
  const server = await request("mewbeat_ranking", { scope: "server" });
  assert.ok(!server.entries.some((entry) => entry.userId === mock.MOCK_USER_ID));
  assert.ok(Number.isFinite(server.own.rank));
});

test("gives a level its board, with your pinned best on the global one", async () => {
  const { tracks } = await request("mewbeat_played", { scope: "server" });
  const song = tracks.find((track) => track.bests.normal);
  const server = await request("mewbeat_board", { audioKey: song.audioKey, difficulty: "normal", scope: "server" });
  assert.equal(server.own.rank, 1);
  const global = await request("mewbeat_board", { audioKey: song.audioKey, difficulty: "normal", scope: "global" });
  assert.ok(!global.entries.some((entry) => entry.userId === mock.MOCK_USER_ID));
  assert.ok(global.own.best && Number.isFinite(global.own.rank));
  const unplayed = tracks.find((track) => track.stars && !track.bests.hell);
  const none = await request("mewbeat_board", { audioKey: unplayed.audioKey, difficulty: "hell", scope: "global" });
  assert.deepEqual(none.own, { rank: null, best: null });
});

test("gives the room lobby the four levels of a song, and nothing for an uncharted one", async () => {
  mock.resetMockCharting();
  const { tracks } = await request("mewbeat_played", { scope: "server" });
  const song = tracks.find((track) => track.bests.normal);
  const reply = await request("mewbeat_song_stats", { audioKey: song.audioKey });
  assert.equal(reply.status, "ok");
  assert.deepEqual(Object.keys(reply.stats), ["easy", "normal", "hard", "hell"]);
  assert.ok(Number.isFinite(reply.stats.normal.stars) && Number.isFinite(reply.stats.normal.notes));
  assert.ok(reply.stats.normal.best.grade && reply.stats.normal.best.score > 0);
  const uncharted = tracks.find((track) => track.stars === null);
  assert.equal((await request("mewbeat_song_stats", { audioKey: uncharted.audioKey })).stats, null);
  mock.resetMockCharting();
});

test("the stats of the uncharted song carry its place in line until the charts are there", async (t) => {
  mock.resetMockCharting();
  let clock = 5_000_000;
  t.mock.method(Date, "now", () => clock);
  const { tracks } = await request("mewbeat_played", { scope: "server" });
  const uncharted = tracks.find((track) => track.stars === null);
  const ask = () => request("mewbeat_song_stats", { audioKey: uncharted.audioKey });
  const first = await ask();
  assert.equal(first.stats, null);
  assert.deepEqual(first.queue, { step: "analysis", ahead: 2, running: false });
  clock += 18000;
  const late = await ask();
  assert.equal(late.stats, null);
  assert.equal(late.queue.step, "charts");
  clock += 2000;
  const done = await ask();
  assert.equal(done.queue, undefined);
  assert.ok(["easy", "normal", "hard", "hell"].every((level) => Number.isFinite(done.stats[level].stars)));
  // A charted song never carries a queue.
  const charted = tracks.find((track) => track.stars);
  assert.equal((await request("mewbeat_song_stats", { audioKey: charted.audioKey })).queue, undefined);
  mock.resetMockCharting();
});

test("answers an unknown type with an error", async () => {
  const reply = await request("mewbeat_nope", {});
  assert.deepEqual([reply.status, reply.reason], ["error", "unknown"]);
});

test("answers the map report with a list of recent runs, newest first, each one a different run", async () => {
  const reply = await request("mewbeat_report_runs", {});
  assert.equal(reply.status, "ok");
  assert.ok(reply.runs.length >= 10);
  for (const run of reply.runs) {
    assert.ok(run.audioKey && run.title && run.difficulty && Number.isFinite(run.at), JSON.stringify(run));
  }
  assert.deepEqual(reply.runs.map((run) => run.at), reply.runs.map((run) => run.at).sort((a, b) => b - a));
  assert.equal(new Set(reply.runs.map((run) => `${run.audioKey}|${run.difficulty}|${run.at}`)).size, reply.runs.length);
});

test("charts the uncharted song on request: queued first, ready with stars after the delay, then stays ready", async (t) => {
  mock.resetMockCharting();
  let clock = 1_000_000;
  t.mock.method(Date, "now", () => clock);
  const played = await request("mewbeat_played", { scope: "server" });
  const song = played.tracks.find((track) => track.stars === null);
  const ask = () => request("mewbeat_chart_map", { audioKey: song.audioKey, uri: song.uri });

  const first = await ask();
  assert.deepEqual([first.status, first.state, first.audioKey], ["ok", "queued", song.audioKey]);
  assert.deepEqual(first.queue, { step: "analysis", ahead: 2, running: false });
  clock += 4000;
  const second = await ask();
  assert.equal(second.state, "queued");
  assert.deepEqual(second.queue, { step: "analysis", ahead: 1, running: false });
  // Every 4 s poll of song select sees the next step: the place in line first, then the three steps of its own job.
  const steps = [];
  for (let i = 0; i < 3; i += 1) {
    clock += 4000;
    const reply = await ask();
    assert.equal(reply.state, "queued");
    steps.push(reply.queue);
  }
  assert.deepEqual(steps.map((queue) => [queue.step, queue.ahead, queue.running]), [["analysis", 0, true], ["melody", 0, true], ["charts", 0, true]]);
  clock += 4000;
  const ready = await ask();
  assert.equal(ready.state, "ready");
  assert.ok(["easy", "normal", "hard", "hell"].every((level) => Number.isFinite(ready.stats[level].stars)));
  assert.equal((await ask()).state, "ready");
  mock.resetMockCharting();
});

test("answers ready at once for a charted song and not_found for an unknown one", async () => {
  mock.resetMockCharting();
  const played = await request("mewbeat_played", { scope: "server" });
  const charted = played.tracks.find((track) => track.stars);
  const reply = await request("mewbeat_chart_map", { audioKey: charted.audioKey, uri: charted.uri });
  assert.equal(reply.state, "ready");
  const missing = await request("mewbeat_chart_map", { audioKey: "youtube:nope:1", uri: "https://nowhere.invalid/x" });
  assert.deepEqual([missing.status, missing.reason], ["error", "not_found"]);
});
