// Runs the repository's chart generator, unmodified, on features JSON files.
//
//   node generate_charts.js <features.json> <outDir> [--levels easy,normal,hard] [--key <audioKey>]
//
// Writes <outDir>/<level>/<basename>.json per level: the chart exactly as generateChart returns it (null when the
// generator calls the song "not chartable"), plus a "meta" block with the generator version and the inputs.
// Each level goes to its own folder so the per-level analysis never has to open another level's charts.
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { basename, join, resolve } = require("node:path");

const REPO = resolve(__dirname, "..", "..", "..");
const { GENERATOR_VERSION, generateChart } = require(join(REPO, "helpers", "mewbeat", "charts", "generate.js"));

function parse(argv) {
  const opts = { levels: ["easy", "normal", "hard"], key: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--levels") opts.levels = argv[++i].split(",");
    else if (argv[i] === "--key") opts.key = argv[++i];
    else opts.positional.push(argv[i]);
  }
  if (opts.positional.length !== 2) throw new Error("usage: generate_charts.js <features.json> <outDir> [--levels ...] [--key ...]");
  return opts;
}

function main() {
  const { levels, key, positional } = parse(process.argv.slice(2));
  const [featuresPath, outDir] = positional;
  const features = JSON.parse(readFileSync(featuresPath, "utf8"));
  const name = basename(featuresPath).replace(/\.json$/, "");
  const audioKey = key ?? `mapping-analysis:${name}`;
  for (const level of levels) {
    const started = process.hrtime.bigint();
    const chart = generateChart(features, level, audioKey);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const dir = join(outDir, level);
    mkdirSync(dir, { recursive: true });
    const meta = { generatorVersion: GENERATOR_VERSION, features: basename(featuresPath), level, generateMs: Math.round(ms) };
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ meta, chart }));
    console.log(`${name} ${level}: ${chart ? `${chart.notes.length} notes, ${chart.stars} stars` : "not chartable"} (${Math.round(ms)} ms)`);
  }
}

main();
