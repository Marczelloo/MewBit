import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Chart preview tool: finds a track on the local Lavalink, analyses it,
// generates the charts and writes <slug>-<difficulty>.wav, the track's audio
// with a short click mixed in at every note, so a human can hear whether the
// notes match the music.
//
//   node scripts/mewbeat-preview.mjs "<query>" [--difficulty normal|easy|hard|all]
//                                              [--out <dir>] [--json-only]
//   node scripts/mewbeat-preview.mjs --from <slug>.json [--difficulty ...]
//
// --from re-runs the generator on the features saved in <slug>.json (no
// analysis) and re-mixes over the cached <slug>.pcm.wav, so retuning the
// generator is fast. The PCM route needs plugins.mewbeat.debugRoutes: true.
const require = createRequire(import.meta.url);

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const DIFFICULTIES = ["easy", "normal", "hard"];
const LANE_HZ = [700, 1000, 1400, 2000];
const CLICK_MS = 15;
const CLICK_FADE_MS = 1;
const CLICK_GAIN = 0.35;
const PCM_ATTEMPTS = 3;

class PreviewError extends Error {}

// --- WAV ---------------------------------------------------------------------

// Reads a PCM WAV. Finds the chunks by walking them instead of assuming a
// 44-byte header, since writers add LIST and similar chunks.
export function parseWav(buffer) {
  if (
    buffer.length < 12 ||
    buffer.toString("latin1", 0, 4) !== "RIFF" ||
    buffer.toString("latin1", 8, 12) !== "WAVE"
  ) {
    throw new PreviewError("The PCM response is not a RIFF/WAVE file.");
  }
  let format = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("latin1", offset, offset + 4);
    const declared = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      if (!format) throw new PreviewError("The WAV has a data chunk before fmt.");
      if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
        throw new PreviewError("Only 16-bit PCM WAV is supported.");
      }
      // Streamed WAVs may declare 0 or 0xFFFFFFFF; take what is there.
      const available = buffer.length - start;
      const size = declared === 0 || declared > available ? available : declared;
      const frames = Math.floor(size / 2 / format.channels);
      const samples = new Int16Array(frames * format.channels);
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = buffer.readInt16LE(start + i * 2);
      }
      return { sampleRate: format.sampleRate, channels: format.channels, samples };
    }
    offset = start + declared + (declared % 2);
  }
  throw new PreviewError("The WAV has no data chunk.");
}

export function encodeWav({ sampleRate, channels, samples }) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "latin1");
  buffer.write("fmt ", 12, "latin1");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "latin1");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

// Returns a copy of the audio with a lane-pitched click added at every note.
export function mixClicks(audio, notes) {
  const { sampleRate, channels } = audio;
  const out = Int16Array.from(audio.samples);
  const frames = out.length / channels;
  const clickFrames = Math.round((sampleRate * CLICK_MS) / 1000);
  const fadeFrames = Math.max(1, Math.round((sampleRate * CLICK_FADE_MS) / 1000));
  for (const note of notes) {
    const hz = LANE_HZ[note.lane] ?? LANE_HZ[0];
    const startFrame = Math.round((note.t / 1000) * sampleRate);
    for (let i = 0; i < clickFrames; i += 1) {
      const frame = startFrame + i;
      if (frame < 0 || frame >= frames) continue;
      const attack = Math.min(1, i / fadeFrames);
      const release = 1 - i / clickFrames; // linear fade-out to silence
      const click =
        Math.sin((2 * Math.PI * hz * i) / sampleRate) * attack * release * CLICK_GAIN * 32767;
      for (let c = 0; c < channels; c += 1) {
        const index = frame * channels + c;
        out[index] = Math.max(-32768, Math.min(32767, Math.round(out[index] + click)));
      }
    }
  }
  return { sampleRate, channels, samples: out };
}

// --- args / env --------------------------------------------------------------

