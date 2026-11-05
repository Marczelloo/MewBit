s = open("segment.py", encoding="utf-8").read()
s = s.replace('''BOOTS_Y = 900
''', '''BOOTS_Y = 900
SPLIT_X = 365
RIGHT_ZIPPER_FROM_Y = 520
''')
s = s.replace('''    # Above the jaw only the neck is not head.''', '''    # Hatching on the skin beside a lock is shading on the body, not hair: hair is what stays solid after an opening.
    luma = original @ np.array([0.3, 0.59, 0.11]) / 255
    lying_on_body = (labels == HAIR) & silhouette
    solid = ndi.binary_dilation(ndi.binary_opening(luma < 0.45, iterations=2) & lying_on_body, iterations=2)
    labels[lying_on_body & ~solid] = BODY

    # The zipper is the jacket's inner edge. What the watershed took beyond it is the thigh's shadow, which rides the leg.
    hsv = rgb2hsv(original / 255)
    teal = (labels == JACKET) & (hsv[..., 0] * 360 > 165) & (hsv[..., 0] * 360 < 205) & (hsv[..., 1] > 0.4) & (hsv[..., 2] > 0.5)
    parts, count = ndi.label(ndi.binary_closing(teal, iterations=4))
    sizes = ndi.sum(teal, parts, range(1, count + 1))
    zipper = np.isin(parts, [i + 1 for i, size in enumerate(sizes) if size > 250]) & teal
    columns = np.arange(labels.shape[1])
    for y in range(labels.shape[0]):
        xs = np.nonzero(zipper[y])[0]
        left, right = xs[xs < SPLIT_X], xs[xs >= SPLIT_X]
        if len(left):
            labels[y][(columns > left.max() + 4) & (columns < SPLIT_X) & (labels[y] == JACKET)] = BODY
        if len(right) and y >= RIGHT_ZIPPER_FROM_Y:
            labels[y][(columns < right.min() - 4) & (columns >= SPLIT_X) & (labels[y] == JACKET)] = BODY

    # Above the jaw only the neck is not head.''')
open("segment.py", "w", encoding="utf-8", newline="\n").write(s)

