import numpy as np
from PIL import Image

from rig import build_layers
from segment import SOURCE, cut_alpha, load

labels = np.load("labels.npy")
silhouette = np.load("body_silhouette.npy")
original = load(SOURCE)
color, alpha = cut_alpha(original)
layers = build_layers(color, alpha, labels, silhouette)
GREEN = np.array((0.16, 0.63, 0.35))


def show(layer, box, z):
    x0, y0, x1, y1 = box
    a = layer[..., 3:4]
    rgb = layer[..., :3] + GREEN * (1 - a)
    t = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).crop(box)
    return t.resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)


def tile(name, box, z):
    if name == "src":
        return Image.fromarray((np.clip(color, 0, 1) * 255).astype(np.uint8)).crop(box).resize(((box[2] - box[0]) * z, (box[3] - box[1]) * z), Image.LANCZOS)
    return show(layers[name], box, z)


chest = (270, 230, 500, 430)
arm = (170, 480, 340, 720)
rows = [
    [tile(n, chest, 2) for n in ("src", "hairBack", "hairFront", "body")],
    [tile(n, arm, 2) for n in ("src", "jacket", "body", "hairBack")],
]
W = max(sum(t.width + 4 for t in r) for r in rows)
H = sum(r[0].height + 4 for r in rows)
s = Image.new("RGB", (W, H), (255, 0, 255))
y = 0
for r in rows:
    x = 0
    for t in r:
        s.paste(t, (x, y))
        x += t.width + 4
    y += r[0].height + 4
s.save("diag10.jpg", quality=88)
print(s.size)
