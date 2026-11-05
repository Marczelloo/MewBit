"""One-off: what stays must lie on the drawing; a big piece off it rides the nearest arm, a small one was a stray stroke."""
s = open("keys.py", encoding="utf8").read()
assert "def sort_pieces" not in s
s = s.replace('''def build_key(name, color, alpha, labels, layers):''', '''def sort_pieces(strength, alpha, limbs):
    """Splits a layer that stays: pieces on the drawing are kept, big ones beside it go to the nearest arm, small ones are dropped."""
    regions, count = ndi.label(strength > 0.04)
    kept = np.zeros(strength.shape, bool)
    moved = {side: np.zeros(strength.shape, bool) for side in limbs}
    for i, box in enumerate(ndi.find_objects(regions), 1):
        piece = regions[box] == i
        if (alpha[box][piece] > 0.5).mean() >= 0.5:
            kept[box] |= piece
        elif piece.sum() >= MIN_PIECE and limbs:
            ys, xs = np.nonzero(piece)
            x, y = xs.mean() + box[1].start, ys.mean() + box[0].start
            ends = {side: np.hypot(x - p[0] - d[0] * n, y - p[1] - d[1] * n) for side, (p, d, n) in limbs.items()}
            moved[min(ends, key=ends.get)][box] |= piece
    return strength * kept, {side: strength * mask for side, mask in moved.items()}


def build_key(name, color, alpha, labels, layers):''')
s = s.replace('''ARM_RADIUS, WAIST = 78, 470
''', '''ARM_RADIUS, WAIST = 78, 470
MIN_PIECE = 800
''')
s = s.replace('''    out["patchHair"] = premultiply(key, whole(patch_alpha * hair, 4))
''', '''    out["patchHair"] = premultiply(key, sort_pieces(patch_alpha * hair, alpha, {})[0])
''')
s = s.replace('''    for side, weight in split_limbs(rest.shape, limbs).items():
        out[f"limb{side}"] = premultiply(key, whole(rest * smooth(weight / 0.6), 1))
        stays = np.minimum(stays, 1 - smooth((weight - 0.6) / 0.4))
    out["patch"] = premultiply(key, whole(rest * stays, 8))
''', '''    arms = {}
    for side, weight in split_limbs(rest.shape, limbs).items():
        arms[side] = whole(rest * smooth(weight / 0.6), 1)
        stays = np.minimum(stays, 1 - smooth((weight - 0.6) / 0.4))
    kept, loose = sort_pieces(rest * stays, alpha, limbs)
    for side, strength in arms.items():
        out[f"limb{side}"] = premultiply(key, np.maximum(strength, loose[side]))
    out["patch"] = premultiply(key, kept)
''')
open("keys.py", "w", encoding="utf8").write(s)
