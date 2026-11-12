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
// `noise` (localThinSure, default 0): a count of strong onsets that stands for what the signal cannot tell, added to both the
// second and what it is read against, so a second of 0 against 2 is a dip of .47 (noise 2), not of 0.
function localKeep(features, durationMs, { reach, power, floor, knee, noise = 0 }) {
  const strong = strongOnsetsPerSecond(features, durationMs);
  return strong.map((value, i) => {
    const around = Math.max(meanOf(strong.slice(Math.max(0, i - reach), Math.max(1, i - 1))), meanOf(strong.slice(i + 2, i + reach + 1)));
    const relative = noise > 0 ? (value + noise) / (around + noise) : around > 1e-6 ? value / around : 1;
    return relative >= knee ? 1 : Math.max(floor, (relative / knee) ** power);
  });
}

// diff.lightThin (Normal, from v45): per second, the share of its moments a lighter stretch keeps, read from the 500 ms energy. A second
// is lighter when its energy (smoothed over +-`smooth` hops) stays under the loud level of the music around it, taken as the
// `quantile` of the `reach` seconds on each side and from the quieter side (so a stretch with loud music on both sides counts,
// the start of a long light part or a quiet ending does not), and only where that level is loud enough (`minLevel`, the
// normalised energy: Rush E plays fast piano on little energy). Its share is the energy against that level, from `knee` down,
// never under `floor`; 1 everywhere else.
function lightKeep(features, durationMs, { reach, quantile, smooth, minLevel, knee, floor, power }) {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  const keep = new Array(seconds).fill(1);
  const hop = features.energy?.hopMs, values = features.energy?.values;
  if (!hop || !Array.isArray(values) || values.length === 0) return keep;
  const n = values.length;
  const smoothed = values.map((_, i) => meanOf(values.slice(Math.max(0, i - smooth), i + smooth + 1)));
  const side = Math.round((reach * 1000) / hop);
  const at = (list) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]; };
  const perSecond = Math.round(1000 / hop);
  const sums = new Array(seconds).fill(0), levels = new Array(seconds).fill(0), counts = new Array(seconds).fill(0);
  for (let j = side; j + side < n; j++) {
    const level = Math.min(at(smoothed.slice(j - side, j)), at(smoothed.slice(j + 1, j + side + 1)));
    const second = Math.floor((j * hop) / 1000);
    if (second >= seconds) break;
    sums[second] += level > 0 ? smoothed[j] / level : 1;
    levels[second] += level;
    counts[second]++;
  }
  return keep.map((_, s) => {
    if (counts[s] < perSecond) return 1; // a side window is cut by the song's edge
    const relative = sums[s] / counts[s];
    return levels[s] / counts[s] < minLevel || relative >= knee ? 1 : Math.max(floor, (relative / knee) ** power);
  });
}

// The notes without the moments the music gives up: per run of seconds under full keep, off the beat first, then evenly along
// the run. A held moment stays (a slower stretch is where a long note belongs), no stretch opens past MAX_GAP_BEATS, and
// at most `spare` moments go. The moments of `last` (a set of times, or null) go only when no other is left to take.
// `exact` (diff.lightThin; lightKeep's shares, or null): the seconds it holds under 1 give up their own share, round(
// their moments x (1 - keep)) with the rounding carried along the run, taken inside that second (off the beat first, `last`
// after the others, held moments and the gap rule as always); a second that cannot give its share does not hand the rest to the
// seconds around it. The other seconds of a run keep the old way, the run's share spread evenly along it. Spread over the whole
// run the drops land where the off-beat moments are and not where the keep is lowest (AIZO 2:08-2:10, energy .48: 12 of 14
// moments stayed, while 2:10-2:12, energy .72, fell from 11 to 7).
function thinned(notes, keep, timing, spare = Infinity, last = null, exact = null) {
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
    let run = times.slice(i, j);
    const isExact = (t) => exact !== null && (exact[Math.floor(t / 1000)] ?? 1) < 1;
    for (let a = 0, carry = 0; exact !== null && a < run.length && gone.size < spare; ) {
      if (!isExact(run[a])) { a++; carry = 0; continue; }
      const second = Math.floor(run[a] / 1000);
      let b = a;
      while (b < run.length && Math.floor(run[b] / 1000) === second) b++;
      carry += (b - a) * (1 - keepAt(run[a]));
      let left = Math.round(carry);
      carry -= left; // what the second asked for is spent, given or not
      const open = run.slice(a, b).filter((t) => !held.has(t));
      const first = last ? open.filter((t) => !last.has(t)) : open;
      const later = last ? open.filter((t) => last.has(t)) : [];
      for (const group of [first.filter(isOff), first.filter((t) => !isOff(t)), later.filter(isOff), later.filter((t) => !isOff(t))]) {
        if (left <= 0 || gone.size >= spare) break;
        const before = gone.size;
        evenly(group, Math.min(left, group.length));
        for (const t of group) if (gone.size - before < left && gone.size < spare) tryDrop(t, indexOf.get(t)); // the gap rule refused some: any other of the group
        left -= gone.size - before;
      }
      a = b;
    }
    if (exact !== null) run = run.filter((t) => !isExact(t));
    if (run.length === 0) {
      i = j;
      continue;
    }
    const count = Math.round(run.reduce((sum, t) => sum + 1 - keepAt(t), 0));
    const open = run.filter((t) => !held.has(t));
    const first = last ? open.filter((t) => !last.has(t)) : open;
    const later = last ? open.filter((t) => last.has(t)) : [];
    let left = count;
    for (const group of [first.filter(isOff), first.filter((t) => !isOff(t)), later.filter(isOff), later.filter((t) => !isOff(t))]) {
      const take = Math.min(left, group.length);
      evenly(group, take);
      left -= take;
    }
    i = j;
  }
  return gone.size === 0 ? notes : notes.filter((n) => !gone.has(n.t));
}

module.exports = { localKeep, lightKeep, thinned };
