// Loudness of a decoded song and the one static gain that brings it to the game's target. The songs come from
// different masters (and the plugin renders them as they are), so one can be 10 dB quieter than the next; the Activity
// measures each decoded song once and plays it through a fixed gain, never a compressor. Measuring follows ITU-R
// BS.1770-4: K-weighting, 400 ms blocks every 100 ms, a -70 LUFS absolute gate and a -10 LU relative gate. Everything
// here is pure and touches no browser global.

export const BLOCK_S = 0.4;
export const STEP_S = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const LUFS_OFFSET = -0.691;

// What every song is brought to (integrated, in LUFS), and how far a gain may go either way. The stored songs are
// rendered hot (median -7.8 LUFS, 40 files from -28 to -3.4), so the target is that median: a typical song stays as
// loud as it was and the music volume setting keeps its feel. The limits sit well outside the usual spread (-14 to -3.4);
// only a far-off file reaches them.
export const TARGET_LUFS = -8;
export const MAX_BOOST_DB = 15;
export const MAX_CUT_DB = 12;
// The gain stops where the song's true peak, after the gain and at the top of the music volume slider, reaches this.
export const PEAK_CEILING_DB = -1;

// The BS.1770 K-weighting filters (a high shelf, then a high-pass) for any sample rate; at 48 kHz they give the
// coefficients the standard publishes.
export function kWeighting(sampleRate) {
  const shelfF = 1681.974450955533;
  const shelfG = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * shelfF) / sampleRate);
  const vh = 10 ** (shelfG / 20);
  const vb = vh ** 0.4996667741545416;
  const a01 = 1 + k1 / shelfQ + k1 * k1;
  const shelf = {
    b0: (vh + (vb * k1) / shelfQ + k1 * k1) / a01,
    b1: (2 * (k1 * k1 - vh)) / a01,
    b2: (vh - (vb * k1) / shelfQ + k1 * k1) / a01,
    a1: (2 * (k1 * k1 - 1)) / a01,
    a2: (1 - k1 / shelfQ + k1 * k1) / a01,
  };
  const highF = 38.13547087602444;
  const highQ = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * highF) / sampleRate);
  const a02 = 1 + k2 / highQ + k2 * k2;
  const high = { b0: 1, b1: -2, b2: 1, a1: (2 * (k2 * k2 - 1)) / a02, a2: (1 - k2 / highQ + k2 * k2) / a02 };
  return { shelf, high };
}

// A meter takes a song in any number of pieces (add) and answers with its integrated loudness (result). Only the
// first two channels count, each at weight 1; a mono song is one channel.
export function createLoudnessMeter(sampleRate, channelCount = 2) {
  const channels = Math.max(1, Math.min(2, Math.floor(channelCount) || 1));
  const { shelf, high } = kWeighting(sampleRate);
  const sub = Math.max(1, Math.round(sampleRate * STEP_S)); // samples in one 100 ms step
  const perBlock = Math.max(1, Math.round(BLOCK_S / STEP_S));
  // Filter states per channel: two stages, two delays each.
  const state = Array.from({ length: channels }, () => new Float64Array(4));
  const stepSums = []; // summed squares of the K-weighted samples of every whole step, over the channels
  let stepSum = 0;
  let stepFill = 0;

  // Adds samples [from, to) of each channel (`parts` holds one array per channel).
  function add(parts, from = 0, to = parts[0].length) {
    const sums = new Float64Array(channels);
    let at = from;
    while (at < to) {
      const run = Math.min(to - at, sub - stepFill);
      for (let c = 0; c < channels; c += 1) {
        const x = parts[Math.min(c, parts.length - 1)];
        const s = state[c];
        let s1a = s[0];
        let s1b = s[1];
        let s2a = s[2];
        let s2b = s[3];
        let acc = 0;
        for (let i = at; i < at + run; i += 1) {
          const v = x[i];
          const y1 = shelf.b0 * v + s1a;
          s1a = shelf.b1 * v - shelf.a1 * y1 + s1b;
          s1b = shelf.b2 * v - shelf.a2 * y1;
          const y2 = high.b0 * y1 + s2a;
          s2a = high.b1 * y1 - high.a1 * y2 + s2b;
          s2b = high.b2 * y1 - high.a2 * y2;
          acc += y2 * y2;
        }
        s[0] = s1a;
        s[1] = s1b;
        s[2] = s2a;
        s[3] = s2b;
        sums[c] = acc;
      }
      for (let c = 0; c < channels; c += 1) stepSum += sums[c];
      stepFill += run;
      at += run;
      if (stepFill === sub) {
        stepSums.push(stepSum);
        stepSum = 0;
        stepFill = 0;
      }
    }
  }

  // The gated integrated loudness in LUFS, or null when no block rose above the absolute gate (silence, or less than
  // one block of song).
  function result() {
    const blocks = [];
    for (let i = 0; i + perBlock <= stepSums.length; i += 1) {
      let total = 0;
      for (let j = 0; j < perBlock; j += 1) total += stepSums[i + j];
      blocks.push(total / (perBlock * sub));
    }
    const lufsOf = (meanSquare) => LUFS_OFFSET + 10 * Math.log10(Math.max(meanSquare, 1e-12));
    const audible = blocks.filter((ms) => lufsOf(ms) > ABSOLUTE_GATE_LUFS);
    if (!audible.length) return null;
    const relativeGate = lufsOf(audible.reduce((a, b) => a + b, 0) / audible.length) + RELATIVE_GATE_LU;
    const kept = audible.filter((ms) => lufsOf(ms) > relativeGate);
    if (!kept.length) return null;
    return lufsOf(kept.reduce((a, b) => a + b, 0) / kept.length);
  }

  return { add, result };
}

