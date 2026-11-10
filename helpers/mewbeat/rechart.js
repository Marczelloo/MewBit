const Log = require("../logs/log");
const { trackFromAudioKey } = require("./audioKey");

const START_DELAY_MS = 60_000; // lets the stores read their data (AtlasHub hydrates after the boot) before the history is walked
const EMPTY_RETRY_MS = 60_000;
const EMPTY_RETRIES = 5;
const PER_START = 100; // songs charted in one go; the rest waits for the next start
const HISTORY_LIMIT = 5000;

// After a generator version bump the charts of old songs are gone (chartStore sweeps the old versions), so song select shows
// dashes until somebody plays them again. This walks the songs in the play history once per start and charts, as background
// work and one at a time, those whose charts of the current version are missing and whose analysis is still cached. A song
// with no cached analysis is skipped: nothing here asks Lavalink, so no download or render is started (the chart store is
// told there is no node). No timer exists before start(), which the Activity server calls once it has booted; stop() ends the
// walk after the song in progress. Never throws; one line in the log gives the counts.
//
// historyStore.played(...) lists the songs, chartStore.getCharts(track, null, { priority: "background", offline: true }) charts
// one and chartStore.rechartBlock(track) says why a song is skipped.
function createRechart({
  historyStore,
  chartStore,
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

  const songs = () => historyStore.played({ limit: HISTORY_LIMIT }).filter((song) => song.audioKey);

  // One pass over the history. Resolves with the counts.
  async function walk() {
    const counts = { songs: 0, charted: 0, hadCharts: 0, noFeatures: 0, noMelody: 0, other: 0, failed: 0, left: 0 };
    const todo = [];
    for (const song of songs()) {
      counts.songs += 1;
      const track = trackFromAudioKey(song.audioKey);
      const block = track ? chartStore.rechartBlock(track) : "no_key";
      if (block === null) todo.push({ audioKey: song.audioKey, track });
      else if (block === "has_charts") counts.hadCharts += 1;
      else if (block === "no_features") counts.noFeatures += 1;
      else if (block === "no_melody") counts.noMelody += 1;
      else counts.other += 1;
    }
    counts.left = Math.max(0, todo.length - perStart);
    for (const { audioKey, track } of todo.slice(0, perStart)) {
      if (stopped) {
        counts.left += 1;
        continue;
      }
      try {
        const result = await chartStore.getCharts(track, null, { priority: "background", offline: true });
        if (result?.status === "ready") counts.charted += 1;
        else counts.failed += 1;
      } catch (error) {
        counts.failed += 1;
        log.warning("mewbeat re-chart: a song failed", audioKey, error?.message);
      }
    }
    return counts;
  }

  async function run(attempt = 0) {
    if (stopped) return null;
    let counts;
    try {
      counts = await walk();
    } catch (error) {
      log.warning("mewbeat re-chart stopped", error?.message);
      return null;
    }
    // The history may not be read yet; look again a few times before giving up.
    if (counts.songs === 0 && attempt < EMPTY_RETRIES && !stopped) {
      await new Promise((resolve) => {
        timer = setTimer(() => {
          timer = null;
          resolve();
        }, EMPTY_RETRY_MS);
      });
      return run(attempt + 1);
    }
    log.info(
      "mewbeat re-chart",
      `history ${counts.songs}, charted ${counts.charted}, already charted ${counts.hadCharts}, no cached analysis ${counts.noFeatures}, no melody ${counts.noMelody}, other skips ${counts.other}, failed ${counts.failed}, left for the next start ${counts.left}`,
    );
    return counts;
  }

  return {
    // Begins after the delay; calling it again does nothing. Resolves with the counts when the pass is over (null when stopped).
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
        log.warning("mewbeat re-chart stopped", error?.message);
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

module.exports = { createRechart };
