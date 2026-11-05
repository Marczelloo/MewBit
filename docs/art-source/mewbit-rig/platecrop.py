"""python platecrop.py out.png x0,y0,x1,y1 scale layer...: what the base layers leave behind, without the arm."""
import sys
import numpy as np
from PIL import Image
from rig import build_layers
from segment import SOURCE, cut_drawing, load
out, box, scale = sys.argv[1], [int(v) for v in sys.argv[2].split(",")], int(sys.argv[3])
color, alpha = cut_drawing(load(SOURCE))
layers = build_layers(color, alpha, np.load("labels.npy"), np.load("body_silhouette.npy"))
rgb = np.full(color.shape, 0.72, np.float32)
for k in sys.argv[4:]:
    rgb = layers[k][..., :3] + rgb * (1 - layers[k][..., 3:4])
im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).crop(box)
im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(out)
print(im.size)
