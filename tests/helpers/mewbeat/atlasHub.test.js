const assert = require("node:assert");
const { describe, it } = require("node:test");

const { AtlasHubError, createAtlasHubClient } = require("../../../helpers/mewbeat/atlasHub");
const { createFakeAtlasHub } = require("./fakeAtlasHub");

const COLUMNS = [
  { name: "id", type: "text", primaryKey: true },
  { name: "n", type: "bigint" },
  { name: "tags", type: "jsonb" },
];

function seed(hub, table, rows) {
  for (const row of rows) hub.tables.get(table).rows.set(row.id, row);
}

function setup(options) {
  const hub = createFakeAtlasHub(options);
  const client = createAtlasHubClient({ url: "https://hub.example/", secretKey: "test-key", fetchImpl: hub.fetch, timeoutMs: 500 });
  return { hub, client };
}

describe("AtlasHub client", () => {
  it("creates a table and an index, and does it again without complaint", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    await client.ensureTable({ name: "t", columns: COLUMNS });
    await client.ensureIndex({ name: "t_n", table: "t", columns: ["n"] });
    assert.ok(hub.tables.has("t"));
    assert.strictEqual(hub.requests[0].body.ifNotExists, true);
  });

  it("reads every row of a table across the pages of a read-batch, in order", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    const rows = Array.from({ length: 2500 }, (_, index) => ({ id: `r${String(index).padStart(5, "0")}`, n: index, tags: "[]" }));
    seed(hub, "t", rows);

    const all = await client.selectAll("t");
    assert.strictEqual(all.length, 2500);
    assert.deepStrictEqual(all.map((row) => row.id), rows.map((row) => row.id));
    assert.strictEqual(hub.count("POST", "read-batch"), 1, "ten pages of 1000 in one request");
  });

  it("asks for a further batch when a table fills the first one exactly", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    seed(hub, "t", Array.from({ length: 10000 }, (_, index) => ({ id: `r${String(index).padStart(5, "0")}`, n: index, tags: "[]" })));

    assert.strictEqual((await client.selectAll("t")).length, 10000);
    assert.strictEqual(hub.count("POST", "read-batch"), 2);
  });

  it("upserts by patching a row that exists", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    await client.insertRows("t", [{ id: "a b|c", n: 1, tags: "[]" }]);
    hub.requests.length = 0;

    assert.strictEqual(await client.upsertRow("t", "id", "a b|c", { id: "a b|c", n: 2, tags: '["x"]' }), "updated");
    assert.strictEqual(hub.rows("t")[0].n, 2);
    assert.deepStrictEqual(hub.requests.map((request) => request.method), ["PATCH"]);
    assert.ok(hub.requests[0].path.includes("eq.id=a%20b%7Cc"), "the id is url-encoded");
    assert.ok(!("id" in hub.requests[0].body.values), "the key is not part of the update");
  });

  it("upserts by inserting a row that does not exist", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    hub.requests.length = 0;

    assert.strictEqual(await client.upsertRow("t", "id", "a", { id: "a", n: 1, tags: "[]" }), "inserted");
    assert.deepStrictEqual(hub.requests.map((request) => request.method), ["PATCH", "POST"]);
    assert.strictEqual(hub.rows("t")[0].id, "a");
  });

  it("patches again when another writer inserted the row between the patch and the insert", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    // The patch finds nothing; then the row appears before the insert, which answers 409.
    hub.queue.push(({ method }) => {
      if (method !== "PATCH") return null;
      hub.tables.get("t").rows.set("a", { id: "a", n: 0, tags: "[]" });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    assert.strictEqual(await client.upsertRow("t", "id", "a", { id: "a", n: 5, tags: "[]" }), "updated");
    assert.strictEqual(hub.rows("t")[0].n, 5);
  });

  it("tells a retryable failure from a refusal, and reads Retry-After", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });

    hub.respond(429, "slow down", { "retry-after": "7" });
    await assert.rejects(client.insertRows("t", [{ id: "a" }]), (error) => {
      assert.ok(error instanceof AtlasHubError);
      assert.deepStrictEqual([error.status, error.retryable, error.retryAfterMs], [429, true, 7000]);
      return true;
    });

    hub.respond(503, "busy");
    await assert.rejects(client.insertRows("t", [{ id: "a" }]), (error) => error.retryable === true && error.status === 503);

    await assert.rejects(client.insertRows("t", [{ id: "a", n: 1.5 }]), (error) => error.status === 400 && error.retryable === false && error.conflict === false);

    await client.insertRows("t", [{ id: "a" }]);
    await assert.rejects(client.insertRows("t", [{ id: "a" }]), (error) => error.status === 409 && error.conflict === true && error.retryable === false);
  });

  it("calls a unique violation a conflict even when the gateway answers 500 with the Postgres text", async () => {
    const { hub, client } = setup();
    await client.ensureTable({ name: "t", columns: COLUMNS });
    hub.respond(500, 'duplicate key value violates unique constraint "t_pkey"');
    await assert.rejects(client.insertRows("t", [{ id: "a" }]), (error) => error.conflict === true && error.retryable === false);
  });

  it("reports a network failure and a timeout as retryable with status 0", async () => {
    const { hub, client } = setup();
    hub.down = true;
    await assert.rejects(client.selectAll("t"), (error) => error.status === 0 && error.retryable === true);

    const slow = createAtlasHubClient({ url: "https://hub.example", secretKey: "test-key", timeoutMs: 20, fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }) });
    await assert.rejects(slow.selectAll("t"), (error) => error.status === 0 && error.retryable === true && /timed out/.test(error.message));
  });

  it("answers 401 as a refusal that is not retryable, and puts the key in no message", async () => {
    const { hub, client } = setup();
    hub.rejectKey = true;
    await assert.rejects(client.upsertRow("t", "id", "a", { id: "a" }), (error) => {
      assert.strictEqual(error.status, 401);
      assert.strictEqual(error.retryable, false);
      assert.ok(!error.message.includes("test-key"));
      return true;
    });
    assert.ok(!hub.requests.some((request) => JSON.stringify(request).includes("test-key")), "the key travels in a header only");
  });
});
