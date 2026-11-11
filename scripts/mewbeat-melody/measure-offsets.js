#!/usr/bin/env node
// Measures the audio offset (helpers/mewbeat/audioOffset.js) of every stored audio file that has features, one at a time through
// the decoder service, and prints a table: id (first 8 hex of the audio key file), offsetMs, confidence, and the rest of what the
// service says. Nothing is written to the data directory unless --store is given (the records then go where the bot looks).
//
//   node scripts/mewbeat-melody/measure-offsets.js --url http://127.0.0.1:8090
//   node scripts/mewbeat-melody/measure-offsets.js --dir <data dir> --url http://127.0.0.1:8091 --expect table.txt
//
//   --url <service>   the decoder service (default MEWBEAT_DECODER_URL)
//   --dir <dir>       the mewbeat data directory holding audio/ and features/ (default helpers/data/mewbeat); only read
//   --store           keep the records in <dir>/offset (what the bot reads) instead of a throwaway folder
//   --force           measure again even when a valid record exists (with --store)
//   --expect <file>   lines "<id prefix> <offset ms>"; the table gets the difference to them and a count within 5 ms
//
// offsetMs > 0: the features (the chart) lie later than the same sounds in the audio; chart time = audio position + offsetMs.
// "unknown" is an offset below the confidence threshold (audioOffset.MIN_CONFIDENCE) or one the service could not measure.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { MIN_CONFIDENCE, createAudioOffset } = require("../../helpers/mewbeat/audioOffset");

function parseArgs(argv) {
  const args = { dir: path.join(__dirname, "..", "..", "helpers", "data", "mewbeat"), url: process.env.MEWBEAT_DECODER_URL, store: false, force: false, expect: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--url") args.url = argv[++i];
    else if (flag === "--dir") args.dir = path.resolve(argv[++i]);
    else if (flag === "--expect") args.expect = argv[++i];
    else if (flag === "--store") args.store = true;
    else if (flag === "--force") args.force = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

const pad = (value, width) => String(value).padStart(width);
const signed = (value) => (value > 0 ? `+${value}` : String(value));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error("No decoder service: pass --url http://127.0.0.1:8090 or set MEWBEAT_DECODER_URL.");
    process.exit(2);
  }
  const expected = new Map();
  if (args.expect) {
    for (const line of fs.readFileSync(args.expect, "utf8").split(/\r?\n/)) {
      const [id, offset] = line.trim().split(/\s+/);
      if (id && Number.isFinite(Number(offset))) expected.set(id, Number(offset));
    }
  }

  const scratch = args.store ? null : fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-offsets-"));
  const quiet = { info() {}, warning: (...message) => console.error("warning:", ...message), error: (...message) => console.error("error:", ...message) };
  const offsets = createAudioOffset({ dir: args.dir, offsetDir: scratch ?? path.join(args.dir, "offset"), url: args.url, enabled: true, log: quiet });
  try {
    const stems = (await offsets.stemsOnDisk()).sort();
    console.log(`${stems.length} audio files in ${path.join(args.dir, "audio")}; threshold ${MIN_CONFIDENCE}`);
    console.log(`${"id".padEnd(9)}${pad("offsetMs", 9)}${pad("raw", 6)}${pad("conf", 7)}${pad("peak", 7)}${pad("margin", 8)}${pad("onsets", 8)}${pad("win s", 7)}${pad("took s", 8)}  status${expected.size ? "      expected  diff" : ""}`);
    let within = 0;
    let compared = 0;
    for (const stem of stems) {
      const started = Date.now();
      const result = await offsets.ensureStem(stem, { priority: "play", force: args.force });
      const took = ((Date.now() - started) / 1000).toFixed(1);
      const id = stem.slice(0, 8);
      const cells = [
        id.padEnd(9),
        pad(result.offsetMs === null || result.offsetMs === undefined ? "unknown" : signed(result.offsetMs), 9),
        pad(Number.isFinite(result.rawOffsetMs) ? signed(result.rawOffsetMs) : "-", 6),
        pad(Number.isFinite(result.confidence) ? result.confidence.toFixed(3) : "-", 7),
        pad(Number.isFinite(result.peak) ? result.peak.toFixed(3) : "-", 7),
        pad(Number.isFinite(result.margin) ? result.margin.toFixed(3) : "-", 8),
        pad(result.onsets ?? "-", 8),
        pad(result.windowS ?? "-", 7),
        pad(took, 8),
        `  ${result.status}`,
      ];
      if (expected.size) {
        const want = expected.get(id);
        if (want === undefined) cells.push("       (not in table)");
        else {
          const raw = Number.isFinite(result.rawOffsetMs) ? result.rawOffsetMs : null;
          const diff = raw === null ? null : raw - want;
          if (diff !== null) {
            compared += 1;
            if (Math.abs(diff) <= 5) within += 1;
          }
          cells.push(`   ${pad(signed(want), 8)}  ${diff === null ? "-" : signed(diff)}`);
        }
      }
      console.log(cells.join(""));
    }
    if (expected.size) console.log(`within 5 ms of the table: ${within} of ${compared} compared`);
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
