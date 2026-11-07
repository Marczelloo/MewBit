// The chart debugger: see and hear a chart beside the music, and ask any note why it is there.
//
//   node scripts/mewbeat-debug/export.mjs   (once: copies the training songs to .mewbeat-debug/data)
//   node scripts/mewbeat-debug/server.mjs   (then open http://localhost:5180)
//
// Charts are made live from the code in helpers/mewbeat/charts, so an edit there shows on the next load, no restart.
// The songs the bot's players played come from helpers/data/mewbeat (history, features, audio) and show first. The bot
// deletes the charts of older generator versions, so the chart files it made are copied to .mewbeat-debug/played-charts
// once seen and offered as snapshots.
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 5180;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DATA = join(REPO, ".mewbeat-debug/data");
const PREVIEW = join(REPO, ".mewbeat-preview");
const PUBLIC = join(HERE, "public");
const CHARTS = join(REPO, "helpers/mewbeat/charts") + sep;
const LEVELS = ["easy", "normal", "hard", "hell"];
const SNAPSHOTS = ["v19", "v20", "v21", "v22", "v23", "v24", "v25", "v26", "v27", "v29"];
const PREVIEW_PREFIX = "preview:";
const PLAYED_PREFIX = "played:";
const BOT_DATA = join(REPO, "helpers/data/mewbeat");
const BOT_CHARTS = join(BOT_DATA, "charts");
const PLAYED_CHARTS = join(REPO, ".mewbeat-debug/played-charts");
const SHA1 = /^[0-9a-f]{40}$/;
// <sha1 of the audio key>.<label>.json, the label being the version, then the generator flags: v31 or v31-density-holds.
const CHART_FILE = /^([0-9a-f]{40})\.(v\d+(?:-[A-Za-z0-9_-]+)?)\.json$/;
const SNAPSHOT_LABEL = /^v\d+(?:-[A-Za-z0-9_-]+)?$/;

const require = createRequire(import.meta.url);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4" };

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// The generator as it is on disk right now.
function freshGenerator() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(CHARTS)) delete require.cache[key];
  return { ...require(join(CHARTS, "generate.js")), ...require(join(CHARTS, "metrics.js")) };
}

function previewSongs() {
  if (!existsSync(PREVIEW)) return [];
  return readdirSync(PREVIEW)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const slug = name.slice(0, -".json".length);
      if (!existsSync(join(PREVIEW, `${slug}.pcm.wav`))) return [];
      try {
        const { track, query } = readJson(join(PREVIEW, name));
        const artist = track?.author ?? "";
        const title = track?.title ?? query ?? slug;
        return [{ id: `${PREVIEW_PREFIX}${slug}`, artist, title, creator: null, genre: "preview", humanBpm: null, algoBpm: null, onHumanBeat: null, phase: null, audio: `${slug}.pcm.wav`, humanLevels: [], distance: { easy: null, normal: null, hard: null } }];
      } catch {
        return [];
      }
    });
}

// Songs somebody played, last played first, as far as their features and audio are still on disk. A round says when,
// at what level and how it went, never who or where: this page is reachable through a public tunnel.
function playedSongs() {
  const file = join(BOT_DATA, "history.json");
  if (!existsSync(file)) return [];
  let users;
  try {
    users = readJson(file)?.users;
  } catch {
    return [];
  }
  const bySha = new Map();
  for (const entries of Object.values(users ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.audioKey !== "string" || !entry.audioKey) continue;
      const sha = createHash("sha1").update(entry.audioKey).digest("hex");
      if (!bySha.has(sha)) bySha.set(sha, []);
      bySha.get(sha).push(entry);
    }
  }
  const songs = [];
  for (const [sha, entries] of bySha) {
    if (!existsSync(join(BOT_DATA, "features", `${sha}.json`)) || !existsSync(join(BOT_DATA, "audio", `${sha}.ogg`))) continue;
    entries.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const rounds = entries.map((e) => ({
      at: e.at ?? null,
      difficulty: e.difficulty,
      accuracy: e.accuracy ?? null,
      grade: e.grade ?? null,
      mode: e.mode ?? null,
      chartVersion: typeof e.chartVersion === "number" || (typeof e.chartVersion === "string" && e.chartVersion) ? e.chartVersion : null,
    }));
    songs.push({
      id: `${PLAYED_PREFIX}${sha}`, artist: entries[0].artist ?? "", title: entries[0].title ?? sha, creator: null, genre: "played", humanBpm: null, algoBpm: null, onHumanBeat: null, phase: null,
      humanLevels: [], distance: { easy: null, normal: null, hard: null }, rounds,
    });
  }
  return songs.sort((a, b) => (b.rounds[0].at ?? 0) - (a.rounds[0].at ?? 0));
}

