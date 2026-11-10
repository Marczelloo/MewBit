// Time a note takes to fall from the top of the highway to the hit line. Speed 1 is 2200 ms;
// each step up shaves 15 %. Floored, not rounded: speed 10 is 509.56 ms and the spec says 509.
export function approachMsFor(scrollSpeed) {
  return Math.floor(2200 * 0.85 ** (scrollSpeed - 1));
}

// A song's tempo nudges the fall speed: notes fall faster in a fast song, so its beats are not crammed together. A slow
// song keeps the player's speed: slowed further it played too slow (The Rebel Path, 90 BPM, by ear). Gentle (square root
// around 120 BPM) and bounded, and constant for the whole song, so reading stays predictable. No trusted tempo (bpm null)
// keeps the player's speed as it is.
const TEMPO_BASE_BPM = 120;
const TEMPO_FACTOR_MIN = 1;
const TEMPO_FACTOR_MAX = 1.2;
export function tempoScrollFactor(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) return 1;
  return Math.min(TEMPO_FACTOR_MAX, Math.max(TEMPO_FACTOR_MIN, Math.sqrt(bpm / TEMPO_BASE_BPM)));
}

// The same nudge from how busy the song plays (chart.pace, chartStore.js: Normal's moments a second in its busier parts),
// taken where it is the larger. Stronger than the tempo's (in step with the pace, up to 1.4): a square root up to 1.2
// was far too little by ear (Rude Buster, 132 BPM, 6 a second: 1.4 rather than 1.05). A pace at a typical Normal's 4.2
// keeps the speed.
const PACE_BASE = 4.2;
const PACE_FACTOR_MAX = 1.4;
export function scrollFactor(chart) {
  const pace = chart?.pace;
  const byPace = Number.isFinite(pace) && pace > 0 ? Math.min(PACE_FACTOR_MAX, Math.max(TEMPO_FACTOR_MIN, pace / PACE_BASE)) : 1;
  return Math.max(tempoScrollFactor(chart?.bpm), byPace);
}

// The notes fall at one pixel speed whatever the highway's height: the visible window grows with the hit line's distance
// from the top (hitY), so a tall viewport shows more of the song instead of dropping the notes faster. REF_HIT_Y is the
// hit line of a 720 px tall viewport: the stage is 720 - 51 (header: 8 + 34 + 8 padding and a 1 px border) = 669 px,
// the highway slot takes 18 px of padding off the top (the canvas is 651 px tall) and the hit line sits 72 px from the
// bottom (HIT_LINE_FROM_BOTTOM below). Speed 1 there is still 2200 ms, as the settings always said.
export const REF_HIT_Y = 579;
export const HIT_Y_RATIO_MIN = 0.6;
export const HIT_Y_RATIO_MAX = 3;
export function hitYRatio(hitY) {
  if (!Number.isFinite(hitY) || hitY <= 0) return 1;
  return Math.min(HIT_Y_RATIO_MAX, Math.max(HIT_Y_RATIO_MIN, hitY / REF_HIT_Y));
}

// The one place the approach (ms for a note to fall from the top to the hit line) is worked out: the player's speed
// stretched by the highway's height, then shortened by the tempo factor (scrollFactor, 1 when tempo scrolling is off).
// At REF_HIT_Y and tempo 1 it is approachMsFor(scrollSpeed).
export function approachFor(scrollSpeed, hitY, tempo = 1) {
  return Math.floor((approachMsFor(scrollSpeed) * hitYRatio(hitY)) / (tempo > 0 ? tempo : 1));
}

// The longest approach approachFor can give (slowest speed, tallest highway, no tempo nudge): run.swapChart keeps this
// much of the old chart by default so nothing visible is ever cut.
export const MAX_APPROACH_MS = Math.floor(approachMsFor(1) * HIT_Y_RATIO_MAX);

