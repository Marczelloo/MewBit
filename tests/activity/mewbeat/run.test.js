const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createRun;

test.before(async () => {
  ({ createRun } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/run.js")).href));
});

// 40 notes, 250 ms apart from t:2000, lanes cycling 0-3 (last note at 11750).
const chart = () => ({
  notes: Array.from({ length: 40 }, (_, i) => ({ t: 2000 + i * 250, lane: i % 4 })),
});

function tickAll(run, fromMs, toMs, step = 16) {
  const events = [];
  for (let ms = fromMs; ms <= toMs; ms += step) events.push(...run.tick(ms));
  return events;
}

test("startSongMs skips every note before the lead-in", () => {
  const run = createRun({ chart: chart(), startSongMs: 4500 });
  const snap = run.snapshot(4500);
  assert.equal(snap.total, 26);
  assert.equal(snap.judged, 0);
  assert.equal(snap.ranked, false);
  assert.equal(snap.accuracy, null);
  assert.equal(snap.grade, null);
});

test("a positive offset shifts the press into heard time", () => {
  const run = createRun({ chart: chart(), startSongMs: 0, offsetMs: 100 });
  assert.equal(run.heardTime(2100), 2000);
  assert.deepEqual(run.press(0, 2100), { kind: "hit", lane: 0, judgement: "perfect", errorMs: 0, index: 0, part: "head" });
});

test("a ghost tap returns null and changes nothing", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  assert.equal(run.press(2, 2000), null);
  const snap = run.snapshot(2000);
  assert.equal(snap.judged, 0);
  assert.equal(snap.score, 0);
});

test("manual hits score and appear in the snapshot", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  run.press(0, 2000);
  run.press(1, 2280);
  const snap = run.snapshot(2300);
  assert.equal(snap.score, 300 + 300);
  assert.equal(snap.combo, 2);
  assert.equal(snap.multiplier, 1);
  assert.equal(snap.judged, 2);
  assert.equal(snap.counts.perfect, 2);
  assert.deepEqual(snap.hits, [
    { index: 0, errorMs: 0 },
    { index: 1, errorMs: 30 },
  ]);
});

test("autoplay judges every note perfect and ends exactly once", () => {
  const run = createRun({ chart: chart(), startSongMs: 0, autoplay: true });
  const events = tickAll(run, 0, 15000);
  const snap = run.snapshot(15000);
  assert.equal(events.filter((e) => e.kind === "hit").length, 40);
  assert.ok(events.filter((e) => e.kind === "hit").every((e) => e.judgement === "perfect" && e.errorMs === 0));
  assert.equal(events.filter((e) => e.kind === "end").length, 1);
  assert.equal(snap.judged, 40);
  assert.equal(snap.counts.perfect, 40);
  assert.equal(snap.accuracy, 100);
  assert.equal(snap.grade, "S");
});

test("no presses gives every note a miss", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  const events = tickAll(run, 0, 15000);
  const misses = events.filter((e) => e.kind === "miss");
  assert.equal(misses.length, 40);
  assert.deepEqual(misses[1], { kind: "miss", lane: 1, index: 1, part: "head" });
  assert.equal(events.filter((e) => e.kind === "end").length, 1);
  const snap = run.snapshot(15000);
  assert.equal(snap.accuracy, 0);
  assert.equal(snap.grade, "D");
  assert.equal(snap.combo, 0);
});

test("pressing after end returns null", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  tickAll(run, 0, 15000);
  assert.equal(run.press(0, 15000), null);
  assert.equal(run.fever(15000), null);
  assert.deepEqual(run.tick(16000), []);
});

test("jump skips the next 300 ms of notes and they never show as misses", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  tickAll(run, 0, 8800);
  const before = run.snapshot(8800);
  run.jump(9000);
  const after = run.snapshot(8800);
  // 8750 is still pending (its GOOD window runs to 8885), then 9000 and 9250: all < 9300
  assert.equal(before.total - after.total, 3);
  const misses = tickAll(run, 8816, 15000).filter((e) => e.kind === "miss");
  assert.equal(misses.some((e) => notesAt(e.index) >= 8750 && notesAt(e.index) < 9300), false);
  assert.equal(misses.length, 40 - before.judged - 3);
});

