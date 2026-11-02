const path = require("node:path");

const { createHistoryStore } = require("./historyStore");
const { createScoreStore } = require("./scoreStore");

const DATA_DIR = path.join(__dirname, "..", "data", "mewbeat");

// The persistent score and history stores of the running bot (the files are
// created on the first write).
const scoreStore = createScoreStore({ file: path.join(DATA_DIR, "scores.json") });
const historyStore = createHistoryStore({ file: path.join(DATA_DIR, "history.json") });

function flushMewbeatStores() {
  return Promise.allSettled([scoreStore.flush(), historyStore.flush()]);
}

module.exports = { flushMewbeatStores, historyStore, scoreStore };
