// Normal follows the music in sung phrases (diff.musicFirst, the musicFirst flag). A generated chart of a sung song played
// the voice: the melody bonus (melodyPick.js) lifts the moments on a sung note, the lanes follow its pitch, and a slow song
// turned into a run of syllables over a rhythm the player did not feel. Here, in a phrase with a voice in it (sungWindows),
// the voice stops steering: its notes get no melody bonus and no lane direction (the lanes follow the bass line instead,
// laneRules.js), a moment the bass or the drums hit scores higher and one only the voice hits lower, and a long sung note is
// held (holdSung) while the beat goes on in the other hand. Only Normal reads it.
const { nearestIndex } = require("./util");

// A phrase is sung when its lead line is sure, busy and active enough: the lead line is the voice in most songs, and an
// instrument playing a tune the same way is treated alike. The windows are merged: [{ from, to }], time-ordered.
function sungWindows(ctx, rule) {
  ctx.sungWindows ??= new Map();
  if (ctx.sungWindows.has(rule)) return ctx.sungWindows.get(rule);
  const out = [];
  const lead = (x) => (Number.isFinite(x?.lead) ? x.lead : 0);
  for (const p of ctx.phrases ?? []) {
    if (lead(p.confidence) < rule.minConf || lead(p.rate) < rule.minRate || lead(p.activity) < rule.minActivity) continue;
    const last = out[out.length - 1];
    if (last && p.startMs <= last.to) last.to = Math.max(last.to, p.endMs);
    else out.push({ from: p.startMs, to: p.endMs });
  }
  ctx.sungWindows.set(rule, out);
  return out;
}

// Is t inside one of the windows (binary search)?
function inWindows(windows, t) {
  let lo = 0, hi = windows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid].to <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo < windows.length && windows[lo].from <= t;
}

// The melody (notes with .t) without its notes in the sung windows: nothing there follows it.
function outsideSung(line, ctx, rule) {
  const windows = sungWindows(ctx, rule);
  if (!Array.isArray(line) || windows.length === 0) return line;
  ctx.musicLines ??= new WeakMap();
  if (!ctx.musicLines.has(line)) ctx.musicLines.set(line, new Map());
  const byRule = ctx.musicLines.get(line);
  if (!byRule.has(rule)) byRule.set(rule, line.filter((n) => !inWindows(windows, n.t)));
  return byRule.get(rule);
}

// The lead line of the features outside the sung windows: the lanes' melody for a song with no decoded one.
const leadOutsideSung = (ctx, rule) => outsideSung(Array.isArray(ctx.features.lead) ? ctx.features.lead : [], ctx, rule);

// scored (selection.js snappedMoments, with the melody bonus) with, in the sung windows, rule.musicBonus added to a moment
// whose strongest onset is the bass or the drums and rule.voicePenalty taken off one whose strongest onset is the lead.
function withMusic(scored, ctx, rule) {
  const windows = sungWindows(ctx, rule);
  if (windows.length === 0) return scored;
  ctx.musicScored ??= new WeakMap();
  if (!ctx.musicScored.has(scored)) ctx.musicScored.set(scored, new Map());
  const byRule = ctx.musicScored.get(scored);
  if (!byRule.has(rule)) {
    byRule.set(rule, scored.map((m) => {
      if (!inWindows(windows, m.raw ?? m.t)) return m;
      if (m.source === "bass" || m.source === "drums") return { ...m, score: m.score + rule.musicBonus };
      if (m.source === "lead") return { ...m, score: m.score - rule.voicePenalty };
      return m;
    }));
  }
  return byRule.get(rule);
}

// holdSung(notes, ctx, rule, timing, sustained) -> notes: a sung note (the lead line) of rule.minBeats or more, sure to
// rule.holdConf, that starts in a sung window turns the moment nearest its start (within rule.headMs) into a hold, up to
// rule.maxBeats long, if that moment is a lone tap and no hold is running there. settleHolds then fits the end to the
// moments the music plays under it. The hold is marked a sustain, so the hold cap keeps it before a gap hold.
function holdSung(notes, ctx, rule, timing, sustained) {
  const windows = sungWindows(ctx, rule);
  if (windows.length === 0 || !(rule.minBeats > 0)) return notes;
  const lead = (Array.isArray(ctx.features.lead) ? ctx.features.lead : []).filter((e) => Number.isFinite(e?.t) && Number(e.conf) >= rule.holdConf);
  const out = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ ...n }));
  const times = out.map((n) => n.t);
  const beat = timing?.medianMs > 0 ? timing.medianMs : 500;
  for (const e of lead) {
    if (!inWindows(windows, e.t) || !(e.len >= rule.minBeats * beat)) continue;
    const i = nearestIndex(times, e.t);
    if (i < 0 || Math.abs(times[i] - e.t) > rule.headMs) continue;
    const at = out.filter((n) => n.t === times[i]);
    if (at.length !== 1 || at[0].len > 0) continue;
    if (out.some((n) => n.len > 0 && n.t < times[i] && n.t + n.len > times[i])) continue;
    at[0].len = Math.round(Math.min(e.len, rule.maxBeats * beat));
    sustained?.add(`${at[0].t}:${at[0].lane}`);
  }
  return out;
}

module.exports = { holdSung, inWindows, leadOutsideSung, outsideSung, sungWindows, withMusic };
