const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createDebouncedJson } = require("../../../helpers/mewbeat/debouncedJson");

const silentLog = { warning() {} };

describe("mewbeat debounced json", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-json-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes the latest value once after the debounce", async () => {
    const file = path.join(dir, "a.json");
    const store = createDebouncedJson({ file, debounceMs: 10, log: silentLog });
    store.schedule(() => ({ v: 1 }));
    store.schedule(() => ({ v: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    await store.flush();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), { v: 2 });
  });

  it("flush waits for a write the timer already started", async () => {
    const file = path.join(dir, "b.json");
    const store = createDebouncedJson({ file, debounceMs: 1, log: silentLog });
    let value = { v: 1 };
    store.schedule(() => value);
    // Let the timer fire and its write begin, then flush right away.
    await new Promise((resolve) => setTimeout(resolve, 5));
    value = { v: 2 };
    store.schedule(() => value);
    await store.flush();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), { v: 2 });
  });

  it("returns null for a missing file", () => {
    const store = createDebouncedJson({ file: path.join(dir, "none.json"), log: silentLog });
    assert.strictEqual(store.load(), null);
  });
});
