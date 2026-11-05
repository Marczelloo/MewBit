"""Cuts each picked painting into pixel-aligned light layers: base (lights down), neon (coloured accents), lit (every light source), glow (soft bloom) and fever (hot regrade)."""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 2560, 1440

# neon: chroma and value ranges of a coloured light. bright: local contrast and value of a pale one. dim: how far the lights go down in the base.
# only: rectangles in 0..1 (x0, y0, x1, y1), the sole places a light can be. no: rectangles where none can. fill: lights with no holes, such as a moon or a poster panel.
# panel: glowing panels, taken whole by brightness. sat: a light must be at least this saturated. steady: lights that never go fully down, such as the moon.
# spot_max: largest blob, as a share of the picture, that can still be a light. bloom: strength of the glow. tint and hot: the fever colour and its amount.
DEFAULT = dict(neon=(0.34, 0.52, 0.42, 0.62), bright=(0.14, 0.26, 0.5, 0.72), dim=0.55, only=(), no=(), fill=(), panel=(), sat=None, steady=(), spot_max=0.03, bloom=1.0, tint=(1.0, 0.22, 0.66), hot=0.42)
SCENES = {
    "01-dach-s22": dict(only=((0.125, 0.0, 0.875, 0.555), (0.0, 0.0, 0.125, 0.25), (0.875, 0.0, 1.0, 0.25)), fill=((0.15, 0.02, 0.29, 0.24),), steady=((0.15, 0.02, 0.29, 0.24),)),
    "02-klub-s22": dict(no=((0.0, 0.62, 1.0, 1.0),)),
    "03-pokoj-s22": dict(only=((0.0, 0.0, 1.0, 0.2), (0.08, 0.36, 0.31, 0.56)), fill=((0.1, 0.38, 0.3, 0.52),), bloom=1.2),
    "04-arcade-s22": dict(bloom=0.5, dim=0.5),
    "05-zaulek-s22": dict(bloom=0.8),
    "06-metro-s22": dict(only=((0.0, 0.0, 1.0, 0.24), (0.05, 0.28, 0.17, 0.62), (0.83, 0.28, 0.95, 0.62)), no=((0.075, 0.125, 0.195, 0.28), (0.805, 0.125, 0.925, 0.28)), panel=((0.068, 0.298, 0.162, 0.6), (0.852, 0.29, 0.948, 0.61)), spot_max=0.06, bloom=0.5),
    "07-glitch-s11": dict(bloom=0.7),
    "08-swit-s22": dict(only=((0.0, 0.0, 1.0, 0.62),), sat=(0.55, 0.7), spot_max=0.004, bloom=1.3, tint=(1.0, 0.3, 0.45)),
}


def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def load(name):
    path = glob.glob(os.path.join(HERE, "up", name, "*.png"))[0]
    image = Image.open(path).convert("RGB")
    w, h = image.size
    keep = round(w * 9 / 16)
    # The bottom stays: the floor is what the stage pins.
    image = image.crop((0, h - keep, w, h)).resize((W, H), Image.LANCZOS)
    return np.asarray(image, np.float32) / 255


def drop_blobs(mask, lo, hi):
    """Takes out specks of hatching and regions too big to be a lamp, such as a whole pale sky."""
    labels, count = ndi.label(mask > 0.25)
    if not count:
        return mask
    sizes = ndi.sum(np.ones_like(labels), labels, range(1, count + 1))
    bad = np.nonzero((sizes < lo) | (sizes > hi))[0] + 1
    out = mask.copy()
    out[np.isin(labels, bad)] = 0
    return out


def masks(p, cfg):
    v = p.max(2)
    chroma = v - p.min(2)
    around = ndi.gaussian_filter(v, 70)
    c0, c1, v0, v1 = cfg["neon"]
    neon = smooth(chroma, c0, c1) * smooth(v, v0, v1)
    l0, l1, b0, b1 = cfg["bright"]
    pale = smooth(v - around, l0, l1) * smooth(v, b0, b1)
    if cfg["sat"]:
        tone = smooth(chroma / np.maximum(v, 1e-3), *cfg["sat"])
        neon = neon * tone
        pale = pale * tone
    limit = cfg["spot_max"] * W * H
    neon = drop_blobs(neon, 60, limit)
    lit = drop_blobs(np.maximum(neon, pale), 60, limit)
    rows, cols = np.mgrid[0:H, 0:W].astype(np.float32)
    def inside(x0, y0, x1, y1):
        return (cols >= x0 * W) & (cols <= x1 * W) & (rows >= y0 * H) & (rows <= y1 * H)
    for x0, y0, x1, y1 in cfg["fill"]:
        box = inside(x0, y0, x1, y1)
        solid = ndi.binary_fill_holes(ndi.binary_closing(lit > 0.25, iterations=14) & box)
        lit[solid] = 1
    for x0, y0, x1, y1 in cfg["panel"]:
        solid = ndi.binary_fill_holes(ndi.binary_opening((v > 0.42) & inside(x0, y0, x1, y1), iterations=3))
        lit[solid] = 1
    if cfg["only"]:
        keep = np.zeros((H, W), bool)
        for rect in cfg["only"]:
            keep |= inside(*rect)
        neon[~keep] = 0
        lit[~keep] = 0
    for rect in cfg["no"]:
        off = inside(*rect)
        neon[off] = 0
        lit[off] = 0
    return ndi.gaussian_filter(neon, 1.1), ndi.gaussian_filter(lit, 1.1)


