"""2D rig of Mewbit's bp-30 drawing: every visible pixel stays the original, Klein's plates only paint what lies hidden.

Hair and head share one bone field, so no seam can open between them. Legs, torso and straps are one body layer, so the
top never separates from the body. Feet stay planted; the soft give lives in the belly, knees and trailing hair.
"""
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.draw import polygon

from segment import BODY, FRONT_LOCKS_MAX_X, HAIR, HEAD, JACKET, JAW_Y, LEFT_ARM_EDGE, SOURCE, cut_drawing, load, plate

OUT_SIZE = 640
GRID = 14
FIGURE_HEIGHT = 530
SOURCE_FIGURE = 1092
FEET_Y = 1126
OUT_FEET_Y = 632
CENTER_X = 383.5
HEAD_CROP = (296, 90, 480, 274)
EYE_ELLIPSES = [(360, 180, 27, 21), (420, 170, 32, 21)]
# The open eyes as drawn, lash and lower lid included, hair excluded. The lid travels down inside these outlines.
EYE_OUTLINES = [
    [(347, 178), (371, 177), (376, 182), (375, 187), (369, 192), (360, 196), (355, 195), (345, 186)],
    [(404, 167), (412, 164), (428, 163), (433, 168), (434, 172), (426, 179), (416, 180), (411, 174), (405, 171)],
]
# The fold above each eye. Klein's shut eye has none, so it fades out once the lid is most of the way down.
EYE_CREASES = [
    [(349, 172), (369, 172), (371, 178), (347, 178)],
    [(404, 158), (420, 158), (420, 163), (404, 166)],
]
EYE_STAGES = {"lid1": 0.62, "lid2": 0.28}
LASH_MAX = 7
TUCK_REACH = 60
# Klein drew the left eye shut a little low, so the lid seemed to drop past the eye instead of meeting it.
CLOSED_EYE_LIFT = (3, 0)
HIP_HAND_BOX = (395, 440, 480, 510)

# Room around the drawing for raised arms and hops: game frames reach this far past the 768x1152 source.
PAD = (284, 184)
FEET = (383.5, 1126)
# The animation being rendered; see anims.py.
M = None

HIP_PIVOT = (365, 490)
CHEST_PIVOT = (370, 440)
HEAD_PIVOT = (398, 240)
SHOULDER_L = (310, 320)
SHOULDER_R = (525, 325)
HAND_ON_HIP = (435, 470)
HAIR_TIPS_Y = 540
ELBOW = (262, 460)
WRIST = (228, 580)
# Sleeve and hanging hand, cut from the jacket along the fold beside the panel and three pixels of the hand's ink.
ARM_OUTLINE = [(276, 464), (270, 493), (253, 540), (244, 582), (244, 600), (246, 612), (248, 616), (246, 624), (247, 632), (247, 640), (241, 648), (190, 648), (190, 440)]
# The panel's hidden left edge under the arm, as (y, x). Beside the hand it is real, so a gap can open there.
PANEL_EDGE = ([464, 493, 540, 566, 582, 648], [262, 256, 239, 236, 243, 243])


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def smoothstep(x, lo, hi):
    return smooth((x - lo) / (hi - lo))


def rotate(p, degrees, pivot):
    a = np.radians(degrees)
    c, s = np.cos(a), np.sin(a)
    dx, dy = p[..., 0] - pivot[0], p[..., 1] - pivot[1]
    return np.stack([pivot[0] + c * dx - s * dy, pivot[1] + s * dx + c * dy], -1)


def offset(p, dx, dy):
    return p + np.stack([dx * np.ones_like(p[..., 0]), dy * np.ones_like(p[..., 0])], -1)


def root(q, t):
    """The whole figure: a lean about the planted feet and a hop."""
    return offset(rotate(q, M.lean(t), FEET), M.root_x(t), -M.lift(t))


def hip(p, t):
    q = rotate(p, M.hip_tilt(t), HIP_PIVOT)
    return root(offset(q, M.hip_x(t), M.hip_drop(t)), t)


