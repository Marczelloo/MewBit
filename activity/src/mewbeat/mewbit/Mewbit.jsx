import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { effectiveEffects } from "../effects.js";
import { MEWBIT_POSES } from "./manifest.js";
import placeholderUrl from "./mewbit.png";
import "../mewbeat.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// True while the OS asks for less motion. Falls back to false where matchMedia is missing.
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query) return undefined;
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// ---- Frame store ---------------------------------------------------------------------------------------------
// Frames are 640px WebPs. Swapping an <img> src every frame made the browser decode them on the fly, which
// skipped and hitched under the game's load. Instead each frame is fetched once, decoded off the main thread
// into an ImageBitmap at the size it is drawn, and kept in an LRU within a memory budget. Players ask for the
// frames just ahead of the one they show, so a loop streams in before it is needed.

const MAX_SIZE = 640;
const BUDGET_BYTES = 160 * 1024 * 1024;
const MAX_DECODES = 3;
const LOOKAHEAD = 10; // frames requested ahead of the one on screen
const WARM_FRAMES = 4; // first frames of every pose in the screen's group, kept decoded for instant switches
const WARM_EVERY_MS = 1000;

const blobs = new Map(); // url -> Promise<Blob>
const bitmaps = new Map(); // url -> { image, size, bytes }; insertion order is the LRU order
const queued = new Set();
const urgentQueue = [];
const backgroundQueue = [];
const decoding = new Set();
const players = new Set(); // live players, so eviction skips what one of them has on screen
let usedBytes = 0;
let decodeSize = 384;
let activeDecodes = 0;

function blobOf(url) {
  let promise = blobs.get(url);
  if (!promise) {
    promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`frame ${response.status}`);
      return response.blob();
    });
    promise.catch(() => blobs.delete(url));
    blobs.set(url, promise);
  }
  return promise;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function decode(url, size) {
  if (typeof createImageBitmap !== "function") return loadImage(url);
  const blob = await blobOf(url);
  try {
    return await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: "high" });
  } catch {
    return createImageBitmap(blob);
  }
}

function heldByPlayer(image) {
  for (const player of players) if (player.holding.includes(image)) return true;
  return false;
}

function store(url, image, size) {
  const old = bitmaps.get(url);
  if (old) {
    bitmaps.delete(url);
    usedBytes -= old.bytes;
    if (!heldByPlayer(old.image)) old.image.close?.();
  }
  const bytes = size * size * 4;
  bitmaps.set(url, { image, size, bytes });
  usedBytes += bytes;
  for (const [key, hit] of bitmaps) {
    if (usedBytes <= BUDGET_BYTES) break;
    if (key === url || heldByPlayer(hit.image)) continue;
    bitmaps.delete(key);
    usedBytes -= hit.bytes;
    hit.image.close?.();
  }
}

function pump() {
  while (activeDecodes < MAX_DECODES) {
    const url = urgentQueue.shift() ?? backgroundQueue.shift();
    if (url === undefined) return;
    queued.delete(url);
    if ((bitmaps.get(url)?.size ?? 0) >= decodeSize || decoding.has(url)) continue;
    const size = decodeSize;
    activeDecodes += 1;
    decoding.add(url);
    decode(url, size)
      .then((image) => store(url, image, size))
      .catch(() => {})
      .finally(() => {
        activeDecodes -= 1;
        decoding.delete(url);
        pump();
      });
  }
}

// Asks for a frame to be decoded (urgent ones jump the queue); a frame already there is marked recently used.
function requestFrame(url, urgent) {
  if (!url) return;
  const hit = bitmaps.get(url);
  if (hit && hit.size >= decodeSize) {
    bitmaps.delete(url);
    bitmaps.set(url, hit);
    return;
  }
  if (decoding.has(url)) return;
  if (queued.has(url)) {
    if (!urgent) return;
    const at = backgroundQueue.indexOf(url);
    if (at < 0) return;
    backgroundQueue.splice(at, 1);
  }
  queued.add(url);
  if (urgent) urgentQueue.push(url);
  else backgroundQueue.push(url);
  pump();
}

function readyFrame(url) {
  return bitmaps.get(url)?.image ?? null;
}

function framesOf(entry) {
  return entry?.kind === "frames" && entry.frames?.length ? entry.frames : [placeholderUrl];
}

// Poses a group needs: its own, plus the members of its routines (the lobby idle borrows the game's neutral).
function posesOfGroup(group) {
  const names = new Set();
  for (const [name, entry] of Object.entries(MEWBIT_POSES)) {
    if (entry.group !== group) continue;
    if (entry.kind === "routine") [entry.base, ...entry.fidgets].forEach((member) => names.add(member));
    else names.add(name);
  }
  return [...names].map((name) => MEWBIT_POSES[name]).filter(Boolean);
}

