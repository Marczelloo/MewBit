// What the decoder's long notes say about a passage, read from all its notes (features.decodedNotes, chartStore.js), not only
// the melody line. Asked for by ear on REVOLVANIA: 0:00-0:20 is a lone bass brass with no drums, a few notes of one to
// three seconds that a level should hold, not tap; 0:20-0:42 is a melody on a low synth over a sustained bass, and Normal
// should play the melody alone there. Our layers hear both like the drop (all bands busy, the brass read as kicks); the
// decoder does not: in 0:20-0:42 long low notes cover 60-88% of the time, in the drop none.
const { lowerBound } = require("./util");
const { drumlessWindows } = require("./drumless");

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

// The decoder's short notes (under rule.shortMs, velocity rule.minVel), without those on the pitch of a long note sounding
// then (its retriggers), one per rule.sameMs (the loudest; `voices` counts the notes it stands for): over a held bed this
// is the line the ear follows. `quiet`: from its low-threshold run where there is one (features.decodedShortNotes), which
// hears 17 of the motif's 20 notes where the first run hears 12, and more chords from the bed; the windows are found on
// the first run, the line played from this one. REVOLVANIA 0:20-0:42: the MEGALOVANIA motif
// on a low synth, in the brass's register, which the melody line (decoder.py, line.js) loses to the long notes. Kept on
// the ctx.
function shortLine(ctx, rule, quiet = false) {
  ctx.shortLine ??= new Map();
  const key = `${rule.shortMs}:${rule.minVel}:${rule.sameMs}:${quiet}`;
  if (ctx.shortLine.has(key)) return ctx.shortLine.get(key);
  const out = [];
  const held = (ctx.features.decodedNotes ?? []).filter((x) => x.len >= rule.longMs);
  const onBed = (n) => held.some((h) => h.pitch === n.pitch && n.t > h.t + rule.sameMs && n.t < h.t + h.len);
  const source = (quiet && ctx.features.decodedShortNotes) || ctx.features.decodedNotes || [];
  for (const n of source.filter((x) => x.len < rule.shortMs && x.vel >= rule.minVel && !onBed(x)).sort((x, y) => x.t - y.t)) {
    const last = out[out.length - 1];
    if (last && n.t - last.t < rule.sameMs) {
      last.voices++;
      if (n.vel > last.vel) Object.assign(last, n, { voices: last.voices });
    } else out.push({ ...n, voices: 1 });
  }
  ctx.shortLine.set(key, out);
  return out;
}

// The loud windows (energy at least rule.loudAbove) where a held bed plays (long low notes cover rule.cover or more) under
// a single line: short notes at rule.linePerSec a second or more, at most rule.chordShare of them with another at once
// (a riff of chords is no lone melody). Only runs of rule.minRun windows or more count: a passage, not a bar.
function melodyOnlyWindows(ctx, rule) {
  const { cover, energy } = coverOf(ctx, rule);
  const line = shortLine(ctx, rule), sec = rule.windowMs / 1000;
  const lone = cover.map((c, w) => {
    if (energy[w] < rule.loudAbove || c < rule.cover) return false;
    const notes = line.slice(lowerBound(line.map((n) => n.t), w * rule.windowMs), lowerBound(line.map((n) => n.t), (w + 1) * rule.windowMs));
    return notes.length / sec >= rule.linePerSec && notes.filter((n) => n.voices > 1).length <= rule.chordShare * notes.length;
  });
  const out = new Set();
  for (let w = 0; w < lone.length; ) {
    let end = w;
    while (end < lone.length && lone[end]) end++;
    if (end - w >= rule.minRun) for (let v = w; v < end; v++) out.add(v);
    w = Math.max(end, w + 1);
  }
  return out;
}

// The time nearest t among the sorted times within reach, or t.
function nearestOf(times, t, reach) {
  const i = lowerBound(times, t);
  const best = [times[i - 1], times[i]].filter((x) => x !== undefined && Math.abs(x - t) <= reach).sort((x, y) => Math.abs(x - t) - Math.abs(y - t))[0];
  return best ?? t;
}

// keepMelodyOnly(notes, ctx, rule, timing) -> notes where every melodyOnlyWindows window plays its short-note line and
// nothing else: one note per line note, on the moment nearest it within rule.snapMs (or at the note). A hold from before
// the window runs on, and the line waits for it. rule = diff.melodyOnly.
function keepMelodyOnly(notes, ctx, rule, timing) {
  if (!rule) return notes;
  const windows = melodyOnlyWindows(ctx, rule);
  if (windows.size === 0) return notes;
  const beat = timing?.medianMs > 0 ? timing.medianMs : 500;
  const inWindow = (t) => windows.has(Math.floor(t / rule.windowMs));
  const kept = notes.filter((n) => !inWindow(n.t));
  const times = [...new Set(notes.map((n) => n.t))].sort((x, y) => x - y);
  const heldUntil = Math.max(-Infinity, ...kept.filter((n) => n.len > 0 && inWindow(n.t + n.len)).map((n) => n.t + n.len + beat / 4));
  const added = [];
  for (const n of shortLine(ctx, rule, true).filter((x) => inWindow(x.t))) {
    const t = nearestOf(times, n.t, rule.snapMs);
    if (t >= heldUntil && !(added.length && t <= added[added.length - 1].t)) added.push({ t, lane: 0 });
  }
  return [...kept, ...added].sort((x, y) => x.t - y.t);
}

