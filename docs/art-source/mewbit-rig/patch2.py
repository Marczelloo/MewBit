s = open("segment.py", encoding="utf-8").read()
s = s.replace('''RIGHT_ZIPPER_FROM_Y = 520
''', '''RIGHT_ZIPPER_FROM_Y = 520
# Left of this line at the sleeve's height there is only the jacket's arm and hand, never the body.
LEFT_ARM_EDGE = ([305, 405, 480, 530, 680], [303, 284, 269, 254, 257])
''')
s = s.replace('''    # Above the jaw only the neck is not head. The plate''', '''    # The hanging hand's outline must leave with the hand, or it stays behind as a second hand.
    rows, cols = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]]
    labels[(labels == BODY) & (rows >= LEFT_ARM_EDGE[0][0]) & (rows <= LEFT_ARM_EDGE[0][-1]) & (cols < np.interp(rows, *LEFT_ARM_EDGE))] = JACKET

    # Above the jaw only the neck is not head. The plate''')
open("segment.py", "w", encoding="utf-8", newline="\n").write(s)

r = open("rig.py", encoding="utf-8").read()
r = r.replace("from segment import BODY, HAIR, HEAD, JACKET, JAW_Y, SOURCE, cut_alpha, load, plate", "from segment import BODY, HAIR, HEAD, JACKET, JAW_Y, LEFT_ARM_EDGE, SOURCE, cut_alpha, load, plate")
r = r.replace("from scipy import ndimage as ndi\n", "from scipy import ndimage as ndi\nfrom skimage.draw import polygon\n")
a = r.index("# The open eyes as drawn: centre, half axes and tilt.")
b = r.index("# Klein drew the left eye shut a little low")
r = r[:a] + '''# The open eyes as drawn, lash and lower lid included, hair excluded. The lid travels down inside these outlines.
EYE_OUTLINES = [
    [(347, 178), (371, 177), (376, 182), (375, 187), (369, 192), (360, 196), (355, 195), (345, 186)],
    [(404, 167), (412, 164), (428, 163), (433, 168), (434, 172), (426, 179), (416, 180), (411, 174), (405, 171)],
]
EYE_STAGES = {"lid1": 0.62, "lid2": 0.28}
LASH_MAX = 7
''' + r[b:]
r = r.replace('''# Klein's plate keeps the arms. Under the jacket only the torso and legs may remain, or a second hand shows through.
LEFT_ARM_EDGE = ([305, 405, 480, 530, 680], [303, 284, 269, 254, 257])
''', '')
r = r.replace('''    under = figure & (labels != BODY) & ndi.binary_erosion(silhouette, iterations=1) & below & ~left_arm
    body_rgb[under] = body_art[under]
''', '''    # Klein's plate keeps the arms. Under the jacket only the torso and legs may remain, or a second hand shows through.
    under = figure & (labels != BODY) & ndi.binary_erosion(silhouette, iterations=1) & below & ~left_arm
    # It also keeps a hint of the zipper, which would peek out beside the real one.
    plate_zipper = ndi.binary_dilation((body_art[..., 2] - body_art[..., 0] > 0.15) & (body_art[..., 1] - body_art[..., 0] > 0.15) & (labels == JACKET), iterations=2)
    body_art[plate_zipper] = bleed(body_art, ~plate_zipper & (body_art.max(2) - body_art.min(2) < 0.2), 1.0)[plate_zipper]
    body_rgb[under] = body_art[under]
''')
a = r.index("def squeeze_eyes(color, keep):")
b = r.index("def warp(layer, bone, t):")
r = r[:a] + '''def eye_mask(outline, shape):
    mask = np.zeros(shape, bool)
    xs, ys = zip(*outline)
    mask[polygon(ys, xs, shape)] = True
    return mask


def lower_lids(color, keep):
    """A lid on its way down: the lash slides over the eye, which stays put, and skin follows above it."""
    out = color.copy()
    ink = color @ np.array([0.3, 0.59, 0.11]) < 0.35
    bare_skin = (color[..., 0] - color[..., 2] > 0.07) & (color.min(2) > 0.75)
    for outline in EYE_OUTLINES:
        mask = eye_mask(outline, color.shape[:2])
        skin = bleed(color, bare_skin & ~mask, 1.0)
        columns = np.nonzero(mask.any(0))[0]
        tops, bottoms, lashes = [], [], []
        for x in columns:
            ys = np.nonzero(mask[:, x])[0]
            inked = ink[ys, x]
            start = int(np.argmax(inked)) if inked.any() else 0
            run = 0
            while start + run < len(ys) and inked[start + run] and run < LASH_MAX:
                run += 1
            tops.append(ys[start])
            bottoms.append(ys[-1])
            lashes.append(run)
        tops, bottoms, lashes = map(np.array, (tops, bottoms, lashes))
        travel = ndi.gaussian_filter1d((1 - keep) * np.maximum(bottoms - tops - lashes, 0).astype(np.float64), 1.5, mode="nearest")
        for x, top, bottom, lash, drop in zip(columns, tops, bottoms, lashes, travel):
            ys = np.nonzero(mask[:, x])[0]
            for y in ys:
                if y < top + drop:
                    out[y, x] = skin[y, x]
                elif y < top + drop + lash:
                    source = y - drop
                    low = int(np.floor(source))
                    out[y, x] = color[low, x] * (1 - source + low) + color[low + 1, x] * (source - low)
    return out


def head_variants(color, layer):
    """Open eyes stay the drawing's own pixels, the lids on the way down are made from them, and only shut comes from Klein."""
    size = color.shape[:2]
    yy, xx = np.mgrid[0 : size[0], 0 : size[1]].astype(np.float32)
    x0, y0, x1, y1 = HEAD_CROP
    full = color.copy()
    full[y0:y1, x0:x1] = aligned_patch(sorted(glob.glob("eyes-closed/*.png"))[0], color)
    masks = [ndi.gaussian_filter((((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1).astype(np.float32), 2.5) for cx, cy, rx, ry in EYE_ELLIPSES]
    union = np.maximum(*masks)
    rim = (union > 0.05) & (union < 0.5)
    # Klein lightened the skin, so match on skin alone and by ratio, which leaves the ink black.
    skin = rim & (color.min(2) > 0.7) & (full.min(2) > 0.7)
    full = np.clip(full * color[skin].mean(0) / full[skin].mean(0), 0, 1)
    # Only the eye and the bare skin around it may change: hair and the hatching under it stay the drawing's.
    bare = (color[..., 0] - color[..., 2] > 0.04) & (color.min(2) > 0.6)
    shut = color
    for mask, outline, lift in zip(masks, EYE_OUTLINES, CLOSED_EYE_LIFT):
        eye = ndi.binary_dilation(eye_mask(outline, size), iterations=1)
        allowed = ndi.gaussian_filter((eye | bare).astype(np.float32), 0.7)
        weight = (mask * allowed)[..., None]
        shut = shut * (1 - weight) + np.roll(full, -lift, 0) * weight

    def as_layer(image):
        variant = layer.copy()
        variant[..., :3] = image * layer[..., 3:4]
        return variant.astype(np.float32)

    variants = {"open": layer, "closed": as_layer(shut)}
    for state, keep in EYE_STAGES.items():
        variants[state] = as_layer(lower_lids(color, keep))
    return variants


''' + r[b:]
open("rig.py", "w", encoding="utf-8", newline="\n").write(r)
