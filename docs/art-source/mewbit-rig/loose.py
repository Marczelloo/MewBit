"""Where the biggest piece off the figure sits in the worst frame of each pose, in frame pixels."""
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = "poses"
for pose in sorted(os.listdir(ROOT)):
    best = (0, 0, None)
    for i, n in enumerate(sorted(os.listdir(os.path.join(ROOT, pose)))):
        mask = np.asarray(Image.open(os.path.join(ROOT, pose, n)).convert("RGBA"))[..., 3] > 127
        labels, count = ndi.label(mask)
        if count < 2:
            continue
        sizes = ndi.sum(mask, labels, range(1, count + 1))
        main = int(np.argmax(sizes)) + 1
        for c in range(1, count + 1):
            if c != main and sizes[c - 1] > best[0]:
                ys, xs = np.nonzero(labels == c)
                best = (int(sizes[c - 1]), i + 1, (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    print(f"{pose:10s} {best[0]:4d}px frame {best[1]:2d} box {best[2]}")
