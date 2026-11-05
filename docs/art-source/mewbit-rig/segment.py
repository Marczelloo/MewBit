"""Masks for the bp-30 rig: Klein's colour map seeds each part, a watershed on the drawing's ink settles the exact edge.

The body plate is aligned to under a pixel, so "the drawing differs from the plate" separates what lies on the body.
"""
import colorsys
import glob

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.color import rgb2hsv
from skimage.segmentation import watershed

SOURCE = "C:/Users/moskw/Documents/ChatGPT/NeoBeatBuddy/docs/character/anime/style5-lift/bp-30.png"
NAMES = ["none", "body", "hair", "jacket", "head"]
NONE, BODY, HAIR, JACKET, HEAD = range(5)
BP = np.array((30, 26, 38), float)
SEGMAP_SHIFT = 3
JAW_Y = 238
NECK = (385, 205, 445)
BOOTS_Y = 900
SPLIT_X = 365
RIGHT_ZIPPER_FROM_Y = 520
# Above this the left panel's dark lining lies on the shorts and belongs to the jacket; below it lies the thigh.
LEFT_ZIPPER_FROM_Y = 585
# Left of this line at the sleeve's height there is only the jacket's arm and hand, never the body.
LEFT_ARM_EDGE = ([305, 405, 480, 530, 680], [303, 284, 269, 254, 257])
FRONT_LOCKS_MAX_X = 452
FRONT_LOCKS_FROM_Y = 255
# The white of the fishnet beside the chest, which the background test takes for paper.
MESH_HOLE = (305, 325, 321, 370)
# Where fishnet and pale skin can pick up a lock's or a sleeve's label.
MESH_WINDOW = (300, 250, 480, 420)


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float64)


def plate(name):
    return load(sorted(glob.glob(f"plate-{name}/*.png"))[0])


def cut_alpha(rgb):
    """Same background test as anime/cutout.py, without its resize to the Qwen frame size."""
    rgb = np.maximum(rgb, BP * 0.8)
    lo = rgb.min(2)
    sat = rgb.max(2) - lo
    cand = (lo > 228) & (sat < 22)
    lab, n = ndi.label(cand)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    skin = (rgb[..., 0] - rgb[..., 2] > 18) & (lo > 150)
    sizes = ndi.sum(cand, lab, range(1, n + 1))
    # Tiny white spots are eye glints up high; on the boots they are paper showing through a lace loop.
    tops = ndi.minimum(np.indices(lab.shape)[0], lab, range(1, n + 1))
    for i, s in enumerate(sizes, 1):
        if i in border or (s < 90 and tops[i - 1] < BOOTS_Y):
            continue
        m = lab == i
        if lo[m].mean() <= 238:
            continue
        near = ndi.binary_dilation(m, iterations=14) & ~m
        if s > 600 or skin[near].mean() < 0.1:
            bg |= m
    band = ndi.binary_dilation(bg, iterations=3) & ~bg
    alpha = np.where(bg, 0.0, 1.0)
    alpha[band] = np.clip((250 - lo) / (250 - 90), 0, 1)[band]
    a = np.clip(alpha, 1e-3, 1)[..., None]
    col = np.clip((rgb - 255 * (1 - a)) / a, 0, 255)
    return col / 255, alpha


def cut_drawing(original):
    color, alpha = cut_alpha(original)
    x0, y0, x1, y1 = MESH_HOLE
    hole = alpha[y0:y1, x0:x1] < 1
    color[y0:y1, x0:x1][hole] = (original / 255)[y0:y1, x0:x1][hole]
    alpha[y0:y1, x0:x1][hole] = 1.0
    return color, alpha


def classes(segmap):
    """Flat fills of the colour map to seed masks; ink and unsaturated pixels stay unclassified."""
    hsv = rgb2hsv(segmap / 255)
    hue, sat, val = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    vivid = (sat > 0.45) & (val > 0.45)
    seed = np.zeros(segmap.shape[:2], np.uint8)
    seed[vivid & ((hue < 15) | (hue > 345))] = HAIR
    seed[vivid & (hue > 90) & (hue < 165)] = JACKET
    seed[vivid & (hue > 40) & (hue < 75)] = JACKET
    seed[vivid & (hue > 170) & (hue < 260)] = BODY
    seed[vivid & (hue > 285) & (hue <= 345)] = HEAD
    return seed


