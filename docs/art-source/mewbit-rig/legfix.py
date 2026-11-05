"""Stockings of a key in the drawing's own colour: lightness matched by quantiles, chroma as a function of lightness, ink and skin left alone."""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.color import lab2rgb, rgb2lab

from rig import PAD
from segment import SOURCE, load

# Thighs and shins of the drawing, above the boots and below the bare skin.
DRAWN_BOXES = [(270, 710, 330, 860), (440, 710, 500, 860), (275, 900, 310, 1000), (480, 900, 520, 1000)]
# Above this a pixel is skin or highlight paper, below this it is ink.
SKIN = 58.0
INK = 13.0
QUANTILES = np.linspace(0, 1, 41)


def _target():
    lab = rgb2lab(load(SOURCE) / 255)
    rows = np.concatenate([lab[y0:y1, x0:x1].reshape(-1, 3) for x0, y0, x1, y1 in DRAWN_BOXES])
    rows = rows[(rows[:, 0] > INK) & (rows[:, 0] < SKIN)]
    edges = np.arange(INK, SKIN + 4, 4.0)
    centres, a, b = [], [], []
    for lo, hi in zip(edges, edges[1:]):
        m = (rows[:, 0] >= lo) & (rows[:, 0] < hi)
        if m.sum() > 20:
            centres.append((lo + hi) / 2)
            a.append(np.median(rows[m, 1]))
            b.append(np.median(rows[m, 2]))
    return np.quantile(rows[:, 0], QUANTILES), np.array(centres), np.array(a), np.array(b)


TARGET_L, CENTRES, TARGET_A, TARGET_B = _target()


def polygon_mask(polys, size):
    image = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(image)
    for poly in polys:
        draw.polygon([(x + PAD[0], y + PAD[1]) for x, y in poly], fill=255)
    return np.asarray(image, dtype=np.float32) / 255


def fix_stockings(canvas, polys, strength=1.0):
    """canvas: premultiplied RGBA float. polys: stocking outlines in drawing coordinates on the key's floor."""
    size = canvas.shape[0]
    alpha = canvas[..., 3]
    where = polygon_mask(polys, size) > 0.5
    ys, xs = np.nonzero(where)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = np.clip(canvas[y0:y1, x0:x1, :3] / np.maximum(alpha[y0:y1, x0:x1, None], 1e-4), 0, 1)
    lab = rgb2lab(rgb)
    inside = where[y0:y1, x0:x1] & (alpha[y0:y1, x0:x1] > 0.9)
    L = lab[..., 0]
    cloth = inside & (L > INK) & (L < SKIN + 8)
    source_q = np.quantile(L[cloth], QUANTILES)
    source_q = np.maximum.accumulate(source_q + np.arange(len(source_q)) * 1e-6)
    new_l = np.interp(L, source_q, TARGET_L)
    new_a = np.interp(new_l, CENTRES, TARGET_A)
    new_b = np.interp(new_l, CENTRES, TARGET_B)
    # Soft in lightness so ink lines and skin are untouched, soft at the outline so no edge shows.
    weight = np.clip((L - INK * 0.7) / (INK * 0.5), 0, 1) * np.clip((SKIN + 8 - L) / 8, 0, 1)
    weight = weight * ndi.gaussian_filter(inside.astype(np.float32), 2.0) * strength
    out = lab.copy()
    out[..., 0] = L * (1 - weight) + new_l * weight
    out[..., 1] = lab[..., 1] * (1 - weight) + new_a * weight
    out[..., 2] = lab[..., 2] * (1 - weight) + new_b * weight
    fixed = np.clip(lab2rgb(out), 0, 1).astype(np.float32)
    result = canvas.copy()
    result[y0:y1, x0:x1, :3] = fixed * alpha[y0:y1, x0:x1, None]
    return result