function notesAt(index) {
  return 2000 + index * 250;
}

test("FEVER starts at full vibe, doubles points and ends once", () => {
  const run = createRun({ chart: chart(), startSongMs: 0, autoplay: true });
  assert.equal(run.fever(2000), null);
  let events = [];
  let started = null;
  for (let ms = 0; ms <= 15000 && !started; ms += 16) {
    events.push(...run.tick(ms));
    if (run.snapshot(ms).vibe >= 1) started = run.fever(ms) && ms;
  }
  assert.notEqual(started, null);
  const snap = run.snapshot(started);
  assert.equal(snap.feverActive, true);
  assert.equal(snap.feverLeftMs, 8000);
  assert.equal(snap.fevers, 1);
  assert.equal(run.fever(started), null);

  events = tickAll(run, started + 16, started + 8000 - 1, 16);
  assert.equal(events.some((e) => e.kind === "feverEnd"), false);
  events.push(...tickAll(run, started + 8000, started + 9000, 16));
  assert.equal(events.filter((e) => e.kind === "feverEnd").length, 1);
  const after = run.snapshot(started + 9000);
  assert.equal(after.feverActive, false);
  assert.equal(after.feverLeftMs, 0);
  assert.equal(after.vibe, 0);
});

test("visibleNotes returns the inclusive window with outcomes", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  run.press(0, 3000);
  const visible = run.visibleNotes(3000, 4000);
  assert.deepEqual(
    visible.map((n) => n.t),
    [3000, 3250, 3500, 3750, 4000],
  );
  assert.deepEqual(visible[0], { t: 3000, lane: 0, outcome: "perfect", len: 0, hold: "pending" });
  assert.equal(visible[1].outcome, "pending");
  assert.deepEqual(run.visibleNotes(100, 1500), []);
});

test("setOffset mid-run moves later presses' errorMs by the offset", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  tickAll(run, 0, 4992);
  run.setOffset(100);
  assert.equal(run.heardTime(5250), 5150);
  // note 13 sits at 5250 in lane 1: heard 5150 is 100 ms early
  assert.deepEqual(run.press(1, 5250), { kind: "hit", lane: 1, judgement: "good", errorMs: -100, index: 13, part: "head" });
});

test("setOffset keeps the score and the judged notes", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  run.press(0, 2000);
  run.press(1, 2250);
  tickAll(run, 0, 2300);
  const before = run.snapshot(2300);
  run.setOffset(50);
  const after = run.snapshot(2300);
  assert.equal(after.score, before.score);
  assert.equal(after.combo, before.combo);
  assert.equal(after.judged, before.judged);
  assert.equal(after.total, before.total);
});

test("setOffset shifts the FEVER end so it ends at the same song moment", () => {
  const run = createRun({ chart: chart(), startSongMs: 0, autoplay: true });
  let started = null;
  for (let ms = 0; ms <= 15000 && started === null; ms += 16) {
    run.tick(ms);
    if (run.snapshot(ms).vibe >= 1 && run.fever(ms)) started = ms;
  }
  assert.notEqual(started, null);
  run.setOffset(100);
  assert.equal(run.snapshot(started).feverLeftMs, 8000);
  // heard time is 100 ms behind song time now, yet FEVER still ends at song started + 8000
  const early = tickAll(run, started + 16, started + 7984, 16);
  assert.equal(early.some((e) => e.kind === "feverEnd"), false);
  assert.equal(run.tick(started + 7999).some((e) => e.kind === "feverEnd"), false);
  assert.equal(run.tick(started + 8000).filter((e) => e.kind === "feverEnd").length, 1);
  assert.equal(tickAll(run, started + 8016, started + 8500, 16).some((e) => e.kind === "feverEnd"), false);
});