// Vertical position of a note: 0 at the top when it is approachMs away, hitLineY on the line,
// below it once it is past.
export function noteY(t, heardMs, approachMs, hitLineY) {
  return hitLineY * (1 - (t - heardMs) / approachMs);
}

// Ghost Notes: a note is fully there up to GHOST_FROM of its way down to the hit line, gone by GHOST_TO, and fades
// linearly in between. progress is y / hitY (0 at the top, 1 on the line).
export const GHOST_FROM = 0.65;
export const GHOST_TO = 0.85;
export function ghostAlpha(progress) {
  if (progress <= GHOST_FROM) return 1;
  if (progress >= GHOST_TO) return 0;
  return (GHOST_TO - progress) / (GHOST_TO - GHOST_FROM);
}

const LANES = 4;
const MISS_FADE_MS = 450;
const FLASH_MS = 220;
const SKIPPED_ALPHA = 0.35;
const HIT_LINE_FROM_BOTTOM = 72; // css px between the hit line and the bottom of the canvas
const NOTE_HEIGHT = 22;
const DRAWN_OUTCOMES = new Set(["pending", "skipped", "miss"]);
const MAX_PARTICLES = 80;
const HOLD_WIDTH = 0.38; // hold tail width, as a fraction of the lane
const HOLD_ALPHA = 0.55;
const HOLD_GRADIENT_UNITS = 100;
const DROPPED_COLOR = "#5b6170";
const DROPPED_ALPHA = 0.45;