def chest(p, t):
    t = t - 0.008 * M.lag
    return hip(offset(rotate(p, M.chest_tilt(t), CHEST_PIVOT), 0 * p[..., 0], M.slump(t)), t)


def head(p, t):
    bob = t - 0.012 * M.lag
    q = rotate(p, M.head_tilt(t - 0.03 * M.lag) + M.head_bob(bob), HEAD_PIVOT)
    q = offset(q, M.head_x(bob), M.nod(bob))
    # Looking down foreshortens the face about the neck.
    q[..., 1] = HEAD_PIVOT[1] + (q[..., 1] - HEAD_PIVOT[1]) * (1 - M.head_squash(bob))
    return chest(q, t)


def lerp(a, b, w):
    return a + (b - a) * w[..., None]


def bone_body(p, t):
    """Chest down to the belly, hips through the shorts, then the legs give way to the planted boots."""
    y = p[..., 1]
    q = lerp(chest(p, t), hip(p, t), smoothstep(y, 420, 485))
    u = np.clip((y - 590) / (1070 - 590), 0, 1)
    q = lerp(q, root(p, t), u)
    q[..., 0] += np.tanh((p[..., 0] - HIP_PIVOT[0]) / 40) * M.knee(t) * np.sin(np.pi * u)
    return q


def bone_jacket(p, t):
    """Shoulders ride the chest, sleeves trail behind them, and the hand on the hip stays on the hip."""
    w = smoothstep(p[..., 1], 340, 560)
    lag = t - 0.035 * M.lag * w
    swing = M.arm_swing(lag - 0.02 * M.lag) * w
    left = rotate(p, swing, SHOULDER_L)
    right = rotate(p, swing, SHOULDER_R)
    swung = chest(lerp(left, right, smoothstep(p[..., 0], 330, 410)), lag)
    q = lerp(chest(p, t), swung, w)
    d2 = (p[..., 0] - HAND_ON_HIP[0]) ** 2 + (p[..., 1] - HAND_ON_HIP[1]) ** 2
    q = lerp(q, hip(p, t), np.exp(-d2 / (2 * 55.0 ** 2)))
    return lerp(q, hip(p, lag), smoothstep(p[..., 1], 560, 650))


def bone_arm(p, t):
    """The jacket's own motion, plus a sleeve that bends from the elbow's crease and a hand loose at the wrist."""
    dx, dy = WRIST[0] - ELBOW[0], WRIST[1] - ELBOW[1]
    length = np.hypot(dx, dy)
    along = ((p[..., 0] - ELBOW[0]) * dx + (p[..., 1] - ELBOW[1]) * dy) / length
    hand = M.hand(t - 0.09 * M.lag) * smoothstep(p[..., 1], 574, 592)
    sleeve = M.sleeve(t - 0.05 * M.lag) * smoothstep(along, 0, 50)
    return bone_jacket(rotate(rotate(p, hand, WRIST), sleeve, ELBOW), t)


def bone_head(p, t):
    """Rigid head above the jaw; below it the hair lags and swings, heavier toward the tips."""
    s = np.clip((p[..., 1] - JAW_Y) / (HAIR_TIPS_Y - JAW_Y), 0, 1)
    lag = t - 0.06 * M.lag * s
    q = lerp(head(p, lag), chest(p, lag), 0.9 * smoothstep(s, 0, 0.7))
    q[..., 0] += M.hair_x(t - 0.075 * M.lag) * s * s
    q[..., 1] += M.hair_y(t - 0.05 * M.lag) * s * s
    return q


def bone_chest(p, t):
    """A raised arm rides the chest as one piece."""
    return chest(p, t)


def premultiply(rgb, alpha):
    return np.dstack([rgb * alpha[..., None], alpha]).astype(np.float32)


def bleed(rgb, seeds, sigma):
    nearest = ndi.distance_transform_edt(~seeds, return_distances=False, return_indices=True)
    filled = rgb[nearest[0], nearest[1]]
    return np.stack([ndi.gaussian_filter(filled[..., c], sigma) for c in range(3)], -1)


