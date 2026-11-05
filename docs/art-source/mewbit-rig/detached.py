"""python detached.py [pose...]: pieces of each rendered frame that do not touch the figure, and holes in it."""
import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def report(pose):
    worst = []
    paths = sorted(glob.glob(os.path.join("poses", pose, "*.webp")))
    for path in paths:
        alpha = np.asarray(Image.open(path).convert("RGBA"))[..., 3] > 40
        regions, count = ndi.label(alpha, structure=np.ones((3, 3)))
        if count > 1:
            areas = ndi.sum_labels(alpha, regions, np.arange(1, count + 1))
            order = np.argsort(areas)[::-1]
            boxes = ndi.find_objects(regions)
            for i in order[1:]:
                box = boxes[i]
                worst.append((os.path.basename(path)[:2], int(areas[i]), box[1].start, box[0].start))
    pieces = sorted(worst, key=lambda v: -v[1])[:6]
    print(pose, len(paths), "frames,", len(worst), "detached:", pieces, flush=True)


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(os.listdir("poses"))
    for name in names:
        report(name)
