const userPreferences = require("../users/preferences");

// Keys are KeyboardEvent.code values, so they hold on any keyboard layout.
const DEFAULT_SETTINGS = Object.freeze({
  keys: Object.freeze(["KeyD", "KeyF", "KeyJ", "KeyK"]),
  offsetMs: 0,
  scrollSpeed: 5,
  liveDifficulty: "normal",
  effects: "full",
  hitSounds: false,
});

const LIMITS = Object.freeze({ offsetMs: [-300, 700], scrollSpeed: [1, 10] });
// Space is FEVER; Escape leaves the game.
const RESERVED_CODES = Object.freeze(["Space", "Escape"]);

const KEY_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
const LIVE_DIFFICULTIES = ["easy", "normal", "hard"];
const EFFECT_LEVELS = ["full", "reduced", "off"];
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
  scrollSpeed: (value) => (isIntegerIn(value, LIMITS.scrollSpeed) ? null : `Scroll speed must be a whole number from ${LIMITS.scrollSpeed[0]} to ${LIMITS.scrollSpeed[1]}.`),
  liveDifficulty: (value) => (LIVE_DIFFICULTIES.includes(value) ? null : "Live difficulty must be easy, normal or hard."),
  effects: (value) => (EFFECT_LEVELS.includes(value) ? null : "Effects must be full, reduced or off."),
  hitSounds: (value) => (typeof value === "boolean" ? null : "Hit sounds must be on or off."),
};

function cloneSettings(settings) {
  return { ...settings, keys: [...settings.keys] };
}

/* Used on stored data: every invalid or missing field falls back to its
   default, so a hand-edited or older record can never break the game. */
function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = cloneSettings(DEFAULT_SETTINGS);
  for (const field of SETTING_FIELDS) {
    if (field in source && !FIELD_CHECKS[field](source[field])) {
      settings[field] = field === "keys" ? [...source.keys] : source[field];
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
    settings[field] = field === "keys" ? [...value] : value;
  }
  return settings;
}

function getMewbeatRecord(userId) {
  const raw = userPreferences.getUserPreferences(userId)?.mewbeat;
  const stored = raw && typeof raw === "object" ? raw : {};
  const unlocked = stored.unlocked === true;
  return {
    unlocked,
    unlockedAt: unlocked && Number.isFinite(stored.unlockedAt) ? stored.unlockedAt : null,
    settings: normalizeSettings(stored.settings),
  };
}

function writeRecord(userId, record) {
  userPreferences.setUserPreference(userId, "mewbeat", record);
  return record;
}

function unlockMewbeat(userId, now = Date.now()) {
  const current = getMewbeatRecord(userId);
  if (current.unlocked) return current;
  return writeRecord(userId, { unlocked: true, unlockedAt: now, settings: current.settings });
}

function updateMewbeatSettings(userId, patch) {
  const current = getMewbeatRecord(userId);
  if (!current.unlocked) throw Object.assign(new Error("Unlock mewbeat first."), { statusCode: 403 });
  return writeRecord(userId, { ...current, settings: validateSettingsPatch(patch, current.settings) });
}

module.exports = {
  DEFAULT_SETTINGS,
  LIMITS,
  RESERVED_CODES,
  normalizeSettings,
  validateSettingsPatch,
  getMewbeatRecord,
  unlockMewbeat,
  updateMewbeatSettings,
};
