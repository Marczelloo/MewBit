const FILTER_PRESETS = {
  nightcore: {
    description: "Faster, brighter, and slightly higher pitch",
    filters: { timescale: { speed: 1.18, pitch: 1.08, rate: 1 } },
  },
  vaporwave: {
    description: "Slow, dreamy, and lower-pitched",
    filters: { timescale: { speed: 0.82, pitch: 0.84, rate: 1 } },
  },
  chipmunk: {
    description: "High-pitched meme mode",
    filters: { timescale: { speed: 1.05, pitch: 1.35, rate: 1 } },
  },
  deepvoice: {
    description: "Lower pitch for a darker voice",
    filters: { timescale: { speed: 0.9, pitch: 0.68, rate: 1 } },
  },
  eightd: {
    description: "Slow stereo rotation for an 8D effect",
    filters: { rotation: { rotationHz: 0.18 } },
  },
  karaoke: {
    description: "Reduces center-panned vocals",
    filters: { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } },
  },
  wobble: {
    description: "Adds a playful tremolo wobble",
    filters: { tremolo: { frequency: 6, depth: 0.7 } },
  },
  vibrato: {
    description: "Adds a noticeable vocal vibrato",
    filters: { vibrato: { frequency: 5, depth: 0.55 } },
  },
  robot: {
    description: "Crunchy robotic distortion",
    filters: {
      distortion: {
        sinOffset: 0,
        sinScale: 1,
        cosOffset: 0,
        cosScale: 1,
        tanOffset: 0,
        tanScale: 1,
        offset: 0,
        scale: 0.6,
      },
    },
  },
  telephone: {
    description: "Narrow, filtered telephone sound",
    filters: { lowPass: { smoothing: 20 } },
  },
  mono: {
    description: "Folds stereo into a centered mono mix",
    filters: { channelMix: { leftToLeft: 0.5, leftToRight: 0.5, rightToLeft: 0.5, rightToRight: 0.5 } },
  },
  surround: {
    description: "Gentle rotating surround feel",
    filters: { rotation: { rotationHz: 0.08 } },
  },
  meme: {
    description: "Fast pitch plus wobble for cursed moments",
    filters: {
      timescale: { speed: 1.08, pitch: 1.28, rate: 1 },
      tremolo: { frequency: 8, depth: 0.35 },
    },
  },
};

const FILTER_PRESET_NAMES = Object.freeze(Object.keys(FILTER_PRESETS));

function getFilterPreset(name) {
  const key = String(name || "").toLowerCase();
  // Own keys only: "constructor" or "__proto__" must not resolve to something
  // on Object.prototype.
  return Object.hasOwn(FILTER_PRESETS, key) ? { name: key, ...FILTER_PRESETS[key] } : null;
}

module.exports = {
  FILTER_PRESETS,
  FILTER_PRESET_NAMES,
  getFilterPreset,
};
