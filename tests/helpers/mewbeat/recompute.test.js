const assert = require("node:assert");
const path = require("node:path");
const { describe, it } = require("node:test");
const { pathToFileURL } = require("node:url");

const { judgeablePartsOf, recomputeRun } = require("../../../helpers/mewbeat/recompute");

const CLIENT = path.join(__dirname, "../../../activity/src/mewbeat");
const importClient = (name) => import(pathToFileURL(path.join(CLIENT, name)).href);

// 100 taps 250 ms apart, a few holds among them (indexes in the comments below).
function makeChart() {
  const notes = [];
  for (let i = 0; i < 100; i += 1) notes.push({ t: 1500 + i * 250, lane: i % 4 });
  // Holds replace taps so no lane is double-booked.
  notes[44] = { t: notes[44].t, lane: 0, len: 600 }; // pressed on time, released on time
  notes[48] = { t: notes[48].t, lane: 0, len: 500 }; // pressed too early: head miss, tail follows
  notes[50] = { t: notes[50].t, lane: 2, len: 700 }; // never pressed: head and tail swept as misses
  notes[52] = { t: notes[52].t, lane: 0, len: 500 }; // head hit, released far too early
  notes[56] = { t: notes[56].t, lane: 0, len: 400 }; // head hit, never released: tail swept as perfect
  return { version: 1, audioKey: "k", difficulty: "hard", notes };
}

// What the client has to send, built the way the Activity can build it from run.js: every result that
// press / release / tick return becomes one event with t = run.heardTime(songMs). A press that misses a hold's
// head settles its tail as a second miss that the result does not carry, so it is added here.
async function playScripted(chart) {
  const { createRun } = await importClient("run.js");
  const run = createRun({ chart, startSongMs: 0 });
  const events = [];
  const fevers = [];

  const record = (results, songMs, fromPress) => {
    for (const result of [results].flat()) {
      if (!result || !result.part) continue;
      const t = run.heardTime(songMs);
      events.push({
        n: result.index,
        part: result.part,
        j: result.kind === "miss" ? "miss" : result.judgement,
        t,
        d: result.errorMs ?? null,
      });
      if (fromPress && result.kind === "miss" && result.part === "head" && chart.notes[result.index].len > 0) {
        events.push({ n: result.index, part: "tail", j: "miss", t, d: null });
      }
    }
  };

  const actions = new Map(); // songMs -> [() => void]
  const at = (ms, action) => {
    const key = Math.round(ms / 10) * 10;
    actions.set(key, [...(actions.get(key) ?? []), action]);
  };
  chart.notes.forEach((note, index) => {
    // The first 40 notes are clean enough to fill the vibe meter; the rest has misses, goods and greats.
    const pressOffset = index === 48 ? -120
      : index === 50 ? null
        : index < 40 ? (index % 5 === 4 ? 50 : 0)
          : index % 7 === 3 ? null : index % 5 === 0 ? 100 : index % 3 === 0 ? -30 : 0;
    if (pressOffset === null) return;
    at(note.t + pressOffset, () => record(run.press(note.lane, note.t + pressOffset), note.t + pressOffset, true));
    if (!(note.len > 0)) return;
    const releaseAt = index === 52 ? note.t + 100 : index === 56 ? null : note.t + note.len;
    if (releaseAt !== null) at(releaseAt, () => record(run.release(note.lane, releaseAt), releaseAt, false));
  });

  const end = chart.notes[chart.notes.length - 1].t + 3000;
  for (let ms = 0; ms <= end; ms += 10) {
    // FEVER is pressed as soon as it is available, before the step's presses.
    const snapshot = run.snapshot(ms);
    if (!snapshot.feverActive && snapshot.vibe >= 1 && run.fever(ms)) fevers.push(run.heardTime(ms));
    for (const action of actions.get(ms) ?? []) action();
    record(run.tick(ms), ms, false);
  }
  return { snapshot: run.snapshot(end), events, fevers };
}

