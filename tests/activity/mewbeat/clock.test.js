const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createServerClock;
let createSongClock;

test.before(async () => {
  ({ createServerClock, createSongClock } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/clock.js")).href
  ));
});

// A sample with the given offset and rtt: the server stamped at the round trip's midpoint.
const sampleOf = (offset, rtt, sent = 1000) => ({
  clientSentAt: sent,
  clientReceivedAt: sent + rtt,
  serverNow: sent + rtt / 2 + offset,
});

test("server clock: median offset of the lowest-rtt samples, outliers excluded", () => {
  const clock = createServerClock({ bestOf: 3 });
  assert.equal(clock.offsetMs(), null);
  for (const [offset, rtt] of [[100, 10], [102, 12], [98, 14], [500, 900], [101, 11]]) {
    clock.addSample(sampleOf(offset, rtt));
  }
  assert.equal(clock.offsetMs(), 101);
});

test("server clock: even bestOf takes the mean of the two middle offsets", () => {
  const clock = createServerClock({ bestOf: 4 });
  for (const [offset, rtt] of [[100, 10], [104, 11], [110, 12], [90, 13]]) {
    clock.addSample(sampleOf(offset, rtt));
  }
  assert.equal(clock.offsetMs(), 102);
});

test("server clock: ready after three accepted samples", () => {
  const clock = createServerClock();
  clock.addSample(sampleOf(100, 10));
  clock.addSample(sampleOf(100, 10));
  assert.equal(clock.ready(), false);
  clock.addSample(sampleOf(100, 10));
  assert.equal(clock.ready(), true);
});

test("server clock: negative or oversized rtt is ignored", () => {
  const clock = createServerClock();
  clock.addSample({ clientSentAt: 1000, clientReceivedAt: 990, serverNow: 5000 });
  clock.addSample(sampleOf(100, 2001));
  assert.equal(clock.offsetMs(), null);
  assert.equal(clock.ready(), false);
  clock.addSample(sampleOf(100, 2000));
  assert.equal(clock.offsetMs(), 100);
});

test("server clock: only the last maxSamples samples count", () => {
  const clock = createServerClock({ maxSamples: 2, bestOf: 2 });
  clock.addSample(sampleOf(900, 1));
  clock.addSample(sampleOf(10, 50));
  clock.addSample(sampleOf(20, 60));
  assert.equal(clock.offsetMs(), 15);
});

test("server clock: serverTimeAt adds the offset", () => {
  const clock = createServerClock();
  clock.addSample(sampleOf(250, 10));
  assert.equal(clock.serverTimeAt(4000), 4250);
});

// Offset 0 server clock and a settable perf time.
function songClockAt(opts) {
  let perf = 0;
  const clock = createSongClock({ serverTimeAt: (p) => p }, { ...opts, now: () => perf });
  return {
    clock,
    setAnchor(anchor, atPerf) {
      perf = atPerf;
      return clock.setAnchor(anchor);
    },
  };
}

const playing = (positionMs, at, extra = {}) => ({ audioKey: "a", positionMs, at, paused: false, durationMs: 100000, ...extra });

test("song clock: no anchor means null time", () => {
  const { clock } = songClockAt();
  assert.equal(clock.songTimeAt(100), null);
  assert.equal(clock.audioKey(), null);
  assert.equal(clock.paused(), false);
});

test("song clock: the first anchor inits and song time follows the server clock", () => {
  const h = songClockAt();
  assert.equal(h.setAnchor(playing(1000, 5000), 5000), "init");
  assert.equal(h.clock.songTimeAt(5000), 1000);
  assert.equal(h.clock.songTimeAt(5500), 1500);
  assert.equal(h.clock.audioKey(), "a");
});

test("song clock: a paused anchor holds the position", () => {
  const h = songClockAt();
  h.setAnchor(playing(1000, 5000, { paused: true }), 5000);
  assert.equal(h.clock.paused(), true);
  assert.equal(h.clock.songTimeAt(5000), 1000);
  assert.equal(h.clock.songTimeAt(9000), 1000);
});

test("song clock: pause and resume rebase immediately", () => {
  const h = songClockAt();
  h.setAnchor(playing(1000, 5000), 5000);
  assert.equal(h.setAnchor(playing(2000, 6000, { paused: true }), 6000), "pause");
  assert.equal(h.clock.songTimeAt(7000), 2000);
  assert.equal(h.setAnchor(playing(2000, 8000), 8000), "resume");
  assert.equal(h.clock.songTimeAt(8000), 2000);
  assert.equal(h.clock.songTimeAt(8300), 2300);
});

