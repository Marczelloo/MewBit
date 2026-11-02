// Solo audio: the Activity decodes the song itself (Ogg Opus from the gateway) and plays it through an
// AudioContext, so the song clock comes from the audio hardware instead of a server anchor. The module
// touches no browser global at load time; the context is created lazily and reused across songs.

const DEFAULT_VOLUME = 0.8;
// An immediate start is scheduled this far ahead: the audio thread picks a start up at its next render quantum,
// a few to ~20 ms after currentTime, so scheduling at currentTime would bias the clock by that unknown amount.
export const START_LEAD_S = 0.05;
// The rendered songs are mastered loud and a linear slider bunches all the audible change near 0, so the music
// volume setting (0-100) maps on a square curve under a ceiling: 100 is about -8 dB, 50 about -20 dB, 5 near silent.
export const MUSIC_MAX_GAIN = 0.4;

export function musicGain(percent) {
  const share = Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : 0.8;
  return MUSIC_MAX_GAIN * share * share;
}

export function createSoloAudio({
  fetchAudio,
  createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
  now = () => performance.now(),
} = {}) {
  let ctx = null;
  let gain = null;
  let volume = DEFAULT_VOLUME;
  // Decoded buffer of the last loaded song only (a 4 minute song costs ~85 MB).
  let loadedKey = null;
  let buffer = null;
  let loading = null; // { key, promise }
  let loadSeq = 0;
  let loadAbort = null; // aborts the download of the load in flight (superseded or closed)
  // Playback state. source is non-null only while a source node is scheduled or playing.
  let source = null;
  let sourceStartCtx = 0; // context time at which the song position startOffsetMs is (or was) audible
  let startOffsetMs = 0;
  let pausedAtMs = null; // position while paused, null while playing or stopped
  let started = false; // a play() succeeded since the last stop()
  let playSeq = 0; // bumps on every play/pause/stop, so a play() that awaited resume() can tell it was overridden
  const endedListeners = new Set();

  function context() {
    if (ctx) return ctx;
    ctx = createContext();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    return ctx;
  }

  // Creates the context and starts resuming it. Call it straight from a user gesture (the Play click),
  // so a later play() from a timer is not blocked by the autoplay policy.
  function unlock() {
    const c = context();
    if (c.state === "suspended") return Promise.resolve(c.resume()).catch(() => {});
    return Promise.resolve();
  }

  function durationMs() {
    return buffer ? Math.round(buffer.duration * 1000) : 0;
  }

  async function load(audioKey) {
    if (buffer && loadedKey === audioKey) return { durationMs: durationMs() };
    if (loading && loading.key === audioKey) return loading.promise;
    loadAbort?.abort();
    const controller = new AbortController();
    loadAbort = controller;
    const seq = ++loadSeq;
    const promise = (async () => {
      const data = await fetchAudio(audioKey, controller.signal);
      // A newer load() or a close() came meanwhile: this result is not wanted, and must not create a context.
      if (seq !== loadSeq) throw new Error("Song load superseded.");
      const decoded = await context().decodeAudioData(data);
      if (seq !== loadSeq) throw new Error("Song load superseded.");
      stop();
      buffer = decoded;
      loadedKey = audioKey;
      return { durationMs: durationMs() };
    })();
    loading = { key: audioKey, promise };
    try {
      return await promise;
    } finally {
      if (loading && loading.promise === promise) loading = null;
      if (loadAbort === controller) loadAbort = null;
    }
  }

  // Context time that is audible at the given perf time. getOutputTimestamp() pairs a context time with
  // the perf time it reaches the speakers (output latency included); without it the latency is estimated.
  function ctxTimeAt(perfMs) {
    const c = ctx;
    if (typeof c.getOutputTimestamp === "function") {
      const stamp = c.getOutputTimestamp();
      // Some browsers answer zeros until audio has actually been output.
      if (stamp && Number.isFinite(stamp.performanceTime) && stamp.performanceTime > 0) {
        return stamp.contextTime + (perfMs - stamp.performanceTime) / 1000;
      }
    }
    const heard = c.currentTime - (c.outputLatency || 0) - (c.baseLatency || 0);
    return heard + (perfMs - now()) / 1000;
  }

  function dropSource() {
    if (!source) return;
    const old = source;
    source = null;
    old.onended = null;
    try { old.stop(); } catch { /* never started or already stopped */ }
    try { old.disconnect(); } catch { /* already disconnected */ }
  }

  // Starts (or restarts) playback at fromMs. With whenPerfMs the song position fromMs becomes audible at
  // that perf time (rooms start together); songTimeAt is negative until then. Rejects when the context
  // cannot run, so a run is never left silent.
  async function play(fromMs = 0, whenPerfMs = null) {
    if (!buffer) throw new Error("No song loaded.");
    const c = context();
    dropSource();
    const seq = ++playSeq;
    if (c.state !== "running") {
      await c.resume();
      if (seq !== playSeq) return;
      if (c.state !== "running") throw new Error("Audio is blocked. Click Play to allow sound.");
    }
    const from = Math.min(Math.max(0, fromMs), durationMs());
    const node = c.createBufferSource();
    node.buffer = buffer;
    node.connect(gain);
    // Scheduled starts keep their context time; an immediate start gets a small lead (START_LEAD_S), so the
    // context time the clock assumes is the one the audio thread really starts at.
    const startCtx = whenPerfMs === null ? c.currentTime + START_LEAD_S : Math.max(c.currentTime, ctxTimeAt(whenPerfMs));
    node.onended = () => {
      if (source !== node) return;
      source = null;
      pausedAtMs = durationMs();
      for (const fn of [...endedListeners]) fn();
    };
    node.start(startCtx, from / 1000);
    source = node;
    sourceStartCtx = startCtx;
    startOffsetMs = from;
    pausedAtMs = null;
    started = true;
  }

  function songTimeAt(perfMs) {
    if (!started) return null;
    if (pausedAtMs !== null) return pausedAtMs;
    const ms = (ctxTimeAt(perfMs) - sourceStartCtx) * 1000 + startOffsetMs;
    return Math.min(ms, durationMs());
  }

  function positionMs() {
    return songTimeAt(now()) ?? 0;
  }

  function pause() {
    playSeq += 1;
    if (!started) return 0;
    if (pausedAtMs === null) {
      pausedAtMs = Math.min(Math.max(0, positionMs()), durationMs());
      dropSource();
    }
    return pausedAtMs;
  }

  function resume() {
    if (!started || pausedAtMs === null) return Promise.resolve();
    return play(pausedAtMs);
  }

  function stop() {
    playSeq += 1;
    dropSource();
    started = false;
    pausedAtMs = null;
    startOffsetMs = 0;
  }

  // Releases the context and the decoded song (the Activity's mewbeat screen closed).
  function close() {
    stop();
    endedListeners.clear();
    buffer = null;
    loadedKey = null;
    loadSeq += 1;
    loadAbort?.abort();
    loadAbort = null;
    const old = ctx;
    ctx = null;
    gain = null;
    try { old?.close?.(); } catch { /* already closed */ }
  }

  function setVolume(next) {
    volume = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : DEFAULT_VOLUME;
    if (gain) gain.gain.value = volume;
  }

  return {
    load,
    play,
    pause,
    resume,
    stop,
    unlock,
    close,
    setVolume,
    songTimeAt,
    positionMs,
    playing: () => started && pausedAtMs === null,
    ctx: context,
    durationMs,
    loadedKey: () => loadedKey,
    onEnded: (fn) => {
      endedListeners.add(fn);
      return () => endedListeners.delete(fn);
    },
  };
}
