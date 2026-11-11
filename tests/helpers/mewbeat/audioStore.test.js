const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createAudioStore } = require("../../../helpers/mewbeat/audioStore");

const silentLog = { warning() {} };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// The store does file work between fetches, so wait for a condition rather than a fixed time.
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("mewbeat audio store", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-audio-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("fetches once, writes the file and serves it from disk afterwards", async () => {
    const calls = [];
    const store = createAudioStore({
      dir,
      log: silentLog,
      fetchAudio: async (track, node) => { calls.push({ track, node }); return Buffer.from("ogg-bytes"); },
    });
    const file = await store.get("yt:a:1", "track-a", "node-1");
    assert.ok(file.startsWith(dir));
    assert.ok(file.endsWith(".ogg"));
    assert.strictEqual(fs.readFileSync(file, "utf8"), "ogg-bytes");
    assert.deepStrictEqual(calls, [{ track: "track-a", node: "node-1" }]);

    assert.strictEqual(await store.get("yt:a:1", "track-a", "node-1"), file);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(fs.readdirSync(dir), [path.basename(file)]);
  });

  it("touches a cached file so it counts as recently used", async () => {
    const store = createAudioStore({ dir, log: silentLog, fetchAudio: async () => Buffer.from("x") });
    const file = await store.get("k", "t", "n");
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(file, old, old);
    await store.get("k", "t", "n");
    assert.ok(fs.statSync(file).mtimeMs > old.getTime() + 1000);
  });

  it("shares one fetch between concurrent calls for the same key", async () => {
    const gate = deferred();
    let calls = 0;
    const store = createAudioStore({
      dir,
      log: silentLog,
      fetchAudio: async () => { calls += 1; await gate.promise; return Buffer.from("x"); },
    });
    const first = store.get("k", "t", "n");
    const second = store.get("k", "t", "n");
    gate.resolve();
    assert.strictEqual(await first, await second);
    assert.strictEqual(calls, 1);
  });

  it("runs plugin fetches one at a time across keys", async () => {
    const gates = { a: deferred(), b: deferred() };
    const started = [];
    const store = createAudioStore({
      dir,
      log: silentLog,
      fetchAudio: async (track) => { started.push(track); await gates[track].promise; return Buffer.from(track); },
    });
    const first = store.get("ka", "a", "n");
    const second = store.get("kb", "b", "n");
    await waitFor(() => started.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Which of the two gets to the line first is up to the disk checks before it; the other waits for it either way.
    assert.strictEqual(started.length, 1);
    const [early, late] = started[0] === "a" ? ["a", "b"] : ["b", "a"];
    gates[early].resolve();
    await (early === "a" ? first : second);
    await waitFor(() => started.length > 1);
    assert.deepStrictEqual(started, [early, late]);
    gates[late].resolve();
    await (late === "a" ? first : second);
  });

  it("evicts the oldest files beyond maxFiles", async () => {
    const store = createAudioStore({ dir, log: silentLog, maxFiles: 2, fetchAudio: async (track) => Buffer.from(track) });
    const first = await store.get("k1", "1", "n");
    fs.utimesSync(first, new Date(Date.now() - 20_000), new Date(Date.now() - 20_000));
    const second = await store.get("k2", "2", "n");
    fs.utimesSync(second, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    const third = await store.get("k3", "3", "n");
    assert.strictEqual(fs.existsSync(first), false);
    assert.strictEqual(fs.existsSync(second), true);
    assert.strictEqual(fs.existsSync(third), true);
  });

  it("lets a failed fetch be retried and keeps later keys working", async () => {
    let calls = 0;
    const store = createAudioStore({
      dir,
      log: silentLog,
      fetchAudio: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("busy"), { statusCode: 503 });
        return Buffer.from("ok");
      },
    });
    await assert.rejects(store.get("k", "t", "n"), /busy/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    const file = await store.get("k", "t", "n");
    assert.strictEqual(fs.readFileSync(file, "utf8"), "ok");
    assert.strictEqual(calls, 2);
  });

  describe("cancellation", () => {
    // A is rendering (held at its gate) so that B queues behind it.
    function busyStore() {
      const gates = { a: deferred(), b: deferred() };
      const started = [];
      const store = createAudioStore({
        dir,
        log: silentLog,
        fetchAudio: async (track) => { started.push(track); await gates[track].promise; return Buffer.from(track); },
      });
      return { gates, started, store };
    }

    it("drops a queued job when its only waiter leaves, and a later request renders it", async () => {
      const { gates, started, store } = busyStore();
      const first = store.get("ka", "a", "n");
      await waitFor(() => started.length === 1);
      const controller = new AbortController();
      const queued = store.get("kb", "b", "n", { signal: controller.signal });
      const queuedOutcome = assert.rejects(queued, /gone/);
      controller.abort(new Error("gone"));
      await queuedOutcome;

      gates.a.resolve();
      await first;
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepStrictEqual(started, ["a"], "the cancelled job never reached the plugin");

      gates.b.resolve();
      const file = await store.get("kb", "b", "n");
      assert.strictEqual(fs.readFileSync(file, "utf8"), "b");
      assert.deepStrictEqual(started, ["a", "b"]);
    });

    it("keeps a queued job another caller still waits for", async () => {
      const { gates, started, store } = busyStore();
      const first = store.get("ka", "a", "n");
      await waitFor(() => started.length === 1);
      const controller = new AbortController();
      const leaving = store.get("kb", "b", "n", { signal: controller.signal });
      const staying = store.get("kb", "b", "n");
      const leavingOutcome = assert.rejects(leaving);
      controller.abort(new Error("gone"));
      await leavingOutcome;

      gates.a.resolve();
      gates.b.resolve();
      await first;
      const file = await staying;
      assert.strictEqual(fs.readFileSync(file, "utf8"), "b");
    });

    it("lets a job that is already rendering finish when its waiter leaves", async () => {
      const { gates, started, store } = busyStore();
      const controller = new AbortController();
      const waiting = store.get("ka", "a", "n", { signal: controller.signal });
      const outcome = assert.rejects(waiting);
      await waitFor(() => started.length === 1);
      controller.abort(new Error("gone"));
      await outcome;
      gates.a.resolve();
      await waitFor(() => fs.readdirSync(dir).some((name) => name.endsWith(".ogg")));
      const file = await store.get("ka", "a", "n");
      assert.strictEqual(fs.readFileSync(file, "utf8"), "a");
      assert.deepStrictEqual(started, ["a"], "the finished render is served, not started again");
    });

    it("rejects at once for a signal that is already aborted", async () => {
      const { store } = busyStore();
      const controller = new AbortController();
      controller.abort(new Error("already"));
      await assert.rejects(store.get("ka", "a", "n", { signal: controller.signal }), /already/);
    });
  });

  describe("the line of renders", () => {
    function lineStore(options = {}) {
      const gates = {};
      const started = [];
      const store = createAudioStore({
        dir,
        log: silentLog,
        fetchAudio: async (track) => { started.push(track); gates[track] ??= deferred(); await gates[track].promise; return Buffer.from(track); },
        ...options,
      });
      const release = async (track) => { await waitFor(() => gates[track]); gates[track].resolve(); };
      return { release, started, store };
    }

    it("renders a player's song before the warm-ups that wait, behind the one that runs", async () => {
      const { release, started, store } = lineStore();
      const jobs = [store.get("k1", "s1", "n")];
      await waitFor(() => started.length === 1);
      jobs.push(store.get("k2", "s2", "n"), store.get("k3", "s3", "n")); // warm-ups
      await waitFor(() => store.size().background === 2);
      jobs.push(store.get("k4", "s4", "n", { signal: new AbortController().signal })); // a player
      for (const track of ["s1", "s4", "s2", "s3"]) await release(track);
      await Promise.all(jobs);
      assert.deepStrictEqual(started, ["s1", "s4", "s2", "s3"]);
    });

    it("moves a warm-up that waits up the line when a player asks for the same song", async () => {
      const { release, started, store } = lineStore();
      const jobs = [store.get("k1", "s1", "n")];
      await waitFor(() => started.length === 1);
      jobs.push(store.get("k2", "s2", "n"), store.get("k3", "s3", "n"));
      await waitFor(() => store.size().background === 2);
      jobs.push(store.get("k3", "s3", "n", { signal: new AbortController().signal }));
      for (const track of ["s1", "s3", "s2"]) await release(track);
      await Promise.all(jobs);
      assert.deepStrictEqual(started, ["s1", "s3", "s2"]);
    });

    it("refuses warm-ups beyond the cap with QUEUE_FULL and still takes a player", async () => {
      const { release, started, store } = lineStore({ maxBackground: 2 });
      const jobs = [store.get("k1", "s1", "n")];
      await waitFor(() => started.length === 1);
      jobs.push(store.get("k2", "s2", "n"), store.get("k3", "s3", "n"));
      await waitFor(() => store.size().background === 2);
      await assert.rejects(store.get("k4", "s4", "n"), { code: "QUEUE_FULL" });
      jobs.push(store.get("k5", "s5", "n", { signal: new AbortController().signal }));
      for (const track of ["s1", "s5", "s2", "s3"]) await release(track);
      await Promise.all(jobs);
      assert.deepStrictEqual(started, ["s1", "s5", "s2", "s3"]);
    });
  });
});
