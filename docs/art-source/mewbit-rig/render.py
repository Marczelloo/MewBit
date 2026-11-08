"""python render.py pose [pose...] [--only 1,5,9]: renders poses to poses/<name>/NN.webp."""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

import rig
from anims import ANIMS
from armcut import cut_key, left_plate, right_plate
from armcuts import CUTS, DRAWN_R
from arms import SIGN, back_map, between, turned
from rig import CENTER_X, FEET_Y, FIGURE_HEIGHT, OUT_FEET_Y, OUT_SIZE, SOURCE_FIGURE, ELBOW, EYE_ELLIPSES, EYE_OUTLINES, HEAD_CROP, SHOULDER_L, WRIST, aligned_patch, bone_arm, bone_body, bone_head, bone_chest, bone_jacket, build_layers, compose, head_variants, outline_mask, to_game, warp
from segment import SOURCE, cut_drawing, load

ORDER = [("hairBack", bone_head), ("body", bone_body), ("hairFront", bone_head), ("jacket", bone_jacket), ("arm", bone_arm), ("head", bone_head)]
DRAWN = {"L": (SHOULDER_L, ELBOW, WRIST), "R": DRAWN_R}
# How far a limb's mesh reaches past its joints: a hand and a bulging sleeve.
LIMB_MARGIN = 190
# Rows under the jacket fronts where the body layer is only a guess; the thighs below THIGH_ROW carry on under the jacket and stay.
LINING_LEFT = (415, 640)
LINING_RIGHT = (495, 640)
THIGH_ROW = 575
THIGH_LEFT = 258
THIGH_RIGHT = 466
SPECK = 80
# Eyes with brows, then the mouth.
FACE_PARTS = [(360, 172, 34, 34), (422, 164, 38, 34), (398, 216, 28, 17)]
WINK_EYE = 1


# Kage: the anime shadow of gloom over her brow, vertical strokes falling from the top of her face over a cold shade.
GLOOM_BOX = (80, 270, 320, 500)
GLOOM_CENTER, GLOOM_RADII = (410, 172), (60, 62)
GLOOM_TOP, GLOOM_BOTTOM = 112, 206
GLOOM_TINT = np.array([0.30, 0.26, 0.62], np.float32)
GLOOM_INK = np.array([0.24, 0.16, 0.46], np.float32)
_gloom_strokes = []


def gloomed(head, g):
    """The head under the gloom at weight g (0..1): the strokes grow down from the top as it comes."""
    if not _gloom_strokes:
        rng = np.random.default_rng(11)
        x = GLOOM_CENTER[0] - GLOOM_RADII[0] + 8
        while x < GLOOM_CENTER[0] + GLOOM_RADII[0] - 6:
            _gloom_strokes.append((x, rng.uniform(0.55, 1.0), rng.choice([2.8, 3.4, 4.2])))
            x += rng.uniform(8, 12)
    y0, y1, x0, x1 = GLOOM_BOX
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    cx, cy = GLOOM_CENTER
    rx, ry = GLOOM_RADII
    face = np.clip((1 - ((xx - cx) / rx) ** 2 - ((yy - cy) / ry) ** 2) / 0.3, 0, 1)
    out = head.copy()
    part = out[y0:y1, x0:x1]
    alpha = part[..., 3:4]
    fall = np.clip((GLOOM_BOTTOM + 30 - yy) / 90, 0, 1)
    shade = (g * 0.75 * face * fall)[..., None]
    part[..., :3] = part[..., :3] * (1 - shade) + part[..., :3] * GLOOM_TINT * 1.25 * shade
    grow = min(1.0, g * 1.4)
    lines = np.zeros_like(yy)
    for x, length, width in _gloom_strokes:
        end = GLOOM_TOP + (GLOOM_BOTTOM - GLOOM_TOP) * length * grow
        across = np.clip((width / 2 + 0.5 - np.abs(xx - x)), 0, 1)
        along = np.clip((end - yy) / max(1.0, (end - GLOOM_TOP) * 0.6), 0, 1) * (yy >= GLOOM_TOP)
        lines = np.maximum(lines, across * along)
    ink = (g * 0.95 * lines * np.clip(face * 1.6, 0, 1))[..., None]
    part[..., :3] = part[..., :3] * (1 - ink) + GLOOM_INK * alpha * ink
    return out


