"""Saturated magenta pixels per pose frame and in the drawing itself: the drawing's own hair tips against anything a plate brought in."""
import sys

import numpy as np
from PIL import Image

from segment import SOURCE, load


def magenta(rgb):
    return (rgb[..., 0] > 0.55) & (rgb[..., 2] > 0.55) & (rgb[..., 1] < 0.3)


source = load(SOURCE)
ys, xs = np.nonzero(magenta(source))
print("drawing", len(xs), (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) else None)
for arg in sys.argv[1:]:
    pose, n = arg.split(":")
    image = np.asarray(Image.open(f"poses/{pose}/{int(n):02d}.webp").convert("RGBA")).astype(np.float32) / 255
    ys, xs = np.nonzero(magenta(image[..., :3]) & (image[..., 3] > 0.5))
    print(arg, len(xs), (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) else None)
