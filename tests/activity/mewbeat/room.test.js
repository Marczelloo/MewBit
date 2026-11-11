const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let serverNowMs, songProgress, memberStatus, roomView, serverToPerf, startPerfMs, remainingMs, countdownDigit, nextCountdownSecond, countdownSounds, formatClock, lobbyPose, timelineOf, standingsOf, upNextOf, loadedCount, inviteMessage, roomErrorText, isHost, isSpectator, ownerFirst, voteOf;

test.before(async () => {
  ({ serverNowMs, songProgress, memberStatus, roomView, serverToPerf, startPerfMs, remainingMs, countdownDigit, nextCountdownSecond, countdownSounds, formatClock, lobbyPose, timelineOf, standingsOf, upNextOf, loadedCount, inviteMessage, roomErrorText, isHost, isSpectator, ownerFirst, voteOf } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/room.js")).href
  ));
});

const member = (userId, extra = {}) => ({ userId, username: userId, avatarUrl: null, difficulty: "normal", ready: false, loaded: false, spectator: false, submitted: false, ...extra });
const track = (audioKey, addedBy, durationMs = 180_000) => ({ audioKey, title: audioKey, artist: "a", durationMs, addedBy });
const room = (extra = {}) => ({
  hostId: "h", phase: "lobby", round: 0, endedAt: null, members: [member("h"), member("u1")], queue: [], current: null,
  startAt: null, nextAt: null, results: [], serverNow: 1000, ...extra,
});

test("roomView: no room, lobby and intermission show the lobby", () => {
  assert.equal(roomView(null, "u1"), "none");
  assert.equal(roomView(room(), "u1"), "lobby");
  assert.equal(roomView(room({ phase: "intermission" }), "u1"), "lobby");
});

test("roomView: loading is the loading state for players, watching for spectators", () => {
  const r = room({ phase: "loading", members: [member("h"), member("u1"), member("s", { spectator: true })] });
  assert.equal(roomView(r, "u1"), "loading");
  assert.equal(roomView(r, "s"), "watching");
});

test("roomView: countdown and playing need a prepared client, otherwise watching", () => {
  const loadedMembers = [member("h"), member("u1", { loaded: true })];
  const countdown = room({ phase: "countdown", members: loadedMembers });
  const playing = room({ phase: "playing", members: loadedMembers });
  assert.equal(roomView(countdown, "u1", { prepared: true }), "countdown");
  assert.equal(roomView(countdown, "u1", { prepared: false }), "watching");
  assert.equal(roomView(playing, "u1", { prepared: true }), "playing");
  assert.equal(roomView(playing, "u1", { prepared: false }), "watching");
});

test("roomView: a player the server did not count as loaded watches", () => {
  assert.equal(roomView(room({ phase: "playing" }), "u1", { prepared: true }), "watching");
});

test("roomView: someone not in the member list watches a running round", () => {
  assert.equal(roomView(room({ phase: "playing" }), "stranger", { prepared: true }), "watching");
});

test("isHost and isSpectator", () => {
  const r = room({ members: [member("h"), member("s", { spectator: true })] });
  assert.equal(isHost(r, "h"), true);
  assert.equal(isHost(r, "s"), false);
  assert.equal(isSpectator(r, "s"), true);
  assert.equal(isSpectator(r, "h"), false);
});

test("ownerFirst: the owner leads, the rest keep the server's order, and a new owner moves up", () => {
  const members = [member("a"), member("b"), member("h"), member("c")];
  assert.deepEqual(ownerFirst(room({ members })).map((m) => m.userId), ["h", "a", "b", "c"]);
  assert.deepEqual(ownerFirst(room({ members, hostId: "c" })).map((m) => m.userId), ["c", "a", "b", "h"]);
  assert.deepEqual(ownerFirst(room({ members, hostId: "gone" })).map((m) => m.userId), ["a", "b", "h", "c"]);
  assert.deepEqual(ownerFirst(null), []);
});

test("serverToPerf: the synced offset wins, serverNow is the fallback", () => {
  assert.equal(serverToPerf(10_000, { offsetMs: 4000 }), 6000);
  assert.equal(serverToPerf(10_000, { offsetMs: null, serverNow: 5000, receivedAtMs: 200 }), 5200);
  assert.equal(serverToPerf(10_000, {}), null);
  assert.equal(serverToPerf(NaN, { offsetMs: 0 }), null);
  assert.equal(startPerfMs(10_000, { offsetMs: 2500 }), 7500);
});