export function parseArgs(argv) {
  const options = { query: null, difficulty: "normal", out: null, jsonOnly: false, from: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json-only") options.jsonOnly = true;
    else if (arg === "--difficulty" || arg === "--out" || arg === "--from") {
      const value = argv[(i += 1)];
      if (value === undefined) throw new PreviewError(`${arg} needs a value.`);
      if (arg === "--difficulty") options.difficulty = value;
      else if (arg === "--out") options.out = value;
      else options.from = value;
    } else if (arg.startsWith("--")) {
      throw new PreviewError(`Unknown option ${arg}.`);
    } else positional.push(arg);
  }
  options.query = positional.join(" ").trim() || null;
  if (options.difficulty !== "all" && !DIFFICULTIES.includes(options.difficulty)) {
    throw new PreviewError("--difficulty must be easy, normal, hard or all.");
  }
  if (!options.query && !options.from) {
    throw new PreviewError(
      'Usage: node scripts/mewbeat-preview.mjs "<query>" [--difficulty normal|easy|hard|all] [--out <dir>] [--json-only]\n' +
        "       node scripts/mewbeat-preview.mjs --from <slug>.json [--difficulty ...] [--out <dir>]",
    );
  }
  return options;
}

export function slugOf(text) {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "track";
}

function readLavalinkPassword() {
  const envPath = join(repositoryRoot, ".env.dev");
  if (!existsSync(envPath)) throw new PreviewError(`${envPath} not found; it holds LAVALINK_PASSWORD.`);
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*LAVALINK_PASSWORD\s*=\s*(.*?)\s*$/);
    if (match) return match[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  throw new PreviewError("LAVALINK_PASSWORD is not set in .env.dev.");
}

// --- Lavalink ----------------------------------------------------------------

const baseUrl = process.env.LAVALINK_URL || "http://127.0.0.1:2333";

async function lavalink(path, password, init = {}) {
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: password, ...init.headers },
    });
  } catch (error) {
    throw new PreviewError(
      `Could not reach Lavalink at ${baseUrl} (${error.cause?.code || error.message}). Is \`pnpm lavalink:dev\` running?`,
    );
  }
}

async function bodyText(response) {
  return (await response.text().catch(() => "")).slice(0, 300);
}

async function loadTrack(identifier, password) {
  const response = await lavalink(`/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`, password);
  if (!response.ok) throw new PreviewError(`loadtracks failed: HTTP ${response.status} ${await bodyText(response)}`);
  const { loadType, data } = await response.json();
  const track = loadType === "search" ? data[0] : loadType === "track" ? data : null;
  if (!track) throw new PreviewError(`No playable track for "${identifier}" (loadType ${loadType}).`);
  return track;
}

async function analyze(encodedTrack, password) {
  const response = await lavalink("/v4/mewbeat/analyze", password, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encodedTrack }),
  });
  if (response.status === 200) return response.json();
  const text = await bodyText(response);
  if (response.status === 422) throw new PreviewError(`Track is uncharted: ${text}`);
  if (response.status === 503) throw new PreviewError("Lavalink analysis queue is busy (503); try again shortly.");
  throw new PreviewError(`analyze failed: HTTP ${response.status} ${text}`);
}

async function fetchPcm(encodedTrack, password) {
  const response = await lavalink(`/v4/mewbeat/debug/pcm?track=${encodeURIComponent(encodedTrack)}`, password);
  if (response.status === 404) {
    throw new PreviewError(
      "The debug PCM route returned 404. Set plugins.mewbeat.debugRoutes: true in helpers/lavalink/application.yml (locally) and `docker restart lavalink`.",
    );
  }
  if (!response.ok) throw new PreviewError(`debug/pcm failed: HTTP ${response.status} ${await bodyText(response)}`);
  return Buffer.from(await response.arrayBuffer());
}

// --- main --------------------------------------------------------------------

function describe(chart, features) {
  const seconds = chart.durationMs / 1000;
  const nps = chart.notes.length / seconds;
  const { bpm, confidence } = features.tempo ?? {};
  return (
    `${chart.difficulty.padEnd(6)} notes=${String(chart.notes.length).padStart(4)} ` +
    `stars=${chart.stars} nps=${nps.toFixed(2)} ` +
    `tempo=${bpm?.toFixed?.(1) ?? "?"}bpm conf=${confidence?.toFixed?.(2) ?? "?"}`
  );
}