def match_colors(painted, original, trusted):
    """Klein shifts fills a little (the top came back purple), so pull its local colour back to the drawing's."""
    weight = ndi.gaussian_filter(trusted.astype(np.float64), 25) + 1e-4
    shift = np.stack([ndi.gaussian_filter((original - painted)[..., c] * trusted, 25) / weight for c in range(3)], -1)
    return np.clip(painted + shift, 0, 1)


def build_layers(color, alpha, labels, silhouette):
    """Back to front. Below any part lies real painted art, so moving a part reveals a body or hair, not a hole."""
    figure = ndi.binary_erosion(alpha > 0.9, iterations=2)
    body_plate = plate("body") / 255
    nojacket = plate("nojacket") / 255
    hair_plate = plate("hair") / 255

    hair = labels == HAIR
    below = np.arange(labels.shape[0])[:, None] >= JAW_Y
    # Only the locks over the chest lie in front. Hair at the bare shoulder falls behind it, so the shoulder stays clean.
    front = hair & silhouette & (np.arange(labels.shape[1])[None, :] < FRONT_LOCKS_MAX_X)
    back = hair & ~front

    trusted = (labels == BODY) & (np.abs(color - body_plate).max(2) < 0.2)
    body_art = match_colors(body_plate, color, trusted)
    body_rgb = color.copy()
    body_alpha = np.where(labels == BODY, alpha, 0.0)
    yy, xx = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]]
    left_arm = (yy >= LEFT_ARM_EDGE[0][0]) & (xx < np.interp(yy, *LEFT_ARM_EDGE))
    # Klein's plate keeps the arms. Under the jacket only the torso and legs may remain, or a second hand shows through.
    under = figure & (labels != BODY) & ndi.binary_erosion(silhouette, iterations=1) & below & ~left_arm
    # Under a lock its pale shoulder would flash as a stripe once the lock lifts, so let the hair behind show there instead.
    under &= ~(ndi.binary_dilation((labels == HAIR) & (body_art.min(2) > 0.5), iterations=2) & (labels == HAIR))
    # It also keeps a hint of the zipper, which would peek out beside the real one.
    plate_zipper = ndi.binary_dilation((body_art[..., 2] - body_art[..., 0] > 0.15) & (body_art[..., 1] - body_art[..., 0] > 0.15) & (labels == JACKET), iterations=2)
    body_art[plate_zipper] = bleed(body_art, ~plate_zipper & (body_art.max(2) - body_art.min(2) < 0.2), 1.0)[plate_zipper]
    # And a faint copy of each lock, which would stay on the chest when the lock moves: smear the chest beside it instead.
    lock_bed = ndi.binary_dilation(front, iterations=3) & under
    bed_seeds = (labels == BODY) & (alpha > 0.9) & ~ndi.binary_dilation(front, iterations=2)
    body_art[lock_bed] = bleed(color, bed_seeds, 2.0)[lock_bed]
    body_rgb[under] = body_art[under]
    body_alpha[under] = 1.0
    # The hand on the hip stays on the hip, so only a sliver of what lies under it ever shows: smear in the skin and belt.
    x0, y0, x1, y1 = HIP_HAND_BOX
    hip_hand = (labels == JACKET) & (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    seeds = ndi.binary_erosion(labels == BODY, iterations=1) & (alpha > 0.9)
    body_rgb[hip_hand] = bleed(color, seeds, 1.5)[hip_hand]
    neck = figure & (labels == HEAD) & ~below & ndi.binary_dilation(labels == BODY, iterations=24)
    # Not from the coloured strands of hair at the neck, or a pink streak shows when the head lifts.
    plain = color.max(2) - color.min(2) < 0.35
    body_rgb[neck] = bleed(color, seeds & plain, 2.0)[neck]
    body_alpha[neck] = 1.0

    painted = np.abs(nojacket - body_plate).max(2) > 0.12
    hair_art = np.where(painted[..., None], nojacket, hair_plate)
    has_hair = painted | (hair_plate.min(2) < 0.9)
    hair_art = match_colors(hair_art, color, ndi.binary_erosion(hair, iterations=2) & (np.abs(color - hair_art).max(2) < 0.25))
    hair_rgb = color.copy()
    hair_alpha = np.where(back, alpha, 0.0)
    # Light pixels of the plate are its arm and hand, never hair.
    hidden = figure & ~back & has_hair & ndi.binary_dilation(hair, iterations=40) & below & (hair_art.min(2) < 0.6)
    # Klein's hair runs too long: stop the fill at the drawing's own tips on each side, or a swing shows a loose scrap.
    for side in (xx < CENTER_X, xx >= CENTER_X):
        hidden[side & (yy > yy[back & side].max())] = False
    hair_rgb[hidden] = hair_art[hidden]
    hair_alpha[hidden] = 1.0
    # A lock beside the jacket parts from it on a sway, and Klein's hair there is a brighter purple: carry the lock's own ink under the edge.
    tucked = figure & (labels == JACKET) & ndi.binary_dilation(back, iterations=TUCK_REACH) & below
    for side in (xx < CENTER_X, xx >= CENTER_X):
        tucked[side & (yy > yy[back & side].max())] = False
    hair_ink = ndi.binary_erosion(back, iterations=1) & (color @ np.array([0.3, 0.59, 0.11]) < 0.3) & (color.max(2) - color.min(2) < 0.12)
    hair_rgb[tucked] = bleed(color, hair_ink, 6.0)[tucked]
    hair_alpha[tucked] = 1.0
    # The bones agree here, so a few original pixels under the head close the seam for good.
    seam = figure & (labels == HEAD) & ndi.binary_dilation(back, iterations=6)
    hair_alpha[seam] = 1.0

    front_alpha = np.where(front, alpha, 0.0)
    front_seam = figure & (labels == HEAD) & ndi.binary_dilation(front, iterations=6)
    front_alpha[front_seam] = 1.0

    # The arm slides over the panel, so the panel runs on beneath it. Original pixels along the cut keep the seam from showing through.
    jacket = labels == JACKET
    arm = jacket & outline_mask(ARM_OUTLINE, labels.shape)
    panel = jacket & ~arm
    arm_xs, arm_ys = zip(*ARM_OUTLINE[:11])
    beneath = arm & (yy >= PANEL_EDGE[0][0]) & (xx >= np.interp(yy, *PANEL_EDGE)) & (xx <= np.interp(yy, arm_ys, arm_xs)) & (alpha > 0.9)
    overlap = arm & ndi.binary_dilation(panel, iterations=3)
    jacket_rgb = color.copy()
    jacket_rgb[beneath] = bleed(color, panel & (alpha > 0.9) & (color @ np.array([0.3, 0.59, 0.11]) < 0.3), 2.0)[beneath]
    jacket_rgb[overlap] = color[overlap]

    return {
        "hairBack": premultiply(hair_rgb, hair_alpha),
        "body": premultiply(body_rgb, body_alpha),
        "hairFront": premultiply(color, front_alpha),
        "jacket": premultiply(jacket_rgb, np.where(panel | beneath | overlap, alpha, 0.0)),
        "arm": premultiply(color, np.where(arm, alpha, 0.0)),
        "head": premultiply(color, np.where(labels == HEAD, alpha, 0.0)),
    }


def aligned_patch(path, color):
    """Klein's edit back at drawing scale, nudged to sit on the drawing where it did not change anything."""
    x0, y0, x1, y1 = HEAD_CROP
    patch = np.asarray(Image.open(path).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS)).astype(np.float64) / 255
    target = color[y0:y1, x0:x1]
    keep = np.ones(patch.shape[:2], bool)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    for cx, cy, rx, ry in EYE_ELLIPSES:
        keep &= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 > 1
    best, best_error = (0, 0), np.inf
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            error = (np.abs(np.roll(patch, (dy, dx), (0, 1)) - target).max(2) * keep)[6:-6, 6:-6].mean()
            if error < best_error:
                best, best_error = (dy, dx), error
    print(os.path.basename(os.path.dirname(path)), "shift", best, "mismatch", round(float(best_error), 4))
    return np.roll(patch, best, (0, 1))


