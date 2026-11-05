// A rest of a level that picks its notes from the music is one of two kinds. A full rest, where the music itself goes
// quiet, stays empty. A mini rest, where the music plays on and the chart only ran out of budget or room, keeps the
// strongest moment the music puts there, so the two passages either side stay joined. On the train songs people play
// in 61% of Normal's rests under music; where such a rest holds a moment scoring 0 or more, they have a note on it 65% of
// the time (0.5 or more: 77%), against 36% for the best moment of the others.
const { beatMsOf } = require("./holds");

const endOf = (n) => n.t + (n.len > 0 ? n.len : 0);
const byTime = (a, b) => a.t - b.t || a.lane - b.lane;

// The rests of `notes` (holds count until they let go) at least minBeats long with the music playing at their middle:
// [{ from, to }], time-ordered.
function restsOf(notes, energy, timing, { minBeats, playing }) {
  const out = [];
  let reach = null;
  for (const n of notes) {
    if (reach !== null && n.t - reach >= minBeats * beatMsOf(timing, reach) && energy.at((reach + n.t) / 2) >= playing) out.push({ from: reach, to: n.t });
    reach = reach === null ? endOf(n) : Math.max(reach, endOf(n));
  }
  return out;
}

// bridgeRests(notes, scored, energy, timing, rule) -> notes: each mini rest gets its best moment of `scored` (selection.js
// snappedMoments) on a beat or half beat, at least edgeBeats from either side, scoring at least rule.score; a rest that is
// still long enough takes another. rule = diff.restBridge = { minBeats, playing, score, edgeBeats }. A new note's lane only
// holds its place until the lanes are laid.
function bridgeRests(notes, scored, energy, timing, rule) {
  if (!rule || !timing?.snapped) return notes;
  const moments = scored.filter((m) => m.metric <= 1 && m.score >= rule.score);
  if (moments.length === 0) return notes;
  let out = [...notes].sort(byTime);
  const tried = new Set();
  for (;;) {
    // A rest left without a moment is a full rest; each note added shortens a rest, so this ends.
    const rest = restsOf(out, energy, timing, rule).find((r) => !tried.has(r.from));
    if (!rest) return out;
    const edge = rule.edgeBeats * beatMsOf(timing, rest.from);
    let best = null;
    for (const m of moments) {
      if (m.t < rest.from + edge - 1 || m.t > rest.to - edge + 1) continue;
      if (!best || m.score > best.score) best = m;
    }
    if (best) out = [...out, { t: best.t, lane: 0 }].sort(byTime);
    else tried.add(rest.from);
  }
}

module.exports = { bridgeRests };
