const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createMewbeatLink;
let createMockLink;
let buildMockChart;
let MOCK_AUDIO_KEY;

test.before(async () => {
  const dir = path.resolve(__dirname, "../../../activity/src/mewbeat");
  ({ createMewbeatLink } = await import(pathToFileURL(path.join(dir, "link.js")).href));
  ({ createMockLink, buildMockChart, MOCK_AUDIO_KEY } = await import(pathToFileURL(path.join(dir, "mockLink.js")).href));
});

// Manual scheduler: timers fire only when the test advances time.
function createScheduler() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
        }
        if (!next) break;
        timers.delete(next.id);
        time = next.timer.at;
        next.timer.fn();
      }
      time = end;
    },
    now: () => time,
    pending: () => timers.size,
  };
}

function setup({ ready = true, audioKey = "k" } = {}) {
  const scheduler = createScheduler();
  const sent = [];
  const calls = [];
  const state = { ready, audioKey, socketReady: true };
  const serverClock = {
    addSample: (sample) => calls.push(["addSample", sample]),
    ready: () => state.ready,
  };
  const songClock = {
    setAnchor: (anchor) => {
      calls.push(["setAnchor", anchor]);
      return "init";
    },
    audioKey: () => state.audioKey,
  };
  const link = createMewbeatLink({
    send: (payload) => {
      if (!state.socketReady) return false;
      sent.push({ at: scheduler.now(), payload });
      return true;
    },
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    serverClock,
    songClock,
  });
  return { link, scheduler, sent, calls, state };
}

const syncs = (sent) => sent.filter((m) => m.payload.type === "mewbeat_sync");
const charts = (sent) => sent.filter((m) => m.payload.type === "mewbeat_chart");

test("start sends a burst of 6 syncs 120 ms apart, then one per second", () => {
  const { link, scheduler, sent } = setup();
  link.start();
  scheduler.advance(2700);
  assert.deepEqual(syncs(sent).map((m) => m.at), [0, 120, 240, 360, 480, 600, 1600, 2600]);
  assert.deepEqual(syncs(sent).map((m) => m.payload.id), ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  assert.deepEqual(sent[1].payload, { type: "mewbeat_sync", id: "s2", clientSentAt: 120 });
});

test("a reply with an unknown id is ignored", () => {
  const { link, calls } = setup();
  link.start();
  link.handle({ type: "mewbeat_sync", id: "nope", clientSentAt: 0, serverNow: 5, anchor: null });
  assert.deepEqual(calls, []);
});

test("a valid reply feeds addSample with the sent clientSentAt, then setAnchor, then anchor listeners", () => {
  const { link, scheduler, calls } = setup();
  const heard = [];
  link.onAnchor((kind) => heard.push(kind));
  link.start();
  scheduler.advance(130);
  const anchor = { audioKey: "k", positionMs: 1, at: 2, paused: false, durationMs: 3 };
  link.handle({ type: "mewbeat_sync", id: "s2", clientSentAt: 999, serverNow: 777, anchor });
  assert.deepEqual(calls, [
    ["addSample", { clientSentAt: 120, serverNow: 777, clientReceivedAt: 130 }],
    ["setAnchor", anchor],
  ]);
  assert.deepEqual(heard, ["init"]);
  // The same reply twice is only counted once.
  link.handle({ type: "mewbeat_sync", id: "s2", clientSentAt: 120, serverNow: 777, anchor });
  assert.equal(calls.length, 2);
});

test("a reply before the server clock is ready skips setAnchor", () => {
  const { link, calls, state } = setup({ ready: false });
  const heard = [];
  link.onAnchor((kind) => heard.push(kind));
  link.start();
  link.handle({ type: "mewbeat_sync", id: "s1", serverNow: 5, anchor: { audioKey: "k" } });
  assert.deepEqual(calls.map((c) => c[0]), ["addSample"]);
  assert.deepEqual(heard, []);
  assert.equal(link.status(), "live");
  state.ready = true;
  link.syncNow();
  link.handle({ type: "mewbeat_sync", id: "s2", serverNow: 5, anchor: null });
  assert.deepEqual(calls.map((c) => c[0]), ["addSample", "addSample", "setAnchor"]);
});

test("syncNow sends one extra sync immediately", () => {
  const { link, scheduler, sent } = setup();
  link.start();
  scheduler.advance(50);
  link.syncNow();
  assert.deepEqual(syncs(sent).map((m) => m.at), [0, 50]);
});

test("requestChart dedupes while in flight", () => {
  const { link, sent } = setup();
  link.start();
  link.requestChart("k", "normal");
  link.requestChart("k", "normal");
  assert.equal(charts(sent).length, 1);
  assert.deepEqual(charts(sent)[0].payload, { type: "mewbeat_chart", audioKey: "k", difficulty: "normal" });
  link.requestChart("k", "hard");
  assert.equal(charts(sent).length, 2);
});

test("a chart request the socket refuses is not deduped against", () => {
  const { link, sent, state } = setup();
  link.start();
  state.socketReady = false;
  assert.equal(link.requestChart("k", "normal"), false);
  state.socketReady = true;
  assert.equal(link.requestChart("k", "normal"), true);
  assert.equal(charts(sent).length, 1);
});

test("a ready reply notifies listeners and releases the dedupe key", () => {
  const { link, sent } = setup();
  const heard = [];
  link.onChart((r) => heard.push(r));
  link.start();
  link.requestChart("k", "normal");
  const chart = { notes: [] };
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "ready", chart });
  assert.deepEqual(heard, [{ audioKey: "k", difficulty: "normal", status: "ready", reason: undefined, chart }]);
  link.requestChart("k", "normal");
  assert.equal(charts(sent).length, 2);
  // A reply for a request not in flight is ignored.
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "easy", status: "ready", chart });
  assert.equal(heard.length, 1);
});

