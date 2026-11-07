// Where the drums stop: a stretch with no cymbals or hats (the high band nearly silent, the high-mid sparse) has no drum kit
// playing, yet the drums layer can still hear a low instrument's attacks as kicks (REVOLVANIA 0:00-0:20, a bass brass line
// read as 12 kicks a second). There a level keeps the moments a pitched line plays (bass, lead, the decoded melody) and
// drops the ones only those "kicks" gave it. Train Normal: such moments are people's 14% of the time.
const { lowerBound } = require("./util");

const NEAR_MS = 35; // the onset a note plays

// The indexes of the windowMs windows where the high band plays under rule.highBelow onsets a second and the high-mid
// under rule.highmidBelow. Kept on the ctx.
function drumlessWindows(ctx, rule) {
  ctx.drumless ??= new Map();
  const key = `${rule.windowMs}:${rule.highBelow}:${rule.highmidBelow}`;
  if (ctx.drumless.has(key)) return ctx.drumless.get(key);
  const band = (name) => (ctx.features.bands ?? []).find((b) => b.name === name)?.onsets;
  const high = band("high"), highmid = band("highmid");
  const out = new Set();
  if (Array.isArray(high) && Array.isArray(highmid)) {
    const count = (onsets) => {
      const n = new Map();
      for (const o of onsets) n.set(Math.floor(o.t / rule.windowMs), (n.get(Math.floor(o.t / rule.windowMs)) ?? 0) + 1);
      return n;
    };
    const h = count(high), m = count(highmid), sec = rule.windowMs / 1000;
    const windows = Math.ceil((ctx.durationMs ?? ctx.features.durationMs ?? 0) / rule.windowMs);
    for (let w = 0; w < windows; w++) if ((h.get(w) ?? 0) / sec < rule.highBelow && (m.get(w) ?? 0) / sec < rule.highmidBelow) out.add(w);
  }
  ctx.drumless.set(key, out);
  return out;
}

// thinDrumless(notes, ctx, rule, melody) -> notes without the moments in a drumless window (drumlessWindows) that no
// bass, lead or melody note starts within NEAR_MS of. Holds stay. rule = diff.drumless = { windowMs, highBelow,
// highmidBelow }; melody = the decoded melody a level reads, or null.
function thinDrumless(notes, ctx, rule, melody) {
  if (!rule) return notes;
  const windows = drumlessWindows(ctx, rule);
  if (windows.size === 0) return notes;
  const pitched = [...(ctx.features.bass ?? []), ...(ctx.features.lead ?? []), ...(melody ?? [])].map((n) => n.t).sort((a, b) => a - b);
  const plays = (t) => {
    const i = lowerBound(pitched, t - NEAR_MS);
    return i < pitched.length && pitched[i] <= t + NEAR_MS;
  };
  const dropped = new Set(notes.filter((n) => !(n.len > 0) && windows.has(Math.floor(n.t / rule.windowMs)) && !plays(n.t)).map((n) => n.t));
  const held = new Set(notes.filter((n) => n.len > 0).map((n) => n.t));
  return dropped.size ? notes.filter((n) => !dropped.has(n.t) || held.has(n.t)) : notes;
}

module.exports = { drumlessWindows, thinDrumless };
