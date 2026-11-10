// Shared by the Activity and the server: the server checks what a run claims to have played with and
// replays it through scoring.js, so the list and the rules version live here and nowhere else.
//
// bonus is added to the score multiplier (1 + the sum). group: modifiers of one group exclude each other.
// speed changes the song's tempo, which only a solo run can do; solo marks the ones the room and live refuse.
export const MODIFIERS = [
  { id: "nf", name: "No Fail", short: "NF", group: "fail", bonus: 0 },
  { id: "ol", name: "One Life", short: "OL", group: "fail", bonus: 0.1 },
  { id: "fl", name: "Four Lives", short: "FL", group: "fail", bonus: 0.04 },
  { id: "gn", name: "Ghost Notes", short: "GN", group: null, bonus: 0.16 },
  { id: "st", name: "Strict Timing", short: "ST", group: null, bonus: 0.12 },
  { id: "nc", name: "No Colors", short: "NC", group: null, bonus: 0.06 },
  { id: "mr", name: "Mirror", short: "MR", group: null, bonus: 0.02 },
  { id: "fs", name: "Faster Song", short: "FS", group: "speed", bonus: 0.15, speed: 1.2, solo: true },
  { id: "sf", name: "Super Fast", short: "SF", group: "speed", bonus: 0.3, speed: 1.5, solo: true },
  { id: "ss", name: "Slower Song", short: "SS", group: "speed", bonus: -0.4, speed: 0.85, solo: true },
];

// The scoring rules in force. A board is only comparable between runs scored by the same rules, so this
// is part of every board key; the rules before health, fever by chart size and modifiers count as 1, and 2 is
// their first take (a miss cost 15% health, smaller modifier bonuses).
export const RULES_VERSION = 3;

const BY_ID = new Map(MODIFIERS.map((modifier) => [modifier.id, modifier]));

// A list of modifier ids a client claims -> { ok: true, modifiers } in the order of MODIFIERS without duplicates,
// or { ok: false, reason: "unknown_modifier" | "solo_only" | "conflict" }. mode is "solo" | "room" | "live".
export function normalizeModifiers(list, { mode } = {}) {
  if (list === undefined || list === null) return { ok: true, modifiers: [] };
  if (!Array.isArray(list)) return { ok: false, reason: "unknown_modifier" };
  const chosen = new Set();
  for (const id of list) {
    if (typeof id !== "string" || !BY_ID.has(id)) return { ok: false, reason: "unknown_modifier" };
    chosen.add(id);
  }
  const picked = MODIFIERS.filter((modifier) => chosen.has(modifier.id));
  if (mode !== "solo" && picked.some((modifier) => modifier.solo)) return { ok: false, reason: "solo_only" };
  const groups = new Set();
  for (const modifier of picked) {
    if (!modifier.group) continue;
    if (groups.has(modifier.group)) return { ok: false, reason: "conflict" };
    groups.add(modifier.group);
  }
  return { ok: true, modifiers: picked.map((modifier) => modifier.id) };
}

// The score multiplier of a list of modifiers: 1 plus their bonuses, never below 0. Rounded so the
// float sum of a few hundredths compares as the number it is meant to be.
export function modifierMultiplier(modifiers = []) {
  const bonus = modifiers.reduce((sum, id) => sum + (BY_ID.get(id)?.bonus ?? 0), 0);
  return Math.max(0, Math.round((1 + bonus) * 1e6) / 1e6);
}

// The tempo of the song: 1 unless a speed modifier is on.
export function speedOf(modifiers = []) {
  for (const id of modifiers) {
    const speed = BY_ID.get(id)?.speed;
    if (speed) return speed;
  }
  return 1;
}
