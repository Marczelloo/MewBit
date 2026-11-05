// Where the song changes, and the note that says so. A mapper opens a section on a note, usually a chord. The sections
// are the peaks of a checkerboard novelty over the bars' self-similarity (Foote 2000), measured on what the features
// know of a bar: how loud it is, how busy each band and layer is, and the pitches of its bass and lead.
const { DENSITY_WINDOW_MS, LEAD_IN_MS, SILENCE_ENERGY, SNAPPED_FLOOR_SLACK } = require("./difficulty");
const { beatMsOf } = require("./holds");
const { lowerBound, nearestIndex } = require("./util");

const KERNEL_BARS = 8; // the checkerboard compares the 4 bars before a downbeat with the 4 after it
const MIN_APART_BARS = 4; // sections this near are one change
const PEAK_STD = 0.5; // a peak stands this many standard deviations over the mean novelty
const ENERGY_WEIGHT = 2; // loudness counts this many times over one other feature
const RISE_BARS = 4; // a section's rise compares this many bars after it with as many before it
const SAMPLES_PER_BAR = 8;
const PITCH_CLASSES = 12;
const GAP_SLACK = 0.9; // a gap in beats is met within this much: a bending grid stretches it

function barVectors(features, timing, energy) {
  const downs = timing.downbeats;
  const bars = downs.length - 1;
  const barOf = (t) => (t < downs[0] || t >= downs[bars] ? -1 : Math.min(bars - 1, lowerBound(downs, t + 1) - 1)); // a time need not be whole: t + 1 can pass the last downbeat
  const bands = Array.isArray(features.bands) ? features.bands : [];
  const size = 1 + bands.length + 3 + PITCH_CLASSES;
  const vectors = Array.from({ length: bars }, () => new Array(size).fill(0));
  const loudness = new Array(bars).fill(0);
  for (let b = 0; b < bars; b++) {
    for (let k = 0; k < SAMPLES_PER_BAR; k++) loudness[b] += energy.at(downs[b] + ((downs[b + 1] - downs[b]) * k) / SAMPLES_PER_BAR) / SAMPLES_PER_BAR;
    vectors[b][0] = Math.log1p(loudness[b]);
  }
  bands.forEach((band, i) => {
    for (const o of Array.isArray(band?.onsets) ? band.onsets : []) {
      const b = barOf(o?.t);
      if (b >= 0) vectors[b][1 + i] += Number(o.s) || 0;
    }
  });
  ["drums", "bass", "lead"].forEach((layer, i) => {
    for (const e of Array.isArray(features[layer]) ? features[layer] : []) {
      const b = barOf(e?.t);
      if (b < 0) continue;
      vectors[b][1 + bands.length + i] += Number(e.s) || 0;
      if (layer !== "drums" && Number.isFinite(e.pitch)) {
        const pitchClass = ((Math.round(e.pitch) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
        vectors[b][1 + bands.length + 3 + pitchClass] += Number(e.len) || 0;
      }
    }
  });
  return { vectors, loudness };
}

// Every feature to a mean of 0 and a deviation of 1, every bar to a length of 1.
function normalised(vectors) {
  const size = vectors[0].length;
  const out = vectors.map((v) => [...v]);
  for (let f = 0; f < size; f++) {
    const mean = out.reduce((s, v) => s + v[f], 0) / out.length;
    const std = Math.sqrt(out.reduce((s, v) => s + (v[f] - mean) ** 2, 0) / out.length);
    const weight = f === 0 ? ENERGY_WEIGHT : 1;
    for (const v of out) v[f] = std > 0 ? (weight * (v[f] - mean)) / std : 0;
  }
  return out.map((v) => {
    const length = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / length);
  });
}

function novelty(vectors) {
  const half = KERNEL_BARS >> 1;
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const out = new Array(vectors.length).fill(0);
  for (let i = half; i < vectors.length - half; i++) {
    for (let a = -half; a < half; a++) {
      for (let b = -half; b < half; b++) out[i] += ((a < 0) === (b < 0) ? 1 : -1) * dot(vectors[i + a], vectors[i + b]);
    }
  }
  return out;
}

// sectionStarts(features, timing, energy) -> [{ t, rise }]: the downbeats where the music changes, and how much louder
// the bars after each are than the bars before it. None without a grid, or in a song too short to compare bars.
function sectionStarts(features, timing, energy) {
  const downs = timing?.downbeats ?? [];
  if (!timing?.snapped || downs.length < 2 * KERNEL_BARS + 3) return [];
  const { vectors, loudness } = barVectors(features, timing, energy);
  const scores = novelty(normalised(vectors));
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const std = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length);
  if (std === 0) return []; // nothing changes
  const peaks = [];
  for (let i = 1; i < scores.length - 1; i++) {
    if (scores[i] >= mean + PEAK_STD * std && scores[i] >= scores[i - 1] && scores[i] >= scores[i + 1]) peaks.push(i);
  }
  const kept = [];
  for (const p of peaks.sort((a, b) => scores[b] - scores[a] || a - b)) {
    if (kept.every((q) => Math.abs(p - q) >= MIN_APART_BARS)) kept.push(p);
  }
  const meanOf = (from, to) => {
    const part = loudness.slice(Math.max(0, from), Math.min(loudness.length, to));
    return part.length > 0 ? part.reduce((s, x) => s + x, 0) / part.length : 0;
  };
  return kept
    .sort((a, b) => a - b)
    .map((b) => ({ t: downs[b], rise: meanOf(b, b + RISE_BARS) / Math.max(1e-6, meanOf(b - RISE_BARS, b)) }));
}

