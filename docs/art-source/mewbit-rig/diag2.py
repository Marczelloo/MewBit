import numpy as np
from PIL import Image
import rig
from segment import *
original = load(SOURCE)
color, alpha = cut_alpha(original)
labels = np.load("labels.npy")
sil = np.load("body_silhouette.npy")
L = rig.build_layers(color, alpha, labels, sil)
bg = np.array([.2, .75, .3])
tiles = []
for name in ("hairBack", "body", "hairFront", "jacket"):
    l = L[name]
    im = l[..., :3] + bg * (1 - l[..., 3:4])
    tiles.append(Image.fromarray((im * 255).astype(np.uint8)).crop((150, 230, 620, 760)).resize((376, 424), Image.LANCZOS))
s = Image.new("RGB", (376 * 4, 424))
for i, t in enumerate(tiles):
    s.paste(t, (i * 376, 0))
s.save("layers.jpg", quality=84)
heads = rig.head_variants(color, L["head"])
s = Image.new("RGB", (906, 426), (255, 0, 255))
for i, st in enumerate(("open", "lid1", "lid2", "closed")):
    h = heads[st]
    im = h[..., :3] + np.array([.09, .1, .13]) * (1 - h[..., 3:4])
    e = Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).crop((320, 140, 470, 210)).resize((450, 210), Image.LANCZOS)
    s.paste(e, ((i % 2) * 456, (i // 2) * 216))
s.save("eyes.jpg", quality=88)
