const path = require("node:path");

const { createHistoryStore } = require("./historyStore");
const { createScoreStore } = require("./scoreStore");
const { createStatsStore } = require("./statsStore");

const DATA_DIR = path.join(__dirname, "..", "data", "mewbeat");

// The persistent score, history and stats stores of the running bot (the files are
// created on the first write).
const scoreStore = createScoreStore({ file: path.join(DATA_DIR, "scores.json") });
const historyStore = createHistoryStore({ file: path.join(DATA_DIR, "history.json") });
const statsStore = createStatsStore({ file: path.join(DATA_DIR, "stats.json") });

function flushMewbeatStores() {
  return Promise.allSettled([scoreStore.flush(), historyStore.flush(), statsStore.flush()]);
}

module.exports = { flushMewbeatStores, historyStore, scoreStore, statsStore };
