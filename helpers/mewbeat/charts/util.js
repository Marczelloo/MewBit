// Small numeric helpers shared by the chart modules.

function lowerBound(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Index of the value nearest to x (ties go to the earlier one), or -1 when empty.
function nearestIndex(sorted, x) {
  if (sorted.length === 0) return -1;
  const i = lowerBound(sorted, x);
  if (i === 0) return 0;
  if (i === sorted.length) return i - 1;
  return x - sorted[i - 1] <= sorted[i] - x ? i - 1 : i;
}

function cleanTimes(list) {
  const times = (Array.isArray(list) ? list : []).filter(Number.isFinite).map(Math.round);
  return [...new Set(times)].sort((a, b) => a - b);
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

module.exports = { clamp01, cleanTimes, lowerBound, median, nearestIndex };
