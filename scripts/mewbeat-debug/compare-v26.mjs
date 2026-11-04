// Charts the training songs (and Hopes and Dreams) with the live generator and compares the notes with the v26 snapshot in
// .mewbeat-debug/data/charts: Easy, Normal and Hard must stay what they were. Exits non-zero on any difference.
//
//   node scripts/mewbeat-debug/compare-v26.mjs [--levels easy,hard]
//
// Normal is compared through normalV26, the Normal of v26 that the public Normal leaves behind. A level without a snapshot
// (Hell) is not compared.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { generateChart } = require(join(repo, "helpers/mewbeat/charts/generate.js"));

const DATA = join(repo, ".mewbeat-debug/data");
const GENERATED = { easy: "easy", normal: "normalV26", hard: "hard" }; // snapshot level -> generator level
const HD_FEATURES = join(repo, ".mewbeat-preview/toby-fox-hopes-and-dreams-undertale.json");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const featuresOf = (raw) => raw.features ?? raw;
// What a snapshot keeps of a note.
const plain = (notes) => notes.map((n) => (n.len ? { t: n.t, lane: n.lane, len: n.len } : { t: n.t, lane: n.lane }));

function firstDifference(a, b) {
  if (a.length !== b.length) return `${a.length} notes, snapshot ${b.length}`;
  const i = a.findIndex((n, k) => JSON.stringify(n) !== JSON.stringify(b[k]));
  return i < 0 ? null : `note ${i}: ${JSON.stringify(a[i])}, snapshot ${JSON.stringify(b[i])}`;
}

// The live notes of a level, or the reason they cannot be compared. Another audioKey must not change them.
function liveNotes(features, level) {
  const chart = generateChart(features, GENERATED[level], "compare:a");
  const other = generateChart(features, GENERATED[level], "compare:b");
  if (!chart || !other) return { error: "no chart" };
  const notes = plain(chart.notes);
  if (firstDifference(notes, plain(other.notes))) return { error: "the audioKey changes the notes" };
  return { notes };
}

const arg = process.argv.indexOf("--levels");
const wanted = arg < 0 ? Object.keys(GENERATED) : process.argv[arg + 1].split(",");
const unknown = wanted.filter((level) => !GENERATED[level]);
if (unknown.length) {
  console.error(`No snapshot to compare ${unknown.join(", ")} with (levels: ${Object.keys(GENERATED).join(", ")})`);
  process.exit(2);
}

let differing = 0;
for (const level of wanted) {
  const dir = join(DATA, "charts/v26", level);
  const ids = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
  const problems = [];
  let compared = 0;
  for (const id of ids) {
    const featuresPath = join(DATA, "features", `${id}.json`);
    if (!existsSync(featuresPath)) {
      problems.push(`${id}: no features`);
      continue;
    }
    compared++;
    const live = liveNotes(featuresOf(readJson(featuresPath)), level);
    const why = live.error ?? firstDifference(live.notes, readJson(join(dir, `${id}.json`)));
    if (why) problems.push(`${id}: ${why}`);
  }
  const hdSnapshot = join(DATA, "charts/v26-hd", `${level}.json`);
  if (existsSync(hdSnapshot) && existsSync(HD_FEATURES)) {
    compared++;
    const live = liveNotes(featuresOf(readJson(HD_FEATURES)), level);
    const why = live.error ?? firstDifference(live.notes, readJson(hdSnapshot));
    if (why) problems.push(`hopes-and-dreams: ${why}`);
  }
  differing += problems.length;
  console.log(`${level}: ${compared} songs compared, ${problems.length} differing`);
  for (const p of problems.slice(0, 10)) console.log(`  ${p}`);
}
process.exit(differing ? 1 : 0);
