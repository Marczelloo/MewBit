// Layout maths for the first-run tour: where the popup sits next to its target and the curved arrow
// between them. Pure and in one coordinate space; rects are { x, y, w, h }, sizes { w, h }.

export const MARGIN = 14; // the popup never comes closer than this to the window edge
const GAP = 72; // room between popup and target, where the arrow runs
export const SPOT_PAD = 6; // the spotlight is this much bigger than the target
const START_GAP = 5; // arrow tail, off the popup
const END_GAP = 7; // arrow tip, off the spotlight
const HEAD_LEN = 15;
const HEAD_HALF_ANGLE = 0.5;
const MAX_BEND = 90;

const round = (n) => Math.round(n * 10) / 10;
const clamp = (v, size, limit) => Math.max(MARGIN, Math.min(limit - size - MARGIN, v));

// Top-left of the popup: on `side` of the target, centred on it, kept inside the viewport.
// No target (or no side) centres it.
export function placePopup(targetRect, popupSize, side, viewport) {
  let x = (viewport.w - popupSize.w) / 2;
  let y = (viewport.h - popupSize.h) / 2;
  if (targetRect && side) {
    const cx = targetRect.x + targetRect.w / 2;
    const cy = targetRect.y + targetRect.h / 2;
    if (side === "below") {
      x = cx - popupSize.w / 2;
      y = targetRect.y + targetRect.h + GAP;
    } else if (side === "above") {
      x = cx - popupSize.w / 2;
      y = targetRect.y - popupSize.h - GAP;
    } else if (side === "left") {
      x = targetRect.x - popupSize.w - GAP;
      y = cy - popupSize.h / 2;
    } else {
      x = targetRect.x + targetRect.w + GAP;
      y = cy - popupSize.h / 2;
    }
  }
  return { x: clamp(x, popupSize.w, viewport.w), y: clamp(y, popupSize.h, viewport.h) };
}

// The point just off rectangle r, on the side facing `from`.
function edgePoint(r, from, gap) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = from.x - cx;
  const dy = from.y - cy;
  const sx = dx === 0 ? 1e9 : (r.w / 2 + gap) / Math.abs(dx);
  const sy = dy === 0 ? 1e9 : (r.h / 2 + gap) / Math.abs(dy);
  const k = Math.min(sx, sy);
  return { x: cx + dx * k, y: cy + dy * k };
}

const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// A quadratic curve from the popup to the target, with an arrowhead at the target's end. `path` and
// `head` are SVG path data; `from` and `to` are the two ends. The curve bends away from the chord, to
// the side that flips when the target is left of the popup, so arrows to either side bow outwards.
export function curvedArrow(fromRect, toRect) {
  const a = edgePoint(fromRect, centre(toRect), START_GAP);
  const b = edgePoint(
    { x: toRect.x - SPOT_PAD, y: toRect.y - SPOT_PAD, w: toRect.w + 2 * SPOT_PAD, h: toRect.h + 2 * SPOT_PAD },
    centre(fromRect),
    END_GAP,
  );
  const flip = centre(toRect).x < centre(fromRect).x ? -1 : 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(MAX_BEND, len * 0.32) * flip;
  const cx = (a.x + b.x) / 2 + (-dy / len) * bend;
  const cy = (a.y + b.y) / 2 + (dx / len) * bend;
  const t = Math.atan2(b.y - cy, b.x - cx);
  const wing = (turn) => `${round(b.x - HEAD_LEN * Math.cos(t + turn))} ${round(b.y - HEAD_LEN * Math.sin(t + turn))}`;
  return {
    path: `M${round(a.x)} ${round(a.y)} Q${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`,
    head: `M${wing(-HEAD_HALF_ANGLE)} L${round(b.x)} ${round(b.y)} L${wing(HEAD_HALF_ANGLE)}`,
    from: { x: round(a.x), y: round(a.y) },
    to: { x: round(b.x), y: round(b.y) },
  };
}
