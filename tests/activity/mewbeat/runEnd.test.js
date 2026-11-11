const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const src = (file) => pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat", file)).href;

let createRun;
let createSoloClock;
let createSoloLink;
let createSongClock;
let createEndWatch;
let END_GRACE_MS;

test.before(async () => {
  ({ createRun } = await import(src("run.js")));
  ({ createSoloClock, createSoloLink } = await import(src("soloLink.js")));
  ({ createSongClock } = await import(src("clock.js")));
  ({ createEndWatch, END_GRACE_MS } = await import(src("endWatch.js")));
});

const FRAME_MS = 16;
const DURATION = 60_000;

// The game's frame loop around a run, as useMewbeatGame runs it: the song time comes from the clock (which holds at
// the track's end), the end watch says when the song is over, the run is ticked with it. Returns the run's events
// and the frame the "end" event came on (null: the run never ended).
function playOut({ clock, run, from = -2000, until = DURATION + 10_000, withWatch = true, onFrame = null }) {
  const watch = createEndWatch();
  const events = [];
  let endedAt = null;
  for (let perf = from; perf <= until && endedAt === null; perf += FRAME_MS) {
    const songMs = clock.songTimeAt(perf);
    onFrame?.(perf, songMs, run);
    const over = withWatch ? watch.update(clock.atEnd(perf) === true, perf) : false;
    const tickEvents = run.tick(songMs, { over });
    events.push(...tickEvents);
    if (tickEvents.some((event) => event.kind === "end")) endedAt = perf;
  }
  return { events, endedAt };
}

// A solo clock on a fake audio that plays from perf 0 = song time 0 and stops at the track's end, like soloAudio.
function playingClock(durationMs = DURATION) {
  const audio = { songTimeAt: (perf) => Math.min(perf, durationMs) };
  const clock = createSoloClock(audio);
  clock.set({ key: "song", paused: false, positionMs: 0, durationMs });
  return clock;
}

// Notes every 500 ms before `lastT` on cycling lanes, a last note at `lastT`, plus anything extra.
function chartTo(lastT, extra = []) {
  const notes = [{ t: lastT, lane: 3 }];
  for (let t = 1000; t < lastT - 200; t += 500) notes.push({ t, lane: (t / 500) % 4 });
  return { notes: [...notes, ...extra].sort((a, b) => a.t - b.t) };
}

// The runs below autoplay (a player who hits everything) unless said otherwise: a run whose notes all go unpressed
// is failed long before the end, and a failed run ends through its own event, not through this path.
test("root cause: a last note inside the good window of the track's end never ends a run on the clamped clock", () => {
  // The clock stops at the track's end (60 000), so heard time stops there too; the last note's window closes at
  // 59 960 + 125, past it, so the end condition (heard time past every window) is never true.
  const clock = playingClock();
  const run = createRun({ chart: chartTo(DURATION - 40), startSongMs: -2000, autoplay: true });
  const { endedAt } = playOut({ clock, run, withWatch: false });
  assert.equal(endedAt, null);
  const snap = run.snapshot(DURATION);
  assert.equal(snap.judged, snap.total, "every note was judged, the run is just never over");
});

test("a last note inside the good window of the track's end: the run ends once the clock has stayed at the end", () => {
  const clock = playingClock();
  const run = createRun({ chart: chartTo(DURATION - 40), startSongMs: -2000, autoplay: true });
  const { endedAt } = playOut({ clock, run });
  assert.notEqual(endedAt, null);
  assert.ok(endedAt >= DURATION + END_GRACE_MS, "not before the grace is over");
  assert.ok(endedAt <= DURATION + END_GRACE_MS + 2 * FRAME_MS, "and right after it");
  const snap = run.snapshot(DURATION);
  assert.equal(snap.judged, snap.total);
});

