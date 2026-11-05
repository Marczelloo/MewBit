// Density that follows the music inside a phrase. A phrase's budget (selection.js) answers for all of it, so a few slower
// seconds in the middle play as many notes as the seconds around them. Measured on the train songs: the strong onsets of the
// high band drop where human maps drop, and thinning there brings our dips from .94/.82/.89 of the music around them to
// .88/.77/.80 (humans .69/.65/.68), where the same signal shifted by 37 s leaves them as they were.

const { beatMsOf } = require("./holds");
const { nearestIndex } = require("./util");

const STRONG_ONSET = 0.5;
const OFF_BEAT_MS = 40; // a moment farther than this from a beat is what goes first
const MAX_GAP_BEATS = 2; // no thinning opens a longer stretch than this between two notes (selection.js SILENT_GAP_BEATS)

const meanOf = (list) => (list.length ? list.reduce((sum, x) => sum + x, 0) / list.length : 0);

// The strong high onsets per second, each over the seconds around it.
function strongOnsetsPerSecond(features, durationMs) {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  const counts = new Array(seconds).fill(0);
  const high = features.bands?.find((band) => band?.name === "high")?.onsets;
  for (const onset of Array.isArray(high) ? high : []) {
    const second = Math.floor(onset.t / 1000);
    if (onset.s >= STRONG_ONSET && second >= 0 && second < seconds) counts[second]++;
  }
  return counts.map((_, i) => meanOf(counts.slice(Math.max(0, i - 1), i + 2)));
}

// Per second, the share of its moments the level keeps: 1 where the music plays as much as on the fuller side of the `reach`
// seconds around it, falling with what it plays less, never under `floor`.
function localKeep(features, durationMs, { reach, power, floor, knee }) {
  const strong = strongOnsetsPerSecond(features, durationMs);
  return strong.map((value, i) => {
    const around = Math.max(meanOf(strong.slice(Math.max(0, i - reach), Math.max(1, i - 1))), meanOf(strong.slice(i + 2, i + reach + 1)));
    const relative = around > 1e-6 ? value / around : 1;
    return relative >= knee ? 1 : Math.max(floor, (relative / knee) ** power);
  });
}

// The notes without the moments the music gives up: per run of seconds under full keep, off the beat first, then evenly along
// the run. A held moment stays (a slower stretch is where a long note belongs), no stretch opens past MAX_GAP_BEATS, and
// at most `spare` moments go.
function thinned(notes, keep, timing, spare = Infinity) {
  const times = [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);
  const held = new Set(notes.filter((n) => n.len > 0).map((n) => n.t));
  const beats = timing.beats ?? [];
  const isOff = (t) => beats.length > 0 && Math.abs(beats[nearestIndex(beats, t)] - t) > OFF_BEAT_MS;
  const keepAt = (t) => keep[Math.floor(t / 1000)] ?? 1;
  const gone = new Set();
  const tryDrop = (t, index) => {
    let prev = index - 1;
    while (prev >= 0 && gone.has(times[prev])) prev--;
    let next = index + 1;
    while (next < times.length && gone.has(times[next])) next++;
    if (prev < 0 || next >= times.length) return; // the phrase's edges stay, so a seam opens nothing
    if (times[next] - times[prev] <= MAX_GAP_BEATS * beatMsOf(timing, times[prev])) gone.add(t);
  };
  const indexOf = new Map(times.map((t, i) => [t, i]));
  const evenly = (list, count) => {
    for (let q = 0; q < count && gone.size < spare; q++) {
      const t = list[Math.floor(((q + 0.5) * list.length) / count)];
      tryDrop(t, indexOf.get(t));
    }
  };
  for (let i = 0; i < times.length && gone.size < spare; ) {
    if (keepAt(times[i]) >= 1) {
      i++;
      continue;
    }
    let j = i;
    while (j < times.length && keepAt(times[j]) < 1) j++;
    const run = times.slice(i, j);
    const count = Math.round(run.reduce((sum, t) => sum + 1 - keepAt(t), 0));
    const open = run.filter((t) => !held.has(t));
    const off = open.filter(isOff);
    const on = open.filter((t) => !isOff(t));
    const fromOff = Math.min(count, off.length);
    evenly(off, fromOff);
    evenly(on, Math.min(count - fromOff, on.length));
    i = j;
  }
  return gone.size === 0 ? notes : notes.filter((n) => !gone.has(n.t));
}

module.exports = { localKeep, thinned };
