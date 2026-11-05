"""The rig's opening of the fall at source scale, saved for reading points off it."""
import numpy as np
from PIL import Image, ImageDraw
import rig, render
from anims import ANIMS
from rig import PAD

render.to_game = lambda c: c
render.drop_specks = lambda c: c
scene = render.Scene()
anim = ANIMS["crushed"]()
rig.M = anim
out = []
for f in (0, 6):
    c = np.asarray(render.render_frame(anim, f, scene))
    print(f, c.shape)
    a = c[..., 3:]
    rgb = c[..., :3] + (1 - a)
    x, y = PAD
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    out.append(im.crop((x, y, x + 768, y + 1152)))
w, h = 384, 576
sheet = Image.new("RGB", (w * 2, h), "white")
for i, im in enumerate(out):
    cell = im.resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(cell)
    for v in range(0, 768, 100):
        d.line([(v / 2, 0), (v / 2, h)], fill=(190, 225, 255))
        d.text((v / 2 + 1, 0), str(v), fill=(0, 90, 200))
    for v in range(0, 1152, 100):
        d.line([(0, v / 2), (w, v / 2)], fill=(190, 225, 255))
        d.text((1, v / 2 + 1), str(v), fill=(0, 90, 200))
    sheet.paste(cell, (i * w, 0))
sheet.save("kneel/rig.jpg", quality=88)
