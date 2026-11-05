"""One-off: the jacket under an arm stays with the body, and a fleck with nothing left under it goes."""
s = open("keys.py", encoding="utf8").read()
assert "def under_arm" not in s
s = s.replace('''MIN_PIECE = 800
''', '''MIN_PIECE = 800
FLECK = 200
CENTER = (385, 500)
# Above this an arm's inner side faces the head, with no jacket under it.
LEVEL = 120
''')
s = s.replace('''def split_limbs(shape, limbs):''', '''def under_arm(dx, dy, along, pivot, direction):
    """Inside the sleeve on the body's side: the jacket panel below a lowered arm does not swing with it."""
    normal = np.array((-direction[1], direction[0]))
    if normal @ (np.array(CENTER) - pivot) < 0:
        normal = -normal
    return dx * normal[0] + dy * normal[1] < 45 + 0.25 * np.maximum(along, 0)


def split_limbs(shape, limbs):''')
s = s.replace('''        tube = np.hypot(np.maximum(along - length, 0), across) < ARM_RADIUS
''', '''        tube = np.hypot(np.maximum(along - length, 0), across) < ARM_RADIUS
        if np.degrees(np.arccos(direction[1])) < LEVEL:
            tube &= under_arm(dx, dy, along, pivot, direction)
''')
s = s.replace('''def sort_pieces(strength, alpha, limbs):
''', '''def sort_pieces(strength, alpha, limbs, under=None):
''')
s = s.replace('''        if (alpha[box][piece] > 0.5).mean() >= 0.5:
            kept[box] |= piece
''', '''        if (alpha[box][piece] > 0.5).mean() >= 0.5:
            if piece.sum() >= FLECK or under is None or (under[box][piece] > 0.5).mean() >= 0.5:
                kept[box] |= piece
''')
s = s.replace('''    kept, loose = sort_pieces(rest * stays, alpha, limbs)
''', '''    under = np.max([out[layer][..., 3] for layer in ("hairFront", "hairBack", "body", "jacket", "arm", "head")], axis=0)
    kept, loose = sort_pieces(rest * stays, alpha, limbs, under)
''')
s = s.replace('''sort_pieces(patch_alpha * hair, alpha, {})[0])''', '''sort_pieces(patch_alpha * hair, alpha, {}, None)[0])''')
open("keys.py", "w", encoding="utf8").write(s)
