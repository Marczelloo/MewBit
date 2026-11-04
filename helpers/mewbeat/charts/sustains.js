// The dragged notes of a song: what a long hold on Normal follows. The pitch tracker cuts a held note into fragments
// and misses much of what lasts (a drawn-out vocal, a violin under the drums), so this is a hint and not a fact: a
// hold on a note that is not there lands on a rest, which is no worse than a hold placed by the rest alone.
const { FALLBACK_BEAT_MS } = require("./difficulty");
const { mergeLegato } = require("./legato");
const { lowerBound } = require("./util");

const SUSTAIN_LAYERS = ["lead", "bass"];
const SUSTAIN_FLOOR_BEATS = 1; // a note shorter than this is not dragged
// A held lead note is often cut into pieces further apart than legato.js glues (a bowed note, the same pitch re-found
// after a dropout): the same pitch again within BRIDGE_GAP_BEATS of the end of the note is the note going on, unless
// a phrase starts in between (a repeated phrase charts like its source, whatever the one before it ended on).
const BRIDGE_GAP_BEATS = 0.7;
const BRIDGE_RANGE_SEMITONES = 0.5;

const beatAt = (timing, t) => (typeof timing?.beatMsAt === "function" ? timing.beatMsAt(t) : FALLBACK_BEAT_MS);

// bridge(notes, timing, starts) -> notes: legato-merged notes, the same pitch going on over a short gap joined into one.
// `starts` are the phrase starts, ascending.
function bridge(notes, timing, starts) {
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    const end = last ? last.t + last.len : 0;
    if (last && lowerBound(starts, last.t + 1) === lowerBound(starts, n.t + 1) && n.t - end <= BRIDGE_GAP_BEATS * beatAt(timing, end) && Math.abs(n.pitch - last.pitch) <= BRIDGE_RANGE_SEMITONES) {
      const joined = Math.max(end, n.t + n.len) - last.t;
      out[out.length - 1] = { ...last, len: joined, conf: (last.conf * last.len + n.conf * n.len) / (last.len + n.len), s: Math.max(last.s, n.s) };
    } else {
      out.push(n);
    }
  }
  return out;
}

// sustainsOf(features, timing) -> [{ t, len, source, conf }], time-sorted: the notes of the lead and the bass, with the
// fragments of one note glued back together (legato.js, and for the lead over a gap too), that last at least
// SUSTAIN_FLOOR_BEATS. No confidence threshold: the tracker is unsure of exactly the notes that last. No lead and no
// bass line: nothing.
function sustainsOf(features, timing) {
  const out = [];
  const starts = (Array.isArray(features?.phrases?.list) ? features.phrases.list : []).map((p) => p.startMs).filter(Number.isFinite).sort((a, b) => a - b);
  for (const source of SUSTAIN_LAYERS) {
    const line = features?.[source];
    const glued = Array.isArray(line) ? mergeLegato(line) : [];
    for (const n of source === "lead" ? bridge(glued, timing, starts) : glued) {
      if (!Number.isFinite(n?.t) || !(Number(n.len) > 0)) continue;
      if (n.len >= SUSTAIN_FLOOR_BEATS * beatAt(timing, n.t)) out.push({ t: n.t, len: n.len, source, conf: Number(n.conf) || 0 });
    }
  }
  return out.sort((a, b) => a.t - b.t || b.len - a.len);
}

module.exports = { sustainsOf };
