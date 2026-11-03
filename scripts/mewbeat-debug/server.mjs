// The chart debugger: see and hear a chart beside the music, and ask any note why it is there.
//
//   node scripts/mewbeat-debug/export.mjs   (once: copies the training songs to .mewbeat-debug/data)
//   node scripts/mewbeat-debug/server.mjs   (then open http://localhost:5180)
//
// Charts are made live from the code in helpers/mewbeat/charts, so an edit there shows on the next load, no restart.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
const SNAPSHOTS = ["v19", "v20", "v21"];
const PREVIEW_PREFIX = "preview:";

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

function allSongs() {
  const train = existsSync(join(DATA, "songs.json")) ? readJson(join(DATA, "songs.json")) : [];
  return [...train, ...previewSongs()];
}

const isPreview = (id) => id.startsWith(PREVIEW_PREFIX);
const previewSlug = (id) => id.slice(PREVIEW_PREFIX.length);

function featuresOf(id) {
  if (isPreview(id)) return readJson(join(PREVIEW, `${previewSlug(id)}.json`)).features;
  return readJson(join(DATA, "features", `${id}.json`));
}

function humanOf(id) {
  const human = {};
  if (isPreview(id)) return human;
  for (const level of LEVELS) {
    const path = join(DATA, "human", level, `${id}.json`);
    if (existsSync(path)) human[level] = readJson(path);
  }
  return human;
}

function songPayload(id) {
  const song = allSongs().find((s) => s.id === id);
  if (!song) return null;
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
    snapshots: isPreview(id) ? [] : SNAPSHOTS,
  };
}

function chartPayload(id, level) {
  const { GENERATOR_VERSION, generateChart, traceChart, chartMetrics } = freshGenerator();
  const features = featuresOf(id);
  const started = performance.now();
  const story = traceChart(features, level, "debug");
  const ms = Math.round(performance.now() - started);
  if (!story) return { generatorVersion: GENERATOR_VERSION, usable: false };
  // The promise the whole page rests on: the story told is the story of the very chart the game would get.
  const plain = generateChart(features, level, "debug");
  const bare = story.notes.map(({ id: _id, ...note }) => note);
  const matches = JSON.stringify(bare) === JSON.stringify(plain?.notes ?? []);
  const { chart, ...rest } = story;
  return {
    generatorVersion: GENERATOR_VERSION,
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
  const path = isPreview(id) ? join(PREVIEW, song.audio) : join(DATA, "audio", song.audio);
  return existsSync(path) ? path : null;
}

function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "api") {
    if (parts[1] === "songs") return sendJson(res, allSongs());
    if (parts[1] === "song" && parts[2]) {
      const payload = songPayload(parts[2]);
      return payload ? sendJson(res, payload) : notFound(res, "no such song");
    }
    if (parts[1] === "chart" && parts[2] && LEVELS.includes(parts[3])) {
      if (!allSongs().some((s) => s.id === parts[2])) return notFound(res, "no such song");
      return sendJson(res, chartPayload(parts[2], parts[3]));
    }
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

createServer((req, res) => {
  try {
    route(req, res);
  } catch (error) {
    console.error(error);
    send(res, 500, JSON.stringify({ error: String(error?.stack ?? error) }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mewbeat debugger: http://localhost:${PORT}`));
