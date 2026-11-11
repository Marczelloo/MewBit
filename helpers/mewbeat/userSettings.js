const userPreferences = require("../users/preferences");

// Keys are KeyboardEvent.code values, so they hold on any keyboard layout.
const DEFAULT_SETTINGS = Object.freeze({
  keys: Object.freeze(["KeyD", "KeyF", "KeyJ", "KeyK"]),
  offsetMs: 0, // the bot's audio in Live, which reaches the player late through Discord
  soloOffsetMs: 0, // solo and room audio (the Activity's own playback): a Live offset would be wrong there
  scrollSpeed: 5,
  liveDifficulty: "normal",
  effects: "full",
  hitSounds: false,
  hitSound: "kick",
  hitVolume: 40,
  sfx: true,
  sfxVolume: 60,
  musicVolume: 80, // solo and room audio (the Activity's own playback); the bot's live audio is not touched
  normalizeLoudness: true, // solo and room audio: every song plays at the same loudness (activity loudness.js)
  showMewbit: true,
  tempoScroll: true, // the song's tempo nudges the fall speed (activity highway.js tempoScrollFactor)
  modifiers: Object.freeze([]), // ids from activity modifiers.js, checked in full when a run is submitted
  feverMode: "manual", // "auto" starts FEVER as soon as the bar is full
});

const LIMITS = Object.freeze({ offsetMs: [-300, 700], soloOffsetMs: [-300, 700], scrollSpeed: [1, 10], hitVolume: [0, 100], sfxVolume: [0, 100], musicVolume: [0, 100] });
// Space is FEVER; Escape leaves the game.
const RESERVED_CODES = Object.freeze(["Space", "Escape"]);

const KEY_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
const LIVE_DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const EFFECT_LEVELS = ["full", "reduced", "off"];
const HIT_SOUND_CHOICES = ["kick", "taiko", "drum", "tight", "osu"];
const SETTING_FIELDS = Object.keys(DEFAULT_SETTINGS);

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function isValidKeys(keys) {
  return Array.isArray(keys)
    && keys.length === 4
    && keys.every((code) => typeof code === "string" && KEY_CODE_PATTERN.test(code) && !RESERVED_CODES.includes(code))
    && new Set(keys).size === 4;
}

function isIntegerIn(value, [min, max]) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// One check per field, shared by the lenient and the strict path. Each returns
// the error message for an invalid value, or null.
const FIELD_CHECKS = {
  keys: (value) => (isValidKeys(value) ? null : "Pick four different keys. Space and Escape are taken."),
  offsetMs: (value) => (isIntegerIn(value, LIMITS.offsetMs) ? null : `Offset must be a whole number from ${LIMITS.offsetMs[0]} to ${LIMITS.offsetMs[1]} ms.`),
  soloOffsetMs: (value) => (isIntegerIn(value, LIMITS.soloOffsetMs) ? null : `Offset must be a whole number from ${LIMITS.soloOffsetMs[0]} to ${LIMITS.soloOffsetMs[1]} ms.`),
  scrollSpeed: (value) => (isIntegerIn(value, LIMITS.scrollSpeed) ? null : `Scroll speed must be a whole number from ${LIMITS.scrollSpeed[0]} to ${LIMITS.scrollSpeed[1]}.`),
  liveDifficulty: (value) => (LIVE_DIFFICULTIES.includes(value) ? null : "Live difficulty must be easy, normal, hard or hell."),
  effects: (value) => (EFFECT_LEVELS.includes(value) ? null : "Effects must be full, reduced or off."),
  hitSounds: (value) => (typeof value === "boolean" ? null : "Hit sounds must be on or off."),
  hitSound: (value) => (HIT_SOUND_CHOICES.includes(value) ? null : "Hit sound must be kick, taiko, drum, tight or osu."),
  hitVolume: (value) => (isIntegerIn(value, LIMITS.hitVolume) ? null : `Hit sound volume must be a whole number from ${LIMITS.hitVolume[0]} to ${LIMITS.hitVolume[1]}.`),
  sfx: (value) => (typeof value === "boolean" ? null : "Sound effects must be on or off."),
  sfxVolume: (value) => (isIntegerIn(value, LIMITS.sfxVolume) ? null : `Sound effects volume must be a whole number from ${LIMITS.sfxVolume[0]} to ${LIMITS.sfxVolume[1]}.`),
  musicVolume: (value) => (isIntegerIn(value, LIMITS.musicVolume) ? null : `Music volume must be a whole number from ${LIMITS.musicVolume[0]} to ${LIMITS.musicVolume[1]}.`),
  normalizeLoudness: (value) => (typeof value === "boolean" ? null : "Even out loudness must be on or off."),
  showMewbit: (value) => (typeof value === "boolean" ? null : "Show Mewbit must be on or off."),
  tempoScroll: (value) => (typeof value === "boolean" ? null : "Speed by tempo must be on or off."),
  modifiers: (value) => (isModifierList(value) ? null : "Modifiers must be a list of modifier ids."),
  feverMode: (value) => (FEVER_MODES.includes(value) ? null : "FEVER must be manual or auto."),
};