// Fetches every frame of a screen's poses and decodes the first few of each, so a pose never blinks in.
export function preloadMewbitGroup(group) {
  if (!group) return;
  for (const entry of posesOfGroup(group)) {
    const frames = framesOf(entry);
    frames.forEach((url) => blobOf(url).catch(() => {}));
    frames.slice(0, WARM_FRAMES).forEach((url) => requestFrame(url, false));
  }
}

// ---- Player --------------------------------------------------------------------------------------------------
// Frames follow the clock, not a timer: index = elapsed × fps, so a busy frame never slows a loop down or drifts
// it. Switching poses never cuts:
// - two calm loops that both start on the rest frame (`rest` in the manifest) join at the end of the current
//   cycle when that is close, so the loop finishes and the next one starts from the same pose;
// - anything else crossfades over FADE_MS;
// - a loop that was interrupted a moment ago (by a miss, a milestone) picks up where it left off instead of
//   starting over, so it still gets to play the whole way through;
// - a switch waits until the new pose's first frame is decoded, so nothing blinks.
// A "routine" pose (the lobby idle) plays its base loop for a random while, then one cycle of a random fidget,
// then the base again, every change landing on a cycle boundary.

const FADE_MS = 160;
const MAX_JOIN_WAIT_MS = 1500;
const RESUME_MS = 6000;

function cycleMs(entry) {
  return (framesOf(entry).length / entry.fps) * 1000;
}

function between([min, max]) {
  return min + Math.random() * (max - min);
}

