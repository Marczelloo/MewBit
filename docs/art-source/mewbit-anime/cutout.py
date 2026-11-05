"""Cut white-background frames to transparent PNGs, trimmed and bottom-anchored on a shared canvas.

usage: python cutout.py OUT_DIR NAME=SRC.png [NAME=SRC.png ...]
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

BP = np.array((30, 26, 38), float)  # approved black-point lift (bp-30)
PAD = 8
SIZE = (640, 928)  # Qwen output size


def strip_vertical_lines(alpha, gap=5):
    """Drop thin drawn vertical strokes (the 'wall edge' in peek frames): opaque pixels with
    transparency `gap` px on both sides, forming a connected run taller than 150 px."""
    op = alpha > 0.1
    left = np.zeros_like(op); left[:, gap:] = ~op[:, :-gap]
    right = np.zeros_like(op); right[:, :-gap] = ~op[:, gap:]
    thin = op & left & right
    lab, _ = ndimage.label(thin, structure=np.ones((3, 3)))
    tall = [i for i, s in enumerate(ndimage.find_objects(lab), 1) if s[0].stop - s[0].start > 150]
    # remove the stroke (plus its anti-aliasing) only where it is thin; the gripping hand stays
    kill = ndimage.binary_dilation(np.isin(lab, tall), structure=np.ones((3, 7)))
    out = alpha.copy()
    out[kill] = 0
    return out


def cut(path, strip_lines=False):
    im = cut_full(path, strip_lines)
    return im.crop(im.getbbox())


def cut_full(path, strip_lines=False):
    """Same as cut() but uncropped, so the frame keeps its position in the source image."""
    src = Image.open(path).convert("RGB")
    if src.size != SIZE:  # keep the character at one pixel scale across frames
        src = src.resize(SIZE, Image.LANCZOS)
    rgb = np.asarray(src).astype(float)
    rgb = np.maximum(rgb, BP * 0.8)  # Qwen keeps the bp-30 lift; only clip stray pure blacks
    lo = rgb.min(2)
    sat = rgb.max(2) - lo
    # background candidates: near-white, unsaturated
    cand = (lo > 228) & (sat < 22)
    lab, n = ndimage.label(cand)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # enclosed white holes (gaps between arms, legs and hair): large regions, plus smaller ones with
    # no skin nearby (eye whites and teeth always have skin around them, so they stay)
    skin = (rgb[..., 0] - rgb[..., 2] > 18) & (lo > 150)
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    for i, s in enumerate(sizes, 1):
        if i in border or s < 90:
            continue
        m = lab == i
        if lo[m].mean() <= 238:
            continue
        near = ndimage.binary_dilation(m, iterations=14) & ~m
        if s > 600 or skin[near].mean() < 0.1:
            bg |= m
    # soft edge: in a 3px band around bg, alpha from distance to white (grey AA pixels fade, ink stays)
    band = ndimage.binary_dilation(bg, iterations=3) & ~bg
    alpha = np.where(bg, 0.0, 1.0)
    whiteness = np.clip((250 - lo) / (250 - 90), 0, 1)
    alpha[band] = whiteness[band]
    if strip_lines:
        alpha = strip_vertical_lines(alpha)
    # un-premultiply against white so edges do not halo
    a = np.clip(alpha, 1e-3, 1)[..., None]
    col = np.clip((rgb - 255 * (1 - a)) / a, 0, 255)
    out = np.dstack([col, alpha[..., None] * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    items = [a.split("=", 1) for a in sys.argv[2:]]
    cuts = [(n, cut(p, strip_lines=n.startswith("peek"))) for n, p in items]
    w = max(c.width for _, c in cuts) + 2 * PAD
    h = max(c.height for _, c in cuts) + 2 * PAD
    for name, c in cuts:
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.paste(c, ((w - c.width) // 2, h - PAD - c.height))  # bottom-centre anchor
        canvas.save(os.path.join(out_dir, name + ".png"), optimize=True)
        print(name, c.size)
    print("canvas", (w, h))


if __name__ == "__main__":
    main()