const FEVER_MODES = ["manual", "auto"];
const MODIFIER_ID_PATTERN = /^[a-z]{2}$/;
const MAX_MODIFIERS = 9;

// Only the shape: the game drops what does not apply to a mode, and the submit checks the list against modifiers.js.
function isModifierList(value) {
  return Array.isArray(value)
    && value.length <= MAX_MODIFIERS
    && value.every((id) => typeof id === "string" && MODIFIER_ID_PATTERN.test(id))
    && new Set(value).size === value.length;
}

function cloneSettings(settings) {
  return { ...settings, keys: [...settings.keys], modifiers: [...settings.modifiers] };
}

/* Used on stored data: every invalid or missing field falls back to its
   default, so a hand-edited or older record can never break the game. */
function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = cloneSettings(DEFAULT_SETTINGS);
  for (const field of SETTING_FIELDS) {
    if (field in source && !FIELD_CHECKS[field](source[field])) {
      settings[field] = Array.isArray(source[field]) ? [...source[field]] : source[field];
    }
  }
  return settings;
}

/* Used on client input: merges the patch onto the current settings and
   returns the full result, or refuses with a 400. */
function validateSettingsPatch(patch, current) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw badRequest("Send the settings to change.");
  const settings = cloneSettings(normalizeSettings(current));
  for (const [field, value] of Object.entries(patch)) {
    if (!SETTING_FIELDS.includes(field)) throw badRequest(`Unknown mewbeat setting: ${String(field).slice(0, 40)}`);
    const problem = FIELD_CHECKS[field](value);
    if (problem) throw badRequest(problem);
    settings[field] = Array.isArray(value) ? [...value] : value;
  }
  return settings;
}

/* The game is open to everyone. tutorialSeen only records that the first-run tour was shown. An older stored
   record ({ unlocked, generation, ... }) reads as an unseen tour; its settings are kept. */
function getMewbeatRecord(userId) {
  const raw = userPreferences.getUserPreferences(userId)?.mewbeat;
  const stored = raw && typeof raw === "object" ? raw : {};
  return {
    tutorialSeen: stored.tutorialSeen === true,
    settings: normalizeSettings(stored.settings),
  };
}

function writeRecord(userId, record) {
  userPreferences.setUserPreference(userId, "mewbeat", record);
  return record;
}

function markTutorialSeen(userId) {
  const current = getMewbeatRecord(userId);
  if (current.tutorialSeen) return current;
  return writeRecord(userId, { ...current, tutorialSeen: true });
}

function updateMewbeatSettings(userId, patch) {
  const current = getMewbeatRecord(userId);
  return writeRecord(userId, { ...current, settings: validateSettingsPatch(patch, current.settings) });
}

module.exports = {
  DEFAULT_SETTINGS,
  LIMITS,
  RESERVED_CODES,
  normalizeSettings,
  validateSettingsPatch,
  getMewbeatRecord,
  markTutorialSeen,
  updateMewbeatSettings,
};
