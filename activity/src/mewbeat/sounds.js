// Game sounds: short samples (sfx/CREDITS.md) fetched and decoded once, then replayed through the Web
// Audio API so a press sounds on the key. The AudioContext is created lazily on the first user gesture
// (autoplay policy); the module touches no browser global at load time.
const MAX_GAIN = 0.8; // volume 100
export const DEFAULT_VOLUME = 40; // same default as hitVolume in helpers/mewbeat/userSettings.js

// The gain for a 0-100 volume setting. Squared, so the slider's lower half still has room between
// barely there and quiet (loudness follows the gain's log, not the gain).
export function gainOf(volume) {
  const v = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_VOLUME;
  return MAX_GAIN * (v / 100) ** 2;
}

// urls: { name: url }. A sound that has not loaded yet, or failed to, stays silent: a late hit or tick is
// worse than none, and the game must not depend on its sounds.
export function createSounds({ urls = {}, AudioContextClass, fetchImpl } = {}) {
  const buffers = new Map();
  const waiting = new Map(); // name -> what waits for that sample to load (or fail)
  let ctx = null;
  let loading = false;
  let closed = false;

  function context() {
    if (closed) return null;
    if (ctx) return ctx;
    const Ctor = AudioContextClass === undefined ? globalThis.AudioContext ?? globalThis.webkitAudioContext : AudioContextClass;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function settle(name) {
    for (const resolve of waiting.get(name) ?? []) resolve();
    waiting.delete(name);
  }

  function load(audio) {
    if (loading) return;
    loading = true;
    const get = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!get) return;
    for (const [name, url] of Object.entries(urls)) {
      Promise.resolve()
        .then(() => get(url))
        .then((response) => {
          if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => audio.decodeAudioData(data))
        .then((buffer) => {
          if (!closed) buffers.set(name, buffer);
        })
        .catch(() => {})
        .then(() => settle(name));
    }
  }

  // Call from a keydown or pointerdown inside the game. Loads the samples up front, so the first press
  // does not pay for them.
  function unlock() {
    const audio = context();
    if (!audio) return;
    if (audio.state === "suspended") audio.resume?.()?.catch?.(() => {});
    load(audio);
  }

  // level scales this one sound (1 as it is); rate changes its speed and pitch. Returns what cuts it short, if it plays.
  function play(name, volume = DEFAULT_VOLUME, { level = 1, rate = 1 } = {}) {
    const gainValue = gainOf(volume) * level;
    const audio = ctx; // only a gesture brings one up (see unlock)
    const buffer = buffers.get(name);
    if (gainValue <= 0 || !audio || !buffer) return null;
    if (audio.state === "suspended") audio.resume?.()?.catch?.(() => {});
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(audio.destination);
    source.start();
    return () => {
      try {
        source.stop();
      } catch {}
    };
  }

  // Resolves when the sample has loaded, failed to, or the sounds are closed; the sample load starts with unlock().
  function ready(name) {
    if (buffers.has(name) || closed) return Promise.resolve();
    return new Promise((resolve) => waiting.set(name, [...(waiting.get(name) ?? []), resolve]));
  }

  function close() {
    closed = true;
    for (const name of [...waiting.keys()]) settle(name);
    const audio = ctx;
    ctx = null;
    buffers.clear();
    audio?.close?.()?.catch?.(() => {});
  }

  return { play, unlock, ready, close };
}
