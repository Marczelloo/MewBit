const fsp = require("node:fs/promises");
const path = require("node:path");

// One JSON line per autoplay selection. Console INFO logs are lost on every
// container restart; this file is what explains an odd transition later.
const DEFAULT_FILE = path.resolve(__dirname, "../../logs/autoplay-decisions.jsonl");
const MAX_FILE_BYTES = 5 * 1024 * 1024;

let writeChain = Promise.resolve();

function getLogFile() {
  return process.env.AUTOPLAY_DECISION_LOG_FILE || DEFAULT_FILE;
}

function isEnabled() {
  if (process.env.AUTOPLAY_DECISION_LOG === "0" || process.env.LOG_TO_FILE === "0") return false;
  // Unit tests run thousands of selections; only a test that points the log
  // at its own file gets one.
  if (process.env.NODE_TEST_CONTEXT && !process.env.AUTOPLAY_DECISION_LOG_FILE) return false;
  return true;
}

async function appendEntry(file, line) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    const stats = await fsp.stat(file);
    if (stats.size + line.length > MAX_FILE_BYTES) await fsp.rename(file, `${file}.1`);
  } catch {
    // No file yet.
  }
  await fsp.appendFile(file, line);
}

/**
 * Queues one decision for the log. Never throws and never delays the pick:
 * writes are serialized so rotation cannot interleave with an append.
 */
function recordAutoplayDecision(entry) {
  if (!isEnabled() || !entry) return writeChain;
  let line;
  try {
    line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  } catch {
    return writeChain;
  }
  const file = getLogFile();
  writeChain = writeChain.then(() => appendEntry(file, line)).catch(() => undefined);
  return writeChain;
}

module.exports = {
  recordAutoplayDecision,
};
