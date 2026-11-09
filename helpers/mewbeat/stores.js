const path = require("node:path");

const Log = require("../logs/log");
const { createAtlasHubClient } = require("./atlasHub");
const { createHistoryStore } = require("./historyStore");
const { createOutbox } = require("./outbox");
const { createRemoteSync, senderOf } = require("./remoteSync");
const { createScoreStore } = require("./scoreStore");
const { createStatsStore } = require("./statsStore");

const DATA_DIR = path.join(__dirname, "..", "data", "mewbeat");
const FLUSH_MS = 5000;

// The persistent score, history and stats stores of the running bot. With ATLASHUB_URL and ATLASHUB_SECRET_KEY
// set they live in AtlasHub: memory answers every read, each change goes through a durable journal
// (atlashub-outbox.jsonl) that is sent in the background, and the stores are loaded from the database after
// startup without holding anything up. Without the keys they stay in JSON files (created on the first write).
const url = process.env.ATLASHUB_URL;
const secretKey = process.env.ATLASHUB_SECRET_KEY;

let scoreStore;
let historyStore;
let statsStore;
let outbox = null;

if (url && secretKey) {
  const client = createAtlasHubClient({ url, secretKey });
  outbox = createOutbox({ file: path.join(DATA_DIR, "atlashub-outbox.jsonl"), send: senderOf(client) });
  const sync = createRemoteSync({ client, outbox });
  scoreStore = createScoreStore({ remote: sync.remote });
  historyStore = createHistoryStore({ remote: sync.remote });
  statsStore = createStatsStore({ remote: sync.remote });
  sync.attach({ scores: scoreStore, history: historyStore, stats: statsStore });
  sync.start();
} else {
  Log.warning("mewbeat: ATLASHUB_URL or ATLASHUB_SECRET_KEY is not set, so scores, history and stats are kept in JSON files on this machine");
  scoreStore = createScoreStore({ file: path.join(DATA_DIR, "scores.json") });
  historyStore = createHistoryStore({ file: path.join(DATA_DIR, "history.json") });
  statsStore = createStatsStore({ file: path.join(DATA_DIR, "stats.json") });
}

function flushMewbeatStores() {
  return Promise.allSettled([scoreStore.flush(), historyStore.flush(), statsStore.flush(), outbox?.flush(FLUSH_MS)]);
}

module.exports = { flushMewbeatStores, historyStore, scoreStore, statsStore };