export async function main(argv) {
  const options = parseArgs(argv);
  const { generateAll } = require(join(repositoryRoot, "helpers", "mewbeat", "charts", "generate.js"));
  const { audioKeyOf } = require(join(repositoryRoot, "helpers", "mewbeat", "audioKey.js"));
  const wanted = options.difficulty === "all" ? DIFFICULTIES : [options.difficulty];

  let query;
  let track;
  let features;
  let slug;
  let outDir;
  let password = null;
  let encodedTrack = null;

  if (options.from) {
    const fromPath = resolve(options.from);
    if (!existsSync(fromPath)) throw new PreviewError(`${fromPath} not found.`);
    const saved = JSON.parse(readFileSync(fromPath, "utf8"));
    ({ query, track, features } = saved);
    slug = basename(fromPath).replace(/\.json$/, "");
    outDir = resolve(options.out ?? join(fromPath, ".."));
  } else {
    query = options.query;
    slug = slugOf(query);
    outDir = resolve(options.out ?? join(repositoryRoot, ".mewbeat-preview"));
  }
  mkdirSync(outDir, { recursive: true });
  const pcmPath = join(outDir, `${slug}.pcm.wav`);

  if (!options.from) {
    password = readLavalinkPassword();
    const loaded = await loadTrack(`ytsearch:${query}`, password);
    encodedTrack = loaded.encoded;
    track = {
      title: loaded.info.title,
      author: loaded.info.author,
      uri: loaded.info.uri,
      audioKey: audioKeyOf(loaded),
    };
    console.log(`Track: ${track.title} - ${track.author} (${track.uri})`);
    if (!track.audioKey) throw new PreviewError("The track has no stable audio key (a stream?).");
    console.log("Analysing...");
    features = await analyze(encodedTrack, password);
  }

  const charts = generateAll(features, track.audioKey);
  if (!charts) throw new PreviewError("The generator returned no charts for these features (uncharted).");

  writeFileSync(
    join(outDir, `${slug}.json`),
    JSON.stringify({ query, track, charts, features }),
  );
  for (const difficulty of DIFFICULTIES) console.log(describe(charts[difficulty], features));
  console.log(`Wrote ${join(outDir, `${slug}.json`)}`);

  if (options.jsonOnly) return;

  let pcm;
  if (existsSync(pcmPath) && (pcm = parseWav(readFileSync(pcmPath))).samples.length > 0) {
    // cached decode is reused as is
  } else {
    password ??= readLavalinkPassword();
    if (!encodedTrack) {
      // --from without a cached PCM: resolve the saved track again.
      encodedTrack = (await loadTrack(track.uri, password)).encoded;
    }
    console.log("Fetching decoded audio...");
    let wav;
    for (let attempt = 1; ; attempt += 1) {
      wav = await fetchPcm(encodedTrack, password);
      pcm = parseWav(wav);
      if (pcm.samples.length > 0) break;
      // The decoder can hit a transient stream error and still answer 200 with
      // an empty WAV; a retry normally works.
      if (attempt === PCM_ATTEMPTS) {
        throw new PreviewError(`The debug PCM route returned empty audio ${PCM_ATTEMPTS} times; check the Lavalink log.`);
      }
      console.log("Decoded audio was empty, retrying...");
    }
    writeFileSync(pcmPath, wav);
  }
  const pcmSeconds = pcm.samples.length / pcm.channels / pcm.sampleRate;
  if (Math.abs(pcmSeconds * 1000 - features.durationMs) > 2000) {
    console.warn(
      `Warning: decoded audio is ${pcmSeconds.toFixed(1)}s but the analysis says ${(features.durationMs / 1000).toFixed(1)}s.`,
    );
  }

  for (const difficulty of wanted) {
    const mixed = mixClicks(pcm, charts[difficulty].notes);
    const file = join(outDir, `${slug}-${difficulty}.wav`);
    writeFileSync(file, encodeWav(mixed));
    const seconds = mixed.samples.length / mixed.channels / mixed.sampleRate;
    console.log(`Wrote ${file} (${seconds.toFixed(1)}s)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof PreviewError ? error.message : error);
    process.exit(1);
  });
}
