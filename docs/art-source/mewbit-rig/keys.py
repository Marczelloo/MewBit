"""Key drawings on the rig: only what Klein really changed around the moved arms is cut out of its edit, everything else stays the drawing's own pixels."""
import glob

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from rig import match_colors, premultiply
from segment import BODY, HAIR, HEAD, classes, cut_alpha

SHOULDERS = {"L": (312, 300), "R": (470, 300)}
# Keys whose hand may sit over the head layer; everywhere else the head is never touched.
OVER_HEAD = {"arm_phones", "arm_chin", "arm_brow", "arm_peace", "arm_paw", "arm_one", "arm_two", "arm_three", "arm_shush"}
# Eyes and mouth are always the drawing's, whatever Klein did to them.
FACE = [(360, 180, 30, 24), (420, 170, 34, 24), (398, 216, 26, 15)]
LEFT_OF, RIGHT_OF, JAW = 345, 415, 230
REACH = 85
HAND_RADIUS = 110
HIP = (440, 465, 70, 60)
# A hand further than this from its shoulder is on a straight arm; closer, the elbow sticks out and the whole side above the waist turns with it.
STRAIGHT = 200
ARM_RADIUS, WAIST = 78, 470
MIN_PIECE = 800
FLECK = 200
CENTER = (385, 500)
# Above this an arm's inner side faces the head, with no jacket under it.
LEVEL = 120


def aligned(path, color):
    key = np.asarray(Image.open(path).convert("RGB").resize((color.shape[1], color.shape[0]), Image.LANCZOS)).astype(np.float64) / 255
    legs = (slice(700, 1120, 2), slice(200, 600, 2))
    best, best_error = (0, 0), np.inf
    for dy in range(-5, 6):
        for dx in range(-5, 6):
            error = np.abs(np.roll(key, (dy, dx), (0, 1))[legs] - color[legs]).mean()
            if error < best_error:
                best, best_error = (dy, dx), error
    return np.roll(key, best, (0, 1)), best


def segmap_of(name, shape):
    paths = glob.glob(f"seg-{name}-7/*.png")
    if not paths:
        raise FileNotFoundError(f"no segmentation for {name}")
    return np.asarray(Image.open(paths[0]).convert("RGB").resize((shape[1], shape[0]), Image.LANCZOS)).astype(np.float64)


def yellow_of(seg):
    return (seg[..., 0] > 180) & (seg[..., 1] > 180) & (seg[..., 2] < 110)


def hands_of(name, seg):
    """Where each moved arm ends, from the yellow of the key's segmentation."""
    regions, count = ndi.label(ndi.binary_opening(yellow_of(seg), iterations=2))
    yy, xx = np.mgrid[0 : seg.shape[0], 0 : seg.shape[1]]
    out = {}
    for side, keep in {"L": xx < 400, "R": xx >= 400}.items():
        if name.startswith("arm_") and side == "R":
            continue
        pieces = regions * keep
        ids, areas = np.unique(pieces[pieces > 0], return_counts=True)
        if len(ids):
            piece = pieces == ids[np.argmax(areas)]
            out[side] = (float(xx[piece].mean()), float(yy[piece].mean()))
    return out


def hip_of(name, shape):
    """Where the drawing's hand rests on the hip, in a key that took it away. Always figure there, never background."""
    if name.startswith("arm_"):
        return np.zeros(shape, bool)
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]]
    return ((xx - HIP[0]) / HIP[2]) ** 2 + ((yy - HIP[1]) / HIP[3]) ** 2 < 1


