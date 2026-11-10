// The health bar's numbers, apart from React so they can be tested. No browser globals.

export const LOW_HEALTH = 0.3; // the bar goes from yellow to red below this
export const CRITICAL_HEALTH = 0.2; // and pulses below this (full effects only)

// The HUD store keeps health in hundredths: a selector returning the same number again does not render the bar,
// and a hit that adds 0.005 does not move it.
export const quantizeHealth = (health) => Math.round(Math.min(1, Math.max(0, Number.isFinite(health) ? health : 0)) * 100) / 100;

export function healthTone(health) {
  if (health < CRITICAL_HEALTH) return "critical";
  return health < LOW_HEALTH ? "low" : "ok";
}

// Green down to half, then through yellow at LOW_HEALTH to red at 0.
export function healthColor(health) {
  const h = Math.min(1, Math.max(0, health));
  const hue = h >= 0.5 ? 140 : h >= LOW_HEALTH ? 55 + ((h - LOW_HEALTH) / (0.5 - LOW_HEALTH)) * 85 : (h / LOW_HEALTH) * 55;
  return `hsl(${Math.round(hue)} 82% 56%)`;
}

// The pips of a rule that counts chances: Four Lives shows its four, One Life its one. null for the plain bar.
export function lifePips({ modifiers, lives, failed }) {
  if (modifiers?.includes("fl")) return { count: 4, filled: Math.max(0, lives ?? 0) };
  if (modifiers?.includes("ol")) return { count: 1, filled: failed ? 0 : 1 };
  return null;
}
