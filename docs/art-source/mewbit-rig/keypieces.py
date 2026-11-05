"""Small separate pieces in each cut layer of every key, source pixels."""
import glob

import numpy as np
from scipy import ndimage as ndi

from keys import build_key
from rig import build_layers
from segment import SOURCE, cut_drawing, load

color, alpha = cut_drawing(load(SOURCE))
labels = np.load("labels.npy")
layers = build_layers(color, alpha, labels, np.load("body_silhouette.npy"))
for path in sorted(glob.glob("key-*-7")):
    name = path[4:-2]
    out, limbs, *_ = build_key(name, color, alpha, labels, layers)
    line = []
    for layer in [k for k in out if k.startswith(("limb", "patch"))]:
        regions, count = ndi.label(out[layer][..., 3] > 0.04)
        if count:
            areas = ndi.sum_labels(np.ones(regions.shape), regions, np.arange(1, count + 1))
            boxes = ndi.find_objects(regions)
            small = [(int(areas[i]), boxes[i][1].start, boxes[i][0].start) for i in np.argsort(areas)[::-1]]
            line.append(f"{layer}:{small[:5]}")
    print(name, " | ".join(line), flush=True)
