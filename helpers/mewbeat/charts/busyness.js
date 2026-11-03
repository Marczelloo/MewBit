const {
  BUSY_MAX_FACTOR,
  BUSY_MEDIAN_RATE,
  BUSY_MIN_FACTOR,
  BUSY_ONSET_STRENGTH,
  SILENCE_ENERGY,
} = require("./difficulty");

// Strong onsets (all bands) per second of non-silent audio; 0 when there is no
// audible audio to measure. The tracker's half-tempo check counts them the same
// way (FeatureExtractor.strongOnsetsPerSecond).
function strongOnsetRate(features) {
  const values = Array.isArray(features?.energy?.values) ? features.energy.values : [];
  const hopMs = features?.energy?.hopMs > 0 ? features.energy.hopMs : 500;
  const audibleSeconds = (values.filter((e) => e >= SILENCE_ENERGY).length * hopMs) / 1000;
  if (!(audibleSeconds > 0)) return 0;
  let strong = 0;
  for (const band of Array.isArray(features?.bands) ? features.bands : []) {
    for (const o of Array.isArray(band?.onsets) ? band.onsets : []) if (o?.s >= BUSY_ONSET_STRENGTH) strong++;
  }
  return strong / audibleSeconds;
}

// How busy the song is relative to a typical one, clamped so a very calm or
// very busy song stays chartable. 1 when it cannot be measured.
function busyFactor(features) {
  const rate = strongOnsetRate(features);
  if (!(rate > 0)) return 1;
  return Math.min(BUSY_MAX_FACTOR, Math.max(BUSY_MIN_FACTOR, rate / BUSY_MEDIAN_RATE));
}

// The difficulty with its density cap scaled by the song's busyness, never above
// the difficulty's absolute ceiling. Charting uses this copy, so maxNps is read
// in one place only.
function effectiveDifficulty(diff, busy) {
  return { ...diff, maxNps: Math.min(diff.maxNpsCeiling ?? Infinity, diff.maxNps * busy) };
}

module.exports = { busyFactor, effectiveDifficulty, strongOnsetRate };
