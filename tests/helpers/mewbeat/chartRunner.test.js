const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, describe, it } = require("node:test");

const { createChartRunner } = require("../../../helpers/mewbeat/chartRunner");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { makeFeatures } = require("./fixtures");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-runner-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A stand-in worker file: `body` runs with the message in `message` and the port in `parentPort`.
function workerFile(name, body) {
  const file = path.join(dir, `${name}.js`);
  fs.writeFileSync(file, `const { parentPort } = require("node:worker_threads");\nparentPort.on("message", (message) => { ${body} });\n`);
  return file;
}

describe("chart runner", () => {
  it("makes the same charts on the worker as generateAll does here", async () => {
    const features = makeFeatures();
    const runner = createChartRunner({ idleMs: 50 });
    const onWorker = await runner.run(features, "youtube:fixture", {});
    assert.deepStrictEqual(onWorker, generateAll(features, "youtube:fixture", {}));
  });

  it("runs queued jobs one at a time, in the order they came", async () => {
    const file = workerFile("echo", `parentPort.postMessage({ id: message.id, charts: message.audioKey });`);
    const runner = createChartRunner({ workerFile: file, idleMs: 50 });
    const results = await Promise.all(["a", "b", "c"].map((key) => runner.run({}, key, {})));
    assert.deepStrictEqual(results, ["a", "b", "c"]);
  });

  it("rejects with the worker's error and goes on with the next job", async () => {
    const file = workerFile("throws", `
      if (message.audioKey === "bad") parentPort.postMessage({ id: message.id, error: { message: "boom", stack: "boom stack" } });
      else parentPort.postMessage({ id: message.id, charts: message.audioKey });`);
    const runner = createChartRunner({ workerFile: file, idleMs: 50 });
    const [bad, good] = await Promise.allSettled([runner.run({}, "bad", {}), runner.run({}, "good", {})]);
    assert.strictEqual(bad.status, "rejected");
    assert.strictEqual(bad.reason.message, "boom");
    assert.strictEqual(bad.reason.stack, "boom stack");
    assert.deepStrictEqual(good, { status: "fulfilled", value: "good" });
  });

  it("fails the job a crashed worker was running and starts a new worker for the rest", async () => {
    const file = workerFile("crashes", `
      if (message.audioKey === "crash") process.exit(3);
      parentPort.postMessage({ id: message.id, charts: message.audioKey });`);
    const runner = createChartRunner({ workerFile: file, idleMs: 50 });
    const [crashed, after] = await Promise.allSettled([runner.run({}, "crash", {}), runner.run({}, "next", {})]);
    assert.strictEqual(crashed.status, "rejected");
    assert.match(crashed.reason.message, /exited with code 3/);
    assert.deepStrictEqual(after, { status: "fulfilled", value: "next" });
  });

  it("fails the job when the worker throws outside the handler", async () => {
    const file = workerFile("uncaught", `setImmediate(() => { throw new Error("uncaught in worker"); });`);
    const runner = createChartRunner({ workerFile: file, idleMs: 50 });
    await assert.rejects(runner.run({}, "x", {}), /uncaught in worker/);
  });

  it("fails the job when the worker file is missing", async () => {
    const runner = createChartRunner({ workerFile: path.join(dir, "missing.js"), idleMs: 50 });
    await assert.rejects(runner.run({}, "x", {}));
  });

  it("reuses the worker between jobs and starts a new one after it idled out", async () => {
    const file = workerFile("threads", `parentPort.postMessage({ id: message.id, charts: require("node:worker_threads").threadId });`);
    const runner = createChartRunner({ workerFile: file, idleMs: 30 });
    const first = await runner.run({}, "a", {});
    const second = await runner.run({}, "b", {});
    assert.strictEqual(second, first);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.notStrictEqual(await runner.run({}, "c", {}), first);
  });
});