describe("recomputeRun", () => {
  it("gives exactly the client run's score for the same judgements", async () => {
    const chart = makeChart();
    const { snapshot, events, fevers } = await playScripted(chart);

    assert.ok(snapshot.fevers >= 1, "the script must reach FEVER");
    assert.ok(snapshot.counts.miss > 0 && snapshot.counts.good > 0 && snapshot.counts.great > 0);
    assert.strictEqual(events.length, judgeablePartsOf(chart));

    const result = await recomputeRun({ chart, events, fevers });
    assert.strictEqual(result.score, snapshot.score);
    assert.strictEqual(result.accuracy, snapshot.accuracy);
    assert.strictEqual(result.grade, snapshot.grade);
    assert.strictEqual(result.maxCombo, snapshot.maxCombo);
    assert.deepStrictEqual(result.counts, snapshot.counts);
    assert.strictEqual(result.judged, snapshot.judged);
    assert.strictEqual(result.fevers, snapshot.fevers);

    const withoutFever = await recomputeRun({ chart, events, fevers: [] });
    assert.ok(withoutFever.score < snapshot.score, "the fever starts are what the bonus score rests on");
  });

  it("ignores a fever start the replayed state does not allow", async () => {
    const chart = makeChart();
    const { events } = await playScripted(chart);
    const result = await recomputeRun({ chart, events, fevers: [0, 100] });
    const plain = await recomputeRun({ chart, events, fevers: [] });
    assert.strictEqual(result.fevers, 0);
    assert.strictEqual(result.score, plain.score);
  });

  it("keeps each judgement near its own note, so one FEVER cannot cover the whole run", async () => {
    const chart = { notes: Array.from({ length: 200 }, (_, i) => ({ t: 1000 + i * 500, lane: i % 4 })) };
    const honest = chart.notes.map((note, n) => ({ n, part: "head", j: "perfect", t: note.t, d: 0 }));
    const feverAt = honest[59].t;
    const { score } = await recomputeRun({ chart, events: honest, fevers: [feverAt] });
    // The same judgements, all claimed inside the FEVER window and shuffled.
    const moved = honest.map((event) => ({ ...event, t: feverAt + 1 })).reverse();
    const cheated = await recomputeRun({ chart, events: moved, fevers: [feverAt] });
    // At most the note or two the timing slack lets slip into the window's edges.
    assert.ok(cheated.score - score <= score * 0.01, `${cheated.score} vs ${score}`);
  });

  it("rejects more events than the chart has judgements", async () => {
    const chart = { notes: [{ t: 1000, lane: 0 }, { t: 1500, lane: 1, len: 300 }] };
    assert.strictEqual(judgeablePartsOf(chart), 3);
    const events = [0, 1, 2, 3].map((n) => ({ n: n % 2, part: "head", j: "perfect", t: 1000 + n }));
    await assert.rejects(recomputeRun({ chart, events }), { code: "too_many_events" });
  });

  it("rejects a repeated note part", async () => {
    const chart = { notes: [{ t: 1000, lane: 0 }, { t: 1500, lane: 1 }] };
    const events = [{ n: 0, part: "head", j: "perfect", t: 1000 }, { n: 0, part: "head", j: "great", t: 1010 }];
    await assert.rejects(recomputeRun({ chart, events }), { code: "bad_event" });
  });

  it("rejects a tail on a tap and a tail without its head", async () => {
    const chart = { notes: [{ t: 1000, lane: 0 }, { t: 1500, lane: 1, len: 300 }] };
    await assert.rejects(
      recomputeRun({ chart, events: [{ n: 0, part: "tail", j: "perfect", t: 1000 }] }),
      { code: "bad_event" },
    );
    await assert.rejects(
      recomputeRun({ chart, events: [{ n: 1, part: "tail", j: "perfect", t: 1800 }] }),
      { code: "bad_event" },
    );
    const ok = await recomputeRun({
      chart,
      events: [{ n: 1, part: "head", j: "perfect", t: 1500 }, { n: 1, part: "tail", j: "good", t: 1800 }],
    });
    assert.strictEqual(ok.judged, 2);
  });

  it("rejects unknown notes, parts, judgements and times", async () => {
    const chart = { notes: [{ t: 1000, lane: 0 }, { t: 1500, lane: 1 }] };
    const base = { n: 0, part: "head", j: "perfect", t: 1000 };
    for (const bad of [
      { n: 2 }, { n: -1 }, { n: 0.5 }, { n: "0" }, { part: "middle" }, { j: "flawless" }, { t: Infinity }, { t: "1000" }, { t: NaN },
    ]) {
      await assert.rejects(recomputeRun({ chart, events: [{ ...base, ...bad }] }), { code: "bad_event" }, JSON.stringify(bad));
    }
    await assert.rejects(recomputeRun({ chart, events: [null] }), { code: "bad_event" });
    await assert.rejects(recomputeRun({ chart, events: [base], fevers: [Infinity] }), { code: "bad_event" });
    await assert.rejects(recomputeRun({ chart, events: "no" }), { code: "bad_event" });
  });

  it("takes the scoring module from loadScoring", async () => {
    const chart = { notes: [{ t: 1000, lane: 0 }] };
    let loads = 0;
    const loadScoring = async () => {
      loads += 1;
      return importClient("scoring.js");
    };
    const result = await recomputeRun({ chart, events: [{ n: 0, part: "head", j: "great", t: 1000 }], loadScoring });
    assert.strictEqual(loads, 1);
    assert.strictEqual(result.score, 200);
    assert.strictEqual(result.accuracy, 66.7);
    assert.strictEqual(result.grade, "D");
  });
});
