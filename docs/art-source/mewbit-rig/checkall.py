"""Numbers for every rendered pose: size, how far a hold pose ends from the drawing, largest detached piece, loop seam."""
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = "poses"
HOLD = ["miss", "crushed", "milestone", "emerge", "reveal", "go", "newbest"]
FPS = {"neutral": 16, "vibe1": 24, "vibe2": 24, "vibe3": 24, "miss": 24, "crushed": 24, "milestone": 24, "fever": 24, "charting": 12, "emerge": 24, "reveal": 24, "stretch": 16, "adjust": 16, "peek": 16, "hype": 24, "go": 24, "cheer": 24, "okay": 12, "sad": 12, "newbest": 24}


def load(pose, name):
    return np.asarray(Image.open(os.path.join(ROOT, pose, name)).convert("RGBA")).astype(np.float32) / 255


def flat(a):
    return a[..., :3] * a[..., 3:] + (1 - a[..., 3:])


total = 0
rest = None
for pose in sorted(os.listdir(ROOT)):
    names = sorted(os.listdir(os.path.join(ROOT, pose)))
    size = sum(os.path.getsize(os.path.join(ROOT, pose, n)) for n in names)
    total += size
    worst_loose, worst_at, worst_top, worst_bottom = 0, 0, 640, 0
    previous = None
    jump, jump_at = 0, 0
    for i, n in enumerate(names):
        a = load(pose, n)
        mask = a[..., 3] > 0.5
        labels, count = ndi.label(mask)
        if count > 1:
            sizes = ndi.sum(mask, labels, range(1, count + 1))
            loose = int(sizes.sum() - sizes.max())
            if loose > worst_loose:
                worst_loose, worst_at = loose, i + 1
        ys = np.nonzero(mask.any(1))[0]
        worst_top, worst_bottom = min(worst_top, int(ys[0])), max(worst_bottom, int(ys[-1]))
        if previous is not None:
            d = float(np.abs(flat(a) - previous).mean())
            if d > jump:
                jump, jump_at = d, i + 1
        previous = flat(a)
    seam = float(np.abs(flat(load(pose, names[0])) - previous).mean())
    print(f"{pose:10s} {len(names):3d}f {len(names)/FPS[pose]:5.2f}s {size/1e6:5.2f}MB loose {worst_loose:4d}px@{worst_at:<2d} y {worst_top}-{worst_bottom} biggest step {jump:.4f}@{jump_at:<2d} end-to-start {seam:.4f}")
print("total", round(total / 1e6, 2), "MB")

rest = flat(load("emerge", sorted(os.listdir(os.path.join(ROOT, "emerge")))[-1]))
reveal = flat(load("reveal", "01.webp"))
print("emerge last vs reveal first", round(float(np.abs(rest - reveal).mean()), 5), "max", round(float(np.abs(rest - reveal).max()), 3))
neutral = flat(load("neutral", "01.webp"))
print("neutral 01 vs reveal first", round(float(np.abs(neutral - reveal).mean()), 5))
for pose in HOLD:
    last = sorted(os.listdir(os.path.join(ROOT, pose)))[-1]
    a, b = flat(load(pose, last)), flat(load(pose, f"{int(last[:2]) - 1:02d}.webp"))
    print(f"{pose:10s} last two frames differ {float(np.abs(a - b).mean()):.5f}")
