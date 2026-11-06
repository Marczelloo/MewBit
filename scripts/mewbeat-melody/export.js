// Decoded songs -> helpers/data/mewbeat/melody/<audio key file>.json, which the chart store reads (chartStore.js).
// Usage: node scripts/mewbeat-melody/export.js <decoder output dir> [features dir] [melody dir]
// Each <decoder output dir>/<audio key file>.json is { notes: [[t, len, midi, vel, conf, onset, layer, ghost, wob]],
// fg: [note indices] } (research decoder, decoder.py). Writes `notes`, the decoder's own foreground line, and `tuned`,
// the line drawn again with line.js TUNED (Normal's melodyTuned). Both are shifted by the song's median offset to our
// lead line, as the two detectors place a note's start differently.
const fs = require("node:fs");
const path = require("node:path");
const { TUNED, foreground } = require("./line");

const root = path.join(__dirname, "..", "..", "helpers", "data", "mewbeat");
const [decDir, featDir = path.join(root, "features"), outDir = path.join(root, "melody")] = process.argv.slice(2);
if (!decDir) {
  console.error("usage: node scripts/mewbeat-melody/export.js <decoder output dir> [features dir] [melody dir]");
  process.exit(1);
}

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

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(decDir).filter((f) => f.endsWith(".json"))) {
  const featFile = path.join(featDir, file);
  if (!fs.existsSync(featFile)) {
    console.log(file, "skipped: no features");
    continue;
  }
  const d = JSON.parse(fs.readFileSync(path.join(decDir, file), "utf8"));
  const lead = JSON.parse(fs.readFileSync(featFile, "utf8")).lead || [];
  const fg = (d.fg || []).map((i) => d.notes[i]);
  const shift = -medianOffset(fg, lead);
  const out = (n) => ({ t: Math.round(n[0] + shift), pitch: n[2], conf: 1, len: Math.round(n[1]) });
  const notes = fg.map(out);
  const tuned = foreground(d.notes, TUNED).map((i) => out(d.notes[i]));
  const source = "basic-pitch foreground line (research decoder, decoder.py); tuned: scripts/mewbeat-melody/line.js TUNED";
  fs.writeFileSync(path.join(outDir, file), JSON.stringify({ source, shiftMs: Math.round(shift), notes, tuned }));
  console.log(file, "notes", notes.length, "tuned", tuned.length, "shift", Math.round(shift));
}