function allSongs() {
  const train = existsSync(join(DATA, "songs.json")) ? readJson(join(DATA, "songs.json")) : [];
  return [...playedSongs(), ...train, ...previewSongs()];
}

const isPreview = (id) => id.startsWith(PREVIEW_PREFIX);
const previewSlug = (id) => id.slice(PREVIEW_PREFIX.length);
const isPlayed = (id) => id.startsWith(PLAYED_PREFIX);
const playedSha = (id) => (isPlayed(id) && SHA1.test(id.slice(PLAYED_PREFIX.length)) ? id.slice(PLAYED_PREFIX.length) : null);

// The bot deletes the charts of other generator versions when it runs, so every chart file is copied once, when seen.
// The bot writes a file whole (renamed into place) and so is it copied, so a half copy is never read.
function archivePlayedCharts() {
  if (!existsSync(BOT_CHARTS)) return 0;
  mkdirSync(PLAYED_CHARTS, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(BOT_CHARTS)) {
    if (!CHART_FILE.test(name) || existsSync(join(PLAYED_CHARTS, name))) continue;
    const temp = join(PLAYED_CHARTS, `${name}.tmp`);
    try {
      copyFileSync(join(BOT_CHARTS, name), temp);
      renameSync(temp, join(PLAYED_CHARTS, name));
      copied += 1;
    } catch {
      rmSync(temp, { force: true }); // swept by the bot while copying: nothing left to keep
    }
  }
  return copied;
}

// The stored charts of a song, one label per version and flags: the newest version first, then by the flags.
function playedSnapshots(sha) {
  if (!existsSync(PLAYED_CHARTS)) return [];
  const labels = readdirSync(PLAYED_CHARTS).flatMap((name) => {
    const match = CHART_FILE.exec(name);
    return match && match[1] === sha ? [match[2]] : [];
  });
  const version = (label) => Number(/^v(\d+)/.exec(label)[1]);
  return labels.sort((a, b) => version(b) - version(a) || a.localeCompare(b));
}

function featuresOf(id) {
  if (isPreview(id)) return readJson(join(PREVIEW, `${previewSlug(id)}.json`)).features;
  if (isPlayed(id)) {
    // With the melody decoded offline for it, as the bot charts it (chartStore.js withDecodedMelody).
    const features = readJson(join(BOT_DATA, "features", `${playedSha(id)}.json`));
    const melody = join(BOT_DATA, "melody", `${playedSha(id)}.json`);
    return existsSync(melody) ? require(join(CHARTS, "melodyFile.js")).withMelodyFile(features, readJson(melody)) : features;
  }
  return readJson(join(DATA, "features", `${id}.json`));
}

function humanOf(id) {
  const human = {};
  if (isPreview(id) || isPlayed(id)) return human;
  for (const level of LEVELS) {
    const path = join(DATA, "human", level, `${id}.json`);
    if (existsSync(path)) human[level] = readJson(path);
  }
  return human;
}

function songPayload(id) {
  const song = allSongs().find((s) => s.id === id);
  if (!song) return null;
  if (isPlayed(id)) archivePlayedCharts();
  const f = featuresOf(id);
  return {
    song,
    audioUrl: `/audio/${encodeURIComponent(id)}`,
    features: {
      durationMs: f.durationMs,
      featuresVersion: f.featuresVersion,
      tempo: f.tempo ?? null,
      bands: f.bands ?? [],
      energy: f.energy ?? null,
      sections: f.sections ?? [],
      highlightMs: f.highlightMs ?? null,
      drums: f.drums ?? [],
      bass: f.bass ?? [],
      lead: f.lead ?? [],
      phrases: f.phrases ?? null,
    },
    human: humanOf(id),
    snapshots: isPreview(id) ? [] : isPlayed(id) ? playedSnapshots(playedSha(id)) : SNAPSHOTS,
  };
}

// The generator flags the bot has on (helpers/data/mewbeat/generator-flags.json): the page charts what the game plays.
function botFlags() {
  try {
    const flags = readJson(join(BOT_DATA, "generator-flags.json"))?.flags;
    return Array.isArray(flags) ? flags : [];
  } catch {
    return [];
  }
}

