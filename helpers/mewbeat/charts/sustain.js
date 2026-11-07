// What the decoder's long notes say about a passage, read from all its notes (features.decodedNotes, chartStore.js), not only
// the melody line. Asked for by ear on REVOLVANIA: 0:00-0:20 is a lone bass brass with no drums, a few notes of one to
// three seconds that a level should hold, not tap; 0:20-0:42 is a calm melody over a sustained bass, and Normal should
// play the melody alone there. Our layers hear both like the drop (all bands busy, the brass read as kicks); the decoder
// does not: in 0:20-0:42 long low notes cover 60-88% of the time, in the drop none.
const { lowerBound } = require("./util");
const { drumlessWindows } = require("./drumless");

const NEAR_MS = 35; // the onset a note plays

const longNotes = (ctx, rule) => (ctx.features.decodedNotes ?? []).filter((n) => n.len >= rule.longMs && n.vel >= rule.minVel && n.pitch < rule.lowBelow);

// The share of each rule.windowMs window that long low notes (pitch under rule.lowBelow, at least rule.longMs, velocity
// rule.minVel) cover, and the window's mean energy. Kept on the ctx.
function coverOf(ctx, rule) {
  ctx.sustainCover ??= new Map();
  const key = `${rule.windowMs}:${rule.longMs}:${rule.minVel}:${rule.lowBelow}`;
  if (ctx.sustainCover.has(key)) return ctx.sustainCover.get(key);
  const { hopMs, values } = ctx.features.energy ?? {};
  const windows = Math.ceil((ctx.durationMs ?? ctx.features.durationMs ?? 0) / rule.windowMs);
  const cover = new Array(windows).fill(0), energy = new Array(windows).fill(0);
  for (const n of longNotes(ctx, rule)) {
    for (let w = Math.max(0, Math.floor(n.t / rule.windowMs)); w < windows && w * rule.windowMs < n.t + n.len; w++) {
      cover[w] += Math.max(0, Math.min((w + 1) * rule.windowMs, n.t + n.len) - Math.max(w * rule.windowMs, n.t)) / rule.windowMs;
    }
  }
  if (hopMs > 0 && Array.isArray(values)) {
    for (let w = 0; w < windows; w++) {
      const frames = values.slice(Math.floor((w * rule.windowMs) / hopMs), Math.floor(((w + 1) * rule.windowMs) / hopMs));
      energy[w] = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    }
  }
  const out = { cover: cover.map((c) => Math.min(1, c)), energy };
  ctx.sustainCover.set(key, out);
  return out;
}

// The loud windows (energy at least rule.loudAbove) where long low notes cover rule.cover or more while the song's loud
// windows are covered under rule.songCoverBelow at the median (a song held on a bass throughout has no such contrast),
// and the melody starts rule.melodyPerSec notes a second or more; a loud window next to one with rule.edgeCover counts too.
function melodyOnlyWindows(ctx, rule, melody) {
  const { cover, energy } = coverOf(ctx, rule);
  const loud = cover.filter((_, w) => energy[w] >= rule.loudAbove).sort((a, b) => a - b);
  const out = new Set();
  if (!loud.length || !(loud[loud.length >> 1] < rule.songCoverBelow) || !melody?.length) return out;
  const starts = melody.map((n) => n.t).sort((a, b) => a - b), sec = rule.windowMs / 1000;
  for (let w = 0; w < cover.length; w++) {
    if (energy[w] < rule.loudAbove || cover[w] < rule.cover) continue;
    const from = lowerBound(starts, w * rule.windowMs), to = lowerBound(starts, (w + 1) * rule.windowMs);
    if ((to - from) / sec >= rule.melodyPerSec) out.add(w);
  }
  // A passage's edge window, held a little less, goes with it.
  for (const w of [...out]) for (const v of [w - 1, w + 1]) if (!out.has(v) && energy[v] >= rule.loudAbove && cover[v] >= rule.edgeCover) out.add(v);
  return out;
}

