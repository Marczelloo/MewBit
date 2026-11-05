"""python stable.py pose[...]: frame to frame change in the belly and shorts, which no arm crosses, and in the whole figure; a spike on a key swap is a torn or jumping torso."""
import glob
import os
import sys

import numpy as np
from PIL import Image

# In game pixels: belly down through the shorts, inside both jacket panels.
BELLY = (296, 290, 352, 372)

for pose in sys.argv[1:]:
    paths = sorted(glob.glob(os.path.join("poses", pose, "*.webp")))
    frames = [np.asarray(Image.open(p).convert("RGBA"), np.float32) for p in paths]
    belly, whole = [], []
    for a, b in zip(frames, frames[1:]):
        x0, y0, x1, y1 = BELLY
        belly.append(float(np.abs(a[y0:y1, x0:x1] - b[y0:y1, x0:x1]).mean()))
        whole.append(float((np.abs(a[..., 3] - b[..., 3]) > 64).sum()))
    belly, whole = np.array(belly), np.array(whole)
    worst = np.argsort(belly)[-3:][::-1]
    print(pose, "belly median", round(float(np.median(belly)), 2), "max", round(float(belly.max()), 2), "at", [int(w) + 1 for w in worst], "| outline px median", int(np.median(whole)), "max", int(whole.max()), "at", int(whole.argmax()) + 1)
