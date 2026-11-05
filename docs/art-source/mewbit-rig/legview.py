"""The drawing's body layer from the shorts down with a grid in the drawing's pixels, and the legs' extent per row."""
import numpy as np
from PIL import Image, ImageDraw

import render

scene = render.Scene()
body = scene.layers["body"]
a = body[..., 3]
for y in range(600, 1130, 20):
    row = np.nonzero(a[y] > 0.5)[0]
    runs = np.split(row, np.nonzero(np.diff(row) > 1)[0] + 1) if len(row) else []
    print(y, [(int(r[0]), int(r[-1])) for r in runs if len(r) > 2])
x0, y0, x1, y1 = 180, 600, 600, 1140
crop = body[y0:y1, x0:x1]
bg = np.array([0.35, 0.36, 0.42])
rgb = crop[..., :3] + bg * (1 - crop[..., 3:])
im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).convert("RGB")
d = ImageDraw.Draw(im)
for y in range(y0 - y0 % 100 + 100, y1, 100):
    d.line([(0, y - y0), (x1 - x0, y - y0)], fill=(255, 255, 0), width=1)
    d.text((2, y - y0 + 1), str(y), fill=(255, 255, 0))
for x in range(x0 - x0 % 100 + 100, x1, 100):
    d.line([(x - x0, 0), (x - x0, y1 - y0)], fill=(255, 255, 0), width=1)
    d.text((x - x0 + 2, 2), str(x), fill=(255, 255, 0))
im.save("kneel/legview.jpg", quality=88)
