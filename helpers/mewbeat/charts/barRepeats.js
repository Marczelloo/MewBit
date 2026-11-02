// Inside a phrase, a bar whose rhythm is close to one of the bars just before it is charted like that bar, so a
// groove repeats as one pattern (A A or A B A B) instead of being charted afresh every bar.
// Hard keeps its own moments and takes the earlier bar's lanes (repeatBarLanes); Easy and Normal, thinned from Hard,
// take the earlier bar's selection, moved onto the moments Hard plays (repeatBars).
const { beatMsOf } = require("./holds");
const { lowerBound } = require("./util");

const BAR_SIMILARITY = 0.65; // share of 1/4-beat slots two bars have in common (of both bars' slots together)
const SLOTS_PER_BEAT = 4;
const LOOKBACK = [2, 1]; // two bars back first: a two-bar groove (call and answer) repeats as one
const BAR_LENGTH_TOLERANCE = 0.05; // bars this much apart in length are no repeat (a tempo change)

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const outer = (lane) => lane === 0 || lane === 3; // kicks and low notes sit outside, snares and high notes inside

// The bars from the downbeats that start in [fromMs, toMs). A note up to 1/8 beat before a downbeat belongs to the
// bar it starts (it is early, not late).
function barsOf(timing, fromMs, toMs) {
  const downbeats = timing?.downbeats ?? [];
  const bars = [];
  for (let i = lowerBound(downbeats, fromMs); i + 1 < downbeats.length && downbeats[i] < toMs; i++) {
    const start = downbeats[i];
    const beat = beatMsOf(timing, start);
    bars.push({ start, end: downbeats[i + 1], from: start - beat / 8, to: downbeats[i + 1] - beat / 8, beat });
  }
  return bars;
}

const inBar = (list, bar) => list.filter((n) => n.t >= bar.from && n.t < bar.to);
const slotsOf = (notes, bar) => new Set(notes.map((n) => Math.round(((n.t - bar.start) / bar.beat) * SLOTS_PER_BEAT)));
const sameLength = (a, b) => Math.abs((a.end - a.start) - (b.end - b.start)) <= BAR_LENGTH_TOLERANCE * (b.end - b.start);

function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

// Runs `chart(own, sourcePlayed, lag, bar)` for every bar that repeats an earlier one of [fromMs, toMs), on the
// bars as already played; other bars keep their notes. Bars are compared on `guide`'s moments.
function eachBar(notes, guide, timing, fromMs, toMs, chart) {
  const bars = barsOf(timing, fromMs, toMs);
  if (bars.length < 2) return [...notes].sort(byTime);
  const slots = bars.map((bar) => slotsOf(inBar(guide, bar), bar));
  const played = [];
  for (let b = 0; b < bars.length; b++) {
    const own = inBar(notes, bars[b]);
    const s = LOOKBACK.map((k) => b - k).find((s) => s >= 0 && sameLength(bars[b], bars[s]) && similarity(slots[b], slots[s]) >= BAR_SIMILARITY);
    played.push(s === undefined ? own : chart(own, played[s], bars[b].start - bars[s].start, bars[b]).sort(byTime));
  }
  const first = bars[0].from;
  const last = bars[bars.length - 1].to;
  return [...notes.filter((n) => n.t < first || n.t >= last), ...played.flat()].sort(byTime);
}

// The time in sorted `times` nearest to `want` within 1/8 beat, or undefined.
function nearest(times, want, reach) {
  const i = lowerBound(times, want - reach);
  const candidates = [times[i], times[i + 1]].filter((t) => t !== undefined && Math.abs(t - want) <= reach);
  return candidates.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
}

// One moment's notes on the given lanes as far as they go: each note takes the unused lane nearest its own; a note
// left over keeps its lane, or the nearest free one.
function takeLanes(mine, lanes) {
  const used = new Set();
  const nearestOf = (lane, pool) => pool.filter((l) => !used.has(l)).sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane) || a - b)[0];
  return mine.map((n) => {
    const lane = nearestOf(n.lane, lanes) ?? nearestOf(n.lane, [0, 1, 2, 3]);
    used.add(lane);
    return { ...n, lane };
  });
}

// repeatBarLanes(notes, timing, { fromMs, toMs, fixed }) -> notes (time-ordered)
// Hard: a repeating bar keeps its own moments; at a moment its source bar also plays, its notes take the source's
// lanes (as many as there are, see takeLanes). A moment with a `fixed` note (a drum hit: kicks outside, snares inside)
// needs as many notes, outer and inner, as the source and maps outer to outer, inner to inner. Lengths stay the bar's.
function repeatBarLanes(notes, timing, { fromMs, toMs, fixed = () => false }) {
  return eachBar(notes, notes, timing, fromMs, toMs, (own, source, lag, bar) => {
    const sourceTimes = [...new Set(source.map((n) => n.t))].sort((a, b) => a - b);
    const split = (list) => [list.filter((n) => outer(n.lane)), list.filter((n) => !outer(n.lane))].map((l) => [...l].sort(byTime));
    const out = [];
    for (const t of [...new Set(own.map((n) => n.t))]) {
      const mine = own.filter((n) => n.t === t).sort(byTime);
      const at = nearest(sourceTimes, t - lag, bar.beat / 8);
      const theirs = at === undefined ? [] : source.filter((n) => n.t === at).sort(byTime);
      if (theirs.length === 0) {
        out.push(...mine);
        continue;
      }
      if (!mine.some(fixed)) {
        out.push(...takeLanes(mine, theirs.map((n) => n.lane)));
        continue;
      }
      if (theirs.length !== mine.length) {
        out.push(...mine);
        continue;
      }
      const [mineOut, mineIn] = split(mine);
      const [theirsOut, theirsIn] = split(theirs);
      if (mineOut.length !== theirsOut.length) {
        out.push(...mine);
        continue;
      }
      [...mineOut.map((n, k) => [n, theirsOut[k]]), ...mineIn.map((n, k) => [n, theirsIn[k]])].forEach(([n, s]) => out.push({ ...n, lane: s.lane }));
    }
    return out;
  });
}

module.exports = { BAR_SIMILARITY, repeatBarLanes };