test("remainingMs counts down to a server time", () => {
  assert.equal(remainingMs(10_000, { offsetMs: 4000 }, 5000), 1000);
  assert.equal(remainingMs(10_000, { offsetMs: 4000 }, 7000), -1000);
  assert.equal(remainingMs(10_000, {}, 0), null);
});

test("countdownDigit: 5..1, GO at the start, null outside", () => {
  assert.equal(countdownDigit(10_000, 4_000), null); // 6 s left: not yet
  assert.equal(countdownDigit(10_000, 5_000), 5);
  assert.equal(countdownDigit(10_000, 5_100), 5);
  assert.equal(countdownDigit(10_000, 6_100), 4);
  assert.equal(countdownDigit(10_000, 9_000), 1);
  assert.equal(countdownDigit(10_000, 9_999), 1);
  assert.equal(countdownDigit(10_000, 10_000), 0);
  assert.equal(countdownDigit(10_000, 10_700), 0);
  assert.equal(countdownDigit(10_000, 10_800), null);
  assert.equal(countdownDigit(null, 10_000), null);
});

test("formatClock", () => {
  assert.equal(formatClock(15_000), "0:15");
  assert.equal(formatClock(14_001), "0:15");
  assert.equal(formatClock(65_000), "1:05");
  assert.equal(formatClock(-500), "0:00");
  assert.equal(formatClock(null), "0:00");
});

test("lobbyPose follows the mockup rules", () => {
  assert.equal(lobbyPose({ phase: "countdown", digit: 5 }), "hype");
  assert.equal(lobbyPose({ phase: "countdown", digit: 3 }), "count3");
  assert.equal(lobbyPose({ phase: "countdown", digit: 1 }), "count1");
  assert.equal(lobbyPose({ phase: "countdown", digit: 0 }), "go");
  assert.equal(lobbyPose({ phase: "intermission", remainingMs: 15_000 }), "peek");
  assert.equal(lobbyPose({ phase: "intermission", remainingMs: 40_000 }), "idle");
  assert.equal(lobbyPose({ phase: "lobby", remainingMs: null }), "idle");
  assert.equal(lobbyPose({ phase: "lobby", remainingMs: 5000 }), "peek");
  assert.equal(lobbyPose({ phase: "lobby", remainingMs: 60_000 }), "idle");
});

test("timelineOf: current first, own adds flagged, remove for host or adder", () => {
  const r = room({
    phase: "playing", round: 2, current: track("c", "h"),
    queue: [track("a", "u1"), track("b", "u2", 90_000)],
  });
  const asUser = timelineOf(r, "u1");
  assert.deepEqual(asUser.map((s) => s.track.audioKey), ["c", "a", "b"]);
  assert.deepEqual(asUser.map((s) => s.current), [true, false, false]);
  assert.deepEqual(asUser.map((s) => s.mine), [false, true, false]);
  assert.deepEqual(asUser.map((s) => s.canRemove), [false, true, false]);
  assert.deepEqual(asUser.map((s) => s.index), [null, 0, 1]);
  assert.deepEqual(asUser.map((s) => s.canMove), [false, false, false]);
  const asHost = timelineOf(r, "h");
  assert.deepEqual(asHost.map((s) => s.canRemove), [false, true, true]);
  assert.deepEqual(asHost.map((s) => s.canMove), [false, true, true]);
});

test("timelineOf: played songs come first, finished, and cannot be touched", () => {
  const r = room({ current: track("c", "h"), queue: [track("a", "u1")], played: [track("p", "h"), track("p", "u1")] });
  const rows = timelineOf(r, "h");
  assert.deepEqual(rows.map((s) => s.track.audioKey), ["p", "p", "c", "a"]);
  assert.deepEqual(rows.map((s) => s.played), [true, true, false, false]);
  assert.equal(new Set(rows.map((s) => s.key)).size, 4);
  assert.deepEqual(rows.slice(0, 2).map((s) => [s.finished, s.index, s.canRemove, s.canMove]), [[true, null, false, false], [true, null, false, false]]);
});