// Would `more` notes at `t` break the density cap in a window around it?
function crowded(notes, t, more, diff) {
  const allowed = ((diff.maxNps ?? Infinity) * DENSITY_WINDOW_MS) / 1000;
  const starts = [t, ...notes.filter((n) => n.t <= t && n.t > t - DENSITY_WINDOW_MS).map((n) => n.t)];
  return starts.some((from) => notes.filter((n) => n.t >= from && n.t < from + DENSITY_WINDOW_MS).length + more > allowed);
}

// A section loud enough against the one before opens on a chord (chords.js).
function opensOnChord({ t, rise }, diff, energy) {
  return rise >= (diff.sectionChordRise ?? Infinity) && energy.at(t) >= (diff.sectionChordEnergy ?? 0);
}

// accentSections(notes, sections, diff, timing, energy) -> notes: a section opens on a note. What stands too near that
// moment gives way to it, more so before a chord. Holds are settled afterwards, so one running over the moment lets go
// on it. A new note's lane only holds its place until the moments are laid out (lanes.js).
function accentSections(notes, sections, diff, timing, energy) {
  let out = [...notes];
  const noteGap = diff.minNoteGapMs ?? 0;
  for (const section of sections) {
    const { t } = section;
    if (t < LEAD_IN_MS || energy.at(t) < SILENCE_ENERGY) continue;
    const beat = beatMsOf(timing, t);
    const clear = Math.max(noteGap, (diff.gapBeats ?? 0) * beat * SNAPPED_FLOOR_SLACK, opensOnChord(section, diff, energy) ? (diff.chordGapBeats ?? 0) * beat * GAP_SLACK : 0);
    const near = out.filter((n) => n.t !== t && Math.abs(n.t - t) < clear);
    const at = out.filter((n) => n.t === t);
    let without = near.length > 0 ? out.filter((n) => !near.includes(n)) : out;
    if (at.length === 0 && crowded(without, t, 1, diff)) {
      const nearest = without.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
      without = without.filter((n) => n !== nearest);
    }
    out = at.length === 0 ? [...without, { t, lane: 0 }] : without;
  }
  return out.sort((a, b) => a.t - b.t || a.lane - b.lane);
}

// openWithFirstSound(notes, onsets, diff, timing, energy) -> notes: the song opens on its first strong sound (v33),
// played on the beat beside it. That sound can come a little before the grid's first beat (Hopes And
// Dreams: 117 ms against a beat at 150) and so score as off the beat. diff.firstSound = { strong, nearBeats }: how
// strong the sound must be, and how near the beat. Nothing changes when the chart already plays there or before.
function openWithFirstSound(notes, onsets, diff, timing, energy) {
  const rule = diff.firstSound;
  if (!rule || !timing?.snapped || typeof timing.gridPoints !== "function") return notes;
  const first = onsets.find((o) => o.s >= rule.strong && o.t >= LEAD_IN_MS && energy.at(o.t) >= SILENCE_ENERGY);
  const grid = timing.gridPoints(1);
  if (!first || grid.length === 0) return notes;
  const t = grid[nearestIndex(grid, first.t)];
  const beat = beatMsOf(timing, t);
  if (t < LEAD_IN_MS || Math.abs(t - first.t) > beat * rule.nearBeats) return notes;
  const clear = Math.max(diff.minNoteGapMs ?? 0, (diff.gapBeats ?? 0) * beat * SNAPPED_FLOOR_SLACK);
  if (notes.some((n) => n.t < t + clear)) return notes;
  return [{ t, lane: 0 }, ...notes];
}

module.exports = { accentSections, openWithFirstSound, opensOnChord, sectionStarts };
