"""python armview.py out.jpg x0,y0,x1,y1 name[...]: per key the outline on the key, the limb alone, and the limb on the drawing's plate."""
import sys

import numpy as np
from PIL import Image, ImageDraw

from armcut import Sheet, cut_key, right_plate
from armcuts import CUTS
from rig import build_layers
from segment import SOURCE, cut_drawing, load

out, box = sys.argv[1], [int(v) for v in sys.argv[2].split(",")]
names = sys.argv[3:]
color, alpha = cut_drawing(load(SOURCE))
layers = build_layers(color, alpha, np.load("labels.npy"), np.load("body_silhouette.npy"))


def over(stack, ground=0.72):
    rgb = np.full(color.shape, ground, np.float32)
    for layer in stack:
        rgb = layer[..., :3] + rgb * (1 - layer[..., 3:4])
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))


w, h = box[2] - box[0], box[3] - box[1]
sheet = Image.new("RGB", (w * 3, h * len(names)), "white")
for row, name in enumerate(names):
    limbs, skeletons, _ = cut_key(name, color, alpha)
    key = Image.fromarray((Sheet(name, color, alpha).drawn * 255).astype(np.uint8))
    d = ImageDraw.Draw(key)
    for side, cut in CUTS[name].items():
        d.line(cut["poly"] + cut["poly"][:1], fill=(255, 0, 0), width=1)
        for i, p in enumerate(cut["poly"]):
            d.text((p[0] + 2, p[1] + 1), str(i), fill=(0, 0, 255))
        s, e, w_ = cut["joints"]
        d.line([s, e, w_], fill=(0, 200, 255), width=2)
    for x in range(box[0] - box[0] % 50 + 50, box[2], 50):
        d.text((x, box[1] + 2), str(x), fill=(0, 140, 0))
        d.line([(x, box[1]), (x, box[1] + 10)], fill=(0, 140, 0))
    for y in range(box[1] - box[1] % 50 + 50, box[3], 50):
        d.text((box[0] + 12, y), str(y), fill=(0, 140, 0))
        d.line([(box[0], y), (box[0] + 10, y)], fill=(0, 140, 0))
    d.text((box[0] + 30, box[1] + 14), name, fill=(255, 0, 255))
    parts = list(limbs.values())
    under = [cut for cut in CUTS[name].items() if not cut[1].get("over")]
    two = "R" in CUTS[name]
    r = right_plate(color, alpha, layers) if two else {"jacket": layers["jacket"]}
    hands = [limbs[k] for k in limbs if k.startswith("hand")]
    parts = [limbs[k] for k in limbs if k.startswith("limb")]
    plate = [layers[k] for k in ("hairBack", "body", "hairFront")] + ([r["under"]] if two else []) + [limbs[f"limb{s}"] for s, _ in under] + [r["jacket"]] + ([r["panel"]] if two else []) + [limbs[f"limb{s}"] for s, c in CUTS[name].items() if c.get("over")] + [layers["head"]] + hands
    sheet.paste(key.crop(box), (0, row * h))
    sheet.paste(over(parts).crop(box), (w, row * h))
    sheet.paste(over(plate, 1.0).crop(box), (2 * w, row * h))
sheet.save(out, quality=88)
print(sheet.size)
