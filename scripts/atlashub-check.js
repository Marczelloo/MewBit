#!/usr/bin/env node

// A live smoke test of the AtlasHub gateway, for the person who owns the key to run:
//
//   npx dotenv -e .env.dev -- node scripts/atlashub-check.js
//
// It reads ATLASHUB_URL and ATLASHUB_SECRET_KEY, makes the table `mewbeat_smoke`, writes and reads it the way
// the mewbeat stores do (insert, upsert of a new and of an existing row, jsonb, bigint, paged read), measures
// how long a request takes, drops the table, and prints PASS or FAIL per step. It never prints the key.

const { createAtlasHubClient } = require("../helpers/mewbeat/atlasHub");

const TABLE = "mewbeat_smoke";
const COLUMNS = [
  { name: "id", type: "text", primaryKey: true },
  { name: "label", type: "text" },
  { name: "big", type: "bigint" },
  { name: "ratio", type: "double precision" },
  { name: "tags", type: "jsonb" },
];

const url = process.env.ATLASHUB_URL;
const secretKey = process.env.ATLASHUB_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Set ATLASHUB_URL and ATLASHUB_SECRET_KEY (for example: npx dotenv -e .env.dev -- node scripts/atlashub-check.js).");
  process.exit(2);
}

const client = createAtlasHubClient({ url, secretKey });
const latencies = [];
let failed = 0;

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    latencies.push(Date.now() - started);
    console.log(`PASS  ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    failed += 1;
    // The client's messages carry the method, the path and the status, never the key.
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await step("drop a leftover table", () => client.dropTable(TABLE));
  await step("create the table", () => client.ensureTable({ name: TABLE, columns: COLUMNS }));
  await step("create the table again (ifNotExists)", () => client.ensureTable({ name: TABLE, columns: COLUMNS }));
  await step("create an index", () => client.ensureIndex({ name: "mewbeat_smoke_label", table: TABLE, columns: ["label"] }));

  await step("insert rows", () => client.insertRows(TABLE, [
    { id: "a", label: "first", big: 9007199254740991, ratio: 0.25, tags: JSON.stringify(["x", "y"]) },
    { id: "b", label: "second", big: 5, ratio: 1.5, tags: JSON.stringify([]) },
  ]));

  // The gateway answers a duplicate key with a plain 500 in production, which is why the outbox resends an insert as an upsert.
  await step("insert a duplicate id is refused", async () => {
    try {
      await client.insertRows(TABLE, [{ id: "a", label: "again" }]);
    } catch (error) {
      expect(error.conflict || error.status === 500, `expected a refusal, got status ${error.status}: ${error.message}`);
      return;
    }
    throw new Error("the duplicate was accepted");
  });

  await step("upsert a row that exists (patch)", async () => {
    const result = await client.upsertRow(TABLE, "id", "a", { id: "a", label: "first, changed", big: 7, ratio: 0.5, tags: JSON.stringify(["z"]) });
    expect(result === "updated", `expected "updated", got ${result}`);
  });

  await step("upsert a row that does not exist (patch, then insert)", async () => {
    const result = await client.upsertRow(TABLE, "id", "c", { id: "c", label: "third", big: 1, ratio: 2, tags: JSON.stringify(["n"]) });
    expect(result === "inserted", `expected "inserted", got ${result}`);
  });

  await step("read back: values, jsonb array, bigint", async () => {
    const rows = await client.selectAll(TABLE);
    expect(rows.map((row) => row.id).join(",") === "a,b,c", `expected rows a,b,c in order, got ${rows.map((row) => row.id).join(",")}`);
    const a = rows[0];
    expect(a.label === "first, changed", "the patch did not change the label");
    expect(Number(a.big) === 7, `bigint came back as ${typeof a.big} ${a.big}`);
    const tags = typeof a.tags === "string" ? JSON.parse(a.tags) : a.tags;
    expect(Array.isArray(tags) && tags.length === 1 && tags[0] === "z", `jsonb came back as ${JSON.stringify(a.tags)}`);
    console.log(`      bigint comes back as ${typeof a.big}, jsonb as ${typeof a.tags}`);
  });

  await step("read more than a page (1,500 rows over a read-batch)", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `p${String(index).padStart(4, "0")}`, label: "page", big: index, ratio: 0, tags: "[]" }));
    await client.insertRows(TABLE, rows);
    await client.insertRows(TABLE, rows.slice(0, 497).map((row) => ({ ...row, id: `q${row.id.slice(1)}` })));
    const all = await client.selectAll(TABLE);
    expect(all.length === 1500, `expected 1500 rows, got ${all.length}`);
  });

  await step("drop the table", () => client.dropTable(TABLE));

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(`\nrequests took ${sorted[0]} ms at best, ${sorted[Math.floor(sorted.length / 2)]} ms in the middle, ${sorted[sorted.length - 1]} ms at worst`);
  }
  console.log(failed === 0 ? "\nPASS  the gateway behaves the way mewbeat expects" : `\nFAIL  ${failed} step(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
