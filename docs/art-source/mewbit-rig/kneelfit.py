"""Finds the drawing's head in each key drawing and brings the key to the drawing's scale, standing on the drawing's floor line."""
import glob
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.feature import match_template

from rig import CENTER_X, FEET_Y
from segment import SOURCE, cut_alpha, load

KEYS = ["sag-23", "buckle-37", "buckle-23", "low-41", "low-37", "land-23", "land-11", "land-37", "kneel-23", "bow-23", "bow-37", "fours-23", "fours-37"]
HEAD_BOX = (300, 66, 492, 238)
DOWN = 3


def small_gray(image):
    h, w = image.shape[:2]
    return np.asarray(Image.fromarray(image.astype(np.uint8)).convert("L").resize((w // DOWN, h // DOWN), Image.LANCZOS)).astype(np.float64)


def fit_head(template, key):
    x0, y0, x1, y1 = HEAD_BOX
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    best = (-1,)
    gray = small_gray(key)

    def attempt(scale, turn):
        nonlocal best
        side = int(max(x1 - x0, y1 - y0) * 1.5 / 2)
        crop = Image.fromarray(template.astype(np.uint8)).rotate(-turn, Image.BICUBIC, center=(cx, cy), fillcolor=(255, 255, 255))
        crop = crop.crop((x0, y0, x1, y1))
        crop = crop.resize((max(8, round((x1 - x0) * scale / DOWN)), max(8, round((y1 - y0) * scale / DOWN))), Image.LANCZOS).convert("L")
        score = match_template(gray, np.asarray(crop).astype(np.float64))
        at = np.unravel_index(np.argmax(score), score.shape)
        if score[at] > best[0]:
            h, w = crop.size[1], crop.size[0]
            best = (float(score[at]), scale, turn, (at[1] + w / 2) * DOWN, (at[0] + h / 2) * DOWN)

    for scale in np.arange(0.75, 1.75, 0.05):
        for turn in range(-16, 17, 4):
            attempt(scale, turn)
    _, scale0, turn0, _, _ = best
    for scale in np.arange(scale0 - 0.05, scale0 + 0.051, 0.0125):
        for turn in np.arange(turn0 - 4, turn0 + 4.1, 1):
            attempt(scale, turn)
    return best


def main():
    template = load(SOURCE)
    x0, y0, x1, y1 = HEAD_BOX
    fits = {}
    for name in KEYS:
        path = sorted(glob.glob(f"kneel/{name}/*.png"))[0]
        rgb = load(path)
        score, scale, turn, cx, cy = fit_head(template, rgb)
        color, alpha = cut_alpha(rgb)
        ys, xs = np.nonzero(alpha > 0.5)
        lo = ys.max() / scale
        # Below the head the figure is centred on its lower half; the head is free to lean.
        low = ys > (ys.min() + ys.max()) / 2
        mid = (xs[low].min() + xs[low].max()) / 2 / scale
        shift = (CENTER_X - mid, FEET_Y - lo)
        fits[name] = {"score": round(score, 3), "scale": scale, "turn": turn, "head": (cx / scale + shift[0], cy / scale + shift[1]), "shift": shift, "path": path}
        print(name, "score", round(score, 3), "scale", round(scale, 3), "turn", turn, "head", [round(v) for v in fits[name]["head"]], flush=True)
    json.dump(fits, open("kneel/fits.json", "w"), indent=1)


if __name__ == "__main__":
    main()