test("a -200 ms shift skips the notes it jumped over instead of missing them", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  tickAll(run, 0, 4992);
  const before = run.snapshot(4992);
  run.setOffset(-200);
  // heard time jumps from 4992 to 5192: the note at 5000 would be past its GOOD window (5135)
  const events = run.tick(4992);
  assert.equal(events.filter((e) => e.kind === "miss").length, 0);
  assert.equal(run.snapshot(4992).total, before.total - 1);
  assert.equal(run.visibleNotes(5000, 5000)[0].outcome, "skipped");
});

test("setOffset skips relative to the song time it is given", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  run.setOffset(-500, 3000);
  // heard 3500: notes before 3500 - 135 = 3365 are gone (2000..3250 skipped), 3500 stays pending
  const events = run.tick(3000);
  assert.equal(events.filter((e) => e.kind === "miss").length, 0);
  assert.equal(run.visibleNotes(3500, 3500)[0].outcome, "pending");
  assert.equal(run.visibleNotes(3250, 3250)[0].outcome, "skipped");
});

// Holds: one hold in lane 0 (head 2000, end 3000), taps around it.
const holdChart = () => ({
  notes: [
    { t: 2000, lane: 0, len: 1000 },
    { t: 2500, lane: 1 },
    { t: 4000, lane: 2 },
  ],
});

test("hold: head PERFECT then release at the end is a PERFECT tail", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  const head = run.press(0, 2000);
  assert.equal(head.part, "head");
  assert.equal(head.judgement, "perfect");
  const events = run.release(0, 3000);
  assert.deepEqual(events, [{ kind: "hit", lane: 0, index: 0, part: "tail", judgement: "perfect", errorMs: 0 }]);
  const snap = run.snapshot(3000);
  assert.equal(snap.counts.perfect, 2);
  assert.equal(snap.judged, 2);
  assert.equal(snap.combo, 2);
  assert.equal(snap.accuracy, 100);
});

test("hold: an early release drops it - tail miss, combo 0, vibe -0.06", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  run.press(0, 2000);
  run.press(1, 2500);
  const before = run.snapshot(2700);
  assert.equal(before.combo, 2);
  const events = run.release(0, 2700);
  assert.deepEqual(events, [{ kind: "miss", lane: 0, index: 0, part: "tail" }]);
  const snap = run.snapshot(2700);
  assert.equal(snap.combo, 0);
  assert.equal(Math.round((before.vibe - snap.vibe) * 1e6) / 1e6, 0.06);
  assert.equal(snap.counts.miss, 1);
});

test("hold: a release inside the tail window still counts", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  run.press(0, 2000);
  // 100 ms early: GREAT with windows x1.5 (68 .. 135); on a tap it would only be GOOD
  const [event] = run.release(0, 2900);
  assert.equal(event.kind, "hit");
  assert.equal(event.judgement, "great");
  assert.equal(event.errorMs, -100);
});

test("hold: holding past the end auto-completes on tick", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  run.press(0, 2000);
  const events = run.tick(3001);
  const tail = events.find((e) => e.part === "tail");
  assert.deepEqual(tail, { kind: "hit", lane: 0, index: 0, part: "tail", judgement: "perfect", errorMs: 0 });
  assert.deepEqual(run.release(0, 3100), []);
});

test("hold: a missed head also misses the tail, in the same tick", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  const events = run.tick(2200);
  assert.deepEqual(
    events.filter((e) => e.index === 0),
    [
      { kind: "miss", lane: 0, index: 0, part: "head" },
      { kind: "miss", lane: 0, index: 0, part: "tail" },
    ],
  );
  assert.equal(run.snapshot(2200).counts.miss, 2);
});

test("hold: release with nothing active is a no-op", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  assert.deepEqual(run.release(0, 2500), []);
  assert.deepEqual(run.release(3, 2500), []);
  run.press(0, 2000);
  run.tick(3001);
  assert.deepEqual(run.release(0, 3100), []);
});