test("a positive audio offset pushes heard time short of the last note: the run still ends", () => {
  // Heard time stops at 60 000 - 80; the last note (59 850) closes its window at 59 975.
  const chart = chartTo(DURATION - 150);
  const stuck = createRun({ chart, startSongMs: -2000, offsetMs: 80, autoplay: true });
  assert.equal(playOut({ clock: playingClock(), run: stuck, withWatch: false }).endedAt, null);
  const fresh = createRun({ chart, startSongMs: -2000, offsetMs: 80, autoplay: true });
  assert.notEqual(playOut({ clock: playingClock(), run: fresh }).endedAt, null);
});

test("a hold that reaches the track's end ends the run with its tail settled clean", () => {
  // With the offset the clock stops before the hold's end, so the tail is still being held when the song is over.
  const hold = { t: DURATION - 800, lane: 2, len: 800 };
  const chart = chartTo(DURATION - 1500, [hold]);
  const stuck = createRun({ chart, startSongMs: -2000, offsetMs: 80, autoplay: true });
  assert.equal(playOut({ clock: playingClock(), run: stuck, withWatch: false }).endedAt, null);
  const run = createRun({ chart, startSongMs: -2000, offsetMs: 80, autoplay: true });
  const { endedAt } = playOut({ clock: playingClock(), run });
  assert.notEqual(endedAt, null);
  const tail = run.log().events.find((event) => event.part === "tail");
  assert.equal(tail.j, "perfect");
  const snap = run.snapshot(DURATION);
  assert.equal(snap.judged, snap.total);
});

test("a press during the grace still counts for a note at the very end", () => {
  const last = { t: DURATION - 30, lane: 1 };
  const chart = chartTo(DURATION - 1000, [last]);
  const clock = playingClock();
  const run = createRun({ chart, startSongMs: -2000, noFail: true });
  let hit = null;
  const { endedAt } = playOut({
    clock,
    run,
    onFrame(perf) {
      // Nothing was pressed all song; the player taps the last note a moment after the audio stopped.
      if (!hit && perf >= DURATION + 100) hit = run.press(last.lane, clock.songTimeAt(perf));
    },
  });
  assert.equal(hit?.kind, "hit");
  assert.notEqual(endedAt, null);
  const lastEntry = run.log().events.find((event) => event.n === run.noteList().indexOf(last));
  assert.notEqual(lastEntry.j, "miss");
});

test("notes the player never pressed settle as misses when the song is over", () => {
  const clock = playingClock();
  const run = createRun({ chart: chartTo(DURATION - 40), startSongMs: -2000, noFail: true });
  const { events, endedAt } = playOut({ clock, run });
  assert.notEqual(endedAt, null);
  const snap = run.snapshot(DURATION);
  assert.equal(snap.counts.miss, snap.total);
  assert.equal(events.at(-1).kind, "end");
});

test("a run that finishes by itself is judged exactly as before: the end watch changes nothing for it", () => {
  const chart = chartTo(DURATION - 5000);
  const log = (withWatch) => {
    const run = createRun({ chart, startSongMs: -2000, autoplay: true });
    const { endedAt } = playOut({ clock: playingClock(), run, withWatch });
    assert.notEqual(endedAt, null);
    return { log: run.log().events, endedAt, snap: run.snapshot(DURATION) };
  };
  assert.deepEqual(log(true), log(false));
});

test("tick with over leaves a run that has pending notes alone when the song is not over", () => {
  const run = createRun({ chart: chartTo(DURATION - 40), startSongMs: -2000, autoplay: true });
  assert.deepEqual(run.tick(10_000, { over: false }).filter((event) => event.kind === "end"), []);
  assert.equal(run.snapshot(10_000).judged < run.snapshot(10_000).total, true);
});

test("end watch: says over only after the clock has stayed at the end for the grace, and forgets a clock that moved on", () => {
  const watch = createEndWatch({ graceMs: 100 });
  assert.equal(watch.update(false, 0), false);
  assert.equal(watch.update(true, 1000), false);
  assert.equal(watch.update(true, 1099), false);
  assert.equal(watch.update(true, 1100), true);
  assert.equal(watch.update(false, 1200), false);
  assert.equal(watch.update(true, 1300), false); // a new stretch at the end starts its grace again
  watch.update(true, 1300);
  watch.reset();
  assert.equal(watch.update(true, 1500), false);
});