def rgba(colour, alpha):
    return Image.fromarray((np.clip(np.dstack([colour, alpha]), 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def build(name):
    cfg = {**DEFAULT, **SCENES[name]}
    p = load(name)
    neon, lit = masks(p, cfg)
    amount = np.full((H, W, 1), cfg["dim"], np.float32)
    for x0, y0, x1, y1 in cfg["steady"]:
        amount[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] *= 0.3
    base = p * (1 - amount * lit[..., None])

    # A little past the painting, with a hot core, so a beat reads as a light turning up.
    boosted = np.clip(p * 1.12, 0, 1)
    boosted = boosted + (1 - boosted) * (smooth(p.max(2), 0.8, 1.0) * 0.35)[..., None]

    # Bloom: the lights blurred wide. The colour stays full and alpha carries the falloff, so it does not grey out.
    light = p * lit[..., None]
    small = np.asarray(Image.fromarray((np.clip(light, 0, 1) * 255).astype(np.uint8)).resize((960, 540), Image.BOX), np.float32) / 255
    wide = sum(ndi.gaussian_filter(small, (s, s, 0)) * g for s, g in ((7, 0.9), (22, 1.5)))
    strength = wide.max(2)
    glow_colour = wide / np.maximum(strength, 1e-3)[..., None]
    glow_alpha = np.clip(strength * 1.5 * cfg["bloom"], 0, 0.85)

    # Fever: colours pushed and the light itself turned hot, in proportion to how bright a pixel is, so the blacks stay black. The floor keeps more of its own colour.
    lum = (p * [0.3, 0.59, 0.11]).sum(2, keepdims=True)
    vivid = np.clip(lum + (p - lum) * 1.5, 0, 1)
    tint = np.array(cfg["tint"], np.float32)
    rows = np.interp(np.arange(H, dtype=np.float32), [0, H * 0.55, H], [1, 1, 0.5])[:, None, None]
    fever = vivid * (1 - rows * 0.35 * (1 - tint)) + tint * cfg["hot"] * rows * lum ** 0.8

    out = os.path.join(HERE, "out", name)
    os.makedirs(out, exist_ok=True)
    Image.fromarray((np.clip(base, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "base.webp"), quality=78, method=6)
    Image.fromarray((np.clip(fever, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "fever.webp"), quality=70, method=6)
    rgba(boosted, neon).save(os.path.join(out, "neon.webp"), quality=78, alpha_quality=85, method=6)
    rgba(boosted, lit).save(os.path.join(out, "lit.webp"), quality=78, alpha_quality=85, method=6)
    rgba(glow_colour, glow_alpha).save(os.path.join(out, "glow.webp"), quality=80, alpha_quality=100, method=6)
    sizes = {f[:-5]: os.path.getsize(os.path.join(out, f)) // 1024 for f in sorted(os.listdir(out)) if f.endswith(".webp")}
    print(name, f"neon {neon.mean():.3f} lit {lit.mean():.3f}", json.dumps(sizes), "total", sum(sizes.values()), "KB", flush=True)
    return p, neon, lit, base, fever, glow_colour, glow_alpha


def thumb(a, w=256):
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((w, w * 9 // 16), Image.LANCZOS).convert("RGB")


def signs():
    """Close crops of every painted sign, to look for fake lettering."""
    crops = [("04-arcade-s22", 0.02, 0.28, 0.3, 0.42), ("04-arcade-s22", 0.72, 0.26, 1.0, 0.42), ("05-zaulek-s22", 0.0, 0.0, 0.3, 0.2), ("05-zaulek-s22", 0.62, 0.0, 0.92, 0.2), ("06-metro-s22", 0.3, 0.42, 0.6, 0.6), ("02-klub-s22", 0.0, 0.02, 0.3, 0.2), ("03-pokoj-s22", 0.0, 0.42, 0.3, 0.6), ("08-swit-s22", 0.74, 0.3, 1.0, 0.5)]
    sheet = Image.new("RGB", (640 * 2, 300 * 4))
    for i, (name, x0, y0, x1, y1) in enumerate(crops):
        image = Image.fromarray((load(name) * 255).astype(np.uint8)).crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
        image.thumbnail((640, 300))
        sheet.paste(image, ((i % 2) * 640, (i // 2) * 300))
    sheet.save(os.path.join(HERE, "signs.png"))


def main():
    if sys.argv[1:] == ["signs"]:
        return signs()
    names = sys.argv[1].split(",") if len(sys.argv) > 1 else list(SCENES)
    sheet = Image.new("RGB", (256 * 5, 144 * len(names)))
    review = Image.new("RGB", (640 * 2, 360 * ((len(names) + 1) // 2)))
    for row, name in enumerate(names):
        p, neon, lit, base, fever, gc, ga = build(name)
        glow = np.asarray(Image.fromarray((gc * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) / 255
        ga_big = np.asarray(Image.fromarray((ga * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32)[..., None] / 255
        hit = base * (1 - lit[..., None]) + p * lit[..., None]
        hit = hit * (1 - ga_big * 0.8) + glow * ga_big * 0.8
        for col, a in enumerate((p, np.dstack([lit, neon, neon]), base, hit, fever)):
            sheet.paste(thumb(a), (col * 256, row * 144))
        review.paste(thumb(p * 0.35 + np.dstack([lit, lit * 0.2, lit * 0.2]) * 0.65 + (p * lit[..., None]) * 0.3, 640), ((row % 2) * 640, (row // 2) * 360))
    sheet.save(os.path.join(HERE, "sheet.png"))
    review.save(os.path.join(HERE, "review.png"))


if __name__ == "__main__":
    main()
