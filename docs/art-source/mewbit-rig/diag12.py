import numpy as np
from PIL import Image, ImageDraw

from segment import SOURCE, load

rgb = load(SOURCE).astype(np.uint8)
x0, y0, x1, y1 = 170, 280, 350, 680
z = 3
# Lift the darks so the folds between sleeve and panel can be read.
lifted = (255 * (rgb / 255.0) ** 0.55).astype(np.uint8)
t = Image.fromarray(lifted).crop((x0, y0, x1, y1)).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
d = ImageDraw.Draw(t)
for x in range(x0 - x0 % 20 + 20, x1, 20):
    d.line([((x - x0) * z, 0), ((x - x0) * z, (y1 - y0) * z)], fill=(255, 255, 0) if x % 100 == 0 else (120, 120, 40))
    d.text(((x - x0) * z + 2, 2), str(x), fill=(255, 255, 0))
for y in range(y0 - y0 % 20 + 20, y1, 20):
    d.line([(0, (y - y0) * z), ((x1 - x0) * z, (y - y0) * z)], fill=(255, 255, 0) if y % 100 == 0 else (120, 120, 40))
    d.text((2, (y - y0) * z + 1), str(y), fill=(255, 255, 0))
t.save("diag12.jpg", quality=88)
print(t.size)
