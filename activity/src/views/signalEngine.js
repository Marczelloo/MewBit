// The Signal loader's light engine. The avatar's waveform runs through a tilted
// ring of light with an EQ breathing around it; on ready the ring faces you and
// closes, the EQ retracts into the ears, the wave folds into the mark's three
// bars, and a white-out hands over to the DOM lockup.
//
// The scene is authored in a 1280x720 space and scaled to fit the viewport, so
// its geometry lines up with the lockup at any window size.

export const STAGE_W = 1280;
export const STAGE_H = 720;
const CX = 640;
const CY = 360;
const CAM = 1000;
// The intro always gets this long to form before the finale may start.
const MIN_FORM = 1.7;
// Finale: the mark builds, holds a beat, then the white-out.
const BUILD = 1.25;
export const FLASH_AT = 1.5;
export const DONE_AT = 3.1;
export const STOP_AT = 3.95;
// One logo unit (the 32-unit mark grid) in stage pixels.
const K = 12.5;
const BARS = 72;
const WAVE_HALF = 600;
const TAU = Math.PI * 2;
// Keeps the full-viewport canvas cheap on large or dense screens.
const MAX_PIXELS = 2.6e6;

const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angDist(a, b) {
  const d = a - b;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

function arcPts(cx, cy, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// The MewBit mark in logo units, centred on the ring (mark.svg minus 16).
const MARK = {
  earL: [[-7.6, -4.8], [-8.8, -10.4], [-3.6, -7.4]],
  earR: [[7.6, -4.8], [8.8, -10.4], [3.6, -7.4]],
  bandL: [[-7.4, 2.4]].concat(arcPts(0, 0.2, 7.4, Math.PI, Math.PI * 1.5, 14)),
  bandR: [[7.4, 2.4]].concat(arcPts(0, 0.2, 7.4, TAU, Math.PI * 1.5, 14)),
  cups: [[-9.6, 1.6], [5.4, 1.6]],
  wave: [[-3, 3.4, 6], [0, 1.4, 8], [3, 3.4, 6]],
};
const EAR_A = [Math.atan2(-10.4, -8.8), Math.atan2(-10.4, 8.8)];

// Adds the first p (0..1, by length) of a polyline to the current path.
function trace(ctx, pts, p, cx, cy, k) {
  if (p <= 0) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * Math.min(1, p);
  ctx.moveTo(cx + pts[0][0] * k, cy + pts[0][1] * k);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    const u = seg > left ? left / seg : 1;
    ctx.lineTo(cx + lerp(ax, bx, u) * k, cy + lerp(ay, by, u) * k);
    left -= seg;
  }
}

// A stroke of light: wide cyan haze, a brighter body, a near-white core.
function glowStroke(ctx, build, w, a, core) {
  if (a <= 0.002) return;
  const passes = [[2.8, `rgba(103,227,244,${0.09 * a})`], [1.4, `rgba(150,236,250,${0.32 * a})`], [0.62, `rgba(${core},${Math.min(1, 0.95 * a)})`]];
  for (const [m, col] of passes) {
    ctx.lineWidth = w * m;
    ctx.strokeStyle = col;
    ctx.beginPath();
    build();
    ctx.stroke();
  }
}

function rrect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws the parts of the mark that are lit; each part takes 0..1.
function drawMark(ctx, m, a, cx, cy, k) {
  const w = 1.7 * k * 0.7;
  const white = "244,248,252", cyan = "178,244,255";
  if (m.ring) glowStroke(ctx, () => ctx.arc(cx, cy, 13.2 * k, 0, TAU), 1.5 * k * 0.55, a * 0.34 * m.ring, white);
  if (m.ears) {
    // Each ear grows from its tip down both of its sides.
    glowStroke(ctx, () => {
      for (const e of [MARK.earL, MARK.earR]) {
        trace(ctx, [e[1], e[0]], m.ears, cx, cy, k);
        trace(ctx, [e[1], e[2]], m.ears, cx, cy, k);
      }
    }, w, a, white);
  }
  if (m.band) {
    glowStroke(ctx, () => { trace(ctx, MARK.bandL, m.band, cx, cy, k); trace(ctx, MARK.bandR, m.band, cx, cy, k); }, w, a, white);
  }
  if (m.cups) {
    const g = easeOut(m.cups);
    for (const [x, y] of MARK.cups) {
      const h = 6.4 * k * g, mid = cy + (y + 3.2) * k;
      ctx.fillStyle = `rgba(103,227,244,${0.18 * a * m.cups})`;
      ctx.beginPath(); rrect(ctx, cx + x * k - 6, mid - h / 2 - 6, 4.2 * k + 12, h + 12, 2.1 * k + 6); ctx.fill();
      ctx.fillStyle = `rgba(${white},${0.92 * a * m.cups})`;
      ctx.beginPath(); rrect(ctx, cx + x * k, mid - h / 2, 4.2 * k, h, Math.min(2.1 * k, h / 2)); ctx.fill();
    }
  }
  if (m.wave) {
    glowStroke(ctx, () => {
      for (const [x, y0, y1] of MARK.wave) {
        const mid = (y0 + y1) / 2, half = ((y1 - y0) / 2) * m.wave;
        ctx.moveTo(cx + x * k, cy + (mid - half) * k);
        ctx.lineTo(cx + x * k, cy + (mid + half) * k + 0.01);
      }
    }, w, a * Math.min(1, m.wave * 2), cyan);
  }
}

// Before the flash the finished mark gathers to the size and place of the
// lockup's SVG mark (200px, scaled 1.3 by its entrance), so the swap reads as one object.
function markPose(S) {
  const e = easeInOut(S.swell);
  return { cx: CX, cy: lerp(CY, 306, e), k: K * lerp(1, 0.65, e) };
}

// Perspective helper for a ring tilted by (tx around X, ty around Y).
function ringProjector(tx, ty, cx, cy) {
  const cxs = Math.cos(tx), sxs = Math.sin(tx), cys = Math.cos(ty), sys = Math.sin(ty);
  return (theta, r, out) => {
    const x = Math.cos(theta) * r, y0 = Math.sin(theta) * r;
    const y = y0 * cxs, z1 = y0 * sxs;
    const x2 = x * cys + z1 * sys, z2 = -x * sys + z1 * cys;
    const s = CAM / (CAM + z2);
    out[0] = cx + x2 * s; out[1] = cy + y * s; out[2] = s;
    return out;
  };
}

function sceneInit(rand) {
  return {
    phase: Array.from({ length: BARS }, () => rand() * TAU),
    vals: new Float32Array(BARS),
    comets: [
      { a: rand() * TAU, w: 1.15, len: 1.3, al: 1 },
      { a: rand() * TAU, w: -0.82, len: 0.9, al: 0.8 },
      { a: rand() * TAU, w: 1.7, len: 0.55, al: 0.65 },
    ],
    p: [0, 0, 0],
  };
}

function sceneDraw(ctx, S, sc) {
  const { t, dt, b, vis } = S;
  const settle = easeInOut(clamp(b / 0.5));
  const P = markPose(S);
  const tx = (0.62 + 0.06 * Math.sin(t * 0.5)) * (1 - settle);
  const ty = 0.32 * Math.sin(t * 0.33) * (1 - settle);
  const proj = ringProjector(tx, ty, P.cx, P.cy);
  const p = sc.p;
  const R = 13.2 * P.k;

  // EQ: each bar eases toward a spectrum that flows around the ring.
  const retract = easeIn(clamp(b / 0.42));
  const earRetract = easeInOut(clamp((b - 0.08) / 0.45));
  const lift = 0.55 + 0.75 * S.beat;
  for (let i = 0; i < BARS; i++) {
    const th = (i / BARS) * TAU - Math.PI / 2;
    const flow = 0.5 + 0.5 * Math.sin(th * 3 - t * 2.3) * Math.sin(th * 5 + t * 1.4 + 1.2);
    const target = clamp((0.18 + 0.55 * flow + 0.22 * Math.sin(t * 6.1 + sc.phase[i])) * lift);
    const v = sc.vals[i];
    sc.vals[i] = v + (target - v) * clamp(dt * (target > v ? 22 : 5));
    const ear = Math.max(0, 1 - Math.min(angDist(th, EAR_A[0]), angDist(th, EAR_A[1])) / 0.34);
    const keep = ear > 0 ? 1 - earRetract : 1 - retract;
    const len = (5 + sc.vals[i] * 46 + ear * ear * 34) * keep * S.form;
    if (len < 0.6) continue;
    const r0 = R + 14;
    proj(th, r0, p); const x0 = p[0], y0 = p[1], s0 = p[2];
    proj(th, r0 + len, p);
    const a = (0.32 + 0.4 * sc.vals[i] + 0.35 * ear * (1 + earRetract)) * vis * (0.5 + 0.5 * s0);
    ctx.lineWidth = 3.2 * s0;
    ctx.strokeStyle = `rgba(103,227,244,${a * 0.75})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(p[0], p[1]); ctx.stroke();
    ctx.lineWidth = 1.4 * s0;
    ctx.strokeStyle = `rgba(236,252,255,${a})`;
    ctx.beginPath(); ctx.moveTo(lerp(x0, p[0], 0.55), lerp(y0, p[1], 0.55)); ctx.lineTo(p[0], p[1]); ctx.stroke();
  }

  // The faint full ring, and comets of light orbiting it.
  const close = easeInOut(clamp((b - 0.05) / 0.4));
  const cometFade = 1 - clamp((b - 0.42) / 0.3);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = `rgba(140,230,250,${(0.14 + 0.08 * S.beat) * vis * S.form * cometFade})`;
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    proj((i / 96) * TAU, R, p);
    if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
  }
  ctx.stroke();
  const SEG = 36;
  for (const c of sc.comets) {
    c.a += dt * c.w * (1 + 1.5 * close);
    const len = lerp(c.len, TAU, close);
    const dir = Math.sign(c.w);
    for (let j = 0; j < SEG; j++) {
      const u0 = j / SEG, u1 = (j + 1) / SEG;
      const fall = lerp(Math.pow(1 - u0, 1.6), 1, close);
      proj(c.a - dir * len * u0, R, p); const x0 = p[0], y0 = p[1], s = p[2];
      proj(c.a - dir * len * u1, R, p);
      const a = fall * c.al * vis * S.form * cometFade * (0.6 + 0.4 * S.beat) * (0.55 + 0.45 * s);
      if (a < 0.01) continue;
      ctx.lineWidth = (j === 0 ? 4.2 : 2.6) * s;
      ctx.strokeStyle = `rgba(210,248,255,${a})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
  }

  // The waveform from the avatar, crossing the ring like it crosses her eyes.
  const fold = easeInOut(clamp((b - 0.28) / 0.45));
  const half = WAVE_HALF * lerp(1, 0.07, fold);
  const amp = (26 + 30 * S.beat) * lerp(1, 0.35, fold) * S.form;
  const waveA = vis * (1 - clamp((b - 0.62) / 0.2));
  const strands = [[0, 1, 2.2, "236,252,255"], [0.9, 0.55, 1.6, "150,236,250"], [-1.3, 0.45, 1.4, "120,226,246"], [2.1, 0.3, 1.2, "103,227,244"], [-2.6, 0.22, 1, "103,227,244"]];
  if (waveA > 0.01) {
    for (const [k, al, lw, col] of strands) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = `rgba(${col},${al * waveA})`;
      ctx.beginPath();
      for (let i = 0; i <= 140; i++) {
        const u = i / 70 - 1;
        const g = Math.exp(-u * u * 2.4) * (1 - u * u);
        const y = Math.sin(u * 13 + t * 3.2 + k) * 0.55 + Math.sin(u * 29 - t * 4.6 + k * 2) * 0.22 + Math.sin(u * 5.5 - t * 1.4 + k * 0.5) * 0.35;
        const x = P.cx + u * half, yy = P.cy + y * amp * g * (1 + 0.15 * k);
        if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
  }

  // The mark assembles out of all of it.
  drawMark(ctx, {
    ring: clamp((b - 0.3) / 0.3),
    ears: easeOut(clamp((b - 0.22) / 0.36)),
    band: easeInOut(clamp((b - 0.36) / 0.34)),
    cups: clamp((b - 0.56) / 0.22),
    wave: easeOut(clamp((b - 0.6) / 0.26)),
  }, S.vanish * S.glow * 0.92, P.cx, P.cy, P.k);
}

// The stage scale for a viewport: fits 1280x720, never tiny, never huge.
export function stageScale(width, height) {
  return Math.min(1.25, Math.max(0.42, Math.min(width / STAGE_W, height / STAGE_H)));
}

/**
 * Runs the loader on a canvas. `onPhase` receives "reveal", "done" and
 * finally "stopped". Call `setReady()` once the app has what it needs.
 */
export function createSignalEngine(canvas, { onPhase, reduce = false } = {}) {
  const ctx = canvas.getContext("2d");
  const buffer = () => {
    const c = document.createElement("canvas");
    return { c, x: c.getContext("2d") };
  };
  // Offscreen buffers for a cheap bloom: downsample, add back.
  const blooms = [buffer(), buffer(), buffer()];
  const rand = rng(7);
  const scene = sceneInit(rand);
  const dust = Array.from({ length: 120 }, () => ({
    r: 140 + rand() * 700,
    a: rand() * TAU,
    y: (rand() - 0.5) * 520,
    w: (0.08 + rand() * 0.2) * (rand() < 0.5 ? -1 : 1),
    s: 0.6 + rand() * 1.1,
  }));
  let width = 0, height = 0, dpr = 1, scale = 1;
  let t0 = performance.now(), last = t0, raf = 0;
  let wantReady = false, readyAt = null, phase = "loading", staticDrawn = false;

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (width * height)));
    scale = stageScale(width, height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const aspect = canvas.height / canvas.width;
    [320, 160, 80].forEach((w, i) => {
      blooms[i].c.width = w;
      blooms[i].c.height = Math.max(1, Math.round(w * aspect));
    });
    staticDrawn = false;
  }

  function setPhase(next) {
    phase = next;
    onPhase?.(next);
  }

  function draw(t, dt, f) {
    const d = dpr * scale;
    // Stage space: 1280x720 centred in the viewport.
    ctx.setTransform(d, 0, 0, d, (width * dpr - STAGE_W * d) / 2, (height * dpr - STAGE_H * d) / 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // A kick and a softer off-beat every 1.6 s: the light breathes like a speaker.
    const ph = (t % 1.6) / 1.6;
    const form = easeOut(clamp((t - 0.15) / 2.2));
    const S = {
      t, dt, f, form,
      appear: clamp((t - 0.05) / 0.8),
      beat: (Math.exp(-ph * 9) + (ph > 0.2 ? 0.4 * Math.exp(-(ph - 0.2) * 12) : 0)) * form,
      b: f < 0 ? 0 : clamp(f / BUILD),
      swell: f < 0 ? 0 : clamp((f - BUILD + 0.2) / (FLASH_AT - BUILD + 0.2)),
      flash: f < FLASH_AT - 0.06 ? 0 : f < FLASH_AT ? (f - FLASH_AT + 0.06) / 0.06 : Math.exp(-(f - FLASH_AT) / 0.34),
      vanish: 1 - clamp((f - FLASH_AT + 0.02) / 0.16),
    };
    S.vis = S.appear * S.vanish;
    S.glow = 1 + 0.9 * S.swell;

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Ambient light behind everything.
    const amb = ctx.createRadialGradient(CX, CY, 0, CX, CY, 560);
    const ambA = (0.06 + 0.04 * S.beat + 0.06 * S.swell) * S.vis + 0.25 * S.flash;
    amb.addColorStop(0, `rgba(120,232,248,${ambA})`);
    amb.addColorStop(0.45, `rgba(60,170,200,${ambA * 0.35})`);
    amb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = amb;
    ctx.fillRect(CX - 560, CY - 560, 1120, 1120);

    sceneDraw(ctx, S, scene);

    // Dust drifting into the mark; pulled in hard on the finale.
    const yaw = t * 0.09, pitch = 0.3;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cpi = Math.cos(pitch), spi = Math.sin(pitch);
    const pull = easeIn(S.b);
    for (const m of dust) {
      m.a += dt * m.w * (1 + 4 * pull);
      m.r -= dt * (12 + 700 * pull);
      m.y -= m.y * dt * (0.12 + 3 * pull);
      if (m.r < 60) { m.r = 520 + Math.random() * 380; m.y = (Math.random() - 0.5) * 520; }
      let x = Math.cos(m.a) * m.r, y = m.y, z = Math.sin(m.a) * m.r;
      let x2 = x * cy + z * sy, z2 = -x * sy + z * cy; x = x2; z = z2;
      const y2 = y * cpi - z * spi; z2 = y * spi + z * cpi; y = y2; z = z2;
      const zc = z + CAM;
      if (zc < 80) continue;
      const s = CAM / zc;
      const a = 0.42 * S.vis * clamp((m.r - 60) / 90) / (1 + 2 * clamp(Math.abs(zc - CAM) / 600));
      if (a < 0.01) continue;
      const size = m.s * s * 1.5;
      ctx.fillStyle = `rgba(206,246,255,${a})`;
      ctx.fillRect(CX + x * s - size / 2, CY + y * s - size / 2, size, size);
    }

    // Shockwave: the ring itself is thrown outward by the flash.
    if (f > FLASH_AT) {
      const k = clamp((f - FLASH_AT) / 1.1);
      const P = markPose(S);
      const r = 13.2 * P.k + 1300 * (1 - Math.exp(-k * 3.2));
      const a = Math.pow(1 - k, 2) * 0.6;
      ctx.lineWidth = 2 + 30 * (1 - k);
      ctx.strokeStyle = `rgba(170,240,255,${a * 0.3})`;
      ctx.beginPath();
      ctx.arc(P.cx, P.cy, r, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(235,252,255,${a})`;
      ctx.stroke();
    }

    // Bloom: blur by downsampling the frame and adding it back.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let src = canvas;
    for (const p of blooms) {
      p.x.globalCompositeOperation = "copy";
      p.x.imageSmoothingQuality = "high";
      p.x.drawImage(src, 0, 0, p.c.width, p.c.height);
      src = p.c;
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 0.5; ctx.drawImage(blooms[0].c, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.65; ctx.drawImage(blooms[1].c, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.6; ctx.drawImage(blooms[2].c, 0, 0, canvas.width, canvas.height);

    // The white-out the lockup is born from.
    if (S.flash > 0.001) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, S.flash) * 0.82;
      ctx.fillStyle = "#eafcff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Reduced motion skips the build-up: the lockup fades in as soon as the app is ready.
    if (wantReady && readyAt === null && (reduce || t >= MIN_FORM)) readyAt = reduce ? t - FLASH_AT : t;
    const f = readyAt === null ? -1 : t - readyAt;
    if (f >= FLASH_AT && phase === "loading") setPhase("reveal");
    if (f >= DONE_AT && phase === "reveal") setPhase("done");
    if (f >= STOP_AT) { stop(); setPhase("stopped"); return; }
    if (reduce) {
      if (!staticDrawn) { draw(4, 0, -1); staticDrawn = true; }
      return;
    }
    draw(t, dt, f);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    frame(now);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(loop);

  return {
    setReady() { wantReady = true; },
    destroy() {
      stop();
      window.removeEventListener("resize", resize);
    },
  };
}
