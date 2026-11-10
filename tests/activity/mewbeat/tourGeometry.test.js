const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let geometry;

test.before(async () => {
  geometry = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/tour/geometry.js")).href);
});

const viewport = { w: 1000, h: 700 };
const popup = { w: 340, h: 140 };

function inside(p, vp) {
  return p.x >= 0 && p.y >= 0 && p.x + popup.w <= vp.w && p.y + popup.h <= vp.h;
}

function numbers(d) {
  return d.match(/-?\d+(?:\.\d+)?/g).map(Number);
}

test("placePopup puts the popup on the asked side of a target in the middle", () => {
  const { placePopup } = geometry;
  const target = { x: 450, y: 300, w: 100, h: 60 };
  const below = placePopup(target, popup, "below", viewport);
  assert.ok(below.y > target.y + target.h);
  assert.equal(below.x + popup.w / 2, target.x + target.w / 2);
  const above = placePopup(target, popup, "above", viewport);
  assert.ok(above.y + popup.h < target.y);
  const left = placePopup(target, popup, "left", viewport);
  assert.ok(left.x + popup.w < target.x);
  assert.equal(left.y + popup.h / 2, target.y + target.h / 2);
  const right = placePopup(target, popup, "right", viewport);
  assert.ok(right.x > target.x + target.w);
});

test("placePopup clamps at all four edges", () => {
  const { placePopup, MARGIN } = geometry;
  const atLeft = placePopup({ x: 0, y: 300, w: 40, h: 40 }, popup, "below", viewport);
  assert.equal(atLeft.x, MARGIN);
  const atRight = placePopup({ x: 960, y: 300, w: 40, h: 40 }, popup, "below", viewport);
  assert.equal(atRight.x, viewport.w - popup.w - MARGIN);
  const atTop = placePopup({ x: 450, y: 0, w: 100, h: 20 }, popup, "above", viewport);
  assert.equal(atTop.y, MARGIN);
  const atBottom = placePopup({ x: 450, y: 680, w: 100, h: 20 }, popup, "below", viewport);
  assert.equal(atBottom.y, viewport.h - popup.h - MARGIN);
  for (const p of [atLeft, atRight, atTop, atBottom]) assert.ok(inside(p, viewport));
});

test("placePopup stays inside whatever the side", () => {
  const { placePopup } = geometry;
  for (const side of ["below", "above", "left", "right"]) {
    for (const target of [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 950, y: 0, w: 50, h: 50 },
      { x: 0, y: 650, w: 50, h: 50 },
      { x: 950, y: 650, w: 50, h: 50 },
    ]) {
      assert.ok(inside(placePopup(target, popup, side, viewport), viewport), `${side} at ${target.x},${target.y}`);
    }
  }
});

test("placePopup pins to the margin when the popup is larger than the window", () => {
  const { placePopup, MARGIN } = geometry;
  const p = placePopup({ x: 10, y: 10, w: 20, h: 20 }, { w: 500, h: 400 }, "below", { w: 300, h: 300 });
  assert.deepEqual(p, { x: MARGIN, y: MARGIN });
});

test("placePopup centres a popup with no target", () => {
  const { placePopup } = geometry;
  assert.deepEqual(placePopup(null, popup, null, viewport), { x: 330, y: 280 });
});

test("curvedArrow starts outside the popup and ends outside the target", () => {
  const { curvedArrow } = geometry;
  const popupRect = { x: 330, y: 400, w: 340, h: 140 };
  const targetRect = { x: 120, y: 100, w: 90, h: 40 };
  const { path, head, from, to } = curvedArrow(popupRect, targetRect);
  const [mx, my, qcx, qcy, ex, ey] = numbers(path);
  assert.match(path, /^M[-\d. ]+Q[-\d. ]+$/);
  assert.deepEqual([mx, my], [from.x, from.y]);
  assert.deepEqual([ex, ey], [to.x, to.y]);
  const outside = (r, p) => p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h;
  assert.ok(outside(popupRect, from), "starts off the popup");
  assert.ok(outside(targetRect, to), "ends off the target");
  assert.ok(Number.isFinite(qcx) && Number.isFinite(qcy));
  assert.match(head, /^M[-\d. ]+L[-\d. ]+L[-\d. ]+$/);
  const [, , tipX, tipY] = numbers(head);
  assert.deepEqual([tipX, tipY], [ex, ey], "the head's tip is the end of the line");
});

test("curvedArrow bends off the straight line, to opposite sides for mirrored targets", () => {
  const { curvedArrow } = geometry;
  const popupRect = { x: 400, y: 400, w: 200, h: 100 };
  const toLeft = curvedArrow(popupRect, { x: 50, y: 100, w: 60, h: 40 });
  const toRight = curvedArrow(popupRect, { x: 890, y: 100, w: 60, h: 40 });
  // Signed distance of the control point from the chord.
  const bend = (a, d) => {
    const [, , cx, cy] = numbers(d);
    const dx = a.to.x - a.from.x;
    const dy = a.to.y - a.from.y;
    return (dx * (cy - a.from.y) - dy * (cx - a.from.x)) / Math.hypot(dx, dy);
  };
  const l = bend(toLeft, toLeft.path);
  const r = bend(toRight, toRight.path);
  assert.ok(Math.abs(l) > 5 && Math.abs(r) > 5);
  assert.notEqual(Math.sign(l), Math.sign(r));
});

test("curvedArrow stays finite when popup and target coincide", () => {
  const { curvedArrow } = geometry;
  const r = { x: 100, y: 100, w: 50, h: 50 };
  const { path, head } = curvedArrow(r, r);
  for (const n of [...numbers(path), ...numbers(head)]) assert.ok(Number.isFinite(n));
});
