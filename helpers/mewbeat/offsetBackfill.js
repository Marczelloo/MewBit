const Log = require("../logs/log");

const START_DELAY_MS = 90_000; // after the re-chart's 60 s: the stores have read their data and the first charts are done
const PER_START = 100;

// Measures the audio offset (audioOffset.js) of every stored audio file that has features and no valid record, once per start, as
// background work and one song at a time, behind any player's own measurement. It walks the audio files on disk (the audio store
// keeps the last 40), so a song that was rendered while no decoder service was there is picked up once there is one. A service
// that is not configured does nothing at all (no timer fires a request); a service that is down ends the pass at its first
// answer. Never throws; one line in the log gives the counts. Same shape as rechart.js: start() once the Activity server has
// booted, stop() ends the pass after the song in progress.
function createOffsetBackfill({
  audioOffset,
  perStart = PER_START,
  startDelayMs = START_DELAY_MS,
  setTimer = (run, ms) => setTimeout(run, ms).unref(),
  clearTimer = clearTimeout,
  log = Log,
}) {
  let timer = null;
  let started = false;
  let stopped = false;
  let running = null;

  async function walk() {
    const counts = { songs: 0, present: 0, measured: 0, unknown: 0, noFeatures: 0, failed: 0, left: 0, stoppedEarly: false };
    const stems = await audioOffset.stemsOnDisk();
    counts.songs = stems.length;
    for (const [index, stem] of stems.entries()) {
      if (stopped) {
        counts.left = stems.length - index;
        break;
      }
      if (index >= perStart) {
        counts.left = stems.length - index;
        break;
      }
      const result = await audioOffset.ensureStem(stem, { priority: "background" });
      if (result.status === "off") {
        counts.stoppedEarly = true;
        counts.left = stems.length - index;
        break;
      }
      if (result.status === "present") counts.present += 1;
      else if (result.status === "measured") counts.measured += 1;
      else if (result.status === "no_features" || result.status === "no_audio") counts.noFeatures += 1;
      else counts.failed += 1;
      if ((result.status === "present" || result.status === "measured") && result.offsetMs === null) counts.unknown += 1;
    }
    return counts;
  }

  async function run() {
    if (stopped || !audioOffset.configured()) return null;
    let counts;
    try {
      counts = await walk();
    } catch (error) {
      log.warning("mewbeat audio-offset backfill stopped", error?.message);
      return null;
    }
    log.info(
      "mewbeat audio-offset backfill",
      `audio files ${counts.songs}, already measured ${counts.present}, measured now ${counts.measured}, offset unknown ${counts.unknown}, no features ${counts.noFeatures}, failed ${counts.failed}, left ${counts.left}${counts.stoppedEarly ? " (the decoder service is not answering)" : ""}`,
    );
    return counts;
  }

  return {
    // Begins after the delay; calling it again does nothing. Resolves with the counts when the pass is over (null when stopped
    // or when no service is configured).
    start() {
      if (started) return running;
      started = true;
      stopped = false;
      running = new Promise((resolve) => {
        timer = setTimer(() => {
          timer = null;
          resolve(run());
        }, startDelayMs);
      }).catch((error) => {
        log.warning("mewbeat audio-offset backfill stopped", error?.message);
        return null;
      });
      return running;
    },
    stop() {
      stopped = true;
      started = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}

module.exports = { createOffsetBackfill };
