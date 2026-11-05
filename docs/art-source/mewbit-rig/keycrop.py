"""python keycrop.py out.jpg x0,y0,x1,y1 name [name...]: the same source box of several raw key drawings, labelled by order."""
import glob
import sys

import numpy as np
from PIL import Image

out, box = sys.argv[1:3]
x0, y0, x1, y1 = map(int, box.split(","))
cells = []
for name in sys.argv[3:]:
    image = Image.open(sorted(glob.glob(f"key-{name}-7/*.png"))[0]).convert("RGB").resize((768, 1152))
    cells.append(np.asarray(image.crop((x0, y0, x1, y1))))
Image.fromarray(np.hstack(cells)).save(out, quality=80)
print(out, [c.shape[:2] for c in cells][:1], sys.argv[3:])