const CYAN = "#67e3f4";
const VIOLET = "#a78bfa";
const PINK = "#ff6ec7";
const WHITE = "#f4f6f9";
// Mockup v3 lane colours: cyan, violet, pink, white.
const LANE_COLORS = [CYAN, VIOLET, PINK, WHITE];
const JUDGEMENT_COLORS = { perfect: CYAN, great: VIOLET, good: "#c3cbd7", miss: "#ff8098" };
// No Colors: every note and hold in one colour, so the lane has to be read from where the note is, not what it looks like.
const MONO_COLOR = "#c9d1dc";

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws the four lanes, the receptors and the falling notes onto a canvas. All DOM and canvas
// access lives in here, so the module's top level stays importable from Node.
//   effects: "full" | "reduced" | "off". Reduced drops the particles, off drops the hit flashes too.
//   render({ heardMs, approachMs, notes, lanesDown, flashes, feverActive, ghost, mono })
//     notes: run.visibleNotes() entries ({ t, lane, outcome, len, hold }); flashes: [{ lane, judgement, at }] with `at` in heard ms.
//     ghost: Ghost Notes, upcoming notes and hold bodies fade out on the way to the line (see ghostAlpha).
//     mono: No Colors, notes and hold bodies all in MONO_COLOR (the lanes and receptors keep theirs).
//     Keep a flash object stable between frames, it is how particles are spawned only once.
export function createHighwayRenderer(canvas, { effects = "full" } = {}) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let particles = [];
  let seenFlashes = new WeakSet();
  let lastFrameAt = null;
  const noteSprites = new Map();
  const holdGradients = new Map();
  // Ghost Notes fades a hold body by where it is on the canvas, so its gradient lives in canvas space: one per colour and height.
  const ghostGradients = new Map();
  let ghostOn = false;
  let monoOn = false;
  const noteColor = (lane) => (monoOn ? MONO_COLOR : LANE_COLORS[lane]);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    noteSprites.clear();
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Gradients depend on the canvas height alone, so they are built once per height instead of every frame.
  let gradientsFor = 0;
  let feverTint = null;
  const laneGlows = [];

  function gradientsAt() {
    if (gradientsFor === height) return;
    gradientsFor = height;
    ghostGradients.clear();
    feverTint = ctx.createLinearGradient(0, 0, 0, height);
    feverTint.addColorStop(0, "rgba(255, 110, 199, 0.12)");
    feverTint.addColorStop(0.3, "rgba(255, 212, 121, 0.20)");
    feverTint.addColorStop(1, "rgba(255, 212, 121, 0.20)");
    for (let lane = 0; lane < LANES; lane += 1) {
      const glow = ctx.createLinearGradient(0, height * 0.55, 0, height);
      glow.addColorStop(0, "rgba(255, 255, 255, 0)");
      glow.addColorStop(1, LANE_COLORS[lane]);
      laneGlows[lane] = glow;
    }
  }

  function drawLanes(feverActive, lanesDown, laneWidth, hitY) {
    ctx.clearRect(0, 0, width, height);
    gradientsAt();
    // The highway's dark gradient is CSS behind the canvas; the canvas only tints it during FEVER (outside it the tint is clear, so there is nothing to paint).
    if (feverActive) {
      ctx.fillStyle = feverTint;
      ctx.fillRect(0, 0, width, height);
    }

    for (let lane = 0; lane < LANES; lane += 1) {
      const x = lane * laneWidth;
      const down = Boolean(lanesDown[lane]);
      if (down) {
        const glow = laneGlows[lane];
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = glow;
        ctx.fillRect(x, height * 0.55, laneWidth, height * 0.45);
      }
      ctx.globalAlpha = 1;
      if (lane > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(x, 0, 1, height);
      }
      roundedRect(ctx, x + laneWidth * 0.12, hitY - 13, laneWidth * 0.76, 26, 8);
      ctx.strokeStyle = LANE_COLORS[lane];
      ctx.lineWidth = 2;
      ctx.globalAlpha = down ? 1 : 0.55;
      ctx.stroke();
      if (down) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = LANE_COLORS[lane];
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // A fully opaque note is stamped from a small canvas drawn once per lane and colour (the three fills below, with the
  // lane's fractional x baked in, so the edges stay as sharp as when they were drawn every frame). A faded note keeps
  // the three fills: its shadow shows through the body, which one stamped image would not.
  const SPRITE_PAD = 2;
  function noteSprite(lane, laneWidth, color) {
    const key = `${lane}|${color}`;
    let sprite = noteSprites.get(key);
    if (sprite) return sprite;
    const dpr = window.devicePixelRatio || 1;
    const x = lane * laneWidth + laneWidth * 0.12;
    const w = laneWidth * 0.76;
    const fx = x - Math.floor(x);
    const cssW = Math.ceil(w + fx + SPRITE_PAD * 2);
    const cssH = NOTE_HEIGHT + 3 + SPRITE_PAD * 2;
    const el = document.createElement("canvas");
    el.width = Math.ceil(cssW * dpr);
    el.height = Math.ceil(cssH * dpr);
    const c = el.getContext("2d");
    c.scale(dpr, dpr);
    const ox = SPRITE_PAD + fx;
    c.fillStyle = "rgba(0, 0, 0, 0.45)";
    roundedRect(c, ox, SPRITE_PAD + 3, w, NOTE_HEIGHT, 8);
    c.fill();
    c.fillStyle = color;
    roundedRect(c, ox, SPRITE_PAD, w, NOTE_HEIGHT, 8);
    c.fill();
    c.fillStyle = "rgba(255, 255, 255, 0.55)";
    roundedRect(c, ox + w * 0.3, SPRITE_PAD + 5, w * 0.4, NOTE_HEIGHT - 10, 4);
    c.fill();
    sprite = { el, left: Math.floor(x) - SPRITE_PAD, cssW, cssH };
    noteSprites.set(key, sprite);
    return sprite;
  }

  function drawNote(lane, y, laneWidth, alpha, color = noteColor(lane)) {
    if (alpha === 1) {
      const sprite = noteSprite(lane, laneWidth, color);
      ctx.drawImage(sprite.el, sprite.left, y - NOTE_HEIGHT / 2 - SPRITE_PAD, sprite.cssW, sprite.cssH);
      return;
    }
    const x = lane * laneWidth + laneWidth * 0.12;
    const w = laneWidth * 0.76;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    roundedRect(ctx, x, y - NOTE_HEIGHT / 2 + 3, w, NOTE_HEIGHT, 8);
    ctx.fill();
    ctx.fillStyle = color;
    roundedRect(ctx, x, y - NOTE_HEIGHT / 2, w, NOTE_HEIGHT, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    roundedRect(ctx, x + w * 0.3, y - NOTE_HEIGHT / 2 + 5, w * 0.4, NOTE_HEIGHT - 10, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // The body of a hold: a rounded bar between two y values (top is the end, bottom the head or the
  // receptor). Effects "off" is flat colour; otherwise it shades from the lane colour to white.
  function drawHoldTail(lane, topY, bottomY, laneWidth, color, alpha, flat, ghost = false, hitY = 0) {
    const w = laneWidth * HOLD_WIDTH;
    const h = bottomY - topY;
    if (h <= 0) return;
    const x = lane * laneWidth + (laneWidth - w) / 2;
    ctx.globalAlpha = alpha;
    roundedRect(ctx, x, topY, w, h, Math.min(w, h) / 2);
    if (ghost) {
      ctx.fillStyle = ghostGradient(color, hitY);
      ctx.fill();
    } else if (flat) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      // One unit gradient per colour (0..HOLD_GRADIENT_UNITS), mapped onto the tail by the transform at fill time. The
      // path above is already in canvas space, so only the gradient is stretched; no gradient is built per frame.
      ctx.save();
      ctx.translate(0, topY);
      ctx.scale(1, h / HOLD_GRADIENT_UNITS);
      ctx.fillStyle = holdGradient(color);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // The lane colour down to the ghost fade: solid until GHOST_FROM of the way to the line, clear from GHOST_TO on.
  function ghostGradient(color, hitY) {
    let grad = ghostGradients.get(color);
    if (!grad) {
      grad = ctx.createLinearGradient(0, 0, 0, hitY);
      grad.addColorStop(0, color);
      grad.addColorStop(GHOST_FROM, color);
      grad.addColorStop(GHOST_TO, `${color}00`);
      ghostGradients.set(color, grad);
    }
    return grad;
  }

  function holdGradient(color) {
    let grad = holdGradients.get(color);
    if (!grad) {
      grad = ctx.createLinearGradient(0, 0, 0, HOLD_GRADIENT_UNITS);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(255, 255, 255, 0.9)");
      holdGradients.set(color, grad);
    }
    return grad;
  }

  // One hold. pending: tail from the head up to the end, head on top. held: the tail starts at the
  // receptor and the head is gone. dropped: grey tail and head, fading once the end is past the line.
  // done: nothing (the tail was completed).
  function drawHold(note, y, heardMs, approachMs, laneWidth, hitY) {
    if (note.hold === "done") return;
    const endY = noteY(note.t + note.len, heardMs, approachMs, hitY);
    const flat = effects === "off";
    if (note.hold === "held") {
      drawHoldTail(note.lane, endY, hitY, laneWidth, noteColor(note.lane), HOLD_ALPHA, flat, ghostOn, hitY);
    } else if (note.hold === "dropped") {
      const fade = Math.min(1, 1 - (heardMs - (note.t + note.len)) / MISS_FADE_MS);
      if (fade <= 0) return;
      drawHoldTail(note.lane, endY, y, laneWidth, DROPPED_COLOR, DROPPED_ALPHA * fade, true);
      drawNote(note.lane, y, laneWidth, DROPPED_ALPHA * fade, DROPPED_COLOR);
    } else {
      const skipped = note.outcome === "skipped";
      drawHoldTail(note.lane, endY, y, laneWidth, noteColor(note.lane), skipped ? SKIPPED_ALPHA * HOLD_ALPHA : HOLD_ALPHA, flat, ghostOn, hitY);
      const headAlpha = ghostOn ? ghostAlpha(y / hitY) : 1;
      if (headAlpha > 0) drawNote(note.lane, y, laneWidth, skipped ? SKIPPED_ALPHA * headAlpha : headAlpha);
    }
  }

  function spawnParticles(flash, laneWidth, hitY) {
    const color = JUDGEMENT_COLORS[flash.judgement] ?? CYAN;
    const count = flash.judgement === "perfect" ? 9 : 5;
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 60 + Math.random() * 140;
      particles.push({
        x: flash.lane * laneWidth + laneWidth / 2,
        y: hitY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
      });
    }
    if (particles.length > MAX_PARTICLES) particles = particles.slice(-MAX_PARTICLES);
  }

  function drawFlashes(flashes, heardMs, laneWidth, hitY) {
    for (const flash of flashes) {
      const age = heardMs - flash.at;
      if (age < 0 || age > FLASH_MS) continue;
      if (!seenFlashes.has(flash)) {
        seenFlashes.add(flash);
        if (effects === "full" && flash.judgement !== "miss") spawnParticles(flash, laneWidth, hitY);
      }
      ctx.globalAlpha = 0.5 * (1 - age / FLASH_MS);
      ctx.fillStyle = JUDGEMENT_COLORS[flash.judgement] ?? CYAN;
      roundedRect(ctx, flash.lane * laneWidth + laneWidth * 0.08, hitY - 18, laneWidth * 0.84, 36, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles(dtMs) {
    const dt = dtMs / 1000;
    // Dead ones are dropped in place; one that dies this frame stays until the next, as it always did.
    let kept = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.life <= 0) continue;
      particles[kept] = p;
      kept += 1;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.life -= dt * 2.4;
      if (p.life <= 0) continue;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    particles.length = kept;
    ctx.globalAlpha = 1;
  }

  function render({ heardMs, approachMs, notes, lanesDown = [], flashes = [], feverActive = false, ghost = false, mono = false }) {
    if (!width) resize();
    ghostOn = ghost;
    monoOn = mono;
    const laneWidth = width / LANES;
    const hitY = height - HIT_LINE_FROM_BOTTOM;
    drawLanes(feverActive, lanesDown, laneWidth, hitY);

    for (const note of notes) {
      const y = noteY(note.t, heardMs, approachMs, hitY);
      if (note.len > 0) {
        drawHold(note, y, heardMs, approachMs, laneWidth, hitY);
        continue;
      }
      const outcome = note.outcome ?? "pending";
      if (!DRAWN_OUTCOMES.has(outcome)) continue; // perfect, great and good vanish on the hit
      if (y < -NOTE_HEIGHT) continue;
      if (outcome === "miss") {
        // A miss keeps falling past the line and fades out.
        const fade = 1 - (heardMs - note.t) / MISS_FADE_MS;
        if (fade > 0) drawNote(note.lane, y, laneWidth, 0.7 * Math.min(1, fade));
      } else {
        const alpha = ghostOn ? ghostAlpha(y / hitY) : 1;
        if (alpha > 0) drawNote(note.lane, y, laneWidth, outcome === "skipped" ? SKIPPED_ALPHA * alpha : alpha);
      }
    }

    if (effects !== "off") drawFlashes(flashes, heardMs, laneWidth, hitY);
    const now = performance.now();
    const dtMs = lastFrameAt === null ? 16 : Math.min(64, now - lastFrameAt);
    lastFrameAt = now;
    if (effects === "full") drawParticles(dtMs);
    else particles = [];
  }

  function destroy() {
    particles = [];
    seenFlashes = new WeakSet();
    ctx.clearRect(0, 0, width, height);
  }

  // Where the hit line sits, in css px from the top of the canvas (measures the canvas first if it never was).
  function hitY() {
    if (!width) resize();
    return height - HIT_LINE_FROM_BOTTOM;
  }

  return { resize, render, destroy, hitY };
}
