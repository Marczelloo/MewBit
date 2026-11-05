import numpy as np
from PIL import Image

from segment import NAMES, SOURCE

labels = np.load("labels.npy")
src = np.asarray(Image.open(SOURCE).convert("RGB")).astype(int)
L = "-bhjH"


def row(y, x0, x1):
    print(y, x0, "".join(L[labels[y, x]] for x in range(x0, x1)))
    print("     lum", "".join(str(min(9, int(src[y, x].mean() / 26))) for x in range(x0, x1)))


# The stripe that parts from the jacket's right edge: game (402-416, 268-297).
for y in range(360, 450, 15):
    row(y, 530, 600)
# The purple bit by the elbow: source around (548, 557).
for y in range(530, 600, 10):
    row(y, 520, 600)
