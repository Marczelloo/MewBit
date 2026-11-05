r = open("rig.py", encoding="utf-8").read()
r = r.replace('''        skin = bleed(color, bare_skin & ~mask, 1.0)
''', '''        skin = np.median(color[bare_skin & ndi.binary_dilation(mask, iterations=8) & ~mask], axis=0)
''')
r = r.replace('''        travel = ndi.gaussian_filter1d((1 - keep) * np.maximum(bottoms - tops - lashes, 0).astype(np.float64), 1.5, mode="nearest")
''', '''        # The lid pivots on the eye's corners, which never move.
        pivot = np.sin(np.pi * (columns - columns[0] + 0.5) / len(columns)) ** 0.5
        travel = pivot * ndi.gaussian_filter1d((1 - keep) * np.maximum(bottoms - tops - lashes, 0).astype(np.float64), 1.5, mode="nearest")
''')
r = r.replace('''                    out[y, x] = skin[y, x]
''', '''                    out[y, x] = skin
''')
r = r.replace('''    # Only the eye and the bare skin around it may change: hair and the hatching under it stay the drawing's.
    bare = (color[..., 0] - color[..., 2] > 0.04) & (color.min(2) > 0.6)
    shut = color
''', '''    # Hair is whatever dark or bluish survives an opening, which thin creases and hatching do not. It stays the drawing's.
    hairlike = (color @ np.array([0.3, 0.59, 0.11]) < 0.35) | (color[..., 2] - color[..., 0] > 0.02)
    hair = ndi.binary_opening(hairlike, iterations=2)
    shut = color
''')
r = r.replace('''        allowed = ndi.gaussian_filter((eye | bare).astype(np.float32), 0.7)
''', '''        allowed = ndi.gaussian_filter((eye | ~hair).astype(np.float32), 0.7)
''')
open("rig.py", "w", encoding="utf-8", newline="\n").write(r)
