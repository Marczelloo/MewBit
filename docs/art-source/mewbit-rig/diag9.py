import numpy as np
from PIL import Image

from segment import SOURCE

src = Image.open(SOURCE).convert("RGB")
drawing = np.asarray(src.resize((int(768 * 0.485), int(1152 * 0.485)), Image.LANCZOS)).astype(int)
# Game x = (x_src - 383.5) * 0.485 + 320 maps onto the resized drawing with these shifts.
dx = round(320 - 383.5 * 0.485)
dy = round(632 - 1126 * 0.485)


def purple(a):
    return (a[..., 0] - a[..., 1] > 25) & (a[..., 2] - a[..., 1] > 25)


box = (385, 322, 415, 352)
crop = drawing[box[1] - dy : box[3] - dy, box[0] - dx : box[2] - dx]
print("drawing at game scale, purple", int(purple(crop).sum()))
for f in (1, 8, 14, 17, 22, 32, 40, 58):
    a = np.asarray(Image.open(f"out/{f:02d}.webp").convert("RGBA")).astype(int)
    c = a[box[1] : box[3], box[0] : box[2]]
    p = purple(c) & (c[..., 3] > 128)
    ys, xs = np.nonzero(p)
    where = (int(xs.min() + box[0]), int(xs.max() + box[0]), int(ys.min() + box[1]), int(ys.max() + box[1])) if len(xs) else None
    print("frame", f, "purple", int(p.sum()), where, "peak saturation", int((c[..., 0] - c[..., 1])[p].max()) if len(xs) else 0)
