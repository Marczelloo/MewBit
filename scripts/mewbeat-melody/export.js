// Decoded songs -> helpers/data/mewbeat/melody/<audio key file>.json, which the chart store reads (chartStore.js).
// Usage: node scripts/mewbeat-melody/export.js <decoder output dir> [features dir] [melody dir] [--short <dir>]
// Each <decoder output dir>/<audio key file>.json is { notes, fg } (decoder.py of the research decoder, or decoder/decode.py,
// whose `short` is then read too), and with --short <dir>/<audio key file>.json is { notes: [[t, len, midi, vel]] }, a second run
// at a lower onset threshold. The file itself is made by build.js (melodyFileOf), which says what is in it.
const fs = require("node:fs");
const path = require("node:path");
const { melodyFileOf } = require("./build");

const root = path.join(__dirname, "..", "..", "helpers", "data", "mewbeat");
const args = process.argv.slice(2);
const shortAt = args.indexOf("--short");
const shortDir = shortAt >= 0 ? args.splice(shortAt, 2)[1] : null;
const [decDir, featDir = path.join(root, "features"), outDir = path.join(root, "melody")] = args;
if (!decDir) {
  console.error("usage: node scripts/mewbeat-melody/export.js <decoder output dir> [features dir] [melody dir]");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(decDir).filter((f) => f.endsWith(".json"))) {
  const featFile = path.join(featDir, file);
  if (!fs.existsSync(featFile)) {
    console.log(file, "skipped: no features");
    continue;
  }
  const d = JSON.parse(fs.readFileSync(path.join(decDir, file), "utf8"));
  const features = JSON.parse(fs.readFileSync(featFile, "utf8"));
  const shortFile = shortDir && path.join(shortDir, file);
  const short = shortFile && fs.existsSync(shortFile) ? JSON.parse(fs.readFileSync(shortFile, "utf8")).notes : d.short ?? null;
  const melody = melodyFileOf(d, features, short);
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(melody));
  console.log(file, "notes", melody.notes.length, "tuned", melody.tuned.length, "shift", melody.shiftMs, "onset shift", melody.onsetShiftMs);
}
