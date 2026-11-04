// Producer of /cache/phrases/<id>.json (generator phrases + timing per song) that phrase_density.py, rel_proxy_select.py and dcommon.py read.
// Recomposes analyse() (not exported) from its pieces; the Node generator files are only required, never changed.
// Usage: node dump_phrases.js <comma-separated song ids> <outdir>. Used on the 80 TRAIN songs only (ids = the *.pkl names in
// /scripts/feat minus the test ids and "hd"); regenerating them reproduced the cached files byte for byte.
const fs = require("fs"), path = require("path");
const R = "C:/Users/moskw/Documents/dev/MewBit/helpers/mewbeat/charts/";
const { withMergedLead } = require(R + "legato");
const { buildTiming, energyLookup } = require(R + "timing");
const { buildPhrases, chooseLeaders, isRepeatOf } = require(R + "phrases");
const { withIntensity } = require(R + "intensity");
const { sectionStarts } = require(R + "sections");
const feat = "C:/Users/moskw/Documents/dev/MewBit/.mewbeat-debug/data/features";
const ids = process.argv[2].split(",");
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