# Where between the drawing (0) and a two-armed key (1) a key's face patch starts to show.
FACE_FROM = 0.6


def elevation(direction):
    """Degrees from hanging straight down to pointing straight up."""
    return float(np.degrees(np.arccos(np.clip(direction[1], -1, 1))))


def expressions(color, layer, heads):
    """Faces from Klein's edits of the head crop: eyes, brows and mouth only, hair stays the drawing's. A wink is one eye of the closed plate."""
    size = color.shape[:2]
    yy, xx = np.mgrid[0 : size[0], 0 : size[1]].astype(np.float32)
    ellipse = lambda cx, cy, rx, ry, blur: ndi.gaussian_filter((((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1).astype(np.float32), blur)
    x0, y0, x1, y1 = HEAD_CROP
    hairlike = (color @ np.array([0.3, 0.59, 0.11]) < 0.35) | (color[..., 2] - color[..., 0] > 0.02)
    hair = ndi.binary_opening(hairlike, iterations=2)
    eyes = np.zeros(size, bool)
    for outline in EYE_OUTLINES:
        eyes |= ndi.binary_dilation(outline_mask(outline, size), iterations=2)
    allowed = ndi.gaussian_filter((eyes | ~hair).astype(np.float32), 0.7)
    out = dict(heads)
    for name, take in {"happy": 23, "sad": 7, "wince": 23}.items():
        paths = sorted(glob.glob(f"face-{name}-{take}/*.png"))
        if not paths:
            continue
        full = color.copy()
        full[y0:y1, x0:x1] = aligned_patch(paths[0], color)
        mask = np.zeros(size, np.float32)
        for cx, cy, rx, ry in FACE_PARTS:
            mask = np.maximum(mask, ellipse(cx, cy, rx, ry, 2.5))
        rim = (mask > 0.05) & (mask < 0.5) & (color.min(2) > 0.7) & (full.min(2) > 0.7)
        full = np.clip(full * color[rim].mean(0) / full[rim].mean(0), 0, 1)
        weight = (mask * allowed)[..., None]
        variant = layer.copy()
        variant[..., :3] = (color * (1 - weight) + full * weight) * layer[..., 3:4]
        out[name] = variant.astype(np.float32)
    cx, cy, rx, ry = EYE_ELLIPSES[WINK_EYE]
    one = ellipse(cx, cy, rx + 4, ry + 4, 2.5)[..., None]
    for state, source in {"wink1": "lid1", "wink2": "lid2", "wink": "closed"}.items():
        out[state] = (layer * (1 - one) + heads[source] * one).astype(np.float32)
    return out


def dark_lining(layers):
    """What the hair and shorts guessed under the jacket fronts is white hatching, which shows when the jacket slides off the hip: it becomes the dark next to it."""
    body, jacket = layers["body"], layers["jacket"]
    a = np.maximum(body[..., 3], 1e-4)
    rgb = body[..., :3] / a[..., None]
    light = rgb @ np.array([0.3, 0.59, 0.11])
    columns, rows = np.meshgrid(np.arange(light.shape[1]), np.arange(light.shape[0]))
    fronts = ((columns < 330) & (rows >= LINING_LEFT[0]) & (rows < LINING_LEFT[1]) & ((rows < THIGH_ROW) | (columns < THIGH_LEFT))) | ((columns >= 330) & (rows >= LINING_RIGHT[0]) & (rows < LINING_RIGHT[1]) & ((rows < THIGH_ROW) | (columns >= THIGH_RIGHT)))
    warm = rgb[..., 0] - rgb[..., 2] > 0.04
    bad = fronts & (jacket[..., 3] > 0.5) & ((light > 0.3) | warm)
    usable = ~bad & ~warm & (light < 0.2) & (body[..., 3] > 0.9)
    near = ndi.distance_transform_edt(~usable, return_distances=False, return_indices=True)
    rgb[bad] = rgb[near[0][bad], near[1][bad]]
    return {**layers, "body": np.concatenate([rgb * a[..., None], body[..., 3:]], axis=2).astype(np.float32)}


class Scene:
    def __init__(self):
        original = load(SOURCE)
        self.color, alpha = cut_drawing(original)
        self.labels = np.load("labels.npy")
        self.alpha = alpha
        self.layers = dark_lining(build_layers(self.color, alpha, self.labels, np.load("body_silhouette.npy")))
        self.heads = expressions(self.color, self.layers["head"], head_variants(self.color, self.layers["head"]))
        # Star eyes open wide over the laughing mouth.
        yy, xx = np.mgrid[0 : self.color.shape[0], 0 : self.color.shape[1]].astype(np.float32)
        cx, cy, rx, ry = FACE_PARTS[-1]
        mouth = ndi.gaussian_filter((((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1).astype(np.float32), 2.5)[..., None]
        self.heads["star"] = (self.heads["open"] * (1 - mouth) + self.heads["happy"] * mouth).astype(np.float32)
        self.keys = {}
        self._plate = None
        self._left = None
        self._clear = {}

    def key(self, name):
        if name not in self.keys:
            layers, cuts, arms = cut_key(name, self.color, self.alpha)
            self.keys[name] = (layers, cuts, max(elevation(v[1]) for v in arms.values()))
            print(name, "rest", round(self.keys[name][2]), flush=True)
        return self.keys[name]

    @property
    def plate(self):
        if self._plate is None:
            self._plate = right_plate(self.color, self.alpha, self.layers)
        return self._plate

    @property
    def left(self):
        if self._left is None:
            self._left = left_plate(self.color, self.alpha, self.layers)
        return self._left

    def clearance(self, two):
        """Distance from any spot to the jacket that stays put, which is what an arm stays attached to."""
        if two not in self._clear:
            jacket = (self.plate["jacket"] if two else self.layers["jacket"])[..., 3] > 0.5
            self._clear[two] = ndi.distance_transform_edt(~jacket)
        field = self._clear[two]

        def lookup(q):
            x = np.clip(np.round(q[..., 0]).astype(int), 0, field.shape[1] - 1)
            y = np.clip(np.round(q[..., 1]).astype(int), 0, field.shape[0] - 1)
            return field[y, x]

        return lookup


def stops(anim, scene):
    """The series of an animation as (key, rest elevation), lowest first."""
    rests = getattr(anim, "rests", {})
    out = []
    for name, rest in anim.series:
        if rest is None:
            rest = rests.get(name)
        if rest is None:
            rest = scene.key(name)[2]
        out.append((name, rest))
    return sorted(out, key=lambda stop: stop[1])


def pick(anim, frame, scene):
    """Key drawing for this frame: the one closest to where the arm is."""
    if frame in anim.key_at:
        return anim.key_at[frame]
    if not anim.series:
        return None
    if len(anim.series) == 1:
        return anim.series[0][0]
    value = float(anim.elev(frame / anim.frames))
    line = stops(anim, scene)
    early = getattr(anim, "takes_over", {})
    name = line[0][0]
    for (_, rest_a), (b, rest_b) in zip(line, line[1:]):
        if value >= early.get(b, (rest_a + rest_b) / 2):
            name = b
    return name


def joints_of(name, side, scene):
    return DRAWN[side] if name is None else scene.key(name)[1][side]["joints"]


def pose_of(anim, name, side, scene, t):
    """Where the arm's joints are now: between the two keys around its elevation, or past the last one turned as a whole."""
    src = joints_of(name, side, scene)
    dst = src
    if len(anim.series) > 1:
        value = float(anim.elev(t))
        line = stops(anim, scene)
        if value <= line[0][1]:
            dst = turned(joints_of(line[0][0], side, scene), SIGN[side] * (value - line[0][1]))
        elif value >= line[-1][1]:
            dst = turned(joints_of(line[-1][0], side, scene), SIGN[side] * (value - line[-1][1]))
        else:
            for (a, rest_a), (b, rest_b) in zip(line, line[1:]):
                if rest_a <= value <= rest_b:
                    dst = between(joints_of(a, side, scene), joints_of(b, side, scene), (value - rest_a) / max(rest_b - rest_a, 1e-6))
                    break
    wobble = {"L": anim.wob_l, "R": anim.wob_r}[side]
    return src, turned(dst, SIGN[side] * float(wobble(t)))


def drop_specks(image):
    """Crumbs of cut layers that end up off the figure read as dirt on the frame."""
    pixels = np.array(image)
    labels, count = ndi.label(pixels[..., 3] > 127)
    if count > 1:
        sizes = ndi.sum(np.ones(labels.shape), labels, range(1, count + 1))
        speck = np.isin(labels, 1 + np.nonzero(sizes < SPECK)[0])
        pixels[ndi.binary_dilation(speck), 3] = 0
    return Image.fromarray(pixels)


def two_armed(anim, name):
    named = ([name] if name else []) + [n for n, _ in anim.series if n]
    return bool(named) and "R" in CUTS[named[0]]


# --- combo tiers: star eyes, blush, sparkles and the aura ---
STAR_EYES = [(362.0, 184.0, 22.0, 0.90), (420.0, 171.0, 24.0, 1.0)]  # cx, cy, radius, width (the far eye is narrower)
STAR_BOX = (322, 130, 472, 232)  # x0, y0, x1, y1 in head space
STAR_TILT = -10.0
STAR_SS = 4
STAR_LINE = (46, 16, 84)
STAR_TONES = [
    ((255, 196, 34), (255, 244, 170)),   # gold
    ((255, 74, 190), (255, 214, 244)),   # magenta
    ((42, 226, 255), (214, 250, 255)),   # cyan
]
BLUSH = [(366.0, 208.0, 14.0, 6.5), (443.0, 194.0, 13.0, 6.5)]
BLUSH_PINK = np.array([1.0, 0.36, 0.52], np.float32)


def star_polygon(cx, cy, radius, inner, angle, width):
    out = []
    tilt = np.radians(STAR_TILT)
    for i in range(10):
        a = np.radians(angle - 90 + i * 36)
        r = radius if i % 2 == 0 else radius * inner
        x, y = r * np.cos(a) * width, r * np.sin(a)
        out.append((cx + x * np.cos(tilt) - y * np.sin(tilt), cy + x * np.sin(tilt) + y * np.cos(tilt)))
    return out


def star_tone(hue):
    """The two star colours at hue 0..1 around gold, magenta and cyan; None stays gold."""
    if hue is None:
        return STAR_TONES[0]
    place = (hue % 1.0) * len(STAR_TONES)
    i = int(place)
    mix = place - i
    a, b = STAR_TONES[i], STAR_TONES[(i + 1) % len(STAR_TONES)]
    return tuple(tuple(int(round(p + (q - p) * mix)) for p, q in zip(c, d)) for c, d in zip(a, b))


def starred(head, size, spin, hue, blush):
    """Stars over both eyes, in head space so they turn and bob with it, and the cheeks flushed."""
    x0, y0, x1, y1 = STAR_BOX
    out = head.copy()
    part = out[y0:y1, x0:x1]
    if blush > 0:
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        skin = np.clip((part[..., :3].min(2) - 0.55) / 0.2, 0, 1)
        cheek = np.zeros_like(xx)
        for cx, cy, rx, ry in BLUSH:
            cheek = np.maximum(cheek, np.clip(1.25 - ((xx - cx) / rx) ** 2 - ((yy - cy) / ry) ** 2, 0, 1))
            for k in (-7.5, 0, 7.5):
                # The three little slashes anime cheeks get.
                along = (xx - cx - k) + (yy - cy) * 0.62
                cheek = np.maximum(cheek, 1.5 * np.clip(1.3 - np.abs(along), 0, 1) * (np.abs(yy - cy) < 5.5))
        amount = (np.clip(cheek, 0, 1) * skin * blush * 0.72)[..., None]
        part[..., :3] = part[..., :3] * (1 - amount) + BLUSH_PINK * part[..., 3:4] * amount
    w, h = (x1 - x0) * STAR_SS, (y1 - y0) * STAR_SS
    sheet = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    rim, core = star_tone(hue)
    at = lambda points: [((px - x0) * STAR_SS, (py - y0) * STAR_SS) for px, py in points]
    for cx, cy, radius, width in STAR_EYES:
        r = radius * size
        draw.polygon(at(star_polygon(cx, cy, r + 2.8, 0.56, spin, width)), fill=STAR_LINE + (255,))
        draw.polygon(at(star_polygon(cx, cy, r, 0.52, spin, width)), fill=rim + (255,))
        draw.polygon(at(star_polygon(cx, cy, r * 0.62, 0.52, spin, width)), fill=core + (255,))
        gx, gy = (cx - r * 0.2 - x0) * STAR_SS, (cy - r * 0.26 - y0) * STAR_SS
        g = r * 0.17 * STAR_SS
        draw.ellipse((gx - g, gy - g, gx + g, gy + g), fill=(255, 255, 255, 255))
    sheet = sheet.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    star = np.array(sheet, np.float32) / 255
    if size < 1.0:
        # Small stars sit in the eye: the lashes and hair above it stay in front of them.
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        ink = np.clip((0.3 - part[..., :3].max(2)) / 0.12, 0, 1)
        above = np.zeros_like(xx)
        for cx, cy, _, _ in STAR_EYES:
            above = np.maximum(above, ((np.abs(xx - cx) < 34) & (yy < cy - 7)).astype(np.float32))
        star[..., 3] *= 1 - ink * above
    star[..., :3] *= star[..., 3:4]
    part[..., :3] = star[..., :3] + part[..., :3] * (1 - star[..., 3:4])
    part[..., 3:4] = np.maximum(part[..., 3:4], star[..., 3:4])
    return out


def sparkle_polygon(cx, cy, r, turn):
    out = []
    for i in range(8):
        a = np.radians(turn + i * 45)
        q = r if i % 2 == 0 else r * 0.16
        out.append((cx + q * np.cos(a), cy + q * np.sin(a)))
    return out


# dx, dy from the head in frame pixels, size, phase, tone (index into STAR_TONES).
SPARKLES = {
    1: [(-128, -58, 30, 0.00, 0), (122, -92, 36, 0.30, 0), (-98, -128, 20, 0.58, 2), (150, 8, 24, 0.80, 0)],
    2: [(-142, -40, 36, 0.00, 0), (128, -106, 44, 0.20, 0), (-96, -142, 26, 0.45, 1), (160, -12, 30, 0.66, 2),
        (-176, 40, 24, 0.33, 2), (178, 74, 26, 0.86, 1), (-30, -168, 22, 0.75, 0), (64, -160, 18, 0.10, 2)],
    3: [(-150, -52, 44, 0.00, 0), (136, -116, 52, 0.17, 1), (-104, -150, 34, 0.40, 2), (172, -14, 38, 0.62, 0),
        (-192, 36, 32, 0.30, 1), (196, 72, 34, 0.84, 2), (-34, -180, 28, 0.72, 0), (70, -172, 24, 0.08, 1),
        (-214, 130, 26, 0.52, 0), (218, 170, 28, 0.25, 0), (-170, 214, 22, 0.92, 2), (170, 248, 20, 0.46, 1)],
}
FX_SS = 3
HEAD_ANCHOR = np.array([[405.0, 165.0]], np.float64)
_fx_noise = None


def to_frame_point(p):
    scale = FIGURE_HEIGHT / SOURCE_FIGURE
    return round(OUT_SIZE / 2 - CENTER_X * scale) + p[0] * scale, round(OUT_FEET_Y - FEET_Y * scale) + p[1] * scale


def with_sparkles(image, tier, t):
    head_x, head_y = to_frame_point(bone_head(HEAD_ANCHOR, t)[0])
    sheet = Image.new("RGBA", (OUT_SIZE * FX_SS, OUT_SIZE * FX_SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    for dx, dy, size, phase, tone in SPARKLES[tier]:
        # Two twinkles per loop, each growing out of nothing and gone again.
        live = float(np.sin(np.pi * ((t * 2 + phase) % 1.0)) ** 1.6)
        if live < 0.04:
            continue
        cx, cy, r, turn = (head_x + dx) * FX_SS, (head_y + dy) * FX_SS, size * live * FX_SS, 18 * np.sin(2 * np.pi * (t + phase))
        draw.polygon(sparkle_polygon(cx, cy, r * 1.14, turn), fill=STAR_TONES[tone][0] + (255,))
        draw.polygon(sparkle_polygon(cx, cy, r * 0.72, turn), fill=(255, 255, 255, 255))
    return Image.alpha_composite(image, sheet.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS))


def with_aura(image, t, hue):
    """Flames licking up off her outline, behind her. The noise scrolls one whole tile per loop."""
    global _fx_noise
    if _fx_noise is None:
        rng = np.random.default_rng(23)
        tile = (384, OUT_SIZE)
        coarse = ndi.gaussian_filter(rng.standard_normal(tile), (26, 5), mode="wrap")
        fine = ndi.gaussian_filter(rng.standard_normal(tile), (10, 2.2), mode="wrap")
        field = coarse / coarse.std() + 0.55 * fine / fine.std()
        _fx_noise = (field / field.std()).astype(np.float32)
    figure = np.array(image, np.float32) / 255
    solid = figure[..., 3] > 0.5
    # Flames rise, so the outline it burns from is smeared upward.
    smeared = solid.copy()
    for lift in range(6, 49, 6):
        smeared |= np.roll(solid, -lift, axis=0)
    dist = ndi.distance_transform_edt(~smeared).astype(np.float32)
    scroll = int(round(float(t) * _fx_noise.shape[0]))
    noise = np.tile(np.roll(_fx_noise, -scroll, axis=0), (2, 1))[:OUT_SIZE]
    # It burns from the shoulders up and dies out along the legs.
    fade = np.clip((500 - np.arange(OUT_SIZE, dtype=np.float32)) / 230, 0.12, 1)[:, None]
    reach = (12 + 10 * noise) * fade
    heat = ndi.gaussian_filter(np.clip((reach - dist) / 12, 0, 1), 1.1)
    rim, core = star_tone(hue)
    outer = np.array(rim, np.float32) / 255
    inner = (np.array(core, np.float32) + np.array(rim, np.float32)) / 510
    a = np.clip(heat * 1.25, 0, 1)[..., None] ** 1.3 * 0.78
    mix = np.clip(heat * 2.2 - 1.3, 0, 1)[..., None]
    flame = np.dstack([(outer * (1 - mix) + inner * mix) * a, a])
    figure[..., :3] *= figure[..., 3:4]
    done = figure + flame * (1 - figure[..., 3:4])
    a_out = done[..., 3:4]
    straight = np.where(a_out > 1e-4, done[..., :3] / np.maximum(a_out, 1e-4), 0)
    return Image.fromarray((np.dstack([straight, a_out]).clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def with_fx(image, anim, t):
    fx = getattr(anim, "fx", None)
    if not fx:
        return image
    if fx.get("aura"):
        image = with_aura(image, t, fx["aura"](t))
    if fx.get("sparkles"):
        image = with_sparkles(image, fx["sparkles"], t)
    return image


def render_frame(anim, frame, scene):
    return with_fx(figure_frame(anim, frame, scene), anim, np.float64(frame / anim.frames))


def figure_frame(anim, frame, scene):
    anim.at_frame(frame)
    t = np.float64(frame / anim.frames)
    name = pick(anim, frame, scene)
    base = scene.layers
    face = scene.heads[anim.eyes[frame]]
    gloom = float(anim.gloom(t)) if getattr(anim, "gloom", None) else 0.0
    star = getattr(anim, "star", None)
    if star and anim.eyes[frame] == "star":
        hue = star["hue"](t) if star.get("hue") else None
        face = starred(face, float(star["size"](t)), float(star["spin"](t)), hue, star["blush"])
    head = warp(gloomed(face, gloom) if gloom > 0.01 else face, bone_head, t, 60, 3)
    at = lambda layer, bone: warp(layer, bone, t, 60, 3)
    two = two_armed(anim, name)
    drawn = None
    if not name and anim.series:
        drawn = {side: pose_of(anim, None, side, scene, t) for side in (("L", "R") if two else ("L",))}
        if all(np.abs(np.array(a) - np.array(b)).max() < 0.05 for a, b in drawn.values()):
            drawn = None

    # The drawing as it is, with no arm of its own off its place.
    if not name and not drawn:
        stack = [head if layer == "head" else at(base[layer], bone) for layer, bone in ORDER]
        return drop_specks(to_game(compose(stack)))

    clearance = scene.clearance(two)
    plate = scene.plate if two else None
    jacket = plate["jacket"] if two else base["jacket"]
    left = scene.left
    stack = [at(left["hairBack"], bone_head), at(base["body"], bone_body), at(left["hairFront"], bone_head), at(left["under"], bone_jacket)]
    if two:
        stack.append(at(plate["under"], bone_jacket))
    hanging, hands, faces = [], [], []
    if name:
        layers, cuts, _ = scene.key(name)
        for side, cut in cuts.items():
            src, dst = pose_of(anim, name, side, scene, t)
            turn = (back_map(src, dst, None if cut.get("over") or cut.get("free") else clearance), dst)
            arm = warp(layers[f"limb{side}"], bone_chest, t, LIMB_MARGIN, 3, turn)
            (hanging if cut.get("over") else stack).append(arm)
            if f"hand{side}" in layers:
                hands.append(warp(layers[f"hand{side}"], bone_chest, t, LIMB_MARGIN, 3, turn))
        if "face" in layers:
            # It shows once the arms have arrived; on the way up the hands are still the limbs'.
            arrived = float(np.clip((float(anim.elev(t)) - FACE_FROM) / (1 - FACE_FROM), 0, 1))
            if arrived > 0:
                faces.append(warp(layers["face"] * (arrived * arrived * (3 - 2 * arrived)), bone_head, t, 60, 3))
        stack.append(at(jacket, bone_jacket))
        if two:
            stack.append(at(plate["panel"], bone_jacket))
    else:
        # On its way out of the drawing: the drawing's own arms, on top as they are drawn.
        stack.append(at(jacket, bone_jacket))
        for side, (src, dst) in drawn.items():
            layer, bone = (base["arm"], bone_arm) if side == "L" else (plate["arm"], bone_jacket)
            stack.append(warp(layer, bone, t, LIMB_MARGIN, 3, (back_map(src, dst, clearance), dst)))
    return drop_specks(to_game(compose(stack + hanging + [head] + faces + hands)))


def main():
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        i = args.index("--only")
        only = [int(v) for v in args[i + 1].split(",")]
        del args[i : i + 2]
    scene = Scene()
    for pose in args:
        anim = ANIMS[pose]()
        rig.M = anim
        out_dir = os.path.join("poses", pose)
        os.makedirs(out_dir, exist_ok=True)
        frames = only if only else range(1, anim.frames + 1)
        for number in frames:
            to_game_image = render_frame(anim, number - 1, scene)
            to_game_image.save(os.path.join(out_dir, f"{number:02d}.webp"), quality=88, alpha_quality=95, method=6)
        size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(out_dir, "*.webp")))
        print(pose, anim.frames, "frames", round(size / 1e6, 2), "MB", flush=True)


if __name__ == "__main__":
    main()
