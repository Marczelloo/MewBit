"""An arm cut out of a key drawing along its hand-read outline. Nothing else of the key is used, so the torso stays the drawing's own pixels."""
import glob

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

from armcuts import CUTS, FACES, L_HAIR, L_HAIR_KEY, R_HAIR, R_HAIR_KEY, R_PANEL, R_PLATE, R_PLATE_KEY
from keys import aligned, hands_of, limbs_of, segmap_of, yellow_of
from rig import match_colors, premultiply, smoothstep
from segment import HAIR, JACKET, classes, cut_alpha

SMALL_HOLE = 150
# The plate key draws the zipper this far right of the drawing where the two meet.
ZIPPER_GAP = -4.5
# The left key's jacket hangs this far short of the drawing's at the hem.
HEM_GAP = 18
# Smaller flecks of cyan in a cut are the sleeve's own highlights, not the jacket's trim.
TRIM_FLECK = 6
# How far above its first cyan a trim's line still holds: the collar and stud sit there.
TRIM_ABOVE = 30


def polygon(points, shape):
    image = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(image).polygon([tuple(p) for p in points], fill=1)
    return np.asarray(image, bool)


def fill_small_holes(mask):
    holes, count = ndi.label(~mask)
    if count < 2:
        return mask
    sizes = ndi.sum_labels(np.ones(mask.shape), holes, np.arange(1, count + 1))
    return mask | np.isin(holes, 1 + np.nonzero(sizes < SMALL_HOLE)[0])


class Sheet:
    """One key drawing, aligned to the figure, with its background and colours sorted out."""

    def __init__(self, name, color, alpha):
        drawing = color * alpha[..., None] + 1 - alpha[..., None]
        self.drawn, self.shift = aligned(sorted(glob.glob(f"key-{name}-7/*.png"))[0], drawing)
        self.seg = np.roll(segmap_of(name, color.shape), self.shift, (0, 1))
        # Klein can draw the segmentation a few pixels off its key; slide it back onto the drawing's silhouette.
        seg_figure, key_figure = self.seg.min(2) < 225, self.drawn.min(2) < 0.85
        overlap = lambda dy, dx: (np.roll(seg_figure, (dy, dx), (0, 1)) & key_figure).sum() / (np.roll(seg_figure, (dy, dx), (0, 1)) | key_figure).sum()
        self.seg = np.roll(self.seg, max(((dy, dx) for dy in range(-8, 9) for dx in range(-8, 9)), key=lambda d: overlap(*d)), (0, 1))
        rgb, key_alpha = cut_alpha(self.drawn * 255)
        # A gap between arm and body is closed off from the border, so it comes back opaque white; the segmentation knows it is empty.
        gap = ndi.binary_opening((self.seg.min(2) > 225) & (rgb.min(2) > 0.86), iterations=1)
        key_alpha = key_alpha * (1 - np.clip(ndi.gaussian_filter(ndi.binary_dilation(gap).astype(np.float32), 0.8), 0, 1))
        # The flood from the border also leaks through any break in a finger's outline; the segmentation knows a hand is solid.
        self.skin = ndi.binary_fill_holes(ndi.binary_opening(yellow_of(self.seg), iterations=2))
        solid = np.clip(ndi.gaussian_filter(ndi.binary_dilation(self.skin, iterations=2).astype(np.float32), 0.8), 0, 1)
        self.rgb = rgb * (1 - solid[..., None]) + self.drawn * solid[..., None]
        self.alpha = np.maximum(key_alpha, solid)
        self.hair = ndi.binary_opening(classes(self.seg) == HAIR, iterations=2)
        self.color, self.figure = color, alpha

    def piece(self, outline, hand=None):
        """What the key has inside an outline: largest piece only, its edge softened by a pixel. Inside a hand's box only the hand and its cuff, never the hair or headphones behind them."""
        inside = polygon(outline, self.alpha.shape)
        mask = inside & (self.alpha > 0.5) & ~self.hair
        if hand:
            box = polygon(hand, self.alpha.shape)
            mask &= ~box | ndi.binary_dilation(classes(self.seg) == JACKET, iterations=4)
        regions, count = ndi.label(mask)
        if count > 1:
            sizes = ndi.sum_labels(np.ones(mask.shape), regions, np.arange(1, count + 1))
            mask = regions == 1 + int(np.argmax(sizes))
        mask = fill_small_holes(mask)
        soft = np.clip(ndi.gaussian_filter(mask.astype(np.float32), 0.7), 0, 1)
        # Against the outline itself the cut stays hard, where it is hidden or meets the jacket.
        return soft * self.alpha * ndi.gaussian_filter(inside.astype(np.float32), 0.6), inside

    def tidied(self, strength):
        """What a trim leaves of a sleeve: slivers of the jacket go, the sleeve and the fingers stay."""
        mask = strength > 0.5
        fingers = ndi.binary_dilation(self.skin, iterations=8) & mask
        keep = ndi.binary_opening(mask, iterations=4) | fingers
        regions, count = ndi.label(keep)
        if count > 1:
            sizes = ndi.sum_labels(np.ones(mask.shape), regions, np.arange(1, count + 1))
            keep = regions == 1 + int(np.argmax(sizes))
        return strength * np.clip(ndi.gaussian_filter(ndi.binary_dilation(keep).astype(np.float32), 0.7), 0, 1)

    def matched(self, outlines):
        """Klein shifts fills a little, so pull them back to the drawing's using everything away from the cut arms."""
        away = np.ones(self.alpha.shape, bool)
        for outline in outlines:
            away &= ~ndi.binary_dilation(polygon(outline, self.alpha.shape), iterations=12)
        trusted = away & (self.figure > 0.9) & (np.abs(self.rgb - self.color).max(2) < 0.1)
        return match_colors(self.rgb, self.color, trusted)


