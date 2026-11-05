"""How light each key's cut sleeve is against the drawing's own sleeve: keys that differ read as the arm changing colour mid-move."""
import numpy as np
from scipy import ndimage as ndi

from armcut import Sheet, cut_key, polygon
from armcuts import CUTS
from segment import SOURCE, cut_drawing, load

WEIGHTS = np.array([0.3, 0.59, 0.11])
color, alpha = cut_drawing(load(SOURCE))
DRAWN = polygon([(150, 440), (262, 440), (262, 590), (150, 590)], alpha.shape) & (alpha > 0.9)
light = color @ WEIGHTS
sleeve = light[DRAWN & (light < 0.45)]
print("drawing", np.round(np.percentile(sleeve, [10, 25, 50, 75, 90]), 3), "dark share", round(float((sleeve < 0.12).mean()), 3))
for name in CUTS:
    if name in ("both_out", "both_wide"):
        continue
    layers, _, _ = cut_key(name, color, alpha)
    for key in layers:
        if not key.startswith("limb"):
            continue
        layer = layers[key]
        a = layer[..., 3]
        rgb = layer[..., :3] / np.maximum(a, 1e-4)[..., None]
        value = rgb @ WEIGHTS
        inner = ndi.binary_erosion(a > 0.9, iterations=3)
        cloth = value[inner & (value < 0.45)]
        print(name, key, np.round(np.percentile(cloth, [10, 25, 50, 75, 90]), 3), "dark share", round(float((cloth < 0.12).mean()), 3))
