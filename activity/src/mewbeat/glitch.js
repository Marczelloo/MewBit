// Timelines for the glitch effects. Each is a pure function of elapsed ms, so a late tick simply lands
// on the right moment. Glitches come in bursts with quiet between them, stepped at about 18 Hz instead
// of eased, and they only ever darken the screen: no bright full-screen flashes.
export const FRAME_MS = 55;
export const UNLOCK = { riftMs: 1000, emergeMs: 1300, unclipMs: 2300, cardMs: 2880, closedMs: 3130 };
export const CUT = { holdMs: 300, endMs: 640 };

const TEAR_MAX = 230; // px of displacement at full strength; the band table uses under half of it
const SPLIT_MAX = 16; // px between the red and the cyan channel at full strength
const BAND_FREQS = [0.005, 0.011, 0.024];

const PAGE_BURSTS = [
  { from: 0, to: 150, peak: 0.4 },
  { from: 370, to: 530, peak: 0.6 },
  { from: 630, to: 1000, peak: 0.9 },
  { from: 1000, to: 1320, peak: 1 },
  { from: 1320, to: 1500, peak: 0.5 },
];
// Two kicks while she climbs out of the rift.
const SPRITE_BURSTS = [
  { from: 1300, to: 1620, peak: 0.7 },
  { from: 2000, to: 2110, peak: 0.8 },
  { from: 2500, to: 2610, peak: 0.7 },
];
const DIM_STOPS = [[0, 0], [370, 0.1], [630, 0.22], [800, 0.4], [1000, 0.62], [1150, 0.8], [1300, 0.9]];
// Rift width over time, in % of the figure box: a crack beside her hand that lurches open to the left.
const RIFT_STOPS = [
  { at: 1000, reach: 0, left: 64, right: 66, center: 65 },
  { at: 1120, reach: 0.55, left: 62, right: 68, center: 65 },
  { at: 1300, reach: 1, left: 58, right: 71, center: 65 },
  { at: 1500, reach: 1, left: 52, right: 72, center: 62 },
  { at: 1800, reach: 1, left: 42, right: 73, center: 58 },
  { at: 2000, reach: 1, left: 33, right: 75, center: 55 },
  { at: UNLOCK.unclipMs, reach: 1, left: 12, right: 86, center: 50 },
  { at: UNLOCK.cardMs, reach: 1, left: 12, right: 86, center: 50 },
  { at: UNLOCK.closedMs, reach: 0, left: 50, right: 50, center: 50 },
];
const RIFT_ROWS = 18;
const RIFT_TOP = 2; // % of the figure box; the rift reaches past her boots, so its box is taller
const RIFT_BOTTOM = 111;
const RIFT_ANCHOR = 30; // where the crack starts, about the height of her hand
export const RIFT_BOX_HEIGHT = 112; // % of the figure box; .mb-rift in mewbeat.css matches it
const RIFT_JAG = 3.2;
const RIFT_STEP_MS = 110;

// Repeatable noise in 0..1, so the same moment always looks the same.
export function rand(a, b = 0) {
  let h = Math.imul(a * 73856093 ^ b * 19349663, 0x5bd1e995);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
}

// Strength of a burst list at this moment: most frames fire at a random share of the peak, some drop out.
function burstLevel(ms, bursts, frame, salt) {
  const active = bursts.find((burst) => ms >= burst.from && ms < burst.to);
  if (!active || rand(frame, salt) > 0.8) return 0;
  return active.peak * (0.6 + 0.4 * rand(frame, salt + 1));
}

function signal(level, frame, salt) {
  return {
    seed: 1 + Math.floor(rand(frame, salt + 2) * 997),
    scale: Math.round(level * TEAR_MAX),
    split: Math.round(level * SPLIT_MAX * 10) / 10,
    freq: BAND_FREQS[Math.floor(rand(Math.floor(frame / 3), salt + 3) * BAND_FREQS.length)],
  };
}

// The whole page jumps a few pixels on the strongest frames, like a signal losing vertical hold.
function slip(level, frame) {
  if (level < 0.6 || rand(frame, 5) > 0.3) return 0;
  return Math.round((rand(frame, 6) - 0.5) * 36);
}

function stepped(stops, ms) {
  let value = stops[0][1];
  for (const [at, next] of stops) if (ms >= at) value = next;
  return value;
}

