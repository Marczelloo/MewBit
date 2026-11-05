import numpy as np
from PIL import Image, ImageDraw

F = lambda f: Image.open(f"out/{f:02d}.webp").convert("RGBA")


def crop(f, box, z=3):
    x0, y0, x1, y1 = box
    bg = Image.new("RGBA", (640, 640), (40, 160, 90, 255))
    bg.alpha_composite(F(f))
    t = bg.crop(box).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS).convert("RGB")
    ImageDraw.Draw(t).text((3, 2), str(f), fill=(255, 255, 0))
    return t


tiles = [crop(f, (375, 250, 435, 370)) for f in (1, 22, 40, 58)] + [crop(f, (210, 265, 265, 350)) for f in (1, 22)]
s = Image.new("RGB", (sum(t.width + 4 for t in tiles), max(t.height for t in tiles)), (255, 0, 255))
x = 0
for t in tiles:
    s.paste(t, (x, 0))
    x += t.width + 4
s.save("check6.jpg", quality=88)

# Purple that is not the drawing's: strongly saturated violet pixels beside the elbow, frame by frame.
counts = []
for f in range(1, 65):
    a = np.asarray(F(f)).astype(int)[320:345, 385:410]
    purple = (a[..., 3] > 128) & (a[..., 0] - a[..., 1] > 40) & (a[..., 2] - a[..., 1] > 40)
    counts.append(int(purple.sum()))
print("purple by the elbow, max per frame", max(counts), "at", int(np.argmax(counts)) + 1)