function chartPayload(id, level) {
  const { GENERATOR_VERSION, generateChart, traceChart, chartMetrics } = freshGenerator();
  const { flagsKey } = require(join(CHARTS, "flags.js"));
  const features = featuresOf(id);
  const flags = botFlags();
  const flagged = flagsKey(flags);
  const generatorVersion = flagged ? `${GENERATOR_VERSION}-${flagged}` : GENERATOR_VERSION;
  const started = performance.now();
  const story = traceChart(features, level, "debug", flags);
  const ms = Math.round(performance.now() - started);
  if (!story) return { generatorVersion, usable: false };
  // The promise the whole page rests on: the story told is the story of the very chart the game would get.
  const plain = generateChart(features, level, "debug", flags);
  const bare = story.notes.map(({ id: _id, ...note }) => note);
  const matches = JSON.stringify(bare) === JSON.stringify(plain?.notes ?? []);
  const { chart, ...rest } = story;
  return {
    generatorVersion,
    usable: true,
    matches,
    ms,
    stars: chart?.stars ?? null,
    metrics: chartMetrics(chart, features),
    ...rest,
  };
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
const sendJson = (res, value) => send(res, 200, JSON.stringify(value));
const notFound = (res, what = "not found") => send(res, 404, JSON.stringify({ error: what }));

function sendFile(req, res, path) {
  const size = statSync(path).size;
  const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return send(res, 416, "", type);
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(path).pipe(res);
}

function audioPath(id) {
  const song = allSongs().find((s) => s.id === id);
  if (!song) return null;
  const path = isPreview(id) ? join(PREVIEW, song.audio) : isPlayed(id) ? join(BOT_DATA, "audio", `${playedSha(id)}.ogg`) : join(DATA, "audio", song.audio);
  return existsSync(path) ? path : null;
}

// The blind listening test: only songs listed in listening/index.json are reachable, by exact name.
// The answer key (.mewbeat-debug/listening-key.json) lives outside this folder and is never served.
const LISTENING = join(DATA, "listening");
const LISTENING_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function listeningIndex() {
  const path = join(LISTENING, "index.json");
  if (!existsSync(path)) return [];
  const list = readJson(path);
  if (!Array.isArray(list)) return [];
  return list.filter((e) => typeof e?.song === "string" && LISTENING_NAME.test(e.song)).map((e) => ({ song: e.song, title: String(e.title ?? e.song) }));
}

function listeningRoute(res, parts) {
  if (parts.length === 2) return sendJson(res, listeningIndex());
  if (parts.length === 3) {
    const name = parts[2];
    const path = join(LISTENING, `${name}.json`);
    if (!listeningIndex().some((e) => e.song === name) || !path.startsWith(LISTENING + sep) || !existsSync(path)) return notFound(res, "no such song");
    return sendJson(res, readJson(path));
  }
  return notFound(res);
}

// A stored chart of a played song: only by a validated label, only from the archive folder.
function playedSnapshotRoute(res, sha, level, label) {
  const path = join(PLAYED_CHARTS, `${sha}.${label}.json`);
  if (!SNAPSHOT_LABEL.test(label) || !path.startsWith(PLAYED_CHARTS + sep) || !existsSync(path)) return notFound(res, "no such snapshot");
  const notes = readJson(path)?.[level]?.notes;
  return Array.isArray(notes) ? sendJson(res, notes) : notFound(res, "no such snapshot");
}

function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "api") {
    if (parts[1] === "listening") return listeningRoute(res, parts);
    if (parts[1] === "songs") {
      archivePlayedCharts();
      return sendJson(res, allSongs());
    }
    if (parts[1] === "song" && parts[2]) {
      const payload = songPayload(parts[2]);
      return payload ? sendJson(res, payload) : notFound(res, "no such song");
    }
    if (parts[1] === "chart" && parts[2] && LEVELS.includes(parts[3])) {
      if (!allSongs().some((s) => s.id === parts[2])) return notFound(res, "no such song");
      return sendJson(res, chartPayload(parts[2], parts[3]));
    }
    if (parts[1] === "snapshot" && playedSha(parts[2] ?? "") && LEVELS.includes(parts[3])) return playedSnapshotRoute(res, playedSha(parts[2]), parts[3], parts[4] ?? "");
    if (parts[1] === "snapshot" && parts[2] && LEVELS.includes(parts[3]) && SNAPSHOTS.includes(parts[4])) {
      const path = join(DATA, "charts", parts[4], parts[3], `${parts[2]}.json`);
      return existsSync(path) ? sendJson(res, readJson(path)) : notFound(res, "no such snapshot");
    }
    return notFound(res);
  }
  if (parts[0] === "audio" && parts[1]) {
    const path = audioPath(parts[1]);
    return path ? sendFile(req, res, path) : notFound(res, "no audio");
  }
  const file = resolve(PUBLIC, parts.length ? parts.join("/") : "index.html");
  if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) return notFound(res);
  return sendFile(req, res, file);
}

console.log(`archived ${archivePlayedCharts()} new chart files from the bot`);

createServer((req, res) => {
  try {
    route(req, res);
  } catch (error) {
    console.error(error);
    send(res, 500, JSON.stringify({ error: String(error?.stack ?? error) }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mewbeat debugger: http://localhost:${PORT}`));
