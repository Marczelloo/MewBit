// Lines a song's audio up with its chart. The bot decodes a song twice, once to analyse it and once to render the
// Ogg the Activity plays, and the two runs don't always start at the same sample: the audio can sit tens of
// milliseconds from its chart, a different amount per song, which no player offset can fix. The chart knows when the
// sounds should come, so the decoded audio shows how far they really are. Everything here is pure.

const SEARCH_MS = 80;
const MAX_LAG_MS = 60; // the runs differ by a few Opus frames (39 ms was the most measured): further is the wrong beat
const MIN_PEAK = 1.4; // the best lag against the average one: 1.47+ on real songs, up to 1.25 with another song's notes
const MIN_TIMES = 30; // fewer notes than this say little
const RISE_SPAN_MS = 5;
const SMOOTH_RADIUS = 2; // +-2 ms around each millisecond

// Samples in one millisecond; the envelope has one value per millisecond.
export const hopOf = (sampleRate) => Math.round(sampleRate / 1000);

// The energy of each whole millisecond of `left` and `right` (the mix of the two), written into `energy` from
// frame `at` on. A song can arrive in pieces that each start on a millisecond, which fill the same array.
export function energyInto(energy, at, left, right, hop) {
  const frames = hop > 0 ? Math.floor(left.length / hop) : 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    const from = frame * hop;
    for (let i = from; i < from + hop; i += 1) {
      const sample = (left[i] + right[i]) / 2;
      sum += sample * sample;
    }
    energy[at + frame] = sum;
  }
}

// How sharply the sound gets louder at each millisecond: the rise of its log energy over RISE_SPAN_MS.
export function riseEnvelope(channels, sampleRate) {
  const left = channels[0];
  const right = channels[1] ?? left;
  const hop = hopOf(sampleRate);
  const frames = hop > 0 ? Math.floor(left.length / hop) : 0;
  const energy = new Float32Array(frames);
  energyInto(energy, 0, left, right, hop);
  return riseFromEnergy(energy);
}

// The rise of the log energy per millisecond, from the energy of each millisecond.
export function riseFromEnergy(energy) {
  const frames = energy.length;
  const level = new Float32Array(frames);
  const width = SMOOTH_RADIUS * 2 + 1;
  let windowSum = 0;
  for (let i = 0; i < frames; i += 1) {
    windowSum += energy[i];
    if (i >= width) windowSum -= energy[i - width];
    if (i >= width - 1) level[i - SMOOTH_RADIUS] = Math.log10(1e-7 + Math.max(0, windowSum) / width);
  }
  const rise = new Float32Array(frames);
  for (let i = RISE_SPAN_MS + SMOOTH_RADIUS; i < frames - SMOOTH_RADIUS; i += 1) {
    rise[i] = Math.max(0, level[i] - level[i - RISE_SPAN_MS]);
  }
  return rise;
}

// How many ms after its chart the song's sounds come (negative: before it). 0 when the song gives no clear answer.
export function audioLagMs(rise, timesMs) {
  const times = [...new Set(timesMs)];
  if (times.length < MIN_TIMES) return 0;
  const middle = RISE_SPAN_MS / 2; // rise[i] is about the sound halfway through its span
  let best = -Infinity;
  let bestLag = 0;
  let total = 0;
  for (let lag = -SEARCH_MS; lag <= SEARCH_MS; lag += 1) {
    let score = 0;
    for (const t of times) {
      const i = Math.round(t + middle + lag);
      score += (rise[i] ?? 0) + 0.5 * ((rise[i - 1] ?? 0) + (rise[i + 1] ?? 0));
    }
    total += score;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  const average = total / (SEARCH_MS * 2 + 1);
  return average > 0 && best / average >= MIN_PEAK && Math.abs(bestLag) <= MAX_LAG_MS ? bestLag : 0;
}
