const fs = require("fs");
const path = require("path");
const { backupCorruptFileSync, writeJsonAtomicSync } = require("../data/atomicJson");

/*
 * Persistent per-guild playback history ("room history").
 *
 * The live history in helpers/lavalink/state.js is in-memory and capped at a
 * few dozen tracks, so it is empty after a restart. This store keeps a compact
 * copy of every played track for a retention window so the Activity can show
 * what the room listened to across sessions.
 *
 * Entries are shaped like a Lavalink track ({ track, info, userData,
 * pluginInfo }) but hold only what is needed to render and replay them, so they
 * can be fed straight to serializeTrack().
 */

const DEFAULT_FILE = path.join(__dirname, "../data/roomHistory.json");
const WRITE_DEBOUNCE_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 300;
const MAX_URL = 600;
const MAX_TRACK_STRING = 8000;

let filePathOverride = null;
let cache = null; // { [guildId]: Entry[] }
let loadFailed = false; // a read error that was not corruption: never overwrite the file
let dirty = false;
let writeTimer = null;

function envNumber(name, fallback, min) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function getRetentionMs() {
  return envNumber("ROOM_HISTORY_RETENTION_DAYS", 14, 0.001) * DAY_MS;
}

function getEntryLimit() {
  return Math.floor(envNumber("ROOM_HISTORY_LIMIT", 500, 1));
}

/*
 * Test runs must never write the real data file. Unless a file was chosen
 * explicitly (ROOM_HISTORY_FILE or setRoomHistoryFileForTests), the store stays
 * memory-only under `node --test` / NODE_ENV=test.
 */
function getFilePath() {
  if (filePathOverride) return filePathOverride;
  if (process.env.ROOM_HISTORY_FILE) return path.resolve(process.env.ROOM_HISTORY_FILE);
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "test") return null;
  return DEFAULT_FILE;
}

function text(value, max = MAX_TEXT) {
  if (value === undefined || value === null) return undefined;
  const result = String(value);
  return result.length > max ? result.slice(0, max) : result;
}

