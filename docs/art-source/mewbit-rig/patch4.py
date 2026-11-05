s = open("segment.py", encoding="utf-8").read()
s = s.replace('''RIGHT_ZIPPER_FROM_Y = 520
''', '''RIGHT_ZIPPER_FROM_Y = 520
# Above this the left panel's dark lining lies on the shorts and belongs to the jacket; below it lies the thigh.
LEFT_ZIPPER_FROM_Y = 585
''')
s = s.replace('''    # The zipper is the jacket's inner edge. What the watershed took beyond it is the thigh's shadow, which rides the leg.
    hsv = rgb2hsv(original / 255)
''', '''    # The teeth at the top of the left panel fell to the hair beside them, so that stretch of zipper left with the hair.
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
''')
s = s.replace('''        if len(left):
            labels[y][(columns > left.max() + 4)''', '''        if len(left) and y >= LEFT_ZIPPER_FROM_Y:
            labels[y][(columns > left.max() + 4)''')
open("segment.py", "w", encoding="utf-8", newline="\n").write(s)

r = open("rig.py", encoding="utf-8").read()
r = r.replace('''EYE_STAGES = {"lid1": 0.62, "lid2": 0.28}
LASH_MAX = 7
''', '''# The fold above each eye. Klein's shut eye has none, so it fades out once the lid is most of the way down.
EYE_CREASES = [
    [(349, 172), (369, 172), (371, 178), (347, 178)],
    [(404, 158), (420, 158), (420, 163), (404, 166)],
]
EYE_STAGES = {"lid1": 0.62, "lid2": 0.28}
LASH_MAX = 7
''')
r = r.replace('''    for outline in EYE_OUTLINES:
        mask = eye_mask(outline, color.shape[:2])
''', '''    for outline, crease in zip(EYE_OUTLINES, EYE_CREASES):
        mask = eye_mask(outline, color.shape[:2])
''')
r = r.replace('''        columns = np.nonzero(mask.any(0))[0]
        tops, bottoms, lashes = [], [], []
''', '''        if keep < 0.5:
            out[eye_mask(crease, color.shape[:2])] = skin
        columns = np.nonzero(mask.any(0))[0]
        tops, bottoms, lashes = [], [], []
''')
r = r.replace('''    # It also keeps a hint of the zipper, which would peek out beside the real one.
''', '''    # Under a lock its pale shoulder would flash as a stripe once the lock lifts, so let the hair behind show there instead.
    under &= ~(ndi.binary_dilation((labels == HAIR) & (body_art.min(2) > 0.5), iterations=2) & (labels == HAIR))
    # It also keeps a hint of the zipper, which would peek out beside the real one.
''')
open("rig.py", "w", encoding="utf-8", newline="\n").write(r)
