import numpy as np
from PIL import Image, ImageDraw

from rig import build_layers
from segment import SOURCE, cut_drawing, load

labels = np.load("labels.npy")
silhouette = np.load("body_silhouette.npy")
color, alpha = cut_drawing(load(SOURCE))
layers = build_layers(color, alpha, labels, silhouette)
GREEN = np.array((0.16, 0.63, 0.35))


def layer(name, box, z):
    x0, y0, x1, y1 = box
    a = layers[name][..., 3:4]
    rgb = layers[name][..., :3] + GREEN * (1 - a)
    t = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).crop(box).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
    ImageDraw.Draw(t).text((3, 2), name, fill=(255, 255, 0))
    return t


def frame(f, box, z):
    x0, y0, x1, y1 = box
    bg = Image.new("RGBA", (640, 640), (40, 160, 90, 255))
    bg.alpha_composite(Image.open(f"out/{f:02d}.webp").convert("RGBA"))
    t = bg.crop(box).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS).convert("RGB")
    ImageDraw.Draw(t).text((3, 2), str(f), fill=(255, 255, 0))
    return t


chest_src = (290, 240, 470, 420)
rows = [
    [layer(n, chest_src, 2) for n in ("hairFront", "body")] + [layer(n, (190, 440, 290, 660), 2) for n in ("arm", "jacket")],
    [frame(f, (255, 215, 385, 305), 3) for f in (1, 22, 40, 58)],
    [frame(f, (180, 385, 300, 470), 3) for f in (1, 10, 22, 30, 40, 58)][:4],
]
W = max(sum(t.width + 4 for t in r) for r in rows)
H = sum(max(t.height for t in r) + 4 for r in rows)
s = Image.new("RGB", (W, H), (255, 0, 255))
y = 0
for r in rows:
    x = 0
    for t in r:
        s.paste(t, (x, y))
        x += t.width + 4
    y += max(t.height for t in r) + 4
s.save("check7.jpg", quality=86)
print(s.size)
