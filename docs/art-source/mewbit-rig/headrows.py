"""How wide the drawing's head layer is per row, to choose where a key's own head can be erased under it."""
import numpy as np

import render
from kneel import pained

scene = render.Scene()
pained(scene)
print(list(scene.heads))
a = scene.heads["wince"][..., 3]
print(a.shape)
for y in range(0, 420, 20):
    xs = np.nonzero(a[y] > 0.5)[0]
    print(y, (int(xs.min()), int(xs.max())) if len(xs) else None)
rows = np.nonzero((a > 0.5).sum(1))[0]
print("rows", rows[0], rows[-1])
