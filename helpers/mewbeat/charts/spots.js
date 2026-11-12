// Sudden dense spots in the quiet parts of a song (generate.js finish, diff.calmSpots): a bar that plays well above the
// bars on both sides of it while the music stays calm. Heard as "the energy is fairly calm and suddenly a mini spam"
// (the user, 2026-11-11, on a large part of the maps). The numbers are with CALM_SPOTS in difficulty.js.
const { groupByTime, slotRank } = require("./difficultyFilter");
const { beatMsOf } = require("./holds");
const { strengthAt } = require("./rhythm");
const { lowerBound } = require("./util");

// evenSpots(notes, ctx, rule, quietAt, protect) -> notes
// Where the song is quiet (quietAt, quiet.js) no stretch of rule.windowBeats holds more moments than rule.over times what the
// denser of its two sides plays (the rule.sideBeats before it and after it, as charted), and never fewer than rule.most. The
// stretch is a bar, so a figure that repeats bar after bar is no spot however uneven it is inside the bar, and with the
// denser side to go by neither is a stretch that leads into a denser part or out of one. The moments over that go: the
// finest place in the bar first, then the weaker sound, then the later one. A moment with a hold stays, and so do the
// moments of `protect` (the level this one is built on: a set of times, or null). The moments of `apart` (the melody's,
// diff.calmMelody: a set of times, or null) are no part of a spot: they stay and are not counted in the stretch, so a bar
// the melody runs through is judged by what plays beside the melody.
// rule = diff.calmSpots = { below, windowBeats, sideBeats, minSideBeats, most, over }.
function evenSpots(notes, ctx, rule, quietAt, protect = null, apart = null) {
  if (!rule || !quietAt || notes.length === 0) return notes;
  const moments = groupByTime(notes);
  const charted = moments.map((m) => m[0].t);
  const fixed = new Set(moments.filter((m) => m.some((n) => n.len > 0) || protect?.has(m[0].t)).map((m) => m[0].t));
  const first = charted[0], end = charted[charted.length - 1] + 1;
  const rate = (from, to) => (lowerBound(charted, to) - lowerBound(charted, from)) / (to - from);
  const left = [...charted];
  const dropped = new Set();
  for (const t of charted) {
    const beat = beatMsOf(ctx.timing, t);
    const windowMs = rule.windowBeats * beat;
    if (!quietAt(t + windowMs / 2)) continue;
    // what the denser side plays; a side with under rule.minSideBeats of chart in it (the start, the end) is not read
    const from = Math.max(first, t - rule.sideBeats * beat), to = Math.min(end, t + windowMs + rule.sideBeats * beat);
    const sides = [];
    if (t - from >= rule.minSideBeats * beat) sides.push(rate(from, t));
    if (to - (t + windowMs) >= rule.minSideBeats * beat) sides.push(rate(t + windowMs, to));
    if (sides.length === 0) continue;
    const most = Math.max(rule.most, Math.floor(rule.over * Math.max(...sides) * windowMs));
    for (;;) {
      const all = left.slice(lowerBound(left, t), lowerBound(left, t + windowMs));
      const inside = apart ? all.filter((x) => !apart.has(x)) : all;
      const loose = inside.filter((x) => !fixed.has(x));
      if (inside.length <= most || loose.length === 0) break;
      const [out] = loose
        .map((x) => ({ t: x, slot: slotRank(ctx.timing, x), heard: strengthAt(ctx, x) ?? 0 }))
        .sort((a, b) => b.slot - a.slot || a.heard - b.heard || b.t - a.t);
      dropped.add(out.t);
      left.splice(lowerBound(left, out.t), 1);
    }
  }
  return dropped.size === 0 ? notes : notes.filter((n) => !dropped.has(n.t));
}

module.exports = { evenSpots };
