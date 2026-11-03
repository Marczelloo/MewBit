// Stage 3 sensitivity check: the unmodified generator with one level's parameters overridden in memory.
// Nothing in helpers/ is changed: DIFFICULTIES is the exported config object, and this process alone edits its copy.
//
//   node ablation_generate.js <features.json> <out.json> <level> '<json overrides>'
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const CHARTS = join(resolve(__dirname, "..", ".."), "helpers", "mewbeat", "charts");
const { DIFFICULTIES } = require(join(CHARTS, "difficulty.js"));
const { generateChart } = require(join(CHARTS, "generate.js"));

const [featuresPath, outPath, level, overridesJson] = process.argv.slice(2);
const overrides = JSON.parse(overridesJson || "{}");
for (const [k, v] of Object.entries(overrides)) {
  if (v === "__delete__") delete DIFFICULTIES[level][k];
  else DIFFICULTIES[level][k] = v;
}
const chart = generateChart(JSON.parse(readFileSync(featuresPath, "utf8")), level, "ablation");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ level, overrides, chart }));
