"""Bigger keys with a finer grid, for reading landmarks. Usage: kneelzoom.py out.jpg zoom ytop name..."""
import json
import sys

from PIL import Image, ImageDraw

from kneelgrid import normal

out, zoom, top, names = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
fits = json.load(open("kneel/fits.json"))
w, h = round(768 * zoom), round((1180 - top) * zoom)
sheet = Image.new("RGB", (w * len(names), h), "white")
for i, name in enumerate(names):
    print(name, fits[name]["scale"], [round(v) for v in fits[name]["head"]], [round(v) for v in fits[name]["shift"]])
    page = normal(fits[name]).crop((0, top, 768, 1180)).resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(page)
    for x in range(0, 768, 50):
        d.line([(x * zoom, 0), (x * zoom, h)], fill=(0, 170, 255) if x % 100 == 0 else (190, 225, 255))
        if x % 100 == 0:
            d.text((x * zoom + 1, 1), str(x), fill=(0, 90, 200))
    for y in range(top - top % 50 + 50, 1180, 50):
        d.line([(0, (y - top) * zoom), (w, (y - top) * zoom)], fill=(0, 170, 255) if y % 100 == 0 else (190, 225, 255))
        if y % 100 == 0:
            d.text((1, (y - top) * zoom + 1), str(y), fill=(0, 90, 200))
    d.text((w - 70, 12), name, fill=(200, 0, 0))
    sheet.paste(page, (i * w, 0))
sheet.save(out, quality=88)
