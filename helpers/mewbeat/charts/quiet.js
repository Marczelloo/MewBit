// Where a song plays quietly against its own loud parts, for the extras of the levels built on another (generate.js
// plusNotes, diff.plusCalm). calm.js reads how busy the upper bands are, for the holds; this reads how loud the music is:
// a quiet stretch can be full of soft sounds (a brushed kit, a piano under a voice), and those are what the extras landed on.
const { SILENCE_ENERGY } = require("./difficulty");

const LOUD_SHARE = 0.8; // the song's loud level: this share of its sounding time plays quieter
const SMOOTH_HOPS = 2; // the energy is read over this many hops on each side (2.5 s at the plugin's 500 ms)

// quietLookup(features, rule) -> t => whether the energy round t is under rule.below of the song's loud level; null for a
// song with no energy curve.
function quietLookup(features, rule) {
  const values = features.energy?.values ?? [];
  const hopMs = features.energy?.hopMs > 0 ? features.energy.hopMs : 500;
  const sounding = values.filter((v) => Number.isFinite(v) && v >= SILENCE_ENERGY).sort((a, b) => a - b);
  if (sounding.length === 0) return null;
  const loud = sounding[Math.min(sounding.length - 1, Math.floor(LOUD_SHARE * sounding.length))];
  const smooth = values.map((_, i) => {
    const around = values.slice(Math.max(0, i - SMOOTH_HOPS), i + SMOOTH_HOPS + 1).filter(Number.isFinite);
    return around.length > 0 ? around.reduce((sum, v) => sum + v, 0) / around.length : 0;
  });
  return (t) => smooth[Math.min(smooth.length - 1, Math.max(0, Math.floor(t / hopMs)))] < rule.below * loud;
}

module.exports = { quietLookup };