def settle(labels, original, body_plate):
    """Thick outlines let the watershed leak along the ink, so give leaked strips back to the part they outline."""
    def give_away(wrong):
        keep = (labels != NONE) & ~wrong
        nearest = ndi.distance_transform_edt(~keep, return_distances=False, return_indices=True)
        labels[wrong] = labels[nearest[0], nearest[1]][wrong]

    silhouette = cut_alpha(body_plate)[1] > 0.5
    give_away((labels == BODY) & ~ndi.binary_dilation(silhouette, iterations=1))

    # Where the plate shows the arm under the jacket, jacket ink still differs from the plate: follow it from the jacket.
    differs = np.abs(original - body_plate).max(2) > 60
    near_jacket = ndi.binary_dilation(labels == JACKET, iterations=14)
    leaked = ndi.binary_propagation(ndi.binary_dilation(labels == JACKET) & differs, mask=(labels == BODY) & differs & near_jacket)
    labels[leaked] = JACKET

    # Stray specks of the map, like the blob between the thighs.
    parts, count = ndi.label(labels == JACKET)
    sizes = ndi.sum(labels == JACKET, parts, range(1, count + 1))
    give_away(np.isin(parts, [i + 1 for i, size in enumerate(sizes) if size < 2000]))

    # Hatching on the skin beside a lock is shading on the body, not hair: hair is what stays solid after an opening.
    luma = original @ np.array([0.3, 0.59, 0.11]) / 255
    lying_on_body = (labels == HAIR) & silhouette
    solid = ndi.binary_dilation(ndi.binary_opening(luma < 0.45, iterations=2) & lying_on_body, iterations=2)
    labels[lying_on_body & ~solid] = BODY

    # The teeth at the top of the left panel fell to the hair beside them, so that stretch of zipper left with the hair.
    hsv = rgb2hsv(original / 255)
    cyan = (hsv[..., 0] * 360 > 165) & (hsv[..., 0] * 360 < 205) & (hsv[..., 1] > 0.4) & (hsv[..., 2] > 0.5)
    teeth = cyan & (labels == HAIR)
    teeth[:, SPLIT_X:] = False
    rows = np.nonzero(teeth.any(1))[0]
    if len(rows):
        outer = np.array([np.nonzero(cyan[y, :SPLIT_X])[0].min() for y in rows])
        columns = np.arange(labels.shape[1])
        for y in range(rows[0], rows[-1] + 1):
            edge = np.interp(y, rows, outer)
            labels[y][(columns >= edge - 2) & (columns <= edge + 30) & (labels[y] == HAIR)] = JACKET

    # The zipper is the jacket's inner edge. What the watershed took beyond it is the thigh's shadow, which rides the leg.
    teal = (labels == JACKET) & (hsv[..., 0] * 360 > 165) & (hsv[..., 0] * 360 < 205) & (hsv[..., 1] > 0.4) & (hsv[..., 2] > 0.5)
    parts, count = ndi.label(ndi.binary_closing(teal, iterations=4))
    sizes = ndi.sum(teal, parts, range(1, count + 1))
    zipper = np.isin(parts, [i + 1 for i, size in enumerate(sizes) if size > 250]) & teal
    columns = np.arange(labels.shape[1])
    for y in range(labels.shape[0]):
        xs = np.nonzero(zipper[y])[0]
        left, right = xs[xs < SPLIT_X], xs[xs >= SPLIT_X]
        if len(left) and y >= LEFT_ZIPPER_FROM_Y:
            labels[y][(columns > left.max() + 4) & (columns < SPLIT_X) & (labels[y] == JACKET)] = BODY
        if len(right) and y >= RIGHT_ZIPPER_FROM_Y:
            labels[y][(columns < right.min() - 4) & (columns >= SPLIT_X) & (labels[y] == JACKET)] = BODY

    # The hanging hand's outline must leave with the hand, or it stays behind as a second hand.
    rows, cols = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]]
    labels[(labels == BODY) & (rows >= LEFT_ARM_EDGE[0][0]) & (rows <= LEFT_ARM_EDGE[0][-1]) & (cols < np.interp(rows, *LEFT_ARM_EDGE))] = JACKET

    # Fishnet is thin pale stripes on the chest, so the map scatters it among the lock and the sleeve; it must stay on the body.
    r, g, b = original[..., 0], original[..., 1], original[..., 2]
    bluish = b - r > 20
    magenta = (r - g > 50) & (b - g > 50)
    x0, y0, x1, y1 = MESH_WINDOW
    window = (rows >= y0) & (rows < y1) & (cols >= x0) & (cols < x1) & (cols >= np.interp(rows, *LEFT_ARM_EDGE))
    pale = (luma > 0.5) & (original.max(2) - original.min(2) < 40) & ~bluish & window
    parts, count = ndi.label(ndi.binary_closing(pale, iterations=3))
    sizes = ndi.sum(pale, parts, range(1, count + 1))
    mesh = np.isin(parts, [i + 1 for i, size in enumerate(sizes) if size >= 40])
    labels[mesh & ((labels == HAIR) | (labels == JACKET))] = BODY
    hole_x0, hole_y0, hole_x1, hole_y1 = MESH_HOLE
    in_hole = (rows >= hole_y0) & (rows < hole_y1) & (cols >= hole_x0) & (cols < hole_x1)
    labels[in_hole & (labels == NONE)] = BODY

    # A lock over the chest is its blue-grey or magenta strands and their ink. Hatching and scraps beside it are the body's shading.
    front = (labels == HAIR) & silhouette & (cols < FRONT_LOCKS_MAX_X) & (rows >= FRONT_LOCKS_FROM_Y)
    strands = front & (bluish | magenta)
    keep = strands | (ndi.binary_dilation(strands, iterations=6) & (luma < 0.2) & front)
    parts, count = ndi.label(keep)
    sizes = ndi.sum(keep, parts, range(1, count + 1))
    keep = np.isin(parts, [i + 1 for i, size in enumerate(sizes) if size >= 60])
    labels[front & ~keep] = BODY

    # Above the jaw only the neck is not head. The plate's silhouette includes the head, so headphone ink can land in body.
    yy, xx = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]]
    neck = (yy >= NECK[1]) & (xx >= NECK[0]) & (xx <= NECK[2])
    labels[(yy < JAW_Y) & ~neck & (labels != NONE)] = HEAD
    return labels


