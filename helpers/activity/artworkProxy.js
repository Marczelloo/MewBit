// The Activity's artwork proxy: fetches a cover from an allowed host and keeps it, so a song list does not hit the
// provider again for every row, every open and every viewer.
//
// - A memory LRU (by bytes) in front of a disk cache (a size cap, oldest file out), keyed by a hash of the request.
// - One upstream fetch per key at a time (concurrent requests share it), and at most `concurrency` fetches at once.
// - YouTube thumbnails come in sizes: the list asks for `small` (mqdefault) or `medium` (hqdefault), and a missing
//   maxresdefault falls back to hqdefault. Other hosts are fetched as they are, whatever the size.
// - A definitive failure (the host answered 4xx, or not an image, or too large) is remembered for failureTtlMs. A
//   timeout, a network error or a 5xx is never remembered: the next request tries again.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const SIZES = new Set(["small", "medium"]);

const YOUTUBE_THUMB = /^(\/vi(?:_webp)?\/[^/]+\/)(maxresdefault|sddefault|hqdefault|mqdefault|default)(\.(?:jpg|webp))$/;

function isYoutubeThumbHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "img.youtube.com" || host === "ytimg.com" || host.endsWith(".ytimg.com");
}

function normalizeSize(size) {
  return SIZES.has(size) ? size : "";
}

// The urls to try for a source url at a size, best first. Only YouTube thumbnails have variants.
function variantUrls(sourceUrl, size = "") {
  const wanted = normalizeSize(size);
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return [sourceUrl];
  }
  const match = isYoutubeThumbHost(url.hostname) ? YOUTUBE_THUMB.exec(url.pathname) : null;
  if (!match) return [sourceUrl];
  const [, prefix, name, extension] = match;
  const withName = (next) => {
    const copy = new URL(url);
    copy.pathname = `${prefix}${next}${extension}`;
    copy.search = "";
    return copy.toString();
  };
  const names = wanted === "small" ? ["mqdefault", "hqdefault"] : wanted === "medium" ? ["hqdefault"] : name === "maxresdefault" ? ["maxresdefault", "hqdefault"] : [name];
  // Without a size the url asked for goes out exactly as it came (its query included).
  return [...new Set(names.map((next) => (wanted === "" && next === name ? sourceUrl : withName(next))))];
}

