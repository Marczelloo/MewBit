"""Frame-to-frame change of each pose in thousandths, the last value being the step from the end back to the start."""
import os
import sys

import numpy as np
from PIL import Image

ROOT = "poses"


def flat(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255
    return a[..., :3] * a[..., 3:] + (1 - a[..., 3:])


for pose in sys.argv[1:] or sorted(os.listdir(ROOT)):
    names = sorted(os.listdir(os.path.join(ROOT, pose)))
    frames = [flat(os.path.join(ROOT, pose, n)) for n in names]
    steps = [round(float(np.abs(frames[(i + 1) % len(frames)] - frames[i]).mean()) * 1000) for i in range(len(frames))]
    print(pose, " ".join(map(str, steps)))