test("hold: jumping into the middle of a hold skips it whole and the run still ends", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  assert.equal(run.snapshot(0).total, 4);
  tickAll(run, 0, 1900);
  run.jump(2300); // skips everything before 2600: head, tail and the tap at 2500
  assert.equal(run.snapshot(2300).total, 1);
  assert.equal(run.visibleNotes(2000, 2000)[0].outcome, "skipped");
  const events = tickAll(run, 2316, 6000);
  assert.equal(events.filter((e) => e.kind === "miss" && e.index !== 2).length, 0);
  assert.equal(events.filter((e) => e.kind === "end").length, 1);
});

test("hold: startSongMs inside a hold skips it whole", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 1200 }); // judged from 2200
  assert.equal(run.snapshot(1200).total, 2); // taps at 2500 and 4000
});

test("hold: autoplay presses the head and releases at the end", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0, autoplay: true });
  const events = tickAll(run, 0, 6000);
  const hits = events.filter((e) => e.kind === "hit");
  assert.equal(hits.length, 4);
  assert.ok(hits.every((e) => e.judgement === "perfect"));
  assert.deepEqual(
    hits.filter((e) => e.index === 0).map((e) => e.part),
    ["head", "tail"],
  );
  const snap = run.snapshot(6000);
  assert.equal(snap.counts.perfect, 4);
  assert.equal(snap.accuracy, 100);
  assert.equal(events.filter((e) => e.kind === "end").length, 1);
});

test("tap-only chart: same events and score as before", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  run.press(0, 2000);
  run.press(1, 2280);
  const events = tickAll(run, 0, 15000);
  const snap = run.snapshot(15000);
  assert.equal(events.filter((e) => e.kind === "miss").length, 38);
  assert.equal(events.filter((e) => e.kind === "hit").length, 0);
  assert.ok(events.every((e) => e.part === undefined || e.part === "head"));
  assert.equal(snap.total, 40);
  assert.equal(snap.judged, 40);
  assert.equal(snap.counts.perfect, 2);
  assert.equal(snap.counts.miss, 38);
  assert.equal(snap.score, 600);
});

test("a key held down before the head is a ghost: the head misses", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  assert.equal(run.press(0, 1500), null); // 500 ms early
  assert.deepEqual(run.release(0, 1900), []);
  const events = tickAll(run, 0, 2300);
  assert.deepEqual(
    events.filter((e) => e.index === 0).map((e) => `${e.kind}:${e.part}`),
    ["miss:head", "miss:tail"],
  );
});

test("visibleNotes reports len and hold state, and keeps a hold in view until its end", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  assert.deepEqual(run.visibleNotes(2000, 2000)[0], { t: 2000, lane: 0, outcome: "pending", len: 1000, hold: "pending" });
  run.press(0, 2000);
  const mid = run.visibleNotes(2600, 2700); // after the tap at 2500, before the hold's end
  assert.deepEqual(mid.map((n) => n.t), [2000]);
  assert.equal(mid[0].hold, "held");
  run.release(0, 2500);
  assert.equal(run.visibleNotes(2600, 2700)[0].hold, "dropped");
  assert.deepEqual(run.visibleNotes(3100, 3200), []);

  const other = createRun({ chart: holdChart(), startSongMs: 0 });
  other.press(0, 2000);
  other.release(0, 3000);
  assert.equal(other.visibleNotes(2000, 2000)[0].hold, "done");
});

test("snapshot().skipped counts a skipped tap on a chart with holds (total alone cannot show it)", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  assert.equal(run.snapshot(0).skipped, 0);
  tickAll(run, 0, 3600);
  run.jump(3800); // skips only the tap at 4000
  const snap = run.snapshot(3800);
  assert.equal(snap.skipped, 1);
  // 3 notes + 1 tail - 1 skipped = 3: the old `total < notes.length` check misses this.
  assert.equal(snap.total, holdChart().notes.length);
});

