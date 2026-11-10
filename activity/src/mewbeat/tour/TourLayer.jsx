import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Mewbit, { preloadMewbitGroup, usePrefersReducedMotion } from "../mewbit/Mewbit.jsx";
import { lineParts } from "../mewbit/lines.js";
import { MARGIN, SPOT_PAD, curvedArrow, placePopup } from "./geometry.js";
import { tourText } from "./steps.js";
import { BLIP, splitTyped } from "./typewriter.js";
import { useTypewriter } from "./useTypewriter.js";
import "./tour.css";

// The first-run tour's screen layer: dims the game, spotlights the step's target, and shows Mewbit's popup
// (a glitch tag) with a curved arrow to it. It only reports Next and Skip; the caller owns the steps.
// A step with no target, or whose target is not on screen, shows a full-size Mewbit and the popup centred.
// Her line types in letter by letter with a blip on some letters (useTypewriter.js); Next and Skip work at any moment.
// It types at every effects level but "off" (the player's choice) and under prefers-reduced-motion; those show the line at once.
// The first line waits (empty) until the blip sample has loaded, at most SOUND_WAIT_MS, so it never types in silence.
//
// `trap` ({ screen, line, onRude }) is the trap's two screens (tour/trap.js): "heavy" shows nothing but a small Skip
// while the chart plays, "joke" a centred Mewbit with her line and one button. With no trap, or screen null, the layer
// is the normal tour.

const OPPOSITE = { above: "below", below: "above", left: "right", right: "left" };
const MEWBIT_GAP = 8; // between the centred Mewbit and the popup under her
const MEWBIT_MAX = 340;
const SOUND_WAIT_MS = 600; // the longest the first line waits for its sound