// keepMelodyOnly(notes, ctx, rule, melody) -> notes without the moments in a melodyOnlyWindows window that no melody note
// starts within NEAR_MS of. Holds stay. rule = diff.melodyOnly; melody = the decoded melody the level reads, or null.
function keepMelodyOnly(notes, ctx, rule, melody) {
  if (!rule || !melody?.length) return notes;
  const windows = melodyOnlyWindows(ctx, rule, melody);
  if (windows.size === 0) return notes;
  const starts = melody.map((n) => n.t).sort((a, b) => a - b);
  const plays = (t) => {
    const i = lowerBound(starts, t - NEAR_MS);
    return i < starts.length && starts[i] <= t + NEAR_MS;
  };
  const dropped = new Set(notes.filter((n) => !(n.len > 0) && windows.has(Math.floor(n.t / rule.windowMs)) && !plays(n.t)).map((n) => n.t));
  const held = new Set(notes.filter((n) => n.len > 0).map((n) => n.t));
  return dropped.size ? notes.filter((n) => !dropped.has(n.t) || held.has(n.t)) : notes;
}

// holdSustains(notes, ctx, rule, timing) -> notes where each long note (at least rule.longMs, velocity rule.minVel, any
// pitch) starting in a drumless window (drumless.js, rule.drumless; a lone window between two such counts too, a cymbal
// does not end the passage) is held: the moment nearest its start within rule.headMs becomes a hold, or a tap is put at the
// start, and the moments inside the hold go (our onsets hear the brass's attack up to 130 ms before the decoder's pitch).
// The hold lets go rule.releaseBeats after it, or before the next long note, and is kept only if it lasts rule.minBeats.
// A note that starts inside an earlier hold is left as it is.
function holdSustains(notes, ctx, rule, timing) {
  if (!rule) return notes;
  const windows = drumlessWindows(ctx, rule.drumless);
  if (windows.size === 0) return notes;
  const beat = timing?.medianMs > 0 ? timing.medianMs : 500;
  const quiet = (w) => windows.has(w) || (windows.has(w - 1) && windows.has(w + 1));
  const sustains = (ctx.features.decodedNotes ?? [])
    .filter((n) => n.len >= rule.longMs && n.vel >= rule.minVel && quiet(Math.floor(n.t / rule.drumless.windowMs)))
    .sort((a, b) => a.t - b.t);
  const release = beat * rule.releaseBeats;
  let out = [...notes].sort((a, b) => a.t - b.t);
  let heldUntil = -Infinity; // where the last hold let go, with its release
  sustains.forEach((s, i) => {
    const times = [...new Set(out.map((n) => n.t))];
    const near = times.filter((t) => Math.abs(t - s.t) <= rule.headMs).sort((a, b) => Math.abs(a - s.t) - Math.abs(b - s.t));
    const head = near[0] ?? s.t;
    if (head < heldUntil || out.some((n) => n.len > 0 && n.t < head && n.t + n.len >= head - release)) return;
    // A legato line: the hold lets go before the next long note's head, so that one is held too.
    const after = sustains.slice(i + 1).find((x) => x.t - rule.headMs > head + beat * rule.minBeats + release);
    const end = Math.min(s.t + s.len, after ? after.t - rule.headMs - release : Infinity);
    if (end - head < beat * rule.minBeats) return;
    const inside = (t) => t > head && t < end + release;
    const kept = out.filter((n) => !inside(n.t));
    const atHead = kept.filter((n) => n.t === head);
    const hold = { ...(atHead[0] ?? { t: head, lane: 0 }), len: Math.round(end - head) };
    out = [...kept.filter((n) => n.t !== head), hold].sort((a, b) => a.t - b.t);
    heldUntil = end + release;
  });
  return out;
}

module.exports = { coverOf, melodyOnlyWindows, keepMelodyOnly, holdSustains };