// Long decoded notes of rule.longMs or more (velocity rule.minVel), one sound split in two joined: the next starts within
// rule.joinMs of the end on the same pitch.
function longLine(ctx, rule) {
  const out = [];
  for (const n of (ctx.features.decodedNotes ?? []).filter((x) => x.vel >= rule.minVel).sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last && n.t >= last.t + last.len - rule.joinMs && n.t <= last.t + last.len + rule.joinMs && n.pitch === last.pitch) last.len = Math.max(last.len, n.t + n.len - last.t);
    else out.push({ ...n });
  }
  return out.filter((n) => n.len >= rule.longMs);
}

// holdSustains(notes, ctx, rule, timing) -> notes where each long note (longLine) starting in a drumless window
// (drumless.js, rule.drumless; a lone window between two such counts too, a cymbal does not end the passage) is held: the
// moment nearest its start within rule.headMs becomes a hold, or one is put at the start, and the moments from rule.headMs
// before it to its release go (our onsets hear the brass's attack up to 130 ms before the decoder's pitch). The hold runs
// to the note's end or rule.releaseBeats before the next long note's head, and is kept only if it lasts rule.minBeats. A
// note that starts inside an earlier hold is left as it is. Where such a passage plays (a drumless window with a hold), a
// moment is one note: a lone instrument plays no chords.
function holdSustains(notes, ctx, rule, timing) {
  if (!rule) return notes;
  const windows = drumlessWindows(ctx, rule.drumless);
  if (windows.size === 0) return notes;
  const beat = timing?.medianMs > 0 ? timing.medianMs : 500, release = beat * rule.releaseBeats;
  const windowOf = (t) => Math.floor(t / rule.drumless.windowMs);
  const quiet = (w) => windows.has(w) || (windows.has(w - 1) && windows.has(w + 1));
  const sustains = longLine(ctx, rule).filter((n) => quiet(windowOf(n.t)));
  let out = [...notes].sort((a, b) => a.t - b.t);
  let heldUntil = -Infinity; // where the last hold let go, with its release
  const passages = new Set();
  const headOf = (s) => nearestOf([...new Set(out.map((n) => n.t))], s.t, rule.headMs);
  sustains.forEach((s, i) => {
    const head = headOf(s);
    if (head < heldUntil || out.some((n) => n.len > 0 && n.t < head && n.t + n.len > head - release)) return;
    // A legato line: the hold lets go before the next long note's head, so that one is held too.
    const after = sustains.slice(i + 1).find((x) => x.t - rule.headMs > head + beat * rule.minBeats + release);
    const end = Math.min(s.t + s.len, after ? headOf(after) - release : Infinity);
    if (end - head < beat * rule.minBeats) return;
    const inside = (t) => t >= Math.min(head, s.t - rule.headMs) && t < end + release;
    const hold = { ...(out.find((n) => n.t === head) ?? { t: head, lane: 0 }), len: Math.round(end - head) };
    out = [...out.filter((n) => !inside(n.t)), hold].sort((a, b) => a.t - b.t);
    passages.add(windowOf(head));
    heldUntil = end + release;
  });
  if (!passages.size) return out;
  const played = new Set();
  return out.filter((n) => {
    if (!quiet(windowOf(n.t)) || ![...passages].some((w) => Math.abs(w - windowOf(n.t)) <= 2)) return true;
    if (played.has(n.t)) return false;
    played.add(n.t);
    return true;
  });
}

// withShortLine(melody, ctx, rule) -> the melody the lanes follow, with the short-note line in place of it in the
// melodyOnlyWindows windows, so the lanes follow what those windows play.
function withShortLine(melody, ctx, rule) {
  const windows = melodyOnlyWindows(ctx, rule);
  if (windows.size === 0) return melody;
  const inWindow = (t) => windows.has(Math.floor(t / rule.windowMs));
  const line = shortLine(ctx, rule, true).filter((n) => inWindow(n.t)).map(({ t, len, pitch }) => ({ t, len, pitch, conf: 1 }));
  return [...(melody ?? []).filter((n) => !inWindow(n.t)), ...line].sort((a, b) => a.t - b.t);
}

module.exports = { coverOf, melodyOnlyWindows, keepMelodyOnly, holdSustains, withShortLine };
