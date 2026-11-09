const fs = require("node:fs");
const path = require("node:path");

const Log = require("../logs/log");

const BATCH_ROWS = 500;
const COMPACT_BYTES = 1024 * 1024;
const MINUTE_MS = 60 * 1000;
const MAX_SERVER_ERRORS = 5;

const defaultSchedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

const isAuthError = (error) => error?.status === 401 || error?.status === 403;

// A durable queue of writes to a remote database, so the game never waits on the network and no write is
// lost when the network or the process goes down. Three kinds of op sit in it:
//   upsert    the full state of one row; a newer state of the same row replaces the one waiting.
//   insert    a row that is only ever added (a deterministic id makes a resend harmless).
//   deferred  a store call made before the stores were loaded from the remote. Not sent anywhere; it is
//             replayed once the stores are ready, see replay().
//
// The journal is JSONL: { op } adds or replaces an op, { ack } removes one, { swap, ops } removes a deferred
// call and adds the ops its replay made in one line, so a crash never sees one without the other. Every
// enqueue is appended synchronously. A torn last line (the process died mid-write) is ignored on load.
//
// send(op) does the request: { kind: "insert", table, rows } or { kind: "upsert", table, id, row } (answering
// "inserted" when that took two requests, so the bucket can count them). It throws
// an error with `retryable`, `conflict`, `status` and `retryAfterMs` (the AtlasHubError of atlasHub.js).
function createOutbox({
  file, send, now = Date.now, log = Log, requestsPerMinute = 60, schedule = defaultSchedule, random = Math.random,
  kickMs = 1000, backoffMinMs = 2000, backoffMaxMs = 5 * MINUTE_MS, authRetryMs = 5 * MINUTE_MS,
}) {
  const deadFile = file.replace(/(\.jsonl)?$/, ".dead.jsonl");
  const ops = new Map(); // id -> op, oldest first
  const upserts = new Map(); // `${table}|${rowId}` -> the waiting upsert of that row
  let nextId = 1;
  let started = false;
  let pumping = null;
  let cancelTimer = null;
  let armedFor = Infinity;
  let capture = null; // while a deferred call is replayed: the ops it makes, journaled as one swap line

  let failures = 0;
  let successes = 0;
  let degraded = false;
  let backoffUntil = 0;
  let authUntil = 0;
  let authLogged = false;
  let tokenReadyAt = 0;
  let deadCount = 0;
  const refillPerMs = requestsPerMinute / MINUTE_MS;
  let tokens = requestsPerMinute;
  let refilledAt = now();

  let journalBytes = 0;
  let rewrite = null; // { tail: string[], cancelled }: an asynchronous compaction under way
  let rewrites = 0;
  let dirReady = false;

  const keyOf = (op) => `${op.table}|${op.rowId}`;
  const wire = (op) => (op.kind === "deferred"
    ? { id: op.id, kind: op.kind, call: op.call }
    : { id: op.id, kind: op.kind, table: op.table, rowId: op.rowId, row: op.row });
  const lineOf = (value) => `${JSON.stringify(value)}\n`;

  function register(op) {
    const known = ops.get(op.id);
    if (known?.kind === "upsert" && upserts.get(keyOf(known)) === known) upserts.delete(keyOf(known));
    ops.set(op.id, op);
    if (op.kind === "upsert") upserts.set(keyOf(op), op);
    nextId = Math.max(nextId, op.id + 1);
  }

  function forget(op) {
    ops.delete(op.id);
    if (op.kind === "upsert" && upserts.get(keyOf(op)) === op) upserts.delete(keyOf(op));
  }

  function ensureDir() {
    if (dirReady) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    dirReady = true;
  }

  function writeSnapshotSync() {
    const text = [...ops.values()].map((op) => lineOf({ op: wire(op) })).join("");
    ensureDir();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    journalBytes = Buffer.byteLength(text);
  }

  function load() {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") log.warning("mewbeat outbox could not read", file, error?.message);
      return;
    }
    if (!text) return;
    const lines = text.split("\n");
    const torn = !text.endsWith("\n");
    lines.forEach((line, index) => {
      if (!line) return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        if (!torn || index !== lines.length - 1) log.warning("mewbeat outbox skipped a corrupt journal line");
        return;
      }
      const revive = (stored) => {
        // An insert still in the journal may have landed before the process died, so it goes again as a resend.
        if (Number.isInteger(stored?.id) && ["upsert", "insert", "deferred"].includes(stored.kind)) register({ ...stored, version: 0, resend: stored.kind === "insert" });
      };
      if (entry?.op) revive(entry.op);
      else if (Number.isInteger(entry?.ack)) {
        const known = ops.get(entry.ack);
        if (known) forget(known);
      } else if (Number.isInteger(entry?.swap)) {
        const known = ops.get(entry.swap);
        if (known) forget(known);
        for (const stored of entry.ops ?? []) revive(stored);
      }
    });
    // Rewritten right away: this ends a torn line, so the next append starts on a line of its own, and it
    // drops the acked history.
    try {
      writeSnapshotSync();
    } catch (error) {
      log.warning("mewbeat outbox could not compact its journal", error?.message);
    }
  }

  function append(lines) {
    if (lines.length === 0) return;
    const text = lines.map(lineOf).join("");
    try {
      ensureDir();
      fs.appendFileSync(file, text);
    } catch (error) {
      log.error("mewbeat outbox could not journal a write, so it waits in memory only", error?.message);
    }
    journalBytes += Buffer.byteLength(text);
    rewrite?.tail.push(text);
    if (journalBytes > COMPACT_BYTES && !rewrite && ops.size > 0) compact();
  }

  // Rewrites the journal with only the ops still pending, off the main thread. What is appended meanwhile
  // goes to the old file as usual and is added to the new one in the same tick that swaps it in.
  function compact() {
    const state = { tail: [], cancelled: false };
    rewrite = state;
    rewrites += 1;
    const tmp = `${file}.${rewrites}.tmp`;
    const snapshot = [...ops.values()].map((op) => lineOf({ op: wire(op) })).join("");
    fs.promises.writeFile(tmp, snapshot).then(() => {
      if (state.cancelled) return fs.promises.rm(tmp, { force: true });
      try {
        const tail = state.tail.join("");
        if (tail) fs.appendFileSync(tmp, tail);
        fs.renameSync(tmp, file);
        journalBytes = Buffer.byteLength(snapshot) + Buffer.byteLength(tail);
      } catch (error) {
        log.warning("mewbeat outbox could not compact its journal", error?.message);
      }
      if (rewrite === state) rewrite = null;
      return undefined;
    }, (error) => {
      log.warning("mewbeat outbox could not compact its journal", error?.message);
      if (rewrite === state) rewrite = null;
    });
  }

  function truncate() {
    if (rewrite) {
      rewrite.cancelled = true;
      rewrite = null;
    }
    if (journalBytes === 0) return;
    try {
      fs.writeFileSync(file, "");
      journalBytes = 0;
    } catch (error) {
      log.warning("mewbeat outbox could not empty its journal", error?.message);
    }
  }

  function ack(done) {
    for (const op of done) forget(op);
    if (ops.size === 0) truncate();
    else append(done.map((op) => ({ ack: op.id })));
  }

  // A write the hub refuses for good goes aside, so one bad row cannot hold up the rest.
  function bury(op, error) {
    deadCount += 1;
    log.error(`mewbeat outbox set aside a write for ${op.table ?? "the stores"} that the hub refused`, error?.message);
    try {
      ensureDir();
      fs.appendFileSync(deadFile, lineOf({ at: now(), status: error?.status ?? 0, error: error?.message, op: wire(op) }));
    } catch (failure) {
      log.error("mewbeat outbox could not write its dead file", failure?.message);
    }
    ack([op]);
  }

  const hasRowOps = () => [...ops.values()].some((op) => op.kind !== "deferred");
  const pendingRows = () => [...ops.values()].filter((op) => op.kind !== "deferred").length;

  function record(op) {
    if (capture) capture.add(op);
    else append([{ op: wire(op) }]);
  }

  function upsert(table, rowId, row) {
    let op = upserts.get(`${table}|${rowId}`);
    if (op) {
      op.row = row;
      op.version += 1;
    } else {
      op = { id: nextId, kind: "upsert", table, rowId, row, version: 0 };
      register(op);
    }
    record(op);
    reschedule(kickMs);
    return op.id;
  }

  function insert(table, rowId, row) {
    const op = { id: nextId, kind: "insert", table, rowId, row, version: 0 };
    register(op);
    record(op);
    reschedule(kickMs);
    return op.id;
  }

  // Journals a store call that cannot be turned into rows yet.
  function defer(call) {
    const op = { id: nextId, kind: "deferred", call, version: 0 };
    register(op);
    record(op);
    return op.id;
  }

  const rowOps = () => [...ops.values()].filter((op) => op.kind !== "deferred").map(wire);
  const deferredOps = () => [...ops.values()].filter((op) => op.kind === "deferred").map(wire);

  // Runs a deferred call (fn gets its `call`) and swaps it for the ops it enqueued in one journal line, so
  // a crash replays the call or finds its ops, never both. A call that throws is set aside.
  function replay(id, fn) {
    const deferred = ops.get(id);
    if (!deferred || deferred.kind !== "deferred") return false;
    capture = new Set();
    let failure = null;
    try {
      fn(deferred.call);
    } catch (error) {
      failure = error;
    }
    const made = [...capture];
    capture = null;
    forget(deferred);
    append([{ swap: id, ops: made.map(wire) }]);
    if (failure) {
      deadCount += 1;
      log.error("mewbeat outbox could not replay a deferred store call", failure?.message);
      try {
        ensureDir();
        fs.appendFileSync(deadFile, lineOf({ at: now(), error: failure?.message, op: wire(deferred) }));
      } catch (error) {
        log.error("mewbeat outbox could not write its dead file", error?.message);
      }
    }
    if (ops.size === 0) truncate();
    reschedule(kickMs);
    return !failure;
  }

  // A request costs a token; the bucket holds a minute's worth. Returns 0 when it took one, else the wait.
  function takeToken(t) {
    tokens = Math.min(requestsPerMinute, tokens + (t - refilledAt) * refillPerMs);
    refilledAt = t;
    if (tokens >= 1) {
      tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - tokens) / refillPerMs);
  }

  function backOff(error) {
    failures += 1;
    const base = Math.min(backoffMaxMs, backoffMinMs * 2 ** (failures - 1));
    const delay = Math.max(Math.min(backoffMaxMs, base * (1 + random() * 0.25)), error.retryAfterMs ?? 0);
    backoffUntil = now() + delay;
    if (!degraded) {
      degraded = true;
      log.warning(`mewbeat could not reach AtlasHub (${error.message}); ${pendingRows()} writes wait in the journal and are retried`);
    }
  }

  function pauseForAuth(error) {
    authUntil = now() + authRetryMs;
    if (authLogged) return;
    authLogged = true;
    log.error(`mewbeat AtlasHub refused the key (HTTP ${error.status}); nothing is sent, ${pendingRows()} writes stay in the journal and are tried again every ${Math.round(authRetryMs / MINUTE_MS)} min`);
  }

  // The gateway hides a duplicate key behind a plain 500, and a lost answer may mean the row did land, so an
  // insert that failed goes again as an upsert, which cannot collide. A row the hub answers 500 to is moved
  // behind the others; once it has failed repeatedly while other writes get through, the row is the
  // problem and not the hub, and it is set aside.
  function noteFailure(items, error) {
    for (const op of items) if (op.kind === "insert") op.resend = true;
    if (items.length !== 1 || error.status !== 500) return;
    const [op] = items;
    op.serverErrors = (op.serverErrors ?? 0) + 1;
    op.successesAtFirstError ??= successes;
    if (op.serverErrors >= MAX_SERVER_ERRORS && successes > op.successesAtFirstError) {
      bury(op, error);
      return;
    }
    ops.delete(op.id);
    ops.set(op.id, op);
  }

  function recovered() {
    successes += 1;
    failures = 0;
    backoffUntil = 0;
    authUntil = 0;
    authLogged = false;
    if (degraded) {
      degraded = false;
      log.success("mewbeat reached AtlasHub again, the journal is draining");
    }
  }

  function nextBatch() {
    for (const op of ops.values()) {
      if (op.kind === "deferred") continue;
      if (op.kind === "upsert" || op.resend) return { kind: "upsert", table: op.table, items: [op] };
      const items = [];
      for (const other of ops.values()) {
        if (other.kind !== "insert" || other.resend || other.table !== op.table) continue;
        items.push(other);
        if (items.length >= BATCH_ROWS) break;
      }
      return { kind: "insert", table: op.table, items };
    }
    return null;
  }

  // The hub refused a batch (or it holds a row already): one row at a time tells which. A row that exists
  // is done; one the hub refuses for good is set aside.
  async function insertOneByOne(table, items) {
    for (const op of items) {
      const wait = takeToken(now());
      if (wait > 0) {
        tokenReadyAt = now() + wait;
        return false;
      }
      try {
        await send({ kind: "insert", table, rows: [op.row] });
        ack([op]);
        recovered();
      } catch (error) {
        if (error.conflict) {
          ack([op]);
        } else if (isAuthError(error)) {
          pauseForAuth(error);
          return false;
        } else if (error.retryable ?? true) {
          op.resend = true;
          backOff(error);
          return false;
        } else {
          bury(op, error);
        }
      }
    }
    return true;
  }

  // Sends one batch. false: stop for now (a failure that backs off, or the key was refused).
  async function dispatch({ kind, table, items }) {
    const version = items[0].version;
    try {
      if (kind === "upsert") {
        const result = await send({ kind, table, id: items[0].rowId, row: items[0].row });
        // A row that was not there took a second request (the patch found nothing, then the insert): the bucket owes it.
        if (result === "inserted") tokens -= 1;
      } else {
        await send({ kind, table, rows: items.map((op) => op.row) });
      }
    } catch (error) {
      if (isAuthError(error)) {
        pauseForAuth(error);
        return false;
      }
      if (error.retryable ?? true) {
        noteFailure(items, error);
        backOff(error);
        return false;
      }
      if (kind === "insert") {
        if (items.length === 1) {
          if (error.conflict) ack(items);
          else bury(items[0], error);
          return true;
        }
        return insertOneByOne(table, items);
      }
      bury(items[0], error);
      return true;
    }
    recovered();
    // A newer state of the row arrived while this one was in flight: it stays queued.
    if (kind === "upsert" && items[0].version !== version) return true;
    ack(items);
    return true;
  }

  // One pass over what is due. force (shutdown) ignores the waits after a failure. Returns why it stopped:
  // "idle" (nothing left), "blocked" (backing off or the key was refused) or "tokens" (out of requests).
  async function run(force) {
    for (;;) {
      const t = now();
      if (!force && (t < authUntil || t < backoffUntil)) return "blocked";
      const batch = nextBatch();
      if (!batch) return "idle";
      const wait = takeToken(t);
      if (wait > 0) {
        tokenReadyAt = t + wait;
        return "tokens";
      }
      if (!(await dispatch(batch))) return "blocked";
    }
  }

  function arm(delay) {
    const due = now() + delay;
    if (cancelTimer) {
      if (armedFor <= due) return;
      cancelTimer();
    }
    armedFor = due;
    cancelTimer = schedule(() => {
      cancelTimer = null;
      armedFor = Infinity;
      if (!pumping) pump().catch((error) => log.warning("mewbeat outbox pass failed", error?.message));
    }, Math.max(0, delay));
  }

  function reschedule(delay = 0) {
    if (!started || !hasRowOps()) return;
    const t = now();
    arm(Math.max(t + delay, backoffUntil, authUntil, tokenReadyAt) - t);
  }

  function pump({ force = false } = {}) {
    const before = pumping;
    const mine = (async () => {
      if (before) await before.catch(() => {});
      return run(force);
    })();
    pumping = mine;
    const settled = () => {
      if (pumping !== mine) return;
      pumping = null;
      reschedule();
    };
    mine.then(settled, settled);
    return mine;
  }

  // Sends what it can within timeoutMs; the rest stays in the journal for the next start.
  async function flush(timeoutMs = 5000) {
    if (started) {
      let timedOut = false;
      const work = (async () => {
        while (hasRowOps() && !timedOut) {
          const outcome = await pump({ force: true });
          if (outcome === "blocked") break;
          if (outcome === "tokens") await new Promise((resolve) => setTimeout(resolve, Math.max(0, tokenReadyAt - now())));
        }
      })();
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([work, timeout]);
      timedOut = true;
      clearTimeout(timer);
    }
    return { pending: pendingRows(), dead: deadCount };
  }

  // Nothing is sent before this: the stores first load the remote and put the journal's ops over it.
  function start() {
    started = true;
    reschedule(kickMs);
  }

  const status = () => ({ pending: pendingRows(), deferred: deferredOps().length, dead: deadCount, degraded, authRefused: now() < authUntil });

  load();

  return { upsert, insert, defer, replay, rowOps, deferredOps, start, pump, flush, status };
}

module.exports = { createOutbox };
