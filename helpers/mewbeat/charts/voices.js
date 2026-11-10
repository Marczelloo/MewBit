// The voices of a song, read from every note the second detector hears (features.decodedNotes) against the line it drew
// through them (the decoded melody): the notes that repeat the line's tone and the line left out (generator flag lineRepeats),
// and the sounds that play under the line, an accompaniment (generator flag leadVoiceBoth). Both asked for by ear on Rush E:
// "it picked the lower, more bass line, not the high leading one".
const { ONSET_MS, ranks } = require("./melodyPick");
const { lowerBound } = require("./util");

const REPEAT_ROUNDS = 8; // a run of repeats the line left out is taken up from its ends, this many notes deep
const byTime = (a, b) => a.t - b.t;

// withLineRepeats(line, notes, rule) -> the line with the decoded notes that repeat its tone: a note of `notes` at least as
// loud as rule.minVel, no line note beginning within ONSET_MS of it, at the pitch of the line's note before or after it and
// within rule.reachMs of that note; marked `repeat: true`, time-ordered. The decoder draws its line away from a pitch it has
// just played, so of a tone struck over and over it keeps every other strike. The line itself without the rule or the notes.
function withLineRepeats(line, notes, rule) {
  if (!rule || !Array.isArray(notes) || notes.length === 0 || !Array.isArray(line) || line.length === 0) return line;
  let out = line.filter((n) => Number.isFinite(n.t)).sort(byTime);
  const spare = notes.filter((n) => Number.isFinite(n.t) && n.vel >= rule.minVel).sort(byTime);
  for (let round = 0; round < REPEAT_ROUNDS; round++) {
    const times = out.map((n) => n.t);
    const added = [];
    for (const n of spare) {
      const i = lowerBound(times, n.t);
      const before = out[i - 1];
      const after = out[i];
      if ((before && n.t - before.t <= ONSET_MS) || (after && after.t - n.t <= ONSET_MS)) continue;
      if (added.length > 0 && n.t - added[added.length - 1].t <= ONSET_MS) continue;
      const of = before && before.pitch === n.pitch && n.t - before.t <= rule.reachMs ? before : after && after.pitch === n.pitch && after.t - n.t <= rule.reachMs ? after : null;
      if (of) added.push({ t: n.t, pitch: n.pitch, conf: of.conf, len: n.len, repeat: true });
    }
    if (added.length === 0) break;
    out = [...out, ...added].sort(byTime);
  }
  return out;
}

// underLine(scored, line, notes, phrases, rule) -> scored with rule.penalty taken from the score of a moment that plays under
// the melody, marked `under: true`. `scored` is selection.js snappedMoments (raw: where the sound was), `line` the decoded
// melody and `notes` every decoded note, both at the shift the level reads them. A moment is under the melody when pitches
// begin on it (within rule.nearMs), none of them a note of the line (ONSET_MS), the highest rule.below semitones or more
// under the line's nearest note, and a note of the line begins within rule.clashMs of the moment, before or after: the moment
// would take that note's place, and anywhere else both hands play (flag leadVoiceBoth). Only in a song a pitched line
// carries: rule.song of its phrases or more are led by one (a pitch begins on rule.pitched of a phrase's loud moments, those
// of rank rule.minLoud or more, rule.minMoments of them at least). Where drums carry the song the bass under a melody is the
// beat people play, and nothing is taken.
function underLine(scored, line, notes, phrases, rule) {
  if (!rule || !Array.isArray(notes) || notes.length === 0 || !Array.isArray(line) || line.length === 0) return scored;
  const lead = line.filter((n) => Number.isFinite(n.t)).sort(byTime);
  const leadTimes = lead.map((n) => n.t);
  const { heard, top, led } = pitchedMoments(scored, notes, phrases, rule);
  if (!led) return scored;
  return scored.map((m, k) => {
    if (top[k] === null) return m;
    const t = heard[k];
    const i = lowerBound(leadTimes, t);
    const before = lead[i - 1];
    const after = lead[i];
    if ((before && t - before.t <= ONSET_MS) || (after && after.t - t <= ONSET_MS)) return m;
    const plays = (before && t - before.t <= rule.clashMs) || (after && after.t - t <= rule.clashMs);
    if (!plays) return m;
    const nearest = before && (!after || t - before.t <= after.t - t) ? before : after;
    return nearest.pitch - top[k] >= rule.below ? { ...m, score: m.score - rule.penalty, under: true } : m;
  });
}

// The moments of a song against every decoded note: `heard` where each sound was, `top` the highest pitch that begins on it
// (within rule.nearMs), null where none does, `times` the moments' times and `led` the phrases a pitched line leads (a pitch
// begins on rule.pitched of a phrase's loud moments, those of rank rule.minLoud or more, rule.minMoments of them at least),
// null in a song no pitched line carries: fewer than rule.song of its phrases are led.
function pitchedMoments(scored, notes, phrases, rule) {
  const sorted = notes.filter((n) => Number.isFinite(n.t)).sort(byTime);
  const starts = sorted.map((n) => n.t);
  const heard = scored.map((m) => m.raw ?? m.t);
  // the highest pitch that begins on each moment, null where none does
  const top = heard.map((t) => {
    let best = null;
    for (let i = lowerBound(starts, t - rule.nearMs); i < sorted.length && starts[i] <= t + rule.nearMs; i++) if (best === null || sorted[i].pitch > best) best = sorted[i].pitch;
    return best;
  });
  const loud = ranks(scored.map((m) => m.s));
  const times = scored.map((m) => m.t);
  const spans = phrases?.length > 0 ? phrases : [{ startMs: -Infinity, endMs: Infinity }];
  const led = spans.filter((span) => {
    let moments = 0, pitched = 0;
    for (let k = lowerBound(times, span.startMs); k < scored.length && times[k] < span.endMs; k++) {
      if (loud[k] < rule.minLoud) continue;
      moments++;
      if (top[k] !== null) pitched++;
    }
    return moments >= rule.minMoments && pitched >= rule.pitched * moments;
  });
  return { heard, top, times, led: led.length < rule.song * spans.length ? null : led };
}

// offPitch(scored, notes, drums, phrases, rule) -> the times of the moments no pitch begins on (within rule.nearMs) and no
// drum but a kick plays on (features.drums of strength rule.minDrum or more, within rule.drumMs), in the phrases a pitched
// line leads of a song one carries (underLine's gate: rule.pitched, minLoud, minMoments, song). In a piano piece such a moment
// is a sound the first detector heard and no key was struck on, and a low key reads as a kick: an extra there plays off the
// notes (generator flag plusHeard). A snare or another drum is a beat people play. An empty set without the rule or the
// notes, and where drums carry the song or the phrase.
function offPitch(scored, notes, drums, phrases, rule) {
  const off = new Set();
  if (!rule || !Array.isArray(notes) || notes.length === 0) return off;
  const { heard, top, times, led } = pitchedMoments(scored, notes, phrases, rule);
  const beats = (drums ?? []).filter((d) => d.kind !== "kick" && d.s >= rule.minDrum).map((d) => d.t).sort((a, b) => a - b);
  const drummed = (t) => {
    const i = lowerBound(beats, t - rule.drumMs);
    return i < beats.length && beats[i] <= t + rule.drumMs;
  };
  for (const span of led ?? []) for (let k = lowerBound(times, span.startMs); k < scored.length && times[k] < span.endMs; k++) if (top[k] === null && !drummed(heard[k])) off.add(times[k]);
  return off;
}

module.exports = { offPitch, underLine, withLineRepeats };
