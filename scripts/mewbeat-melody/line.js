// The melody line through a song's decoded notes (Basic Pitch via the research decoder, decoder.py), ported from its
// foreground(): a chain of notes maximising their salience above `base`, with a cost of `jump` per octave of a step.
// Each note is [t, len, midi, vel, conf, onset, layer, ghost, wob]. P are the decoder's own values; TUNED draws the line
// denser (base) and smoother (jump), as the melodyTuned flag reads it (charts/flags.js).
const P = { reg_mid: 76, reg_width: 16, bass_top: 48, min_ioi_ms: 85, jump: 0.05, base: 0.62, max_gap_ms: 2500, rep_win_ms: 2500, rep_weight: 0.75, rep_count: 8, norm_win_ms: 4000, norm_q: 85, norm_floor: 0.12 };
const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const upperBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };
// numpy percentile, linear interpolation
function percentile(values, q) {
  const s = [...values].sort((x, y) => x - y);
  const pos = (q / 100) * (s.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function salience(rows, a) {
  const t = rows.map((r) => r[0]);
  const lo = t.map((x) => lowerBound(t, x - a.rep_win_ms)), hi = t.map((x) => lowerBound(t, x + a.rep_win_ms));
  return rows.map((r, i) => {
    const m = r[2];
    const reg = Math.exp(-0.5 * ((m - a.reg_mid) / a.reg_width) ** 2);
    let same = 0;
    for (let k = lo[i]; k < hi[i]; k++) if (k !== i && rows[k][2] === m) same++;
    const rep = Math.min(same / a.rep_count, 1);
    let sal = r[5] ** 1.5 * r[3] ** 0.5 * reg * (1 - a.rep_weight * rep);
    if (r[7] > 0) sal *= 0.4;
    if (m < a.bass_top) sal *= 0.5;
    return sal;
  });
}
function localSalience(rows, a) {
  const sal = salience(rows, a);
  const t = rows.map((r) => r[0]);
  return sal.map((s, i) => {
    const lo = lowerBound(t, t[i] - a.norm_win_ms), hi = lowerBound(t, t[i] + a.norm_win_ms);
    return s / Math.max(percentile(sal.slice(lo, hi), a.norm_q), a.norm_floor);
  });
}
function foreground(rows, params = {}) {
  const a = { ...P, ...params };
  const n = rows.length;
  if (n === 0) return [];
  const sal = localSalience(rows, a);
  const t = rows.map((r) => r[0]), m = rows.map((r) => r[2]);
  const gain = sal.map((s) => s - a.base);
  const best = [...gain], prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0 && t[i] - t[j] <= a.max_gap_ms; j--) {
      if (t[i] - t[j] >= a.min_ioi_ms) {
        const v = best[j] + gain[i] - a.jump * Math.min(Math.abs(m[i] - m[j]) / 12, 2.5);
        if (v > best[i]) { best[i] = v; prev[i] = j; }
      }
    }
  }
  const used = new Array(n).fill(false), out = [];
  const order = [...best.keys()].sort((x, y) => best[y] - best[x] || x - y);
  for (const e of order) {
    if (best[e] <= 0 || used[e]) continue;
    let chain = [];
    for (let i = e; i >= 0 && !used[i]; i = prev[i]) chain.push(i);
    if (!chain.length) continue;
    const lo = t[chain[chain.length - 1]], hi = t[chain[0]];
    chain = chain.filter((c) => !out.some((u) => Math.abs(t[c] - t[u]) < a.min_ioi_ms));
    out.push(...chain);
    for (const c of chain) used[c] = true;
    for (let k = lowerBound(t, lo); k < upperBound(t, hi); k++) used[k] = true;
  }
  return out.sort((x, y) => x - y);
}
const TUNED = { base: 0.2, jump: 0.5 };

module.exports = { P, TUNED, foreground };
