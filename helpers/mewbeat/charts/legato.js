// The pitch tracker cuts a held vocal note into fragments; merge them back so the note is as long as it sounds.
// Done once on the features, so the leader choice and the patterns both read the merged line.
const LEGATO_MAX_GAP_MS = 60; // fragments this close (or overlapping) are one note...
const LEGATO_MAX_RANGE_SEMITONES = 1; // ...while the run's pitch range stays within this

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function mergeRun(run) {
  if (run.length === 1) return run[0];
  const first = run[0];
  const end = Math.max(...run.map((n) => n.t + (Number(n.len) || 0)));
  return {
    ...first,
    len: end - first.t,
    conf: mean(run.map((n) => Number(n.conf) || 0)),
    s: Math.max(...run.map((n) => Number(n.s) || 0)),
  };
}

// mergeLegato(notes) -> notes with legato runs merged (onset and pitch of the first fragment).
function mergeLegato(notes) {
  if (!Array.isArray(notes)) return notes;
  const sorted = notes.every((n) => Number.isFinite(n?.t) && Number.isFinite(n?.pitch))
    ? [...notes].sort((a, b) => a.t - b.t)
    : null;
  if (!sorted) return notes;
  const out = [];
  let run = [];
  let lo = 0;
  let hi = 0;
  let end = 0;
  for (const n of sorted) {
    const joins =
      run.length > 0 &&
      n.t - end <= LEGATO_MAX_GAP_MS &&
      Math.max(hi, n.pitch) - Math.min(lo, n.pitch) <= LEGATO_MAX_RANGE_SEMITONES;
    if (!joins) {
      if (run.length > 0) out.push(mergeRun(run));
      run = [];
      lo = n.pitch;
      hi = n.pitch;
      end = 0;
    }
    run.push(n);
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
    end = Math.max(end, n.t + (Number(n.len) || 0));
  }
  if (run.length > 0) out.push(mergeRun(run));
  return out;
}

// The features with the lead line merged (everything else is shared, not copied).
function withMergedLead(features) {
  return Array.isArray(features?.lead) ? { ...features, lead: mergeLegato(features.lead) } : features;
}

module.exports = { LEGATO_MAX_GAP_MS, LEGATO_MAX_RANGE_SEMITONES, mergeLegato, withMergedLead };
