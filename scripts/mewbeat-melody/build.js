// A song's melody file (helpers/data/mewbeat/melody/<audio key file>.json, which the chart store reads: chartStore.js) from its
// decoded notes. Used by export.js (decodes made by hand) and by helpers/mewbeat/melodyDecoder.js (decodes made as songs are charted).
// `decoded` is { notes: [[t, len, midi, vel, conf, onset, layer, ghost, wob]], fg: [note indices] } (decoder/decode.py). Gives
// `notes`, the decoder's own foreground line, and `tuned`, the line drawn again with line.js TUNED (Normal's melodyTuned). Both
// are shifted by the song's median offset to our lead line, as the two detectors place a note's start differently. `all` keeps
// every decoded note as [t, len, pitch, velocity] (sustain.js reads the long ones). `short` is the short notes of a second run at
// a lower onset threshold, [[t, len, midi, vel]]: a quiet line under a loud bed, which the first run misses (REVOLVANIA 0:20-0:42,
// a low synth: 12 of the motif's 20 notes at .5, 17 at .35). `onsetShiftMs` is the shift to the nearest onset of any of our layers
// (drums, bass, lead) instead, read with Normal's flag melodyOnsetShift: the lead's same-pitch matches are few on some songs
// (Rude Buster, Camellia remix: its line sat 30 ms early on the grid), the onsets take 90% of the notes.
const { TUNED, foreground } = require("./line");
const { medianOnsetOffset } = require("./offsets");

const SOURCE = "basic-pitch foreground line (research decoder, decoder.py); tuned: scripts/mewbeat-melody/line.js TUNED";

// The median of (decoded start - lead start) over lead notes with a decoded note of the same pitch within 100 ms.
function medianOffset(line, lead) {
  const offs = [];
  for (const n of lead) {
    let best = null;
    for (const m of line) {
      const d = m[0] - n.t;
      if (Math.abs(m[2] - n.pitch) <= 0.6 && Math.abs(d) < 100 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    if (best !== null) offs.push(best);
  }
  offs.sort((a, b) => a - b);
  return offs.length ? offs[offs.length >> 1] : 0;
}

function melodyFileOf(decoded, features, short = null) {
  const lead = features.lead || [];
  const fg = (decoded.fg || []).map((i) => decoded.notes[i]);
  const shift = -medianOffset(fg, lead);
  const onsetShift = -medianOnsetOffset(fg, features);
  const out = (n) => ({ t: Math.round(n[0] + shift), pitch: n[2], conf: 1, len: Math.round(n[1]) });
  const notes = fg.map(out);
  const tuned = foreground(decoded.notes, TUNED).map((i) => out(decoded.notes[i]));
  const all = decoded.notes.map((n) => [Math.round(n[0] + shift), Math.round(n[1]), n[2], Math.round(n[3] * 100) / 100]);
  const shifted = short ? short.map(([t, len, midi, vel]) => [Math.round(t + shift), len, midi, vel]) : null;
  return { source: SOURCE, shiftMs: Math.round(shift), onsetShiftMs: Math.round(onsetShift), notes, tuned, all, ...(shifted ? { short: shifted } : {}) };
}

module.exports = { melodyFileOf };