// Exported for checks that drive a player on a fake clock.
export function createPlayer(onShown) {
  const player = {
    holding: [],
    animated: true,
    cur: null, // { name, entry, start, last }
    prev: null,
    fadeStart: 0,
    pending: null, // { name, join, cycle? }
    routine: null, // { entry, nextAt, last }
    saved: new Map(), // loop name -> { elapsed, at }
    lastWarm: 0,
    drawn: { a: null, b: null, k: -1 },
  };

  function playing(entry) {
    return player.animated && entry.kind === "frames" && entry.fps > 0 && framesOf(entry).length > 1;
  }

  function indexOf(layer, now) {
    const frames = framesOf(layer.entry);
    if (!playing(layer.entry)) return 0;
    const step = Math.floor(((now - layer.start) * layer.entry.fps) / 1000);
    if (layer.entry.hold) return Math.min(Math.max(step, 0), frames.length - 1);
    return ((step % frames.length) + frames.length) % frames.length;
  }

  function cycleIndex(layer, now) {
    return Math.floor((now - layer.start) / cycleMs(layer.entry));
  }

  function canJoin(from, to) {
    return playing(from) && playing(to) && !from.hold && !to.hold && from.rest && to.rest;
  }

  function startOf(name, entry, now) {
    const saved = player.saved.get(name);
    if (!saved || entry.hold || !playing(entry) || now - saved.at > RESUME_MS) return now;
    return now - (saved.elapsed % cycleMs(entry));
  }

  function show(name, entry, start, now, fade) {
    const cur = player.cur;
    if (cur && playing(cur.entry) && !cur.entry.hold) player.saved.set(cur.name, { elapsed: now - cur.start, at: now });
    if (fade && cur) {
      player.prev = cur;
      player.fadeStart = now;
    } else player.prev = null;
    // Without a fade the old picture stays up until the new pose's frame is decoded.
    player.cur = { name, entry, start, last: fade ? null : cur?.last ?? null };
    player.pending = null;
    const routine = player.routine;
    if (routine && name === routine.entry.base) routine.nextAt = start + between(routine.entry.restMs);
    if (routine && name !== routine.entry.base) routine.last = name;
    onShown(name);
  }

  // Heads for a concrete pose: joins on a cycle boundary when `join` (or when the two loops fit), else fades.
  function goTo(name, now, join = false) {
    const entry = MEWBIT_POSES[name] || MEWBIT_POSES.neutral;
    const cur = player.cur;
    if (!cur || !player.animated) {
      show(name, entry, now, now, false);
      return;
    }
    if (cur.name === name) {
      player.pending = null;
      return;
    }
    const toBoundary = cycleMs(cur.entry) - ((now - cur.start) % cycleMs(cur.entry));
    const fits = join || (canJoin(cur.entry, entry) && toBoundary <= MAX_JOIN_WAIT_MS);
    player.pending = { name, join: fits };
  }

  function want(name, now) {
    const entry = MEWBIT_POSES[name] || MEWBIT_POSES.neutral;
    if (entry.kind === "routine") {
      if (player.routine?.entry === entry) return;
      player.routine = { entry, nextAt: now + between(entry.restMs), last: null };
      goTo(entry.base, now);
      return;
    }
    player.routine = null;
    goTo(name, now);
  }

  function advance(now) {
    const routine = player.routine;
    const cur = player.cur;
    if (routine && cur && !player.pending && player.animated) {
      const { base, fidgets } = routine.entry;
      if (cur.name === base && now >= routine.nextAt) {
        const choices = fidgets.filter((name) => name !== routine.last);
        goTo(choices[Math.floor(Math.random() * choices.length)] ?? fidgets[0], now, true);
      } else if (cur.name !== base && fidgets.includes(cur.name)) {
        goTo(base, now, true);
      }
    }

    const pending = player.pending;
    if (!pending) return;
    const entry = MEWBIT_POSES[pending.name] || MEWBIT_POSES.neutral;
    const frames = framesOf(entry);
    if (pending.join) {
      const cycle = cycleIndex(cur, now);
      if (pending.cycle === undefined) pending.cycle = cycle;
      requestFrame(frames[0], true);
      if (cycle <= pending.cycle) return;
      if (readyFrame(frames[0])) {
        show(pending.name, entry, cur.start + (pending.cycle + 1) * cycleMs(cur.entry), now, false);
        return;
      }
      pending.join = false;
    }
    const start = startOf(pending.name, entry, now);
    const first = frames[indexOf({ entry, start }, now)];
    requestFrame(first, true);
    if (readyFrame(first)) show(pending.name, entry, start, now, true);
  }

  function frameFor(layer, now) {
    const frames = framesOf(layer.entry);
    const index = indexOf(layer, now);
    for (let ahead = 0; ahead <= LOOKAHEAD && ahead < frames.length; ahead += 1) {
      const next = layer.entry.hold ? Math.min(index + ahead, frames.length - 1) : (index + ahead) % frames.length;
      requestFrame(frames[next], true);
    }
    const image = readyFrame(frames[index]);
    if (image) layer.last = image;
    return layer.last;
  }

  function warm(now) {
    if (now - player.lastWarm < WARM_EVERY_MS) return;
    player.lastWarm = now;
    const group = player.routine?.entry.group ?? player.cur?.entry.group;
    if (!group) return;
    for (const entry of posesOfGroup(group)) framesOf(entry).slice(0, WARM_FRAMES).forEach((url) => requestFrame(url, false));
  }

  function draw(canvas, now) {
    advance(now);
    warm(now);
    const cur = player.cur;
    if (!cur || !canvas) return;
    const a = frameFor(cur, now);
    let b = null;
    let k = 1;
    if (player.prev) {
      k = Math.min(1, (now - player.fadeStart) / FADE_MS);
      if (k >= 1) player.prev = null;
      else b = frameFor(player.prev, now);
    }
    player.holding = [a, b].filter(Boolean);
    const drawn = player.drawn;
    if (drawn.a === a && drawn.b === b && drawn.k === k && drawn.w === canvas.width) return;
    player.drawn = { a, b, k, w: canvas.width };
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (a) {
      ctx.globalAlpha = 1;
      ctx.drawImage(a, 0, 0, canvas.width, canvas.height);
    }
    if (b) {
      // The old pose fades out over the new one, so the figure never goes see-through mid-fade.
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(b, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  return { player, want, draw };
}

function wantedSize() {
  let size = 0;
  for (const player of players) size = Math.max(size, player.size ?? 0);
  return size;
}

export default function Mewbit({ pose = "neutral", effects = "full", className = "", onShow = null }) {
  const prefersReduced = usePrefersReducedMotion();
  const level = effectiveEffects(effects, prefersReduced);
  const animated = level !== "off";
  const canvasRef = useRef(null);
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  const [shown, setShown] = useState(null);
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = createPlayer((name) => {
      setShown(name);
      onShowRef.current?.(name);
    });
  }

  // The canvas draws at its on-screen size (capped at the art's 640px), and the store decodes for the largest
  // player on screen, in 64px steps.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const { player } = engineRef.current;
    players.add(player);
    const fit = () => {
      const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
      const px = Math.min(MAX_SIZE, Math.max(64, Math.ceil((width * (window.devicePixelRatio || 1)) / 64) * 64));
      player.size = px;
      decodeSize = Math.max(64, Math.min(MAX_SIZE, wantedSize()));
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
    };
    fit();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(canvas);
    return () => {
      observer?.disconnect();
      players.delete(player);
    };
  }, []);

  useEffect(() => {
    engineRef.current.player.animated = animated;
  }, [animated]);

  useEffect(() => {
    engineRef.current.want(pose, performance.now());
  }, [pose]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      engineRef.current.draw(canvasRef.current, performance.now());
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const wanted = MEWBIT_POSES[pose] || MEWBIT_POSES.neutral;
  useEffect(() => preloadMewbitGroup(wanted.group), [wanted.group]);

  const entry = MEWBIT_POSES[shown] || null;
  const motion = animated && entry?.motion ? entry.motion : "";

  return (
    <div className={`mb-mewbit mb-mewbit-${level} ${className}`.trim()} data-pose={shown ?? pose}>
      <div className={`mb-mewbit-body ${motion}`.trim()}>
        <canvas className="mb-mewbit-img" ref={canvasRef} role="img" aria-label="Mewbit" />
      </div>
      {entry?.bubble ? <div className="mb-mewbit-bubble" key={shown}>{entry.bubble}</div> : null}
    </div>
  );
}
