const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createPriorityGate } = require("../../../helpers/mewbeat/priorityGate");

// A task that records when it starts and finishes when `release()` is called.
function controlled(log, name) {
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  const task = async () => {
    log.push(name);
    await done;
    return name;
  };
  return { task, release: () => release() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("priority gate", () => {
  it("runs a play job before the background jobs that are queued, without interrupting the one that runs", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const log = [];
    const first = controlled(log, "bg1");
    const second = controlled(log, "bg2");
    const third = controlled(log, "bg3");
    const play = controlled(log, "play");
    const results = [
      gate.run(first.task, { priority: "background", key: "1" }),
      gate.run(second.task, { priority: "background", key: "2" }),
      gate.run(third.task, { priority: "background", key: "3" }),
    ];
    await tick();
    assert.deepStrictEqual(log, ["bg1"]);

    results.push(gate.run(play.task, { priority: "play" }));
    first.release();
    await tick();
    assert.deepStrictEqual(log, ["bg1", "play"], "the play job goes ahead of the queued background jobs");
    play.release();
    await tick();
    second.release();
    await tick();
    third.release();
    await Promise.all(results);
    assert.deepStrictEqual(log, ["bg1", "play", "bg2", "bg3"]);
  });

  it("keeps play jobs in the order they came", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const log = [];
    const jobs = ["a", "b", "c"].map((name) => controlled(log, name));
    const results = jobs.map((job) => gate.run(job.task));
    for (const job of jobs) {
      await tick();
      job.release();
    }
    await Promise.all(results);
    assert.deepStrictEqual(log, ["a", "b", "c"]);
  });

  it("does not queue a background job twice: the second caller gets the same result", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const log = [];
    const blocker = controlled(log, "blocker");
    const one = controlled(log, "one");
    gate.run(blocker.task, { priority: "background", key: "blocker" });
    const a = gate.run(one.task, { priority: "background", key: "same" });
    const b = gate.run(() => { log.push("again"); return "again"; }, { priority: "background", key: "same" });
    assert.strictEqual(a, b);
    blocker.release();
    await tick();
    one.release();
    assert.strictEqual(await b, "one");
    assert.deepStrictEqual(log, ["blocker", "one"]);
    assert.deepStrictEqual(gate.size(), { running: 0, play: 0, background: 0 });
  });

  it("refuses a background job beyond the cap with QUEUE_FULL, and still takes play jobs", async () => {
    const gate = createPriorityGate({ concurrency: 1, backgroundCap: 2 });
    const log = [];
    const running = controlled(log, "running");
    gate.run(running.task, { priority: "background", key: "running" });
    gate.run(controlled(log, "q1").task, { priority: "background", key: "q1" });
    gate.run(controlled(log, "q2").task, { priority: "background", key: "q2" });
    await assert.rejects(gate.run(controlled(log, "q3").task, { priority: "background", key: "q3" }), { code: "QUEUE_FULL" });
    // A key that is already queued is not a new job, so it is not refused.
    gate.run(controlled(log, "q2 again").task, { priority: "background", key: "q2" });
    const play = gate.run(async () => "played");
    running.release();
    assert.strictEqual(await play, "played");
  });

  it("moves a background job that waits to the play line when a play job asks for the same key", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const log = [];
    const blocker = controlled(log, "blocker");
    const early = controlled(log, "early");
    const wanted = controlled(log, "wanted");
    gate.run(blocker.task, { priority: "background", key: "blocker" });
    gate.run(early.task, { priority: "background", key: "early" });
    const result = gate.run(wanted.task, { priority: "background", key: "wanted" });
    const promoted = gate.run(() => { throw new Error("the original task runs, not this one"); }, { priority: "play", key: "wanted" });
    assert.strictEqual(promoted, result);
    blocker.release();
    await tick();
    assert.deepStrictEqual(log, ["blocker", "wanted"]);
    wanted.release();
    await tick();
    early.release();
    await result;
  });

  it("starts a play job at once with playBypass, and background jobs one at a time while nothing else runs", async () => {
    const gate = createPriorityGate({ concurrency: 1, playBypass: true });
    const log = [];
    const bg1 = controlled(log, "bg1");
    const bg2 = controlled(log, "bg2");
    const playA = controlled(log, "playA");
    const playB = controlled(log, "playB");
    gate.run(bg1.task, { priority: "background", key: "1" });
    gate.run(bg2.task, { priority: "background", key: "2" });
    gate.run(playA.task);
    gate.run(playB.task);
    await tick();
    assert.deepStrictEqual(log, ["bg1", "playA", "playB"], "play jobs do not wait for the running background job");
    bg1.release();
    await tick();
    assert.deepStrictEqual(log, ["bg1", "playA", "playB"], "the next background job waits while play jobs run");
    playA.release();
    playB.release();
    await tick();
    assert.deepStrictEqual(log, ["bg1", "playA", "playB", "bg2"]);
    bg2.release();
  });

  it("goes on after a failed job and calls onIdle when everything is done", async () => {
    let idle = 0;
    const gate = createPriorityGate({ concurrency: 1, onIdle: () => { idle += 1; } });
    const failing = gate.run(async () => { throw new Error("boom"); });
    const next = gate.run(async () => "fine");
    await assert.rejects(failing, /boom/);
    assert.strictEqual(await next, "fine");
    await tick();
    assert.strictEqual(idle, 1);
  });

  it("runs the same key once for play jobs too, the later caller joins the earlier one", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const log = [];
    const job = controlled(log, "a");
    const first = gate.run(job.task, { key: "same" });
    const second = gate.run(controlled(log, "again").task, { key: "same" });
    await tick();
    job.release();
    assert.deepStrictEqual(await Promise.all([first, second]), ["a", "a"]);
    assert.deepStrictEqual(log, ["a"]);
    // Once it is done the key is free for a new job.
    const later = controlled(log, "b");
    const third = gate.run(later.task, { key: "same" });
    later.release();
    assert.strictEqual(await third, "b");
  });

  it("tells the task the priority it runs under, a promoted job runs as play", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const seen = [];
    const blocker = controlled([], "x");
    const results = [gate.run(blocker.task, { priority: "background", key: "x" })];
    results.push(gate.run(async (priority) => { seen.push(priority); }, { priority: "background", key: "y" }));
    results.push(gate.run(async (priority) => { seen.push(priority); }, { priority: "background", key: "z" }));
    await tick();
    gate.promote("y");
    blocker.release();
    await Promise.all(results);
    assert.deepStrictEqual(seen, ["play", "background"]);
  });

  it("says where a keyed job stands: running, or how many jobs start before it", async () => {
    const gate = createPriorityGate({ concurrency: 1 });
    const blocker = controlled([], "x");
    const results = [
      gate.run(blocker.task, { priority: "background", key: "x" }),
      gate.run(async () => {}, { priority: "background", key: "b1" }),
      gate.run(async () => {}, { priority: "background", key: "b2" }),
      gate.run(async () => {}, { priority: "play", key: "p1" }),
    ];
    await tick();
    assert.deepStrictEqual(gate.place("x"), { running: true });
    assert.deepStrictEqual(gate.place("p1"), { ahead: 1 }, "behind the job that runs");
    assert.deepStrictEqual(gate.place("b1"), { ahead: 2 }, "behind the running job and the play job");
    assert.deepStrictEqual(gate.place("b2"), { ahead: 3 });
    assert.strictEqual(gate.place("nope"), null);
    assert.strictEqual(gate.place(null), null);
    gate.promote("b2");
    assert.deepStrictEqual(gate.place("b2"), { ahead: 2 }, "promoted to the end of the play line");
    blocker.release();
    await Promise.all(results);
    assert.strictEqual(gate.place("b2"), null);
  });
});
