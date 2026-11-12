// A melody from a second detector in Normal's choice of moments (diff.melodyPick, from v39). The decoder lost a
// listening test when it picked the moments itself: quiet melody notes took the place of loud, full ones and left holes. So
// here it only raises the score of a moment where it hears a melody note begin, and only of a moment at least as loud as
// rule.minStrength of the song's moments (a rank, 0 the quietest, 1 the loudest): a quiet melody note gains nothing.
// The budget, the gaps and the fills of selection.js stay as they are.
const { lowerBound, nearestIndex } = require("./util");

const ONSET_MS = 50; // a moment plays the melody note that begins this close to the sound it was heard at
const BURST_BEATS = 0.3; // a gap of up to this much of a beat is part of a burst

// Within-song rank of each value in [0, 1], ties sharing their mean rank.
function ranks(values) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    for (let k = i; k <= j; k++) out[order[k]] = values.length > 1 ? (i + j) / 2 / (values.length - 1) : 1;
    i = j + 1;
  }
  return out;
}

// withMelody(scored, melody, rule) -> scored with rule.bonus added to the score of a loud enough moment on a melody note,
// marked `melody: true`. `scored` is selection.js snappedMoments (raw: where the sound was), `melody` the decoded notes
// ({ t }), time-ordered or not.
function withMelody(scored, melody, rule) {
  if (!rule || !Array.isArray(melody) || melody.length === 0) return scored;
  const starts = melody.map((n) => n.t).filter(Number.isFinite).sort((a, b) => a - b);
  const loud = ranks(scored.map((m) => m.s));
  return scored.map((m, i) => {
    const at = m.raw ?? m.t;
    const k = nearestIndex(starts, at);
    if (k < 0 || Math.abs(starts[k] - at) > ONSET_MS || loud[i] < rule.minStrength) return m;
    return { ...m, score: m.score + rule.bonus, melody: true };
  });
}

// withMelodyRuns(scored, melody, rule) -> scored with a moment marked `melodyRun: true` where a melody note begins and
// the melody runs fast: the note before or after it begins within rule.fastMs.
function withMelodyRuns(scored, melody, rule) {
  if (!rule || !Array.isArray(melody) || melody.length < 2) return scored;
  const starts = melody.map((n) => n.t).filter(Number.isFinite).sort((a, b) => a - b);
  return scored.map((m) => {
    const at = m.raw ?? m.t;
    const k = nearestIndex(starts, at);
    if (k < 0 || Math.abs(starts[k] - at) > ONSET_MS) return m;
    const fast = (k > 0 && starts[k] - starts[k - 1] <= rule.fastMs) || (k + 1 < starts.length && starts[k + 1] - starts[k] <= rule.fastMs);
    return fast ? { ...m, melodyRun: true } : m;
  });
}

// The number of gaps of up to BURST_BEATS of a beat in a row around times[i] (`times` sorted): the length of its burst.
function burstAround(times, i, timing) {
  const short = (a, b) => (b - a) / timing.beatMsAt(a) <= BURST_BEATS;
  let lo = i, hi = i;
  while (lo > 0 && short(times[lo - 1], times[lo])) lo--;
  while (hi + 1 < times.length && short(times[hi], times[hi + 1])) hi++;
  return hi - lo;
}

// withRunNotes(notes, scored, timing, rule) -> notes with the moments withMelodyRuns marked added on top of the budget
// (the melodyRuns flag), where they fall inside a stream: the chart's notes before and after are within rule.streamBeats
// of a beat and at least rule.minGapMs away, the note before is not held over it, and no more than rule.maxRun gaps of up
// to `BURST_BEATS` follow in a row. So a fast melody plays a short burst of a few notes as the music speeds up, and the
// stream around it stays. Normal's gaps of a quarter beat or less: 1.7%, people 10.7%, the flag 3.3%. Train, the added
// moments are people's 43.6% of the time (a quarter beat where the melody runs fast in a song under 140 BPM: 49.8%).
function withRunNotes(notes, scored, timing, rule) {
  if (!rule || !timing?.snapped) return notes;
  return placeRunNotes(notes, scored.filter((m) => m.melodyRun).map((m) => m.t), timing, rule);
}

// The placing of withRunNotes (also softRuns.js): a note on each of `runs` (times, in order) that falls inside a stream, under
// the rules above.
function placeRunNotes(notes, runs, timing, rule, gapHold = null) {
  if (runs.length === 0) return notes;
  const times = [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);
  const heldUntil = new Map();
  for (const n of notes) if (n.len > 0) heldUntil.set(n.t, Math.max(heldUntil.get(n.t) ?? 0, n.t + n.len));
  const added = [];
  const cut = new Set(); // times whose gap hold gives way to a burst note inside it (rule.cutGapHolds: softRuns.js)
  const gapHeldAt = new Map();
  const chain = new Set(); // burst notes that began in a gap hold; the next ones of the run follow them (rule.onlyOverHolds)
  if (rule.cutGapHolds && gapHold) for (const n of notes) if (n.len > 0) gapHeldAt.set(n.t, (gapHeldAt.get(n.t) ?? true) && gapHold(n));
  for (const t of runs) {
    const i = lowerBound(times, t);
    const prev = times[i - 1], next = times[i];
    if (prev === undefined || next === undefined || next === t) continue;
    const span = rule.streamBeats * timing.beatMsAt(t);
    if (t - prev > span || next - t > span || t - prev < rule.minGapMs || next - t < rule.minGapMs) continue;
    const over = (heldUntil.get(prev) ?? 0) > t - rule.minGapMs;
    if (over && !(rule.cutGapHolds && gapHeldAt.get(prev))) continue;
    const fromHold = over || chain.has(prev);
    if (rule.onlyOverHolds && !fromHold) continue;
    times.splice(i, 0, t);
    if (burstAround(times, i, timing) > rule.maxRun) times.splice(i, 1);
    else {
      added.push({ t, lane: 0 });
      if (fromHold) chain.add(t);
      if (over) { cut.add(prev); heldUntil.delete(prev); }
    }
  }
  if (!added.length) return notes;
  const loosened = cut.size ? notes.map((n) => (cut.has(n.t) && n.len > 0 ? { ...n, len: 0 } : n)) : notes;
  return [...loosened, ...added].sort((a, b) => a.t - b.t);
}

module.exports = { ONSET_MS, burstAround, placeRunNotes, ranks, withMelody, withMelodyRuns, withRunNotes };