def outline_mask(outline, shape):
    mask = np.zeros(shape, bool)
    xs, ys = zip(*outline)
    mask[polygon(ys, xs, shape)] = True
    return mask


def lower_lids(color, keep):
    """A lid on its way down: the lash slides over the eye, which stays put, and skin follows above it."""
    out = color.copy()
    ink = color @ np.array([0.3, 0.59, 0.11]) < 0.35
    bare_skin = (color[..., 0] - color[..., 2] > 0.07) & (color.min(2) > 0.75)
    for outline, crease in zip(EYE_OUTLINES, EYE_CREASES):
        mask = outline_mask(outline, color.shape[:2])
        skin = np.median(color[bare_skin & ndi.binary_dilation(mask, iterations=8) & ~mask], axis=0)
        if keep < 0.5:
            out[outline_mask(crease, color.shape[:2])] = skin
        columns = np.nonzero(mask.any(0))[0]
        tops, bottoms, lashes = [], [], []
        for x in columns:
            ys = np.nonzero(mask[:, x])[0]
            inked = ink[ys, x]
            start = int(np.argmax(inked)) if inked.any() else 0
            run = 0
            while start + run < len(ys) and inked[start + run] and run < LASH_MAX:
                run += 1
            tops.append(ys[start])
            bottoms.append(ys[-1])
            lashes.append(run)
        tops, bottoms, lashes = map(np.array, (tops, bottoms, lashes))
        # The lid pivots on the eye's corners, which never move.
        pivot = np.sin(np.pi * (columns - columns[0] + 0.5) / len(columns)) ** 0.5
        travel = pivot * ndi.gaussian_filter1d((1 - keep) * np.maximum(bottoms - tops - lashes, 0).astype(np.float64), 1.5, mode="nearest")
        for x, top, bottom, lash, drop in zip(columns, tops, bottoms, lashes, travel):
            ys = np.nonzero(mask[:, x])[0]
            for y in ys:
                if y < top + drop:
                    out[y, x] = skin
                elif y < top + drop + lash:
                    source = y - drop
                    low = int(np.floor(source))
                    out[y, x] = color[low, x] * (1 - source + low) + color[low + 1, x] * (source - low)
    return out


