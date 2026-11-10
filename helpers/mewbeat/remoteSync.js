const Log = require("../logs/log");
const { TABLES } = require("./remoteSchema");

const SECOND_MS = 1000;

const defaultSchedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

// The outbox's send(): turns one op into the request of the client.
function senderOf(client) {
  return (request) => (request.kind === "insert"
    ? client.insertRows(request.table, request.rows)
    : client.upsertRow(request.table, TABLES[tableKeyOf(request.table)].key, request.id, request.row));
}

function tableKeyOf(name) {
  const found = Object.keys(TABLES).find((key) => TABLES[key].name === name);
  if (!found) throw new Error(`mewbeat has no table ${name}`);
  return found;
}

// Ties the stores to AtlasHub: gives them the `remote` they write through, and loads them from the database.
//
//   const sync = createRemoteSync({ client, outbox });
//   const store = createScoreStore({ remote: sync.remote });
//   sync.attach({ scores, history, stats });
//   sync.start();
//
// start() never blocks anything: the stores answer from empty memory until the database has been read, and
// what the game writes meanwhile is journaled as deferred store calls. When the read has worked, in one
// synchronous step the stores are hydrated, the journal's rows are put over them (they are newer than the
// database), and the deferred calls are replayed in the order they were made, with the times they had. Then the
// outbox starts sending. A read that fails is retried in the background (5 s doubling to 5 min).
function createRemoteSync({
  client, outbox, log = Log, retryMinMs = 5 * SECOND_MS, retryMaxMs = 5 * 60 * SECOND_MS,
  schedule = defaultSchedule, random = Math.random,
}) {
  let stores = null;
  let ready = false;
  let failures = 0;
  let lastFailure = "";
  let cancelRetry = null;

  const remote = {
    ready: () => ready,
    upsert: (table, id, row) => outbox.upsert(table, id, row),
    insert: (table, id, row) => outbox.insert(table, id, row),
    defer: (store, method, args) => outbox.defer({ store, method, args }),
  };

  function attach(attached) {
    stores = attached;
  }

  async function ensureSchema() {
    for (const table of Object.values(TABLES)) {
      await client.ensureTable({ name: table.name, columns: table.columns });
      for (const index of table.indexes) await client.ensureIndex({ ...index, table: table.name });
    }
    // ensureTable leaves a table that already exists as it is, so a column added to TABLES later is added here:
    // a row naming a column the table lacks would be refused, and the outbox would retry it forever.
    if (!client.listTables) return;
    const existing = new Map((await client.listTables()).map((info) => [info.tableName, new Set((info.columns ?? []).map((column) => column.name))]));
    for (const table of Object.values(TABLES)) {
      const names = existing.get(table.name);
      if (!names) continue;
      for (const column of table.columns) {
        if (!names.has(column.name)) await client.addColumn(table.name, column);
      }
    }
  }

  async function attempt() {
    await ensureSchema();
    const scoreRows = await client.selectAll(TABLES.scores.name);
    const historyRows = await client.selectAll(TABLES.history.name);
    const statsRows = await client.selectAll(TABLES.stats.name, { orderBy: "user_id" });

    // Nothing may run between these lines: a store call here would find half-loaded stores.
    stores.scores.hydrate(scoreRows);
    stores.history.hydrate(historyRows);
    stores.stats.hydrate(statsRows);
    for (const op of outbox.rowOps()) {
      for (const store of Object.values(stores)) store.applyOp(op);
    }
    ready = true;
    for (const op of outbox.deferredOps()) {
      outbox.replay(op.id, (call) => stores[call.store][call.method](...call.args));
    }
    outbox.start();
    stores.scores.finishHydration();
  }

  async function load() {
    try {
      await attempt();
    } catch (error) {
      failures += 1;
      const delay = Math.min(retryMaxMs, retryMinMs * 2 ** (failures - 1) * (1 + random() * 0.25));
      if (error.message !== lastFailure) {
        lastFailure = error.message;
        log.warning(`mewbeat could not load its scores from AtlasHub (${error.message}); scores, history and stats stay empty and new rounds are kept in the journal, retrying in the background`);
      }
      cancelRetry = schedule(() => {
        cancelRetry = null;
        load();
      }, delay);
      return false;
    }
    if (failures > 0) log.success("mewbeat loaded its scores from AtlasHub, the stores are complete again");
    failures = 0;
    return true;
  }

  // Resolves once the first attempt is over (true when the stores are loaded); the retries go on by themselves.
  function start() {
    return load();
  }

  const status = () => ({ ready, failures });

  return { remote, attach, start, status, stop: () => cancelRetry?.() };
}

module.exports = { createRemoteSync, senderOf };