test("song clock: a small drift slews without jumping or running backwards", () => {
  const h = songClockAt({ slewMs: 600 });
  h.setAnchor(playing(1000, 5000), 5000);
  // At perf 6000 the old line says 2000; the new anchor says 2030.
  assert.equal(h.setAnchor(playing(2030, 6000), 6000), "slew");
  assert.equal(h.clock.songTimeAt(6000), 2000);
  let prev = h.clock.songTimeAt(6000);
  for (let t = 6001; t <= 6600; t += 1) {
    const now = h.clock.songTimeAt(t);
    assert.ok(now >= prev, `song time went backwards at ${t}`);
    prev = now;
  }
  assert.equal(h.clock.songTimeAt(6600), 2630);
  assert.equal(h.clock.songTimeAt(7000), 3030);
});

test("song clock: slewing backwards stays monotonic too", () => {
  const h = songClockAt({ slewMs: 600 });
  h.setAnchor(playing(1000, 5000), 5000);
  assert.equal(h.setAnchor(playing(1970, 6000), 6000), "slew");
  let prev = h.clock.songTimeAt(6000);
  for (let t = 6001; t <= 6600; t += 1) {
    const now = h.clock.songTimeAt(t);
    assert.ok(now >= prev, `song time went backwards at ${t}`);
    prev = now;
  }
  assert.equal(h.clock.songTimeAt(6600), 2570);
});

test("song clock: a re-anchor mid-slew uses the displayed time", () => {
  const h = songClockAt({ slewMs: 600 });
  h.setAnchor(playing(1000, 5000), 5000);
  h.setAnchor(playing(2030, 6000), 6000);
  // Halfway through the slew the display is 2300 + 15; the new line says 2330.
  assert.equal(h.clock.songTimeAt(6300), 2315);
  assert.equal(h.setAnchor(playing(2330, 6300), 6300), "slew");
  assert.equal(h.clock.songTimeAt(6300), 2315);
  assert.equal(h.clock.songTimeAt(6900), 2930);
});

test("song clock: a large jump snaps", () => {
  const h = songClockAt();
  h.setAnchor(playing(1000, 5000), 5000);
  assert.equal(h.setAnchor(playing(4000, 6000), 6000), "snap");
  assert.equal(h.clock.songTimeAt(6000), 4000);
  assert.equal(h.clock.songTimeAt(6100), 4100);
});

test("song clock: a different audioKey rebases", () => {
  const h = songClockAt();
  h.setAnchor(playing(1000, 5000), 5000);
  assert.equal(h.setAnchor(playing(50, 6000, { audioKey: "b" }), 6000), "keyChange");
  assert.equal(h.clock.audioKey(), "b");
  assert.equal(h.clock.songTimeAt(6000), 50);
});

test("song clock: a paused anchor re-sent for the same track rebases", () => {
  const h = songClockAt();
  h.setAnchor(playing(1000, 5000, { paused: true }), 5000);
  assert.equal(h.setAnchor(playing(1100, 6000, { paused: true }), 6000), "slew");
  assert.equal(h.clock.songTimeAt(6000), 1100);
  assert.equal(h.setAnchor(playing(9000, 7000, { paused: true }), 7000), "snap");
  assert.equal(h.clock.songTimeAt(7000), 9000);
});

test("song clock: null clears", () => {
  const h = songClockAt();
  assert.equal(h.setAnchor(null, 100), "clear");
  h.setAnchor(playing(1000, 5000), 5000);
  assert.equal(h.setAnchor(null, 5100), "clear");
  assert.equal(h.clock.songTimeAt(5200), null);
  assert.equal(h.clock.audioKey(), null);
  assert.equal(h.clock.paused(), false);
  assert.equal(h.setAnchor(playing(0, 6000), 6000), "init");
});

test("song clock: clamped to [0, durationMs]", () => {
  const h = songClockAt();
  h.setAnchor(playing(900, 5000, { durationMs: 1000 }), 5000);
  assert.equal(h.clock.songTimeAt(5500), 1000);
  assert.equal(h.clock.songTimeAt(4000), 0);
});

test("song clock: a missing duration skips the upper clamp", () => {
  const h = songClockAt();
  h.setAnchor(playing(900, 5000, { durationMs: 0 }), 5000);
  assert.equal(h.clock.songTimeAt(5500), 1400);
  h.setAnchor({ audioKey: "b", positionMs: 900, at: 5000, paused: false }, 5000);
  assert.equal(h.clock.songTimeAt(9000), 4900);
  assert.equal(h.clock.songTimeAt(1000), 0);
});
