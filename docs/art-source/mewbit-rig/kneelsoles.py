"""Where each key's boots stand, in the drawing's coordinates: per side, lowest opaque row and the centre of the sole just above it."""
import sys

import numpy as np

from kneelcore import key_canvas
from rig import PAD
from segment import SOURCE, cut_alpha, load


def soles(alpha, split):
    out = []
    for lo, hi in ((0, split), (split, alpha.shape[1])):
        rows = np.nonzero((alpha[:, lo:hi] > 0.5).sum(1) > 5)[0]
        low = int(rows[-1])
        xs = np.nonzero(alpha[low - 24:low - 4, lo:hi].max(0) > 0.5)[0] + lo
        out.append((low, round(float(xs.mean()), 1), int(xs.min()), int(xs.max())))
    return out


src = load(SOURCE)
print("drawing", soles(cut_alpha(src)[1], 384))
for name in sys.argv[1:]:
    c = key_canvas(name)
    a = c[PAD[1]:PAD[1] + 1152 + 60, PAD[0]:PAD[0] + 768, 3]
    print(name, soles(a, 396))
