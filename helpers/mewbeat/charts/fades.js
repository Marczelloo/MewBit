// The fade-out at the end of a song and what Normal plays in it (diff.fadeOut, generator flag "fadeOut"). On the train
// songs people's Normal plays half as many notes a second in a fade-out as v36 (1.27 against 2.48; Hard 2.69 against
// 5.76) and holds as many of them; asked for by ear: holds rather than taps, or calmer, sparser taps.
const { groupByTime, slotRank } = require("./difficultyFilter");
const { beatMsOf } = require("./holds");
const { strengthAt } = require("./rhythm");

const STEP_MS = 50; // how finely the energy is read
const SILENT = 0.05; // the song's sound ends where the energy stays under this

const fades = new WeakMap();

// fadeOutOf(ctx, rule) -> { startMs, endMs } | null
// From the song's last moment at rule.loud or louder to its last sound, when that is at least rule.minSec long and under
// rule.quiet half a second before the sound ends. With rule.from it starts only where the energy first falls under that:
// a slow fade that keeps playing almost loud for a while (Bad Piggies 2:19-2:24) keeps its notes there.
function fadeOutOf(ctx, rule) {
  if (!fades.has(ctx)) fades.set(ctx, new Map());
  const key = `${rule.loud}:${rule.quiet}:${rule.minSec}:${rule.from}`;
  const cache = fades.get(ctx);
  if (!cache.has(key)) {
    const at = (t) => ctx.energy.at(t);
    let last = ctx.durationMs;
    while (last > 0 && at(last) < SILENT) last -= STEP_MS;
    let loud = last;
    while (loud > 0 && at(loud) < rule.loud) loud -= STEP_MS;
    let start = loud;
    if (rule.from !== undefined) while (start < last && at(start) >= rule.from) start += STEP_MS;
    const fade = last - loud >= rule.minSec * 1000 && at(last - 500) < rule.quiet ? { startMs: start, endMs: last } : null;
    cache.set(key, fade);
  }
  return cache.get(key);
}

// thinFadeOut(notes, ctx, rule) -> notes
// In the fade-out rule.keep of the moments stay: a moment with a hold first, then by its place in the bar (downbeat,
// beat, half beat, finer), then the stronger sound, then the earlier one.
function thinFadeOut(notes, ctx, rule) {
  const fade = fadeOutOf(ctx, rule);
  if (!fade) return notes;
  const inside = groupByTime(notes).filter((m) => m[0].t >= fade.startMs && m[0].t < fade.endMs);
  // With rule.barBeats each stretch of that many beats from the fade's start keeps its own share, so a dense stretch
  // gives no more of its notes than a sparse one; without it the share is over the whole fade-out.
  const groups = [];
  let until = -Infinity;
  for (const m of inside) {
    if (!rule.barBeats || m[0].t >= until) {
      groups.push([]);
      until = rule.barBeats ? m[0].t + rule.barBeats * beatMsOf(ctx.timing, m[0].t) : Infinity;
    }
    groups[groups.length - 1].push(m);
  }
  const dropped = new Set();
  for (const group of groups) {
    const keep = Math.ceil(group.length * rule.keep);
    const ranked = group
      .map((m) => ({ t: m[0].t, held: m.some((n) => n.len > 0) ? 0 : 1, slot: slotRank(ctx.timing, m[0].t), heard: strengthAt(ctx, m[0].t) ?? 0 }))
      .sort((a, b) => a.held - b.held || a.slot - b.slot || b.heard - a.heard || a.t - b.t);
    for (const r of ranked.slice(keep)) dropped.add(r.t);
  }
  return dropped.size === 0 ? notes : notes.filter((n) => !dropped.has(n.t));
}

// holdFadeOut(notes, ctx, rule) -> notes
// In the fade-out a lone tap with at least rule.hold.minBeats of room is held until rule.hold.releaseBeats before the next
// moment; the last one for up to rule.hold.lastBeats, and not past the song's last sound.
function holdFadeOut(notes, ctx, rule) {
  const fade = fadeOutOf(ctx, rule);
  if (!fade || !rule.hold) return notes;
  const moments = groupByTime(notes);
  const held = new Map();
  moments.forEach((moment, m) => {
    const { t } = moment[0];
    if (t < fade.startMs || t >= fade.endMs || moment.length > 1 || moment[0].len > 0) return;
    const beat = beatMsOf(ctx.timing, t);
    const next = moments[m + 1];
    const len = next ? next[0].t - rule.hold.releaseBeats * beat - t : Math.min(rule.hold.lastBeats * beat, fade.endMs - t);
    if (len >= rule.hold.minBeats * beat) held.set(moment[0], Math.round(len));
  });
  return notes.map((n) => (held.has(n) ? { ...n, len: held.get(n) } : n));
}

module.exports = { fadeOutOf, holdFadeOut, thinFadeOut };
