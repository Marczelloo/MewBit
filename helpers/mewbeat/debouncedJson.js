const fs = require("node:fs");

const Log = require("../logs/log");
const { backupCorruptFileSync, writeJsonAtomic } = require("../data/atomicJson");

// A JSON document kept in memory by its owner and written back a little after
// the last change, the way the other stores do it. load() tolerates a missing
// file (null) and sets aside an unparseable one so it is never overwritten
// blind.
function createDebouncedJson({ file, debounceMs = 2000, log = Log }) {
  let timer = null;
  let snapshot = () => null;
  // Writes run one after another, so an older snapshot never lands after a newer one.
  let writing = Promise.resolve();

  function load() {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") log.warning("mewbeat could not read", file, error?.message);
      return null;
    }
    try {
      const value = JSON.parse(text);
      return value && typeof value === "object" ? value : null;
    } catch {
      try {
        log.warning(`mewbeat data was corrupt and preserved at ${backupCorruptFileSync(file)}`);
      } catch (error) {
        log.warning("mewbeat could not back up corrupt data", error?.message);
      }
      return null;
    }
  }

  function write() {
    writing = writing.then(async () => {
      try {
        await writeJsonAtomic(file, snapshot());
      } catch (error) {
        log.warning("mewbeat could not save", file, error?.message);
      }
    });
    return writing;
  }

  // `build` returns the value to write; it runs when the write happens.
  function schedule(build) {
    snapshot = build;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, debounceMs);
    timer.unref?.();
  }

  // Also waits for a write already under way (shutdown calls this right before exiting).
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      write();
    }
    await writing;
  }

  return { load, schedule, flush };
}

module.exports = { createDebouncedJson };
