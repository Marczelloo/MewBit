"""Fits new keys into kneel/fits.json. Usage: kneelfit2.py name..."""
import glob
import json
import sys

import numpy as np

from kneelfit import fit_head
from rig import CENTER_X, FEET_Y
from segment import SOURCE, cut_alpha, load

template = load(SOURCE)
fits = json.load(open("kneel/fits.json"))
for name in sys.argv[1:]:
    path = sorted(glob.glob(f"kneel/{name}/*.png"))[0]
    rgb = load(path)
    score, scale, turn, cx, cy = fit_head(template, rgb)
    _, alpha = cut_alpha(rgb)
    ys, xs = np.nonzero(alpha > 0.5)
    lo = ys.max() / scale
    low = ys > (ys.min() + ys.max()) / 2
    mid = (xs[low].min() + xs[low].max()) / 2 / scale
    shift = (float(CENTER_X - mid), float(FEET_Y - lo))
    fits[name] = {"score": round(float(score), 3), "scale": float(scale), "turn": float(turn), "head": (float(cx / scale + shift[0]), float(cy / scale + shift[1])), "shift": shift, "path": path}
    print(name, round(float(score), 3), round(float(scale), 3), turn, [round(v) for v in fits[name]["head"]], flush=True)
json.dump(fits, open("kneel/fits.json", "w"), indent=1)
