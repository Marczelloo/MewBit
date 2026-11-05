import numpy as np
from PIL import Image

from segment import SOURCE

labels = np.load("labels.npy")
src = np.asarray(Image.open(SOURCE).convert("RGB")).astype(int)
L = "-bhjH"
purple = (src[..., 0] - src[..., 1] > 38) & (src[..., 2] - src[..., 1] > 38)
print("drawing purple in the box", int(purple[496:522, 534:548].sum()))
for y in range(494, 524, 3):
    print(y, "".join(L[labels[y, x]] for x in range(525, 560)), "".join("P" if purple[y, x] else "." for x in range(525, 560)))
ys, xs = np.nonzero(purple[496:522, 534:548])
print("colour", src[496:522, 534:548][purple[496:522, 534:548]].mean(0))

for f in (1, 14, 17, 22, 40):
    a = np.asarray(Image.open(f"out/{f:02d}.webp").convert("RGBA")).astype(int)[320:350, 385:415]
    p = (a[..., 3] > 128) & (a[..., 0] - a[..., 1] > 40) & (a[..., 2] - a[..., 1] > 40)
    print("frame", f, "purple", int(p.sum()))
