import { MODIFIERS, modifierMultiplier, normalizeModifiers } from "./modifiers.js";

// The pure side of the modifier picker: what a click does to the list, and how a bonus reads.

const BY_ID = new Map(MODIFIERS.map((modifier) => [modifier.id, modifier]));

// The groups in the order the picker shows them, with the label of each.
export const MODIFIER_GROUPS = [
  { id: "fail", label: "Fail" },
  { id: "notes", label: "Notes" },
  { id: "speed", label: "Speed" },
];

// One line each for the picker. The list itself (ids, names, bonuses) stays in modifiers.js.
export const MODIFIER_HINTS = {
  nf: "You cannot fail, but points halve once health runs out",
  ol: "The first miss ends the run",
  fl: "Four misses end the run",
  gn: "Notes fade out before they reach the line",
  st: "Tighter hit windows",
  nc: "Every note is the same colour",
  mr: "Lanes are mirrored",
  fs: "The song plays 1.2x faster",
  sf: "The song plays 1.5x faster",
  ss: "The song plays 0.85x slower",
};

// The picker group a modifier sits in: modifiers without a group of their own share "notes".
export function pickerGroupOf(id) {
  const modifier = BY_ID.get(id);
  if (!modifier) return null;
  return modifier.group ?? "notes";
}

// The definitions of one picker group, in MODIFIERS order.
export function modifiersOfGroup(groupId) {
  return MODIFIERS.filter((modifier) => pickerGroupOf(modifier.id) === groupId);
}

// A list of ids -> the list the picker is allowed to hold: unknown ids, speed outside solo and a second
// pick in an exclusive group (the later one in MODIFIERS order loses) are dropped. Always normalized.
export function sanitizeModifiers(list, { mode } = {}) {
  if (!Array.isArray(list)) return [];
  const taken = new Set();
  const kept = [];
  for (const modifier of MODIFIERS) {
    if (!list.includes(modifier.id)) continue;
    if (mode !== "solo" && modifier.solo) continue;
    if (modifier.group) {
      if (taken.has(modifier.group)) continue;
      taken.add(modifier.group);
    }
    kept.push(modifier.id);
  }
  const normalized = normalizeModifiers(kept, { mode });
  return normalized.ok ? normalized.modifiers : [];
}

// One click on a toggle: picking an id adds it and drops the other of its exclusive group, picking a
// picked id clears it, and a speed modifier outside solo does nothing. Returns the normalized list.
export function toggleModifier(list, id, { mode } = {}) {
  const modifier = BY_ID.get(id);
  const current = sanitizeModifiers(list, { mode });
  if (!modifier || (mode !== "solo" && modifier.solo)) return current;
  if (current.includes(id)) return current.filter((other) => other !== id);
  const rest = modifier.group ? current.filter((other) => BY_ID.get(other)?.group !== modifier.group) : current;
  return sanitizeModifiers([...rest, id], { mode });
}

// A bonus as the picker shows it: +8%, −30%, ±0 (a real minus sign).
export function bonusLabel(bonus) {
  const percent = Math.round(bonus * 100);
  if (percent === 0) return "±0";
  return percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`;
}

// What to tell the room about the player's picks: the room-legal list (no speed), or null when the member
// already carries exactly that list, so the caller sends only on a difference.
export function roomModifiersToSend(picked, memberList) {
  const wanted = sanitizeModifiers(picked, { mode: "room" });
  const current = Array.isArray(memberList) ? memberList : [];
  return wanted.join(",") === current.join(",") ? null : wanted;
}

// The multiplier of a list as the button shows it: ×1.14.
export function multiplierLabel(list) {
  return `×${modifierMultiplier(list).toFixed(2)}`;
}
