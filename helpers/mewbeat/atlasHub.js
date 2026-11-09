const PAGE_SIZE = 1000;
const PAGES_PER_REQUEST = 10; // read-batch takes ten selects and counts once against the rate limit

// What went wrong with a call, in the terms the outbox decides on. `retryable`: try again later (no answer,
// 408, 425, 429, 5xx); `conflict`: the row already exists; `status` is 0 when nothing answered.
class AtlasHubError extends Error {
  constructor(message, { status = 0, retryable = false, conflict = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = "AtlasHubError";
    this.status = status;
    this.retryable = retryable;
    this.conflict = conflict;
    this.retryAfterMs = retryAfterMs;
  }
}

const DUPLICATE_KEY = /duplicate key|unique constraint|violates unique/i;

// Retry-After is seconds or an HTTP date.
function retryAfterOf(headers) {
  const value = headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

// A thin client for the AtlasHub gateway (a REST API over Postgres). It knows the wire format and nothing
// about mewbeat. The key goes into one header and into no message, log line or error.
function createAtlasHubClient({ url, secretKey, fetchImpl = fetch, timeoutMs = 10000 }) {
  const base = String(url ?? "").replace(/\/+$/, "");
  const headers = { "content-type": "application/json", "x-api-key": secretKey };

  async function request(method, path, body) {
    const where = `${method} ${path.split("?")[0]}`;
    let response;
    let text;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      const reason = timedOut ? "timed out" : error?.cause?.code ?? error?.code ?? error?.message ?? "failed";
      throw new AtlasHubError(`AtlasHub ${where} ${reason}`, { retryable: true });
    }

    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (response.ok) return payload ?? {};

    const { status } = response;
    const detail = typeof payload?.message === "string" ? payload.message : "";
    const conflict = status === 409 || DUPLICATE_KEY.test(detail);
    throw new AtlasHubError(`AtlasHub ${where} answered ${status}${detail ? `: ${detail}` : ""}`, {
      status,
      conflict,
      retryable: !conflict && (status === 408 || status === 425 || status === 429 || status >= 500),
      retryAfterMs: retryAfterOf(response.headers),
    });
  }

  const tablePath = (table) => `/v1/db/${encodeURIComponent(table)}`;

  const ensureTable = ({ name, columns }) => request("POST", "/v1/db/schema/tables", { name, columns, ifNotExists: true });

  const ensureIndex = ({ name, table, columns, unique = false }) => request("POST", "/v1/db/schema/indexes", { name, table, columns, unique, ifNotExists: true });

  const dropTable = (name) => request("DELETE", `/v1/db/schema/tables/${encodeURIComponent(name)}`, { ifExists: true });

  // Every row of a table, ten pages of 1000 per request, in a stable order. A page shorter than 1000 ends it.
  async function selectAll(table, { orderBy = "id" } = {}) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE * PAGES_PER_REQUEST) {
      const operations = Array.from({ length: PAGES_PER_REQUEST }, (_, page) => ({
        table,
        query: { order: `${orderBy}.asc`, limit: PAGE_SIZE, offset: offset + page * PAGE_SIZE },
      }));
      const { data } = await request("POST", "/v1/db/read-batch", { operations });
      if (!Array.isArray(data) || data.length !== operations.length) throw new AtlasHubError("AtlasHub read-batch answered an unexpected shape");
      for (const result of data) {
        const page = Array.isArray(result?.data) ? result.data : [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
      }
    }
  }

  // Atomic: all rows are written or none. A row that exists answers 409.
  const insertRows = (table, rows) => request("POST", tablePath(table), { rows, returning: false });

  // Update by key; when no row matched, insert. The insert can lose a race with another writer (409), and
  // then the update goes again. Returns "updated" or "inserted".
  async function upsertRow(table, keyColumn, id, row) {
    const values = { ...row };
    delete values[keyColumn];
    const update = async () => {
      const result = await request("PATCH", `${tablePath(table)}?eq.${encodeURIComponent(keyColumn)}=${encodeURIComponent(id)}`, { values, returning: true });
      return Array.isArray(result.data) && result.data.length > 0;
    };
    if (await update()) return "updated";
    try {
      await insertRows(table, [{ ...values, [keyColumn]: id }]);
      return "inserted";
    } catch (error) {
      if (!error.conflict) throw error;
    }
    if (await update()) return "updated";
    throw new AtlasHubError(`AtlasHub upsert into ${table} found the row neither to update nor to insert`, { retryable: true });
  }

  return { ensureTable, ensureIndex, dropTable, selectAll, insertRows, upsertRow };
}

module.exports = { AtlasHubError, createAtlasHubClient, PAGE_SIZE, PAGES_PER_REQUEST };
