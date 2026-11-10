// The decoded melody held as lines (diff.melodyLines, a flag; difficulty.js MELODY_LINES). Normal's selection picks moment by
// moment and never sees the melody as a line: only 6% of the melody's notes sit in a line it plays whole (72 songs), the rest
// lose a note to a louder neighbour inside the gap, to the budget or to a sound too weak for the foreground. So the lines worth
// holding are found over the whole song, and selection.js selectMoments takes their moments first. The listening test of
// 2026-11, where the melody picked the moments alone, lost ("quiet melody notes took the place of loud, full ones and left
// holes"), so a line is held only where its notes are heard and loud, and a moment a clearly louder sound stands next to gives way.
const { beatMsOf } = require("./holds");
const { ONSET_MS, ranks } = require("./melodyPick");
const { gapOf } = require("./selection");
const { nearestIndex } = require("./util");

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const better = (a, b) => a.count > b.count || (a.count === b.count && (a.place > b.place || (a.place === b.place && a.score > b.score)));

// The runs of a melody's note starts, each note within the larger of rule.joinBeats beats and rule.joinMs of the one before,
// that have at least rule.minNotes notes: [[t, ...]].
function linesOf(starts, timing, rule) {
  const lines = [];
  let line = [];
  for (const t of starts) {
    if (line.length > 0 && t - line[line.length - 1] > Math.max(rule.joinBeats * beatMsOf(timing, line[line.length - 1]), rule.joinMs)) {
      lines.push(line);
      line = [];
    }
    line.push(t);
  }
  lines.push(line);
  return lines.filter((l) => l.length >= rule.minNotes);
}

// The moments of a line (indices into `scored`, time-ordered) thinned to the level's step: the subset with every two chosen
// moments at least the gap apart that has the most moments, then the most on strong places of the bar (a beat 3, a half beat
// 2, a quarter beat 1), then the best summed score. A fast run so becomes an even staircase on beats and half beats rather
// than a random subset.
function thinnedLine(indices, scored, gapAt) {
  if (indices.length === 0) return [];
  const best = [];
  for (let k = 0; k < indices.length; k++) {
    const m = scored[indices[k]];
    best[k] = { count: 1, place: 3 - m.metric, score: m.score, prev: -1 };
    for (let j = 0; j < k; j++) {
      const before = scored[indices[j]];
      if (m.t - before.t < Math.max(gapAt(m.t), gapAt(before.t))) continue;
      const found = { count: best[j].count + 1, place: best[j].place + 3 - m.metric, score: best[j].score + m.score, prev: j };
      if (better(found, best[k])) best[k] = found;
    }
  }
  let end = 0;
  for (let k = 1; k < best.length; k++) if (better(best[k], best[end])) end = k;
  const out = [];
  for (let k = end; k >= 0; k = best[k].prev) out.push(indices[k]);
  return out.reverse();
}

// heldLineMoments(scored, melody, timing, diff) -> the Set of times (`t`) of the moments of `scored` (selection.js snappedMoments,
// the whole song, time-ordered) that the melody's held lines play. `melody` is the decoded notes ({ t }). A line is held when
// rule.heard of its notes have a moment (the nearest one whose sound, `raw ?? t`, is within ONSET_MS) and those moments' mean
// rank of strength over the song's moments is at least rule.minLoud. A moment gives way when a moment off every held line lies
// within the level's gap and is rule.louder of a rank louder. What is left of each line is thinned to the level's step. The
// song is read as a whole, so a line runs across a phrase's bound; the phrases take the moments inside them.
function heldLineMoments(scored, melody, timing, diff) {
  const rule = diff.melodyLines;
  if (!rule || !Array.isArray(melody) || scored.length === 0) return new Set();
  const starts = melody.map((n) => n.t).filter(Number.isFinite).sort((a, b) => a - b);
  const lines = linesOf(starts, timing, rule);
  if (lines.length === 0) return new Set();

  const order = scored.map((m, i) => i).sort((a, b) => (scored[a].raw ?? scored[a].t) - (scored[b].raw ?? scored[b].t));
  const sounds = order.map((i) => scored[i].raw ?? scored[i].t);
  const loud = ranks(scored.map((m) => m.s));
  const held = [];
  for (const line of lines) {
    const moments = new Set();
    let heard = 0;
    for (const t of line) {
      const k = nearestIndex(sounds, t);
      if (k < 0 || Math.abs(sounds[k] - t) > ONSET_MS) continue;
      heard++;
      moments.add(order[k]);
    }
    if (heard / line.length >= rule.heard && moments.size > 0 && mean([...moments].map((i) => loud[i])) >= rule.minLoud) held.push([...moments].sort((a, b) => a - b));
  }
  if (held.length === 0) return new Set();

  const onLines = new Set(held.flat());
  const times = scored.map((m) => m.t);
  const gapAt = gapOf(diff, timing);
  const louderNear = (i) => {
    const gap = gapAt(times[i]);
    for (let j = i - 1; j >= 0 && times[i] - times[j] < gap; j--) if (!onLines.has(j) && loud[j] - loud[i] >= rule.louder) return true;
    for (let j = i + 1; j < times.length && times[j] - times[i] < gap; j++) if (!onLines.has(j) && loud[j] - loud[i] >= rule.louder) return true;
    return false;
  };
  const out = new Set();
  for (const indices of held) {
    for (const i of thinnedLine(indices.filter((i) => !louderNear(i)), scored, gapAt)) out.add(times[i]);
  }
  return out;
}

module.exports = { heldLineMoments };