def changed_mask(key, drawing, labels, name, hands):
    diff = ndi.gaussian_filter(np.abs(key - drawing).max(2), 1.5)
    mask = ndi.binary_opening(diff > 0.16, iterations=2)
    yy, xx = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]].astype(np.float64)
    # A pale hand on pale skin barely differs from the bare belly that replaces it, so its fingers would stay behind as a ghost.
    hip = hip_of(name, labels.shape)
    mask |= hip
    mask = ndi.binary_fill_holes(ndi.binary_closing(ndi.binary_dilation(mask, iterations=6), iterations=8))

    # Only around the arms that moved: Klein's noise on the rest of the figure is thrown away.
    sides = xx < LEFT_OF
    if not name.startswith("arm_"):
        sides |= xx >= RIGHT_OF
    region = sides | hip
    seeds = sides & (yy >= JAW)
    head = labels == HEAD
    head_ok = np.zeros(labels.shape, bool)
    for side, (hx, hy) in hands.items():
        px, py = SHOULDERS[side]
        vx, vy = hx - px, hy - py
        u = np.clip(((xx - px) * vx + (yy - py) * vy) / (vx * vx + vy * vy), 0, 1)
        region |= np.hypot(xx - px - u * vx, yy - py - u * vy) < REACH
        near = np.hypot(xx - hx, yy - hy)
        region |= near < REACH + 25
        seeds |= near < 30
        head_ok |= near < REACH
    mask &= region
    mask[yy > 760] = False
    # Klein redraws the thighs for no reason; nothing an arm does changes them unless the hand is there.
    mask[(labels == BODY) & (yy > 560) & (np.min([np.hypot(xx - hx, yy - hy) for hx, hy in hands.values()], axis=0) > REACH)] = False
    mask[head & ~(head_ok if name in OVER_HEAD else np.zeros_like(head_ok))] = False
    for cx, cy, rx, ry in FACE:
        mask[((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1] = False
    regions, count = ndi.label(mask)
    touching = np.unique(regions[seeds & mask])
    return np.isin(regions, touching[touching > 0])


def limbs_of(hands):
    out = {}
    for side, (hx, hy) in hands.items():
        pivot = SHOULDERS[side]
        v = np.array((hx - pivot[0], hy - pivot[1]))
        length = float(np.hypot(*v))
        out[side] = (pivot, tuple(float(c) for c in v / length), length)
    return out


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def under_arm(dx, dy, along, pivot, direction):
    """Inside the sleeve on the body's side: the jacket panel below a lowered arm does not swing with it."""
    normal = np.array((-direction[1], direction[0]))
    if normal @ (np.array(CENTER) - pivot) < 0:
        normal = -normal
    return dx * normal[0] + dy * normal[1] < 45 + 0.25 * np.maximum(along, 0)


def split_limbs(shape, limbs):
    """How much of each side belongs to the arm, 0 to 1."""
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]].astype(np.float64)
    out = {}
    for side, (pivot, direction, length) in limbs.items():
        dx, dy = xx - pivot[0], yy - pivot[1]
        along = dx * direction[0] + dy * direction[1]
        across = np.abs(dx * direction[1] - dy * direction[0])
        tube = np.hypot(np.maximum(along - length, 0), across) < ARM_RADIUS
        if np.degrees(np.arccos(direction[1])) < LEVEL:
            tube &= under_arm(dx, dy, along, pivot, direction)
        weight = ndi.gaussian_filter(tube.astype(np.float32), 3) * smooth(along / 45 + 0.1)
        if length < STRAIGHT:
            column = (xx < LEFT_OF) if side == "L" else (xx >= RIGHT_OF)
            weight = np.maximum(weight, ndi.gaussian_filter(column.astype(np.float32), 3) * (1 - smooth((yy - WAIST + 25) / 50)))
        out[side] = weight
    return out


def whole(strength, pieces):
    """Only the biggest pieces of a cut layer: a stray stroke of Klein's would otherwise fly with the arm."""
    regions, count = ndi.label(strength > 0.15)
    if count <= pieces:
        return strength
    areas = ndi.sum_labels(np.ones_like(strength), regions, np.arange(1, count + 1))
    keep = 1 + np.argsort(areas)[-pieces:]
    return strength * ndi.gaussian_filter(np.isin(regions, keep).astype(np.float32), 0.8).clip(0, 1) ** 0.25


def sort_pieces(strength, alpha, limbs, under=None):
    """Splits a layer that stays: pieces on the drawing are kept, big ones beside it go to the nearest arm, small ones are dropped."""
    regions, count = ndi.label(strength > 0.04)
    kept = np.zeros(strength.shape, bool)
    moved = {side: np.zeros(strength.shape, bool) for side in limbs}
    for i, box in enumerate(ndi.find_objects(regions), 1):
        piece = regions[box] == i
        if (alpha[box][piece] > 0.5).mean() >= 0.5:
            if piece.sum() >= FLECK or under is None or (under[box][piece] > 0.5).mean() >= 0.5:
                kept[box] |= piece
        elif piece.sum() >= MIN_PIECE and limbs:
            ys, xs = np.nonzero(piece)
            x, y = xs.mean() + box[1].start, ys.mean() + box[0].start
            ends = {side: np.hypot(x - p[0] - d[0] * n, y - p[1] - d[1] * n) for side, (p, d, n) in limbs.items()}
            moved[min(ends, key=ends.get)][box] |= piece
    return strength * kept, {side: strength * mask for side, mask in moved.items()}


