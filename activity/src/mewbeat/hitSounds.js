// Hit sounds: a short synthesized click per judged note, no audio files. The AudioContext is
// created lazily on the first user gesture (autoplay policy); the module touches no browser
// global at load time.
const PITCH_HZ = { perfect: 1760, great: 1397, good: 1047 };
const PEAK_GAIN = 0.15;
const ATTACK_S = 0.003;
const CLICK_S = 0.035;
const STOP_S = 0.04;

export function createHitSounds({ AudioContextClass } = {}) {
  let ctx = null;
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

  // Call from a keydown or pointerdown inside the game.
  function unlock() {
    const audio = context();
    if (audio && audio.state === "suspended") audio.resume?.()?.catch?.(() => {});
  }

  function play(judgement) {
    const audio = context();
    if (!audio) return;
    if (audio.state === "suspended") audio.resume?.()?.catch?.(() => {});
    const pitch = PITCH_HZ[judgement];
    if (!pitch) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = pitch;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + CLICK_S);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + STOP_S);
  }

  function close() {
    closed = true;
    const audio = ctx;
    ctx = null;
    audio?.close?.()?.catch?.(() => {});
  }

  return { play, unlock, close };
}