const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// An element of the real screen, or null when it is missing or has no size (hidden).
function findTour(id) {
  if (!id) return null;
  const el = document.querySelector(`[data-tour="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const onScreen = r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  return r.width > 0 && r.height > 0 && onScreen ? el : null;
}

// Everything the layer draws, in the layer's own coordinates: the spotlight, the popup, the arrow, or
// the centred Mewbit when there is nothing to point at.
function computeLayout(root, popup, step) {
  const o = root.getBoundingClientRect();
  const viewport = { w: o.width, h: o.height };
  const size = { w: popup.offsetWidth, h: popup.offsetHeight };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  };
  const targetEl = findTour(step.target);
  if (!targetEl) {
    const mew = Math.max(0, Math.min(MEWBIT_MAX, viewport.h * 0.42, viewport.w - 2 * MARGIN));
    const top = Math.max(MARGIN, (viewport.h - (mew + MEWBIT_GAP + size.h)) / 2);
    return {
      found: false,
      spot: null,
      arrow: null,
      mew: { x: (viewport.w - mew) / 2, y: top, size: mew },
      pop: { x: (viewport.w - size.w) / 2, y: top + mew + MEWBIT_GAP },
    };
  }
  const alsoEl = findTour(step.also);
  const target = alsoEl ? union(rectOf(targetEl), rectOf(alsoEl)) : rectOf(targetEl);
  const spot = grow(target, SPOT_PAD);
  // placePopup only clamps to the window, so on a small one the popup can land on its target: try the other side.
  let pop = placePopup(target, size, step.side, viewport);
  let arrow = true;
  if (hits({ ...pop, ...size }, spot)) {
    const other = step.side ? placePopup(target, size, OPPOSITE[step.side], viewport) : pop;
    if (!hits({ ...other, ...size }, spot)) pop = other;
    else arrow = false;
  }
  return {
    found: true,
    spot,
    arrow: arrow ? curvedArrow({ ...pop, ...size }, target) : null,
    mew: null,
    pop,
  };
}

const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Mewbit's line: the typed part, then the rest hidden but laid out, so the popup has its full size from the first frame
// (the layer measures it to place it). The pieces carry the glitch tag's tones, as in LineText.
function Typed({ parts, count }) {
  return splitTyped(parts, count).map((piece, index) => {
    const body = (
      <>
        {piece.text}
        {piece.rest ? <span className="mb-tour-rest">{piece.rest}</span> : null}
      </>
    );
    if (piece.tone === "cyan") return <b key={index}>{body}</b>;
    if (piece.tone === "pink") return <em key={index}>{body}</em>;
    return <span key={index}>{body}</span>;
  });
}

// The paragraph: a screen reader gets the whole line once (the visually hidden copy), never the letters coming in.
function Say({ parts, count }) {
  return (
    <p className="mb-tour-say" aria-live="polite">
      <span className="mb-tour-sr">{parts.map((part) => part.text).join("")}</span>
      <span aria-hidden="true"><Typed parts={parts} count={count} /></span>
    </p>
  );
}

export default function TourLayer({ step, keys, effects, onNext, onSkip, playSfx, unlockAudio, soundReady, trap = null }) {
  const rootRef = useRef(null);
  const popRef = useRef(null);
  const bodyRef = useRef(null);
  const primaryRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const animated = effects === "full";
  const prefersReduced = usePrefersReducedMotion();
  const typing = effects !== "off" && !prefersReduced;
  const [soundHeld, setSoundHeld] = useState(Boolean(soundReady) && typing);
  useEffect(() => preloadMewbitGroup("tour", "happy"), []); // every step's portrait is new: its frames are there before it shows
  useEffect(() => {
    if (!soundHeld) return undefined;
    let alive = true;
    const release = () => { if (alive) setSoundHeld(false); };
    const timer = setTimeout(release, SOUND_WAIT_MS);
    Promise.resolve(soundReady?.(BLIP.sound)).then(release, release);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // Only once, for the first line: after it the sample is there (or never will be).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const screen = trap?.screen ?? null;
  const joke = screen === "joke";
  const text = tourText(step, keys);
  const line = trap?.line ?? "";
  const parts = useMemo(() => (joke ? lineParts(line) : [{ text, tone: null }]), [joke, line, text]);
  const typed = useTypewriter(parts.map((part) => part.text).join(""), {
    id: joke ? `trap:${line}` : step.id,
    enabled: typing && screen !== "heavy",
    hold: soundHeld,
    onBlip: (options) => playSfx?.("dink", options), // the sample and its pitch: BLIP in typewriter.js
  });

  const measure = useCallback(() => {
    if (screen || !rootRef.current || !popRef.current) return;
    const next = computeLayout(rootRef.current, popRef.current, step);
    setLayout((prev) => (prev && sameLayout(prev, next) ? prev : next));
  }, [step, screen]);

  // Before paint, so a new step never shows once at its old place.
  useLayoutEffect(() => {
    measure();
  }, [measure, text]);

  // Follow the target. It can change size (ResizeObserver), appear, go or be replaced and move without resizing
  // (a MutationObserver on the page's structure and its style, class and hidden attributes), slide into place
  // when a transition or animation ends, and the window can resize or scroll. Everything is coalesced into one
  // animation frame; there is no running loop.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let frame = 0;
    const watched = new Set();
    const resize = new ResizeObserver(() => schedule());
    // The elements of the real screen the ResizeObserver watches, kept in step with the page: a replaced node is swapped.
    const sync = () => {
      const now = new Set();
      for (const id of [step.target, step.also]) {
        const el = id ? document.querySelector(`[data-tour="${id}"]`) : null;
        if (el) now.add(el);
      }
      for (const el of watched) {
        if (!now.has(el)) {
          resize.unobserve(el);
          watched.delete(el);
        }
      }
      for (const el of now) {
        if (!watched.has(el)) {
          resize.observe(el);
          watched.add(el);
        }
      }
    };
    function schedule() {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
          sync();
        });
      }
    }
    const onSettled = (e) => {
      if (!root.contains(e.target)) schedule();
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("transitionend", onSettled, true);
    document.addEventListener("animationend", onSettled, true);
    resize.observe(root);
    if (popRef.current) resize.observe(popRef.current);
    sync();
    const mutations = new MutationObserver((records) => {
      if (records.some((r) => !root.contains(r.target))) schedule(); // the layer's own redraws are not the page moving
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("transitionend", onSettled, true);
      document.removeEventListener("animationend", onSettled, true);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [measure, step.target, step.also, screen]);

  // Escape skips, and is taken before the game's own Escape (its menu, Settings) sees it. Other keys do not
  // reach the game either; Enter and Space still press the focused button, since that is their default action.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === "keydown") onSkip();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts stay
      e.stopImmediatePropagation();
      if (e.key === "Tab" && e.type === "keydown") {
        // Keep focus on the popup's own buttons.
        const buttons = [...rootRef.current.querySelectorAll("button")];
        if (!buttons.length) return;
        e.preventDefault();
        const at = buttons.indexOf(document.activeElement);
        const to = (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[to].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [onSkip]);

  // Pointer input outside the popup's buttons stops at the layer, so native listeners on the document (the
  // app's close-on-outside-click ones) never see it. A button's events keep going to React, which stops them
  // in the handlers below.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const types = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "wheel"];
    const swallow = (e) => {
      if (!(e.target instanceof Element && e.target.closest("button"))) e.stopPropagation();
    };
    for (const type of types) root.addEventListener(type, swallow, { passive: true });
    return () => {
      for (const type of types) root.removeEventListener(type, swallow);
    };
  }, []);

  // Each step: focus Next (so Enter works) and pop the popup in.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
    if (animated) {
      bodyRef.current?.animate?.(
        [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "none" }],
        { duration: 220, easing: "cubic-bezier(0.2, 1.3, 0.4, 1)" }
      );
    }
  }, [step.id, animated, screen]);

  // A click on a primary button is a gesture: it unlocks the sounds, so the blips and the trap can play.
  const press = (action) => () => {
    try { unlockAudio?.(); } catch { /* sound is never needed to go on */ }
    action();
  };

  // The popup's buttons keep their events inside the React tree: stopped here so the game under the layer does not see them.
  const stop = (e) => e.stopPropagation();

  return (
    <div
      ref={rootRef}
      className={`mb-tour${animated ? " mb-tour-animated" : ""}`}
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onClick={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {screen === "heavy" ? (
        <button type="button" className="mb-tour-corner" onClick={onSkip}>{step.secondary ?? "Skip"}</button>
      ) : null}
      {joke ? (
        <>
          <div key="dim" className="mb-tour-dim" />
          <div className="mb-tour-joke" role="dialog" aria-label="Mewbit's tour">
            <div ref={bodyRef} className="mb-tour-joke-body">
              <div className="mb-tour-joke-mew">
                <Mewbit pose="reveal" effects={effects} silent />
              </div>
              <div className="mb-tag mb-tag-plain">
                <div className="mb-tag-body">
                  <Say parts={parts} count={typed} />
                  <div className="mb-tour-foot">
                    <span className="mb-tour-count" />
                    <button type="button" className="mb-tour-skip" onClick={onSkip}>{step.secondary ?? "Skip"}</button>
                    <button type="button" className="mb-tour-next" ref={primaryRef} onClick={press(trap.onRude)}>rude</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
      {screen ? null : layout?.spot ? (
        <div key="spot" className="mb-tour-spot" style={{ left: layout.spot.x, top: layout.spot.y, width: layout.spot.w, height: layout.spot.h }} />
      ) : (
        <div key="dim" className="mb-tour-dim" />
      )}
      {!screen && layout?.mew ? (
        <div className="mb-tour-mew" style={{ left: layout.mew.x, top: layout.mew.y, width: layout.mew.size, height: layout.mew.size }}>
          <Mewbit pose={step.pose ?? "neutral"} effects={effects} silent />
        </div>
      ) : null}
      {!screen && layout?.arrow ? (
        <svg key={step.id} className="mb-tour-arrow" aria-hidden="true">
          {animated ? (
            <mask id="mb-tour-arrow-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <path className="mb-tour-arrow-reveal" d={layout.arrow.path} pathLength="1" />
            </mask>
          ) : null}
          <path className="mb-tour-arrow-line" d={layout.arrow.path} mask={animated ? "url(#mb-tour-arrow-mask)" : undefined} />
          <path className="mb-tour-arrow-head" d={layout.arrow.head} />
        </svg>
      ) : null}
      {screen ? null : (
      <div
        ref={popRef}
        className="mb-tour-pop"
        role="dialog"
        aria-label="Mewbit's tour"
        style={{ left: layout?.pop.x ?? 0, top: layout?.pop.y ?? 0 }}
      >
        <div ref={bodyRef}>
          <div className="mb-tag mb-tag-plain">
            <div className="mb-tag-body">
              <div className="mb-tour-head">
                {step.portrait ? (
                  <div className="mb-tour-face" aria-hidden="true">
                    <div className="mb-tour-face-img">
                      <Mewbit pose={step.portrait} effects={effects} />
                    </div>
                  </div>
                ) : null}
                <Say parts={parts} count={typed} />
              </div>
              <div className="mb-tour-foot">
                <span className="mb-tour-count">{step.count}</span>
                {step.secondary ? (
                  <button type="button" className="mb-tour-skip" onClick={onSkip}>{step.secondary}</button>
                ) : null}
                <button type="button" className="mb-tour-next" ref={primaryRef} onClick={press(onNext)}>{step.primary}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
