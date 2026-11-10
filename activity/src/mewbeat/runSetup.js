// What a run on stage plays with, decided from the player's settings and the kind of run. No browser globals.
import { MODIFIERS, normalizeModifiers } from "./modifiers.js";

const SOLO_ONLY = new Set(MODIFIERS.filter((modifier) => modifier.solo).map((modifier) => modifier.id));

// The saved list as the run may use it: the server refuses a list with an unknown id, a conflict or (outside Solo)
// a tempo, so a list that cannot be sent is trimmed to what can, and failing that dropped.
export function modifiersFor(list, mode) {
  const first = normalizeModifiers(list, { mode });
  if (first.ok) return first.modifiers;
  if (mode !== "solo" && Array.isArray(list)) {
    const second = normalizeModifiers(list.filter((id) => !SOLO_ONLY.has(id)), { mode });
    if (second.ok) return second.modifiers;
  }
  return [];
}

// calibration, touring (the first-run tour), autoplay and spectating are runs nobody can lose or be scored for:
// they play without modifiers and cannot fail. Anything else plays with the saved modifiers.
export function runRulesFor({ modifiers, mode, autoplay = false, spectating = false, calibration = false, touring = false }) {
  const unscored = calibration || touring || spectating;
  return {
    modifiers: unscored ? [] : modifiersFor(modifiers, mode),
    noFail: unscored || autoplay,
  };
}
