// Copies what the chart debugger shows out of the mapping-analysis Docker volume into .mewbeat-debug/data (gitignored):
// the training songs ONLY. The 20 test songs stay out, so the generator can't be tuned on them by looking.
//
//   node scripts/mewbeat-debug/export.mjs
//
// On the host it starts itself inside the mewbeat-ma image, where the volume is at /work.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEVELS = ["easy", "normal", "hard"];
const WORK = "/work";
// The saved runs of the generator, oldest first: their charts are shown beside the live one.
const SNAPSHOTS = {
  v19: `${WORK}/data/algo_charts`,
  v20: `${WORK}/e1/data/algo_charts`,
  v21: `${WORK}/h21/data/algo_charts`,
  v22: `${WORK}/p2run/data/algo_charts`,
  v23: `${WORK}/s3/data/algo_charts`,
  v24: `${WORK}/s4/data/algo_charts`,
  v25: `${WORK}/s5/data/algo_charts`,
  v26: `${WORK}/s7/data/algo_charts`,
};
const RUN = `${WORK}/s7/run-train`;
const FEATURES = `${WORK}/p2run/data/features`; // v4: the first version with the one of the bar found phrase by phrase

if (!process.env.MEWBEAT_EXPORT_INSIDE) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const out = resolve(repo, ".mewbeat-debug/data");
  mkdirSync(out, { recursive: true });
  const run = spawnSync(
    "docker",
    ["run", "--rm", "-e", "MEWBEAT_EXPORT_INSIDE=1", "-v", `${repo}:/repo:ro`, "-v", `${out}:/out`, "-v", "mewbeat-ma:/work", "mewbeat-ma", "node", "/repo/scripts/mewbeat-debug/export.mjs"],
    { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  process.exit(run.status ?? 1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n") row.push(cell.replace(/\r$/, "")), rows.push(row), (row = []), (cell = "");
    else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((name, i) => [name, r[i] ?? ""])));
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const bySetId = (path) => (existsSync(path) ? Object.fromEntries(parseCsv(readFileSync(path, "utf8")).map((r) => [r.set_id, r])) : {});
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

const train = parseCsv(readFileSync("/repo/mapping-analysis/shared/corpus.csv", "utf8")).filter((r) => r.split === "train");
const grid = bySetId(`${RUN}/synthesis/grid_quality.csv`);
const distance = bySetId(`${RUN}/compare/synthesis/level_distance_per_song.csv`);
const number = (x) => (x === "" || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));

const songs = [];
for (const row of train) {
  const id = row.set_id;
  const info = readJson(`${RUN}/data/songs/${id}.json`);
  if (info.split !== "train") throw new Error(`${id} is not a training song`);
  const audioName = `${id}${extname(info.audio)}`;
  const audioFrom = `${WORK}/data/audio/${info.audio}`;
  if (!existsSync(audioFrom)) throw new Error(`no audio for ${id}: ${audioFrom}`);
  mkdirSync("/out/audio", { recursive: true });
  mkdirSync("/out/features", { recursive: true });
  copyFileSync(audioFrom, `/out/audio/${audioName}`);
  copyFileSync(`${FEATURES}/${id}.json`, `/out/features/${id}.json`);

  const levels = {};
  for (const level of LEVELS) {
    const human = `${RUN}/data/${level}/notes/human_${id}.json`;
    if (existsSync(human)) {
      write(`/out/human/${level}/${id}.json`, readJson(human).notes);
      levels[level] = true;
    }
    for (const [name, dir] of Object.entries(SNAPSHOTS)) {
      const path = `${dir}/${level}/${id}.json`;
      if (existsSync(path)) write(`/out/charts/${name}/${level}/${id}.json`, readJson(path).chart?.notes ?? []);
    }
  }
  const g = grid[id];
  songs.push({
    id,
    artist: row.artist,
    title: row.title,
    creator: row.creator,
    genre: row.genre,
    humanBpm: number(g?.human_bpm) ?? number(row.bpm),
    algoBpm: number(g?.algo_bpm),
    onHumanBeat: number(g?.on_human_beat),
    phase: number(g?.phase),
    audio: audioName,
    humanLevels: Object.keys(levels),
    // Distance of the saved v26 chart from the human one, per level (level_distance.py): where to look first.
    distance: Object.fromEntries(LEVELS.map((level) => [level, number(distance[id]?.[level])])),
  });
  console.log(`${songs.length}/${train.length} ${row.artist} - ${row.title}`);
}
songs.sort((a, b) => `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`));
write("/out/songs.json", songs);
console.log(`exported ${songs.length} training songs`);