test("a pending reply resends the same request after 3000 ms and stays deduped", () => {
  const { link, scheduler, sent } = setup();
  const heard = [];
  link.onChart((r) => heard.push(r.status));
  link.start();
  link.requestChart("k", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "pending", reason: "queued" });
  scheduler.advance(2999);
  assert.equal(charts(sent).length, 1);
  scheduler.advance(1);
  assert.equal(charts(sent).length, 2);
  assert.deepEqual(charts(sent)[1].payload, charts(sent)[0].payload);
  link.requestChart("k", "normal");
  assert.equal(charts(sent).length, 2);
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "ready", chart: {} });
  assert.deepEqual(heard, ["pending", "ready"]);
  scheduler.advance(10_000);
  assert.equal(charts(sent).length, 2);
});

test("a pending retry the socket refuses waits another round", () => {
  const { link, scheduler, sent, state } = setup();
  link.start();
  link.requestChart("k", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "pending" });
  state.socketReady = false;
  scheduler.advance(3000);
  state.socketReady = true;
  assert.equal(charts(sent).length, 1);
  scheduler.advance(3000);
  assert.equal(charts(sent).length, 2);
});

test("a pending retry after a track change is dropped and frees the key", () => {
  const { link, scheduler, sent, state } = setup();
  link.start();
  link.requestChart("k", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "pending" });
  state.audioKey = "other";
  scheduler.advance(3000);
  assert.equal(charts(sent).length, 1);
  assert.equal(link.requestChart("k", "normal"), true);
});

test("requestChart before start sends nothing", () => {
  const { link, sent } = setup();
  assert.equal(link.requestChart("k", "normal"), false);
  assert.equal(charts(sent).length, 0);
});

test("a chart reply for another track is dropped and frees the key", () => {
  const { link, sent } = setup({ audioKey: "new" });
  const heard = [];
  link.onChart((r) => heard.push(r));
  link.start();
  link.requestChart("old", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "old", difficulty: "normal", status: "ready", chart: {} });
  assert.deepEqual(heard, []);
  link.requestChart("old", "normal");
  assert.equal(charts(sent).length, 2);
});

test("stale status is passed on like any other", () => {
  const { link } = setup();
  const heard = [];
  link.onChart((r) => heard.push(r.status));
  link.start();
  link.requestChart("k", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "stale" });
  assert.deepEqual(heard, ["stale"]);
});

test("status goes offline after 3000 ms without a reply and live on the next one", () => {
  const { link, scheduler } = setup();
  const heard = [];
  link.onStatus((s) => heard.push(s));
  assert.equal(link.status(), "connecting");
  link.start();
  scheduler.advance(2999);
  assert.equal(link.status(), "connecting");
  scheduler.advance(1);
  assert.equal(link.status(), "offline");
  link.handle({ type: "mewbeat_sync", id: "s9", serverNow: 1, anchor: null });
  assert.equal(link.status(), "offline"); // unknown id, not accepted
  link.handle({ type: "mewbeat_sync", id: "s6", serverNow: 1, anchor: null });
  assert.equal(link.status(), "live");
  scheduler.advance(2999);
  assert.equal(link.status(), "live");
  scheduler.advance(1);
  assert.deepEqual(heard, ["offline", "live", "offline"]);
});

test("a late reply re-arms the offline timer", () => {
  const { link, scheduler } = setup();
  link.start();
  scheduler.advance(2000);
  link.handle({ type: "mewbeat_sync", id: "s1", serverNow: 1, anchor: null });
  scheduler.advance(2999);
  assert.equal(link.status(), "live");
  scheduler.advance(1);
  assert.equal(link.status(), "offline");
});

