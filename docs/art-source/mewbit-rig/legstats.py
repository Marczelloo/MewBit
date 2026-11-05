"""Stocking colour per key, in Lab by lightness band. Usage: legstats.py name:x0,y0,x1,y1 ... (drawing coordinates on the key's floor)."""
import sys

import numpy as np
from skimage.color import rgb2lab

from kneelcore import key_canvas
from rig import PAD
from segment import SOURCE, load

BANDS = [(5, 15), (15, 25), (25, 35), (35, 50), (50, 70)]


def stats(rgb, box):
    x0, y0, x1, y1 = box
    lab = rgb2lab(rgb[y0:y1, x0:x1])
    row = []
    for lo, hi in BANDS:
        m = (lab[..., 0] >= lo) & (lab[..., 0] < hi)
        row.append(f"{lo:>2}-{hi:<2} n{int(m.sum()):>5} a{lab[..., 1][m].mean() if m.any() else 0:+5.1f} b{lab[..., 2][m].mean() if m.any() else 0:+5.1f}")
    return " | ".join(row)


if __name__ == "__main__":
    src = load(SOURCE) / 255
    print("drawing  ", stats(src, (270, 700, 330, 860)))
    print("drawing2 ", stats(src, (440, 700, 500, 860)))
    for arg in sys.argv[1:]:
        name, box = arg.split(":")
        box = [int(v) for v in box.split(",")]
        c = key_canvas(name)
        a = np.maximum(c[..., 3:4], 1e-4)
        rgb = np.clip(c[..., :3] / a, 0, 1)
        rgb[c[..., 3] < 0.5] = 1
        px, py = PAD
        print(f"{name:9}", stats(rgb, (box[0] + px, box[1] + py, box[2] + px, box[3] + py)))