function createArtworkProxy({
  dir,
  isAllowedUrl,
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  concurrency = 6,
  memoryMaxBytes = 24 * 1024 * 1024,
  diskMaxBytes = 256 * 1024 * 1024,
  maxImageBytes = MAX_IMAGE_BYTES,
  failureTtlMs = 30_000,
  timeoutMs = 10_000,
  log = { warning() {} },
} = {}) {
  const memory = new Map(); // key -> entry, least recently used first
  let memoryBytes = 0;
  const failures = new Map(); // key -> expiresAt
  const inflight = new Map(); // key -> promise
  let diskIndex = null; // name -> { size, mtimeMs }, built on first use
  let diskBytes = 0;
  let active = 0;
  const waiting = [];

  const keyOf = (sourceUrl, size) => crypto.createHash("sha1").update(`${normalizeSize(size)}|${sourceUrl}`).digest("hex");
  const fileOf = (key) => path.join(dir, `${key}.art`);

  // --- upstream concurrency ---
  function acquire() {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  // --- memory ---
  function remember(key, entry) {
    if (memory.has(key)) memoryBytes -= memory.get(key).body.length;
    memory.delete(key);
    memory.set(key, entry);
    memoryBytes += entry.body.length;
    while (memoryBytes > memoryMaxBytes && memory.size > 1) {
      const oldest = memory.keys().next().value;
      memoryBytes -= memory.get(oldest).body.length;
      memory.delete(oldest);
    }
  }

  // --- disk ---
  async function loadIndex() {
    if (diskIndex) return diskIndex;
    diskIndex = new Map();
    diskBytes = 0;
    try {
      for (const name of await fs.promises.readdir(dir)) {
        if (!name.endsWith(".art")) continue;
        try {
          const stat = await fs.promises.stat(path.join(dir, name));
          diskIndex.set(name, { size: stat.size, mtimeMs: stat.mtimeMs });
          diskBytes += stat.size;
        } catch {
          // gone meanwhile
        }
      }
    } catch {
      // no folder yet
    }
    return diskIndex;
  }

  async function readDisk(key) {
    if (!dir) return null;
    const index = await loadIndex();
    const name = `${key}.art`;
    if (!index.has(name)) return null;
    try {
      const raw = await fs.promises.readFile(fileOf(key));
      const newline = raw.indexOf(10);
      const meta = JSON.parse(raw.toString("utf8", 0, newline));
      const body = raw.subarray(newline + 1);
      if (!meta?.contentType || !body.length) throw new Error("bad entry");
      const stamp = new Date(now());
      fs.promises.utimes(fileOf(key), stamp, stamp).catch(() => {});
      index.get(name).mtimeMs = stamp.getTime();
      return { body, contentType: meta.contentType, etag: meta.etag };
    } catch {
      // A damaged or vanished file is dropped; the image is fetched again.
      const gone = index.get(name);
      if (gone) diskBytes -= gone.size;
      index.delete(name);
      fs.promises.rm(fileOf(key), { force: true }).catch(() => {});
      return null;
    }
  }

  async function writeDisk(key, entry) {
    if (!dir) return;
    const index = await loadIndex();
    const header = Buffer.from(`${JSON.stringify({ contentType: entry.contentType, etag: entry.etag })}\n`);
    const data = Buffer.concat([header, entry.body]);
    const name = `${key}.art`;
    const temp = `${fileOf(key)}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(temp, data);
      await fs.promises.rename(temp, fileOf(key));
    } catch (error) {
      fs.promises.rm(temp, { force: true }).catch(() => {});
      log.warning("artwork cache write failed", error?.message);
      return;
    }
    const before = index.get(name);
    if (before) diskBytes -= before.size;
    index.set(name, { size: data.length, mtimeMs: now() });
    diskBytes += data.length;
    if (diskBytes > diskMaxBytes) await evictDisk(index, name);
  }

  // Oldest files out until the cache is at 90% of its cap (the file just written stays).
  async function evictDisk(index, keep) {
    const target = diskMaxBytes * 0.9;
    const oldestFirst = [...index.entries()].filter(([name]) => name !== keep).sort((a, b) => a[1].mtimeMs - b[1].mtimeMs);
    for (const [name, { size }] of oldestFirst) {
      if (diskBytes <= target) break;
      index.delete(name);
      diskBytes -= size;
      await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {});
    }
  }

  // --- upstream ---
  // One url: { image } on success, { failure: "definitive" | "transient" } otherwise. A redirect to a host that is not
  // allowed throws an error with statusCode 400.
  async function fetchOne(url) {
    let current = url;
    let upstream = null;
    try {
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        upstream = await fetchImpl(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
            "User-Agent": "MewBit-Activity/1.1",
          },
        });
        if (upstream.status < 300 || upstream.status >= 400) break;
        const location = upstream.headers.get("location");
        if (!location) break;
        current = new URL(location, current).toString();
        if (!isAllowedUrl(current)) throw Object.assign(new Error("Artwork redirect host is not allowed."), { statusCode: 400 });
      }
    } catch (error) {
      if (Number(error?.statusCode) === 400) throw error;
      return { failure: "transient" }; // timeout, network error
    }
    if (!upstream) return { failure: "transient" };
    if (upstream.status >= 500) return { failure: "transient" };
    if (!upstream.ok) return { failure: "definitive" };

    const contentType = String(upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (!contentType.startsWith("image/") || contentLength > maxImageBytes) return { failure: "definitive" };
    let body;
    try {
      body = Buffer.from(await upstream.arrayBuffer());
    } catch {
      return { failure: "transient" }; // the body broke off
    }
    if (body.length > maxImageBytes) return { failure: "definitive" };
    if (!body.length) return { failure: "definitive" };
    return { image: { body, contentType, etag: `"${crypto.createHash("sha1").update(body).digest("hex")}"` } };
  }

  async function fetchUpstream(sourceUrl, size) {
    await acquire();
    try {
      let outcome = { failure: "definitive" };
      for (const url of variantUrls(sourceUrl, size)) {
        outcome = await fetchOne(url);
        if (outcome.image) return outcome;
        // A variant that does not exist (404) goes on to the next; a broken host stops the walk.
        if (outcome.failure === "transient") return outcome;
      }
      return outcome;
    } finally {
      release();
    }
  }

  async function resolve(sourceUrl, size, key) {
    const stored = await readDisk(key);
    if (stored) {
      remember(key, stored);
      return { ok: true, ...stored };
    }
    const outcome = await fetchUpstream(sourceUrl, size);
    if (outcome.image) {
      remember(key, outcome.image);
      writeDisk(key, outcome.image).catch((error) => log.warning("artwork cache write failed", error?.message));
      return { ok: true, ...outcome.image };
    }
    if (outcome.failure === "definitive") {
      failures.set(key, now() + failureTtlMs);
      while (failures.size > 1_000) failures.delete(failures.keys().next().value);
    }
    return { ok: false, definitive: outcome.failure === "definitive" };
  }

  // Resolves { ok: true, body, contentType, etag } or { ok: false, definitive }. Throws (statusCode 400) when a redirect
  // leaves the allowed hosts; the caller has already checked sourceUrl itself.
  function fetchArtwork(sourceUrl, size = "") {
    const key = keyOf(sourceUrl, size);
    const hit = memory.get(key);
    if (hit) {
      memory.delete(key);
      memory.set(key, hit);
      return Promise.resolve({ ok: true, ...hit });
    }
    const failedUntil = failures.get(key);
    if (failedUntil !== undefined) {
      if (failedUntil > now()) return Promise.resolve({ ok: false, definitive: true });
      failures.delete(key);
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    const request = resolve(sourceUrl, size, key).finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  return { fetchArtwork, stats: () => ({ memoryEntries: memory.size, memoryBytes, diskBytes, active, waiting: waiting.length }) };
}

module.exports = { createArtworkProxy, normalizeSize, variantUrls };