test("solo clock: atEnd is false before the end and while paused, true at the end and once the audio said it ended", () => {
  const audio = { songTimeAt: (perf) => perf };
  const clock = createSoloClock(audio);
  assert.equal(clock.atEnd(100), false); // no song
  clock.set({ key: "k", paused: true, positionMs: DURATION, durationMs: DURATION });
  assert.equal(clock.atEnd(DURATION + 100), false, "a paused clock at the end is a pause, not an end");
  clock.set({ paused: false, positionMs: 0 });
  assert.equal(clock.atEnd(DURATION - 1), false);
  assert.equal(clock.atEnd(DURATION), true);
  assert.equal(clock.atEnd(DURATION + 5000), true);
  clock.set({ positionMs: 0 });
  const short = createSoloClock({ songTimeAt: () => 100 });
  short.set({ key: "k", paused: false, positionMs: 0, durationMs: DURATION });
  assert.equal(short.atEnd(0), false);
  short.set({ ended: true });
  assert.equal(short.atEnd(0), true, "the audio's own report counts even where the clock reads earlier");
  short.set({ paused: true, positionMs: 100 });
  assert.equal(short.atEnd(0), false, "the flag belongs to one stretch of song");
});

test("song clock (the bot's anchors): atEnd once the line reaches the anchor's duration, never while paused", () => {
  let now = 1000;
  const clock = createSongClock({ serverTimeAt: (perf) => perf, ready: () => true }, { now: () => now });
  assert.equal(clock.atEnd(now), false);
  clock.setAnchor({ audioKey: "k", positionMs: 0, at: 1000, paused: false, durationMs: 5000 });
  assert.equal(clock.atEnd(5999), false);
  assert.equal(clock.atEnd(6000), true);
  assert.equal(clock.songTimeAt(9000), 5000);
  now = 7000;
  clock.setAnchor({ audioKey: "k", positionMs: 5000, at: 7000, paused: true, durationMs: 5000 });
  assert.equal(clock.atEnd(9000), false);
});

// ---- the whole path on a solo link: audio ends, the run follows ----

function scheduler() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
        if (!next) break;
        timers.delete(next.id);
        time = next.timer.at;
        next.timer.fn();
      }
      time = end;
    },
    now: () => time,
  };
}

test("solo link: the audio ending puts the clock at the end, and a run on it finishes", async () => {
  const sched = scheduler();
  let ended = () => {};
  let playedFrom = null;
  let position = 0;
  const audio = {
    unlock: () => Promise.resolve(),
    stop() {},
    pause: () => position,
    load: async () => ({ durationMs: DURATION }),
    align() {},
    play: async (fromMs) => {
      playedFrom = fromMs;
    },
    durationMs: () => DURATION,
    songTimeAt: () => position,
    onEnded: (fn) => {
      ended = fn;
      return () => {};
    },
  };
  const link = createSoloLink({ send: () => true, audio, now: sched.now, setTimer: sched.setTimer, clearTimer: sched.clearTimer });
  link.start();
  await link.begin("k", { title: "T", durationMs: DURATION });
  link.chartAccepted();
  sched.advance(1500);
  await Promise.resolve();
  assert.equal(link.state().stage, "playing");
  assert.equal(playedFrom, -2000);
  // The audio runs on to 59 000, the chart's last note is 59 000 + 970 (the track is analysed a little longer than
  // the file that was stored), then the source ends and the audio parks the clock at the file's end.
  position = 59_000;
  assert.equal(link.songClock.atEnd(0), false);
  position = DURATION;
  ended();
  assert.equal(link.state().stage, "ended");
  assert.equal(link.songClock.atEnd(0), true);
  const run = createRun({ chart: chartTo(DURATION - 40), startSongMs: -2000, autoplay: true });
  const { endedAt } = playOut({ clock: link.songClock, run, from: DURATION - 1000, until: DURATION + 5000, withWatch: true });
  assert.notEqual(endedAt, null);
});
