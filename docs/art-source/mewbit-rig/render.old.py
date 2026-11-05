"""python render.py pose [pose...] [--only 1,5,9]: renders poses to poses/<name>/NN.webp."""
import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

import rig
from anims import ANIMS
from keys import LEVEL, OVER_HEAD, build_key
from rig import EYE_ELLIPSES, EYE_OUTLINES, HEAD_CROP, aligned_patch, bone_arm, bone_body, bone_head, bone_chest, bone_jacket, build_layers, compose, head_variants, outline_mask, to_game, warp
from segment import SOURCE, cut_drawing, load

ORDER = [("hairBack", bone_head), ("patchHair", bone_head), ("body", bone_body), ("hairFront", bone_head), ("jacket", bone_jacket), ("arm", bone_arm), ("head", bone_head), ("patch", bone_jacket)]
SIGN = {"L": 1, "R": -1}
LIMIT = 24
UP_LIMIT, UP_FROM = 3, 60
DOWN_OVER_HEAD = 8
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


class Scene:
    def __init__(self):
        original = load(SOURCE)
        self.color, alpha = cut_drawing(original)
        self.labels = np.load("labels.npy")
        self.alpha = alpha
        self.layers = build_layers(self.color, alpha, self.labels, np.load("body_silhouette.npy"))
        self.heads = expressions(self.color, self.layers["head"], head_variants(self.color, self.layers["head"]))
        self.keys = {}

    def key(self, name):
        if name not in self.keys:
            layers, limbs, shift, area, hair = build_key(name, self.color, self.alpha, self.labels, self.layers)
            print(name, "shift", shift, "patch px", area, "hair px", hair, {s: (round(elevation(v[1])), round(v[2])) for s, v in limbs.items()})
            self.keys[name] = (layers, limbs)
        return self.keys[name]


def pick(anim, frame, scene):
    """Key drawing for this frame and its arms' rest elevations."""
    if frame in anim.key_at:
        return anim.key_at[frame]
    if not anim.series:
        return None
    if len(anim.series) == 1:
        return anim.series[0][0]
    rests = getattr(anim, "rests", {})
    value = float(anim.elev(frame / anim.frames))
    best, best_gap = None, 1e9
    for name, rest in anim.series:
        if rest is None:
            rest = rests.get(name)
        if rest is None:
            rest = max(elevation(v[1]) for v in scene.key(name)[1].values())
        gap = abs(value - rest)
        if gap < best_gap:
            best, best_gap = name, gap
    return best


def limbs_for(anim, name, scene, t):
    rests = getattr(anim, "rests", {})
    wobble = {"L": anim.wob_l, "R": anim.wob_r}
    out = []
    for side, (pivot, direction, length) in scene.key(name)[1].items():
        rest = rests.get(name, elevation(direction))
        # A half raised arm leaves the sleeve's lower fold behind on the jacket, so turning it further up tears them apart.
        up = UP_LIMIT if UP_FROM < rest < LEVEL else LIMIT
        # A hand drawn over the hair had the hair cut away under it, so it cannot swing far off that hole.
        down = DOWN_OVER_HEAD if name in OVER_HEAD else LIMIT
        turn = 0.0 if anim.elev is None else float(np.clip(anim.elev(t) - rest, -down, up))
        out.append((side, SIGN[side] * (turn + float(wobble[side](t))), pivot))
    return out


def drop_specks(image):
    """Crumbs of cut layers that end up off the figure read as dirt on the frame."""
    pixels = np.array(image)
    labels, count = ndi.label(pixels[..., 3] > 127)
    if count > 1:
        sizes = ndi.sum(np.ones(labels.shape), labels, range(1, count + 1))
        speck = np.isin(labels, 1 + np.nonzero(sizes < SPECK)[0])
        pixels[ndi.binary_dilation(speck), 3] = 0
    return Image.fromarray(pixels)


def render_frame(anim, frame, scene):
    anim.at_frame(frame)
    t = np.float64(frame / anim.frames)
    name = pick(anim, frame, scene)
    layers = scene.layers
    arms = []
    if name:
        layers = scene.key(name)[0]
        arms = [warp(layers[f"limb{side}"], bone_chest, t, 60, 3, (degrees, pivot)) for side, degrees, pivot in limbs_for(anim, name, scene, t)]
    stack = []
    for layer_name, bone in ORDER:
        if layer_name in ("patch", "patchHair") and not name:
            continue
        # An arm passes behind the head, unless the drawing has its hand on the face.
        if layer_name == "head" and name not in OVER_HEAD:
            stack += arms
        layer = scene.heads[anim.eyes[frame]] if layer_name == "head" else layers[layer_name]
        if (layer[..., 3] > 0.002).any():
            stack.append(warp(layer, bone, t, 60, 3))
    if name in OVER_HEAD:
        stack += arms
    return drop_specks(to_game(compose(stack)))


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
