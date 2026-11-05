"""Estimate each frame's character scale from its head, by normalised cross-correlation against
the head of neutral/f1 across a grid of scales and rotations. Writes frames/raw/game/_scale.json."""
import glob, json
import numpy as np
from PIL import Image
from scipy.signal import fftconvolve

DOWN = 3
HEAD = (240, 15, 400, 195)  # head box in neutral/f1


def load(p):
    im = Image.open(p).convert("L")
    return np.asarray(im.resize((im.width // DOWN, im.height // DOWN), Image.LANCZOS), float)


def ncc(img, tpl):
    t = tpl - tpl.mean()
    norm_t = np.sqrt((t ** 2).sum())
    num = fftconvolve(img, t[::-1, ::-1], mode="valid")
    ones = np.ones(t.shape)
    s1 = fftconvolve(img, ones, mode="valid")
    s2 = fftconvolve(img ** 2, ones, mode="valid")
    var = np.maximum(s2 - s1 ** 2 / t.size, 1e-6)
    return num / (np.sqrt(var) * norm_t)


ref = Image.open(sorted(glob.glob("frames/raw/game/neutral/f1/*.png"))[0]).convert("L").crop(HEAD)
scales = np.arange(0.70, 1.42, 0.03)
tpls = []
for s in scales:
    for r in (-24, -16, -8, 0, 8, 16, 24):
        w, h = int(ref.width * s / DOWN), int(ref.height * s / DOWN)
        tpl = np.asarray(ref.rotate(r, fillcolor=255).resize((w, h), Image.LANCZOS), float)
        tpls.append((float(s), r, tpl))
out = {}
for d in sorted(glob.glob("frames/raw/game/*/f*")):
    d = d.replace("\\", "/")
    if "/_" in d:
        continue
    img = load(sorted(glob.glob(d + "/*.png"))[0])
    best = max(((ncc(img, t).max(), s, r) for s, r, t in tpls), key=lambda x: x[0])
    name = "/".join(d.split("/")[-2:])
    out[name] = round(best[1], 3)
    print(f"{name:18s} score={best[0]:.2f} scale={best[1]:.2f} rot={best[2]}")
json.dump(out, open("frames/raw/game/_scale.json", "w"), indent=1)
