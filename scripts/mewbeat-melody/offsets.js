// The median of (decoded start - nearest onset) over decoded notes with one of our onsets within 60 ms.
function medianOnsetOffset(line, features) {
  const onsets = [...(features.drums || []), ...(features.bass || []), ...(features.lead || [])].map((o) => o.t).sort((a, b) => a - b);
  const offs = [];
  for (const m of line) {
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
      const k = (lo + hi) >> 1;
      if (onsets[k] < m[0]) lo = k + 1;
      else hi = k;
    }
    const d = [onsets[lo - 1], onsets[lo]].filter((t) => t !== undefined).map((t) => m[0] - t).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    if (d !== undefined && Math.abs(d) < 60) offs.push(d);
  }
  offs.sort((a, b) => a - b);
  return offs.length ? offs[offs.length >> 1] : 0;
}

module.exports = { medianOnsetOffset };
