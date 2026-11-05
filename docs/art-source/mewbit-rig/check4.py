import numpy as np
from PIL import Image, ImageDraw
from segment import *

F = lambda f: Image.open(f"out/{f:02d}.webp").convert("RGBA")


def crop(f, box, z=3):
    x0, y0, x1, y1 = box
    bg = Image.new("RGBA", (640, 640), (40, 160, 90, 255))
    bg.alpha_composite(F(f))
    t = bg.crop(box).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS).convert("RGB")
    ImageDraw.Draw(t).text((3, 2), str(f), fill=(255, 255, 0))
    return t


rows = [
    [crop(f, (270, 205, 340, 255), 4) for f in (1, 22, 58, 40)],
    [crop(f, (225, 240, 315, 340)) for f in (1, 22, 58, 40)],
    [crop(f, (280, 150, 350, 200), 4) for f in (31, 32, 33, 61)],
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
s.save("check4.jpg", quality=88)