test("unsubscribing stops a listener", () => {
  const { link } = setup();
  const heard = [];
  const off = link.onStatus((s) => heard.push(s));
  off();
  link.start();
  link.handle({ type: "mewbeat_sync", id: "s1", serverNow: 1, anchor: null });
  assert.deepEqual(heard, []);
});

test("after stop no timer fires a send, retries included", () => {
  const { link, scheduler, sent } = setup();
  link.start();
  link.requestChart("k", "normal");
  link.handle({ type: "mewbeat_chart", audioKey: "k", difficulty: "normal", status: "pending" });
  const before = sent.length;
  link.stop();
  assert.equal(scheduler.pending(), 0);
  scheduler.advance(10_000);
  assert.equal(sent.length, before);
  assert.equal(link.status(), "connecting");
});

test("setTrackInfo is stored and exposed through track()", () => {
  const { link } = setup();
  assert.equal(link.track(), null);
  link.setTrackInfo({ title: "T", artist: "A", queued: true });
  assert.deepEqual(link.track(), { title: "T", artist: "A", queued: true });
});

test("mock chart is deterministic, sorted, with a 2-note chord on every 8th beat", () => {
  const chart = buildMockChart("mock:demo:150000", "easy");
  assert.deepEqual(chart, buildMockChart("mock:demo:150000", "easy"));
  assert.equal(chart.audioKey, "mock:demo:150000");
  assert.equal(chart.difficulty, "easy");
  assert.deepEqual(chart.notes.slice(0, 3), [{ t: 2000, lane: 0 }, { t: 2500, lane: 1 }, { t: 3000, lane: 2 }]);
  for (let i = 1; i < chart.notes.length; i += 1) {
    const [a, b] = [chart.notes[i - 1], chart.notes[i]];
    assert.ok(a.t < b.t || (a.t === b.t && a.lane < b.lane));
  }
  const perT = new Map();
  for (const n of chart.notes) perT.set(n.t, (perT.get(n.t) ?? 0) + 1);
  const times = [...perT.keys()];
  assert.equal(times[0], 2000);
  assert.equal(times.at(-1), 148000);
  times.forEach((t, beat) => assert.equal(perT.get(t), (beat + 1) % 8 === 0 ? 2 : 1));
  const chord = chart.notes.filter((n) => n.t === 5500);
  assert.deepEqual(chord, [{ t: 5500, lane: 1 }, { t: 5500, lane: 2 }]);
});

test("mock chart has 4 holds, and no note starts inside a hold in that hold's hand", () => {
  const { notes } = buildMockChart("mock:demo:150000", "easy");
  const holds = notes.filter((n) => n.len > 0);
  assert.ok(holds.length >= 4);
  assert.ok(holds.every((h) => h.len >= 300 && h.len <= 1000));
  assert.ok(new Set(holds.map((h) => h.lane)).size >= 3, "holds spread over the lanes");
  assert.ok(holds.some((h) => h.lane <= 1) && holds.some((h) => h.lane >= 2), "both hands hold");
  const hand = (lane) => (lane <= 1 ? 0 : 1);
  for (const h of holds) {
    const inside = notes.filter((n) => n !== h && hand(n.lane) === hand(h.lane) && n.t >= h.t && n.t <= h.t + h.len);
    assert.deepEqual(inside, [], `a note starts inside the hold at ${h.t}`);
  }
});

test("mock link starts live on a 150 s track, serves its chart, and clears at the end", async () => {
  const scheduler = createScheduler();
  const link = createMockLink({ now: scheduler.now, setTimer: scheduler.setTimer, clearTimer: scheduler.clearTimer });
  const anchors = [];
  const charts = [];
  link.onAnchor((kind) => anchors.push(kind));
  link.onChart((r) => charts.push(r));
  assert.equal(link.track(), null);
  link.start();
  assert.equal(link.status(), "live");
  assert.deepEqual(anchors, ["init"]);
  assert.equal(link.songClock.audioKey(), MOCK_AUDIO_KEY);
  assert.deepEqual(link.track(), { title: "Demo track", artist: "mewbeat", queued: false });
  assert.equal(link.songClock.songTimeAt(1500), 1500);

  assert.equal(link.requestChart(MOCK_AUDIO_KEY, "hard"), true);
  link.requestChart("other", "hard");
  scheduler.advance(0);
  assert.deepEqual(charts.map((r) => [r.audioKey, r.status]), [[MOCK_AUDIO_KEY, "ready"], ["other", "stale"]]);
  assert.equal(charts[0].chart.notes.length, buildMockChart(MOCK_AUDIO_KEY, "hard").notes.length);

  scheduler.advance(150_000);
  assert.deepEqual(anchors, ["init", "clear"]);
  assert.equal(link.songClock.audioKey(), null);
  assert.equal(link.track(), null);
});
