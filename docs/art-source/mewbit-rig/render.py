"""python render.py pose [pose...] [--only 1,5,9]: renders poses to poses/<name>/NN.webp."""
import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

import rig
from anims import ANIMS
from armcut import cut_key, left_plate, right_plate
from armcuts import CUTS, DRAWN_R
from arms import SIGN, back_map, between, turned
from rig import ELBOW, EYE_ELLIPSES, EYE_OUTLINES, HEAD_CROP, SHOULDER_L, WRIST, aligned_patch, bone_arm, bone_body, bone_head, bone_chest, bone_jacket, build_layers, compose, head_variants, outline_mask, to_game, warp
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


def render_frame(anim, frame, scene):
    anim.at_frame(frame)
    t = np.float64(frame / anim.frames)
    name = pick(anim, frame, scene)
    base = scene.layers
    head = warp(scene.heads[anim.eyes[frame]], bone_head, t, 60, 3)
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
    hanging, hands = [], []
    if name:
        layers, cuts, _ = scene.key(name)
        for side, cut in cuts.items():
            src, dst = pose_of(anim, name, side, scene, t)
            turn = (back_map(src, dst, None if cut.get("over") or cut.get("free") else clearance), dst)
            arm = warp(layers[f"limb{side}"], bone_chest, t, LIMB_MARGIN, 3, turn)
            (hanging if cut.get("over") else stack).append(arm)
            if f"hand{side}" in layers:
                hands.append(warp(layers[f"hand{side}"], bone_chest, t, LIMB_MARGIN, 3, turn))
        stack.append(at(jacket, bone_jacket))
        if two:
            stack.append(at(plate["panel"], bone_jacket))
    else:
        # On its way out of the drawing: the drawing's own arms, on top as they are drawn.
        stack.append(at(jacket, bone_jacket))
        for side, (src, dst) in drawn.items():
            layer, bone = (base["arm"], bone_arm) if side == "L" else (plate["arm"], bone_jacket)
            stack.append(warp(layer, bone, t, LIMB_MARGIN, 3, (back_map(src, dst, clearance), dst)))
    return drop_specks(to_game(compose(stack + hanging + [head] + hands)))


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
