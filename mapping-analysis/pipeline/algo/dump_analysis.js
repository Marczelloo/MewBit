// The generator's own reading of a song, read-only: beat grid after folding, phrases, repeats and leading layers.
// It calls the exported functions in the order generate.js analyse() does; nothing in helpers/ is changed.
//
//   node dump_analysis.js <features.json> <out.json>
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const CHARTS = join(resolve(__dirname, "..", "..", ".."), "helpers", "mewbeat", "charts");
const { withMergedLead } = require(join(CHARTS, "legato.js"));
const { buildTiming } = require(join(CHARTS, "timing.js"));
const { buildPhrases, chooseLeaders, isVocalSong, supportLayers } = require(join(CHARTS, "phrases.js"));
const { busyFactor } = require(join(CHARTS, "busyness.js"));

const [featuresPath, outPath] = process.argv.slice(2);
if (!featuresPath || !outPath) throw new Error("usage: dump_analysis.js <features.json> <out.json>");
const raw = JSON.parse(readFileSync(featuresPath, "utf8"));
const features = withMergedLead(raw);
const durationMs = Math.round(features.durationMs);
const timing = buildTiming(features, durationMs);
const phrases = buildPhrases(features, timing, durationMs);
const leaders = chooseLeaders(phrases);
const vocal = isVocalSong(phrases);
const out = {
  durationMs,
  tempo: { bpm: raw.tempo?.bpm ?? null, confidence: raw.tempo?.confidence ?? null },
  timing: {
    snapped: timing.snapped,
    medianMs: timing.medianMs,
    foldFactor: timing.foldFactor,
    beats: timing.beats,
    downbeats: timing.downbeats,
  },
  busy: busyFactor(features),
  vocal,
  phrases: phrases.map((p, i) => ({
    startMs: p.startMs,
    endMs: p.endMs,
    repeatOf: p.repeatOf,
    similarity: p.similarity,
    energy: p.energy,
    pulse: p.pulse,
    sectionStart: p.sectionStart,
    leader: leaders[i],
    supports: supportLayers(p, leaders[i], vocal),
  })),
  counts: {
    drums: Object.fromEntries(["kick", "snare", "hat", "perc"].map((k) => [k, (raw.drums ?? []).filter((d) => d.kind === k).length])),
    bass: (raw.bass ?? []).length,
    lead: (raw.lead ?? []).length,
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out));
console.log(`${featuresPath}: grid ${timing.snapped ? `${(60000 / timing.medianMs).toFixed(1)} BPM x${timing.foldFactor}` : "none"}, ${phrases.length} phrases, leaders ${[...new Set(leaders)].join("/")}`);
