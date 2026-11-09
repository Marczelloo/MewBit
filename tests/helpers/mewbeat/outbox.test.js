const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { AtlasHubError } = require("../../../helpers/mewbeat/atlasHub");
const { createOutbox } = require("../../../helpers/mewbeat/outbox");

const silent = { warning() {}, error() {}, success() {}, info() {} };

describe("mewbeat outbox", () => {
  let dir;
  let file;
  let clock;
  let sent;
  let behaviour;
  let logged;
  let timers;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-outbox-"));
    file = path.join(dir, "outbox.jsonl");
    clock = 1_000_000;
    sent = [];
    behaviour = () => {}; // may throw to fail a request
    logged = { error: [], warning: [], success: [] };
    timers = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function make(options = {}) {
    return createOutbox({
      file,
      now: () => clock,
      random: () => 0,
      schedule: (fn, ms) => {
        timers.push(ms);
        return () => {};
      },
      log: { ...silent, error: (...a) => logged.error.push(a), warning: (...a) => logged.warning.push(a), success: (...a) => logged.success.push(a) },
      send: async (request) => {
        await behaviour(request);
        sent.push(request);
      },
      ...options,
    });
  }

  const row = (id, extra = {}) => ({ id, ...extra });
  const retryable = (extra = {}) => new AtlasHubError("down", { retryable: true, ...extra });

  it("sends nothing before start and arms its timer once started", () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a"));
    assert.deepStrictEqual(timers, []);
    outbox.start();
    assert.deepStrictEqual(timers, [1000]);
  });

  it("coalesces upserts of one row, the last state wins", async () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a", { n: 1 }));
    outbox.upsert("t", "a", row("a", { n: 2 }));
    outbox.upsert("t", "b", row("b", { n: 9 }));
    outbox.upsert("t", "a", row("a", { n: 3 }));
    assert.strictEqual(outbox.rowOps().length, 2);

    assert.strictEqual(await outbox.pump(), "idle");
    assert.deepStrictEqual(sent, [
      { kind: "upsert", table: "t", id: "a", row: { id: "a", n: 3 } },
      { kind: "upsert", table: "t", id: "b", row: { id: "b", n: 9 } },
    ]);
    assert.strictEqual(outbox.status().pending, 0);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "", "an empty queue empties the journal");
  });

  it("sends inserts of a table in one request, and 500 rows at most", async () => {
    const outbox = make();
    for (let index = 0; index < 501; index += 1) outbox.insert("h", `r${index}`, row(`r${index}`));
    outbox.insert("other", "x", row("x"));
    await outbox.pump();
    assert.deepStrictEqual(sent.map((request) => [request.table, request.rows.length]), [["h", 500], ["h", 1], ["other", 1]]);
  });

  it("falls back to one row at a time when a batch is refused, and counts a row that exists as done", async () => {
    const outbox = make();
    for (const id of ["a", "b", "c"]) outbox.insert("h", id, row(id));
    behaviour = (request) => {
      if (request.rows.length > 1 || request.rows[0].id === "b") throw new AtlasHubError("duplicate key", { status: 409, conflict: true });
    };
    await outbox.pump();
    assert.deepStrictEqual(sent.map((request) => request.rows.map((r) => r.id)), [["a"], ["c"]]);
    assert.strictEqual(outbox.status().pending, 0);
    assert.strictEqual(outbox.status().dead, 0);
  });

  it("resends an insert answered with a plain 500 as an upsert, since the gateway hides a duplicate key that way", async () => {
    const outbox = make();
    outbox.insert("h", "a", row("a"));
    behaviour = (request) => {
      if (request.kind === "insert") throw retryable({ status: 500 });
    };
    assert.strictEqual(await outbox.pump(), "blocked");
    clock += 60_000;
    assert.strictEqual(await outbox.pump(), "idle");
    assert.deepStrictEqual(sent, [{ kind: "upsert", table: "h", id: "a", row: { id: "a" } }]);
  });

  it("sends an insert recovered from the journal as an upsert, since it may have landed before the crash", async () => {
    make().insert("h", "a", row("a"));
    const outbox = make();
    await outbox.pump();
    assert.deepStrictEqual(sent, [{ kind: "upsert", table: "h", id: "a", row: { id: "a" } }]);
  });

  it("sets aside a row that keeps answering 500 while other writes get through", async () => {
    const outbox = make();
    outbox.upsert("t", "bad", row("bad"));
    outbox.upsert("t", "good", row("good"));
    behaviour = (request) => {
      if (request.id === "bad") throw retryable({ status: 500 });
    };
    for (let pass = 0; pass < 6; pass += 1) {
      await outbox.pump();
      clock += 10 * 60_000;
    }
    assert.deepStrictEqual(sent.map((request) => request.id), ["good"]);
    assert.deepStrictEqual([outbox.status().pending, outbox.status().dead], [0, 1]);
  });

  it("sets nothing aside while every write answers 500, because then the hub is down", async () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a"));
    outbox.upsert("t", "b", row("b"));
    behaviour = () => {
      throw retryable({ status: 500 });
    };
    for (let pass = 0; pass < 12; pass += 1) {
      await outbox.pump();
      clock += 10 * 60_000;
    }
    assert.deepStrictEqual([outbox.status().pending, outbox.status().dead], [2, 0]);
  });

  it("waits out a 429 for as long as Retry-After says", async () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a"));
    let calls = 0;
    behaviour = () => {
      calls += 1;
      if (calls === 1) throw retryable({ status: 429, retryAfterMs: 30_000 });
    };

    assert.strictEqual(await outbox.pump(), "blocked");
    clock += 29_000;
    assert.strictEqual(await outbox.pump(), "blocked");
    assert.strictEqual(calls, 1, "no request while Retry-After runs");
    clock += 1_000;
    assert.strictEqual(await outbox.pump(), "idle");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(outbox.status().pending, 0);
  });

  it("backs off exponentially after network failures and recovers", async () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a"));
    let calls = 0;
    behaviour = () => {
      calls += 1;
      if (calls <= 2) throw retryable();
    };

    await outbox.pump();
    assert.strictEqual(calls, 1);
    clock += 1_999;
    await outbox.pump();
    assert.strictEqual(calls, 1);
    clock += 1;
    await outbox.pump();
    assert.strictEqual(calls, 2);
    clock += 3_999;
    await outbox.pump();
    assert.strictEqual(calls, 2, "the second wait is twice the first");
    clock += 1;
    assert.strictEqual(await outbox.pump(), "idle");
    assert.strictEqual(calls, 3);
    assert.strictEqual(logged.warning.length, 1, "degraded is said once");
    assert.strictEqual(logged.success.length, 1, "and so is the recovery");
  });

  it("keeps everything and stops on 401, trying again every five minutes", async () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a"));
    outbox.insert("h", "b", row("b"));
    let calls = 0;
    behaviour = () => {
      calls += 1;
      throw new AtlasHubError("refused", { status: 401 });
    };

    assert.strictEqual(await outbox.pump(), "blocked");
    assert.strictEqual(calls, 1);
    clock += 4 * 60_000;
    await outbox.pump();
    assert.strictEqual(calls, 1);
    clock += 60_000;
    await outbox.pump();
    assert.strictEqual(calls, 2);
    assert.strictEqual(logged.error.length, 1, "logged once");
    assert.strictEqual(outbox.status().pending, 2);
    assert.strictEqual(outbox.status().dead, 0);

    behaviour = () => {};
    clock += 5 * 60_000;
    assert.strictEqual(await outbox.pump(), "idle");
    assert.strictEqual(outbox.status().pending, 0);
  });

  it("sets a poison write aside in the dead file and goes on with the queue", async () => {
    const outbox = make();
    outbox.upsert("t", "bad", row("bad"));
    outbox.upsert("t", "good", row("good"));
    behaviour = (request) => {
      if (request.id === "bad") throw new AtlasHubError("invalid input syntax", { status: 400 });
    };

    assert.strictEqual(await outbox.pump(), "idle");
    assert.deepStrictEqual(sent.map((request) => request.id), ["good"]);
    assert.strictEqual(outbox.status().dead, 1);
    assert.strictEqual(logged.error.length, 1);
    const dead = fs.readFileSync(path.join(dir, "outbox.dead.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.strictEqual(dead.length, 1);
    assert.strictEqual(dead[0].op.rowId, "bad");
    assert.strictEqual(dead[0].status, 400);
  });

  it("takes a request from a bucket of requestsPerMinute and refills it over time", async () => {
    const outbox = make({ requestsPerMinute: 3 });
    for (const id of ["a", "b", "c", "d", "e"]) outbox.upsert("t", id, row(id));

    assert.strictEqual(await outbox.pump(), "tokens");
    assert.strictEqual(sent.length, 3, "the bucket holds a minute's worth");
    clock += 19_000;
    assert.strictEqual(await outbox.pump(), "tokens");
    assert.strictEqual(sent.length, 3);
    clock += 1_000;
    assert.strictEqual(await outbox.pump(), "tokens");
    assert.strictEqual(sent.length, 4, "one request every twenty seconds");
    clock += 20_000;
    assert.strictEqual(await outbox.pump(), "idle");
    assert.strictEqual(sent.length, 5);
  });

  it("recovers pending writes in order from the journal, ignoring a torn last line", async () => {
    const first = make();
    first.upsert("t", "a", row("a", { n: 1 }));
    first.insert("h", "b", row("b"));
    first.upsert("t", "c", row("c"));
    first.upsert("t", "a", row("a", { n: 2 }));
    fs.appendFileSync(file, '{"op":{"id":9,"kind":"upsert","table":"t","rowId":"z","ro'); // killed mid-write

    const second = make();
    assert.deepStrictEqual(second.rowOps().map((op) => [op.table, op.rowId, op.row.n ?? null]), [["t", "a", 2], ["h", "b", null], ["t", "c", null]]);
    assert.strictEqual(logged.warning.length, 0, "a torn last line is expected after a crash");

    // The next write starts on a line of its own, and the whole journal still reads.
    second.upsert("t", "d", row("d"));
    const third = make();
    assert.deepStrictEqual(third.rowOps().map((op) => op.rowId), ["a", "b", "c", "d"]);

    await third.pump();
    assert.deepStrictEqual(sent.map((request) => request.id ?? request.rows[0].id), ["a", "b", "c", "d"]);
  });

  it("does not bring back what was sent: an ack in the journal removes the write", async () => {
    const first = make();
    first.upsert("t", "a", row("a"));
    first.upsert("t", "c", row("c"));
    behaviour = (request) => {
      if (request.id === "c") throw retryable();
    };
    await first.pump();
    assert.strictEqual(sent.length, 1);

    const second = make();
    assert.deepStrictEqual(second.rowOps().map((op) => op.rowId), ["c"]);
  });

  it("keeps a newer state of a row that arrives while the older one is in flight", async () => {
    const outbox = make();
    outbox.upsert("t", "a", row("a", { n: 1 }));
    behaviour = () => {
      if (sent.length === 0) outbox.upsert("t", "a", row("a", { n: 2 }));
    };
    await outbox.pump();
    assert.deepStrictEqual(sent.map((request) => request.row.n), [1, 2]);
    assert.strictEqual(outbox.status().pending, 0);
  });

  it("journals a deferred call and replays it once, swapping it for the writes it made", async () => {
    const first = make();
    first.defer({ store: "stats", method: "add", args: ["u1", { plays: 1 }, 123] });
    assert.strictEqual(first.deferredOps().length, 1);

    // A restart finds the call, replays it, and the writes it made are the pending ones.
    const second = make();
    const [call] = second.deferredOps();
    assert.deepStrictEqual(call.call.args, ["u1", { plays: 1 }, 123]);
    second.replay(call.id, (made) => second.upsert("mewbeat_stats", made.args[0], { user_id: made.args[0], at: made.args[2] }));
    assert.strictEqual(second.deferredOps().length, 0);

    const third = make();
    assert.strictEqual(third.deferredOps().length, 0, "the call is not replayed twice");
    assert.deepStrictEqual(third.rowOps().map((op) => op.row.at), [123]);
  });

  it("sets a deferred call that throws aside and goes on", () => {
    const outbox = make();
    const id = outbox.defer({ store: "x", method: "y", args: [] });
    assert.strictEqual(outbox.replay(id, () => { throw new Error("no such store"); }), false);
    assert.strictEqual(outbox.deferredOps().length, 0);
    assert.strictEqual(outbox.status().dead, 1);
  });

  it("flushes what it can within the time and leaves the rest in the journal", async () => {
    const outbox = make();
    outbox.start();
    outbox.upsert("t", "a", row("a"));
    await outbox.flush(1000);
    assert.strictEqual(outbox.status().pending, 0);

    outbox.upsert("t", "b", row("b"));
    behaviour = () => new Promise(() => {}); // never answers
    const started = Date.now();
    const result = await outbox.flush(50);
    assert.ok(Date.now() - started < 1000);
    assert.strictEqual(result.pending, 1);
    assert.deepStrictEqual(make().rowOps().map((op) => op.rowId), ["b"]);
  });

  it("flush goes on although the outbox is backing off", async () => {
    const outbox = make();
    outbox.start();
    outbox.upsert("t", "a", row("a"));
    let fail = true;
    behaviour = () => {
      if (fail) throw retryable();
    };
    await outbox.pump();
    assert.strictEqual(outbox.status().pending, 1);
    fail = false;
    const result = await outbox.flush(1000);
    assert.strictEqual(result.pending, 0);
  });

  it("compacts a big journal down to the pending writes", async () => {
    const outbox = make();
    const big = "x".repeat(2000);
    for (let index = 0; index < 700; index += 1) outbox.upsert("t", "a", row("a", { index, big }));
    outbox.insert("h", "keep", row("keep"));
    await new Promise((resolve) => setTimeout(resolve, 100)); // the rewrite is asynchronous
    outbox.upsert("t", "a", row("a", { index: 700 }));
    assert.ok(fs.statSync(file).size < 700 * 2000, "the journal shrank");
    const reloaded = make();
    assert.deepStrictEqual(reloaded.rowOps().map((op) => [op.rowId, op.row.index ?? null]), [["a", 700], ["keep", null]]);
  });
});
