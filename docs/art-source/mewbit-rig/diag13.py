import numpy as np

from segment import JACKET, SOURCE, cut_alpha, load

labels = np.load("labels.npy")
original = load(SOURCE)
color, alpha = cut_alpha(original)
luma = original @ np.array([0.3, 0.59, 0.11]) / 255


def code(y, x):
    """. background, s skin or pale, g grey, # ink, c cyan; upper case where the mask says jacket is not relevant."""
    if alpha[y, x] < 0.5:
        return "."
    r, g, b = original[y, x]
    if b - r > 40:
        return "c"
    if luma[y, x] > 0.62:
        return "s"
    if luma[y, x] > 0.3:
        return "g"
    return "#"


print("hand, x from 205")
for y in range(560, 676, 4):
    print(y, "".join(code(y, x) for x in range(205, 270)))
print("sleeve, x from 195")
for y in range(440, 590, 10):
    print(y, "".join(code(y, x) for x in range(195, 300)))
x0, y0, x1, y1 = 305, 330, 320, 368
print("mesh hole box: transparent", int((alpha[y0:y1, x0:x1] < 1).sum()), "of", (x1 - x0) * (y1 - y0))
near = alpha[320:380, 295:330] < 1
ys, xs = np.nonzero(near)
print("wider window", int(near.sum()), "x", xs.min() + 295, xs.max() + 295, "y", ys.min() + 320, ys.max() + 320)