test("snapshot().skipped counts a whole hold skipped by the lead-in as two", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 1200 });
  assert.equal(run.snapshot(1200).skipped, 2);
});

test("two holds in different lanes overlap in a run", () => {
  const overlap = {
    notes: [
      { t: 2000, lane: 0, len: 1000 },
      { t: 2500, lane: 2, len: 1000 },
    ],
  };
  const run = createRun({ chart: overlap, startSongMs: 0 });
  run.press(0, 2000);
  run.press(2, 2500);
  assert.equal(run.visibleNotes(2600, 2600).filter((n) => n.hold === "held").length, 2);
  assert.equal(run.release(0, 3000)[0].part, "tail");
  assert.equal(run.release(2, 3500)[0].part, "tail");
  const snap = run.snapshot(3500);
  assert.equal(snap.counts.perfect, 4);
  assert.equal(snap.combo, 4);
});

test("a tap on the same lane right after a hold's end is judged separately in a run", () => {
  const chartWithTap = {
    notes: [
      { t: 2000, lane: 0, len: 500 },
      { t: 2600, lane: 0 },
    ],
  };
  const run = createRun({ chart: chartWithTap, startSongMs: 0 });
  run.press(0, 2000);
  run.release(0, 2500);
  const tap = run.press(0, 2600);
  assert.equal(tap.part, "head");
  assert.equal(tap.index, 1);
  assert.equal(run.snapshot(2600).counts.perfect, 3);
});

test("autoplay: a stale release from a hold skipped by jump does not drop a newly pressed hold", () => {
  const twoHolds = {
    notes: [
      { t: 2000, lane: 0, len: 1000 },
      { t: 3100, lane: 0, len: 1000 },
    ],
  };
  const run = createRun({ chart: twoHolds, startSongMs: 0, autoplay: true });
  tickAll(run, 0, 2100); // hold A pressed, its release queued for 3000
  run.jump(2800); // skips A's tail (end 3000 < 3100)
  // One tick spans both: it presses B (3100) and finds A's stale release (3000) due.
  const events = [...run.tick(3200), ...tickAll(run, 3216, 5200)];
  assert.equal(events.filter((e) => e.kind === "miss").length, 0);
  assert.deepEqual(
    events.filter((e) => e.index === 1).map((e) => `${e.kind}:${e.part}:${e.judgement}`),
    ["hit:head:perfect", "hit:tail:perfect"],
  );
  assert.equal(events.filter((e) => e.kind === "end").length, 1);
});

test("hold: a hit head with a tail skipped by jump reads as done, not as a fresh pending hold", () => {
  const run = createRun({ chart: holdChart(), startSongMs: 0 });
  run.press(0, 2000); // head hit, tail pending until 3000
  run.jump(2800); // skips the tail (end 3000 < 3100)
  assert.equal(run.snapshot(2800).skipped, 2); // the tail and the tap at 2500
  assert.equal(run.visibleNotes(2900, 2900).find((n) => n.t === 2000).hold, "done");
  // A hold skipped whole (head and tail) is still drawn as the faded pending one.
  const whole = createRun({ chart: holdChart(), startSongMs: 1200 });
  assert.equal(whole.visibleNotes(2000, 2000)[0].hold, "pending");
});

test("mashing every lane non-stop misses most notes instead of clearing the chart", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  for (let ms = 0; ms <= 12_000; ms += 30) {
    for (let lane = 0; lane < 4; lane += 1) run.press(lane, ms);
    run.tick(ms);
  }
  tickAll(run, 12_000, 12_500);
  const { counts } = run.snapshot(12_500);
  assert.ok(counts.miss > 30, `misses ${counts.miss}`);
});

test("an early miss on a hold counts its tail as a miss too", () => {
  const run = createRun({ chart: { notes: [{ t: 2000, lane: 0, len: 800 }] }, startSongMs: 0 });
  assert.deepEqual(run.press(0, 1870), { kind: "miss", lane: 0, index: 0, part: "head" });
  assert.equal(run.snapshot(1870).counts.miss, 2);
});
