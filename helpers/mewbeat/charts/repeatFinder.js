// Phrases that repeat by ear. The plugin marks a repeat only when it is sure of it (about one phrase in seven), while
// people play the same rhythm wherever the music comes back, even when it comes back with changes. A phrase counts as
// a repeat of an earlier one of the same length when their onsets on the grid and their harmony beat by beat agree.
const { beatPosition } = require("./grid");

const SLOTS_PER_BEAT = 4;
const PITCH_CLASSES = 12;
const PITCH_WEIGHT = 0.3; // how much of the similarity is harmony, the rest is onsets
// Calibrated on the train songs: from here people play a pair of phrases with a rhythm overlap of at least 0.83, below
// it the overlap falls towards 0.7 and 0.4 for unrelated phrases.
const HEARD_SIMILARITY = 0.6;
const SURE_SIMILARITY = 0.85; // the plugin's own mark; it stands as it is
const LOOK_BACK_PHRASES = 40;
const MIN_BEATS = 8; // a shorter phrase says too little to tell

// v centred and scaled to unit length, or null when flat.
function unit(v) {
  const mean = v.reduce((sum, x) => sum + x, 0) / v.length;
  const centred = v.map((x) => x - mean);
  const norm = Math.sqrt(centred.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? centred.map((x) => x / norm) : null;
}

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

function onsetVector(features, timing, p, firstBeat, beats) {
  const slots = beats * SLOTS_PER_BEAT;
  const out = new Array(slots * features.bands.length).fill(0);
  features.bands.forEach((band, b) => {
    for (const o of band?.onsets ?? []) {
      if (o.t < p.startMs || o.t >= p.endMs) continue;
      const slot = Math.round((beatPosition(timing, o.t) - firstBeat) * SLOTS_PER_BEAT);
      if (slot >= 0 && slot < slots) out[b * slots + slot] += o.s;
    }
  });
  return unit(out);
}

// Which pitch classes bass and lead hold on each beat, each beat centred on its own mean.
function harmonyVector(features, timing, p, firstBeat, beats) {
  const out = new Array(beats * PITCH_CLASSES).fill(0);
  for (const n of [...(features.bass ?? []), ...(features.lead ?? [])]) {
    if (n.t + n.len <= p.startMs || n.t >= p.endMs) continue;
    const start = Math.floor(beatPosition(timing, Math.max(n.t, p.startMs)) - firstBeat);
    const end = Math.ceil(beatPosition(timing, Math.min(n.t + n.len, p.endMs)) - firstBeat);
    const pitchClass = ((Math.round(n.pitch) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
    for (let beat = Math.max(0, start); beat < Math.min(beats, Math.max(start + 1, end)); beat++) {
      out[beat * PITCH_CLASSES + pitchClass] += n.s * (n.conf ?? 1);
    }
  }
  for (let i = 0; i < out.length; i += PITCH_CLASSES) {
    const mean = out.slice(i, i + PITCH_CLASSES).reduce((sum, x) => sum + x, 0) / PITCH_CLASSES;
    for (let k = i; k < i + PITCH_CLASSES; k++) out[k] -= mean;
  }
  return unit(out);
}

function fingerprint(features, timing, p) {
  const firstBeat = beatPosition(timing, p.startMs);
  const beats = Math.max(1, Math.round(beatPosition(timing, p.endMs) - firstBeat));
  return { beats, onsets: onsetVector(features, timing, p, firstBeat, beats), harmony: harmonyVector(features, timing, p, firstBeat, beats) };
}

function similarity(a, b) {
  if (a.beats !== b.beats || !a.onsets || !b.onsets) return null;
  const onsets = dot(a.onsets, b.onsets);
  return a.harmony && b.harmony ? PITCH_WEIGHT * dot(a.harmony, b.harmony) + (1 - PITCH_WEIGHT) * onsets : onsets;
}

// findHeardRepeats(raw, features, timing) -> raw: a phrase the plugin left unmarked gets the earlier phrase of its
// length it sounds most like, marked `heard`, when they are alike enough. Needs a beat grid: a place in the bar is what
// the phrases are compared by.
function findHeardRepeats(raw, features, timing) {
  if (!timing?.snapped || !Array.isArray(features.bands)) return raw;
  const prints = raw.map((p) => fingerprint(features, timing, p));
  return raw.map((p, i) => {
    if (Number.isInteger(p.repeatOf) && p.similarity >= SURE_SIMILARITY) return p;
    if (prints[i].beats < MIN_BEATS) return p;
    let best = null;
    for (let j = Math.max(0, i - LOOK_BACK_PHRASES); j < i; j++) {
      const s = similarity(prints[j], prints[i]);
      if (s !== null && s >= HEARD_SIMILARITY && (best === null || s >= best.s)) best = { j, s };
    }
    return best ? { ...p, repeatOf: best.j, similarity: best.s, lagMs: p.startMs - raw[best.j].startMs, heard: true } : p;
  });
}

module.exports = { findHeardRepeats };
