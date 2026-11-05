import glob

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

paths = sorted(glob.glob("out/*.webp"))
frames = [Image.open(p).convert("RGBA") for p in paths]
alphas = [np.asarray(f)[..., 3] > 128 for f in frames]


def holes(a):
    return ndi.binary_fill_holes(a) & ~a


rest_holes = holes(alphas[0]).sum()
hole_counts = [int(holes(a).sum()) for a in alphas]
pieces = []
for a in alphas:
    lab, n = ndi.label(a)
    sizes = ndi.sum(a, lab, range(1, n + 1))
    pieces.append(int(np.sort(sizes)[-2]) if n > 1 else 0)
print("enclosed holes rest", int(rest_holes), "max", max(hole_counts), "at frame", int(np.argmax(hole_counts)) + 1)
print("largest detached piece", max(pieces), "at frame", int(np.argmax(pieces)) + 1)
heights = [int(np.ptp(np.nonzero(a.any(1))[0])) + 1 for a in alphas]
print("height", min(heights), max(heights))
for frame in (0, 21, int(np.argmax(hole_counts))):
    lab, n = ndi.label(holes(alphas[frame]))
    objs = ndi.find_objects(lab)
    big = sorted(((int((lab[o] == i + 1).sum()), o) for i, o in enumerate(objs)), key=lambda t: -t[0])[:5]
    print("holes frame", frame + 1, [(s, o[1].start, o[0].start, o[1].stop, o[0].stop) for s, o in big])
lab, n = ndi.label(alphas[3])
objs = ndi.find_objects(lab)
print("pieces frame 4", sorted((int((lab[o] == i + 1).sum()), o[1].start, o[0].start) for i, o in enumerate(objs))[:-1][-4:])


def crop(frame, box, zoom=3):
    x0, y0, x1, y1 = box
    bg = Image.new("RGBA", frames[0].size, (34, 36, 44, 255))
    bg.alpha_composite(frames[frame - 1])
    t = bg.crop(box).resize(((x1 - x0) * zoom, (y1 - y0) * zoom), Image.LANCZOS).convert("RGB")
    ImageDraw.Draw(t).text((3, 2), str(frame), fill=(255, 255, 0))
    return t


# Game coordinates: x_game = (x_src - 383.5) * 0.485 + 320, y_game = (y_src - 1126) * 0.485 + 632.
rows = [
    [crop(22, (190, 200, 340, 340)), crop(58, (230, 90, 380, 230)), crop(22, (320, 210, 440, 350)), crop(40, (320, 210, 440, 350))],
    [crop(f, (270, 60, 370, 110), 3) for f in (31, 32, 33, 34)],
    [crop(f, (270, 60, 370, 110), 3) for f in (59, 60, 61, 62)],
]
width = max(sum(t.width + 4 for t in row) for row in rows)
height = sum(max(t.height for t in row) + 4 for row in rows)
sheet = Image.new("RGB", (width, height), (255, 0, 255))
y = 0
for row in rows:
    x = 0
    for t in row:
        sheet.paste(t, (x, y))
        x += t.width + 4
    y += max(t.height for t in row) + 4
sheet.save("check.jpg", quality=88)
print(sheet.size)