def scrubbed(rgb, outline):
    """A key that wears the jacket higher than the drawing brings its zipper and stud onto the shoulder: painted over with the sleeve next to them."""
    light = rgb @ np.array([0.3, 0.59, 0.11])
    bad = polygon(outline, light.shape) & ((rgb[..., 2] - rgb[..., 0] > 0.12) | (light > 0.42))
    bad = ndi.binary_dilation(bad, iterations=2) & polygon(outline, light.shape)
    usable = ~bad & (light < 0.35)
    rows, columns = ndi.distance_transform_edt(~usable, return_distances=False, return_indices=True)
    out = rgb.copy()
    out[bad] = rgb[rows[bad], columns[bad]]
    return out


def past_trim(strength, rgb, side, hand):
    """The jacket's cyan trim inside a cut and all on the body's side of it, which belongs to the jacket and must not travel with the arm."""
    shape = strength.shape
    cyan = (strength > 0.5) & (rgb[..., 2] - rgb[..., 0] > 0.3) & (rgb[..., 1] > 0.4)
    box = polygon(hand, shape) if hand else np.zeros(shape, bool)
    cyan &= ~box
    regions, count = ndi.label(cyan, np.ones((3, 3)))
    if not count:
        return np.zeros(shape, np.float32)
    sizes = ndi.sum_labels(np.ones(shape), regions, np.arange(1, count + 1))
    cyan = np.isin(regions, 1 + np.nonzero(sizes >= TRIM_FLECK)[0])
    rows = np.nonzero(cyan.any(1))[0]
    if not len(rows):
        return np.zeros(shape, np.float32)
    edge = np.array([np.nonzero(cyan[y])[0].min() if side == "L" else np.nonzero(cyan[y])[0].max() for y in rows], np.float32)
    every = np.arange(shape[0], dtype=np.float32)
    line = np.interp(every, rows, edge)[:, None]
    columns = np.arange(shape[1], dtype=np.float32)[None, :]
    beyond = columns >= line - 2 if side == "L" else columns <= line + 2
    beyond &= every[:, None] >= rows[0] - TRIM_ABOVE
    beyond &= ~box
    return np.clip(ndi.gaussian_filter(beyond.astype(np.float32), 0.7), 0, 1)