def build_key(name, color, alpha, labels, layers):
    # Klein's edits sit on white, so that is where the drawing has to be compared.
    drawing = color * alpha[..., None] + 1 - alpha[..., None]
    key, shift = aligned(f"{sorted(glob.glob(f'key-{name}-7/*.png'))[0]}", drawing)
    seg = np.roll(segmap_of(name, color.shape), shift, (0, 1))
    hands = hands_of(name, seg)
    mask = changed_mask(key, drawing, labels, name, hands)
    drawn = key
    key, key_alpha = cut_alpha(drawn * 255)
    # A gap between arm and body is closed off from the border, so it comes back opaque white; the segmentation knows it is empty.
    gap = ndi.binary_opening((seg.min(2) > 225) & (key.min(2) > 0.86), iterations=1)
    key_alpha = key_alpha * (1 - np.clip(ndi.gaussian_filter(ndi.binary_dilation(gap).astype(np.float32), 0.8), 0, 1))
    # The flood from the border also leaks through any break in a finger's outline, and pale skin goes with it; the segmentation knows a hand is solid.
    yy, xx = np.mgrid[0 : gap.shape[0], 0 : gap.shape[1]]
    near = np.min([np.hypot(xx - hx, yy - hy) for hx, hy in hands.values()], axis=0) < HAND_RADIUS
    skin = ndi.binary_fill_holes(ndi.binary_opening(yellow_of(seg) & near, iterations=2)) | hip_of(name, gap.shape)
    solid = np.clip(ndi.gaussian_filter(ndi.binary_dilation(skin, iterations=2).astype(np.float32), 0.8), 0, 1)
    key = key * (1 - solid[..., None]) + drawn * solid[..., None]
    key_alpha = np.maximum(key_alpha, solid)
    far_from = ~mask & (alpha > 0.9) & (np.abs(key - color).max(2) < 0.1)
    key = match_colors(key, color, far_from)
    hair = ndi.binary_opening(classes(seg) == HAIR, iterations=2) & mask
    soft = np.clip(ndi.gaussian_filter(mask.astype(np.float32), 1.2), 0, 1)
    inner = ndi.gaussian_filter(ndi.binary_erosion(mask, iterations=3).astype(np.float32), 1.0)
    bg = ndi.gaussian_filter((ndi.binary_erosion(mask, iterations=3) & ((key_alpha < 0.5) | hair)).astype(np.float32), 1.0)

    out = {}
    for layer, gone in {"jacket": inner, "arm": inner, "hairFront": bg, "hairBack": bg, "body": bg, "head": np.zeros_like(bg)}.items():
        erased = layers[layer].copy()
        erased *= 1 - gone[..., None]
        out[layer] = erased.astype(np.float32)
    patch_alpha = key_alpha * soft
    out["patchHair"] = premultiply(key, sort_pieces(patch_alpha * hair, alpha, {}, None)[0])
    limbs = limbs_of(hands)
    rest = patch_alpha * (1 - hair)
    stays = np.ones_like(rest)
    # The arm and what stays both reach full strength in the middle of the seam, so it never opens.
    arms = {}
    for side, weight in split_limbs(rest.shape, limbs).items():
        arms[side] = whole(rest * smooth(weight / 0.6), 1)
        stays = np.minimum(stays, 1 - smooth((weight - 0.6) / 0.4))
    under = np.max([out[layer][..., 3] for layer in ("hairFront", "hairBack", "body", "jacket", "arm", "head")], axis=0)
    kept, loose = sort_pieces(rest * stays, alpha, limbs, under)
    for side, strength in arms.items():
        out[f"limb{side}"] = premultiply(key, np.maximum(strength, loose[side]))
    out["patch"] = premultiply(key, kept)
    return out, limbs, shift, int(mask.sum()), int(hair.sum())
