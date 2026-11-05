"""Where each key's arm cut still holds the jacket's cyan trim, which must not travel with the arm."""
import numpy as np
from scipy import ndimage as ndi

from armcut import cut_key
from armcuts import CUTS
from segment import SOURCE, cut_drawing, load

color, alpha = cut_drawing(load(SOURCE))
for name in CUTS:
    if name in ("both_out", "both_wide"):
        continue
    layers, _, _ = cut_key(name, color, alpha)
    for key in layers:
        if not key.startswith("limb"):
            continue
        layer = layers[key]
        a = np.maximum(layer[..., 3], 1e-4)
        rgb = layer[..., :3] / a[..., None]
        cyan = (a > 0.5) & (rgb[..., 2] - rgb[..., 0] > 0.3) & (rgb[..., 1] > 0.4)
        regions, count = ndi.label(cyan, np.ones((3, 3)))
        boxes = ndi.find_objects(regions)
        big = [(int((regions[b] == i + 1).sum()), b[1].start, b[0].start, b[1].stop, b[0].stop) for i, b in enumerate(boxes)]
        big = sorted([b for b in big if b[0] >= 6], reverse=True)[:5]
        print(name, key, int(cyan.sum()), big)
