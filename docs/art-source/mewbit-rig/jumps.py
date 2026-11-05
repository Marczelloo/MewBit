"""python jumps.py pose[...]: per frame outline change, with the frames that stand out against their neighbours; a key swap that pops shows as one tall spike."""
import glob
import os
import sys

import numpy as np
from PIL import Image

for pose in sys.argv[1:]:
    paths = sorted(glob.glob(os.path.join("poses", pose, "*.webp")))
    alpha = [np.asarray(Image.open(p).convert("RGBA"), np.float32)[..., 3] for p in paths]
    moved = np.array([float((np.abs(a - b) > 64).sum()) for a, b in zip(alpha, alpha[1:])])
    spikes = []
    for i, value in enumerate(moved):
        around = np.r_[moved[max(i - 2, 0) : i], moved[i + 1 : i + 3]]
        if value > 1.8 * np.median(around) and value > 1200:
            spikes.append((i + 1, int(value), int(np.median(around))))
    print(pose, "median", int(np.median(moved)), "spikes (frame to next, px, around):", spikes)
