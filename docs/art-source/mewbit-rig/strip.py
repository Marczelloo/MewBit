"""All frames of a pose on one sheet. Usage: strip.py out.jpg pose per_row cell [first last]"""
import glob
import os
import sys

from PIL import Image, ImageDraw

out, pose, per_row, cell = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
paths = sorted(glob.glob(os.path.join("poses", pose, "*.webp")))
if len(sys.argv) > 5:
    paths = paths[int(sys.argv[5]) - 1 : int(sys.argv[6])]
rows = (len(paths) + per_row - 1) // per_row
sheet = Image.new("RGB", (cell * per_row, cell * rows), (40, 42, 60))
for i, path in enumerate(paths):
    im = Image.open(path).convert("RGBA").resize((cell, cell), Image.LANCZOS)
    sheet.paste(im, ((i % per_row) * cell, (i // per_row) * cell), im)
    ImageDraw.Draw(sheet).text(((i % per_row) * cell + 2, (i // per_row) * cell + 1), os.path.basename(path)[:2], fill=(255, 255, 0))
sheet.save(out, quality=86)
