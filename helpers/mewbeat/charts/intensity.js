// Section intensity: how much happens in a phrase against the song's typical phrase, so the note density jumps where
// the music does. The energy curve says how loud a passage is, not how busy: a loud sustained chorus and a loud
// drum break get the same cap from it. A phrase's activity is the rate of the music's sounds (layer events and strong
// band onsets); its intensity is a gentle power of that rate over the song's time-weighted geometric mean, so the song
// as a whole keeps its density and a busy section gets more notes than a calm one. The fall speed stays constant.
const { SILENCE_ENERGY } = require("./difficulty");

const INTENSITY_EXPONENT = 0.6; // multiplier = (phrase activity / typical activity) ^ this
const INTENSITY_MIN = 0.6;
const INTENSITY_MAX = 1.3;
const LAYER_MIN_STRENGTH = 0.3; // a layer event at/above this strength counts as a sound
const BAND_MIN_STRENGTH = 0.5; // a band onset at/above this strength counts as a sound
const MIN_PHRASE_MS = 2000; // a shorter phrase is too short to measure and keeps intensity 1

// Sorted times of the music's sounds.
function soundTimes(features) {
  const times = [];
  for (const layer of ["drums", "bass", "lead"]) {
    for (const e of Array.isArray(features[layer]) ? features[layer] : []) {
      if (Number.isFinite(e?.t) && (e.s ?? 1) >= LAYER_MIN_STRENGTH) times.push(e.t);
    }
  }
  for (const band of Array.isArray(features.bands) ? features.bands : []) {
    for (const o of Array.isArray(band?.onsets) ? band.onsets : []) if (Number.isFinite(o?.t) && o.s >= BAND_MIN_STRENGTH) times.push(o.t);
  }
  return times.sort((a, b) => a - b);
}

// sectionIntensity(features, phrases) -> number per phrase (1 where it cannot be measured).
function sectionIntensity(features, phrases) {
  const times = soundTimes(features);
  const rates = phrases.map((p) => {
    const ms = p.endMs - p.startMs;
    if (ms < MIN_PHRASE_MS || !(Number(p.energy) >= SILENCE_ENERGY)) return null;
    let n = 0;
    for (const t of times) if (t >= p.startMs && t < p.endMs) n++;
    return (n * 1000) / ms;
  });
  const measured = phrases.map((p, i) => ({ ms: p.endMs - p.startMs, rate: rates[i] })).filter((m) => m.rate > 0);
  if (measured.length < 2) return phrases.map(() => 1);
  const span = measured.reduce((s, m) => s + m.ms, 0);
  const typical = Math.exp(measured.reduce((s, m) => s + m.ms * Math.log(m.rate), 0) / span);
  return rates.map((rate) => {
    if (rate === null) return 1;
    const x = (Math.max(rate, 1e-9) / typical) ** INTENSITY_EXPONENT;
    return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, x));
  });
}

// The energy lookup with `intensity(t)`: the intensity of the phrase at t (1 outside every phrase). The density caps
// (difficultyFilter.js, bandPath.js) scale a window's power by it.
function withIntensity(energy, features, phrases) {
  const values = sectionIntensity(features, phrases);
  return {
    ...energy,
    intensity(t) {
      for (let i = 0; i < phrases.length; i++) if (t >= phrases[i].startMs && t < phrases[i].endMs) return values[i];
      return 1;
    },
  };
}

module.exports = { INTENSITY_EXPONENT, INTENSITY_MAX, INTENSITY_MIN, sectionIntensity, withIntensity };
