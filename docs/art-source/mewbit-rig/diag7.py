import numpy as np
from PIL import Image

from rig import build_layers
from segment import SOURCE, cut_alpha, load

labels = np.load("labels.npy")
silhouette = np.load("body_silhouette.npy")
source = load(SOURCE)
color, alpha = cut_alpha(source)
layers = build_layers(color.astype(np.float64) / 255 if color.max() > 1 else color, alpha, labels, silhouette)

L = "-bhjH"
for name in ("hairBack", "body"):
    layer = layers[name]
    a = layer[..., 3]
    rgb = layer[..., :3] / np.maximum(a[..., None], 1e-3)
    purple = (a > 0.5) & (rgb[..., 0] - rgb[..., 1] > 0.15) & (rgb[..., 2] - rgb[..., 1] > 0.15)
    box = purple[470:600, 500:600]
    ys, xs = np.nonzero(box)
    print(name, "purple px", len(ys), "x", (xs.min() + 500, xs.max() + 500) if len(xs) else None, "y", (ys.min() + 470, ys.max() + 470) if len(ys) else None)
    if len(ys):
        vals, counts = np.unique(labels[470:600, 500:600][box], return_counts=True)
        print("  on labels", {L[v]: int(c) for v, c in zip(vals, counts)})

frame = np.asarray(Image.open("out/14.webp").convert("RGBA")).astype(int)
crop = frame[315:350, 380:415]
purple = (crop[..., 3] > 128) & (crop[..., 0] - crop[..., 1] > 40) & (crop[..., 2] - crop[..., 1] > 40)
ys, xs = np.nonzero(purple)
print("frame 14 purple game x", xs.min() + 380, xs.max() + 380, "y", ys.min() + 315, ys.max() + 315)
