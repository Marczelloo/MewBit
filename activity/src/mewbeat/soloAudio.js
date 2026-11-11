// Solo audio: the Activity decodes the song itself (Ogg Opus from the gateway) and plays it through an
// AudioContext, so the song clock comes from the audio hardware instead of a server anchor. The module
// touches no browser global at load time; the context is created lazily and reused across songs.
import { audioLagMs, riseEnvelope } from "./audioAlign.js";
import { loudnessGain, measureSong } from "./loudness.js";

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

// Loudness normalisation (loudness.js): every decoded song is measured once and played through one static gain that
// brings it to the game's target. The songs are rendered hot (peaks above full scale), so the peak limit counts the room
// the music volume's own ceiling leaves, not the file's: MUSIC_MAX_GAIN is 8 dB under full scale.
const HEADROOM_DB = -20 * Math.log10(MUSIC_MAX_GAIN);

export function levelGain(measure) {
  return loudnessGain(measure, { headroomDb: HEADROOM_DB });
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

// fetchAudio(audioKey, signal) -> ArrayBuffer of the whole song.
// fetchClip(audioKey, fromMs, signal) -> { data, clipped, clipStartMs, fromMs }: about CLIP_WINDOW_S of the song from
// fromMs on (the server cuts it), or the whole song with clipped false. Without it a preview downloads the whole song.
export function createSoloAudio({
  fetchAudio,
  fetchClip = null,
  createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
  now = () => performance.now(),
  aligner = null, // alignClient.js: scans the song off the main thread; without it align runs inline
  measure = measureSong, // loudness.js: (channels, sampleRate, { yieldToUi }) -> { lufs, peakDb }
  yieldToUi = null, // awaited between slices of a loudness scan, so a long song does not hold the page up
} = {}) {
  let ctx = null;
  let gain = null;
  let songLevel = null; // the loaded song's loudness gain; a node of its own, so fades and the volume stay as they are
  let songBus = null; // the game's source goes through this, so a clip can fade the song out without stopping its clock
  let songFaded = false;
  let volume = DEFAULT_VOLUME;
  let normalize = true; // the loudness setting; off plays every song as rendered
  // The loudness gain of each decoded buffer ({ gain, db, limitedBy }), kept once measured.
  const levels = new WeakMap();
  let measuring = null; // the loaded song's measurement in flight, which play() waits for
  // Decoded buffer of the last loaded song only (a 4 minute song costs ~85 MB).
  let loadedKey = null;
  let buffer = null;
  let loading = null; // { key, promise }
  let loadSeq = 0;
  let loadAbort = null; // aborts the download of the load in flight (superseded or closed)
  let rise = null; // the loaded song's riseEnvelope, made the first time a chart asks
  let lagMs = 0; // the loaded song's sounds come this long after its chart: song time t is buffer time t + lagMs
  let lagExplicit = false; // lagMs came from setLagMs (a measured per-song offset), not from the scan below
  let alignSeq = 0; // bumps on every background alignment and every new song, so an older answer is dropped
  let aligning = null; // the background alignment in flight, which play() waits for
  // Playback state. source is non-null only while a source node is scheduled or playing.
  let source = null;
  let sourceStartCtx = 0; // context time at which the song position startOffsetMs is (or was) audible
  let startOffsetMs = 0;
  let pausedAtMs = null; // position while paused, null while playing or stopped
  let started = false; // a play() succeeded since the last stop()
  // Tempo of the next play(): 1 unless a solo speed modifier is on. The source keeps the rate it started with.
  let rate = 1;
  let sourceRate = 1;
  let slowing = null; // { atCtx, seconds, fromMs, rate } while a failed run's music winds down
  let playSeq = 0; // bumps on every play/pause/stop, so a play() that awaited resume() can tell it was overridden
  const endedListeners = new Set();
  // Clips play beside the game's source and never touch the song clock or the ended listeners.
  let clip = null; // { node, gain } while a clip plays
  let clipSeq = 0; // bumps on every clip request or stop, so an older preview still loading drops out
  const bytes = new Map(); // audioKey -> ArrayBuffer, oldest first
  let previewFetch = null; // { key, wanted, full, promise, controller }: at most one, a newer pick aborts it
  // The last decoded preview (one song), so picking it again is instant. A cut keeps where it starts in the song.
  let previewBuffer = null; // { key, wanted, clipped, clipStartMs, startMs, buffer }
  let previewError = null; // { key, message } of the last preview that failed, for debugging

  function context() {
    if (ctx) return ctx;
    ctx = createContext();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    songBus = ctx.createGain();
    songBus.gain.value = 1;
    songBus.connect(gain);
    songLevel = ctx.createGain();
    songLevel.gain.value = 1;
    songLevel.connect(songBus);
    return ctx;
  }

  // The loudness gain of a decoded buffer. A song that cannot be measured (or whose scan throws) plays unchanged.
  function levelOf(decoded) {
    const known = levels.get(decoded);
    if (known) return Promise.resolve(known);
    const promise = (async () => {
      try {
        const channels = [decoded.getChannelData(0)];
        if (decoded.numberOfChannels > 1) channels.push(decoded.getChannelData(1));
        return levelGain(await measure(channels, decoded.sampleRate, { yieldToUi }));
      } catch {
        return levelGain(null);
      }
    })().then((level) => {
      levels.set(decoded, level);
      return level;
    });
    return promise;
  }

  // The gain a buffer plays at: 1 with the setting off, or while it is not measured.
  const gainFor = (decoded) => (normalize && decoded ? levels.get(decoded)?.gain ?? 1 : 1);

  function applyLevel() {
    if (songLevel) songLevel.gain.value = gainFor(buffer);
  }

  // Measures the loaded song in the background (nothing with the setting off). play() waits for it, so a song never
  // starts at one level and moves to another.
  function measureLoaded() {
    const decoded = buffer;
    if (!normalize || !decoded || levels.has(decoded) || measuring) return;
    const scan = levelOf(decoded).then(() => {
      if (measuring === scan) measuring = null;
      if (buffer === decoded) applyLevel();
    });
    measuring = scan;
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
    // Only a preview that downloads the whole song is joined; a cut is no use to the game.
    if (previewFetch?.key === audioKey && previewFetch.full) {
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
      // A whole decoded preview would be a second copy of a big buffer; a small cut stays.
      if (previewBuffer && !previewBuffer.clipped) previewBuffer = null;
      rise = null;
      lagMs = 0;
      lagExplicit = false;
      alignSeq += 1;
      aligning = null;
      measuring = null;
      measureLoaded();
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

  // Plays a decoded sample so it is heard at the given perf time, on the same clock as the song and outside the
  // music volume. Returns what cancels it.
  function playSampleAt(sample, whenPerfMs, level = 1) {
    const c = context();
    const sampleGain = c.createGain();
    sampleGain.gain.value = level;
    sampleGain.connect(c.destination);
    const node = c.createBufferSource();
    node.buffer = sample;
    node.connect(sampleGain);
    node.onended = () => sampleGain.disconnect();
    node.start(Math.max(c.currentTime, ctxTimeAt(whenPerfMs)));
    return () => {
      try { node.stop(); } catch { /* already over */ }
    };
  }

  function dropSource() {
    if (!source) return;
    const old = source;
    source = null;
    old.onended = null;
    try { old.stop(); } catch { /* never started or already stopped */ }
    try { old.disconnect(); } catch { /* already disconnected */ }
  }

  // Sets the lag from a measured per-song offset (audioAlignment.js: lag = -offset) instead of scanning the song, and stops a
  // scan still running for it. Applies to every play() from here on, like align(); a later align() drops it again.
  function setLagMs(ms) {
    if (!buffer || !Number.isFinite(ms)) return lagMs;
    alignSeq += 1;
    aligning = null;
    lagMs = ms;
    lagExplicit = true;
    return lagMs;
  }

  // The scan takes over from a measured lag set earlier for this song (the setting went off, or the offset is unknown now).
  function dropExplicitLag() {
    if (!lagExplicit) return;
    lagMs = 0;
    lagExplicit = false;
  }

  // Lines the loaded song up with a chart's note times (audioAlign.js), for every play() from here on.
  function align(noteTimesMs) {
    if (!buffer) return 0;
    dropExplicitLag();
    if (!rise) {
      const channels = [buffer.getChannelData(0)];
      if (buffer.numberOfChannels > 1) channels.push(buffer.getChannelData(1));
      rise = riseEnvelope(channels, buffer.sampleRate);
    }
    lagMs = audioLagMs(rise, noteTimesMs);
    return lagMs;
  }

  // The same, without holding the page up: the scan runs in the aligner's worker. play() waits for it, so the lag is
  // set before the source starts (the count-in is longer than the scan). Resolves when the lag is known.
  function alignInBackground(noteTimesMs) {
    if (!buffer) return Promise.resolve(0);
    dropExplicitLag();
    if (!aligner || rise) return Promise.resolve(align(noteTimesMs));
    const seq = ++alignSeq;
    const songBuffer = buffer;
    const channels = [songBuffer.getChannelData(0)];
    if (songBuffer.numberOfChannels > 1) channels.push(songBuffer.getChannelData(1));
    const job = aligner
      .align({ key: loadedKey, channels, sampleRate: songBuffer.sampleRate, timesMs: noteTimesMs })
      .then((lag) => {
        if (lag !== null && seq === alignSeq && buffer === songBuffer) lagMs = lag;
        return lagMs;
      }, () => lagMs)
      .finally(() => {
        if (aligning === job) aligning = null;
      });
    aligning = job;
    return job;
  }

  // Starts (or restarts) playback at fromMs. With whenPerfMs the song position fromMs becomes audible at
  // that perf time (rooms start together); songTimeAt is negative until then. A negative fromMs is silence
  // before the song, the clock runs through it. Rejects when the context cannot run, so a run is never left silent.
  async function play(fromMs = 0, whenPerfMs = null) {
    if (!buffer) throw new Error("No song loaded.");
    const c = context();
    stopClip({ fadeMs: 0 });
    dropSource();
    const seq = ++playSeq;
    if (aligning || measuring) {
      await Promise.all([aligning, measuring]);
      if (seq !== playSeq) return;
    }
    if (c.state !== "running") {
      await c.resume();
      if (seq !== playSeq) return;
      if (c.state !== "running") throw new Error("Audio is blocked. Click Play to allow sound.");
    }
    applyLevel();
    const from = Math.min(fromMs, durationMs());
    if (songFaded) {
      songFaded = false;
      songBus.gain.cancelScheduledValues(c.currentTime);
      songBus.gain.setValueAtTime(1, c.currentTime);
    }
    const node = c.createBufferSource();
    node.buffer = buffer;
    // The pitch follows the rate (a plain playbackRate, no time-stretching), like the speed mods in other rhythm games.
    if (rate !== 1) node.playbackRate.value = rate;
    node.connect(songLevel);
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
    // The wait is song time, so it takes 1/rate of that on the context clock; the buffer offset is already the song's.
    node.start(startCtx + Math.max(0, -position) / 1000 / rate, Math.max(0, position) / 1000);
    source = node;
    sourceStartCtx = startCtx;
    sourceRate = rate;
    slowing = null;
    startOffsetMs = from;
    pausedAtMs = null;
    started = true;
  }

  // The song position a wind-down has reached after elapsedS: the rate falls linearly to 0, so the position is the
  // area under that ramp.
  function slowedMs(wind, elapsedS) {
    const t = Math.min(Math.max(elapsedS, 0), wind.seconds);
    return wind.fromMs + wind.rate * 1000 * (t - (t * t) / (2 * wind.seconds));
  }

  function songTimeAt(perfMs) {
    if (!started) return null;
    if (pausedAtMs !== null) return pausedAtMs;
    if (slowing) return Math.min(slowedMs(slowing, ctxTimeAt(perfMs) - slowing.atCtx), durationMs());
    const ms = (ctxTimeAt(perfMs) - sourceStartCtx) * 1000 * sourceRate + startOffsetMs;
    return Math.min(ms, durationMs());
  }

  function positionMs() {
    return songTimeAt(now()) ?? 0;
  }

  function pause() {
    playSeq += 1;
    if (!started) return 0;
    if (pausedAtMs === null) {
      pausedAtMs = Math.min(positionMs(), durationMs());
      slowing = null;
      dropSource();
    }
    return pausedAtMs;
  }

  // The tempo of the next play() (1, or a solo speed modifier's); a song already playing keeps its own.
  function setRate(next) {
    rate = Number.isFinite(next) && next > 0 ? next : 1;
  }

  // A lost run's music slows to a stop over `seconds`, the pitch sinking with it. The clock follows the slowing
  // song and then holds where it stopped; the ended listeners hear nothing, since the run is over anyway.
  function slowToStop(seconds = 1) {
    if (!started || pausedAtMs !== null || !source || slowing) return;
    const c = ctx;
    const atCtx = ctxTimeAt(now());
    const wind = { atCtx, seconds, fromMs: positionMs(), rate: sourceRate };
    const node = source;
    node.onended = null;
    const param = node.playbackRate;
    const at = c.currentTime;
    param.cancelScheduledValues(at);
    param.setValueAtTime(sourceRate, at);
    param.linearRampToValueAtTime(0, at + seconds);
    try { node.stop(at + seconds); } catch { /* already over */ }
    slowing = wind;
  }

  function resume() {
    if (!started || pausedAtMs === null) return Promise.resolve();
    return play(pausedAtMs);
  }

  function stop() {
    playSeq += 1;
    dropSource();
    slowing = null;
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

  // Plays clipBuffer from fromS to the end of it (or for maxS at most) with fades, once.
  function startClip(clipBuffer, fromS, baseLevel, maxS = Infinity) {
    dropClip(CLIP_SWAP_FADE_S);
    const level = baseLevel * gainFor(clipBuffer);
    const c = ctx;
    const lengthS = Math.min(clipBuffer.duration - fromS, maxS);
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

  // The download behind a preview: one at a time. A pick of another song (or another stretch) aborts the one in flight,
  // so the newest pick is never held up by an older one; asking for the same thing again joins it. With fetchClip the
  // server sends about CLIP_WINDOW_S around the highlight; `whole` asks for the whole song (a cut that would not decode).
  function previewDownload(audioKey, wanted, whole = false) {
    const full = whole || !fetchClip;
    const marker = full ? "full" : wanted;
    if (previewFetch && previewFetch.key === audioKey && previewFetch.wanted === marker) return previewFetch.promise;
    previewFetch?.controller.abort();
    const controller = new AbortController();
    const entry = { key: audioKey, wanted: marker, full, controller };
    entry.promise = Promise.resolve()
      .then(async () => {
        if (full) return { data: await fetchAudio(audioKey, controller.signal), clipped: false, clipStartMs: 0, fromMs: null };
        const result = await fetchClip(audioKey, wanted, controller.signal);
        return { clipStartMs: 0, fromMs: null, ...result, clipped: Boolean(result.clipped) };
      })
      .then((result) => {
        if (!result.clipped) rememberBytes(audioKey, result.data);
        return result;
      })
      .finally(() => { if (previewFetch === entry) previewFetch = null; });
    entry.promise.catch(() => {});
    previewFetch = entry;
    return entry.promise;
  }

  const wantedOf = (fromMs) => (Number.isFinite(fromMs) && fromMs >= 0 ? Math.round(fromMs) : null);

  // Where in a decoded preview the stretch to hear starts, in seconds.
  function previewStartS(entry, wanted) {
    if (entry.clipped) return Math.max(0, Math.min((entry.startMs - entry.clipStartMs) / 1000, entry.buffer.duration - 1));
    return clipStartS(wanted, entry.buffer.duration);
  }

  function reusablePreview(audioKey, wanted) {
    if (buffer && loadedKey === audioKey) return { key: audioKey, clipped: false, buffer };
    if (previewBuffer && previewBuffer.key === audioKey && (!previewBuffer.clipped || previewBuffer.wanted === wanted)) return previewBuffer;
    return null;
  }

  async function decodePreview(c, audioKey, wanted, seq) {
    let fetched;
    if (bytes.has(audioKey)) fetched = { data: bytes.get(audioKey), clipped: false, clipStartMs: 0, fromMs: null };
    else fetched = await previewDownload(audioKey, wanted);
    if (seq !== clipSeq) return null;
    let decoded;
    try {
      decoded = await c.decodeAudioData(fetched.data.slice(0));
    } catch (error) {
      if (!fetched.clipped) throw error;
      // A cut that will not decode: the whole song still can.
      if (seq !== clipSeq) return null;
      fetched = await previewDownload(audioKey, wanted, true);
      if (seq !== clipSeq) return null;
      decoded = await c.decodeAudioData(fetched.data.slice(0));
    }
    if (seq !== clipSeq) return null;
    const entry = {
      key: audioKey,
      wanted,
      clipped: fetched.clipped,
      clipStartMs: fetched.clipStartMs,
      startMs: fetched.fromMs ?? wanted ?? 0,
      buffer: decoded,
    };
    previewBuffer = entry;
    return entry;
  }

  // Previews a song without loading it for play: the game's buffer stays as it is, and the clip plays CLIP_WINDOW_S
  // from the highlight. Resolves true once it plays, false when it was replaced or stopped, and { error } when it
  // failed (the reason is also kept for previewError()).
  async function preview(audioKey, { fromMs = null, level = PREVIEW_LEVEL } = {}) {
    const seq = ++clipSeq;
    if (ctx) dropClip(CLIP_SWAP_FADE_S);
    // The newest pick owns the download; one for another song (or stretch) is of no use any more.
    const wanted = wantedOf(fromMs);
    if (previewFetch && (previewFetch.key !== audioKey || (!previewFetch.full && previewFetch.wanted !== wanted))) {
      previewFetch.controller.abort();
      previewFetch = null;
    }
    try {
      const c = context();
      const entry = reusablePreview(audioKey, wanted) ?? (await decodePreview(c, audioKey, wanted, seq));
      if (!entry || seq !== clipSeq) return false;
      // A cut is measured on its own (about CLIP_WINDOW_S), so the preview is as loud as the game will be.
      if (normalize) {
        await levelOf(entry.buffer);
        if (seq !== clipSeq) return false;
      }
      if (c.state !== "running") {
        await c.resume();
        if (seq !== clipSeq || c.state !== "running") return false;
      }
      previewError = null;
      startClip(entry.buffer, previewStartS(entry, wanted), level, CLIP_WINDOW_S);
      return true;
    } catch (error) {
      if (seq !== clipSeq) return false;
      const message = String(error?.message || error || "Preview failed.");
      previewError = { key: audioKey, message };
      globalThis.console?.debug?.("[mewbeat] preview failed", audioKey, message);
      return { error: message };
    }
  }

  // Silences a song still playing (its outro under the results). The source runs on unheard, so the clock and the
  // ended listeners behave as if nothing happened; the next play() brings the level back.
  function fadeSong(seconds) {
    if (!source || songFaded) return;
    songFaded = true;
    const at = ctx.currentTime;
    const param = songBus.gain;
    param.cancelScheduledValues(at);
    param.setValueAtTime(1, at);
    param.linearRampToValueAtTime(0, at + seconds);
  }

  // Plays the loaded song on from fromMs (no highlight known: from CLIP_DEFAULT_SHARE of it), crossfading over
  // whatever is left of the song itself.
  function highlight(fromMs, { level = HIGHLIGHT_LEVEL } = {}) {
    if (!buffer || !ctx) return false;
    clipSeq += 1;
    if (ctx.state !== "running") Promise.resolve(ctx.resume()).catch(() => {});
    fadeSong(CLIP_FADE_IN_S);
    startClip(buffer, clipStartS(fromMs, buffer.duration), level);
    return true;
  }

  function stopClip({ fadeMs = 400 } = {}) {
    clipSeq += 1;
    previewFetch?.controller.abort();
    previewFetch = null;
    dropClip(fadeMs / 1000);
  }

  // Releases the context and the decoded song (the Activity's mewbeat screen closed).
  function close() {
    stop();
    stopClip({ fadeMs: 0 });
    previewFetch?.controller.abort();
    previewFetch = null;
    previewBuffer = null;
    bytes.clear();
    endedListeners.clear();
    buffer = null;
    measuring = null;
    rise = null;
    lagMs = 0;
    lagExplicit = false;
    alignSeq += 1;
    aligning = null;
    aligner?.close?.();
    loadedKey = null;
    loadSeq += 1;
    loadAbort?.abort();
    loadAbort = null;
    const old = ctx;
    ctx = null;
    gain = null;
    songBus = null;
    songLevel = null;
    songFaded = false;
    try { old?.close?.(); } catch { /* already closed */ }
  }

  function setVolume(next) {
    volume = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : DEFAULT_VOLUME;
    if (gain) gain.gain.value = volume;
  }

  // The loudness setting: on brings every song to the same level, off plays it as rendered. A song already playing
  // changes level at once (nothing is retimed); a song not yet measured is measured now.
  function setNormalize(next) {
    normalize = next !== false;
    measureLoaded();
    applyLevel();
  }

  return {
    load,
    align,
    alignInBackground,
    setLagMs,
    play,
    pause,
    resume,
    stop,
    setRate,
    slowToStop,
    rate: () => rate,
    unlock,
    close,
    setVolume,
    setNormalize,
    // The loudness gain applied to the loaded song ({ gain, db, limitedBy }), or null while unmeasured or switched off.
    songLevel: () => (normalize && buffer ? levels.get(buffer) ?? null : null),
    preview,
    previewError: () => previewError,
    // Whether preview() would start without downloading anything (a decoded cut, the game's song or kept bytes).
    hasPreview: (audioKey, fromMs = null) => Boolean(reusablePreview(audioKey, wantedOf(fromMs)) || bytes.has(audioKey)),
    highlight,
    stopClip,
    playSampleAt,
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