// 2x oversampling by a 16-tap Hann-windowed sinc, for the peaks between samples: the midpoints. That finds a peak
// between samples to within about 0.7 dB, which is plenty for a ceiling that keeps 1 dB in hand, at a third of the work
// of 4x (the peak pass is the larger part of a song's measurement).
const OVERSAMPLE = 2;
const HALF_TAPS = 8;
const PHASES = (() => {
  const phases = [];
  for (let p = 1; p < OVERSAMPLE; p += 1) {
    const frac = p / OVERSAMPLE;
    const taps = new Float64Array(HALF_TAPS * 2);
    for (let t = 0; t < HALF_TAPS * 2; t += 1) {
      const x = t - (HALF_TAPS - 1) - frac; // distance from the interpolated point, in samples
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / HALF_TAPS);
      taps[t] = sinc * window;
    }
    phases.push(taps);
  }
  return phases;
})();

// The largest |sample| of the channels in [from, to), at least `peak`.
function samplePeakOf(channels, from, to, peak = 0) {
  let best = peak;
  for (const x of channels) {
    const end = Math.min(to, x.length);
    for (let i = from; i < end; i += 1) {
      const a = x[i] < 0 ? -x[i] : x[i];
      if (a > best) best = a;
    }
  }
  return best;
}

// The true peak over [from, to), at least `peak`: oversampling wherever two neighbouring samples are within 6 dB of
// `samplePeak` (the only places a peak between samples can top it).
function truePeakOf(channels, samplePeak, from, to, peak) {
  let best = peak;
  const floor = samplePeak / 2;
  if (!(floor > 0)) return best;
  for (const x of channels) {
    const end = Math.min(to, x.length - HALF_TAPS);
    for (let i = Math.max(from, HALF_TAPS - 1); i < end; i += 1) {
      const a = x[i] < 0 ? -x[i] : x[i];
      const b = x[i + 1] < 0 ? -x[i + 1] : x[i + 1];
      if (a < floor && b < floor) continue;
      for (const taps of PHASES) {
        let v = 0;
        for (let t = 0; t < HALF_TAPS * 2; t += 1) v += taps[t] * x[i - (HALF_TAPS - 1) + t];
        if (v < 0) v = -v;
        if (v > best) best = v;
      }
    }
  }
  return best;
}

// The largest |sample| of the channels, and an estimate of the true peak (see truePeakOf).
export function measurePeaks(channels) {
  const length = channels[0]?.length ?? 0;
  const samplePeak = samplePeakOf(channels, 0, length);
  return { samplePeak, truePeak: truePeakOf(channels, samplePeak, 0, length, samplePeak) };
}

const dbOf = (linear) => 20 * Math.log10(Math.max(linear, 1e-9));

// Measures a decoded song (`channels`: one Float32Array per channel): { lufs, peakDb } with lufs null for a silent one.
// It reads `sliceSeconds` of song at a time and awaits `yieldToUi()` between slices (a few ms of work each, in the
// loudness pass and again in the peak pass), so a long song does not hold the page up; without a yield it runs straight
// through.
export async function measureSong(channels, sampleRate, { sliceSeconds = 2, yieldToUi = null } = {}) {
  const meter = createLoudnessMeter(sampleRate, channels.length);
  const length = channels[0]?.length ?? 0;
  const slice = Math.max(1, Math.round(sliceSeconds * sampleRate));
  for (let at = 0; at < length; at += slice) {
    meter.add(channels, at, Math.min(length, at + slice));
    if (yieldToUi && at + slice < length) await yieldToUi();
  }
  let samplePeak = 0;
  for (let at = 0; at < length; at += slice) {
    samplePeak = samplePeakOf(channels, at, Math.min(length, at + slice), samplePeak);
  }
  let truePeak = samplePeak;
  for (let at = 0; at < length; at += slice) {
    if (yieldToUi) await yieldToUi();
    truePeak = truePeakOf(channels, samplePeak, at, Math.min(length, at + slice), truePeak);
  }
  return { lufs: meter.result(), peakDb: dbOf(truePeak), samplePeakDb: dbOf(samplePeak) };
}

// The static gain for a measured song. gainDb steers the song's integrated loudness to targetLufs, within
// [-maxCutDb, +maxBoostDb], and a boost stops where peakDb + gain + headroomDb (the room the playback chain leaves
// under full scale for the loudest music volume) reaches ceilingDb. An unmeasurable song (no loudness) gets no change.
export function loudnessGain(measure, {
  targetLufs = TARGET_LUFS,
  maxBoostDb = MAX_BOOST_DB,
  maxCutDb = MAX_CUT_DB,
  ceilingDb = PEAK_CEILING_DB,
  headroomDb = 0,
} = {}) {
  const lufs = measure?.lufs;
  if (!Number.isFinite(lufs)) return { gain: 1, db: 0, limitedBy: "unmeasured" };
  let db = targetLufs - lufs;
  let limitedBy = null;
  if (db > maxBoostDb) {
    db = maxBoostDb;
    limitedBy = "boost";
  } else if (db < -maxCutDb) {
    db = -maxCutDb;
    limitedBy = "cut";
  }
  if (Number.isFinite(measure.peakDb) && db > 0) {
    const room = ceilingDb - measure.peakDb + headroomDb;
    if (db > room) {
      db = Math.max(0, room);
      limitedBy = "peak";
    }
  }
  return { gain: 10 ** (db / 20), db, limitedBy };
}
