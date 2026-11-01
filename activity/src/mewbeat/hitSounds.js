// Hit sounds: an osu!-style "normal" hit, a short drum tok with a bright tick on top, synthesized
// once into an AudioBuffer (no audio files) and replayed on every key press, like osu!mania. The
// AudioContext is created lazily on the first user gesture (autoplay policy); the module touches no
// browser global at load time.
export const HIT_S = 0.09;
const MAX_GAIN = 0.35; // volume 100
export const DEFAULT_VOLUME = 40; // same default as hitVolume in helpers/mewbeat/userSettings.js
const BODY_HZ = 180; // the tok settles here...
const BODY_DROP_HZ = 260; // ...falling from BODY_HZ + this
const TICK_HZ = 2200;

// The hit as mono samples at sampleRate, peak-normalised to 0.9. Deterministic: the noise comes
// from a fixed seed.
export function renderHit(sampleRate) {
  const length = Math.round(HIT_S * sampleRate);
  const samples = new Float32Array(length);
  let seed = 22_222;
  let phase = 0;
  let lastNoise = 0;
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * (BODY_HZ + BODY_DROP_HZ * Math.exp(-t / 0.012))) / sampleRate;
    const body = Math.sin(phase) * Math.exp(-t / 0.035) * 0.55;
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const white = seed / 1_073_741_824 - 1;
    const noise = (white - lastNoise) * Math.exp(-t / 0.01) * 0.35; // differenced: no low rumble
    lastNoise = white;
    const tick = Math.sin(2 * Math.PI * TICK_HZ * t) * Math.exp(-t / 0.006) * 0.3;
    const attack = Math.min(1, t / 0.001);
    samples[i] = (body + noise + tick) * attack;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak > 0) for (let i = 0; i < length; i += 1) samples[i] *= 0.9 / peak;
  return samples;
}

// The gain for a 0-100 volume setting. Squared, so the slider's lower half still has room between
// barely there and quiet (loudness follows the gain's log, not the gain).
export function gainOf(volume) {
  const v = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_VOLUME;
  return MAX_GAIN * (v / 100) ** 2;
}

export function createHitSounds({ AudioContextClass } = {}) {
  let ctx = null;
  let buffer = null;
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

  function hitBuffer(audio) {
    if (buffer) return buffer;
    const samples = renderHit(audio.sampleRate);
    buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  // Call from a keydown or pointerdown inside the game. Renders the hit up front, so the first
  // press does not pay for it.
  function unlock() {
    const audio = context();
    if (!audio) return;
    if (audio.state === "suspended") audio.resume?.()?.catch?.(() => {});
    hitBuffer(audio);
  }

  function play(volume = DEFAULT_VOLUME) {
    const gainValue = gainOf(volume);
    if (gainValue <= 0) return;
    const audio = context();
    if (!audio) return;
    if (audio.state === "suspended") audio.resume?.()?.catch?.(() => {});
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = hitBuffer(audio);
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(audio.destination);
    source.start();
  }

  function close() {
    closed = true;
    const audio = ctx;
    ctx = null;
    buffer = null;
    audio?.close?.()?.catch?.(() => {});
  }

  return { play, unlock, close };
}
