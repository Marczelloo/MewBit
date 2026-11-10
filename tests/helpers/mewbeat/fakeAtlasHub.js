// A stand-in for the AtlasHub gateway, passed to the client as its fetchImpl. It speaks the same HTTP
// (tables, indexes, read-batch, insert with 409 on a duplicate, patch by key) and checks what Postgres would:
// integer columns refuse fractions, jsonb refuses a JS array or object (it takes a JSON string).
function createFakeAtlasHub({ secretKey = "test-key", bigintAsString = false } = {}) {
  const tables = new Map(); // name -> { columns: Map(name -> type), key, rows: Map(id -> row) }
  const hub = {
    requests: [], // { method, path, body }
    down: false, // no answer at all
    rejectKey: false, // answers 401 whatever the key
    bigintAsString,
    tables,
    queue: [], // answers to give, oldest first, before the normal handling: a function (request) -> Response | null
    loseNextResponse: false, // the next write is applied, but its answer never arrives
  };

  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fail = (status, message, headers) => json(status, { message }, headers);

  function check(table, row) {
    for (const [name, value] of Object.entries(row)) {
      const type = table.columns.get(name);
      if (!type) return `column ${name} does not exist`;
      if (value === null) continue;
      if ((type === "bigint" || type === "integer") && !Number.isInteger(value)) return `invalid input syntax for type ${type}: "${value}"`;
      if (type === "jsonb" && typeof value !== "string") return `invalid input syntax for type json (${name} was not sent as a string)`;
      if (type === "text" && typeof value !== "string") return `column ${name} expects text`;
    }
    return null;
  }

  // What a SELECT returns: jsonb parsed, bigint as a string when asked to.
  function present(table, row) {
    const out = {};
    for (const name of table.columns.keys()) {
      let value = row[name] ?? null;
      const type = table.columns.get(name);
      if (type === "jsonb" && typeof value === "string") value = JSON.parse(value);
      if (type === "bigint" && hub.bigintAsString && value !== null) value = String(value);
      out[name] = value;
    }
    return out;
  }

  function handle(method, url, body) {
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean); // v1 db ...
    if (parts[0] !== "v1" || parts[1] !== "db") return fail(404, "no such route");

    if (method === "GET" && parts[2] === "tables") {
      const data = [...tables.entries()].map(([name, table]) => ({ tableName: name, columns: [...table.columns.entries()].map(([column, type]) => ({ name: column, type })) }));
      return json(200, { data });
    }
    if (method === "POST" && parts[2] === "schema" && parts[3] === "tables" && parts[5] === "columns") {
      const table = tables.get(decodeURIComponent(parts[4]));
      if (!table) return fail(404, `table ${parts[4]} does not exist`);
      // Postgres has no ADD COLUMN IF NOT EXISTS behind this route: a second add fails (the gateway hides it as a 500).
      if (table.columns.has(body.name)) return fail(500, "Internal server error");
      table.columns.set(body.name, body.type);
      return json(201, { data: { success: true } });
    }
    if (method === "POST" && parts[2] === "schema" && parts[3] === "tables") {
      if (tables.has(body.name)) return body.ifNotExists ? json(200, { ok: true }) : fail(409, `relation "${body.name}" already exists`);
      const columns = new Map(body.columns.map((column) => [column.name, column.type]));
      const key = body.columns.find((column) => column.primaryKey)?.name;
      tables.set(body.name, { columns, key, rows: new Map() });
      return json(200, { ok: true });
    }
    if (method === "POST" && parts[2] === "schema" && parts[3] === "indexes") {
      return tables.has(body.table) ? json(200, { ok: true }) : fail(404, `table ${body.table} does not exist`);
    }
    if (method === "DELETE" && parts[2] === "schema" && parts[3] === "tables") {
      tables.delete(decodeURIComponent(parts[4]));
      return json(200, { ok: true });
    }
    if (method === "POST" && parts[2] === "read-batch") {
      if (body.operations.length > 10) return fail(400, "read-batch takes 10 selects");
      const data = body.operations.map((operation) => {
        const table = tables.get(operation.table);
        if (!table) return { error: `table ${operation.table} does not exist` };
        const [column, direction] = operation.query.order.split(".");
        const rows = [...table.rows.values()].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (direction === "desc" ? -1 : 1));
        const limit = Math.min(operation.query.limit ?? 1000, 1000);
        return { data: rows.slice(operation.query.offset ?? 0, (operation.query.offset ?? 0) + limit).map((row) => present(table, row)) };
      });
      return json(200, { data });
    }

    const table = tables.get(decodeURIComponent(parts[2] ?? ""));
    if (!table) return fail(404, `table ${parts[2]} does not exist`);

    if (method === "POST") {
      if (body.rows.length > 1000) return fail(400, "at most 1000 rows");
      for (const row of body.rows) {
        const problem = check(table, row);
        if (problem) return fail(400, problem);
      }
      const ids = body.rows.map((row) => row[table.key]);
      if (ids.some((id, index) => table.rows.has(id) || ids.indexOf(id) !== index)) return fail(409, `duplicate key value violates unique constraint "${table.key}"`);
      for (const row of body.rows) table.rows.set(row[table.key], { ...row });
      return json(200, { data: body.returning === false ? [] : body.rows });
    }
    if (method === "PATCH") {
      const filter = [...url.searchParams.entries()].find(([name]) => name.startsWith("eq."));
      const id = filter?.[1];
      if (filter?.[0].slice(3) !== table.key) return fail(400, "patch by the key only");
      const problem = check(table, body.values);
      if (problem) return fail(400, problem);
      const row = table.rows.get(id);
      if (!row) return json(200, { data: [] });
      Object.assign(row, body.values);
      return json(200, { data: [present(table, row)] });
    }
    return fail(405, "method not allowed");
  }

  hub.fetch = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    hub.requests.push({ method, path: url.pathname + url.search, body });
    if (hub.down) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    if (init.headers?.["x-api-key"] !== secretKey || hub.rejectKey) return fail(401, "invalid api key");
    const injected = hub.queue.shift();
    const early = injected?.({ method, path: url.pathname, body });
    if (early) return early;
    const response = handle(method, url, body);
    if (hub.loseNextResponse && method !== "GET" && !url.pathname.includes("/schema/") && !url.pathname.includes("read-batch")) {
      hub.loseNextResponse = false;
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    }
    return response;
  };

  hub.rows = (name) => [...(tables.get(name)?.rows.values() ?? [])];
  hub.count = (method, fragment) => hub.requests.filter((request) => request.method === method && request.path.includes(fragment)).length;
  hub.respond = (status, message, headers) => hub.queue.push(() => fail(status, message, headers));
  return hub;
}

module.exports = { createFakeAtlasHub };
