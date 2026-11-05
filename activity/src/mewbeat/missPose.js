// How long Mewbit reacts to a miss. A miss that breaks a combo of CRUSH_COMBO or more plays the
// crushed pose (28 frames at 24 fps, about 1.17 s, then it holds its last frame), so its window is
// longer than the plain miss pose. CRUSHED_POSE_MS leaves the fall room to land and hold a moment.
export const MISS_POSE_MS = 600;
export const CRUSHED_POSE_MS = 1500;
export const CRUSH_COMBO = 25;

// The pose state after a miss. `combo` is the combo the miss breaks; `crushed` and `until` are the
// state before it. Misses come in bunches (a chord drops several notes in one tick, and the combo
// is already 0 for the second one), so a miss inside a crushed window must not cut the fall short.
export function missPose({ combo, now, crushed, until }) {
  if (combo >= CRUSH_COMBO) return { crushed: true, until: now + CRUSHED_POSE_MS };
  if (crushed && now < until) return { crushed: true, until };
  return { crushed: false, until: now + MISS_POSE_MS };
}
