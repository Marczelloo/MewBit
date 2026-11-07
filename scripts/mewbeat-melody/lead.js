// MuScriptor transcriptions -> `lead` in helpers/data/mewbeat/melody/<audio key file>.json, which the chart store reads
// (charts/melodyFile.js). Usage: node scripts/mewbeat-melody/lead.js <transcription dir> [features dir] [melody dir]
// Each <transcription dir>/<audio key file>.json is MuScriptor's json output (Kyutai, small model, CPU), made with:
//   muscriptor transcribe <audio> -m small -d cpu -f json -o <dir>/<audio key file>.json
// in a python:3.12 image with torch (CPU) and `pip install muscriptor`; the weights are gated on HuggingFace
// (MuScriptor/muscriptor-small, CC BY-NC 4.0), read with the user's own token. Its notes carry an instrument, so a lead
// over a bass and a held bed in the same register comes apart from them, which no detector of ours does: REVOLVANIA
// 0:20-0:40, the MEGALOVANIA motif on a buzzing synth (labelled distorted_electric_guitar), 53 of 60 notes in the plain
// bars with 9 others, the decoder's short notes 53 with 20. `lead` is [[t, len, pitch, instrument]], shifted by the
// median offset to our onsets (MuScriptor places starts about 28 ms late). Writes nothing for a song with no melody file.
const fs = require("node:fs");
const path = require("node:path");
const { medianOnsetOffset } = require("./offsets");

const root = path.join(__dirname, "..", "..", "helpers", "data", "mewbeat");
const [inDir, featDir = path.join(root, "features"), outDir = path.join(root, "melody")] = process.argv.slice(2);
if (!inDir) {
  console.error("usage: node scripts/mewbeat-melody/lead.js <transcription dir> [features dir] [melody dir]");
  process.exit(1);
}

// MuScriptor's events (start with an index, end pointing at it) -> [[t, len, pitch, instrument]] in ms, by time.
function notesOf(events) {
  const open = new Map(), out = [];
  for (const e of events) {
    if (e.type === "start") {
      const n = [Math.round(e.start_time * 1000), 0, e.pitch, e.instrument];
      open.set(e.index, n);
      out.push(n);
    } else if (e.type === "end" && open.has(e.start_event_index)) {
      const n = open.get(e.start_event_index);
      n[1] = Math.round(e.end_time * 1000) - n[0];
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

for (const file of fs.readdirSync(inDir).filter((f) => f.endsWith(".json"))) {
  const melodyFile = path.join(outDir, file), featFile = path.join(featDir, file);
  if (!fs.existsSync(melodyFile) || !fs.existsSync(featFile)) {
    console.log(file, "skipped: no melody or features file");
    continue;
  }
  const notes = notesOf(JSON.parse(fs.readFileSync(path.join(inDir, file), "utf8")));
  const pitched = notes.filter((n) => n[3] !== "drums");
  const shift = -medianOnsetOffset(pitched, JSON.parse(fs.readFileSync(featFile, "utf8")));
  const melody = JSON.parse(fs.readFileSync(melodyFile, "utf8"));
  melody.lead = pitched.map(([t, len, pitch, instrument]) => [Math.round(t + shift), len, pitch, instrument]);
  fs.writeFileSync(melodyFile, JSON.stringify(melody));
  const counts = {};
  for (const n of pitched) counts[n[3]] = (counts[n[3]] ?? 0) + 1;
  console.log(file, "lead notes", pitched.length, "shift", Math.round(shift), JSON.stringify(counts));
}
