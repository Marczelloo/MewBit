const Log = require("../logs/log");
const { audioKeyOf } = require("./audioKey");

// The two songs of the first-run tour's trap (activity/src/mewbeat/tour/trap.js): a Hell chart that is cut off after a
// few seconds, and a calm Normal song the player then really plays. The bot prepares both by itself, so the tour never
// has to wait for a search, an analysis or an audio render. A query may later be swapped for a link.
const TOUR_SONGS = {
  heavy: { query: "Osu!Music The Big Black The Quick Brown Fox", level: "hell", fromMs: 18_260 },
  calm: { query: "Mikazuki no Spotlight", level: "normal" },
};

const SOURCE = "youtube";
const LAVALINK_RETRY_MS = 30_000; // Lavalink is not connected yet
const FAIL_RETRY_MS = 5 * 60_000; // a song that was not found or could not be charted
const REFRESH_MS = 4 * 3600e3; // keeps the songs registered (soloTracks forgets after 6 h) and their Ogg files fresh
//                               (audioStore.js evicts the oldest by modification time)
const CHART_POLL_MS = 5000;
const CHART_LIMIT_MS = 15 * 60_000;

// What the client shows of a song, when the resolver brought no info of its own.
function infoOf(track) {
  const info = track?.info || {};
  return {
    title: info.title || "Unknown title",
    artist: info.author || "",
    durationMs: Number(info.length) || 0,
    artworkUrl: info.artworkUrl || null,
    uri: info.uri || null,
    source: String(info.sourceName || "").toLowerCase(),
  };
}

// Warms the tour's songs: resolve (once Lavalink is up), register in soloTracks, chart, and render the audio, one song
// at a time. Nothing here throws; a failure is logged and tried again later. start() is called once from where the
// Activity server boots (no timers exist before that), stop() on shutdown. state() is what the tour is told.
//
// resolveTrack, soloTracks, chartStore and warmAudio are the channel's own (activityChannel.js); setTimer must not keep
// the process alive.
function createTourSongs({
  resolveTrack,
  soloTracks,
  chartStore,
  warmAudio = () => {},
  songs = TOUR_SONGS,
  setTimer = (run, ms) => setTimeout(run, ms).unref(),
  clearTimer = clearTimeout,
  log = Log,
}) {
  const names = Object.keys(songs);
  const warm = {}; // name -> { audioKey, entry, info } once the song is resolved, charted and rendered
  const resolved = {}; // name -> the last resolve, kept when a later one fails
  let timer = null;
  let release = null; // ends the wait in progress
  let started = false;
  let stopped = false;
  let running = null;

  const wait = (ms) => new Promise((resolve) => {
    release = resolve;
    timer = setTimer(() => { timer = null; release = null; resolve(); }, ms);
  });

  async function chartOf(entry, name) {
    for (let waited = 0; waited <= CHART_LIMIT_MS; waited += CHART_POLL_MS) {
      if (stopped) throw new Error("stopped");
      const result = await chartStore.getCharts(entry.track, entry.node);
      if (result.status === "ready") return;
      if (result.status !== "pending") throw new Error(`charts ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
      await wait(CHART_POLL_MS);
    }
    throw new Error(`charts of the ${name} song took too long`);
  }

  // One song, from the query to the cached Ogg. Throws; the cycle catches.
  async function warmSong(name) {
    const spec = songs[name];
    let found = null;
    try {
      found = await resolveTrack(null, { uri: spec.query, source: SOURCE });
    } catch (error) {
      if (!resolved[name]) throw error;
      log.warning(`mewbeat tour: could not resolve the ${name} song again, keeping the last one`, error?.message);
    }
    if (found?.track) resolved[name] = found;
    else if (!resolved[name]) throw Object.assign(new Error(`the ${name} song was not found`), { notFound: true });

    const { track, node, info } = resolved[name];
    const audioKey = audioKeyOf(track);
    if (!audioKey) throw new Error(`the ${name} song has no audio key`);
    const entry = { track, node, info: info ?? infoOf(track) };
    soloTracks.put(audioKey, entry);
    await chartOf(entry, name);
    await warmAudio(audioKey, track, node);
    warm[name] = { audioKey, entry, info: entry.info };
  }

  // Every song once. How long until the next try: the refresh when all is warm, else the retry that fits the failure.
  async function cycle() {
    let retryMs = null;
    for (const name of names) {
      if (stopped) return REFRESH_MS;
      try {
        await warmSong(name);
      } catch (error) {
        if (stopped) return REFRESH_MS;
        const lavalink = error?.statusCode === 503;
        if (lavalink) log.info(`mewbeat tour: Lavalink is not ready for the ${name} song yet`, error?.message);
        else log.warning(`mewbeat tour: the ${name} song is not warm`, error?.message);
        retryMs = Math.min(retryMs ?? FAIL_RETRY_MS, lavalink ? LAVALINK_RETRY_MS : FAIL_RETRY_MS);
        if (lavalink) break; // the next one would only meet the same wall
      }
    }
    return retryMs ?? REFRESH_MS;
  }

  async function loop() {
    while (!stopped) {
      const delay = await cycle();
      if (stopped) return;
      await wait(delay);
    }
  }

  return {
    // Begins warming; calling it again does nothing. Resolves when the loop ends (stop() or never in production).
    start() {
      if (started) return running;
      started = true;
      stopped = false;
      running = loop().catch((error) => log.warning("mewbeat tour: warm-up stopped", error?.message));
      return running;
    },
    stop() {
      stopped = true;
      started = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      release?.();
      release = null;
    },
    // { heavy: { audioKey, track, chartReady }, calm: {...} } when every song is warm, else null. A song soloTracks
    // has forgotten in the meantime is put back, so its chart and audio keep being found.
    state() {
      const out = {};
      for (const name of names) {
        const song = warm[name];
        if (!song) return null;
        if (!soloTracks.get(song.audioKey)) soloTracks.put(song.audioKey, song.entry);
        out[name] = { audioKey: song.audioKey, track: song.info, chartReady: true };
      }
      return out;
    },
  };
}

module.exports = { TOUR_SONGS, createTourSongs };