// The rift's outline at this moment: jagged rows from tip to tip, or null while it is shut.
export function riftShape(ms) {
  if (ms < UNLOCK.riftMs || ms >= UNLOCK.closedMs) return null;
  const step = Math.floor(ms / RIFT_STEP_MS);
  const at = step * RIFT_STEP_MS; // moves in lurches, not a smooth slide
  const index = Math.max(0, RIFT_STOPS.findIndex((stop) => stop.at > at) - 1);
  const a = RIFT_STOPS[index];
  const b = RIFT_STOPS[index + 1] || a;
  const t = b === a ? 0 : Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at)));
  const mix = (key) => a[key] + (b[key] - a[key]) * t;
  const reach = mix("reach");
  const left = mix("left");
  const right = mix("right");
  const center = mix("center");
  const top = RIFT_ANCHOR - reach * (RIFT_ANCHOR - RIFT_TOP);
  const bottom = RIFT_ANCHOR + reach * (RIFT_BOTTOM - RIFT_ANCHOR);
  return Array.from({ length: RIFT_ROWS + 1 }, (_, row) => {
    const u = row / RIFT_ROWS;
    const taper = Math.min(1, 1.7 * Math.sin(Math.PI * u));
    const spike = (key) => (rand(row + key + 1, step) > 0.8 ? 2.2 : 1);
    const jag = (key) => (u === 0 || u === 1 ? 0 : (rand(row + key, step) - 0.5) * 2 * RIFT_JAG * spike(key));
    const edgeLeft = center - (center - left) * taper + jag(100);
    const edgeRight = center + (right - center) * taper + jag(200);
    return { y: top + (bottom - top) * u, left: edgeLeft, right: Math.max(edgeLeft, edgeRight) };
  });
}

const point = (x, y) => `${x.toFixed(1)}% ${y.toFixed(1)}%`;

// One edge of the rift as hard pixel steps: each row keeps its x down to the next row, with no diagonals.
const stairs = (shape, key, scale = 1) => shape.flatMap((row, index) => {
  const next = shape[index + 1];
  return next ? [point(row[key], row.y * scale), point(row[key], next.y * scale)] : [point(row[key], row.y * scale)];
});

// clip-path for .mb-rift, whose box is RIFT_BOX_HEIGHT tall. "none" would show the whole box, so shut is an empty shape.
export function riftClip(shape) {
  if (!shape) return "polygon(0 0, 0 0, 0 0)";
  const scale = 100 / RIFT_BOX_HEIGHT;
  return `polygon(${[...stairs(shape, "right", scale), ...stairs(shape, "left", scale).reverse()].join(", ")})`;
}

// clip-path for Mewbit while she climbs out: only the rift's left edge hides her, so her hand and head can cross
// the right rim. Once she has stepped through, nothing clips her.
export function spriteClip(shape, ms) {
  if (!shape || ms >= UNLOCK.unclipMs) return "none";
  const edge = stairs(shape, "left");
  const first = shape[0].left;
  const last = shape[shape.length - 1].left;
  return `polygon(${[point(first, -40), ...edge, point(last, 140), point(140, 140), point(140, -40)].join(", ")})`;
}

export function unlockStageAt(ms) {
  if (ms < UNLOCK.emergeMs) return "glitch";
  if (ms < UNLOCK.cardMs) return "emerge";
  return ms < UNLOCK.closedMs ? "card" : "settled";
}

export function unlockAt(ms) {
  const frame = Math.floor(ms / FRAME_MS);
  const page = burstLevel(ms, PAGE_BURSTS, frame, 11);
  const sprite = burstLevel(ms, SPRITE_BURSTS, frame, 21);
  const shape = riftShape(ms);
  return {
    stage: unlockStageAt(ms),
    frame,
    page: signal(page, frame, 11),
    sprite: signal(sprite, frame, 21),
    slip: slip(page, frame),
    dim: stepped(DIM_STOPS, ms),
    noise: Math.max(page, sprite * 0.5),
    scan: shape && ms < UNLOCK.cardMs ? 0.5 : Math.min(0.5, page),
    riftClip: riftClip(shape),
    spriteClip: spriteClip(shape, ms),
    riftSplit: 3 + sprite * 6,
  };
}

// The way into the game: tear and cut to black by holdMs, then the game resolves out of the noise.
// dimFrom lets it start from a screen that is already dark, like the unlock card.
export function cutAt(ms, dimFrom = 0) {
  const frame = Math.floor(ms / FRAME_MS);
  const rising = ms < CUT.holdMs;
  const t = rising ? ms / CUT.holdMs : Math.min(1, (ms - CUT.holdMs) / (CUT.endMs - CUT.holdMs));
  const envelope = rising ? 0.55 + 0.45 * t : (1 - t) ** 2;
  const gate = ms >= CUT.endMs || rand(frame, 31) > 0.88 ? 0 : 0.7 + 0.3 * rand(frame, 32);
  const level = envelope * gate;
  const dim = rising ? [0.2, 0.55, 0.85, 1][Math.floor(t * 4)] : Math.max(0, 1 - Math.floor(t * 5) / 4);
  return {
    frame,
    page: signal(level, frame, 31),
    slip: slip(level, frame),
    dim: rising ? Math.max(dimFrom, dim) : dim,
    noise: level,
    scan: Math.min(0.5, level),
  };
}