def cut_key(name, color, alpha):
    """limbL/limbR layers of a key, their rest skeletons and where its segmentation puts the arms."""
    cuts = CUTS[name]
    sheet = Sheet(name, color, alpha)
    rgb = sheet.matched([cut["poly"] for cut in cuts.values()])
    for cut in cuts.values():
        if "scrub" in cut:
            rgb = scrubbed(rgb, cut["scrub"])
    layers, skeletons = {}, {}
    for side, cut in cuts.items():
        strength, _ = sheet.piece(cut["poly"], cut.get("hand"))
        if cut.get("trim", True):
            strength = sheet.tidied(strength * (1 - past_trim(strength, rgb, side, cut.get("hand"))))
        layers[f"limb{side}"] = premultiply(rgb, strength)
        if "hand" in cut:
            # Over the head, while the sleeve stays under the jacket.
            box = ndi.gaussian_filter(polygon(cut["hand"], strength.shape).astype(np.float32), 0.7)
            layers[f"hand{side}"] = premultiply(rgb, strength * box)
        skeletons[side] = cut
    if name in FACES:
        # Hands over the face: that whole patch of the key rides the head, over the drawing's own face.
        inside = ndi.gaussian_filter(polygon(FACES[name], sheet.alpha.shape).astype(np.float32), 1.5)
        layers["face"] = premultiply(rgb, np.clip(inside, 0, 1) * sheet.alpha)
    return layers, skeletons, limbs_of(hands_of(name, sheet.seg))


def slid(layer, rows, columns):
    """A sideways slide that grows down the rows, so the key's zipper lands on the drawing's where they meet."""
    out = layer.copy()
    xs = np.arange(layer.shape[1])
    for y in range(rows[0], rows[1]):
        dx = columns * float(smoothstep(np.float64(y), rows[0], rows[0] + 55))
        for c in range(4):
            out[y, :, c] = np.interp(xs - dx, xs, layer[y, :, c])
    return out


def left_plate(color, alpha, layers):
    """The hair and jacket under the drawing's left arm. The drawing never showed them, so what the hair layers guessed there goes."""
    sheet = Sheet(L_HAIR_KEY, color, alpha)
    rgb = sheet.matched([L_HAIR] + [cut["poly"] for cut in CUTS[L_HAIR_KEY].values()])
    inside = np.clip(ndi.gaussian_filter(polygon(L_HAIR, alpha.shape).astype(np.float32), 1.5), 0, 1)
    # The strands meet the drawing's own at the top: a dissolve, since the two never quite line up.
    inside = (inside * smoothstep(np.arange(alpha.shape[0], dtype=np.float32), 328, 356)[:, None])[..., None]
    return {
        "under": (slid(premultiply(rgb, sheet.alpha), (495, 625), HEM_GAP) * inside).astype(np.float32),
        "hairBack": (layers["hairBack"] * (1 - inside)).astype(np.float32),
        "hairFront": (layers["hairFront"] * (1 - inside)).astype(np.float32),
    }


def right_plate(color, alpha, layers):
    """What lies under the drawing's right sleeve and hip hand, from one key, for every two-armed key alike."""
    sheet = Sheet(R_PLATE_KEY, color, alpha)
    rgb = sheet.matched([R_PLATE] + [cut["poly"] for cut in CUTS[R_PLATE_KEY].values()])
    whole = slid(premultiply(rgb, sheet.alpha), (440, 530), ZIPPER_GAP)
    shape = alpha.shape
    soft = lambda outline, blur: np.clip(ndi.gaussian_filter(outline.astype(np.float32), blur), 0, 1)[..., None]
    hair_sheet = Sheet(R_HAIR_KEY, color, alpha)
    hair = premultiply(hair_sheet.matched([R_HAIR] + [cut["poly"] for cut in CUTS[R_HAIR_KEY].values()]), hair_sheet.alpha)
    hair_inside = polygon(R_HAIR, shape)
    plate = whole * soft(polygon(R_PLATE, shape), 1.5) * (1 - soft(hair_inside, 1.5)) + hair * soft(hair_inside, 1.5)
    inside = polygon(R_PLATE, shape) | hair_inside
    cover = soft(ndi.binary_erosion(inside, iterations=2), 1.0)
    return {
        "under": plate.astype(np.float32),
        "panel": (plate * soft(polygon(R_PANEL, shape), 1.0)).astype(np.float32),
        "jacket": (layers["jacket"] * (1 - cover)).astype(np.float32),
        "arm": (layers["jacket"] * cover).astype(np.float32),
    }
