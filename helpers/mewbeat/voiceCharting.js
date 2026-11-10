const Log = require("../logs/log");
const { audioKeyOf } = require("./audioKey");

const MAX_LENGTH_MS = 10 * 60_000; // a longer track (a mix, a stream recording) is not worth a decode
const SEEN_MAX = 500;

// When the music bot starts a track in a voice channel, that track is charted as background work, so by the time somebody
// opens song select it has stars. It goes through the ordinary path (analysis, melody decode, generation) at background
// priority, so it queues behind anything a player waits for. Streams (no audio key) and tracks over `maxLengthMs` are
// skipped, and a track is queued once however often it is played (a failed one is tried again on its next play).
//
// `events` is the Activity state emitter (helpers/activity/sync.js): the player code announces a started track as
// { guildId, reason: "trackStart" } once the playback state holds it, and readPlayback(guildId) -> { track, node } says what
// plays. start() attaches, stop() detaches; nothing here runs before start().
function createVoiceCharting({ events, readPlayback, chartStore, maxLengthMs = MAX_LENGTH_MS, log = Log }) {
  const seen = new Set(); // audio keys, oldest first
  let attached = false;

  // The charting of the track that just started; resolves with the chart store's answer, or null when nothing was queued.
  async function onChange({ guildId, reason } = {}) {
    if (reason !== "trackStart") return null;
    let playback;
    try {
      playback = readPlayback(guildId);
    } catch (error) {
      log.warning("mewbeat voice charting could not read the playback", error?.message);
      return null;
    }
    const track = playback?.track;
    const audioKey = track ? audioKeyOf(track) : null;
    if (!audioKey) return null; // nothing playing, or a stream
    if (Number(track.info.length) > maxLengthMs) return null;
    if (seen.has(audioKey)) return null;
    seen.add(audioKey);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);

    try {
      const result = await chartStore.getCharts(track, playback.node, { priority: "background" });
      if (result?.status !== "ready" && result?.status !== "uncharted") seen.delete(audioKey);
      return result;
    } catch (error) {
      seen.delete(audioKey);
      log.warning("mewbeat voice charting failed", audioKey, error?.message);
      return null;
    }
  }

  const listener = (change) => {
    onChange(change);
  };

  return {
    onChange,
    start() {
      if (attached) return;
      events.on("change", listener);
      attached = true;
    },
    stop() {
      if (!attached) return;
      events.off("change", listener);
      attached = false;
    },
  };
}

module.exports = { createVoiceCharting };