def head_variants(color, layer):
    """Open eyes stay the drawing's own pixels, the lids on the way down are made from them, and only shut comes from Klein."""
    size = color.shape[:2]
    yy, xx = np.mgrid[0 : size[0], 0 : size[1]].astype(np.float32)
    x0, y0, x1, y1 = HEAD_CROP
    full = color.copy()
    full[y0:y1, x0:x1] = aligned_patch(sorted(glob.glob("eyes-closed/*.png"))[0], color)
    masks = [ndi.gaussian_filter((((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1).astype(np.float32), 2.5) for cx, cy, rx, ry in EYE_ELLIPSES]
    union = np.maximum(*masks)
    rim = (union > 0.05) & (union < 0.5)
    # Klein lightened the skin, so match on skin alone and by ratio, which leaves the ink black.
    skin = rim & (color.min(2) > 0.7) & (full.min(2) > 0.7)
    full = np.clip(full * color[skin].mean(0) / full[skin].mean(0), 0, 1)
    # Hair is whatever dark or bluish survives an opening, which thin creases and hatching do not. It stays the drawing's.
    hairlike = (color @ np.array([0.3, 0.59, 0.11]) < 0.35) | (color[..., 2] - color[..., 0] > 0.02)
    hair = ndi.binary_opening(hairlike, iterations=2)
    shut = color
    for mask, outline, lift in zip(masks, EYE_OUTLINES, CLOSED_EYE_LIFT):
        eye = ndi.binary_dilation(outline_mask(outline, size), iterations=1)
        allowed = ndi.gaussian_filter((eye | ~hair).astype(np.float32), 0.7)
        weight = (mask * allowed)[..., None]
        shut = shut * (1 - weight) + np.roll(full, -lift, 0) * weight

    def as_layer(image):
        variant = layer.copy()
        variant[..., :3] = image * layer[..., 3:4]
        return variant.astype(np.float32)

    variants = {"open": layer, "closed": as_layer(shut)}
    for state, keep in EYE_STAGES.items():
        variants[state] = as_layer(lower_lids(color, keep))
    return variants


def warp(layer, bone, t, margin=45, steps=2, turn=None):
    """Mesh warp through PIL: each target cell samples the source quad found by inverting the bone. The target has PAD around the drawing.
    `turn` (degrees, pivot) turns the layer rigidly before the bone, for an arm: no falloff, so nothing can fold or tear."""
    ys, xs = np.nonzero(layer[..., 3] > 0.002)
    # The mesh has to cover where the layer lands, however far the root carried it.
    moved = np.stack([xs[::16], ys[::16]], -1).astype(np.float64)
    if turn:
        moved = rotate(moved, turn[0], turn[1])
    moved = bone(moved, t)
    xs, ys = moved[..., 0], moved[..., 1]
    h, w = layer.shape[:2]
    x0 = max(int(xs.min()) - margin, -PAD[0])
    x1 = min(int(xs.max()) + margin, w + PAD[0])
    y0 = max(int(ys.min()) - margin, -PAD[1])
    y1 = min(int(ys.max()) + margin, h)
    gx = np.arange(x0, x1 + GRID, GRID, dtype=np.float64)
    gy = np.arange(y0, y1 + GRID, GRID, dtype=np.float64)
    q = np.stack(np.meshgrid(gx, gy), -1)
    p = q
    for _ in range(steps):
        p = q - (bone(p, t) - p)
    if turn:
        p = rotate(p, -turn[0], turn[1])
    image = Image.frombytes("RGBa", (w, h), (layer * 255 + 0.5).astype(np.uint8).tobytes())
    size = (w + 2 * PAD[0], h + PAD[1])
    mesh = []
    for j in range(len(gy) - 1):
        for i in range(len(gx) - 1):
            box = (int(gx[i]) + PAD[0], int(gy[j]) + PAD[1], int(gx[i + 1]) + PAD[0], int(gy[j + 1]) + PAD[1])
            if box[0] < 0 or box[1] < 0 or box[2] > size[0] or box[3] > size[1]:
                continue
            quad = (*p[j, i], *p[j + 1, i], *p[j + 1, i + 1], *p[j, i + 1])
            mesh.append((box, tuple(float(v) for v in quad)))
    out = image.transform(size, Image.MESH, mesh, resample=Image.BICUBIC)
    return np.frombuffer(out.tobytes(), np.uint8).reshape((size[1], size[0], 4)).astype(np.float32) / 255


def compose(stack):
    out = np.zeros_like(stack[0])
    for layer in stack:
        out = layer + out * (1 - layer[..., 3:4])
    return out


def to_image(premultiplied):
    h, w = premultiplied.shape[:2]
    return Image.frombytes("RGBa", (w, h), (np.clip(premultiplied, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())


def to_game(premultiplied):
    """Same placement as a 768x1152 drawing resized to whole pixels: the pad around it never moves the figure in the frame."""
    scale = FIGURE_HEIGHT / SOURCE_FIGURE
    size = (round(768 * scale), round(1152 * scale))
    corner = (round(OUT_SIZE / 2 - CENTER_X * scale), round(OUT_FEET_Y - FEET_Y * scale))
    per = (768 / size[0], 1152 / size[1])
    box = tuple(float(v) for v in (PAD[0] - corner[0] * per[0], PAD[1] - corner[1] * per[1], PAD[0] + (OUT_SIZE - corner[0]) * per[0], PAD[1] + (OUT_SIZE - corner[1]) * per[1]))
    return to_image(premultiplied).resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS, box=box).convert("RGBA")
