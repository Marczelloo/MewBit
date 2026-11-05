"""One-off: gaps Klein closed in white become see-through, the legs stay the drawing's, stray hair strokes go."""
s = open("keys.py", encoding="utf8").read()
s = s.replace("from segment import HAIR, HEAD, classes, cut_alpha", "from segment import BODY, HAIR, HEAD, classes, cut_alpha")
s = s.replace('''    mask[yy > 760] = False
''', '''    mask[yy > 760] = False
    # Klein redraws the thighs for no reason; nothing an arm does changes them unless the hand is there.
    mask[(labels == BODY) & (yy > 560) & (np.min([np.hypot(xx - hx, yy - hy) for hx, hy in hands.values()], axis=0) > REACH)] = False
''')
s = s.replace('''    key, key_alpha = cut_alpha(key * 255)
''', '''    key, key_alpha = cut_alpha(key * 255)
    # A gap between arm and body is closed off from the border, so it comes back opaque white; the segmentation knows it is empty.
    gap = ndi.binary_opening((seg.min(2) > 225) & (key.min(2) > 0.86), iterations=1)
    key_alpha = key_alpha * (1 - np.clip(ndi.gaussian_filter(ndi.binary_dilation(gap).astype(np.float32), 0.8), 0, 1))
''')
s = s.replace('''out["patchHair"] = premultiply(key, patch_alpha * hair)''', '''out["patchHair"] = premultiply(key, whole(patch_alpha * hair, 4))''')
open("keys.py", "w", encoding="utf8").write(s)
