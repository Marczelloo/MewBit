"""python handdebug.py out.jpg name side: a key's hand as drawn, its cut alpha, and its segmentation."""
import glob
import sys

import numpy as np
from PIL import Image

from keys import aligned, hands_of, segmap_of
from segment import SOURCE, cut_alpha, cut_drawing, load

out, name, side = sys.argv[1:4]
color, alpha = cut_drawing(load(SOURCE))
drawing = color * alpha[..., None] + 1 - alpha[..., None]
key, shift = aligned(sorted(glob.glob(f"key-{name}-7/*.png"))[0], drawing)
seg = np.roll(segmap_of(name, color.shape), shift, (0, 1))
hx, hy = hands_of(name, seg)[side]
_, key_alpha = cut_alpha(key * 255)
print(name, side, "hand", round(hx), round(hy))
x0, y0 = max(int(hx) - 100, 0), max(int(hy) - 100, 0)
box = (slice(y0, y0 + 200), slice(x0, x0 + 200))
panels = [key[box] * 255, np.repeat(key_alpha[box][..., None], 3, 2) * 255, seg[box]]
Image.fromarray(np.hstack(panels).clip(0, 255).astype(np.uint8)).resize((900, 300)).save(out, quality=80)
