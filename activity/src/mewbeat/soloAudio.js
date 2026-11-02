// Solo audio: the Activity decodes the song itself (Ogg Opus from the gateway) and plays it through an
// AudioContext, so the song clock comes from the audio hardware instead of a server anchor. The module
// touches no browser global at load time; the context is created lazily and reused across songs.
import { audioLagMs, riseEnvelope } from "./audioAlign.js";

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

// Clips (the song select preview, the results highlight) loop a stretch of a song, under the music volume.
export const CLIP_WINDOW_S = 30;
const CLIP_FADE_IN_S = 0.6;
const CLIP_FADE_OUT_S = 1.5;
const CLIP_SWAP_FADE_S = 0.25;
const PREVIEW_LEVEL = 0.7;
const HIGHLIGHT_LEVEL = 0.55;
// A song with no known highlight is previewed from here (a share of its length): usually past the intro.
const CLIP_DEFAULT_SHARE = 0.4;
// Downloaded songs kept as bytes, so going back to a song or pressing Play after its preview doesn't fetch it again.
const BYTES_CACHE_SIZE = 4;

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
  let rise = null; // the loaded song's riseEnvelope, made the first time a chart asks
  let lagMs = 0; // the loaded song's sounds come this long after its chart: song time t is buffer time t + lagMs
  // Playback state. source is non-null only while a source node is scheduled or playing.
  let source = null;
  let sourceStartCtx = 0; // context time at which the song position startOffsetMs is (or was) audible
  let startOffsetMs = 0;
  let pausedAtMs = null; // position while paused, null while playing or stopped
  let started = false; // a play() succeeded since the last stop()
  let playSeq = 0; // bumps on every play/pause/stop, so a play() that awaited resume() can tell it was overridden
  const endedListeners = new Set();
  // Clips play beside the game's source and never touch the song clock or the ended listeners.
  let clip = null; // { node, gain } while a clip plays
  let clipSeq = 0; // bumps on every clip request or stop, so an older preview still loading drops out
  const bytes = new Map(); // audioKey -> ArrayBuffer, oldest first
  let previewFetch = null; // { key, promise, controller }

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

  function rememberBytes(audioKey, data) {
    bytes.delete(audioKey);
    bytes.set(audioKey, data);
    if (bytes.size > BYTES_CACHE_SIZE) bytes.delete(bytes.keys().next().value);
    return data;
  }

  async function songBytes(audioKey, signal) {
    if (bytes.has(audioKey)) return bytes.get(audioKey);
    if (previewFetch?.key === audioKey) {
      try {
        return await previewFetch.promise;
      } catch {
        // The preview's download failed: this one tries for itself.
      }
    }
    return rememberBytes(audioKey, await fetchAudio(audioKey, signal));
  }

  async function load(audioKey) {
    if (buffer && loadedKey === audioKey) return { durationMs: durationMs() };
    if (loading && loading.key === audioKey) return loading.promise;
    loadAbort?.abort();
    const controller = new AbortController();
    loadAbort = controller;
    const seq = ++loadSeq;
    const promise = (async () => {
      const data = await songBytes(audioKey, controller.signal);
      // A newer load() or a close() came meanwhile: this result is not wanted, and must not create a context.
      if (seq !== loadSeq) throw new Error("Song load superseded.");
      // Decoding detaches its input, and the bytes stay cached.
      const decoded = await context().decodeAudioData(data.slice(0));
      if (seq !== loadSeq) throw new Error("Song load superseded.");
      stop();
      stopClip({ fadeMs: 0 });
      buffer = decoded;
      loadedKey = audioKey;
      rise = null;
      lagMs = 0;
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

  // Lines the loaded song up with a chart's note times (audioAlign.js), for every play() from here on.
  function align(noteTimesMs) {
    if (!buffer) return 0;
    if (!rise) {
      const channels = [buffer.getChannelData(0)];
      if (buffer.numberOfChannels > 1) channels.push(buffer.getChannelData(1));
      rise = riseEnvelope(channels, buffer.sampleRate);
    }
    lagMs = audioLagMs(rise, noteTimesMs);
    return lagMs;
  }

  // Starts (or restarts) playback at fromMs. With whenPerfMs the song position fromMs becomes audible at
  // that perf time (rooms start together); songTimeAt is negative until then. Rejects when the context
  // cannot run, so a run is never left silent.
  async function play(fromMs = 0, whenPerfMs = null) {
    if (!buffer) throw new Error("No song loaded.");
    const c = context();
    stopClip({ fadeMs: 0 });
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
    // Song time stays the chart's, only the buffer moves by the lag. Sounds that come early wait a moment at the start.
    const position = from + lagMs;
    node.start(startCtx + Math.max(0, -position) / 1000, Math.max(0, position) / 1000);
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

  function dropClip(fadeS = 0) {
    if (!clip) return;
    const { node, gain: clipGain } = clip;
    clip = null;
    const release = () => {
      try { node.disconnect(); } catch { /* already disconnected */ }
      try { clipGain.disconnect(); } catch { /* already disconnected */ }
    };
    node.onended = release;
    try {
      if (fadeS > 0) {
        const at = ctx.currentTime;
        const level = clipGain.gain.value;
        clipGain.gain.cancelScheduledValues(at);
        clipGain.gain.setValueAtTime(level, at);
        clipGain.gain.linearRampToValueAtTime(0, at + fadeS);
        node.stop(at + fadeS);
      } else {
        node.stop();
        release();
      }
    } catch {
      release();
    }
  }

  // Plays clipBuffer from fromS to the end of the song with fades, once.
  function startClip(clipBuffer, fromS, level) {
    dropClip(CLIP_SWAP_FADE_S);
    const c = ctx;
    const lengthS = clipBuffer.duration - fromS;
    if (!(lengthS > 0)) return;
    const clipGain = c.createGain();
    clipGain.connect(gain);
    const node = c.createBufferSource();
    node.buffer = clipBuffer;
    node.connect(clipGain);
    const at = c.currentTime + START_LEAD_S;
    const param = clipGain.gain;
    param.value = 0;
    param.setValueAtTime(0, at);
    param.linearRampToValueAtTime(level, at + Math.min(CLIP_FADE_IN_S, lengthS / 2));
    param.setValueAtTime(level, at + lengthS - Math.min(CLIP_FADE_OUT_S, lengthS / 2));
    param.linearRampToValueAtTime(0, at + lengthS);
    const current = { node, gain: clipGain };
    node.onended = () => {
      if (clip !== current) return;
      clip = null;
      try { node.disconnect(); } catch { /* already disconnected */ }
      try { clipGain.disconnect(); } catch { /* already disconnected */ }
    };
    node.start(at, fromS, lengthS);
    clip = current;
  }

  function clipStartS(fromMs, durationS) {
    const wanted = Number.isFinite(fromMs) && fromMs >= 0 ? fromMs / 1000 : durationS * CLIP_DEFAULT_SHARE;
    // A highlight near the end starts early enough to leave the window to hear.
    return Math.max(0, Math.min(wanted, durationS - CLIP_WINDOW_S));
  }

  // Previews wait in line: a job the server started can't be recalled, and a burst of them would leave no room in
  // its queue for the song the player then picks. A finished download stays cached, so going back to it is instant.
  async function previewBytes(audioKey, seq) {
    for (;;) {
      if (seq !== clipSeq) return null;
      if (bytes.has(audioKey)) return bytes.get(audioKey);
      if (!previewFetch) {
        const controller = new AbortController();
        const entry = { key: audioKey, controller };
        entry.promise = Promise.resolve()
          .then(() => fetchAudio(audioKey, controller.signal))
          .then((data) => rememberBytes(audioKey, data))
          .finally(() => { if (previewFetch === entry) previewFetch = null; });
        previewFetch = entry;
      }
      const waitingFor = previewFetch;
      try {
        await waitingFor.promise;
      } catch (error) {
        if (waitingFor.key === audioKey) throw error;
      }
    }
  }

  // Previews a song without loading it for play: the game's buffer stays as it is, and the decoded preview goes when
  // its clip does. Resolves true once it plays, false when it was replaced, stopped or failed (a preview never reports).
  async function preview(audioKey, { fromMs = null, level = PREVIEW_LEVEL } = {}) {
    const seq = ++clipSeq;
    if (ctx) dropClip(CLIP_SWAP_FADE_S);
    try {
      const data = await previewBytes(audioKey, seq);
      if (seq !== clipSeq) return false;
      const c = context();
      const decoded = await c.decodeAudioData(data.slice(0));
      if (seq !== clipSeq) return false;
      if (c.state !== "running") {
        await c.resume();
        if (seq !== clipSeq || c.state !== "running") return false;
      }
      startClip(decoded, clipStartS(fromMs, decoded.duration), level);
      return true;
    } catch {
      return false;
    }
  }

  // Plays the loaded song on from fromMs (no highlight known: from CLIP_DEFAULT_SHARE of it).
  function highlight(fromMs, { level = HIGHLIGHT_LEVEL } = {}) {
    if (!buffer || !ctx) return false;
    clipSeq += 1;
    if (ctx.state !== "running") Promise.resolve(ctx.resume()).catch(() => {});
    startClip(buffer, clipStartS(fromMs, buffer.duration), level);
    return true;
  }

  function stopClip({ fadeMs = 400 } = {}) {
    clipSeq += 1;
    dropClip(fadeMs / 1000);
  }

  // Releases the context and the decoded song (the Activity's mewbeat screen closed).
  function close() {
    stop();
    stopClip({ fadeMs: 0 });
    previewFetch?.controller.abort();
    previewFetch = null;
    bytes.clear();
    endedListeners.clear();
    buffer = null;
    rise = null;
    lagMs = 0;
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
    align,
    play,
    pause,
    resume,
    stop,
    unlock,
    close,
    setVolume,
    preview,
    highlight,
    stopClip,
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
