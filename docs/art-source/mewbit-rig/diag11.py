import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

from segment import BODY, HAIR, HEAD, JACKET, SOURCE, cut_alpha, load

labels = np.load("labels.npy")
color, alpha = cut_alpha(load(SOURCE))
rgb = (np.clip(color, 0, 1) * 255).astype(np.uint8)


def overlay(box, z):
    """The drawing with a thin line along each label's edge: yellow around hair, cyan around the jacket."""
    x0, y0, x1, y1 = box
    t = Image.fromarray(rgb).crop(box).resize(((x1 - x0) * z, (y1 - y0) * z), Image.NEAREST).convert("RGB")
    lab = np.kron(labels[y0:y1, x0:x1], np.ones((z, z), int))
    a = np.asarray(t).copy()
    for value, tint in ((HAIR, (255, 255, 0)), (JACKET, (0, 255, 255))):
        m = lab == value
        a[m & ~ndi.binary_erosion(m)] = tint
    t = Image.fromarray(a)
    d = ImageDraw.Draw(t)
    for x in range(x0 - x0 % 20 + 20, x1, 20):
        d.line([((x - x0) * z, 0), ((x - x0) * z, 6)], fill=(255, 0, 255))
        d.text(((x - x0) * z + 2, 6), str(x), fill=(255, 0, 255))
    for y in range(y0 - y0 % 20 + 20, y1, 20):
        d.line([(0, (y - y0) * z), (6, (y - y0) * z)], fill=(255, 0, 255))
        d.text((8, (y - y0) * z - 5), str(y), fill=(255, 0, 255))
    return t


def frame(f, box, z):
    x0, y0, x1, y1 = box
    bg = Image.new("RGBA", (640, 640), (40, 160, 90, 255))
    bg.alpha_composite(Image.open(f"out/{f:02d}.webp").convert("RGBA"))
    t = bg.crop(box).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS).convert("RGB")
    ImageDraw.Draw(t).text((3, 2), str(f), fill=(255, 255, 0))
    return t


rows = [
    [overlay((285, 230, 470, 410), 4)],
    [overlay((195, 555, 290, 690), 5)] + [frame(f, (245, 205, 385, 300), 3) for f in (1, 22)],
    [frame(f, (245, 205, 385, 300), 3) for f in (40, 58)] + [frame(f, (235, 300, 300, 370), 4) for f in (1, 22)],
]
W = max(sum(t.width + 4 for t in r) for r in rows)
H = sum(max(t.height for t in r) + 4 for r in rows)
s = Image.new("RGB", (W, H), (20, 20, 20))
y = 0
for r in rows:
    x = 0
    for t in r:
        s.paste(t, (x, y))
        x += t.width + 4
    y += max(t.height for t in r) + 4
s.save("diag11.jpg", quality=88)
print(s.size)