def main():
    original = load(SOURCE)
    color, alpha = cut_drawing(original)
    body_plate = plate("body")
    seed = classes(plate("segmap"))
    # The map drifts sideways further down the figure, measured against the drawing at head, belt, thigh and boots.
    for y, shift in enumerate(np.interp(np.arange(seed.shape[0]), [0, 600, 1100], [3, 3, 7]).round().astype(int)):
        seed[y] = np.roll(seed[y], shift)

    # Decals on the top and shorts are magenta and cyan fills in the map too, so anything below the jaw counts as body.
    below = np.arange(seed.shape[0])[:, None] >= JAW_Y
    seed[below & (seed == HEAD)] = BODY
    # Above the jaw: hair, face, ears and headphones all ride the head.
    above = ~below & (seed != NONE)
    seed[above & (seed != BODY)] = HEAD

    markers = np.zeros(seed.shape, np.int32)
    for label in (BODY, HAIR, JACKET, HEAD):
        markers[ndi.binary_erosion(seed == label, iterations=5)] = label
    # What matches the clean body plate is body, whatever the colour map said about thin parts like the straps.
    same = np.abs(original - body_plate).max(2) < 26
    same = ndi.binary_erosion(same & (alpha > 0.9), iterations=2) & below
    markers[same & (seed != JACKET)] = BODY

    luma = original @ np.array([0.3, 0.59, 0.11]) / 255
    edges = ndi.gaussian_gradient_magnitude(luma, 1.0) - 0.15 * luma
    labels = watershed(edges, markers, mask=alpha > 0.01).astype(np.uint8)
    labels[alpha <= 0.01] = NONE
    labels = settle(labels, original, body_plate)
    np.save("labels.npy", labels)
    np.save("body_silhouette.npy", cut_alpha(body_plate)[1] > 0.5)

    tint = np.array([[0, 0, 0], [80, 120, 255], [255, 60, 60], [60, 220, 90], [255, 60, 220]], float)[labels]
    shown = original * 0.55 + tint * 0.45
    border = ndi.morphological_gradient(labels, size=3) > 0
    shown[border] = 255
    shown = np.where((labels == NONE)[..., None], np.array([40, 40, 46.0]), shown)
    Image.fromarray(shown.astype(np.uint8)).crop((150, 30, 620, 660)).resize((940, 1260), Image.LANCZOS).save("overlay.jpg", quality=86)
    for label, name in enumerate(NAMES):
        print(name, int((labels == label).sum()))


if __name__ == "__main__":
    main()
