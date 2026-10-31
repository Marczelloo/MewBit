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
  assert.deepEqual(run.press(0, 2100), { kind: "hit", lane: 0, judgement: "perfect", errorMs: 0, index: 0 });
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
  assert.deepEqual(misses[1], { kind: "miss", lane: 1, index: 1 });
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
  assert.deepEqual(visible[0], { t: 3000, lane: 0, outcome: "perfect" });
  assert.equal(visible[1].outcome, "pending");
  assert.deepEqual(run.visibleNotes(100, 1500), []);
});

test("setOffset mid-run moves later presses' errorMs by the offset", () => {
  const run = createRun({ chart: chart(), startSongMs: 0 });
  tickAll(run, 0, 4992);
  run.setOffset(100);
  assert.equal(run.heardTime(5250), 5150);
  // note 13 sits at 5250 in lane 1: heard 5150 is 100 ms early
  assert.deepEqual(run.press(1, 5250), { kind: "hit", lane: 1, judgement: "good", errorMs: -100, index: 13 });
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
  const early = tickAll(run, started + 16, started + 7999, 16);
  assert.equal(early.some((e) => e.kind === "feverEnd"), false);
  const late = tickAll(run, started + 8000, started + 8500, 16);
  assert.equal(late.filter((e) => e.kind === "feverEnd").length, 1);
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