r = open("rig.py", encoding="utf-8").read()
r = r.replace('''EYE_ELLIPSES = [(360, 180, 27, 21), (420, 170, 32, 21)]
''', '''EYE_ELLIPSES = [(360, 180, 27, 21), (420, 170, 32, 21)]
# The open eyes as drawn: centre, half axes and tilt. Closing squeezes these toward the lower lid.
EYE_OPENINGS = [(362, 183, 23, 14, -0.18), (420, 168, 24, 14, -0.33)]
EYE_STAGES = {"lid1": 0.62, "lid2": 0.28}
# Klein drew the left eye shut a little low, so the lid seemed to drop past the eye instead of meeting it.
CLOSED_EYE_LIFT = (3, 0)
# Klein's plate keeps the arms. Under the jacket only the torso and legs may remain, or a second hand shows through.
LEFT_ARM_EDGE = ([305, 405, 480, 530, 680], [303, 284, 269, 254, 257])
HIP_HAND_BOX = (395, 440, 480, 510)
''')
r = r.replace('''    for frame, state in {10: "half", 11: "closed", 12: "closed", 13: "half"}.items():
        states[frame] = state
    for frame in range(34, 60):
        states[frame] = "closed"
    states[33] = states[32] = "half"
    states[60] = states[61] = "half"
    return states
''', '''    for frame, state in {9: "lid1", 10: "lid2", 11: "closed", 12: "closed", 13: "lid2", 14: "lid1"}.items():
        states[frame] = state
    for frame in range(33, 60):
        states[frame] = "closed"
    states[31] = states[61] = "lid1"
    states[32] = states[60] = "lid2"
    return states
''')
r = r.replace('''    under = figure & (labels != BODY) & ndi.binary_erosion(silhouette, iterations=1) & below
    body_rgb[under] = body_art[under]
    body_alpha[under] = 1.0
''', '''    yy, xx = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]]
    left_arm = (yy >= LEFT_ARM_EDGE[0][0]) & (xx < np.interp(yy, *LEFT_ARM_EDGE))
    under = figure & (labels != BODY) & ndi.binary_erosion(silhouette, iterations=1) & below & ~left_arm
    body_rgb[under] = body_art[under]
    body_alpha[under] = 1.0
    # The hand on the hip stays on the hip, so only a sliver of what lies under it ever shows: smear in the skin and belt.
    x0, y0, x1, y1 = HIP_HAND_BOX
    hip_hand = (labels == JACKET) & (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    seeds = ndi.binary_erosion(labels == BODY, iterations=1) & (alpha > 0.9)
    body_rgb[hip_hand] = bleed(color, seeds, 1.5)[hip_hand]
''')
r = r.replace('''    body_rgb[neck] = bleed(color, ndi.binary_erosion(labels == BODY, iterations=1) & (alpha > 0.9), 2.0)[neck]
''', '''    # Not from the coloured strands of hair at the neck, or a pink streak shows when the head lifts.
    plain = color.max(2) - color.min(2) < 0.35
    body_rgb[neck] = bleed(color, seeds & plain, 2.0)[neck]
''')
r = r.replace('''    hidden = figure & ~back & has_hair & ndi.binary_dilation(hair, iterations=40) & below
    # Klein's hair runs too long: stop the fill at the drawing's own tips on each side, or a swing shows a loose scrap.
    yy, xx = np.mgrid[0 : labels.shape[0], 0 : labels.shape[1]]
    for side''', '''    # Light pixels of the plate are its arm and hand, never hair.
    hidden = figure & ~back & has_hair & ndi.binary_dilation(hair, iterations=40) & below & (hair_art.min(2) < 0.6)
    # Klein's hair runs too long: stop the fill at the drawing's own tips on each side, or a swing shows a loose scrap.
    for side''')
a = r.index("def head_variants(color, layer):")
b = r.index("def warp(layer, bone, t):")
r = r[:a] + '''def squeeze_eyes(color, keep):
    """A lid on its way down: the drawn eye squeezed toward its lower lid, with skin closing in above it."""
    h, w = color.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    out = color.copy()
    skin = (color[..., 0] - color[..., 2] > 0.07) & (color.min(2) > 0.6)
    for cx, cy, rx, ry, tilt in EYE_OPENINGS:
        dx = xx - cx
        dy = yy - cy - tilt * dx
        inside = (dx / rx) ** 2 + (dy / ry) ** 2 < 1
        mask = ndi.gaussian_filter(inside.astype(np.float64), 1.2)
        fill = bleed(color, skin & ~ndi.binary_dilation(inside, iterations=2), 1.0)
        base = out * (1 - mask[..., None]) + fill * mask[..., None]
        lower_lid = cy + tilt * dx + 0.62 * ry
        source_y = lower_lid + (yy - lower_lid) / keep
        cover = ndi.map_coordinates(mask, [source_y, xx], order=1)[..., None]
        eye = np.stack([ndi.map_coordinates(color[..., c], [source_y, xx], order=1) for c in range(3)], -1)
        out = base * (1 - cover) + eye * cover
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
    shut = color
    for mask, lift in zip(masks, CLOSED_EYE_LIFT):
        shut = shut * (1 - mask[..., None]) + np.roll(full, -lift, 0) * mask[..., None]

    def as_layer(image):
        variant = layer.copy()
        variant[..., :3] = image * layer[..., 3:4]
        return variant.astype(np.float32)

    variants = {"open": layer, "closed": as_layer(shut)}
    for state, keep in EYE_STAGES.items():
        variants[state] = as_layer(squeeze_eyes(color, keep))
    return variants


''' + r[b:]
open("rig.py", "w", encoding="utf-8", newline="\n").write(r)
