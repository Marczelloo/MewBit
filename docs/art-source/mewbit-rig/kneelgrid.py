"""Keys at the drawing's scale and floor with a coordinate grid, for reading off corresponding points. Usage: kneelgrid.py out.jpg per_row name..."""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

from segment import cut_alpha, load

VIEW = (0, 0, 768, 1180)
ZOOM = 0.5


def normal(fit):
    """The key at the drawing's scale on a white page, as (image, alpha)."""
    color, alpha = cut_alpha(load(fit["path"]))
    h, w = alpha.shape
    s = fit["scale"]
    rgba = np.dstack([color, alpha])
    out = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").resize((round(w / s), round(h / s)), Image.LANCZOS)
    page = Image.new("RGBA", (768, 1180), (255, 255, 255, 255))
    page.alpha_composite(out, (max(0, round(fit["shift"][0])), max(0, round(fit["shift"][1])))) if min(fit["shift"]) >= 0 else page.paste(out, (round(fit["shift"][0]), round(fit["shift"][1])), out)
    return page.convert("RGB")


def main():
    out, per_row, names = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
    fits = json.load(open("kneel/fits.json"))
    w, h = round(VIEW[2] * ZOOM), round(VIEW[3] * ZOOM)
    rows = (len(names) + per_row - 1) // per_row
    sheet = Image.new("RGB", (w * per_row, h * rows), "white")
    for i, name in enumerate(names):
        cell = normal(fits[name]).resize((w, h), Image.LANCZOS)
        draw = ImageDraw.Draw(cell)
        for x in range(0, VIEW[2], 100):
            draw.line([(x * ZOOM, 0), (x * ZOOM, h)], fill=(0, 170, 255) if x % 200 == 0 else (190, 225, 255))
            draw.text((x * ZOOM + 1, 0), str(x), fill=(0, 90, 200))
        for y in range(0, VIEW[3], 100):
            draw.line([(0, y * ZOOM), (w, y * ZOOM)], fill=(0, 170, 255) if y % 200 == 0 else (190, 225, 255))
            draw.text((1, y * ZOOM + 1), str(y), fill=(0, 90, 200))
        draw.text((w - 80, 2), name, fill=(220, 0, 0))
        sheet.paste(cell, ((i % per_row) * w, (i // per_row) * h))
    sheet.save(out, quality=88)


if __name__ == "__main__":
    main()
