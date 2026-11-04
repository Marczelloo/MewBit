// Producer of /cache/phrases/<id>.json (generator phrases + timing per song) that phrase_density.py, rel_proxy_select.py and dcommon.py read.
// Recomposes analyse() (not exported) from its pieces; the Node generator files are only required, never changed.
// Usage: node dump_phrases.js <comma-separated song ids> <outdir> [charts dir] [features dir]
//   charts dir   default <repo>/helpers/mewbeat/charts/ (resolved from this file: ../../../helpers/mewbeat/charts/)
//   features dir default <repo>/.mewbeat-debug/data/features (Features v4 JSON, <id>.json)
// Used on the 80 TRAIN songs only (ids = the *.pkl names in /scripts/feat minus the test ids and "hd"); regenerating them reproduced the
// cached files byte for byte. Refuses any id of the held-out test set (the TEST list of extract.py) before reading a file.
// dcommon.py reads the output from /cache/phrases (inside the mewbeat-ma container, the host dir mounted as /cache).
const fs = require("fs"), path = require("path");
const TEST = new Set("310607 363594 563569 636959 808872 859248 923488 1000722 1277503 1329723 1570640 1697477 1773164 1784295 1894317 2200258 2224035 2270163 2314654 2515207".split(" "));
const repo = path.resolve(__dirname, "../../..");
const R = (process.argv[4] || path.join(repo, "helpers/mewbeat/charts")).replace(/[\\/]?$/, "/");
const feat = process.argv[5] || path.join(repo, ".mewbeat-debug/data/features");
if (!process.argv[2] || !process.argv[3]) { console.error("usage: node dump_phrases.js <ids,comma-separated> <outdir> [charts dir] [features dir]"); process.exit(2); }
const banned = process.argv[2].split(",").filter((id) => TEST.has(id.trim()));
if (banned.length) { console.error("refusing test song ids: " + banned.join(",")); process.exit(2); }
const { withMergedLead } = require(R + "legato");
const { buildTiming, energyLookup } = require(R + "timing");
const { buildPhrases, chooseLeaders, isRepeatOf } = require(R + "phrases");
const { withIntensity } = require(R + "intensity");
const { sectionStarts } = require(R + "sections");
const ids = process.argv[2].split(",").map((id) => id.trim());
const out = process.argv[3];
for (const id of ids) {
  const raw = JSON.parse(fs.readFileSync(path.join(feat, id + ".json"), "utf8"));
  const features = withMergedLead(raw);
  const durationMs = Math.round(features.durationMs);
  const timing = buildTiming(features, durationMs);
  const phrases = buildPhrases(features, timing, durationMs);
  const leaders = chooseLeaders(phrases);
  const energy = withIntensity(energyLookup(features), features, phrases);
  const sections = sectionStarts(features, timing, energy);
  fs.writeFileSync(path.join(out, id + ".json"), JSON.stringify({
    id, durationMs,
    timing: { snapped: timing.snapped, beats: timing.beats, downbeats: timing.downbeats, medianMs: timing.medianMs, foldFactor: timing.foldFactor },
    phrases: phrases.map((p, i) => ({ index: p.index, startMs: p.startMs, endMs: p.endMs, repeatOf: p.repeatOf, similarity: p.similarity, lagMs: p.lagMs, heard: p.heard, activity: p.activity, confidence: p.confidence, rate: p.rate, energy: p.energy, pulse: p.pulse, sectionStart: p.sectionStart, isRepeat: !!isRepeatOf(p, i) , intensity: energy.intensity((p.startMs + p.endMs) / 2)})),
    sections, energy: { hopMs: energy.hopMs, values: (features.energy && features.energy.values) || [] },
  }));
}
console.log("done", ids.length);
