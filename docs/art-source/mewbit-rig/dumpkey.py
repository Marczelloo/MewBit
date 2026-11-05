"""python dumpkey.py out.jpg name[...]: each key's limbs and patch on grey, source pixels."""
import sys

import numpy as np
from PIL import Image

from render import Scene
from rig import to_image

scene = Scene()
out = sys.argv[1]
rows = []
for name in sys.argv[2:]:
    layers = scene.key(name)[0]
    row = Image.new("RGB", (4 * 300, 400), (128, 128, 128))
    for i, part in enumerate(["limbL", "limbR", "patch", "patchHair"]):
        if part not in layers:
            continue
        image = to_image(layers[part]).convert("RGBA").crop((90, 60, 690, 860)).resize((300, 400), Image.LANCZOS)
        row.paste(image, (i * 300, 0), image)
    rows.append(row)
sheet = Image.new("RGB", (1200, 400 * len(rows)))
for i, row in enumerate(rows):
    sheet.paste(row, (0, 400 * i))
sheet.save(out, quality=82)