function pickPrimitive(value) {
  if (typeof value === "string") return text(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

function compactInfo(info = {}) {
  const out = {
    title: text(info.title),
    author: text(info.author),
    uri: text(info.uri, MAX_URL),
    identifier: text(info.identifier),
    length: Number.isFinite(Number(info.length)) ? Number(info.length) : 0,
    sourceName: text(info.sourceName),
    artworkUrl: text(info.artworkUrl, MAX_URL),
    isStream: Boolean(info.isStream),
    isrc: text(info.isrc),
    requester: text(info.requester),
    requesterId: text(info.requesterId),
    requesterTag: text(info.requesterTag),
    requesterAvatar: text(info.requesterAvatar, MAX_URL),
    // serializeTrack reads either spelling of the explicit flag.
    isExplicit: info.isExplicit === undefined ? undefined : Boolean(info.isExplicit),
    explicit: info.explicit === undefined ? undefined : Boolean(info.explicit),
  };
  if (info.autoplayed) out.autoplayed = true;
  return stripUndefined(out);
}

function compactAiDj(aiDJ) {
  if (!aiDJ || typeof aiDJ !== "object") return undefined;
  const reasons = Array.isArray(aiDJ.reasons) ? aiDJ.reasons.slice(0, 1).map((reason) => text(reason, 200)) : undefined;
  return stripUndefined({
    lane: pickPrimitive(aiDJ.lane),
    fit: pickPrimitive(aiDJ.fit),
    mood: pickPrimitive(aiDJ.mood),
    energy: pickPrimitive(aiDJ.energy),
    proposalReason: text(aiDJ.proposalReason, 200),
    reasons,
  });
}

function compactPair(value) {
  if (!value || typeof value !== "object") return undefined;
  return stripUndefined({ title: text(value.title), artist: text(value.artist) });
}

function compactUserData(userData = {}) {
  const out = {};
  for (const [key, value] of Object.entries(userData || {})) {
    if (key === "activityQueueId") continue; // queue-row identity, meaningless once played
    const primitive = pickPrimitive(value);
    if (primitive !== undefined) out[key] = primitive;
  }
  const aiDJ = compactAiDj(userData?.aiDJ);
  if (aiDJ) out.aiDJ = aiDJ;
  const anchor = compactPair(userData?.autoplayAnchor);
  if (anchor) out.autoplayAnchor = anchor;
  const reference = compactPair(userData?.autoplayReference);
  if (reference) out.autoplayReference = reference;
  return out;
}

function compactPluginInfo(pluginInfo) {
  if (!pluginInfo || typeof pluginInfo !== "object") return undefined;
  const out = {};
  for (const key of ["isExplicit", "explicit"]) {
    if (pluginInfo[key] !== undefined) out[key] = Boolean(pluginInfo[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

function stripUndefined(object) {
  for (const key of Object.keys(object)) {
    if (object[key] === undefined) delete object[key];
  }
  return object;
}

function buildEntry(snapshot) {
  if (!snapshot || typeof snapshot.track !== "string" || !snapshot.track || snapshot.track.length > MAX_TRACK_STRING) return null;

  const userData = compactUserData(snapshot.userData);
  if (!Number.isFinite(Number(userData.autoplayPlayedAt))) userData.autoplayPlayedAt = Date.now();

  const entry = { track: snapshot.track, info: compactInfo(snapshot.info), userData };
  const pluginInfo = compactPluginInfo(snapshot.pluginInfo);
  if (pluginInfo) entry.pluginInfo = pluginInfo;
  return entry;
}

function isValidEntry(entry) {
  return Boolean(entry) && typeof entry === "object" && typeof entry.track === "string" && entry.info && typeof entry.info === "object";
}

function entryTime(entry) {
  return Number(entry?.userData?.autoplayPlayedAt) || 0;
}

function pruneEntries(entries, now = Date.now()) {
  const cutoff = now - getRetentionMs();
  const limit = getEntryLimit();
  const kept = (Array.isArray(entries) ? entries : []).filter((entry) => isValidEntry(entry) && entryTime(entry) >= cutoff);
  return kept.length > limit ? kept.slice(kept.length - limit) : kept;
}

function load() {
  if (cache) return cache;
  cache = {};

  const file = getFilePath();
  if (!file) return cache;

  try {
    if (!fs.existsSync(file)) return cache;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Room history file does not contain an object.");
    }
    for (const [guildId, entries] of Object.entries(parsed)) {
      const pruned = pruneEntries(entries);
      if (pruned.length) cache[guildId] = pruned;
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      try {
        console.error(`Room history was corrupt; preserved at ${backupCorruptFileSync(file)}`);
      } catch (backupErr) {
        console.error("Room history was corrupt and could not be backed up:", backupErr);
      }
      cache = {};
    } else {
      console.error("Failed to load room history:", err);
      loadFailed = true;
      cache = {};
    }
  }
  return cache;
}

function writeNow() {
  writeTimer = null;
  if (!dirty) return;
  const file = getFilePath();
  if (!file || loadFailed) {
    dirty = false;
    return;
  }

  try {
    const now = Date.now();
    const data = load();
    for (const guildId of Object.keys(data)) {
      data[guildId] = pruneEntries(data[guildId], now);
      if (!data[guildId].length) delete data[guildId];
    }
    writeJsonAtomicSync(file, data);
    dirty = false;
  } catch (err) {
    // Playback must never fail because history could not be saved; the next
    // recorded track schedules another attempt.
    dirty = false;
    console.error("Failed to save room history:", err);
  }
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(writeNow, WRITE_DEBOUNCE_MS);
  if (typeof writeTimer.unref === "function") writeTimer.unref();
}

/**
 * Record a played track for a guild. Never throws.
 * @param {string} guildId
 * @param {Object} trackSnapshot - cloned track whose userData.autoplayPlayedAt is the play time
 */
function recordRoomTrack(guildId, trackSnapshot) {
  try {
    if (!guildId) return;
    const entry = buildEntry(trackSnapshot);
    if (!entry) return;

    const data = load();
    const entries = pruneEntries(data[guildId]);
    entries.push(entry);
    data[guildId] = pruneEntries(entries);
    scheduleWrite();
  } catch (err) {
    console.error("Failed to record room history:", err);
  }
}

/**
 * Room history for a guild, oldest to newest, expired entries already dropped.
 * @param {string} guildId
 * @returns {Array<{track: string, info: Object, userData: Object, pluginInfo?: Object}>}
 */
function getRoomHistory(guildId) {
  try {
    if (!guildId) return [];
    const data = load();
    const entries = pruneEntries(data[guildId]);
    if (entries.length) data[guildId] = entries;
    else delete data[guildId];
    return entries.slice();
  } catch (err) {
    console.error("Failed to read room history:", err);
    return [];
  }
}

/** Write any pending change immediately (used by tests and clean shutdowns). */
function flushRoomHistory() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writeNow();
}

/** Point the store at a different file and drop the in-memory cache. Tests only. */
function setRoomHistoryFileForTests(filePath) {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  filePathOverride = filePath || null;
  cache = null;
  loadFailed = false;
  dirty = false;
}

module.exports = {
  recordRoomTrack,
  getRoomHistory,
  flushRoomHistory,
  setRoomHistoryFileForTests,
};
