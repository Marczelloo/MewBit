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

// Vertical position of a note: 0 at the top when it is approachMs away, hitLineY on the line,
// below it once it is past.
export function noteY(t, heardMs, approachMs, hitLineY) {
  return hitLineY * (1 - (t - heardMs) / approachMs);
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
const DROPPED_COLOR = "#5b6170";
const DROPPED_ALPHA = 0.45;

const CYAN = "#67e3f4";
const VIOLET = "#a78bfa";
const PINK = "#ff6ec7";
const WHITE = "#f4f6f9";
// Mockup v3 lane colours: cyan, violet, pink, white.
const LANE_COLORS = [CYAN, VIOLET, PINK, WHITE];
const JUDGEMENT_COLORS = { perfect: CYAN, great: VIOLET, good: "#c3cbd7", miss: "#ff8098" };

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
//   render({ heardMs, approachMs, notes, lanesDown, flashes, feverActive })
//     notes: run.visibleNotes() entries ({ t, lane, outcome, len, hold }); flashes: [{ lane, judgement, at }] with `at` in heard ms.
//     Keep a flash object stable between frames, it is how particles are spawned only once.
export function createHighwayRenderer(canvas, { effects = "full" } = {}) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let particles = [];
  let seenFlashes = new WeakSet();
  let lastFrameAt = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawLanes(feverActive, lanesDown, laneWidth, hitY) {
    ctx.clearRect(0, 0, width, height);
    // The highway's dark gradient is CSS behind the canvas; the canvas only tints it during FEVER.
    const top = feverActive ? "rgba(255, 110, 199, 0.12)" : "rgba(12, 14, 18, 0)";
    const bottom = feverActive ? "rgba(255, 212, 121, 0.20)" : "rgba(12, 14, 18, 0)";
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, top);
    grad.addColorStop(0.3, bottom);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    for (let lane = 0; lane < LANES; lane += 1) {
      const x = lane * laneWidth;
      const down = Boolean(lanesDown[lane]);
      if (down) {
        const glow = ctx.createLinearGradient(0, height * 0.55, 0, height);
        glow.addColorStop(0, "rgba(255, 255, 255, 0)");
        glow.addColorStop(1, LANE_COLORS[lane]);
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

  function drawNote(lane, y, laneWidth, alpha, color = LANE_COLORS[lane]) {
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
  function drawHoldTail(lane, topY, bottomY, laneWidth, color, alpha, flat) {
    const w = laneWidth * HOLD_WIDTH;
    const h = bottomY - topY;
    if (h <= 0) return;
    const x = lane * laneWidth + (laneWidth - w) / 2;
    if (flat) {
      ctx.fillStyle = color;
    } else {
      const grad = ctx.createLinearGradient(0, topY, 0, bottomY);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(255, 255, 255, 0.9)");
      ctx.fillStyle = grad;
    }
    ctx.globalAlpha = alpha;
    roundedRect(ctx, x, topY, w, h, Math.min(w, h) / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // One hold. pending: tail from the head up to the end, head on top. held: the tail starts at the
  // receptor and the head is gone. dropped: grey tail and head, fading once the end is past the line.
  // done: nothing (the tail was completed).
  function drawHold(note, y, heardMs, approachMs, laneWidth, hitY) {
    if (note.hold === "done") return;
    const endY = noteY(note.t + note.len, heardMs, approachMs, hitY);
    const flat = effects === "off";
    if (note.hold === "held") {
      drawHoldTail(note.lane, endY, hitY, laneWidth, LANE_COLORS[note.lane], HOLD_ALPHA, flat);
    } else if (note.hold === "dropped") {
      const fade = Math.min(1, 1 - (heardMs - (note.t + note.len)) / MISS_FADE_MS);
      if (fade <= 0) return;
      drawHoldTail(note.lane, endY, y, laneWidth, DROPPED_COLOR, DROPPED_ALPHA * fade, true);
      drawNote(note.lane, y, laneWidth, DROPPED_ALPHA * fade, DROPPED_COLOR);
    } else {
      const skipped = note.outcome === "skipped";
      drawHoldTail(note.lane, endY, y, laneWidth, LANE_COLORS[note.lane], skipped ? SKIPPED_ALPHA * HOLD_ALPHA : HOLD_ALPHA, flat);
      drawNote(note.lane, y, laneWidth, skipped ? SKIPPED_ALPHA : 1);
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
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.life -= dt * 2.4;
      if (p.life <= 0) continue;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function render({ heardMs, approachMs, notes, lanesDown = [], flashes = [], feverActive = false }) {
    if (!width) resize();
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
        drawNote(note.lane, y, laneWidth, outcome === "skipped" ? SKIPPED_ALPHA : 1);
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

  return { resize, render, destroy };
}
