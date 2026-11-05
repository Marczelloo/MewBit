import numpy as np
from PIL import Image, ImageDraw
import render
from rig import PAD
from kneelcore import *

scene = render.Scene()
names = ["buckle-37", "buckle-23", "low-41", "land-23"]
cells = []
for name in names:
    k = key_canvas(name)
    for sign in (1, -1):
        p = head_params(name, sign)
        c = over(k, place_head(scene.heads["open"], p))
        rgb = (c[..., :3] + 1 - c[..., 3:])
        x, y = int(p[0] + PAD[0]), int(p[1] + PAD[1])
        im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).crop((x - 170, y - 170, x + 170, y + 170)).resize((255, 255), Image.LANCZOS)
        ImageDraw.Draw(im).text((2, 2), f"{name} {sign}", fill=(255, 0, 0))
        cells.append(im)
sheet = Image.new("RGB", (255 * 4, 255 * 2), "white")
for i, im in enumerate(cells):
    sheet.paste(im, ((i // 2) * 255, (i % 2) * 255))
sheet.save("kneel/headcheck.jpg", quality=88)