test("timelineOf: nothing without a room, queue only without a current song", () => {
  assert.deepEqual(timelineOf(null, "u1"), []);
  assert.equal(timelineOf(room({ queue: [track("a", "u1")] }), "u1").length, 1);
});

test("standingsOf: only for a finished round, with avatars from members and the ready flag", () => {
  const results = [
    { userId: "u1", username: "u1", score: 900, accuracy: 0.95, grade: "S", difficulty: "hard" },
    { userId: "h", username: "h", score: 800, accuracy: 0.9, grade: "A", difficulty: "normal" },
  ];
  const members = [member("h", { ready: true }), member("u1", { avatarUrl: "http://x/a.png" })];
  assert.deepEqual(standingsOf(room({ endedAt: null, results, members }), "u1"), []);
  const rows = standingsOf(room({ endedAt: 5, results, members }), "u1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].me, true);
  assert.equal(rows[0].avatarUrl, "http://x/a.png");
  assert.equal(rows[0].next, false);
  assert.equal(rows[1].me, false);
  assert.equal(rows[1].next, true);
});

test("standingsOf: carries failed and the modifiers, with old rows reading as clean", () => {
  const results = [
    { userId: "u1", username: "u1", score: 900, accuracy: 0.95, grade: "S", difficulty: "hard", failed: false, modifiers: ["gn", "st"] },
    { userId: "h", username: "h", score: 300, accuracy: 0.5, grade: "D", difficulty: "normal", failed: true, modifiers: ["ol"] },
    { userId: "old", username: "old", score: 100, accuracy: 0.4, grade: "D", difficulty: "easy" },
  ];
  const rows = standingsOf(room({ endedAt: 5, results, members: [member("h"), member("u1"), member("old")] }), "u1");
  assert.deepEqual(rows.map((row) => row.failed), [false, true, false]);
  assert.deepEqual(rows.map((row) => row.modifiers), [["gn", "st"], ["ol"], []]);
});

test("upNextOf and loadedCount", () => {
  assert.equal(upNextOf(room()), null);
  assert.deepEqual(upNextOf(room({ queue: [track("a", "u1")] })), { title: "a", ready: true });
  const r = room({ members: [member("h", { loaded: true }), member("u1"), member("s", { spectator: true, loaded: true })] });
  assert.deepEqual(loadedCount(r), { loaded: 1, total: 2 });
});

test("inviteMessage maps every reply", () => {
  assert.equal(inviteMessage({ status: "ok" }).ok, true);
  assert.match(inviteMessage({ status: "error", reason: "cooldown", retryInMs: 4200 }).text, /5s/);
  assert.match(inviteMessage({ status: "error", reason: "no_voice_channel" }).text, /voice channel/);
  assert.match(inviteMessage({ status: "error", reason: "not_in_room" }).text, /not in the room/);
  assert.match(inviteMessage({ status: "error", reason: "send_failed" }).text, /Couldn't/);
  assert.equal(inviteMessage(null).ok, false);
});

test("roomErrorText has copy for known reasons and a fallback", () => {
  assert.match(roomErrorText("queue_full"), /full/);
  assert.match(roomErrorText({ reason: "not_host" }), /host/);
  assert.match(roomErrorText("in_round"), /middle of your round/);
  assert.match(roomErrorText("???"), /Something went wrong/);
});

test("serverNowMs uses the synced offset, else the snapshot's own clock", () => {
  assert.equal(serverNowMs({ offsetMs: 4000 }, 6000), 10_000);
  assert.equal(serverNowMs({ offsetMs: null, serverNow: 5000, receivedAtMs: 200 }, 700), 5500);
  assert.equal(serverNowMs({}, 700), null);
});

test("songProgress: nothing before the song, a fraction while playing, full once the round ended", () => {
  const playing = room({ phase: "playing", current: track("c", "h", 100_000), startAt: 10_000 });
  const mapping = { offsetMs: 0 };
  assert.equal(songProgress(room(), mapping, 0), 0);
  assert.equal(songProgress(room({ ...playing, phase: "countdown" }), mapping, 5000), 0);
  assert.equal(songProgress(playing, mapping, 35_000), 0.25);
  assert.equal(songProgress(playing, mapping, 999_000), 1);
  assert.equal(songProgress({ ...playing, phase: "intermission", endedAt: 1 }, mapping, 0), 1);
  assert.equal(songProgress(playing, {}, 0), 0);
});

test("songProgress starts after the silence before the song", () => {
  const playing = room({ phase: "playing", current: track("c", "h", 100_000), startAt: 10_000, silenceMs: 2000 });
  const mapping = { offsetMs: 0 };
  assert.equal(songProgress(playing, mapping, 11_000), 0);
  assert.equal(songProgress(playing, mapping, 37_000), 0.25);
});

test("nextCountdownSecond lands on the moment the digit changes, down to GO and no further", () => {
  assert.deepEqual(nextCountdownSecond(3500), { second: 3, inMs: 500 });
  assert.deepEqual(nextCountdownSecond(3000), { second: 2, inMs: 1000 });
  assert.deepEqual(nextCountdownSecond(0.5), { second: 0, inMs: 0.5 });
  assert.equal(nextCountdownSecond(0), null);
  assert.equal(nextCountdownSecond(-20), null);
  assert.equal(nextCountdownSecond(Number.NaN), null);
  for (const left of [3500, 1200, 400]) {
    const { second, inMs } = nextCountdownSecond(left);
    assert.equal(countdownDigit(left, inMs + 0.01), second || 0, "the screen shows the same second just after");
  }
});

test("countdownSounds: GO on a kick at zero, full ticks for the last five, quiet ones before", () => {
  const tick = { name: "tick", level: 1 };
  assert.deepEqual(countdownSounds(0), [{ name: "go", level: 1 }, { name: "hit-kick", level: 1 }]);
  assert.deepEqual(countdownSounds(3), [tick]);
  assert.deepEqual(countdownSounds(4), [tick]);
  assert.deepEqual(countdownSounds(5), [tick]);
  const [quiet, ...rest] = countdownSounds(6);
  assert.equal(quiet.name, "tick");
  assert.ok(quiet.level > 0 && quiet.level < 1);
  assert.deepEqual(rest, []);
});

test("voteOf uses the server's tally, and counts the players by the same rule when a snapshot has none", () => {
  const members = [member("h", { ready: true }), member("u1"), member("u2", { ready: true }), member("w", { spectator: true, ready: true })];
  // No tally in the snapshot: three players (the watcher is not one), two voted, two needed.
  const counted = voteOf(room({ members }));
  assert.deepEqual([counted.votes, counted.needed, counted.players], [2, 2, 3]);
  assert.deepEqual(counted.voters.map((m) => m.userId), ["h", "u2"]);
  assert.deepEqual(counted.waiting.map((m) => m.userId), ["u1"]);
  assert.equal(counted.counting, false);
  // The server's own numbers win.
  const served = voteOf(room({ members, votes: 1, votesNeeded: 3, finalCountdown: true, nextAt: 6000, forced: true }));
  assert.deepEqual([served.votes, served.needed, served.counting, served.forced], [1, 3, true, true]);
  // Nobody to vote: nothing is needed.
  assert.equal(voteOf(room({ members: [member("w", { spectator: true })] })).needed, 0);
  assert.equal(voteOf(null).needed, 0);
});

test("memberStatus follows the phase", () => {
  const m = (extra) => member("u1", extra);
  assert.deepEqual(memberStatus(room(), m({ ready: true })), { text: "Voted", tone: "ok" });
  assert.deepEqual(memberStatus(room(), m()), { text: "Not voted", tone: "wait" });
  assert.deepEqual(memberStatus(room({ phase: "loading" }), m()), { text: "Loading…", tone: "wait" });
  assert.deepEqual(memberStatus(room({ phase: "loading" }), m({ loaded: true })), { text: "Loaded", tone: "ok" });
  assert.deepEqual(memberStatus(room({ phase: "playing" }), m({ loaded: true })), { text: "Playing", tone: "ok" });
  assert.deepEqual(memberStatus(room({ phase: "playing" }), m({ submitted: true })), { text: "Done", tone: "ok" });
  assert.deepEqual(memberStatus(room({ phase: "playing" }), m({ spectator: true })), { text: "Watching", tone: "wait" });
});
