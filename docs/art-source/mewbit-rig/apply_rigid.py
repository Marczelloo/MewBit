"""One-off: moves key arms from a falloff warp to a rigid turn about the shoulder."""
import re

s = open("keys.py", encoding="utf8").read()
assert "split_limbs" not in s
s = s.replace('''REACH = 85
''', '''REACH = 85
# A hand further than this from its shoulder is on a straight arm; closer, the elbow sticks out and the whole side above the waist turns with it.
STRAIGHT = 200
ARM_RADIUS, WAIST = 78, 470
''')
s = s.replace('''def build_key(name, color, alpha, labels, layers):''', '''def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def split_limbs(shape, limbs):
    """How much of each side belongs to the arm, 0 to 1."""
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]].astype(np.float64)
    out = {}
    for side, (pivot, direction, length) in limbs.items():
        dx, dy = xx - pivot[0], yy - pivot[1]
        along = dx * direction[0] + dy * direction[1]
        across = np.abs(dx * direction[1] - dy * direction[0])
        tube = np.hypot(np.maximum(along - length, 0), across) < ARM_RADIUS
        weight = ndi.gaussian_filter(tube.astype(np.float32), 3) * smooth(along / 45 + 0.1)
        if length < STRAIGHT:
            column = (xx < LEFT_OF) if side == "L" else (xx >= RIGHT_OF)
            weight = np.maximum(weight, ndi.gaussian_filter(column.astype(np.float32), 3) * (1 - smooth((yy - WAIST + 25) / 50)))
        out[side] = weight
    return out


def build_key(name, color, alpha, labels, layers):''')
s = s.replace('''    out["patch"] = premultiply(key, patch_alpha * (1 - hair))
    return out, limbs_of(hands), shift, int(mask.sum()), int(hair.sum())''', '''    limbs = limbs_of(hands)
    rest = patch_alpha * (1 - hair)
    stays = np.ones_like(rest)
    # The arm and what stays both reach full strength in the middle of the seam, so it never opens.
    for side, weight in split_limbs(rest.shape, limbs).items():
        out[f"limb{side}"] = premultiply(key, rest * smooth(weight / 0.6))
        stays = np.minimum(stays, 1 - smooth((weight - 0.6) / 0.4))
    out["patch"] = premultiply(key, rest * stays)
    return out, limbs, shift, int(mask.sum()), int(hair.sum())''')
open("keys.py", "w", encoding="utf8").write(s)

r = open("rig.py", encoding="utf8").read()
r = r.replace('''def warp(layer, bone, t, margin=45, steps=2):
    """Mesh warp through PIL: each target cell samples the source quad found by inverting the bone. The target has PAD around the drawing."""
    ys, xs = np.nonzero(layer[..., 3] > 0.002)
''', '''def warp(layer, bone, t, margin=45, steps=2, turn=None):
    """Mesh warp through PIL: each target cell samples the source quad found by inverting the bone. The target has PAD around the drawing.
    `turn` (degrees, pivot) turns the layer rigidly before the bone, for an arm: no falloff, so nothing can fold or tear."""
    ys, xs = np.nonzero(layer[..., 3] > 0.002)
    if turn:
        moved = rotate(np.stack([xs, ys], -1).astype(np.float64), turn[0], turn[1])
        xs, ys = moved[..., 0], moved[..., 1]
''')
r = r.replace('''        p = q - (bone(p, t) - p)
    image = Image.frombytes''', '''        p = q - (bone(p, t) - p)
    if turn:
        p = rotate(p, -turn[0], turn[1])
    image = Image.frombytes''')
r = re.sub(r'def bone_key\(p, t\):.*?return bone_jacket\(q, t\)\n', '''def bone_chest(p, t):
    """A raised arm rides the chest as one piece."""
    return chest(p, t)
''', r, flags=re.S)
open("rig.py", "w", encoding="utf8").write(r)

d = open("render.py", encoding="utf8").read()
d = d.replace("bone_jacket, bone_key, build_layers", "bone_chest, bone_jacket, build_layers")
d = d.replace('("head", bone_head), ("patch", bone_key)]', '("head", bone_head), ("patch", bone_jacket)]')
d = d.replace("from keys import build_key", "from keys import OVER_HEAD, build_key")
d = re.sub(r"    anim\.limbs = \[\]\n.*?return to_game\(compose\(stack\)\)", '''    arms = []
    if name:
        layers = scene.key(name)[0]
        arms = [warp(layers[f"limb{side}"], bone_chest, t, 60, 3, (degrees, pivot)) for side, degrees, pivot in limbs_for(anim, name, scene, t)]
    stack = []
    for layer_name, bone in ORDER:
        if layer_name in ("patch", "patchHair") and not name:
            continue
        # An arm passes behind the head, unless the drawing has its hand on the face.
        if layer_name == "head" and name not in OVER_HEAD:
            stack += arms
        layer = scene.heads[anim.eyes[frame]] if layer_name == "head" else layers[layer_name]
        if (layer[..., 3] > 0.002).any():
            stack.append(warp(layer, bone, t, 60, 3))
    if name in OVER_HEAD:
        stack += arms
    return to_game(compose(stack))''', d, flags=re.S)
d = re.sub(r"def limbs_for\(anim, name, scene\):.*?return out\n", '''def limbs_for(anim, name, scene, t):
    rests = getattr(anim, "rests", {})
    wobble = {"L": anim.wob_l, "R": anim.wob_r}
    out = []
    for side, (pivot, direction, length) in scene.key(name)[1].items():
        rest = rests.get(name, elevation(direction))
        turn = 0.0 if anim.elev is None else float(np.clip(anim.elev(t) - rest, -LIMIT, LIMIT))
        out.append((side, SIGN[side] * (turn + float(wobble[side](t))), pivot))
    return out
''', d, flags=re.S)
open("render.py", "w", encoding="utf8").write(d)
print("applied")
